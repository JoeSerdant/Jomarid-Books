// Supabase Edge Function "shortb-ai": napíše návrh textu shortB pomocí Gemini (Google AI). Volá ji Studio (tlačítko „Napsat s AI“) s přihlášením
// nakladatele nebo správce. Klíč ke Gemini je jen tady (Edge Functions -> Secrets), do prohlížeče se nikdy nedostane.
// Nastavení a nasazení: db/ai/README.md. Tajné hodnoty: GEMINI_API_KEY (povinná), GEMINI_MODEL (nepovinná, výchozí gemini-2.5-flash).
// SUPABASE_URL a SUPABASE_ANON_KEY dodává Supabase sám.
//
// AI dodává jen TEXT (odstavce oddělené prázdným řádkem). Název, žánry a sérii vyplňuje nakladatel sám a návrh si před zveřejněním přečte a upraví.
// Logika je ve funkcích handle() a buildPrompt() se závislostmi zvenku, takže jde testovat v Node (src/tests/shortsAi.test.mjs) bez Deno a sítě.

export const MAX_BODY_CHARS = 6000;   // stejný strop jako db/shorts.sql
export const PROMPT_MAX = 2000;       // zadání od nakladatele
export const PREVIOUS_MAX = 6000;     // předchozí díl série, ze kterého se navazuje
export const LENGTHS = { short: 2000, medium: 4000, long: 5500 } as const;
export type LengthKey = keyof typeof LENGTHS;

export type GenResult = { text: string } | { error: 'quota' | 'blocked' | 'upstream' | 'empty'; detail?: string };
export interface AiDeps {
  /** Ověří přihlášení a roli (nakladatel nebo správce). */
  authorize: (token: string) => Promise<{ ok: true } | { ok: false; reason: 'not_authenticated' | 'forbidden' }>;
  /** Zavolá model. */
  generate: (system: string, user: string) => Promise<GenResult>;
}

interface Previous { title: string; body: string; seriesName: string; seriesPart: number }
export interface AiInput { mode: 'new' | 'next'; prompt: string; length: LengthKey; previous: Previous | null }

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

/** Stručný popis chyby pro nakladatele (stav a věta od Googlu). Klíč v něm nikdy není: vše, co se klíči podobá, se vymaže. */
export const safeDetail = (v: unknown): string =>
  String(v ?? '').replace(/AIza[0-9A-Za-z_-]{20,}|AQ\.[0-9A-Za-z_-]{20,}|key=[^\s&"']+/g, '[klíč]').replace(/\s+/g, ' ').trim().slice(0, 300);

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, max) : '');

/** Zkontroluje vstup z prohlížeče. Vrací {input} nebo {error: česká věta}. */
export function parseInput(raw: unknown): { input: AiInput } | { error: string } {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const mode = o.mode === 'next' ? 'next' : 'new';
  const prompt = str(o.prompt, PROMPT_MAX);
  const length = (typeof o.length === 'string' && o.length in LENGTHS ? o.length : 'medium') as LengthKey;
  if (typeof o.prompt === 'string' && o.prompt.trim().length > PROMPT_MAX) return { error: `Zadání je moc dlouhé (nejvýš ${PROMPT_MAX} znaků).` };
  let previous: Previous | null = null;
  if (mode === 'next') {
    const p = (o.previous && typeof o.previous === 'object' ? o.previous : {}) as Record<string, unknown>;
    const body = str(p.body, PREVIOUS_MAX);
    const part = Math.floor(Number(p.seriesPart));
    if (!body) return { error: 'Pro další díl chybí text předchozího dílu.' };
    previous = { title: str(p.title, 120), body, seriesName: str(p.seriesName, 80), seriesPart: Number.isFinite(part) && part >= 1 ? part : 1 };
  } else if (!prompt) {
    return { error: 'Napiš, o čem má shortB být.' };
  }
  return { input: { mode, prompt, length, previous } };
}

/** Sestaví pokyny pro model: system (jak psát) a user (co psát). */
export function buildPrompt(input: AiInput): { system: string; user: string } {
  const target = LENGTHS[input.length];
  const system = [
    'Jsi zkušený spisovatel krátké prózy pro čtecí aplikaci. Píšeš česky, přirozeně, živě a bez klišé.',
    `Napiš jeden uzavřený text o délce zhruba ${target} znaků. Nikdy nepřekroč ${MAX_BODY_CHARS - 500} znaků.`,
    'Text začni silným prvním odstavcem, který čtenáře chytí, a skonči tak, aby měl konec váhu.',
    'Odstavce odděluj prázdným řádkem. Použij běžné odstavce, žádné nadpisy, odrážky ani značky Markdown (*, #, _), žádný název textu.',
    'Vrať pouze samotný text. Bez úvodu, bez poznámek, bez shrnutí a bez vysvětlování, co jsi napsal.',
    'Nepoužívej skutečné žijící osoby, neuváděj návody k ublížení ani explicitní sexuální obsah.',
  ].join('\n');

  let user: string;
  if (input.mode === 'next' && input.previous) {
    const p = input.previous;
    const series = p.seriesName ? `série „${p.seriesName}“` : 'série';
    user = [
      `Napiš další díl ${series} (předchozí byl díl ${p.seriesPart}${p.title ? `, „${p.title}“` : ''}).`,
      'Zachovej postavy, svět, tón a styl, ale text musí jít číst i samostatně. Posuň příběh dál, neopakuj předchozí děj.',
      input.prompt ? `Zadání pro tenhle díl: ${input.prompt}` : 'Zadání pro tenhle díl není, vymysli přirozené pokračování.',
      '',
      'Předchozí díl:',
      '"""',
      p.body,
      '"""',
    ].join('\n');
  } else {
    user = `Zadání: ${input.prompt}`;
  }
  return { system, user };
}

/** Uklidí odpověď modelu: ohrazení kódu, Markdown, zdvojené prázdné řádky; text delší než strop ořízne na hranici odstavce nebo věty. */
export function cleanText(raw: string): { text: string; trimmed: boolean } {
  let t = String(raw ?? '').replace(/\r\n?/g, '\n');
  t = t.replace(/^```[a-z]*\n?/i, '').replace(/\n?```\s*$/i, '');
  t = t.replace(/^#{1,6}\s+.*\n+/, '');                 // případný nadpis na začátku
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/(^|\s)\*([^*\n]+)\*(?=\s|[.,!?…]|$)/g, '$1$2');
  t = t.replace(/^[ \t]*[-*•][ \t]+/gm, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if ([...t].length <= MAX_BODY_CHARS) return { text: t, trimmed: false };
  const cut = [...t].slice(0, MAX_BODY_CHARS).join('');
  const para = cut.lastIndexOf('\n\n');
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('.\n'));
  const at = para > MAX_BODY_CHARS * 0.5 ? para : sentence > MAX_BODY_CHARS * 0.5 ? sentence + 1 : MAX_BODY_CHARS;
  return { text: cut.slice(0, at).trim(), trimmed: true };
}

const ERRORS: Record<string, { status: number; message: string }> = {
  quota: { status: 429, message: 'AI má teď plno nebo vyčerpaný limit. Zkus to za chvíli.' },
  blocked: { status: 422, message: 'AI tohle zadání odmítla. Zkus ho přeformulovat.' },
  upstream: { status: 502, message: 'AI teď neodpovídá. Zkus to za chvíli.' },
  empty: { status: 502, message: 'AI nevrátila žádný text. Zkus to znovu.' },
};

export async function handle(req: Request, deps: AiDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed', message: 'Jen POST.' }, 405);

  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'not_authenticated', message: 'Nejsi přihlášený.' }, 401);
  let auth;
  try { auth = await deps.authorize(token); } catch (e) { console.error('shortb-ai: ověření selhalo', e); return json({ error: 'upstream', message: ERRORS.upstream.message }, 502); }
  if (!auth.ok) {
    return auth.reason === 'forbidden'
      ? json({ error: 'forbidden', message: 'ShortB smí psát jen nakladatel nebo správce.' }, 403)
      : json({ error: 'not_authenticated', message: 'Nejsi přihlášený.' }, 401);
  }

  let raw: unknown;
  try { raw = await req.json(); } catch { return json({ error: 'invalid_input', message: 'Neplatný požadavek.' }, 400); }
  const parsed = parseInput(raw);
  if ('error' in parsed) return json({ error: 'invalid_input', message: parsed.error }, 400);

  const { system, user } = buildPrompt(parsed.input);
  let result: GenResult;
  try { result = await deps.generate(system, user); } catch (e) { console.error('shortb-ai: model selhal', e); result = { error: 'upstream', detail: `volání modelu selhalo (${(e as Error)?.name ?? 'chyba'})` }; }
  if ('error' in result) {
    const e = ERRORS[result.error] ?? ERRORS.upstream;
    return json({ error: result.error, message: e.message, ...(result.detail ? { detail: safeDetail(result.detail) } : {}) }, e.status);
  }
  const { text, trimmed } = cleanText(result.text);
  if (!text) return json({ error: 'empty', message: ERRORS.empty.message }, ERRORS.empty.status);
  return json({ text, chars: [...text].length, trimmed });
}

// Spuštění v Supabase (Deno). V Node (testy) se tahle část přeskočí.
// deno-lint-ignore no-explicit-any
const D = (globalThis as any).Deno;
if (D && typeof D.serve === 'function') {
  const { createClient } = await import('npm:@supabase/supabase-js@2');
  const url = D.env.get('SUPABASE_URL')!;
  const anon = D.env.get('SUPABASE_ANON_KEY')!;
  const key = D.env.get('GEMINI_API_KEY') ?? '';
  const model = D.env.get('GEMINI_MODEL') || 'gemini-2.5-flash';

  const deps: AiDeps = {
    authorize: async (token) => {
      const db = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
      const { data, error } = await db.auth.getUser(token);
      if (error || !data?.user) return { ok: false, reason: 'not_authenticated' };
      const prof = await db.from('profiles').select('role').eq('id', data.user.id).maybeSingle();
      const role = (prof.data as { role?: string } | null)?.role;
      return role === 'nakladatel' || role === 'správce' ? { ok: true } : { ok: false, reason: 'forbidden' };
    },
    generate: async (system, user) => {
      if (!key) { console.error('shortb-ai: chybí GEMINI_API_KEY (Edge Functions -> Secrets)'); return { error: 'upstream', detail: 'v Supabase (Edge Functions → Secrets) chybí GEMINI_API_KEY' }; }
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature: 1, maxOutputTokens: 8192 },
        }),
        signal: AbortSignal.timeout(50000),
      });
      if (res.status === 429) return { error: 'quota' };
      if (!res.ok) {
        const raw = (await res.text()).slice(0, 600);
        console.error('shortb-ai: Gemini vrátilo', res.status, raw.slice(0, 300));
        let msg = raw;
        try { msg = JSON.parse(raw)?.error?.message ?? raw; } catch { /* nebyl JSON */ }
        return { error: 'upstream', detail: `Gemini odpovědělo ${res.status}: ${msg}` };
      }
      const data = await res.json();
      if (data?.promptFeedback?.blockReason) return { error: 'blocked' };
      const cand = data?.candidates?.[0];
      const text = (cand?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');
      if (!text.trim()) return { error: cand?.finishReason === 'SAFETY' || cand?.finishReason === 'PROHIBITED_CONTENT' ? 'blocked' : 'empty', detail: cand?.finishReason ? `důvod ukončení: ${cand.finishReason}` : undefined };
      return { text };
    },
  };
  D.serve((req: Request) => handle(req, deps));
}
