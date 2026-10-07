// Načtení dat katalogu. Databáze vrací najednou jen omezený počet řádků (u Supabase standardně 1000), takže se
// všechno čte po částech; počty lajků se berou jako jedno číslo u každé knihy, ne jako seznam všech lajků všech
// čtenářů (ten by s rostoucím počtem knih a čtenářů rostl bez omezení). Používá to knihovna i vyhledávací okno.

import { canonicalizeGenres, orderLibrary, toLibraryBook } from './libraryModel.js';

const FETCH_PAGE = 500;
const MAX_PAGES = 100;

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Chyba, kterou načítání vrací, když ho volající přerušil (isCancelled); není to selhání, jen se nemá nic zobrazit. */
export const isCancelledError = (error) => !!error && error.cancelled === true;
const CANCELLED = { cancelled: true, message: 'Načítání bylo přerušeno.' };

/**
 * Přechodná chyba, která má smysl zkusit znovu: výpadek sítě (stav 0), přetížení nebo chyba serveru (5xx), příliš
 * mnoho požadavků. Chyby dotazu (4xx, kódy PostgREST) se nezopakují, ty by dopadly stejně.
 */
export const isTransient = (res) => {
  const status = Number(res?.status);
  return !!res?.error && (status === 0 || status >= 500 || status === 429 || status === 408);
};

/** Databáze neumí vložený počet lajků u knihy (chybí vztah mezi tabulkami nebo oprávnění): má smysl záložní postup. */
export const isEmbedProblem = (error) => !!error && (/^PGRST20[01]$/.test(String(error.code)) || String(error.code) === '42501' || /relationship/i.test(String(error.message)));

// Dotaz se při přechodné chybě zopakuje (2x se čekáním), ať jedna zakopnutá část nezahodí všechno ostatní.
const withRetry = async (run, { retries, retryDelayMs, isCancelled }) => {
  let res = await run();
  for (let attempt = 0; attempt < retries && isTransient(res); attempt += 1) {
    await wait(retryDelayMs * (2 ** attempt));
    if (isCancelled?.()) return { data: null, error: CANCELLED };
    res = await run();
  }
  return res;
};

/**
 * Přečte všechny řádky po částech podle klíče: každá další část začíná za posledním klíčem té předchozí. Na rozdíl od
 * čtení po offsetu nezpomaluje s číslem části (databáze nemusí přeskakovat a znovu počítat řádky před začátkem části)
 * a kniha vložená nebo smazaná mezi dvěma částmi nic neposune ani nezdvojí.
 *
 * buildQuery(after, limit) vrátí dotaz seřazený podle `key` (vzestupně, klíč musí být v rámci dotazu jedinečný) s
 * limitem a, je-li after různé od null, s podmínkou key > after. Skončí, když část není plná, takže počítá s tím, že
 * databáze vrací najednou aspoň pageSize řádků (Supabase standardně 1000). Při chybě vrací { data: null, error }.
 */
export const fetchAllByKey = async (buildQuery, {
  key = 'id', pageSize = FETCH_PAGE, maxPages = MAX_PAGES, retries = 2, retryDelayMs = 300, isCancelled, onPage,
} = {}) => {
  const rows = [];
  let after = null;
  for (let page = 0; page < maxPages; page += 1) {
    if (isCancelled?.()) return { data: null, error: CANCELLED };
    const res = await withRetry(() => buildQuery(after, pageSize), { retries, retryDelayMs, isCancelled });
    if (res.error) return { data: null, error: res.error };
    const chunk = Array.isArray(res.data) ? res.data : [];
    for (const row of chunk) rows.push(row);
    if (onPage) onPage(rows.length);
    if (chunk.length < pageSize) return { data: rows, error: null };
    after = chunk[chunk.length - 1][key];
  }
  console.warn(`Načítání se zastavilo po ${maxPages} částech, zbytek se nenačetl.`);
  return { data: rows, error: null };
};

/**
 * Totéž čtením po offsetu (.range): jen pro dotazy, které nemají jedinečný jednopolový klíč (záložní počítání lajků).
 * buildQuery(from, to) musí vracet dotaz se stabilním řazením, jinak by se části mohly překrývat.
 */
export const fetchAllRows = async (buildQuery, { pageSize = FETCH_PAGE, maxPages = MAX_PAGES, isCancelled } = {}) => {
  const rows = [];
  for (let page = 0; page < maxPages; page += 1) {
    if (isCancelled?.()) return { data: null, error: CANCELLED };
    const from = page * pageSize;
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    if (error) return { data: null, error };
    const chunk = Array.isArray(data) ? data : [];
    for (const row of chunk) rows.push(row);
    if (chunk.length < pageSize) break;
  }
  return { data: rows, error: null };
};

const embeddedLikes = (row) => Number(Array.isArray(row.book_likes) ? row.book_likes[0]?.count : 0) || 0;

// Dotaz seřazený podle klíče s limitem a podmínkou "za posledním klíčem" (viz fetchAllByKey). Každá část dostane nový
// objekt client.from(...): supabase-js skládá dotaz přímo do sdílené adresy, takže by se podmínky z předchozích částí
// nasčítaly.
const keyset = (from, select, key, filter) => (after, limit) => {
  let q = filter(from().select(select)).order(key).limit(limit);
  if (after != null) q = q.gt(key, after);
  return q;
};

/**
 * Surová data katalogu pro přihlášeného čtenáře: rows = řádky tabulky books, userBooks = jeho licence a čtení,
 * likes = { count(řádek knihy), liked(id knihy) } (počet skutečných lajků a zda dal lajk on) a coins (nebo null).
 *
 * Selhání čtení knih nebo licencí čtenáře se vyhazuje (špatné vlastnictví by bylo horší než chyba s tlačítkem
 * "Zkusit znovu"); chybějící vlastní lajky a zůstatek se berou jako prázdné. Možnosti: isCancelled() přeruší
 * načítání mezi částmi (vyhodí chybu, kterou pozná isCancelledError), onProgress(n) hlásí, kolik knih už je načteno.
 */
export const loadCatalog = async (client, userId, { isCancelled, onProgress, retries, retryDelayMs } = {}) => {
  const opts = { isCancelled, retries, retryDelayMs };
  const readBooks = (select) => fetchAllByKey(
    keyset(() => client.from('books'), select, 'id', (q) => q),
    { ...opts, key: 'id', onPage: onProgress },
  );

  const [booksFirst, userBooksRes, likedRes, profileRes] = await Promise.all([
    readBooks('*, book_likes(count)'),
    fetchAllByKey(
      keyset(() => client.from('user_books'), 'book_id, is_read, status, updated_at, scroll_position', 'book_id', (q) => q.eq('user_id', userId)),
      { ...opts, key: 'book_id' },
    ),
    fetchAllByKey(keyset(() => client.from('book_likes'), 'book_id', 'book_id', (q) => q.eq('user_id', userId)), { ...opts, key: 'book_id' }),
    client.from('profiles').select('coins').eq('id', userId).maybeSingle(),
  ]);

  for (const res of [booksFirst, userBooksRes, likedRes]) if (isCancelledError(res.error)) throw res.error;
  if (userBooksRes.error) throw userBooksRes.error;
  if (likedRes.error) console.warn('Vlastní lajky se nepodařilo načíst:', likedRes.error.message);

  // Kdyby databáze počítání lajků přímo u knihy neuměla, vrátí se starý postup: knihy zvlášť a lajky zvlášť.
  let booksRes = booksFirst;
  let likeCounts = null;
  if (booksRes.error) {
    if (!isEmbedProblem(booksRes.error)) throw booksRes.error;
    console.warn('Počty lajků u knih nejdou načíst najednou, použije se záložní postup:', booksRes.error.message);
    booksRes = await readBooks('*');
    if (booksRes.error) throw booksRes.error;
    // Do výběru stačí book_id (řadí se podle book_id a user_id, ale id čtenářů se nestahují).
    const allLikes = await fetchAllRows((from, to) => client.from('book_likes').select('book_id').order('book_id').order('user_id').range(from, to), { isCancelled });
    if (isCancelledError(allLikes.error)) throw allLikes.error;
    likeCounts = new Map();
    for (const l of allLikes.data || []) likeCounts.set(l.book_id, (likeCounts.get(l.book_id) || 0) + 1);
  }

  const liked = new Set((likedRes.data || []).map((l) => l.book_id));
  return {
    rows: booksRes.data || [],
    userBooks: userBooksRes.data || [],
    likes: { count: (row) => (likeCounts ? likeCounts.get(row.id) || 0 : embeddedLikes(row)), liked: (id) => liked.has(id) },
    coins: profileRes?.data ? profileRes.data.coins || 0 : null,
  };
};

/** Knihy knihovny (v základním pořadí) a zůstatek čtenáře. Možnosti stejné jako u loadCatalog. */
export const loadLibrary = async (client, userId, options) => {
  const { rows, userBooks, likes, coins } = await loadCatalog(client, userId, options);
  const byBook = new Map(userBooks.map((ub) => [ub.book_id, ub]));
  const books = canonicalizeGenres(rows.map((row) => toLibraryBook(row, {
    userId,
    userBook: byBook.get(row.id) || null,
    liked: likes.liked(row.id),
    realLikes: likes.count(row),
  })));
  return { books: orderLibrary(books), coins };
};
