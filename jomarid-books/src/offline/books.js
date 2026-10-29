// Stažené knihy: stažení ze serveru, šifrované uložení v zařízení, otevření offline, obnova licence a úklid.
// Co je v záznamu knihy (store "books", klíč uživatel:kniha):
//   meta     - nezašifrované údaje pro výpis a řízení: název, autor, kdy staženo, velikost, pozice čtení
//   content  - zašifrované: řádek knihy a její text
//   notes    - zašifrované: záložky, zvýraznění, poznámky, hodnocení (osobní, a často se mění, proto zvlášť od velkého textu)
//   license  - zašifrované: do kdy jde kniha otevřít bez serveru (změna data by rozbila šifru)
import { STORES } from './store.js';
import { aadFor, getDeviceKey, open as openSealed, resetClock, seal, trustedNow } from './crypto.js';
import { LICENSE_MS, MAX_BOOKS, MAX_TEXT_CHARS, bookKey, canReadBook, emptyNotes, isLocalId, sortHighlights } from './model.js';
import { fetchBookText } from '../bookText/bookText.js';

export class OfflineBookError extends Error {
  constructor(code, message) { super(message); this.name = 'OfflineBookError'; this.code = code; }
}
export const OFFLINE_ERRORS = {
  no_access: 'K téhle knize nemáš aktivní licenci, stáhnout ji nejde.',
  no_text: 'Text knihy se nepodařilo načíst. Zkus to znovu.',
  too_big: 'Kniha je na stažení moc velká.',
  too_many: 'Na zařízení máš stažený maximální počet knih. Nějakou smaž a zkus to znovu.',
  network: 'Stažení se nepovedlo, zkontroluj připojení a zkus to znovu.',
  not_found: 'Knihu se nepodařilo najít.',
  storage: 'Na zařízení není místo, nebo je ukládání zakázané. Smaž něco a zkus to znovu.',
};
const fail = (code) => new OfflineBookError(code, OFFLINE_ERRORS[code]);

const need = (res) => { if (res?.error) throw res.error; return res; };

export function createOfflineBooks({ store, client, now = Date.now }) {
  const rec = (userId, bookId) => store.get(STORES.books, bookKey(userId, bookId));
  const put = (userId, bookId, value) => store.put(STORES.books, bookKey(userId, bookId), value);

  // Zápisy do jedné knihy po jednom (rychlé změny za sebou se nepřepíšou starším stavem).
  const chains = new Map();
  const serial = (k, fn) => { const prev = chains.get(k) || Promise.resolve(); const run = prev.then(fn, fn); chains.set(k, run.catch(() => {})); return run; };

  const sealParts = async (key, userId, bookId, { book, content, notes, expiresAt }) => ({
    content: book !== undefined ? await seal(key, { book, content }, aadFor(userId, bookId, 'content')) : undefined,
    notes: notes ? await seal(key, notes, aadFor(userId, bookId, 'notes')) : undefined,
    license: expiresAt ? await seal(key, { expiresAt }, aadFor(userId, bookId, 'license')) : undefined,
  });

  const metaOf = (book, content, userBook, expiresAt, t, oldMeta) => ({
    id: book.id,
    title: book.title || 'Bez názvu',
    author: book.author_display || book.author || book.pen_name || '',
    chars: content.length,
    downloadedAt: oldMeta?.downloadedAt ?? t,
    refreshedAt: t,
    expiresAt,
    bookUpdatedAt: book.updated_at || null,
    hadRow: !!userBook,
    percent: Number(userBook?.scroll_position) || oldMeta?.percent || 0,
    isRead: !!(userBook?.is_read || oldMeta?.isRead),
  });

  // Stáhne knihu pro čtení offline. Ověří právo na knihu (stejně jako čtečka), stáhne text, záložky, zvýraznění a hodnocení, zašifruje a uloží.
  async function download(user, bookId) {
    const uid = user.id;
    let book; let userBook; let text; let notes;
    try {
      book = need(await client.from('books').select('*').eq('id', bookId).single()).data;
      userBook = need(await client.from('user_books').select('scroll_position, status, is_read').eq('user_id', uid).eq('book_id', bookId).maybeSingle()).data;
      if (!book) throw fail('not_found');
      if (!canReadBook(book, userBook, uid)) throw fail('no_access');
      const [t, bm, rt, hl] = await Promise.all([
        fetchBookText(client, bookId),
        client.from('book_bookmarks').select('id, label, scroll_position, created_at').eq('user_id', uid).eq('book_id', bookId).order('created_at', { ascending: false }),
        client.from('book_ratings').select('rating').eq('user_id', uid).eq('book_id', bookId).maybeSingle(),
        client.from('book_highlights').select('id, start_offset, end_offset, color, note').eq('user_id', uid).eq('book_id', bookId).order('start_offset', { ascending: true }),
      ]);
      if (t.error || typeof t.text !== 'string') throw fail('no_text');
      text = t.text;
      notes = { bookmarks: bm.data || [], highlights: hl.data || [], rating: rt.data?.rating || 0 };
    } catch (e) {
      if (e instanceof OfflineBookError) throw e;
      throw fail('network');
    }
    if (text.length > MAX_TEXT_CHARS) throw fail('too_big');
    const existing = await rec(uid, bookId);
    if (!existing && (await list(uid)).length >= MAX_BOOKS) throw fail('too_many');
    return serial(bookKey(uid, bookId), async () => {
      try {
        const key = await getDeviceKey(store);
        const t = await resetClock(store, now());
        const expiresAt = t + LICENSE_MS;
        const sealed = await sealParts(key, uid, bookId, { book, content: text, notes, expiresAt });
        const meta = metaOf(book, text, userBook, expiresAt, t, existing?.meta);
        await put(uid, bookId, { meta, content: sealed.content, notes: sealed.notes, license: sealed.license });
        return meta;
      } catch (e) { if (e instanceof OfflineBookError) throw e; throw fail('storage'); }
    });
  }

  async function list(userId) {
    return (await store.all(STORES.books)).filter((e) => e.value?.meta && e.key.startsWith(`${userId}:`)).map((e) => e.value.meta)
      .sort((a, b) => String(a.title).localeCompare(String(b.title), 'cs'));
  }
  const has = async (userId, bookId) => !!(await rec(userId, bookId))?.meta;
  const getMeta = async (userId, bookId) => (await rec(userId, bookId))?.meta || null;

  // Otevře stažené: { book, content, notes, meta } nebo { expired: true, meta }. Chybu šifry (cizí účet, poškozená data) vyhodí.
  async function openBook(userId, bookId) {
    const r = await rec(userId, bookId);
    if (!r?.meta) return null;
    const key = await getDeviceKey(store);
    const lic = await openSealed(key, r.license, aadFor(userId, bookId, 'license'));
    const t = await trustedNow(store, now());
    if (t >= Number(lic.expiresAt)) return { expired: true, meta: r.meta };
    const { book, content } = await openSealed(key, r.content, aadFor(userId, bookId, 'content'));
    const notes = { ...emptyNotes(), ...(await openSealed(key, r.notes, aadFor(userId, bookId, 'notes'))) };
    return { book, content, notes, meta: r.meta, expiresAt: Number(lic.expiresAt) };
  }

  // ---- Změny uložené kopie (offline i zrcadlení toho, co proběhlo online) ----
  const mutateNotes = (userId, bookId, fn) => serial(bookKey(userId, bookId), async () => {
    const r = await rec(userId, bookId);
    if (!r?.meta) return null;
    const key = await getDeviceKey(store);
    const notes = { ...emptyNotes(), ...(await openSealed(key, r.notes, aadFor(userId, bookId, 'notes'))) };
    const next = fn(notes) || notes;
    await put(userId, bookId, { ...r, notes: await seal(key, next, aadFor(userId, bookId, 'notes')) });
    return next;
  });
  const mutateMeta = (userId, bookId, fn) => serial(bookKey(userId, bookId), async () => {
    const r = await rec(userId, bookId);
    if (!r?.meta) return null;
    await put(userId, bookId, { ...r, meta: { ...r.meta, ...fn(r.meta) } });
    return true;
  });

  const local = {
    addBookmark: (u, b, row) => mutateNotes(u, b, (n) => ({ ...n, bookmarks: [row, ...n.bookmarks.filter((x) => x.id !== row.id)] })),
    deleteBookmark: (u, b, id) => mutateNotes(u, b, (n) => ({ ...n, bookmarks: n.bookmarks.filter((x) => x.id !== id) })),
    addHighlight: (u, b, row) => mutateNotes(u, b, (n) => ({ ...n, highlights: sortHighlights([...n.highlights.filter((x) => x.id !== row.id), row]) })),
    setNote: (u, b, id, note) => mutateNotes(u, b, (n) => ({ ...n, highlights: n.highlights.map((h) => (h.id === id ? { ...h, note: note || null } : h)) })),
    deleteHighlight: (u, b, id) => mutateNotes(u, b, (n) => ({ ...n, highlights: n.highlights.filter((x) => x.id !== id) })),
    setRating: (u, b, rating) => mutateNotes(u, b, (n) => ({ ...n, rating })),
    setProgress: (u, b, percent, isRead) => mutateMeta(u, b, (m) => ({ percent, isRead: !!(isRead || m.isRead) })),
    // server přijal dočasnou položku a dal jí skutečné id
    remap: (u, b, localId, row, kind) => mutateNotes(u, b, (n) => (kind === 'bookmark'
      ? { ...n, bookmarks: n.bookmarks.map((x) => (x.id === localId ? row : x)) }
      : { ...n, highlights: sortHighlights(n.highlights.map((x) => (x.id === localId ? row : x))) })),
  };

  // Čtečka otevřela knihu online: uložená kopie dostane čerstvé záložky, zvýraznění, hodnocení a pozici ze serveru (a text, když se změnil).
  // Položky vytvořené offline, které ještě čekají na odeslání, zůstanou.
  async function syncFromServer(userId, bookId, fresh) {
    return serial(bookKey(userId, bookId), async () => {
      const r = await rec(userId, bookId);
      if (!r?.meta) return false;
      const key = await getDeviceKey(store);
      const t = await resetClock(store, now());
      const old = await openSealed(key, r.notes, aadFor(userId, bookId, 'notes')).catch(() => emptyNotes());
      const keepBm = (old.bookmarks || []).filter((x) => isLocalId(x.id));
      const keepHl = (old.highlights || []).filter((x) => isLocalId(x.id));
      const notes = { bookmarks: [...keepBm, ...(fresh.bookmarks || [])], highlights: sortHighlights([...(fresh.highlights || []), ...keepHl]), rating: fresh.rating ?? old.rating ?? 0 };
      const next = { ...r, notes: await seal(key, notes, aadFor(userId, bookId, 'notes')) };
      let meta = { ...r.meta, refreshedAt: t, expiresAt: t + LICENSE_MS };
      if (fresh.userBook) meta = { ...meta, hadRow: true, percent: Number(fresh.userBook.scroll_position) || meta.percent, isRead: !!(fresh.userBook.is_read || meta.isRead) };
      if (typeof fresh.content === 'string' && fresh.book && (fresh.content.length !== r.meta.chars || (fresh.book.updated_at || null) !== r.meta.bookUpdatedAt)) {
        next.content = await seal(key, { book: fresh.book, content: fresh.content }, aadFor(userId, bookId, 'content'));
        meta = { ...meta, chars: fresh.content.length, title: fresh.book.title || meta.title, bookUpdatedAt: fresh.book.updated_at || null };
      }
      next.license = await seal(key, { expiresAt: meta.expiresAt }, aadFor(userId, bookId, 'license'));
      next.meta = meta;
      await put(userId, bookId, next);
      return true;
    });
  }

  // Po připojení: u každé stažené knihy se ověří právo (licence mohla být odebrána) a prodlouží platnost. Kniha, na kterou už čtenář právo nemá, se z
  // zařízení smaže. Vrací { renewed, removed, failed }.
  async function refreshAll(user) {
    const out = { renewed: 0, removed: 0, failed: 0 };
    for (const meta of await list(user.id)) {
      try {
        const book = need(await client.from('books').select('id, author_id, is_auto_assigned, updated_at, title').eq('id', meta.id).maybeSingle()).data;
        const ub = need(await client.from('user_books').select('status, scroll_position, is_read').eq('user_id', user.id).eq('book_id', meta.id).maybeSingle()).data;
        if (!book || !canReadBook(book, ub, user.id)) { await remove(user.id, meta.id); out.removed += 1; continue; }
        if (book.updated_at && book.updated_at !== meta.bookUpdatedAt) { await download(user, meta.id); } // text nebo údaje se změnily: znovu
        else {
          const t = await resetClock(store, now());
          await serial(bookKey(user.id, meta.id), async () => {
            const r = await rec(user.id, meta.id); if (!r?.meta) return;
            const key = await getDeviceKey(store);
            const expiresAt = t + LICENSE_MS;
            await put(user.id, meta.id, { ...r, meta: { ...r.meta, refreshedAt: t, expiresAt }, license: await seal(key, { expiresAt }, aadFor(user.id, meta.id, 'license')) });
          });
        }
        out.renewed += 1;
      } catch { out.failed += 1; }
    }
    return out;
  }

  async function remove(userId, bookId) { await store.del(STORES.books, bookKey(userId, bookId)); }
  async function removeAll() { await store.wipe(); }

  // Kolik místa stažené knihy zabírají (odhad podle délky textu: znak je v UTF-8 nejvýš ~2 bajty, šifra nic nepřidá)
  const usage = async (userId) => (await list(userId)).reduce((s, m) => s + m.chars * 2, 0);

  return { download, list, has, getMeta, open: openBook, local, syncFromServer, refreshAll, remove, removeAll, usage };
}
