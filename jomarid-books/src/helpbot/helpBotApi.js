// Pomocník v appce (chat): klient pro Edge Function db/ai/help-bot.ts (nasazení v db/ai/README.md). Funkce odpovídá jen na otázky o appce.
// Klient (supabase) se předává zvenku, ať jde modul zkoušet bez prohlížeče. Chyby se vracejí jako česká věta, nikdy se nevyhazují.

export const HELP_MSG_MAX = 500;      // stejný strop jako ve funkci
export const HELP_HISTORY_MAX = 8;    // kolik posledních zpráv se posílá

const ERROR_TEXT = {
  not_authenticated: 'Nejsi přihlášený.',
  invalid_input: 'Zprávu se nepodařilo odeslat. Zkontroluj ji.',
  limit: 'Dnešní limit otázek pro pomocníka je vyčerpaný. Zítra se můžeš ptát znovu.',
  quota: 'Pomocník má teď plno. Zkus to za chvíli.',
  blocked: 'S tímhle ti pomocník neporadí. Zkus otázku přeformulovat.',
  upstream: 'Pomocník teď neodpovídá. Zkus to za chvíli.',
  empty: 'Pomocník nevrátil žádnou odpověď. Zkus to znovu.',
};
const NOT_FOUND = 'Funkce help-bot nebyla nalezena. V Supabase (Edge Functions) musí mít přesně tenhle název.';
const RELAY = 'Funkce help-bot se nespustila: buď nemá správný název, nebo spadla hned při startu. Podrobnosti jsou v Supabase: Edge Functions → help-bot → Logs.';
const FETCH = 'Nepodařilo se spojit s pomocníkem (síť, nebo funkce help-bot není nasazená). Zkus to znovu.';
const REJECTED_JWT = 'Funkce help-bot odmítla přihlášení. V jejím nastavení vypni „Verify JWT“ a zkus to znovu.';

/** Zprávy z chatu ({ from: 'me' | 'bot', text }) na tvar pro funkci: jen posledních několik, bez chybových bublin a otázek, na které odpověď selhala, a s krácením. */
export function toRequestMessages(chat) {
  const out = [];
  const items = chat || [];
  for (let i = 0; i < items.length; i++) {
    const m = items[i];
    if (!m || m.error || !String(m.text || '').trim()) continue;
    if (m.from === 'me' && items[i + 1]?.error) continue;   // otázka, na kterou odpověď selhala, se příště neposílá (nezůstanou dvě uživatelské zprávy za sebou)
    out.push({ role: m.from === 'me' ? 'user' : 'assistant', text: String(m.text).trim().slice(0, m.from === 'me' ? HELP_MSG_MAX : 700) });
  }
  const last = out.slice(-HELP_HISTORY_MAX);
  while (last.length && last[0].role !== 'user') last.shift();
  return last;
}

/** Zkontroluje zprávu před odesláním. Vrací { text } nebo { error: česká věta }. */
export function checkQuestion(input) {
  const text = String(input ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return { error: 'Napiš, s čím potřebuješ pomoct.' };
  if ([...text].length > HELP_MSG_MAX) return { error: `Zpráva může mít nejvýš ${HELP_MSG_MAX} znaků.` };
  return { text };
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

export const helpErrorMessage = (code, message = '') => ERROR_TEXT[code] || message || ERROR_TEXT.upstream;

/** Zeptá se pomocníka. Vrací { answer, onTopic, left } nebo { error, detail? }. page je adresa stránky appky (třeba "/stats"). */
export async function askHelpBot(client, { messages, page = '' }) {
  try {
    const { data, error } = await client.functions.invoke('help-bot', { body: { messages, page } });
    if (error) {
      const { code, message, detail } = await errorCode(error);
      if (code) return { error: helpErrorMessage(code, message), ...(detail ? { detail } : {}) };
      const status = Number(error?.context?.status);
      console.warn('help-bot:', error?.name, status || '', error?.message);
      if (error?.name === 'FunctionsFetchError') return { error: FETCH };
      if (error?.name === 'FunctionsRelayError') return { error: RELAY };
      if (status === 404) return { error: NOT_FOUND };
      if (status === 401) return { error: REJECTED_JWT };
      return { error: ERROR_TEXT.upstream };
    }
    const answer = typeof data?.answer === 'string' ? data.answer.trim() : '';
    if (!answer) return { error: ERROR_TEXT.empty };
    return { answer, onTopic: data.onTopic !== false, left: Number.isFinite(Number(data.left)) ? Number(data.left) : null };
  } catch {
    return { error: ERROR_TEXT.upstream };
  }
}
