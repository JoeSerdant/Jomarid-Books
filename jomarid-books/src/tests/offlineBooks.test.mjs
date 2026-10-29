// Testy stažených knih offline: šifrované uložení, otevření, platnost licence, fronta změn, odeslání po připojení a napojení v appce.
//   npm run test:offlinebooks
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryStore, STORES } from '../offline/store.js';
import { createOfflineBooks, OfflineBookError } from '../offline/books.js';
import { createOutbox } from '../offline/outbox.js';
import { createReaderBackend } from '../offline/readerBackend.js';
import { OfflineCryptoError, aadFor, getDeviceKey, open as openSealed, seal, trustedNow } from '../offline/crypto.js';
import { LICENSE_MS, MAX_BOOKS, canReadBook, daysLeft, isLocalId, isTransientError, resolvePosition } from '../offline/model.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8').replace(/\r\n/g, '\n');
const DAY = 86400000;
const T0 = Date.parse('2026-10-29T12:00:00Z');
const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

/* ---------------------------------------------------------------- napodobenina serveru (Supabase) */
function makeServer(initial = {}) {
  const db = {
    books: [{ id: 'b1', title: 'Tajná kniha', author_display: 'Jana Nováková', author_id: 'a1', is_auto_assigned: false, updated_at: 'v1' }],
    user_books: [{ user_id: 'u1', book_id: 'b1', status: 'active', scroll_position: 12, is_read: false, updated_at: '2026-10-01T00:00:00Z' }],
    book_bookmarks: [{ id: 'bm1', user_id: 'u1', book_id: 'b1', label: 'Začátek', scroll_position: 1, created_at: '2026-10-02T00:00:00Z' }],
    book_highlights: [{ id: 'h1', user_id: 'u1', book_id: 'b1', start_offset: 4, end_offset: 9, color: 'amber', note: 'poznámka k zvýraznění' }],
    book_ratings: [{ user_id: 'u1', book_id: 'b1', rating: 4 }],
    ...initial.db,
  };
  const texts = { b1: 'Dlouhý příběh o tajemném majáku, který nikdo nesmí přečíst bez licence.', ...initial.texts };
  const calls = [];
  const state = { down: false, failTable: null, rejectWith: null, nextId: 100 };
  const builder = (table) => {
    let op = 'select'; let payload = null; let single = false; let maybe = false; let onConflict = null; const filters = []; let sel = null;
    const exec = async () => {
      calls.push({ table, op, payload, filters: [...filters] });
      if (state.down) return { data: null, error: { message: 'TypeError: Failed to fetch', name: 'TypeError' } };
      if (state.rejectWith && state.rejectWith.table === table && state.rejectWith.op === op) return { data: null, error: state.rejectWith.error };
      const rows = db[table] || (db[table] = []);
      const match = (r) => filters.every(([k, v]) => String(r[k]) === String(v));
      const pick = (r) => (sel ? Object.fromEntries(sel.split(',').map((c) => c.trim()).filter((c) => c !== '*').map((c) => [c, r[c]])) : r);
      if (op === 'select') {
        const found = rows.filter(match).map((r) => (sel === '*' ? r : pick(r)));
        if (single) return found.length === 1 ? { data: found[0], error: null } : { data: null, error: { message: 'Row not found', code: 'PGRST116', status: 406 } };
        if (maybe) return { data: found[0] || null, error: null };
        return { data: found, error: null };
      }
      if (op === 'insert') {
        const row = { id: `srv${state.nextId++}`, created_at: '2026-10-29T12:00:00Z', ...payload[0] };
        rows.push(row);
        return single ? { data: pick(row), error: null } : { data: null, error: null };
      }
      if (op === 'upsert') {
        const keys = onConflict.split(',');
        const ex = rows.find((r) => keys.every((k) => r[k] === payload[k]));
        if (ex) Object.assign(ex, payload); else rows.push({ ...payload });
        return { data: null, error: null };
      }
      if (op === 'update') { rows.filter(match).forEach((r) => Object.assign(r, payload)); return { data: null, error: null }; }
      if (op === 'delete') { db[table] = rows.filter((r) => !match(r)); return { data: null, error: null }; }
      return { data: null, error: null };
    };
    const q = {
      select(cols) { if (op === 'select') sel = cols; else sel = cols; return q; },
      insert(p) { op = 'insert'; payload = p; return q; },
      upsert(p, o) { op = 'upsert'; payload = p; onConflict = o?.onConflict; return q; },
      update(p) { op = 'update'; payload = p; return q; },
      delete() { op = 'delete'; return q; },
      eq(k, v) { filters.push([k, v]); return q; },
      order() { return q; },
      single() { single = true; return q; },
      maybeSingle() { maybe = true; return q; },
      then(resolve, reject) { return exec().then(resolve, reject); },
    };
    return q;
  };
  const client = {
    from: builder,
    storage: { from: () => ({ download: async (p) => {
      calls.push({ table: 'storage', op: 'download', path: p });
      if (state.down) return { data: null, error: { message: 'TypeError: Failed to fetch', name: 'TypeError' } };
      const id = p.replace(/\.txt$/, '');
      return id in texts ? { data: new Blob([texts[id]]), error: null } : { data: null, error: { message: 'Object not found', statusCode: '404' } };
    } }) },
  };
  return { db, texts, calls, state, client };
}

const USER = { id: 'u1' };
function setup(opts = {}) {
  const server = makeServer(opts);
  const store = createMemoryStore();
  let clock = T0;
  const now = () => clock;
  const books = createOfflineBooks({ store, client: server.client, now });
  const outbox = createOutbox({ store, now });
  return { server, store, books, outbox, now, setClock: (t) => { clock = t; }, advance: (ms) => { clock += ms; } };
}
const bytesContain = (buf, text) => {
  const hay = Buffer.from(buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf);
  return hay.includes(Buffer.from(text, 'utf8'));
};
const allBytes = (rec) => Buffer.concat(['content', 'notes', 'license'].map((k) => Buffer.from(new Uint8Array(rec[k].data))));

/* ---------------------------------------------------------------- stažení a otevření */
test('stažení: kniha, záložky, zvýraznění a hodnocení se uloží zašifrované; text ani poznámky nejsou v zařízení čitelné', async () => {
  const { books, store } = setup();
  const meta = await books.download(USER, 'b1');
  assert.equal(meta.title, 'Tajná kniha'); assert.equal(meta.author, 'Jana Nováková');
  assert.equal(meta.expiresAt, T0 + LICENSE_MS); assert.equal(meta.percent, 12); assert.equal(meta.hadRow, true);
  const rec = await store.get(STORES.books, 'u1:b1');
  const bytes = allBytes(rec);
  for (const secret of ['tajemném majáku', 'Dlouhý příběh', 'poznámka k zvýraznění', 'Začátek', 'amber']) assert.ok(!bytes.includes(Buffer.from(secret)), `„${secret}“ nesmí být čitelné`);
  assert.ok(!JSON.stringify({ ...rec, content: undefined, notes: undefined, license: undefined }).includes('tajemném'), 'ani v nezašifrovaných údajích');
  const opened = await books.open('u1', 'b1');
  assert.equal(opened.content, 'Dlouhý příběh o tajemném majáku, který nikdo nesmí přečíst bez licence.');
  assert.equal(opened.book.title, 'Tajná kniha');
  assert.deepEqual(opened.notes.bookmarks.map((b) => b.label), ['Začátek']);
  assert.equal(opened.notes.highlights[0].note, 'poznámka k zvýraznění'); assert.equal(opened.notes.rating, 4);
  assert.equal(opened.expiresAt, T0 + LICENSE_MS);
});

test('stažení: bez práva na knihu se nestáhne nic; autor a automaticky přidělená kniha ano', async () => {
  const noRight = setup({ db: { user_books: [] } });
  await assert.rejects(noRight.books.download(USER, 'b1'), (e) => e instanceof OfflineBookError && e.code === 'no_access');
  assert.deepEqual(await noRight.books.list('u1'), []);
  assert.ok(!noRight.server.calls.some((c) => c.table === 'storage'), 'text se ani nestahuje');
  const inactive = setup({ db: { user_books: [{ user_id: 'u1', book_id: 'b1', status: 'revoked' }] } });
  await assert.rejects(inactive.books.download(USER, 'b1'), (e) => e.code === 'no_access');
  const author = setup({ db: { user_books: [], books: [{ id: 'b1', title: 'Moje', author_id: 'u1' }] } });
  assert.equal((await author.books.download(USER, 'b1')).title, 'Moje');
  const auto = setup({ db: { user_books: [], books: [{ id: 'b1', title: 'Dárek', author_id: 'x', is_auto_assigned: true }] } });
  assert.equal((await auto.books.download(USER, 'b1')).title, 'Dárek');
  assert.equal(canReadBook(null, null, 'u1'), false);
});

test('stažení: chybějící text, výpadek sítě, příliš mnoho knih a velikost mají srozumitelné chyby', async () => {
  const noText = setup({ texts: { b1: undefined } });
  delete noText.server.texts.b1;
  await assert.rejects(noText.books.download(USER, 'b1'), (e) => e.code === 'no_text');
  const down = setup(); down.server.state.down = true;
  await assert.rejects(down.books.download(USER, 'b1'), (e) => e.code === 'network');
  const many = setup();
  for (let i = 0; i < MAX_BOOKS; i += 1) await many.store.put(STORES.books, `u1:x${i}`, { meta: { id: `x${i}`, title: `K${i}`, chars: 1 } });
  await assert.rejects(many.books.download(USER, 'b1'), (e) => e.code === 'too_many');
  await many.books.remove('u1', 'x0');
  assert.equal((await many.books.download(USER, 'b1')).id, 'b1', 'po smazání jedné se vejde');
  assert.equal(many.books.download.length, 2);
});

test('znovu stažená kniha přepíše starou (jedna kopie), seznam je po názvu a po účtech', async () => {
  const { books, server } = setup({ db: { books: [{ id: 'b1', title: 'Ž kniha', author_id: 'a', updated_at: 'v1' }, { id: 'b2', title: 'A kniha', author_id: 'a', updated_at: 'v1' }], user_books: [{ user_id: 'u1', book_id: 'b1', status: 'active' }, { user_id: 'u1', book_id: 'b2', status: 'active' }, { user_id: 'u2', book_id: 'b1', status: 'active' }] }, texts: { b1: 'a', b2: 'b' } });
  await books.download(USER, 'b1'); await books.download(USER, 'b2'); await books.download(USER, 'b1');
  assert.deepEqual((await books.list('u1')).map((m) => m.title), ['A kniha', 'Ž kniha']);
  await books.download({ id: 'u2' }, 'b1');
  assert.equal((await books.list('u1')).length, 2); assert.equal((await books.list('u2')).length, 1);
  assert.equal(await books.has('u2', 'b2'), false); assert.ok(server.calls.length > 0);
});

/* ---------------------------------------------------------------- šifra: vázání na účet a knihu, poškození */
test('šifra: kopie přenesená k jinému čtenáři nebo na jinou knihu se nerozšifruje, poškozená data také', async () => {
  const { books, store } = setup({ db: { books: [{ id: 'b1', title: 'A', author_id: 'a' }, { id: 'b2', title: 'B', author_id: 'a' }], user_books: [{ user_id: 'u1', book_id: 'b1', status: 'active' }, { user_id: 'u1', book_id: 'b2', status: 'active' }] }, texts: { b1: 'první', b2: 'druhá' } });
  await books.download(USER, 'b1'); await books.download(USER, 'b2');
  const rec1 = await store.get(STORES.books, 'u1:b1'); const rec2 = await store.get(STORES.books, 'u1:b2');
  await store.put(STORES.books, 'u2:b1', rec1);
  await assert.rejects(books.open('u2', 'b1'), OfflineCryptoError);                       // jiný čtenář
  await store.put(STORES.books, 'u1:b1', { ...rec1, content: rec2.content });
  await assert.rejects(books.open('u1', 'b1'), OfflineCryptoError);                       // text jiné knihy
  await store.put(STORES.books, 'u1:b1', { ...rec1, license: rec2.license });
  await assert.rejects(books.open('u1', 'b1'), OfflineCryptoError);                       // licence jiné knihy (nejde si prodloužit platnost)
  const flipped = new Uint8Array(rec1.content.data.slice(0)); flipped[5] ^= 1;
  await store.put(STORES.books, 'u1:b1', { ...rec1, content: { ...rec1.content, data: flipped.buffer } });
  await assert.rejects(books.open('u1', 'b1'), OfflineCryptoError);                       // změněný bajt
  await store.put(STORES.books, 'u1:b1', rec1);
  assert.equal((await books.open('u1', 'b1')).content, 'první');
  assert.equal(await books.open('u1', 'nikdy'), null, 'nestažená kniha je null');
});

test('šifra: jiný klíč zařízení (smazaná databáze) nic neotevře; seal a open drží AAD i tvar', async () => {
  const a = createMemoryStore(); const b = createMemoryStore();
  const ka = await getDeviceKey(a); const kb = await getDeviceKey(b);
  assert.equal(await getDeviceKey(a), ka, 'klíč zařízení se vytvoří jednou');
  const s = await seal(ka, { x: 'č' }, aadFor('u', 'b', 'notes'));
  assert.deepEqual(await openSealed(ka, s, aadFor('u', 'b', 'notes')), { x: 'č' });
  await assert.rejects(openSealed(kb, s, aadFor('u', 'b', 'notes')), OfflineCryptoError);
  await assert.rejects(openSealed(ka, s, aadFor('u', 'b', 'content')), OfflineCryptoError);
  await assert.rejects(openSealed(ka, null, 'x'), OfflineCryptoError);
  await assert.rejects(openSealed(ka, { v: 2, iv: s.iv, data: s.data }, aadFor('u', 'b', 'notes')), OfflineCryptoError);
  const s2 = await seal(ka, { x: 'č' }, aadFor('u', 'b', 'notes'));
  assert.notDeepEqual(Buffer.from(new Uint8Array(s.data)), Buffer.from(new Uint8Array(s2.data)), 'stejný obsah se pokaždé zašifruje jinak (nový iv)');
  assert.equal(ka.extractable, false, 'klíč zařízení nejde vyexportovat');
});

/* ---------------------------------------------------------------- platnost licence */
test('licence: po 30 dnech bez připojení se kniha zamkne, přetočení hodin zpět ji neodemkne, připojení ji prodlouží', async () => {
  const { books, store, advance, setClock, now } = setup();
  await books.download(USER, 'b1');
  advance(29 * DAY); assert.ok(!(await books.open('u1', 'b1')).expired, 'den před koncem ještě platí');
  assert.equal(daysLeft((await books.getMeta('u1', 'b1')).expiresAt, now()), 1);
  advance(2 * DAY); const locked = await books.open('u1', 'b1');
  assert.equal(locked.expired, true); assert.equal(locked.content, undefined, 'zamčená kniha neukáže text');
  setClock(T0 + DAY);                                      // čtenář přetočí hodiny zpět
  assert.equal((await books.open('u1', 'b1')).expired, true, 'pořád zamčená');
  assert.equal(await trustedNow(store, T0), T0 + 31 * DAY, 'hodiny, kterým se věří, nejdou zpět');
  const res = await books.refreshAll(USER);              // připojení: server potvrdí licenci
  assert.deepEqual(res, { renewed: 1, removed: 0, failed: 0 });
  const again = await books.open('u1', 'b1');
  assert.ok(!again.expired); assert.equal(again.expiresAt, T0 + DAY + LICENSE_MS);
});

test('refreshAll: odebraná licence smaže kopii, změněná kniha se stáhne znovu, výpadek sítě nic nesmaže', async () => {
  const s = setup({ db: { books: [{ id: 'b1', title: 'A', author_id: 'a', updated_at: 'v1' }, { id: 'b2', title: 'B', author_id: 'a', updated_at: 'v1' }, { id: 'b3', title: 'C', author_id: 'a', updated_at: 'v1' }], user_books: ['b1', 'b2', 'b3'].map((b) => ({ user_id: 'u1', book_id: b, status: 'active' })) }, texts: { b1: 'text jedna', b2: 'text dva', b3: 'text tři' } });
  for (const id of ['b1', 'b2', 'b3']) await s.books.download(USER, id);
  s.server.db.user_books.find((r) => r.book_id === 'b1').status = 'revoked';     // správce odebral licenci
  s.server.db.books.find((r) => r.id === 'b2').updated_at = 'v2'; s.server.texts.b2 = 'nový text dva';
  const res = await s.books.refreshAll(USER);
  assert.deepEqual(res, { renewed: 2, removed: 1, failed: 0 });
  assert.equal(await s.books.has('u1', 'b1'), false, 'bez licence se kniha smaže ze zařízení');
  assert.equal((await s.books.open('u1', 'b2')).content, 'nový text dva');
  s.server.state.down = true;
  const offline = await s.books.refreshAll(USER);
  assert.deepEqual(offline, { renewed: 0, removed: 0, failed: 2 });
  assert.equal(await s.books.has('u1', 'b2'), true, 'výpadek sítě kopii nesmaže');
});

test('odhlášení: wipe smaže všechno včetně klíče zařízení a fronty', async () => {
  const { books, outbox, store } = setup();
  await books.download(USER, 'b1'); await outbox.enqueue({ userId: 'u1', bookId: 'b1', type: 'rating', rating: 5 });
  assert.ok(await getDeviceKey(store));
  await books.removeAll();
  assert.deepEqual(await books.list('u1'), []); assert.equal(await outbox.pending('u1'), 0); assert.equal(await store.get(STORES.meta, 'deviceKey'), undefined);
});

/* ---------------------------------------------------------------- fronta změn */
test('fronta: pozice a hodnocení se pro knihu slučují (platí poslední, dočtení se nezapomene), ostatní se řadí', async () => {
  const { outbox } = setup();
  const op = (o) => outbox.enqueue({ userId: 'u1', bookId: 'b1', ...o });
  await op({ type: 'position', percent: 10, isRead: false, at: 1 });
  await op({ type: 'position', percent: 99, isRead: true, at: 2 });
  await op({ type: 'position', percent: 50, isRead: false, at: 3 });
  await op({ type: 'rating', rating: 3 }); await op({ type: 'rating', rating: 5 });
  await op({ type: 'bookmark_add', localId: 'local:1', label: 'A', percent: 5 });
  await op({ type: 'position', percent: 7, isRead: false, at: 4 });
  await outbox.enqueue({ userId: 'u1', bookId: 'b2', type: 'position', percent: 1, isRead: false, at: 5 });
  const list = (await outbox.list('u1')).map((e) => e.value);
  assert.deepEqual(list.map((e) => e.type), ['position', 'rating', 'bookmark_add', 'position']);
  assert.deepEqual([list[0].percent, list[0].isRead, list[1].rating], [7, true, 5], 'poslední pozice, ale dočtení zůstane');
  assert.equal(await outbox.pending('u2'), 0);
  assert.equal(await outbox.pending('u1'), 4);
});

test('fronta: položka vytvořená offline a hned smazaná se na server vůbec nepošle; poznámka k ní jde s vytvořením', async () => {
  const { outbox } = setup();
  const op = (o) => outbox.enqueue({ userId: 'u1', bookId: 'b1', ...o });
  await op({ type: 'bookmark_add', localId: 'local:a', label: 'A', percent: 1 });
  await op({ type: 'bookmark_delete', id: 'local:a' });
  assert.equal(await outbox.pending('u1'), 0);
  await op({ type: 'highlight_add', localId: 'local:h', start: 1, end: 5, color: 'amber' });
  await op({ type: 'highlight_note', id: 'local:h', note: 'moje poznámka' });
  await op({ type: 'highlight_note', id: 'local:h', note: 'lepší poznámka' });
  const [only, ...rest] = (await outbox.list('u1')).map((e) => e.value);
  assert.equal(rest.length, 0); assert.equal(only.note, 'lepší poznámka');
  await op({ type: 'highlight_delete', id: 'local:h' });
  assert.equal(await outbox.pending('u1'), 0);
  await op({ type: 'highlight_note', id: 'srv-1', note: 'x' }); await op({ type: 'highlight_note', id: 'srv-1', note: 'y' });
  assert.equal(await outbox.pending('u1'), 1, 'poznámka ke skutečnému zvýraznění se slučuje');
  await op({ type: 'bookmark_delete', id: 'srv-2' });
  assert.equal(await outbox.pending('u1'), 2, 'smazání skutečné položky se odešle');
});

test('odeslání: změny jdou v pořadí, dočasná id se nahradí skutečnými a kopie se opraví', async () => {
  const s = setup();
  await s.books.download(USER, 'b1');
  const backend = createReaderBackend({ client: s.server.client, books: s.books, outbox: s.outbox, userId: 'u1', bookId: 'b1', mode: 'offline', hasCopy: true, now: s.now });
  const bm = await backend.addBookmark('Offline záložka', 33);
  const hl = await backend.addHighlight({ start: 10, end: 20, color: 'green' });
  await backend.setNote(hl.id, 'napsáno ve vlaku');
  await backend.setRating(5);
  await backend.savePosition(60, true);
  assert.ok(isLocalId(bm.id) && isLocalId(hl.id));
  assert.equal(await s.outbox.pending('u1'), 5 - 1, 'poznámka k novému zvýraznění jde s ním');
  const remaps = [];
  const res = await s.outbox.flush(s.server.client, 'u1', { onRemap: async (l, row, kind, bookId) => { remaps.push([l, row.id, kind]); await s.books.local.remap('u1', bookId, l, row, kind); } });
  assert.deepEqual([res.sent, res.dropped, res.remaining, res.stopped], [4, 0, 0, false]);
  assert.deepEqual(remaps.map((r) => r[2]), ['bookmark', 'highlight']);
  const bmRow = s.server.db.book_bookmarks.find((r) => r.label === 'Offline záložka');
  const hlRow = s.server.db.book_highlights.find((r) => r.start_offset === 10);
  assert.equal(bmRow.scroll_position, 33); assert.equal(hlRow.note, 'napsáno ve vlaku'); assert.equal(hlRow.color, 'green');
  assert.equal(s.server.db.book_ratings.find((r) => r.book_id === 'b1').rating, 5);
  const ub = s.server.db.user_books.find((r) => r.book_id === 'b1');
  assert.deepEqual([ub.scroll_position, ub.is_read], [60, true]);
  const opened = await s.books.open('u1', 'b1');
  assert.ok(opened.notes.bookmarks.some((b) => b.id === bmRow.id) && !opened.notes.bookmarks.some((b) => isLocalId(b.id)), 'v kopii je skutečné id');
  assert.ok(opened.notes.highlights.some((h) => h.id === hlRow.id && h.note === 'napsáno ve vlaku'));
  assert.equal(opened.notes.rating, 5); assert.equal(opened.meta.percent, 60); assert.equal(opened.meta.isRead, true);
});

test('odeslání: při výpadku sítě se zastaví a zbytek zůstane; zamítnutá změna se zahodí i se závislými', async () => {
  const s = setup();
  const q = (o) => s.outbox.enqueue({ userId: 'u1', bookId: 'b1', ...o });
  await q({ type: 'rating', rating: 2 });
  await q({ type: 'bookmark_add', localId: 'local:x', label: 'Zamítnutá', percent: 1 });
  await q({ type: 'bookmark_delete', id: 'local:x' });   // tohle se zruší už při zařazení
  await q({ type: 'highlight_add', localId: 'local:y', start: 1, end: 3, color: 'blue' });
  await q({ type: 'highlight_note', id: 'srv-1', note: 'pozn' });
  s.server.state.down = true;
  let res = await s.outbox.flush(s.server.client, 'u1');
  assert.equal(res.stopped, true); assert.equal(res.sent, 0); assert.equal(res.remaining, 3, 'nic se neztratilo');
  s.server.state.down = false;
  s.server.state.rejectWith = { table: 'book_highlights', op: 'insert', error: { message: 'new row violates row-level security policy', code: '42501', status: 403 } };
  res = await quiet(() => s.outbox.flush(s.server.client, 'u1'));
  assert.equal(res.stopped, false);
  assert.equal(s.server.db.book_ratings.find((r) => r.book_id === 'b1').rating, 2, 'platné změny odešly');
  assert.equal(res.dropped, 1, 'zamítnuté vytvoření zvýraznění se zahodilo');
  assert.equal(await s.outbox.pending('u1'), 0);
});

test('odeslání: dvě současná volání sdílejí jeden průchod (nic se neodešle dvakrát)', async () => {
  const s = setup();
  await s.outbox.enqueue({ userId: 'u1', bookId: 'b1', type: 'bookmark_add', localId: 'local:1', label: 'Jednou', percent: 1 });
  const [a, b] = await Promise.all([s.outbox.flush(s.server.client, 'u1'), s.outbox.flush(s.server.client, 'u1')]);
  assert.equal(a, b);
  assert.equal(s.server.db.book_bookmarks.filter((r) => r.label === 'Jednou').length, 1);
});

test('pozice: offline čtení nepřepíše dál pokročilou pozici z jiného zařízení, ale pozdější čtení ano a dočtení se nezapomene', () => {
  const q = (percent, at, isRead = false) => ({ percent, at, isRead });
  const srv = (percent, updated, isRead = false) => ({ scroll_position: percent, updated_at: new Date(updated).toISOString(), is_read: isRead });
  assert.deepEqual(resolvePosition(q(30, 1000), null), { apply: true, percent: 30, isRead: false });
  assert.equal(resolvePosition(q(30, 1000), srv(80, 2000)).apply, false, 'na jiném zařízení se mezitím četlo dál');
  assert.equal(resolvePosition(q(30, 3000), srv(80, 2000)).apply, true, 'offline čtení je pozdější: platí');
  assert.equal(resolvePosition(q(90, 1000), srv(80, 2000)).apply, true, 'offline je dál: platí');
  assert.equal(resolvePosition(q(30, 1000), srv(80, 2000, true)).isRead, true, 'dočteno na serveru zůstane');
  assert.equal(resolvePosition(q(30, 1000, true), srv(80, 2000)).isRead, true);
});

test('odeslání pozice: pokročilejší pozice na serveru zůstane, dočtení z offline se přesto zapíše', async () => {
  const s = setup();
  s.server.db.user_books[0] = { user_id: 'u1', book_id: 'b1', status: 'active', scroll_position: 80, is_read: false, updated_at: new Date(T0 + DAY).toISOString() };
  await s.outbox.enqueue({ userId: 'u1', bookId: 'b1', type: 'position', percent: 30, isRead: false, at: T0 });
  await s.outbox.flush(s.server.client, 'u1');
  assert.equal(s.server.db.user_books[0].scroll_position, 80, 'nic se nepřepsalo');
  await s.outbox.enqueue({ userId: 'u1', bookId: 'b1', type: 'position', percent: 30, isRead: true, at: T0 });
  await s.outbox.flush(s.server.client, 'u1');
  assert.deepEqual([s.server.db.user_books[0].scroll_position, s.server.db.user_books[0].is_read], [80, true]);
});

/* ---------------------------------------------------------------- čtečka: online, výpadek, offline */
test('backend čtečky online: jde na server a u stažené knihy zrcadlí výsledek do kopie', async () => {
  const s = setup();
  await s.books.download(USER, 'b1');
  const be = createReaderBackend({ client: s.server.client, books: s.books, outbox: s.outbox, userId: 'u1', bookId: 'b1', mode: 'online', hasCopy: true, now: s.now });
  const bm = await be.addBookmark('Online', 40); assert.ok(!isLocalId(bm.id));
  await be.setRating(2); await be.savePosition(45, false, { needsStatus: false });
  const hl = await be.addHighlight({ start: 30, end: 40, color: 'pink' }); await be.setNote(hl.id, 'x'); await be.deleteBookmark('bm1');
  assert.equal(await s.outbox.pending('u1'), 0, 'nic ve frontě');
  const o = await s.books.open('u1', 'b1');
  assert.deepEqual(o.notes.bookmarks.map((b) => b.label), ['Online']); assert.equal(o.notes.rating, 2);
  assert.equal(o.notes.highlights.find((h) => h.id === hl.id).note, 'x'); assert.equal(o.meta.percent, 45);
  assert.equal(s.server.db.book_ratings[0].rating, 2);
});

test('backend čtečky: výpadek sítě u stažené knihy uloží změnu do fronty, u nestažené vyhodí chybu jako dřív', async () => {
  const s = setup();
  await s.books.download(USER, 'b1');
  const withCopy = createReaderBackend({ client: s.server.client, books: s.books, outbox: s.outbox, userId: 'u1', bookId: 'b1', mode: 'online', hasCopy: true, now: s.now });
  const without = createReaderBackend({ client: s.server.client, books: s.books, outbox: s.outbox, userId: 'u1', bookId: 'b1', mode: 'online', hasCopy: false, now: s.now });
  s.server.state.down = true;
  const bm = await withCopy.addBookmark('Pod mostem', 5); assert.ok(isLocalId(bm.id));
  assert.equal(await withCopy.savePosition(70, false), 'queued');
  await assert.rejects(without.addBookmark('Nejde', 5), (e) => isTransientError(e));
  assert.equal(await s.outbox.pending('u1'), 2);
  s.server.state.down = false;
  s.server.state.rejectWith = { table: 'book_bookmarks', op: 'insert', error: { message: 'denied', code: '42501', status: 403 } };
  await assert.rejects(withCopy.addBookmark('Zamítnuto', 5), (e) => e.code === '42501', 'chyba práv se neschová do fronty');
});

test('backend čtečky offline: smazání záložky, která ještě není na serveru, ji zruší; stažená kniha bez internetu funguje bez jediného dotazu na server', async () => {
  const s = setup();
  await s.books.download(USER, 'b1');
  s.server.calls.length = 0;
  const be = createReaderBackend({ client: s.server.client, books: s.books, outbox: s.outbox, userId: 'u1', bookId: 'b1', mode: 'offline', hasCopy: true, now: s.now });
  const bm = await be.addBookmark('Dočasná', 9);
  await be.deleteBookmark(bm.id);
  await be.deleteBookmark('bm1');                                   // skutečná záložka: smazání čeká ve frontě
  await be.savePosition(15, false);
  assert.equal(s.server.calls.length, 0, 'offline se server nevolá');
  assert.deepEqual((await s.outbox.list('u1')).map((e) => e.value.type), ['bookmark_delete', 'position']);
  assert.deepEqual((await s.books.open('u1', 'b1')).notes.bookmarks, [], 'v kopii záložky nejsou');
});

/* ---------------------------------------------------------------- pomocné funkce a napojení v appce */
test('isTransientError pozná výpadek sítě a chyby serveru, ne chybu práv; úložiště drží pořadí', async () => {
  for (const e of [{ name: 'TypeError', message: 'x' }, { message: 'TypeError: Failed to fetch' }, { status: 503 }, { status: 429 }, { status: 0 }, { message: 'timed out' }]) assert.equal(isTransientError(e), true, JSON.stringify(e));
  for (const e of [null, { status: 403, message: 'denied' }, { code: '42501', message: 'RLS' }, { status: 404 }, { message: 'duplicate key' }]) assert.equal(isTransientError(e), false, JSON.stringify(e));
  const st = createMemoryStore();
  await st.put(STORES.queue, '000000000010', 'b'); await st.put(STORES.queue, '000000000002', 'a');
  assert.deepEqual(await st.keys(STORES.queue), ['000000000002', '000000000010']);
  await assert.rejects(st.get('neznámé', 'x'));
});

test('napojení: čtečka čte z kopie offline a píše přes backend, detail knihy nabízí stažení, knihovna offline ukáže stažené, odhlášení uklízí', () => {
  const reader = read('pages', 'ReaderPage.jsx');
  assert.match(reader, /createReaderBackend\(\{ client: supabase, books: offlineBooks, outbox, userId: user\.id, bookId: id, mode, hasCopy \}\)/);
  assert.match(reader, /navigator\.onLine === false\) \{\s*if \(!hasCopy\) setMissingReason\('not_downloaded'\); else await openFromCopy\(\);/);
  assert.match(reader, /if \(hasCopy && isTransientError\(err\)\) await openFromCopy\(\);/);
  assert.match(reader, /if \(contentRow\?\.error && isTransientError\(contentRow\.error\)\) throw contentRow\.error;/);
  assert.match(reader, /backendRef\.current\?\.savePosition\(percent, isReadNow, \{ needsStatus: !hadExistingRowRef\.current \}\)/);
  for (const m of ['addBookmark', 'deleteBookmark', 'setRating', 'addHighlight', 'setNote', 'deleteHighlight']) assert.match(reader, new RegExp(`backendRef\\.current\\.${m}\\(`), m);
  assert.doesNotMatch(reader, /supabase\s*\.from\('(book_bookmarks|book_highlights|book_ratings)'\)\s*\.(insert|upsert|update|delete)/, 'čtečka už nepíše přímo na server');
  assert.doesNotMatch(reader, /supabase\.from\('(book_bookmarks|book_highlights)'\)\.(delete|update)/);
  assert.match(read('components', 'BookDetailModal.jsx'), /\{book\.hasAccess && <OfflineDownloadButton bookId=\{book\.id\} \/>\}/);
  const lib = read('pages', 'UserLibrary.jsx');
  assert.match(lib, /if \(!online\) return <OfflineLibrary \/>;/);
  assert.match(lib, /if \(online && loadError\) loadLibraryData\(\);/);
  const idx = read('offline', 'index.js');
  assert.match(idx, /registerLogoutCleanup\(\(\) => offlineStore\.wipe\(\)\);/);
  assert.match(read('contexts', 'AuthContext.jsx'), /if \(!\(await confirmLogoutDiscard\(user\)\)\) return;/);
  assert.match(read('App.jsx'), /<OfflineSyncRunner \/>/);
  assert.match(read('components', 'SettingsModal.jsx'), /<OfflineBooksSection Section=\{Section\} Notice=\{Notice\} ActionButton=\{ActionButton\} \/>/);
  const pkg = JSON.parse(fs.readFileSync(path.join(SRC, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['test:offlinebooks'], 'node --test src/tests/offlineBooks.test.mjs');
  assert.ok(pkg.scripts.test.includes('npm run test:offlinebooks'));
});
