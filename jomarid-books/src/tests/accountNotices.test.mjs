// Testy kontroly vlastních dat: node --test src/tests/accountNotices.test.mjs   (nebo: npm run test:notices)
//
// Hlídají hlavně dvě věci: že se každá chyba pozná (a ukáže jen tomu, koho se týká), a že se NIKDY nehlásí
// problém "naslepo" - když se data nepodařilo načíst, nesmí z toho vyjít falešné upozornění.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as N from '../accountNotices.js';

const ids = (notices) => notices.map((n) => n.id);
const profile = (extra = {}) => ({ id: 'u1', username: 'jana', pen_name: 'Jana Nováková', ...extra });
const book = (id, extra = {}) => ({ id, title: `Kniha ${id}`, description: 'Popis', genres: ['Román'], is_hidden: false, ...extra });
const allWithContent = (books) => books.map((b) => b.id);

describe('plural', () => {
  test('české tvary podle počtu', () => {
    const f = (n) => N.plural(n, 'kniha', 'knihy', 'knih');
    assert.deepEqual([0, 1, 2, 3, 4, 5, 11, 12, 21, 100].map(f), ['knih', 'kniha', 'knihy', 'knihy', 'knihy', 'knih', 'knih', 'knih', 'knih', 'knih']);
  });
});

describe('účet', () => {
  test('v pořádku: nic se nehlásí', () => {
    assert.deepEqual(N.buildAccountNotices({ role: 'uživatel', profile: profile() }), []);
  });
  test('chybějící uživatelské jméno (prázdné, mezery, null, chybí) je upozornění s odkazem na Profil', () => {
    for (const username of [null, '', '   ', undefined]) {
      const out = N.buildAccountNotices({ role: 'uživatel', profile: profile({ username }) });
      assert.deepEqual(ids(out), ['username-missing'], String(username));
      assert.equal(out[0].level, N.LEVEL_WARN);
      assert.equal(out[0].to, '/settings/profile');
    }
  });
  test('neexistující profil je upozornění, ale nepodařené načtení profilu (undefined) nic nehlásí', () => {
    assert.deepEqual(ids(N.buildAccountNotices({ role: 'uživatel', profile: null })), ['profile-missing']);
    assert.deepEqual(N.buildAccountNotices({ role: 'uživatel', profile: undefined }), []);
    assert.deepEqual(N.buildAccountNotices({ role: 'nakladatel' }), []);
  });
  test('autorské jméno se chce jen po nakladateli a správci, a jen jako tip', () => {
    const p = profile({ pen_name: '' });
    assert.deepEqual(N.buildAccountNotices({ role: 'uživatel', profile: p }), []);
    for (const role of ['nakladatel', 'správce']) {
      const out = N.buildAccountNotices({ role, profile: p });
      assert.deepEqual(ids(out), ['pen-name-missing'], role);
      assert.equal(out[0].level, N.LEVEL_INFO);
    }
  });
  test('správce dostává stejná upozornění jako ostatní (za svůj účet i své knihy)', () => {
    const books = [book('a', { description: '' })];
    const out = N.buildAccountNotices({ role: 'správce', profile: profile({ username: null, pen_name: null }), books, bookIdsWithContent: ['a'] });
    assert.deepEqual(ids(out), ['username-missing', 'books-no-description', 'pen-name-missing']);
  });
});

describe('knihy nakladatele', () => {
  const role = 'nakladatel';
  test('hotové knihy: nic se nehlásí', () => {
    const books = [book('a'), book('b')];
    assert.deepEqual(N.buildAccountNotices({ role, profile: profile(), books, bookIdsWithContent: allWithContent(books) }), []);
  });
  test('čtenář kontrolu knih nikdy nedostane, ani kdyby měl data', () => {
    const books = [book('a', { description: '', genres: [] })];
    assert.deepEqual(N.buildAccountNotices({ role: 'uživatel', profile: profile(), books, bookIdsWithContent: [] }), []);
  });
  test('kniha bez textu, bez popisu a bez žánru: tři různá upozornění se správnou závažností', () => {
    const books = [book('a'), book('b', { description: '  ' }), book('c', { genres: [] }), book('d', { genres: null })];
    const out = N.buildAccountNotices({ role, profile: profile(), books, bookIdsWithContent: ['b', 'c', 'd'] }); // 'a' nemá text
    assert.deepEqual(ids(out), ['books-no-content', 'books-no-description', 'books-no-genres']);
    assert.deepEqual(out.map((n) => n.level), [N.LEVEL_WARN, N.LEVEL_WARN, N.LEVEL_INFO]);
    assert.deepEqual(out[0].items, ['Kniha a']);
    assert.deepEqual(out[1].items, ['Kniha b']);
    assert.deepEqual(out[2].items, ['Kniha c', 'Kniha d']);
    assert.ok(out.every((n) => n.to === '/publisher'));
  });
  test('nenačtený text knih (null/undefined) nehlásí "chybí text"', () => {
    const books = [book('a')];
    for (const bookIdsWithContent of [null, undefined]) assert.deepEqual(N.buildAccountNotices({ role, profile: profile(), books, bookIdsWithContent }), []);
  });
  test('nenačtené knihy (null) nic nehlásí', () => {
    assert.deepEqual(N.buildAccountNotices({ role, profile: profile(), books: null, bookIdsWithContent: [] }), []);
  });
  test('skryté knihy (koncepty) se kontrolují jen jako připomínka, ne na chybějící údaje', () => {
    const books = [book('a', { is_hidden: true, description: '', genres: [] }), book('b')];
    const out = N.buildAccountNotices({ role, profile: profile(), books, bookIdsWithContent: ['b'] });
    assert.deepEqual(ids(out), ['books-hidden']);
    assert.equal(out[0].level, N.LEVEL_INFO);
    assert.deepEqual(out[0].items, ['Kniha a']);
  });
  test('titulek má správný český tvar pro 1, 2 a 5 knih', () => {
    const mk = (n) => Array.from({ length: n }, (_, i) => book(String(i), { description: '' }));
    const title = (n) => N.buildAccountNotices({ role, profile: profile(), books: mk(n), bookIdsWithContent: allWithContent(mk(n)) }).find((x) => x.id === 'books-no-description').title;
    assert.equal(title(1), '1 zveřejněná kniha nemá popis');
    assert.equal(title(2), '2 zveřejněné knihy nemají popis');
    assert.equal(title(5), '5 zveřejněných knih nemá popis');
  });
  test('dlouhý seznam se zkrátí na MAX_ITEMS abecedně a zbytek se spočítá', () => {
    const books = Array.from({ length: 8 }, (_, i) => book(String(i), { title: `Titul ${'hgfedcba'[i]}`, description: '' }));
    const n = N.buildAccountNotices({ role, profile: profile(), books, bookIdsWithContent: allWithContent(books) }).find((x) => x.id === 'books-no-description');
    assert.equal(n.items.length, N.MAX_ITEMS);
    assert.deepEqual(n.items, ['Titul a', 'Titul b', 'Titul c', 'Titul d', 'Titul e']);
    assert.equal(n.more, 3);
    assert.match(n.title, /^8 /);
  });
  test('kniha bez názvu a neúplná data nic neshodí', () => {
    const books = [null, undefined, {}, { id: 'x', title: 5 }, book('ok')];
    assert.doesNotThrow(() => N.buildAccountNotices({ role, profile: profile(), books, bookIdsWithContent: ['ok'] }));
  });
});

describe('řazení a počítání', () => {
  test('nejdřív co je potřeba opravit, pak tipy', () => {
    const books = [book('a', { is_hidden: true })];
    const out = N.buildAccountNotices({ role: 'nakladatel', profile: profile({ pen_name: '', username: '' }), books, bookIdsWithContent: [] });
    assert.deepEqual(out.map((n) => n.level), [N.LEVEL_WARN, N.LEVEL_INFO, N.LEVEL_INFO]);
    assert.equal(N.countWarnings(out), 1);
  });
  test('countWarnings: neplatný vstup = 0', () => {
    for (const v of [null, undefined, 5, {}]) assert.equal(N.countWarnings(v), 0);
  });
});

// Falešný klient Supabase: from(tabulka).select().eq()/in()/maybeSingle() vrací připravené odpovědi a zapisuje dotazy.
const fakeClient = (tables, log = []) => ({
  from: (table) => {
    const q = { table, filters: [] };
    const result = () => {
      log.push({ ...q });
      const t = tables[table];
      if (typeof t === 'function') return t(q);
      return t ?? { data: [], error: null };
    };
    const b = {
      select: (cols) => { q.cols = cols; return b; },
      eq: (c, v) => { q.filters.push(['eq', c, v]); return b; },
      in: (c, v) => { q.filters.push(['in', c, v]); return b; },
      maybeSingle: () => Promise.resolve(result()),
      then: (res, rej) => Promise.resolve(result()).then(res, rej),
    };
    return b;
  },
});

describe('loadAccountNotices', () => {
  const user = { id: 'u1' };
  test('čtenář: čte jen profil, žádné knihy', async () => {
    const log = [];
    const r = await N.loadAccountNotices(fakeClient({ profiles: { data: profile({ username: '' }), error: null } }, log), { user, role: 'uživatel' });
    assert.deepEqual(ids(r.notices), ['username-missing']);
    assert.equal(r.partial, false);
    assert.deepEqual(log.map((x) => x.table), ['profiles']);
  });
  test('nakladatel: ptá se jen na vlastní knihy a jejich texty', async () => {
    const log = [];
    const books = [book('a'), book('b')];
    const c = fakeClient({ profiles: { data: profile(), error: null }, books: { data: books, error: null }, book_contents: { data: [{ book_id: 'a' }], error: null } }, log);
    const r = await N.loadAccountNotices(c, { user, role: 'nakladatel' });
    assert.deepEqual(ids(r.notices), ['books-no-content']);
    assert.deepEqual(r.notices[0].items, ['Kniha b']);
    const booksQ = log.find((x) => x.table === 'books');
    assert.deepEqual(booksQ.filters, [['eq', 'author_id', 'u1']]);
    assert.deepEqual(log.find((x) => x.table === 'book_contents').filters, [['in', 'book_id', ['a', 'b']]]);
  });
  test('víc než 40 knih se na texty ptá po dávkách', async () => {
    const log = [];
    const books = Array.from({ length: 95 }, (_, i) => book('b' + i));
    const c = fakeClient({ profiles: { data: profile(), error: null }, books: { data: books, error: null }, book_contents: (q) => ({ data: q.filters[0][2].map((id) => ({ book_id: id })), error: null }) }, log);
    const r = await N.loadAccountNotices(c, { user, role: 'správce' });
    assert.deepEqual(r.notices, []);
    assert.deepEqual(log.filter((x) => x.table === 'book_contents').map((x) => x.filters[0][2].length), [40, 40, 15]);
  });
  test('chyba při načítání profilu: nic se nehlásí a kontrola je označená jako neúplná', async () => {
    const r = await N.loadAccountNotices(fakeClient({ profiles: { data: null, error: { message: 'x' } } }), { user, role: 'uživatel' });
    assert.deepEqual(r.notices, []);
    assert.equal(r.partial, true);
  });
  test('chyba při načítání textů knih: nehlásí "chybí text", ostatní kontroly zůstanou', async () => {
    const books = [book('a', { description: '' })];
    const c = fakeClient({ profiles: { data: profile(), error: null }, books: { data: books, error: null }, book_contents: { data: null, error: { message: 'x' } } });
    const r = await N.loadAccountNotices(c, { user, role: 'nakladatel' });
    assert.deepEqual(ids(r.notices), ['books-no-description']);
    assert.equal(r.partial, true);
  });
  test('chyba při načítání knih: žádná upozornění na knihy, ale účet se zkontroluje', async () => {
    const c = fakeClient({ profiles: { data: profile({ username: null }), error: null }, books: { data: null, error: { message: 'x' } } });
    const r = await N.loadAccountNotices(c, { user, role: 'nakladatel' });
    assert.deepEqual(ids(r.notices), ['username-missing']);
    assert.equal(r.partial, true);
  });
  test('chybějící řádek profilu (maybeSingle vrátí null) je upozornění, ne chyba', async () => {
    const r = await N.loadAccountNotices(fakeClient({ profiles: { data: null, error: null } }), { user, role: 'uživatel' });
    assert.deepEqual(ids(r.notices), ['profile-missing']);
    assert.equal(r.partial, false);
  });
});
