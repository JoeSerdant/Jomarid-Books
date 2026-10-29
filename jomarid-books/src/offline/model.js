// Čistá logika offline knih (bez Reactu a bez prohlížeče, jde testovat v Node).
export const LICENSE_DAYS = 30;                       // jak dlouho jde stažená kniha otevřít bez připojení k serveru
export const LICENSE_MS = LICENSE_DAYS * 86400000;
export const MAX_TEXT_CHARS = 20_000_000;             // strop na jednu knihu (20 milionů znaků, výrazně víc než skutečné knihy)
export const MAX_BOOKS = 50;                          // nejvýš tolik stažených knih na zařízení
export const REFRESH_EVERY_MS = 6 * 3600000;          // jak často se po připojení znovu ověří licence a obnoví staženo

export const bookKey = (userId, bookId) => `${userId}:${bookId}`;

// Má čtenář na knihu právo? Stejné pravidlo jako ve čtečce: autor, automaticky přidělená kniha, nebo aktivní licence.
export const canReadBook = (book, userBook, userId) =>
  !!book && (book.author_id === userId || !!book.is_auto_assigned || userBook?.status === 'active');

export const msLeft = (expiresAt, now) => Math.max(0, Number(expiresAt) - now);
export const daysLeft = (expiresAt, now) => Math.ceil(msLeft(expiresAt, now) / 86400000);

// Chyba kvůli síti (a ne kvůli právům nebo špatným datům)? Fronta změn se při ní zastaví a zkusí to znovu, jinak se změna zahodí.
export const isTransientError = (err) => {
  if (!err) return false;
  const status = Number(err.status ?? err.statusCode ?? err.code);
  const msg = String(err.message || '').toLowerCase();
  const name = String(err.name || '');
  if (name === 'TypeError' || name === 'AuthRetryableFetchError' || name === 'AbortError') return true;
  if (/failed to fetch|networkerror|network request failed|load failed|fetch failed|offline|timeout|timed out/.test(msg)) return true;
  if (status === 0 || status === 408 || status === 429 || (status >= 500 && status < 600)) return true;
  return false;
};

// Rozhodnutí při návratu na server: pozice z fronty (offline čtení) proti té, co už je na serveru.
// Pokročilejší pozice vyhrává, pokud offline čtení nenastalo později než poslední změna na serveru.
export function resolvePosition(queued, server) {
  if (!server) return { apply: true, percent: queued.percent, isRead: !!queued.isRead };
  const serverAt = server.updated_at ? Date.parse(server.updated_at) : 0;
  const serverPercent = Number(server.scroll_position) || 0;
  const isRead = !!queued.isRead || !!server.is_read;
  if (serverAt > Number(queued.at) && serverPercent > queued.percent) return { apply: false, percent: serverPercent, isRead };
  return { apply: true, percent: queued.percent, isRead };
}

// Id položek vytvořených offline (záložka, zvýraznění) jsou dočasná, dokud je server nepřijme.
export const LOCAL_PREFIX = 'local:';
export const isLocalId = (id) => typeof id === 'string' && id.startsWith(LOCAL_PREFIX);

export const emptyNotes = () => ({ bookmarks: [], highlights: [], rating: 0 });

export const sortHighlights = (list) => [...list].sort((a, b) => a.start_offset - b.start_offset);
