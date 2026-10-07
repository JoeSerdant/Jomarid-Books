// Načtení dat knihovny. Databáze vrací najednou jen omezený počet řádků (u Supabase standardně 1000), takže se
// všechno čte po částech; počty lajků se berou jako jedno číslo u každé knihy, ne jako seznam všech lajků všech
// čtenářů (ten by s rostoucím počtem knih a čtenářů rostl bez omezení).

import { orderLibrary, toLibraryBook } from './libraryModel.js';

const FETCH_PAGE = 500;
const MAX_PAGES = 100;

/**
 * Přečte všechny řádky dotazu po částech. buildQuery(from, to) vrátí dotaz s .range(from, to) (a se stabilním
 * řazením, jinak by se části mohly překrývat). Skončí, když část není plná. Při chybě vrací { data: null, error }.
 */
export const fetchAllRows = async (buildQuery, { pageSize = FETCH_PAGE, maxPages = MAX_PAGES } = {}) => {
  const rows = [];
  for (let page = 0; page < maxPages; page += 1) {
    const from = page * pageSize;
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    if (error) return { data: null, error };
    const chunk = Array.isArray(data) ? data : [];
    for (const row of chunk) rows.push(row);
    if (chunk.length < pageSize) break;
  }
  return { data: rows, error: null };
};

const embeddedLikes = (row) => {
  const n = Number(Array.isArray(row.book_likes) ? row.book_likes[0]?.count : 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Knihy, vztah přihlášeného čtenáře k nim a jeho zůstatek. Vrací { books (v základním pořadí), coins (nebo null) }.
 * Chyba při čtení samotných knih se vyhazuje; chybějící údaje o čtenáři (user_books, lajky, zůstatek) se tiše
 * berou jako prázdné, stejně jako dřív.
 */
export const loadLibrary = async (client, userId) => {
  const readBooks = (select) => fetchAllRows((from, to) => client.from('books').select(select).order('id').range(from, to));

  const [booksFirst, userBooksRes, likedRes, profileRes] = await Promise.all([
    readBooks('*, book_likes(count)'),
    fetchAllRows((from, to) => client.from('user_books')
      .select('book_id, is_read, status, updated_at, scroll_position').eq('user_id', userId).order('book_id').range(from, to)),
    fetchAllRows((from, to) => client.from('book_likes').select('book_id').eq('user_id', userId).order('book_id').range(from, to)),
    client.from('profiles').select('coins').eq('id', userId).maybeSingle(),
  ]);

  // Kdyby databáze počítání lajků přímo u knihy neuměla, vrátí se starý postup: knihy zvlášť a všechny lajky zvlášť.
  let booksRes = booksFirst;
  let likeCounts = null;
  if (booksRes.error) {
    booksRes = await readBooks('*');
    if (booksRes.error) throw booksRes.error;
    const allLikes = await fetchAllRows((from, to) => client.from('book_likes').select('book_id, user_id').order('book_id').order('user_id').range(from, to));
    likeCounts = new Map();
    for (const l of allLikes.data || []) likeCounts.set(l.book_id, (likeCounts.get(l.book_id) || 0) + 1);
  }

  const userBooks = new Map((userBooksRes.data || []).map((ub) => [ub.book_id, ub]));
  const liked = new Set((likedRes.data || []).map((l) => l.book_id));

  const books = orderLibrary((booksRes.data || []).map((row) => toLibraryBook(row, {
    userId,
    userBook: userBooks.get(row.id) || null,
    liked: liked.has(row.id),
    realLikes: likeCounts ? likeCounts.get(row.id) || 0 : embeddedLikes(row),
  })));

  return { books, coins: profileRes?.data ? profileRes.data.coins || 0 : null };
};
