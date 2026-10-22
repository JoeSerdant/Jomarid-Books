// Přátelské hlášky o chybách: místo "503" nebo "Failed to fetch" uživatel dostane lidskou větu a ví, co dělat.
// Technický text se do appky nevypisuje (je jen v konzoli, kam ho appka zapisuje sama). Čistá logika bez Reactu, zkouší se v Node (src/tests/friendlyError.test.mjs).

export const FRIENDLY = Object.freeze({
  network: 'Nemůžu se spojit s internetem. Zkontroluj připojení a zkus to znovu.',
  server: 'Promiň! Appka teď zažívá závratě. Počkej chvilku a zkus to znovu.',
  timeout: 'Tohle trvá nějak dlouho. Zkus to za chvilku znovu.',
  rate: 'Pomalu, pomalu! Teď je toho na server moc. Zkus to za minutku.',
  auth: 'Vypršelo ti přihlášení. Přihlas se prosím znovu.',
  forbidden: 'K tomuhle teď nemáš oprávnění.',
  missing: 'Tohle teď není dostupné. Zkus to později.',
});

const statusOf = (err) => {
  const n = Number(err?.status ?? err?.statusCode ?? err?.context?.status ?? err?.response?.status);
  if (Number.isFinite(n) && n > 0) return n;
  const m = String(err?.message ?? err ?? '').match(/\b(?:status|code|error|chyba)?\s*(4\d\d|5\d\d)\b/i);
  return m ? Number(m[1]) : 0;
};

/**
 * Zařadí chybu (z Supabase, fetch, funkce) do druhu: network, server, timeout, rate, auth, forbidden, missing,
 * nebo 'other' (chyba, kterou jde vysvětlit jen konkrétní větou, tu dodá volající).
 */
export function classifyError(err) {
  const text = String(err?.message ?? err ?? '');
  const name = String(err?.name ?? '');
  const code = String(err?.code ?? '');
  const status = statusOf(err);
  if (name === 'AbortError' || name === 'TimeoutError' || /timed? ?out|timeout|signal is aborted/i.test(text)) return 'timeout';
  if (name === 'FunctionsFetchError' || /failed to fetch|networkerror|network request failed|load failed|err_internet|offline/i.test(text) || (typeof navigator !== 'undefined' && navigator.onLine === false)) return 'network';
  if (status === 429 || /too many requests|rate limit|over_request_rate_limit/i.test(text)) return 'rate';
  if (status === 401 || /jwt expired|invalid jwt|not_authenticated|refresh token|auth session missing/i.test(text) || code === 'PGRST301') return 'auth';
  if (status === 403 || code === '42501' || /permission denied|row-level security|forbidden/i.test(text)) return 'forbidden';
  if (status === 404 || code === 'PGRST202' || code === 'PGRST205' || code === '42P01' || code === '42883' || /could not find the (function|table)|does not exist/i.test(text)) return 'missing';
  if ((status >= 500 && status <= 599) || /overloaded|high demand|service unavailable|bad gateway|gateway time-?out|internal server error|upstream/i.test(text)) return 'server';
  return 'other';
}

/** Přátelská věta k chybě. U druhů, kterým uživatel rozumí a může je řešit (síť, přetížení, přihlášení...) vrací jejich větu, jinak fallback. */
export function friendlyError(err, fallback = 'Něco se nepovedlo. Zkus to prosím znovu.') {
  const kind = classifyError(err);
  return FRIENDLY[kind] || fallback;
}

/** Stejné, ale k větě se u neznámé chyby přidá stručný technický text (pro správce, který chybu potřebuje poslat dál). */
export function friendlyErrorWithDetail(err, fallback = 'Něco se nepovedlo. Zkus to prosím znovu.') {
  const kind = classifyError(err);
  if (FRIENDLY[kind]) return FRIENDLY[kind];
  const raw = String(typeof err === 'string' ? err : err?.message ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
  return raw ? `${fallback} (technicky: ${raw})` : fallback;
}
