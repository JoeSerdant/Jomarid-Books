// Co o chuti čtenáře říkají jeho knihy: přečtené, rozečtené a olajkované (žánry a autoři) pro přizpůsobení feedu shortB.
// Čte jen knihy, ke kterým čtenář něco udělal, ne celý katalog. Při chybě vrací prázdný seznam: feed pak jede jen podle shortB.
import { cleanGenres } from '../browse/libraryModel.js';

const CHUNK = 100;       // id v jednom dotazu (adresa dotazu má omezenou délku)
const MAX_BOOKS = 500;

/** [{ authorId, genres, isRead, liked, inProgress }] pro buildPreferences. */
export async function loadBookTaste(client, userId) {
  try {
    const [ub, likes] = await Promise.all([
      client.from('user_books').select('book_id, is_read, scroll_position').eq('user_id', userId).limit(1000),
      client.from('book_likes').select('book_id').eq('user_id', userId).limit(1000),
    ]);
    if (ub.error) throw ub.error;
    const liked = new Set((likes.error ? [] : likes.data || []).map((l) => l.book_id));
    const state = new Map();
    for (const row of ub.data || []) {
      if (!row?.book_id) continue;
      const read = row.is_read === true;
      const progress = Number(row.scroll_position) > 0;
      if (read || progress || liked.has(row.book_id)) state.set(row.book_id, { isRead: read, inProgress: !read && progress });
    }
    for (const id of liked) if (!state.has(id)) state.set(id, { isRead: false, inProgress: false });

    const ids = [...state.keys()].slice(0, MAX_BOOKS);
    const out = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await client.from('books').select('id, author_id, genres').in('id', ids.slice(i, i + CHUNK));
      if (error) throw error;
      for (const b of data || []) {
        const st = state.get(b.id);
        if (st) out.push({ authorId: b.author_id || null, genres: cleanGenres(Array.isArray(b.genres) ? b.genres : []), isRead: st.isRead, liked: liked.has(b.id), inProgress: st.inProgress });
      }
    }
    return out;
  } catch (err) {
    console.warn('Chuť podle knih se nepodařilo načíst:', err?.message || err);
    return [];
  }
}
