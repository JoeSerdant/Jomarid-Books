// Supabase Edge Function "code-login": přihlášení přihlašovacím kódem místo hesla. Kód si čtenář vygeneruje v Nastavení (Zabezpečení, db/login-code.sql).
// Funkce zkontroluje kód (jeho otisk v databázi), a když sedí, vydá jednorázový token, kterým appka dokončí přihlášení (supabase.auth.verifyOtp).
// Nasazení: db/auth/README.md. Tajné hodnoty nejsou potřeba: SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY dodává Supabase sám.
// Klíč service_role je jen tady, do prohlížeče se nikdy nedostane.
//
// Logika je ve funkci handle() se závislostmi zvenku, takže jde testovat v Node (src/tests/codeLogin.test.mjs) bez Deno a sítě.

export const CODE_LENGTH = 32;                   // znaků 0-9 A-F (122 náhodných bitů), v zobrazení po čtyřech s pomlčkami

export type RedeemResult = { ok: true; userId: string } | { ok: false; reason: 'invalid' | 'throttled' };
export interface Deps {
  /** Najde účet podle otisku kódu (SHA-256 jako hex) a zapíše neúspěšný pokus; zná omezení počtu pokusů. */
  redeem: (hashHex: string, client: string) => Promise<RedeemResult>;
  /** Vydá jednorázový token pro přihlášení daného účtu; null, když ho nešlo vydat. */
  mint: (userId: string) => Promise<{ tokenHash: string } | null>;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** Z toho, co čtenář opsal nebo vložil (malá písmena, pomlčky, mezery), udělá 32 znaků velkými písmeny; neplatný tvar vrací null. */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.replace(/[\s-]+/g, '').toUpperCase();
  return /^[0-9A-F]{32}$/.test(t) ? t : null;
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Adresa volajícího pro omezení pokusů (Supabase ji předává v x-forwarded-for). */
export function clientOf(req: Request): string {
  const f = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '';
  return f.split(',')[0].trim().slice(0, 100) || 'unknown';
}

const MESSAGES = {
  invalid_input: 'Kód má 32 znaků (číslice a písmena A-F). Zkontroluj, jestli je celý.',
  invalid: 'Kód nesedí. Zkontroluj ho, nebo si v Nastavení vygeneruj nový.',
  throttled: 'Moc pokusů. Zkus to za deset minut, nebo se přihlas heslem.',
  upstream: 'Přihlášení kódem se teď nepovedlo. Zkus to za chvíli, nebo se přihlas heslem.',
};

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed', message: 'Jen POST.' }, 405);

  let raw: unknown;
  try { raw = await req.json(); } catch { return json({ error: 'invalid_input', message: MESSAGES.invalid_input }, 400); }
  const code = normalizeCode((raw as { code?: unknown } | null)?.code);
  if (!code) return json({ error: 'invalid_input', message: MESSAGES.invalid_input }, 400);

  let result: RedeemResult;
  try { result = await deps.redeem(await sha256Hex(code), clientOf(req)); } catch (e) { console.error('code-login: ověření kódu selhalo', e); return json({ error: 'upstream', message: MESSAGES.upstream }, 502); }
  if (!result.ok) return result.reason === 'throttled'
    ? json({ error: 'throttled', message: MESSAGES.throttled }, 429)
    : json({ error: 'invalid', message: MESSAGES.invalid }, 401);

  let minted: { tokenHash: string } | null = null;
  try { minted = await deps.mint(result.userId); } catch (e) { console.error('code-login: vydání přihlášení selhalo', e); }
  if (!minted?.tokenHash) return json({ error: 'upstream', message: MESSAGES.upstream }, 502);
  return json({ token_hash: minted.tokenHash });
}

// Spuštění v Supabase (Deno). V Node (testy) se tahle část přeskočí.
// deno-lint-ignore no-explicit-any
const D = (globalThis as any).Deno;
if (D && typeof D.serve === 'function') {
  const { createClient } = await import('npm:@supabase/supabase-js@2');
  const admin = createClient(D.env.get('SUPABASE_URL')!, D.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });

  const deps: Deps = {
    redeem: async (hashHex, client) => {
      const { data, error } = await admin.rpc('redeem_login_code', { p_hash: '\\x' + hashHex, p_client: client });
      if (error) throw error;
      const r = (data ?? {}) as { ok?: boolean; user_id?: string; reason?: string };
      if (r.ok && r.user_id) return { ok: true, userId: r.user_id };
      return { ok: false, reason: r.reason === 'throttled' ? 'throttled' : 'invalid' };
    },
    mint: async (userId) => {
      const u = await admin.auth.admin.getUserById(userId);
      const email = u.data?.user?.email;
      if (u.error || !email) return null;
      const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
      const tokenHash = link.data?.properties?.hashed_token;
      return link.error || !tokenHash ? null : { tokenHash };
    },
  };
  D.serve((req: Request) => handle(req, deps));
}
