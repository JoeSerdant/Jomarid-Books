// Napsání textu shortB pomocí AI (Edge Function db/ai/shortb-ai.ts, nasazení v db/ai/README.md). AI dodává text s návrhem názvu a žánrů; sérii vyplňuje nakladatel.
// Klient (supabase) se předává zvenku, ať jde modul zkoušet bez prohlížeče. Chyby se vracejí jako česká věta, nikdy se nevyhazují.
import { foldText } from '../browse/browseModel.js';

export const AI_PROMPT_MAX = 2000;
export const AI_LENGTHS = Object.freeze([
  { key: 'short', label: 'Kratší (asi 2 000 znaků)', chars: 2000 },
  { key: 'medium', label: 'Střední (asi 4 000 znaků)', chars: 4000 },
  { key: 'long', label: 'Delší (asi 5 500 znaků)', chars: 5500 },
]);
const PREVIOUS_MAX = 6000;

const ERROR_TEXT = {
  not_authenticated: 'Nejsi přihlášený.',
  forbidden: 'ShortB smí psát jen nakladatel nebo správce.',
  invalid_input: 'Zadání se nepodařilo odeslat. Zkontroluj ho.',
  quota: 'AI má teď plno nebo vyčerpaný limit. Zkus to za chvíli.',
  blocked: 'AI tohle zadání odmítla. Zkus ho přeformulovat.',
  upstream: 'AI teď neodpovídá. Zkus to za chvíli.',
  empty: 'AI nevrátila žádný text. Zkus to znovu.',
};
const NOT_FOUND = 'Funkce shortb-ai nebyla nalezena. V Supabase (Edge Functions) musí mít přesně tenhle název.';
const RELAY = 'Funkce shortb-ai se nespustila: buď nemá správný název, nebo spadla hned při startu. Podrobnosti jsou v Supabase: Edge Functions → shortb-ai → Logs.';
const FETCH = 'Nepodařilo se spojit s funkcí shortb-ai (síť, nebo funkce není nasazená). Zkus to znovu; když se to opakuje, zkontroluj v Supabase Edge Functions → shortb-ai → Logs.';
const REJECTED_JWT = 'Funkce shortb-ai odmítla přihlášení. V jejím nastavení vypni „Verify JWT“ (funkce si přihlášení a roli ověřuje sama) a zkus to znovu.';

/** Nejvyšší díl série mezi shortB (stejný název série bez ohledu na velikost písmen a diakritiku), bez shortB, který se právě upravuje. */
export function latestPart(items, seriesName, exceptId = null) {
  const key = foldText(seriesName);
  if (!key) return null;
  let best = null;
  for (const s of items || []) {
    if (!s || s.id === exceptId || !s.seriesName || foldText(s.seriesName) !== key || !s.body) continue;
    if (!best || (s.seriesPart || 0) > (best.seriesPart || 0)) best = s;
  }
  return best;
}

/**
 * Připraví a zkontroluje požadavek na AI. mode: 'new' (podle zadání) nebo 'next' (další díl, previous je shortB, na který se navazuje).
 * Vrací { request } nebo { error: česká věta }.
 */
export function buildAiRequest({ mode = 'new', prompt = '', length = 'medium', previous = null } = {}) {
  const text = String(prompt ?? '').trim();
  if (text.length > AI_PROMPT_MAX) return { error: `Zadání může mít nejvýš ${AI_PROMPT_MAX} znaků.` };
  const len = AI_LENGTHS.some((l) => l.key === length) ? length : 'medium';
  if (mode === 'next') {
    if (!previous || !String(previous.body || '').trim()) return { error: 'Pro další díl potřebuju předchozí díl série.' };
    return { request: { mode: 'next', prompt: text, length: len, previous: { title: String(previous.title || '').slice(0, 120), body: String(previous.body).slice(0, PREVIOUS_MAX), seriesName: String(previous.seriesName || '').slice(0, 80), seriesPart: Math.max(1, Math.floor(Number(previous.seriesPart)) || 1) } } };
  }
  if (!text) return { error: 'Napiš, o čem má shortB být.' };
  return { request: { mode: 'new', prompt: text, length: len, previous: null } };
}

// Z chyby supabase-js vyčte kód odpovědi funkce (tělo odpovědi je v error.context).
async function errorCode(error) {
  try {
    const ctx = error?.context;
    if (ctx && typeof ctx.json === 'function') {
      const body = await ctx.json();
      if (body && typeof body.error === 'string') return { code: body.error, message: typeof body.message === 'string' ? body.message : '', detail: typeof body.detail === 'string' ? body.detail.slice(0, 300) : '' };
    }
  } catch { /* tělo nešlo přečíst */ }
  return { code: '', message: '', detail: '' };
}

export const aiErrorMessage = (code, message = '') => ERROR_TEXT[code] || message || ERROR_TEXT.upstream;

/** Zavolá funkci a vrátí { text, title, genres, chars, trimmed } nebo { error, detail? } (detail je technický popis od serveru, třeba odpověď Googlu). */
export async function generateShortText(client, request) {
  try {
    const { data, error } = await client.functions.invoke('shortb-ai', { body: request });
    if (error) {
      const { code, message, detail } = await errorCode(error);
      if (code) return { error: aiErrorMessage(code, message), ...(detail ? { detail } : {}) };
      // Bez kódu z funkce: odpověď přišla od Supabase (ne od funkce) nebo se spojení nepovedlo. Pro snazší hledání příčiny se skutečná chyba vypíše do konzole.
      const status = Number(error?.context?.status);
      console.warn('shortb-ai:', error?.name, status || '', error?.message);
      if (error?.name === 'FunctionsFetchError') return { error: FETCH };
      if (error?.name === 'FunctionsRelayError') return { error: RELAY };
      if (status === 404) return { error: NOT_FOUND };
      if (status === 401) return { error: REJECTED_JWT };
      return { error: status >= 500 ? `${ERROR_TEXT.upstream} (chyba funkce, kód ${status}; detail je v Edge Functions → shortb-ai → Logs)` : ERROR_TEXT.upstream };
    }
    const text = typeof data?.text === 'string' ? data.text : '';
    if (!text.trim()) return { error: ERROR_TEXT.empty };
    const title = typeof data?.title === 'string' ? data.title.trim().slice(0, 120) : '';
    const genres = Array.isArray(data?.genres) ? data.genres.filter((g) => typeof g === 'string' && g.trim()).map((g) => g.trim()).slice(0, 8) : [];
    return { text, title, genres, chars: Number(data.chars) || [...text].length, trimmed: data.trimmed === true };
  } catch {
    return { error: ERROR_TEXT.upstream };
  }
}
