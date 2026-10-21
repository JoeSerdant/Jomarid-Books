// Napsání textu shortB pomocí AI (Edge Function db/ai/shortb-ai.ts, nasazení v db/ai/README.md). AI dodává jen text; název, žánry a sérii vyplňuje nakladatel.
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
const NOT_DEPLOYED = 'AI pomocník zatím není nastavený (správce musí nasadit funkci shortb-ai).';

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
      if (body && typeof body.error === 'string') return { code: body.error, message: typeof body.message === 'string' ? body.message : '' };
    }
  } catch { /* tělo nešlo přečíst */ }
  return { code: '', message: '' };
}

export const aiErrorMessage = (code, message = '') => ERROR_TEXT[code] || message || ERROR_TEXT.upstream;

/** Zavolá funkci a vrátí { text, chars, trimmed } nebo { error }. */
export async function generateShortText(client, request) {
  try {
    const { data, error } = await client.functions.invoke('shortb-ai', { body: request });
    if (error) {
      const { code, message } = await errorCode(error);
      if (code) return { error: aiErrorMessage(code, message) };
      if (/not found|404|FunctionsRelayError|Failed to send a request/i.test(String(error?.message || '') + String(error?.name || ''))) return { error: NOT_DEPLOYED };
      return { error: ERROR_TEXT.upstream };
    }
    const text = typeof data?.text === 'string' ? data.text : '';
    if (!text.trim()) return { error: ERROR_TEXT.empty };
    return { text, chars: Number(data.chars) || [...text].length, trimmed: data.trimmed === true };
  } catch {
    return { error: ERROR_TEXT.upstream };
  }
}
