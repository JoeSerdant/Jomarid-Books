// Zápisy čtečky (pozice, záložky, zvýraznění, poznámky, hodnocení) s ohledem na offline:
//   online            - jde se na server stejně jako dřív; u stažené knihy se výsledek zrcadlí do uložené kopie a při výpadku sítě se změna uloží do fronty
//   offline (kopie)   - změna se uloží do kopie v zařízení a do fronty, po připojení ji odešle outbox.flush
// Tvar vrácených položek je stejný jako ze serveru, takže čtečka mezi režimy nerozlišuje.
import { LOCAL_PREFIX, isLocalId, isTransientError } from './model.js';

const localId = () => `${LOCAL_PREFIX}${(globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`)}`;
const need = (res) => { if (res?.error) throw res.error; return res; };

export function createReaderBackend({ client, books, outbox, userId, bookId, mode, hasCopy, now = Date.now }) {
  const offline = mode === 'offline';
  const copy = !!hasCopy;
  // Zkusí server; při výpadku sítě u stažené knihy předá práci offline větvi (ta změnu uloží lokálně a do fronty).
  const viaServer = async (online, fallback) => {
    if (offline) return fallback();
    try { return await online(); } catch (e) { if (copy && isTransientError(e)) return fallback(); throw e; }
  };
  const queue = (op) => outbox.enqueue({ userId, bookId, ...op });

  return {
    mode, offline,

    // needsStatus: úplně první uložení pro tuhle dvojici čtenář + kniha (řádek ještě neexistuje), jen tehdy se posílá status 'active'
    async savePosition(percent, isRead, { needsStatus = false } = {}) {
      if (copy) await books.local.setProgress(userId, bookId, percent, isRead);
      return viaServer(async () => {
        const payload = { user_id: userId, book_id: bookId, scroll_position: percent, is_read: isRead, updated_at: new Date(now()).toISOString() };
        if (needsStatus) payload.status = 'active';
        need(await client.from('user_books').upsert(payload, { onConflict: 'user_id,book_id' }));
        return 'server';
      }, async () => { await queue({ type: 'position', percent, isRead, at: now() }); return 'queued'; });
    },

    async addBookmark(label, percent) {
      return viaServer(async () => {
        const row = need(await client.from('book_bookmarks').insert([{ user_id: userId, book_id: bookId, label, scroll_position: percent }]).select('id, label, scroll_position, created_at').single()).data;
        if (copy) await books.local.addBookmark(userId, bookId, row);
        return row;
      }, async () => {
        const row = { id: localId(), label, scroll_position: percent, created_at: new Date(now()).toISOString() };
        await books.local.addBookmark(userId, bookId, row);
        await queue({ type: 'bookmark_add', localId: row.id, label, percent });
        return row;
      });
    },

    async deleteBookmark(id) {
      if (isLocalId(id)) { if (copy) await books.local.deleteBookmark(userId, bookId, id); await queue({ type: 'bookmark_delete', id }); return; }
      return viaServer(async () => {
        need(await client.from('book_bookmarks').delete().eq('id', id));
        if (copy) await books.local.deleteBookmark(userId, bookId, id);
      }, async () => { await books.local.deleteBookmark(userId, bookId, id); await queue({ type: 'bookmark_delete', id }); });
    },

    async setRating(stars) {
      return viaServer(async () => {
        need(await client.from('book_ratings').upsert({ user_id: userId, book_id: bookId, rating: stars, updated_at: new Date(now()).toISOString() }, { onConflict: 'user_id,book_id' }));
        if (copy) await books.local.setRating(userId, bookId, stars);
      }, async () => { await books.local.setRating(userId, bookId, stars); await queue({ type: 'rating', rating: stars }); });
    },

    async addHighlight({ start, end, color }) {
      return viaServer(async () => {
        const row = need(await client.from('book_highlights').insert([{ user_id: userId, book_id: bookId, start_offset: start, end_offset: end, color }]).select('id, start_offset, end_offset, color, note').single()).data;
        if (copy) await books.local.addHighlight(userId, bookId, row);
        return row;
      }, async () => {
        const row = { id: localId(), start_offset: start, end_offset: end, color, note: null };
        await books.local.addHighlight(userId, bookId, row);
        await queue({ type: 'highlight_add', localId: row.id, start, end, color });
        return row;
      });
    },

    async setNote(id, note) {
      const value = note || null;
      if (isLocalId(id)) { if (copy) await books.local.setNote(userId, bookId, id, value); await queue({ type: 'highlight_note', id, note: value }); return; }
      return viaServer(async () => {
        need(await client.from('book_highlights').update({ note: value }).eq('id', id));
        if (copy) await books.local.setNote(userId, bookId, id, value);
      }, async () => { await books.local.setNote(userId, bookId, id, value); await queue({ type: 'highlight_note', id, note: value }); });
    },

    async deleteHighlight(id) {
      if (isLocalId(id)) { if (copy) await books.local.deleteHighlight(userId, bookId, id); await queue({ type: 'highlight_delete', id }); return; }
      return viaServer(async () => {
        need(await client.from('book_highlights').delete().eq('id', id));
        if (copy) await books.local.deleteHighlight(userId, bookId, id);
      }, async () => { await books.local.deleteHighlight(userId, bookId, id); await queue({ type: 'highlight_delete', id }); });
    },
  };
}
