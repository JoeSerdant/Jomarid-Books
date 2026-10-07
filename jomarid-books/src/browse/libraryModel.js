// Logika knihovny bez Reactu a bez sítě: převod řádku z databáze na knihu, řazení, filtrování, počty u filtrů a
// zapamatovaný stav procházení. Jde testovat v Node (src/tests/browse.test.mjs).

import { foldText, matchesTokens, queryTokens } from './browseModel.js';

export const SORT_OPTIONS = [
  { key: 'smart', label: 'Doporučeno' },
  { key: 'newest', label: 'Nejnovější' },
  { key: 'alpha', label: 'Abecedně' },
  { key: 'rating', label: 'Nejlépe hodnocené' },
  { key: 'likes', label: 'Nejoblíbenější' },
  { key: 'price_low', label: 'Nejlevnější' },
  { key: 'price_high', label: 'Nejdražší' },
];

export const STATUS_FILTERS = [
  { key: 'all', label: 'Všechny' },
  { key: 'owned', label: 'Moje knihy' },
  { key: 'reading', label: 'Rozečtené' },
  { key: 'finished', label: 'Dočtené' },
];

// Rozečtená kniha: vlastněná, ne dočtená, ale už otevřená. Stejné pravidlo používá i "Pokračovat ve čtení".
export const isInProgress = (b) => b.hasAccess && !b.isRead && b.scrollPosition > 0;

/**
 * Co u knihy nabídnout: číst / pokračovat / číst znovu, nebo koupit (a když na to čtenář nemá, kolik mincí chybí).
 * label je plný text tlačítka, short kratší do úzkého místa (řádek seznamu na telefonu).
 */
export const bookAction = (book, coins) => {
  if (book.hasAccess) {
    if (book.isRead) return { kind: 'read', label: 'Číst znovu', short: 'Znovu' };
    if (isInProgress(book)) return { kind: 'read', label: 'Pokračovat', short: 'Pokračovat' };
    return { kind: 'read', label: 'Číst', short: 'Číst' };
  }
  const missing = book.priceCoins - coins;
  if (missing > 0) return { kind: 'buy', affordable: false, label: `Chybí ${missing}`, short: `Chybí ${missing}` };
  return { kind: 'buy', affordable: true, label: `Koupit za ${book.priceCoins}`, short: `Koupit ${book.priceCoins}` };
};

/**
 * Řádek tabulky books + údaje přihlášeného čtenáře -> kniha pro knihovnu.
 * userBook = jeho řádek z user_books (nebo null), realLikes = počet lajků z tabulky book_likes (falešné se přičtou).
 */
export const toLibraryBook = (row, { userId, userBook = null, liked = false, realLikes = 0 } = {}) => {
  const isOwner = !!userId && row.author_id === userId;
  // Knihy označené jako "Automatická kniha" jsou zdarma pro všechny bez nutnosti nákupu.
  const hasAccess = isOwner || !!row.is_auto_assigned || userBook?.status === 'active';
  const title = String(row.title ?? '');
  const author = String(row.author_display || row.author || '');
  return {
    id: row.id,
    title,
    author,
    authorId: row.author_id || null,
    likesCount: (Number(realLikes) || 0) + (Number(row.fake_likes) || 0),
    isLiked: !!liked,
    avgRating: parseFloat(row.avg_rating) || 0,
    ratingsCount: row.ratings_count || 0,
    genres: Array.isArray(row.genres) ? row.genres : [],
    description: row.description || '',
    priceCoins: row.price_coins ?? 0,
    hasAccess,
    isOwner,
    isRead: userBook?.is_read || false,
    scrollPosition: userBook?.scroll_position || 0,
    lastOpened: userBook?.updated_at ? new Date(userBook.updated_at).getTime() || 0 : 0,
    createdAt: row.created_at ? new Date(row.created_at).getTime() || 0 : 0,
    // Předpočítaný text pro hledání (název + autor bez diakritiky), ať se při psaní nepřepočítává pro každou knihu.
    searchKey: foldText(`${title} ${author}`),
  };
};

// ---- řazení ----

// "Doporučeno": nejdřív moje rozečtené a nedočtené (naposledy otevřená první), pak dočtené, pak ostatní knihy podle
// oblíbenosti (mezi nevlastněnými knihami jiné pořadí nedává smysl).
const smartCompare = (a, b) => {
  if (a.hasAccess && b.hasAccess) {
    if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;
    return b.lastOpened - a.lastOpened;
  }
  if (a.hasAccess !== b.hasAccess) return (b.hasAccess ? 1 : 0) - (a.hasAccess ? 1 : 0);
  return b.likesCount - a.likesCount;
};

/** Základní pořadí knihovny (po načtení). Ostatní řazení se skládají nad ním, takže při shodě zůstane toto pořadí. */
export const orderLibrary = (books) => [...books].sort(smartCompare);

const collator = new Intl.Collator('cs');
const COMPARATORS = {
  newest: (a, b) => b.createdAt - a.createdAt,
  alpha: (a, b) => collator.compare(a.title, b.title),
  rating: (a, b) => b.avgRating - a.avgRating,
  likes: (a, b) => b.likesCount - a.likesCount,
  price_low: (a, b) => a.priceCoins - b.priceCoins,
  price_high: (a, b) => b.priceCoins - a.priceCoins,
};

/** 'smart' (a neznámý klíč) nechává pořadí, jaké seznam má; ostatní klíče řadí kopii (řazení je stabilní). */
export const sortBooks = (books, key) => {
  const compare = COMPARATORS[key];
  return compare ? [...books].sort(compare) : books;
};

// ---- filtry ----

const STATUS_TESTS = {
  all: () => true,
  owned: (b) => b.hasAccess,
  reading: isInProgress,
  finished: (b) => b.hasAccess && b.isRead,
};

export const filterBooks = (books, { status = 'all', genre = 'all', query = '' } = {}) => {
  const statusTest = STATUS_TESTS[status] || STATUS_TESTS.all;
  const tokens = queryTokens(query);
  return books.filter((b) => statusTest(b) && (genre === 'all' || b.genres.includes(genre)) && matchesTokens(b.searchKey, tokens));
};

/** Počty u přepínače "Všechny / Moje knihy / Rozečtené / Dočtené". */
export const statusCounts = (books) => {
  const counts = { all: books.length, owned: 0, reading: 0, finished: 0 };
  for (const b of books) {
    if (b.hasAccess) counts.owned += 1;
    if (isInProgress(b)) counts.reading += 1;
    if (b.hasAccess && b.isRead) counts.finished += 1;
  }
  return counts;
};

/**
 * Žánry s počtem knih, seřazené abecedně. Počítá se přes ostatní filtry (stav, hledání), ale ne přes žánr samotný:
 * číslo u žánru je to, kolik knih uvidí čtenář po jeho vybrání.
 */
export const genreCounts = (books, { status = 'all', query = '' } = {}) => {
  const counts = new Map();
  for (const b of filterBooks(books, { status, query })) {
    for (const g of new Set(b.genres)) counts.set(g, (counts.get(g) || 0) + 1);
  }
  return [...counts].map(([genre, count]) => ({ genre, count })).sort((a, b) => collator.compare(a.genre, b.genre));
};

// ---- zapamatovaný stav ----
// Po návratu z čtečky (nebo po obnovení stránky) má knihovna vypadat tak, jak ji čtenář opustil: filtry, řazení,
// kolik knih bylo rozbaleno a kam doscrolloval. Stav je jen v rámci karty prohlížeče a jen pár minut, ať se po
// delší pauze neobjeví zapomenuté hledání, kvůli kterému se zdá, že knihy zmizely.

export const STATE_TTL_MS = 30 * 60 * 1000;

const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const count = (v, max) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0; };

/** Z uložených dat udělá platný stav (neplatné části nahradí výchozími); cizí účet, stará nebo rozbitá data = null. */
export const normalizeLibraryState = (raw, { userId, now = Date.now(), ttlMs = STATE_TTL_MS } = {}) => {
  if (!raw || typeof raw !== 'object' || !userId || raw.userId !== userId) return null;
  const age = now - Number(raw.savedAt);
  if (!Number.isFinite(age) || age < 0 || age > ttlMs) return null;
  return {
    sort: SORT_OPTIONS.some((o) => o.key === raw.sort) ? raw.sort : 'smart',
    status: STATUS_FILTERS.some((o) => o.key === raw.status) ? raw.status : 'all',
    genre: text(raw.genre, 80) || 'all',
    query: text(raw.query, 200),
    visible: count(raw.visible, 100000),
    scrollY: count(raw.scrollY, 10000000),
  };
};

/** Obnovený stav, který odkazuje na neexistující žánr (knihy se mezitím změnily), by ukázal prázdný seznam. */
export const sanitizeRestoredState = (state, books) => {
  if (!state) return state;
  const genreExists = state.genre === 'all' || books.some((b) => b.genres.includes(state.genre));
  return genreExists ? state : { ...state, genre: 'all' };
};

export const serializeLibraryState = (userId, state, now = Date.now()) => ({
  userId,
  savedAt: now,
  sort: state.sort,
  status: state.status,
  genre: state.genre,
  query: state.query,
  visible: state.visible,
  scrollY: state.scrollY,
});
