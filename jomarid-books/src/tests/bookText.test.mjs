import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOOK_TEXT_BUCKET, bookTextPath, isBucketMissing, isObjectMissing, fetchBookText, saveBookText, removeBookText,
  findBookTexts, listTableBookIds, migrateOneBookText, migrateAllBookTexts, cleanupTableCopies, uploadBookText, downloadBookText,
} from '../bookText/bookText.js';

const enc = (s) => new TextEncoder().encode(s);

// Falešný klient: tabulka book_contents (Map id -> content) a bucket (Map cesta -> bajty).
const makeClient = ({ table = {}, files = {}, bucket = true, uploadError = null, corruptUpload = false } = {}) => {
  const rows = new Map(Object.entries(table));
  const objs = new Map(Object.entries(files).map(([k, v]) => [k, enc(v)]));
  const log = { uploads: [], deletes: [], upserts: [] };
  const missing = () => ({ message: 'Bucket not found', statusCode: '404' });
  const builder = (table) => {
    const st = { cols: null, filters: [], gt: null, limit: null, order: false, op: 'select', payload: null };
    const run = () => {
      if (st.op === 'delete') {
        const id = st.filters.find((f) => f[0] === 'book_id')?.[1];
        log.deletes.push(id); rows.delete(id); return { error: null };
      }
      if (st.op === 'upsert') { log.upserts.push(st.payload); rows.set(st.payload.book_id, st.payload.content); return { error: null }; }
      let ids = [...rows.keys()].sort();
      const eq = st.filters.find((f) => f[0] === 'book_id');
      if (eq) ids = ids.filter((i) => i === eq[1]);
      if (st.gt) ids = ids.filter((i) => i > st.gt);
      if (st.limit) ids = ids.slice(0, st.limit);
      return { data: ids.map((i) => (st.cols === 'content' ? { content: rows.get(i) } : { book_id: i })), error: null };
    };
    const b = {
      select(c) { st.cols = c; return b; }, eq(c, v) { st.filters.push([c, v]); return b; }, gt(_c, v) { st.gt = v; return b; },
      order() { return b; }, limit(n) { st.limit = n; return b; },
      delete() { st.op = 'delete'; return b; }, upsert(p) { st.op = 'upsert'; st.payload = p; return Promise.resolve(run()); },
      maybeSingle() { const r = run(); return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error }); },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    assert.equal(table, 'book_contents');
    return b;
  };
  return {
    from: builder,
    storage: {
      from(name) {
        assert.equal(name, BOOK_TEXT_BUCKET);
        return {
          async download(path) {
            if (!bucket) return { data: null, error: missing() };
            if (!objs.has(path)) return { data: null, error: { message: 'Object not found', statusCode: '404' } };
            return { data: new Blob([objs.get(path)]), error: null };
          },
          async upload(path, blob, opts) {
            if (!bucket) return { data: null, error: missing() };
            if (uploadError) return { data: null, error: uploadError };
            if (opts?.upsert === false && objs.has(path)) return { data: null, error: { message: 'The resource already exists', statusCode: '409' } };
            log.uploads.push({ path, opts });
            const bytes = new Uint8Array(await blob.arrayBuffer());
            objs.set(path, corruptUpload ? bytes.slice(0, Math.max(0, bytes.length - 1)) : bytes);
            return { data: { path }, error: null };
          },
          async remove(paths) { paths.forEach((p) => objs.delete(p)); return { data: [], error: null }; },
          async list(_p, { search = '', limit = 100, offset = 0 } = {}) {
            if (!bucket) return { data: null, error: missing() };
            log.lists = (log.lists || 0) + 1;
            return { data: [...objs.keys()].filter((k) => k.includes(search)).slice(offset, offset + limit).map((name) => ({ name, id: name })), error: null };
          },
        };
      },
    },
    rows, objs, log,
  };
};

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const C = '33333333-3333-3333-3333-333333333333';
const TEXT = 'Příběh\r\n\r\nŽlutý kůň 😀 — „uvozovky“\n konec  ';

test('cesta a rozpoznání chyb', () => {
  assert.equal(bookTextPath(A), `${A}.txt`);
  assert.ok(isBucketMissing({ message: 'Bucket not found' }));
  assert.ok(!isBucketMissing({ message: 'Object not found', statusCode: '404' }));
  assert.ok(isObjectMissing({ message: 'Object not found' }));
  assert.ok(isObjectMissing({ statusCode: '404', message: 'x' }));
  assert.ok(!isObjectMissing({ message: 'Failed to fetch' }));
  assert.ok(!isBucketMissing(null) && !isObjectMissing(null));
});

test('text projde Storage beze změny (CRLF, emoji, mezery, BOM)', async () => {
  for (const text of [TEXT, '﻿začátek s BOM', '', 'x\r']) {
    const c = makeClient();
    assert.equal((await uploadBookText(c, A, text)).error, null);
    const r = await downloadBookText(c, A);
    assert.equal(r.text, text);
  }
});

test('upload je bez mezipaměti a přepisuje', async () => {
  const c = makeClient();
  await uploadBookText(c, A, 'a');
  assert.deepEqual(c.log.uploads[0].opts, { upsert: true, contentType: 'text/plain', cacheControl: '0' });
});

test('čtení: Storage má přednost, pak tabulka, pak nic', async () => {
  const c = makeClient({ table: { [A]: 'stará', [B]: 'jen tabulka' }, files: { [`${A}.txt`]: 'nová' } });
  assert.deepEqual(await fetchBookText(c, A), { text: 'nová', source: 'storage', error: null });
  assert.deepEqual(await fetchBookText(c, B), { text: 'jen tabulka', source: 'table', error: null });
  const none = await fetchBookText(c, C);
  assert.equal(none.text, null); assert.equal(none.source, 'none'); assert.equal(none.error, null);
});

test('čtení bez bucketu spadne na tabulku', async () => {
  const c = makeClient({ table: { [A]: 'z tabulky' }, bucket: false });
  assert.equal((await fetchBookText(c, A)).text, 'z tabulky');
});

test('čtení: výpadek Storage nenačte zastaralou kopii z tabulky', async () => {
  const c = makeClient({ table: { [A]: 'zastaralý text' } });
  c.storage.from = () => ({ download: async () => ({ data: null, error: { message: 'Failed to fetch' } }) });
  const r = await fetchBookText(c, A);
  assert.equal(r.text, null); assert.equal(r.source, 'none'); assert.ok(r.error);
});

test('čtení: chyba sítě ve Storage a prázdná tabulka se ohlásí jako chyba', async () => {
  const c = makeClient();
  c.storage.from = () => ({ download: async () => ({ data: null, error: { message: 'Failed to fetch' } }) });
  const r = await fetchBookText(c, A);
  assert.equal(r.text, null);
  assert.equal(r.error.message, 'Failed to fetch');
});

test('uložení: do Storage a smaže starou kopii z tabulky', async () => {
  const c = makeClient({ table: { [A]: 'stará' } });
  const r = await saveBookText(c, A, TEXT);
  assert.deepEqual(r, { error: null, where: 'storage' });
  assert.equal((await fetchBookText(c, A)).text, TEXT);
  assert.ok(!c.rows.has(A));
});

test('uložení bez bucketu jde do staré tabulky; jiná chyba se nemaskuje', async () => {
  const c = makeClient({ bucket: false });
  assert.deepEqual(await saveBookText(c, A, 'x'), { error: null, where: 'table' });
  assert.equal(c.rows.get(A), 'x');
  const d = makeClient({ uploadError: { message: 'new row violates row-level security policy', statusCode: '403' }, table: { [A]: 'v1' } });
  const r = await saveBookText(d, A, 'v2');
  assert.equal(r.where, 'storage'); assert.ok(r.error);
  assert.equal(d.rows.get(A), 'v1'); // nic se potají nezapsalo do tabulky
});

test('smazání knihy odstraní soubor', async () => {
  const c = makeClient({ files: { [`${A}.txt`]: 'x' } });
  await removeBookText(c, A);
  assert.equal(c.objs.size, 0);
});

test('findBookTexts: najde jen přesný název, bez bucketu nic a bez chyby', async () => {
  const c = makeClient({ files: { [`${A}.txt`]: 'x', [`${B}.txt.bak`]: 'y' } });
  const r = await findBookTexts(c, [A, B, C]);
  assert.deepEqual([...r.found], [A]); assert.equal(r.complete, true);
  const none = await findBookTexts(makeClient({ bucket: false }), [A, B]);
  assert.equal(none.found.size, 0); assert.equal(none.complete, true);
  assert.equal((await findBookTexts({}, [A])).complete, true);
});

test('findBookTexts: stovky knih se ověří výpisem po stránkách, ne ztrátou upozornění', async () => {
  const ids = Array.from({ length: 2600 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`);
  const files = Object.fromEntries(ids.filter((_, i) => i % 2 === 0).map((id) => [`${id}.txt`, 'x']));
  const c = makeClient({ files });
  const r = await findBookTexts(c, ids);
  assert.equal(r.complete, true);
  assert.equal(r.found.size, 1300);
  assert.ok(r.found.has(ids[0]) && !r.found.has(ids[1]));
  assert.ok(c.log.lists <= 3); // 1300 souborů = 2 stránky, ne 2600 dotazů
});

test('seznam id ze staré tabulky po stránkách', async () => {
  const table = {};
  for (let i = 0; i < 250; i++) table[`00000000-0000-0000-0000-${String(i).padStart(12, '0')}`] = `t${i}`;
  const { ids, error } = await listTableBookIds(makeClient({ table }));
  assert.equal(error, null); assert.equal(ids.length, 250); assert.equal(new Set(ids).size, 250);
});

test('přesun jedné knihy: nová, už přesunutá, konflikt, prázdná, poškozený upload', async () => {
  const c = makeClient({ table: { [A]: TEXT, [B]: 'x', [C]: '' }, files: { [`${B}.txt`]: 'jiný' } });
  assert.deepEqual(await migrateOneBookText(c, A), { status: 'migrated' });
  assert.deepEqual(await migrateOneBookText(c, A), { status: 'already' });
  assert.deepEqual(await migrateOneBookText(c, B), { status: 'conflict' });
  assert.equal(new TextDecoder().decode(c.objs.get(`${B}.txt`)), 'jiný'); // cizí soubor se nepřepsal
  assert.deepEqual(await migrateOneBookText(c, C), { status: 'empty' });
  const bad = makeClient({ table: { [A]: 'abcdef' }, corruptUpload: true });
  assert.equal((await migrateOneBookText(bad, A)).status, 'verify_failed');
  const nob = makeClient({ table: { [A]: 'abc' }, bucket: false });
  assert.equal((await migrateOneBookText(nob, A)).status, 'error');
});

test('přesun nepřepíše úpravu uloženou během přesunu (create-only)', async () => {
  const c = makeClient({ table: { [A]: 'starý text' } });
  const realFrom = c.storage.from;
  let first = true;
  c.storage.from = (name) => {
    const st = realFrom(name);
    return { ...st, download: async (p) => { const r = await st.download(p); if (first) { first = false; c.objs.set(p, enc('NOVÁ úprava')); } return r; } };
  };
  const r = await migrateOneBookText(c, A);
  assert.equal(r.status, 'conflict');
  assert.equal(new TextDecoder().decode(c.objs.get(`${A}.txt`)), 'NOVÁ úprava');
});

test('hromadný přesun nic nemaže a hlásí průběh', async () => {
  const c = makeClient({ table: { [A]: 'a', [B]: 'b', [C]: 'c' }, files: { [`${C}.txt`]: 'c' } });
  const seen = [];
  const r = await migrateAllBookTexts(c, { onProgress: (p) => seen.push(p.done) });
  assert.equal(r.total, 3);
  assert.deepEqual(r.counts, { migrated: 2, already: 1, conflict: 0, empty: 0, verify_failed: 0, error: 0 });
  assert.deepEqual(seen, [1, 2, 3]);
  assert.equal(c.rows.size, 3); assert.equal(c.log.deletes.length, 0);
  assert.equal(r.failures.length, 0);
});

test('úklid smaže jen totožné kopie', async () => {
  const c = makeClient({
    table: { [A]: 'shodné', [B]: 'liší se', [C]: 'chybí ve storage' },
    files: { [`${A}.txt`]: 'shodné', [`${B}.txt`]: 'jiné' },
  });
  const r = await cleanupTableCopies(c);
  assert.deepEqual(r.counts, { deleted: 1, kept: 2, error: 0 });
  assert.deepEqual([...c.rows.keys()].sort(), [B, C]);
});

test('úklid při výpadku Storage nic nesmaže', async () => {
  const c = makeClient({ table: { [A]: 'a' } });
  c.storage.from = () => ({ download: async () => ({ data: null, error: { message: 'Failed to fetch' } }) });
  const r = await cleanupTableCopies(c);
  assert.deepEqual(r.counts, { deleted: 0, kept: 0, error: 1 });
  assert.equal(c.rows.size, 1);
});
