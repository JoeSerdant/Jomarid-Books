// Testy procházení dlouhých seznamů: node --test src/tests/browse.test.mjs   (nebo: npm run test:browse)
//
// Pokrývají čistou logiku: hledání bez diakritiky, postupné zobrazování, generované obálky, převod řádků z databáze
// na knihy, řazení a filtry knihovny (včetně srovnání se starým chováním), načítání po částech a zapamatovaný stav.
// Vykreslení a chování v prohlížeči se ověřuje zvlášť (E2E).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../browse/browseModel.js';
import * as L from '../browse/libraryModel.js';
import * as D from '../browse/libraryData.js';
import * as S from '../browse/browseStore.js';

const rng = (seed) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const NOW = Date.parse('2026-10-07T12:00:00Z');

// ---------------------------------------------------------------------------------------------------------------

describe('hledání bez diakritiky', () => {
  test('foldText: malá písmena, bez diakritiky, jedna mezera', () => {
    assert.equal(B.foldText('Žluťoučký kůň úpěl ďábelské ódy'), 'zlutoucky kun upel dabelske ody');
    assert.equal(B.foldText('  Stíny   NAD\tměstem '), 'stiny nad mestem');
    assert.equal(B.foldText(null), '');
    assert.equal(B.foldText(undefined), '');
    assert.equal(B.foldText(42), '42');
  });

  test('dotaz se dělí na slova, kniha musí obsahovat všechna, na pořadí nezáleží', () => {
    const key = B.foldText('Noční hlídka Autor Novák');
    assert.deepEqual(B.queryTokens('  NOVAK  noc '), ['novak', 'noc']);
    assert.deepEqual(B.queryTokens('   '), []);
    assert.deepEqual(B.queryTokens(undefined), []);
    assert.ok(B.matchesTokens(key, B.queryTokens('novak noc')));
    assert.ok(B.matchesTokens(key, B.queryTokens('hlid')), 'část slova stačí');
    assert.ok(B.matchesTokens(key, B.queryTokens('Noční Novák')), 'diakritika v dotazu nevadí');
    assert.ok(!B.matchesTokens(key, B.queryTokens('novak dvur')), 'jedno slovo chybí');
    assert.ok(B.matchesTokens(key, []), 'prázdný dotaz vyhovuje všemu');
  });
});

describe('postupné zobrazování', () => {
  test('clampVisible: aspoň jedna část, nejvýš všechno', () => {
    assert.equal(B.clampVisible(0, 100, 24), 24);
    assert.equal(B.clampVisible(48, 100, 24), 48);
    assert.equal(B.clampVisible(500, 100, 24), 100);
    assert.equal(B.clampVisible(0, 10, 24), 10);
    assert.equal(B.clampVisible(5, 0, 24), 0);
    assert.equal(B.clampVisible(NaN, 100, 24), 24);
    assert.equal(B.clampVisible(-3, 100, 24), 24);
    assert.equal(B.clampVisible(10, 100, 0), 10, 'nulová velikost části se bere jako 1');
    assert.equal(B.clampVisible('48', 100, 24), 48);
    assert.equal(B.clampVisible(undefined, undefined, undefined), 0);
    assert.equal(B.clampVisible(0, 100, 0), 1, 'nulová velikost části a nic rozbaleno = jedna položka');
    assert.equal(B.clampVisible(5, -3, 24), 0, 'záporný celkový počet = nic');
    assert.equal(B.nextVisibleCount(0, 5, 0), 1);
  });

  test('nextVisibleCount a nextChunkSize', () => {
    assert.equal(B.nextVisibleCount(24, 60, 24), 48);
    assert.equal(B.nextVisibleCount(48, 60, 24), 60);
    assert.equal(B.nextVisibleCount(60, 60, 24), 60);
    assert.equal(B.nextVisibleCount(0, 60, 24), 24);
    assert.equal(B.nextVisibleCount(90, 60, 24), 60, 'zastaralý vyšší počet se srovná na celkový');
    assert.equal(B.nextChunkSize(24, 60, 24), 24);
    assert.equal(B.nextChunkSize(48, 60, 24), 12);
    assert.equal(B.nextChunkSize(60, 60, 24), 0);
    assert.equal(B.nextChunkSize(70, 60, 24), 0);
  });

  test('opakované rozbalování dojde přesně na konec a nikdy ho nepřekročí', () => {
    for (const total of [0, 1, 23, 24, 25, 48, 59, 60, 61, 1000]) {
      let v = B.clampVisible(0, total, 24);
      let guard = 0;
      while (v < total) {
        const next = B.nextVisibleCount(v, total, 24);
        assert.ok(next > v && next - v <= 24 && next <= total, `total ${total}: ${v} -> ${next}`);
        assert.equal(next - v, B.nextChunkSize(v, total, 24), 'popisek tlačítka odpovídá tomu, co přibude');
        v = next;
        assert.ok(++guard < 100);
      }
      assert.equal(v, total);
    }
  });

  test('velikosti částí se dělí počtem sloupců mřížky (poslední řádek není poloprázdný)', () => {
    for (const cols of [2, 3, 4, 5, 6]) assert.equal(B.PAGE_SIZE.grid % cols, 0, `${cols} sloupců`);
  });
});

describe('skloňování a zobrazení', () => {
  test('czCount', () => {
    const f = (n) => B.czCount(n, 'kniha', 'knihy', 'knih');
    assert.deepEqual([0, 1, 2, 4, 5, 11, 100].map(f), ['0 knih', '1 kniha', '2 knihy', '4 knihy', '5 knih', '11 knih', '100 knih']);
    // desítky a stovky: 22-24 jsou "knihy", 12-14 a 25-29 "knih", jednička jen u samotného 1 (21 knih, 101 knih)
    assert.deepEqual([12, 13, 14, 21, 22, 23, 24, 25, 32, 101, 102, 104, 111, 112, 114, 1000, 1002].map(f),
      ['12 knih', '13 knih', '14 knih', '21 knih', '22 knihy', '23 knihy', '24 knihy', '25 knih', '32 knihy', '101 knih', '102 knihy', '104 knihy', '111 knih', '112 knih', '114 knih', '1000 knih', '1002 knihy']);
  });

  test('samo se rozbalí nejvýš deset částí (dál už jen tlačítkem)', () => {
    assert.equal(B.MAX_AUTO_PAGES, 10);
    assert.equal(B.autoLimit(60), 600);
    assert.equal(B.autoLimit(30), 300);
    assert.equal(B.autoLimit(0), 10, 'nulová velikost části se bere jako 1');
    assert.equal(B.autoLimit(undefined), 10);
  });

  test('obnovení rozbaleného seznamu je omezené na deset částí (návrat nesmí trvat sekundy)', () => {
    assert.equal(B.restoredVisible(0, 60), 0);
    assert.equal(B.restoredVisible(undefined, 60), 0);
    assert.equal(B.restoredVisible(-5, 60), 0);
    assert.equal(B.restoredVisible(120, 60), 120);
    assert.equal(B.restoredVisible(600, 60), 600);
    assert.equal(B.restoredVisible(601, 60), 600);
    assert.equal(B.restoredVisible(100000, 30), 300);
    assert.equal(B.restoredVisible('180', 60), 180);
  });

  test('způsob zobrazení: neznámá hodnota = mřížka', () => {
    assert.equal(B.normalizeViewMode('list'), 'list');
    assert.equal(B.normalizeViewMode('grid'), 'grid');
    for (const bad of [undefined, null, '', 'tabulka', 5, {}]) assert.equal(B.normalizeViewMode(bad), 'grid');
  });
});

describe('generované obálky', () => {
  // Kontrast podle WCAG 2.x mezi bílým textem a barvou přechodu.
  const hslToRgb = ([h, s, l]) => {
    s /= 100; l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s; const x = c * (1 - Math.abs(((h / 60) % 2) - 1)); const m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [r + m, g + m, b + m];
  };
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const lumOf = (rgb) => { const [r, g, b] = rgb.map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrastWithWhite = (hsl) => 1.05 / (lumOf(hslToRgb(hsl)) + 0.05);

  test('stejný název má vždy stejnou obálku', () => {
    assert.equal(B.coverGradient('Stíny nad městem'), B.coverGradient('Stíny nad městem'));
    assert.deepEqual(B.coverHsl('abc'), B.coverHsl('abc'));
  });

  test('různé názvy mají různé barvy', () => {
    const hues = new Set();
    for (let i = 0; i < 300; i += 1) hues.add(B.coverHsl(`Kniha číslo ${i}`).from[0]);
    assert.ok(hues.size > 150, `jen ${hues.size} různých odstínů ze 300 názvů`);
  });

  test('sytost a světlost jsou vždy stejné, mění se jen odstín', () => {
    const seen = new Set();
    for (let i = 0; i < 500; i += 1) { const c = B.coverHsl(`s${i}`); seen.add(`${c.from[1]}/${c.from[2]}/${c.to[1]}/${c.to[2]}`); }
    assert.equal(seen.size, 1);
  });

  test('bílý text je čitelný (kontrast aspoň 4,5) na obou koncích přechodu pro všech 360 odstínů', () => {
    const { from, to } = B.coverHsl('x');
    for (let h = 0; h < 360; h += 1) {
      assert.ok(contrastWithWhite([h, from[1], from[2]]) >= 4.5, `začátek přechodu, odstín ${h}`);
      assert.ok(contrastWithWhite([h, to[1], to[2]]) >= 4.5, `konec přechodu, odstín ${h}`);
    }
  });

  test('odstíny jsou v rozsahu 0-359 a přechod je platné CSS', () => {
    for (let i = 0; i < 2000; i += 1) {
      const { from, to } = B.coverHsl(`seed-${i}`);
      assert.ok(Number.isInteger(from[0]) && from[0] >= 0 && from[0] < 360);
      assert.ok(Number.isInteger(to[0]) && to[0] >= 0 && to[0] < 360);
    }
    assert.match(B.coverGradient('x'), /^linear-gradient\(150deg, hsl\(\d+ 50% 28%\), hsl\(\d+ 55% 19%\)\)$/);
    assert.doesNotThrow(() => B.coverGradient(undefined));
  });

  test('iniciály: první písmena prvních dvou slov', () => {
    assert.equal(B.coverInitials('Stíny nad městem'), 'SN');
    assert.equal(B.coverInitials('Zahrada'), 'Z');
    assert.equal(B.coverInitials('  čas  a prostor '), 'ČA');
    assert.equal(B.coverInitials('1984'), '1');
    assert.equal(B.coverInitials('— „Řeka“ —'), 'Ř');
    assert.equal(B.coverInitials('!!!'), '?');
    assert.equal(B.coverInitials(''), '?');
    assert.equal(B.coverInitials(null), '?');
    assert.equal(B.coverInitials('😀 smajlík'), 'S', 'emoji není písmeno');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Převod řádků a řazení: starý kód z UserLibrary.jsx slouží jako vzor, nová logika musí dát stejné výsledky.

const USER = 'user-1';
const GENRES = ['Román', 'Sci-Fi', 'Detektivka', 'Čtení na dobrou noc', 'Žánr bez knih?', 'Poezie'];
const makeRow = (rand, i) => ({
  id: `b${String(i).padStart(3, '0')}`,
  title: ['Stíny nad městem', 'Ábel', 'Zahrada', 'Čas', 'Cesta domů', 'Řeka', 'Dopisy'][i % 7] + ' ' + (i % 5),
  author: `Autor ${i % 4}`,
  author_display: rand() < 0.5 ? `Pseudonym ${i % 3}` : null,
  author_id: rand() < 0.1 ? USER : `a${i % 6}`,
  genres: rand() < 0.1 ? null : [GENRES[i % 4], GENRES[(i * 3 + 1) % 4]].filter((g, k, arr) => arr.indexOf(g) === k),
  description: rand() < 0.3 ? null : 'Popis ' + i,
  price_coins: rand() < 0.15 ? null : Math.floor(rand() * 6) * 50,
  avg_rating: rand() < 0.3 ? null : String(Math.round(rand() * 50) / 10),
  ratings_count: rand() < 0.3 ? null : Math.floor(rand() * 20),
  fake_likes: rand() < 0.4 ? null : Math.floor(rand() * 9),
  is_auto_assigned: rand() < 0.1,
  created_at: new Date(NOW - Math.floor(rand() * 400) * 86400000).toISOString(),
});
const makeUserBook = (rand, row) => (rand() < 0.4 ? {
  book_id: row.id, is_read: rand() < 0.4, status: rand() < 0.8 ? 'active' : 'revoked',
  updated_at: rand() < 0.1 ? null : new Date(NOW - Math.floor(rand() * 20) * 3600000).toISOString(),
  scroll_position: rand() < 0.5 ? 0 : Math.floor(rand() * 100),
} : null);

// Původní převod z UserLibrary.jsx (před úpravou), beze změn.
const legacyMap = (singleBook, user, userBookEntry, likesCountFromTable, freshLikedIds) => {
  const totalLikesCount = likesCountFromTable + (singleBook.fake_likes || 0);
  const isOwner = singleBook.author_id === user.id;
  const hasAccess = isOwner || singleBook.is_auto_assigned || userBookEntry?.status === 'active';
  return {
    id: singleBook.id,
    title: singleBook.title,
    author: singleBook.author_display || singleBook.author,
    authorId: singleBook.author_id || null,
    likesCount: totalLikesCount,
    isLiked: freshLikedIds.includes(singleBook.id),
    avgRating: parseFloat(singleBook.avg_rating) || 0,
    ratingsCount: singleBook.ratings_count || 0,
    genres: Array.isArray(singleBook.genres) ? singleBook.genres : [],
    description: singleBook.description || '',
    priceCoins: singleBook.price_coins ?? 0,
    hasAccess,
    isOwner,
    isRead: userBookEntry?.is_read || false,
    scrollPosition: userBookEntry?.scroll_position || 0,
    lastOpened: userBookEntry?.updated_at ? new Date(userBookEntry.updated_at).getTime() : 0,
    createdAt: singleBook.created_at ? new Date(singleBook.created_at).getTime() || 0 : 0, // nové pole, jen pro rozhodování shod
  };
};
const legacySmartSort = (arr) => [...arr].sort((a, b) => {
  if (a.hasAccess && b.hasAccess) {
    if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;
    return b.lastOpened - a.lastOpened;
  }
  if (a.hasAccess !== b.hasAccess) return (b.hasAccess ? 1 : 0) - (a.hasAccess ? 1 : 0);
  return b.likesCount - a.likesCount || b.createdAt - a.createdAt; // jediná změna oproti dřívějšku: shodu rozhoduje novější vydání
});
const legacySort = (result, sortBy) => {
  if (sortBy === 'alpha') return [...result].sort((a, b) => a.title.localeCompare(b.title, 'cs'));
  if (sortBy === 'rating') return [...result].sort((a, b) => b.avgRating - a.avgRating);
  if (sortBy === 'likes') return [...result].sort((a, b) => b.likesCount - a.likesCount);
  if (sortBy === 'price_low') return [...result].sort((a, b) => a.priceCoins - b.priceCoins);
  if (sortBy === 'price_high') return [...result].sort((a, b) => b.priceCoins - a.priceCoins);
  return result;
};
const LEGACY_FIELDS = ['id', 'title', 'author', 'authorId', 'likesCount', 'isLiked', 'avgRating', 'ratingsCount', 'genres', 'description', 'priceCoins', 'hasAccess', 'isOwner', 'isRead', 'scrollPosition', 'lastOpened', 'createdAt'];
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));

const fixture = (seed, n) => {
  const rand = rng(seed);
  const rows = Array.from({ length: n }, (_, i) => makeRow(rand, i));
  const userBooks = new Map(rows.map((r) => [r.id, makeUserBook(rand, r)]).filter(([, ub]) => ub));
  const likedIds = rows.filter(() => rand() < 0.2).map((r) => r.id);
  const realLikes = new Map(rows.map((r) => [r.id, Math.floor(rand() * 12)]));
  return { rows, userBooks, likedIds, realLikes };
};
const buildBooks = ({ rows, userBooks, likedIds, realLikes }) => rows.map((row) => L.toLibraryBook(row, {
  userId: USER, userBook: userBooks.get(row.id) || null, liked: likedIds.includes(row.id), realLikes: realLikes.get(row.id),
}));

describe('převod řádku z databáze na knihu', () => {
  test('stejné hodnoty jako starý převod (500 náhodných řádků, všechny kombinace prázdných polí)', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const fx = fixture(seed, 100);
      const books = buildBooks(fx);
      fx.rows.forEach((row, i) => {
        const expected = legacyMap(row, { id: USER }, fx.userBooks.get(row.id), fx.realLikes.get(row.id), fx.likedIds);
        assert.deepEqual(pick(books[i], LEGACY_FIELDS), expected, `seed ${seed}, kniha ${row.id}`);
      });
    }
  });

  test('přístup: vlastní kniha, automatická kniha, aktivní licence; zrušená licence a cizí kniha přístup nedávají', () => {
    const base = { id: 'x', title: 'T', author: 'A', author_id: 'someone' };
    assert.equal(L.toLibraryBook(base, { userId: USER }).hasAccess, false);
    assert.equal(L.toLibraryBook({ ...base, author_id: USER }, { userId: USER }).hasAccess, true);
    assert.equal(L.toLibraryBook({ ...base, author_id: USER }, { userId: USER }).isOwner, true);
    assert.equal(L.toLibraryBook({ ...base, is_auto_assigned: true }, { userId: USER }).hasAccess, true);
    assert.equal(L.toLibraryBook(base, { userId: USER, userBook: { status: 'active' } }).hasAccess, true);
    assert.equal(L.toLibraryBook(base, { userId: USER, userBook: { status: 'revoked' } }).hasAccess, false);
    assert.equal(L.toLibraryBook({ ...base, author_id: null }, { userId: undefined }).hasAccess, false, 'bez uživatele a bez autora se nic nevlastní');
    const noAuthor = { id: 'x', title: 'T', author: 'A' }; // sloupec author_id chybí úplně
    assert.equal(L.toLibraryBook(noAuthor, { userId: undefined }).isOwner, false, 'chybějící autor se nesmí rovnat chybějícímu uživateli');
    assert.equal(L.toLibraryBook(noAuthor, { userId: undefined }).hasAccess, false);
  });

  test('žánry, které nejsou pole, se berou jako žádné žánry', () => {
    for (const bad of ['Román', {}, 5, true, undefined, null]) assert.deepEqual(L.toLibraryBook({ id: 'x', title: 'T', genres: bad }, { userId: USER }).genres, []);
    assert.deepEqual(L.toLibraryBook({ id: 'x', title: 'T', genres: ['A', 'B'] }, { userId: USER }).genres, ['A', 'B']);
  });

  test('neplatné datum otevření knihy = 0 (a nerozbije řazení)', () => {
    assert.equal(L.toLibraryBook({ id: 'x', title: 'T' }, { userId: USER, userBook: { status: 'active', updated_at: 'nesmysl' } }).lastOpened, 0);
    assert.equal(L.toLibraryBook({ id: 'x', title: 'T' }, { userId: USER, userBook: { status: 'active', updated_at: '2026-01-02T03:04:05Z' } }).lastOpened, Date.parse('2026-01-02T03:04:05Z'));
  });

  test('hodnocení s čárkou a stav knihy slovy pro čtečky obrazovky', () => {
    assert.equal(L.fmtRating(4.9), '4,9');
    assert.equal(L.fmtRating(5), '5,0');
    assert.equal(L.fmtRating('3.25'), '3,3');
    const b = (over) => ({ avgRating: 0, hasAccess: true, isRead: false, scrollPosition: 0, ...over });
    assert.equal(L.bookStateText(b({})), '', 'vlastněná nepřečtená bez hodnocení: nic k hlášení');
    assert.equal(L.bookStateText(b({ avgRating: 4.9, scrollPosition: 31.4 })), 'Hodnocení 4,9 z 5, rozečteno 31 %');
    assert.equal(L.bookStateText(b({ avgRating: 4.2, isRead: true, scrollPosition: 100 })), 'Hodnocení 4,2 z 5, dočteno');
    assert.equal(L.bookStateText(b({ hasAccess: false, avgRating: 3 })), 'Hodnocení 3,0 z 5, zatím nevlastníš');
    assert.equal(L.bookStateText(b({ hasAccess: false })), 'Zatím nevlastníš', 'bez hodnocení začíná velkým písmenem');
    assert.equal(L.bookStateText(b({ hasAccess: false, isRead: true, scrollPosition: 50 })), 'Zatím nevlastníš', 'bez přístupu se čtení nehlásí');
    assert.equal(L.bookStateText(b({ scrollPosition: 140 })), 'Rozečteno 100 %');
  });

  test('co u knihy nabídnout: číst / pokračovat / znovu, koupit, nebo kolik mincí chybí', () => {
    const own = { hasAccess: true, isRead: false, scrollPosition: 0, priceCoins: 100 };
    assert.deepEqual(L.bookAction(own, 0), { kind: 'read', label: 'Číst', short: 'Číst' });
    assert.deepEqual(L.bookAction({ ...own, scrollPosition: 35 }, 0), { kind: 'read', label: 'Pokračovat', short: 'Pokračovat' });
    assert.deepEqual(L.bookAction({ ...own, isRead: true, scrollPosition: 35 }, 0), { kind: 'read', label: 'Číst znovu', short: 'Znovu' });
    const locked = { hasAccess: false, isRead: false, scrollPosition: 0, priceCoins: 150 };
    assert.deepEqual(L.bookAction(locked, 100), { kind: 'buy', affordable: false, label: 'Chybí 50', short: 'Chybí 50' });
    assert.deepEqual(L.bookAction(locked, 150), { kind: 'buy', affordable: true, label: 'Koupit za 150', short: 'Koupit 150' }, 'přesně na cenu stačí');
    assert.deepEqual(L.bookAction(locked, 151), { kind: 'buy', affordable: true, label: 'Koupit za 150', short: 'Koupit 150' });
    assert.deepEqual(L.bookAction({ ...locked, priceCoins: 0 }, 0), { kind: 'buy', affordable: true, label: 'Koupit za 0', short: 'Koupit 0' });
    assert.equal(L.bookAction({ ...locked, isRead: true, scrollPosition: 80 }, 0).kind, 'buy', 'bez přístupu se nikdy nenabízí čtení');
  });

  test('lajky: skutečné + falešné', () => {
    const row = { id: 'x', title: 'T', author: 'A', fake_likes: 5 };
    assert.equal(L.toLibraryBook(row, { userId: USER, realLikes: 3 }).likesCount, 8);
    assert.equal(L.toLibraryBook({ ...row, fake_likes: null }, { userId: USER, realLikes: 3 }).likesCount, 3);
    assert.equal(L.toLibraryBook({ id: 'x', title: 'T' }, { userId: USER }).likesCount, 0);
  });

  test('žánry: čištění jedné knihy (jen řetězce, mezery, délka, počet, dvojice lišící se velikostí písmen či diakritikou)', () => {
    assert.deepEqual(L.cleanGenres(['Román', ' Sci-Fi  ', 'sci-fi', 'ROMÁN']), ['Román', 'Sci-Fi']);
    assert.deepEqual(L.cleanGenres(['Dobrodružný   román', 'a\tb']), ['Dobrodružný román', 'a b'], 'vnitřní mezery se sjednotí');
    assert.deepEqual(L.cleanGenres([null, undefined, 5, {}, [], '', '   ', true, 'X']), ['X']);
    for (const bad of ['Román', {}, 5, null, undefined, true]) assert.deepEqual(L.cleanGenres(bad), []);
    assert.equal(L.cleanGenres(['x'.repeat(100)])[0].length, L.GENRE_MAX_LENGTH);
    assert.equal(L.cleanGenres(['a'.repeat(39) + ' b']).length, 1);
    assert.ok(!/\s$/.test(L.cleanGenres(['a'.repeat(39) + ' b'])[0]), 'oříznutý žánr nekončí mezerou');
    const many = Array.from({ length: 30 }, (_, i) => 'Žánr ' + i);
    assert.equal(L.cleanGenres(many).length, L.GENRES_PER_BOOK);
    assert.deepEqual(L.cleanGenres(many), many.slice(0, L.GENRES_PER_BOOK), 'zůstane prvních osm v původním pořadí');
  });

  test('žánry: sjednocení zápisů v celém katalogu (nejčastější vyhrává, při shodě ten s diakritikou a velkým písmenem)', () => {
    const mk = (id, genres) => ({ id, genres });
    const books = [mk('1', ['Sci-Fi']), mk('2', ['sci-fi']), mk('3', ['sci-fi']), mk('4', ['roman']), mk('5', ['Román']), mk('6', ['drama']), mk('7', ['Drama']), mk('8', ['DRAMA', 'Drama']), mk('9', [])];
    const out = L.canonicalizeGenres(books);
    assert.deepEqual(out.map((b) => b.genres), [['sci-fi'], ['sci-fi'], ['sci-fi'], ['Román'], ['Román'], ['Drama'], ['Drama'], ['Drama'], []]);
    assert.equal(out[8], books[8], 'kniha bez žánrů se nemění');
    const same = [mk('a', ['Román']), mk('b', ['Román', 'Sci-Fi'])];
    const out2 = L.canonicalizeGenres(same);
    assert.equal(out2[0], same[0], 'kniha, která už má správné zápisy, zůstane stejný objekt');
    assert.equal(out2[1], same[1]);
    assert.equal(books[0].genres[0], 'Sci-Fi', 'původní knihy se nemění');
    assert.deepEqual(L.canonicalizeGenres([]), []);
  });

  test('chybějící název nebo autor nic nerozbije (dřív hledání na takové knize spadlo)', () => {
    const b = L.toLibraryBook({ id: 'x', title: null, author: null }, { userId: USER });
    assert.equal(b.title, '');
    assert.equal(b.author, '');
    assert.equal(b.searchKey, '');
    assert.equal(L.filterBooks([b], { query: 'něco' }).length, 0);
  });

  test('popis knihy se v knihovně omezí (stahuje ho každý čtenář s celým katalogem)', () => {
    const long = 'a'.repeat(50000);
    assert.equal(L.toLibraryBook({ id: 'x', title: 'T', description: long }, { userId: USER }).description.length, L.DESCRIPTION_MAX_LENGTH);
    assert.equal(L.toLibraryBook({ id: 'x', title: 'T', description: 'Krátký popis' }, { userId: USER }).description, 'Krátký popis');
    assert.equal(L.toLibraryBook({ id: 'x', title: 'T', description: 12345 }, { userId: USER }).description, '12345');
    assert.equal(L.toLibraryBook({ id: 'x', title: 'T', description: null }, { userId: USER }).description, '');
  });

  test('klíč pro hledání je název + autor bez diakritiky; datum vydání se převede na číslo', () => {
    const b = L.toLibraryBook({ id: 'x', title: 'Stíny nad městem', author: 'Jan', author_display: 'Žofie Černá', created_at: '2026-01-02T03:04:05Z' }, { userId: USER });
    assert.equal(b.searchKey, 'stiny nad mestem zofie cerna');
    assert.equal(b.createdAt, Date.parse('2026-01-02T03:04:05Z'));
    assert.equal(L.toLibraryBook({ id: 'x', title: 'T', created_at: 'nesmysl' }, { userId: USER }).createdAt, 0);
    assert.equal(L.toLibraryBook({ id: 'x', title: 'T' }, { userId: USER }).createdAt, 0);
  });
});

describe('řazení knihovny', () => {
  test('základní pořadí je stejné jako dřív (500 náhodných knih včetně shod)', () => {
    for (const seed of [11, 12, 13, 14, 15]) {
      const fx = fixture(seed, 100);
      const books = buildBooks(fx);
      const expected = legacySmartSort(fx.rows.map((row) => legacyMap(row, { id: USER }, fx.userBooks.get(row.id), fx.realLikes.get(row.id), fx.likedIds)));
      assert.deepEqual(L.orderLibrary(books).map((b) => b.id), expected.map((b) => b.id), `seed ${seed}`);
    }
  });

  test('základní řazení nemění pole, které dostalo', () => {
    const books = buildBooks(fixture(16, 40));
    const before = books.map((b) => b.id);
    const ordered = L.orderLibrary(books);
    assert.deepEqual(books.map((b) => b.id), before);
    assert.notEqual(ordered, books);
  });

  test('"Doporučeno": mezi nevlastněnými knihami se stejným počtem lajků je novější nahoře', () => {
    const mk = (id, likes, created) => L.toLibraryBook({ id, title: id, fake_likes: likes, created_at: created }, { userId: USER });
    const ordered = L.orderLibrary([mk('stara', 3, '2025-01-01'), mk('nova', 3, '2026-01-01'), mk('oblibena', 9, '2024-01-01'), mk('bez-data', 3, null)]);
    assert.deepEqual(ordered.map((b) => b.id), ['oblibena', 'nova', 'stara', 'bez-data']);
  });

  test('každé řazení dává stejné pořadí jako dřív a řadí kopii', () => {
    for (const seed of [21, 22, 23]) {
      const fx = fixture(seed, 120);
      const ordered = L.orderLibrary(buildBooks(fx));
      const before = ordered.map((b) => b.id);
      for (const key of ['smart', 'alpha', 'rating', 'likes', 'price_low', 'price_high']) {
        assert.deepEqual(L.sortBooks(ordered, key).map((b) => b.id), legacySort(ordered, key).map((b) => b.id), `seed ${seed}, ${key}`);
      }
      assert.deepEqual(ordered.map((b) => b.id), before, 'původní pole se nesmí změnit');
    }
  });

  test('"smart" a neznámý klíč vrací stejné pole', () => {
    const arr = L.orderLibrary(buildBooks(fixture(31, 10)));
    assert.equal(L.sortBooks(arr, 'smart'), arr);
    assert.equal(L.sortBooks(arr, 'neexistuje'), arr);
  });

  test('"Nejnovější": podle data vydání sestupně, bez data na konci, při shodě zůstane základní pořadí', () => {
    const mk = (id, created) => L.toLibraryBook({ id, title: id, created_at: created }, { userId: USER });
    const arr = [mk('a', '2026-01-01'), mk('b', '2026-03-01'), mk('c', null), mk('d', '2026-03-01'), mk('e', '2025-01-01')];
    assert.deepEqual(L.sortBooks(arr, 'newest').map((b) => b.id), ['b', 'd', 'a', 'e', 'c']);
  });

  test('abecedně podle české abecedy (Č až za C, Ch až za H)', () => {
    const mk = (title) => L.toLibraryBook({ id: title, title }, { userId: USER });
    const sorted = L.sortBooks(['Zebra', 'Čas', 'Cesta', 'Ábel', 'Chata', 'Hora', 'Řeka', 'Rok'].map(mk), 'alpha').map((b) => b.title);
    assert.deepEqual(sorted, ['Ábel', 'Cesta', 'Čas', 'Hora', 'Chata', 'Rok', 'Řeka', 'Zebra']);
  });

  test('všechny klíče řazení jsou k dispozici a mají popisek', () => {
    assert.deepEqual(L.SORT_OPTIONS.map((o) => o.key), ['smart', 'newest', 'alpha', 'rating', 'likes', 'price_low', 'price_high']);
    for (const o of L.SORT_OPTIONS) assert.ok(o.label);
  });
});

describe('filtry knihovny', () => {
  const fx = fixture(41, 150);
  const books = L.orderLibrary(buildBooks(fx));
  const ids = (list) => list.map((b) => b.id);

  test('stav: vlastněné, rozečtené, dočtené (stejná pravidla jako přehled)', () => {
    assert.deepEqual(ids(L.filterBooks(books, { status: 'owned' })), ids(books.filter((b) => b.hasAccess)));
    assert.deepEqual(ids(L.filterBooks(books, { status: 'reading' })), ids(books.filter((b) => b.hasAccess && !b.isRead && b.scrollPosition > 0)));
    assert.deepEqual(ids(L.filterBooks(books, { status: 'finished' })), ids(books.filter((b) => b.hasAccess && b.isRead)));
    assert.deepEqual(ids(L.filterBooks(books, { status: 'all' })), ids(books));
    assert.deepEqual(ids(L.filterBooks(books, { status: 'neznámý' })), ids(books), 'neznámý stav nefiltruje');
    assert.deepEqual(ids(L.filterBooks(books)), ids(books));
  });

  test('žánr a hledání se kombinují a zachovávají pořadí', () => {
    const sf = L.filterBooks(books, { genre: 'Sci-Fi' });
    assert.ok(sf.length > 0 && sf.every((b) => b.genres.includes('Sci-Fi')));
    const q = L.filterBooks(books, { genre: 'Sci-Fi', query: 'autor 1', status: 'owned' });
    const expected = books.filter((b) => b.hasAccess && b.genres.includes('Sci-Fi') && b.searchKey.includes('autor') && b.searchKey.includes('1'));
    assert.ok(expected.length > 0 && expected.length < sf.length, 'zkouška má smysl jen s neprázdným a užším výběrem');
    assert.deepEqual(ids(q), ids(expected));
    const order = ids(books);
    const filtered = ids(L.filterBooks(books, { status: 'owned' }));
    assert.deepEqual(filtered, order.filter((id) => filtered.includes(id)), 'relativní pořadí se nemění');
  });

  test('hledání nehledí na diakritiku ani velikost písmen a bere víc slov', () => {
    const arr = [
      L.toLibraryBook({ id: '1', title: 'Noční hlídka', author: 'Jan Novák' }, { userId: USER }),
      L.toLibraryBook({ id: '2', title: 'Kniha písku', author: 'Eva Černá' }, { userId: USER }),
      L.toLibraryBook({ id: '3', title: 'Žízeň', author: 'Pseudonym', author_display: 'Žofie Nováková' }, { userId: USER }),
    ];
    assert.deepEqual(ids(L.filterBooks(arr, { query: 'KNIHA PISKU' })), ['2']);
    assert.deepEqual(ids(L.filterBooks(arr, { query: 'novak' })), ['1', '3']);
    assert.deepEqual(ids(L.filterBooks(arr, { query: 'novak nocni' })), ['1']);
    assert.deepEqual(ids(L.filterBooks(arr, { query: 'cerna kniha' })), ['2']);
    assert.deepEqual(ids(L.filterBooks(arr, { query: 'zizen' })), ['3']);
    assert.deepEqual(ids(L.filterBooks(arr, { query: 'pseudonym' })), [], 'hledá se v zobrazeném jménu autora');
    assert.deepEqual(ids(L.filterBooks(arr, { query: '   ' })), ['1', '2', '3']);
  });

  test('hledání zachová chování starého kódu pro názvy a autory (podřetězec bez ohledu na velikost písmen)', () => {
    const rand = rng(5);
    for (let i = 0; i < 60; i += 1) {
      const q = ['stíny', 'Ábel', 'autor 2', 'pseudonym', 'dom', 'ŘEK', 'xyz'][Math.floor(rand() * 7)];
      const old = books.filter((b) => b.title.toLowerCase().includes(q.toLowerCase()) || b.author.toLowerCase().includes(q.toLowerCase()));
      const next = L.filterBooks(books, { query: q });
      for (const b of old) assert.ok(next.includes(b), `"${q}" dřív našlo ${b.id}`);
    }
  });

  test('počty u stavů odpovídají filtrům', () => {
    const c = L.statusCounts(books);
    assert.equal(c.all, books.length);
    for (const key of ['owned', 'reading', 'finished']) assert.equal(c[key], L.filterBooks(books, { status: key }).length, key);
    assert.deepEqual(L.statusCounts([]), { all: 0, owned: 0, reading: 0, finished: 0 });
  });

  test('počty u žánrů: kolik knih čtenář po vybrání uvidí, abecedně, bez ohledu na vybraný žánr', () => {
    for (const filters of [{}, { status: 'owned' }, { query: 'autor' }, { status: 'reading', query: 'ab' }]) {
      const counts = L.genreCounts(books, filters);
      for (const { genre, count } of counts) {
        assert.ok(count > 0);
        assert.equal(L.filterBooks(books, { ...filters, genre }).length, count, `${JSON.stringify(filters)} / ${genre}`);
      }
      const names = counts.map((x) => x.genre);
      assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'cs')));
      assert.equal(new Set(names).size, names.length);
      // žánr, který v tomhle výběru nic nemá, v seznamu není
      const present = new Set(L.filterBooks(books, filters).flatMap((b) => b.genres));
      assert.deepEqual(new Set(names), present);
    }
    assert.deepEqual(L.genreCounts([]), []);
  });

  test('kniha se stejným žánrem uvedeným dvakrát se započítá jednou', () => {
    const b = L.toLibraryBook({ id: 'x', title: 'T', genres: ['Román', 'Román'] }, { userId: USER });
    assert.deepEqual(L.genreCounts([b]), [{ genre: 'Román', count: 1 }]);
  });
});

describe('zapamatovaný stav knihovny', () => {
  const good = { userId: USER, savedAt: NOW - 60000, sort: 'alpha', status: 'owned', genre: 'Sci-Fi', query: 'noc', visible: 72, scrollY: 4200 };

  test('platný stav se obnoví', () => {
    assert.deepEqual(L.normalizeLibraryState(good, { userId: USER, now: NOW }), { sort: 'alpha', status: 'owned', genre: 'Sci-Fi', query: 'noc', visible: 72, scrollY: 4200 });
  });

  test('cizí účet, stará, budoucí nebo rozbitá data = nic', () => {
    const n = (raw, opts = {}) => L.normalizeLibraryState(raw, { userId: USER, now: NOW, ...opts });
    assert.equal(n({ ...good, userId: 'jiny' }), null, 'jiný účet');
    assert.equal(n({ ...good, savedAt: NOW - L.STATE_TTL_MS - 1 }), null, 'příliš stará');
    assert.notEqual(n({ ...good, savedAt: NOW - L.STATE_TTL_MS }), null, 'právě na hranici ještě platí');
    assert.equal(n({ ...good, savedAt: NOW + 5000 }), null, 'uložená "v budoucnu" (přeřízené hodiny)');
    assert.equal(n({ ...good, savedAt: 'včera' }), null);
    assert.equal(n({ ...good, savedAt: undefined }), null);
    for (const raw of [null, undefined, 'text', 5, [], true]) assert.equal(n(raw), null);
    assert.equal(L.normalizeLibraryState(good, { userId: undefined, now: NOW }), null, 'bez přihlášeného uživatele');
  });

  test('neplatné části se nahradí výchozími a hodnoty se omezí', () => {
    const r = L.normalizeLibraryState({ ...good, sort: 'hack', status: 7, genre: 5, query: { a: 1 }, visible: -4, scrollY: 'x' }, { userId: USER, now: NOW });
    assert.deepEqual(r, { sort: 'smart', status: 'all', genre: 'all', query: '', visible: 0, scrollY: 0 });
    const big = L.normalizeLibraryState({ ...good, genre: 'g'.repeat(500), query: 'q'.repeat(500), visible: 1e12, scrollY: 1e15 }, { userId: USER, now: NOW });
    assert.equal(big.genre.length, 80);
    assert.equal(big.query.length, 200);
    assert.equal(big.visible, 100000);
    assert.equal(big.scrollY, 10000000);
    const frac = L.normalizeLibraryState({ ...good, visible: 24.9, scrollY: 100.7 }, { userId: USER, now: NOW });
    assert.equal(frac.visible, 24);
    assert.equal(frac.scrollY, 100);
  });

  test('stav, který odkazuje na neexistující žánr, se vrátí na "všechny"', () => {
    const books = [L.toLibraryBook({ id: 'x', title: 'T', genres: ['Román'] }, { userId: USER })];
    const st = { sort: 'smart', status: 'all', genre: 'Sci-Fi', query: '', visible: 24, scrollY: 100 };
    assert.deepEqual(L.sanitizeRestoredState(st, books), { ...st, genre: 'all' });
    assert.equal(L.sanitizeRestoredState({ ...st, genre: 'Román' }, books).genre, 'Román');
    assert.equal(L.sanitizeRestoredState({ ...st, genre: 'all' }, []).genre, 'all');
    assert.equal(L.sanitizeRestoredState(null, books), null);
  });

  test('žánry: nejčastějších dvanáct má tlačítko, zbytek je v rozbalovátku, vybraný žánr je vždy mezi tlačítky', () => {
    // nejčastější žánry jsou abecedně poslední (číslo 39 má nejvíc knih), ať se pořadí podle četnosti liší od abecedního
    const many = Array.from({ length: 40 }, (_, i) => ({ genre: 'Žánr ' + String(i).padStart(2, '0'), count: i + 1 }));
    const { chips, rest } = L.splitGenres(many, 'all');
    assert.equal(chips.length, 12);
    assert.deepEqual(chips.map((g) => g.genre), many.slice(28).map((g) => g.genre), 'nejčastějších dvanáct (28-39), zobrazených abecedně');
    assert.equal(rest.length, 28);
    assert.equal(chips.length + rest.length, 40);
    assert.ok(rest.every((g) => !chips.includes(g)));
    // vybraný žánr z rozbalovátka se přesune mezi tlačítka
    const sel = L.splitGenres(many, 'Žánr 00'); // nejméně častý žánr vybraný z rozbalovátka
    assert.equal(sel.chips.length, 13);
    assert.ok(sel.chips.some((g) => g.genre === 'Žánr 00'));
    assert.equal(sel.chips[0].genre, 'Žánr 00', 'mezi tlačítky abecedně');
    assert.ok(!sel.rest.some((g) => g.genre === 'Žánr 00'));
    // vybraný žánr, který už nemá žádnou knihu, je mezi tlačítky s nulou
    const none = L.splitGenres(many.slice(0, 5), 'Fantasy');
    assert.deepEqual(none.chips.find((g) => g.genre === 'Fantasy'), { genre: 'Fantasy', count: 0 });
    assert.equal(none.rest.length, 0);
    // málo žánrů = jen tlačítka
    assert.deepEqual(L.splitGenres([{ genre: 'A', count: 1 }], 'all'), { chips: [{ genre: 'A', count: 1 }], rest: [] });
    assert.deepEqual(L.splitGenres([], 'all'), { chips: [], rest: [] });
    // stejný počet knih: rozhoduje abeceda; obojí zůstává seřazené abecedně
    const ties = Array.from({ length: 20 }, (_, i) => ({ genre: String.fromCharCode(65 + i), count: 5 }));
    const t = L.splitGenres(ties, 'all');
    assert.deepEqual(t.chips.map((g) => g.genre), 'ABCDEFGHIJKL'.split(''));
    assert.deepEqual(t.rest.map((g) => g.genre), 'MNOPQRST'.split(''));
    // strop rozbalovátka
    const huge = Array.from({ length: 5000 }, (_, i) => ({ genre: 'G' + String(i).padStart(4, '0'), count: 1 }));
    assert.equal(L.splitGenres(huge, 'all').rest.length, L.MAX_GENRE_OPTIONS);
    assert.equal(many.length, 40, 'vstup se nemění');
  });

  test('vybraný žánr bez knih zůstane mezi tlačítky na abecedním místě', () => {
    const g = [{ genre: 'Detektivka', count: 2 }, { genre: 'Román', count: 5 }];
    assert.equal(L.withSelectedGenre(g, 'all'), g);
    assert.equal(L.withSelectedGenre(g, 'Román'), g, 'už tam je: beze změny');
    assert.deepEqual(L.withSelectedGenre(g, 'Fantasy'), [{ genre: 'Detektivka', count: 2 }, { genre: 'Fantasy', count: 0 }, { genre: 'Román', count: 5 }]);
    assert.deepEqual(L.withSelectedGenre([], 'Čtení'), [{ genre: 'Čtení', count: 0 }]);
    assert.equal(L.withSelectedGenre(g, undefined), g);
    assert.equal(g.length, 2, 'původní seznam se nemění');
  });

  test('stav platí tři hodiny (čtení jedné knihy trvá i hodinu)', () => {
    assert.equal(L.STATE_TTL_MS, 3 * 60 * 60 * 1000);
    const st = { userId: USER, savedAt: NOW - 2.5 * 3600000, sort: 'alpha', status: 'owned', genre: 'all', query: '', visible: 60, scrollY: 100 };
    assert.notEqual(L.normalizeLibraryState(st, { userId: USER, now: NOW }), null);
    assert.equal(L.normalizeLibraryState({ ...st, savedAt: NOW - 3.1 * 3600000 }, { userId: USER, now: NOW }), null);
  });

  test('uložit a znovu načíst dá totéž', () => {
    const st = { sort: 'likes', status: 'reading', genre: 'Román', query: 'ab', visible: 48, scrollY: 900 };
    assert.deepEqual(L.normalizeLibraryState(L.serializeLibraryState(USER, st, NOW), { userId: USER, now: NOW + 1000 }), st);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Načítání dat: falešný klient s chováním PostgREST (omezení počtu řádků, řazení, limit, podmínka "za klíčem", vložené
// počty, stav odpovědi a vkládání chyb).

const EMBED_ERROR = { code: 'PGRST200', message: 'Could not find a relationship between books and book_likes' };
const makeClient = (tables, { cap = Infinity, failEmbedded = null, failTables = [], faults = null } = {}) => {
  const log = [];
  const from = (table) => {
    const q = { select: null, filters: [], gts: [], order: [], range: null, limit: null, single: false };
    const exec = () => {
      const entry = { table, select: q.select, range: q.range, limit: q.limit, order: [...q.order], filters: [...q.filters], gts: [...q.gts] };
      log.push(entry);
      const nth = log.filter((l) => l.table === table).length; // pořadí dotazu na tuhle tabulku, od 1
      const fault = faults && faults(table, nth, entry);
      if (fault) return fault;
      if (failTables.includes(table)) return { data: null, error: { message: `chyba ${table}` }, status: 400 };
      const embedded = table === 'books' && /book_likes\(count\)/.test(q.select || '');
      if (embedded && failEmbedded) return { data: null, error: failEmbedded === true ? EMBED_ERROR : failEmbedded, status: 400 };
      let rows = (tables[table] || []).filter((r) => q.filters.every(([c, v]) => r[c] === v) && q.gts.every(([c, v]) => r[c] > v));
      rows = [...rows].sort((a, b) => { for (const c of q.order) { if (a[c] < b[c]) return -1; if (a[c] > b[c]) return 1; } return 0; });
      if (embedded) rows = rows.map((r) => ({ ...r, book_likes: [{ count: (tables.book_likes || []).filter((l) => l.book_id === r.id).length }] }));
      if (q.single) return { data: rows[0] ?? null, error: null, status: 200 };
      if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
      if (q.limit != null) rows = rows.slice(0, q.limit);
      return { data: rows.slice(0, cap), error: null, status: 200 };
    };
    const builder = {
      select(cols) { q.select = cols; return builder; },
      eq(c, v) { q.filters.push([c, v]); return builder; },
      gt(c, v) { q.gts.push([c, v]); return builder; },
      order(c) { q.order.push(c); return builder; },
      range(a, b) { q.range = [a, b]; return builder; },
      limit(n) { q.limit = n; return builder; },
      maybeSingle() { q.single = true; return builder; },
      then(res, rej) { return Promise.resolve(exec()).then(res, rej); },
    };
    return builder;
  };
  return { from, log };
};

const dbFixture = (nBooks, likesPer = 2) => {
  const rand = rng(77);
  const rows = Array.from({ length: nBooks }, (_, i) => makeRow(rand, i));
  const user_books = rows.filter((_, i) => i % 5 === 0).map((r, k) => ({ user_id: USER, book_id: r.id, is_read: k % 3 === 0, status: 'active', updated_at: new Date(NOW - k * 3600000).toISOString(), scroll_position: k % 3 === 1 ? 40 : 0 }));
  const book_likes = rows.flatMap((r, i) => Array.from({ length: i % (likesPer + 1) }, (_, k) => ({ book_id: r.id, user_id: k === 0 && i % 4 === 0 ? USER : `other-${k}` })));
  // Licence jiného čtenáře na knihu, kterou tenhle čtenář nevlastní: nesmí se mu započítat.
  const owned = new Set(user_books.map((u) => u.book_id));
  const foreign = rows.find((r) => r.author_id !== USER && !r.is_auto_assigned && !owned.has(r.id));
  return { books: rows, user_books: [...user_books, { user_id: 'other', book_id: foreign.id, status: 'active', is_read: true, scroll_position: 50 }], book_likes, profiles: [{ id: USER, coins: 321 }, { id: 'other', coins: 1 }], foreignId: foreign.id };
};

const FAST = { retryDelayMs: 0 }; // zkoušky nečekají mezi opakováními

describe('načítání po částech', () => {
  const pager = (total) => {
    const all = Array.from({ length: total }, (_, i) => ({ n: i }));
    const calls = [];
    return { calls, build: async (from, to) => { calls.push([from, to]); return { data: all.slice(from, to + 1), error: null }; }, all };
  };
  // Čtení po klíči: řádky mají rostoucí klíč id, dotaz dostane "za kterým klíčem" a limit.
  const keyPager = (total, { fail = () => null } = {}) => {
    const all = Array.from({ length: total }, (_, i) => ({ id: String(1000 + i) }));
    const calls = [];
    return { calls, all, build: async (after, limit) => {
      calls.push([after, limit]);
      const f = fail(calls.length);
      if (f) return f;
      return { data: all.filter((r) => after == null || r.id > after).slice(0, limit), error: null, status: 200 };
    } };
  };

  test('fetchAllRows (offset): málo řádků = jeden dotaz; přesný násobek = jeden prázdný dotaz navíc; víc částí se spojí v pořadí', async () => {
    for (const [total, requests] of [[0, 1], [1, 1], [9, 1], [10, 2], [11, 2], [25, 3], [30, 4]]) {
      const p = pager(total);
      const { data, error } = await D.fetchAllRows(p.build, { pageSize: 10 });
      assert.equal(error, null);
      assert.deepEqual(data, p.all, `${total} řádků`);
      assert.equal(p.calls.length, requests, `${total} řádků: ${JSON.stringify(p.calls)}`);
    }
  });

  test('fetchAllRows (offset): rozsahy na sebe navazují bez děr a překryvů; chyba a strop částí', async () => {
    const p = pager(95);
    await D.fetchAllRows(p.build, { pageSize: 10 });
    assert.deepEqual(p.calls.map(([a]) => a), [0, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
    assert.ok(p.calls.every(([a, b]) => b - a === 9));
    let n = 0;
    const res = await D.fetchAllRows(async () => (++n === 3 ? { data: null, error: { message: 'síť' } } : { data: Array.from({ length: 10 }, () => ({})), error: null }), { pageSize: 10 });
    assert.deepEqual(res, { data: null, error: { message: 'síť' } });
    const q = pager(1000);
    assert.equal((await D.fetchAllRows(q.build, { pageSize: 10, maxPages: 3 })).data.length, 30);
    assert.deepEqual((await D.fetchAllRows(async () => ({ data: null, error: null }))).data, []);
    assert.deepEqual((await D.fetchAllRows(async () => ({ data: 'x', error: null }))).data, []);
  });

  test('fetchAllRows (offset): přerušení zastaví další části', async () => {
    const p = pager(100);
    let stop = false;
    const res = await D.fetchAllRows(async (a, b) => { const r = await p.build(a, b); stop = true; return r; }, { pageSize: 10, isCancelled: () => stop });
    assert.ok(D.isCancelledError(res.error));
    assert.equal(p.calls.length, 1);
  });

  test('fetchAllByKey: každá další část začíná za posledním klíčem; málo řádků = jeden dotaz, přesný násobek = jeden prázdný navíc', async () => {
    for (const [total, requests] of [[0, 1], [1, 1], [9, 1], [10, 2], [11, 2], [25, 3], [30, 4]]) {
      const p = keyPager(total);
      const { data, error } = await D.fetchAllByKey(p.build, { pageSize: 10 });
      assert.equal(error, null);
      assert.deepEqual(data, p.all, `${total} řádků`);
      assert.equal(p.calls.length, requests, `${total} řádků`);
    }
    const p = keyPager(25);
    await D.fetchAllByKey(p.build, { pageSize: 10 });
    assert.deepEqual(p.calls, [[null, 10], ['1009', 10], ['1019', 10]], 'začátek bez podmínky, pak za posledním klíčem předchozí části');
  });

  test('fetchAllByKey: jiný klíč, strop částí s varováním, divná odpověď, hlášení průběhu', async () => {
    const calls = [];
    await D.fetchAllByKey(async (after) => { calls.push(after); return { data: calls.length < 3 ? [{ book_id: 'a' + calls.length }, { book_id: 'b' + calls.length }] : [], error: null }; }, { key: 'book_id', pageSize: 2 });
    assert.deepEqual(calls, [null, 'b1', 'b2']);
    const p = keyPager(1000);
    const warn = console.warn; let warned = 0; console.warn = () => { warned += 1; };
    try { assert.equal((await D.fetchAllByKey(p.build, { pageSize: 10, maxPages: 3 })).data.length, 30); } finally { console.warn = warn; }
    assert.equal(warned, 1, 'zkrácený seznam se nahlásí');
    assert.deepEqual((await D.fetchAllByKey(async () => ({ data: null, error: null }))).data, []);
    assert.deepEqual((await D.fetchAllByKey(async () => ({ data: 'x', error: null }))).data, []);
    const progress = [];
    await D.fetchAllByKey(keyPager(25).build, { pageSize: 10, onPage: (n) => progress.push(n) });
    assert.deepEqual(progress, [10, 20, 25]);
  });

  test('fetchAllByKey: přechodná chyba (síť, 5xx, 429) se zopakuje a další části se nezahodí; chyba dotazu ne', async () => {
    for (const status of [0, 500, 503, 429, 408]) {
      const p = keyPager(25, { fail: (n) => (n === 2 ? { data: null, error: { message: 'boom' }, status } : null) });
      const { data, error } = await D.fetchAllByKey(p.build, { pageSize: 10, ...FAST });
      assert.equal(error, null, `status ${status}`);
      assert.deepEqual(data, p.all, `status ${status}: celý seznam`);
      assert.equal(p.calls.length, 4, `status ${status}: 3 části + 1 opakování`);
      assert.deepEqual(p.calls[1], p.calls[2], 'opakuje se stejná část, ne od začátku');
    }
    const bad = keyPager(25, { fail: (n) => (n === 2 ? { data: null, error: { code: '42703', message: 'sloupec neexistuje' }, status: 400 } : null) });
    const res = await D.fetchAllByKey(bad.build, { pageSize: 10, ...FAST });
    assert.equal(res.data, null);
    assert.equal(res.error.code, '42703');
    assert.equal(bad.calls.length, 2, '400 se neopakuje');
  });

  test('fetchAllByKey: po vyčerpání opakování vrátí chybu (bez částečných dat)', async () => {
    const p = keyPager(25, { fail: (n) => (n >= 2 ? { data: null, error: { message: 'výpadek' }, status: 503 } : null) });
    const res = await D.fetchAllByKey(p.build, { pageSize: 10, retries: 2, ...FAST });
    assert.deepEqual(res, { data: null, error: { message: 'výpadek' } });
    assert.equal(p.calls.length, 1 + 3, 'první část + původní pokus a dvě opakování druhé');
    const none = await D.fetchAllByKey(keyPager(25, { fail: () => ({ data: null, error: { message: 'x' }, status: 500 }) }).build, { pageSize: 10, retries: 0 });
    assert.equal(none.error.message, 'x');
  });

  test('fetchAllByKey: přerušení zastaví načítání, i při čekání na opakování', async () => {
    const p = keyPager(100);
    let stop = false;
    const res = await D.fetchAllByKey(async (a, l) => { const r = await p.build(a, l); stop = true; return r; }, { pageSize: 10, isCancelled: () => stop });
    assert.ok(D.isCancelledError(res.error));
    assert.equal(p.calls.length, 1, 'po přerušení se už nic nečte');
    let cancelDuringRetry = false;
    const q = keyPager(100, { fail: () => ({ data: null, error: { message: 'x' }, status: 503 }) });
    const r2 = await D.fetchAllByKey(async (a, l) => { const r = await q.build(a, l); cancelDuringRetry = true; return r; }, { pageSize: 10, retryDelayMs: 1, isCancelled: () => cancelDuringRetry });
    assert.ok(D.isCancelledError(r2.error));
    assert.equal(q.calls.length, 1);
  });

  test('co se opakuje a co je problém vložených počtů', () => {
    for (const status of [0, 500, 502, 503, 504, 429, 408]) assert.equal(D.isTransient({ status, error: {} }), true, String(status));
    for (const status of [200, 400, 401, 403, 404, 406, 409]) assert.equal(D.isTransient({ status, error: {} }), false, String(status));
    assert.equal(D.isTransient({ status: 503, error: null }), false, 'bez chyby se nic neopakuje');
    assert.equal(D.isTransient(undefined), false);
    for (const e of [{ code: 'PGRST200' }, { code: 'PGRST201' }, { code: '42501' }, { message: 'Could not find a relationship between X and Y' }]) assert.equal(D.isEmbedProblem(e), true, JSON.stringify(e));
    for (const e of [{ code: '42703', message: 'column x does not exist' }, { code: 'PGRST301', message: 'JWT expired' }, { message: 'TypeError: Failed to fetch' }, null, undefined]) assert.equal(D.isEmbedProblem(e), false, JSON.stringify(e));
    assert.equal(D.isCancelledError({ cancelled: true }), true);
    assert.equal(D.isCancelledError({ message: 'x' }), false);
    assert.equal(D.isCancelledError(null), false);
  });
});

describe('načtení knihovny z databáze', () => {
  const stripped = (books) => books.map((b) => ({ ...b }));

  test('počty lajků jako jedno číslo u knihy, vlastnictví, lajky čtenáře, zůstatek, základní pořadí', async () => {
    const db = dbFixture(40);
    const client = makeClient(db);
    const { books, coins } = await D.loadLibrary(client, USER);
    assert.equal(coins, 321);
    assert.equal(books.length, 40);
    // žádné čtení všech lajků všech čtenářů
    const likeReads = client.log.filter((l) => l.table === 'book_likes');
    assert.ok(likeReads.length > 0 && likeReads.every((l) => l.filters.some(([c, v]) => c === 'user_id' && v === USER)), 'lajky se čtou jen čtenářovy');
    assert.ok(client.log.some((l) => l.table === 'books' && /book_likes\(count\)/.test(l.select)));
    // správně spočítané lajky (skutečné + falešné), vlastnictví a lajky čtenáře
    const byId = new Map(books.map((b) => [b.id, b]));
    for (const row of db.books) {
      const b = byId.get(row.id);
      assert.equal(b.likesCount, db.book_likes.filter((l) => l.book_id === row.id).length + (row.fake_likes || 0), row.id);
      assert.equal(b.isLiked, db.book_likes.some((l) => l.book_id === row.id && l.user_id === USER), row.id);
      const ub = db.user_books.find((u) => u.book_id === row.id && u.user_id === USER);
      assert.equal(b.hasAccess, row.author_id === USER || !!row.is_auto_assigned || ub?.status === 'active', row.id);
    }
    assert.deepEqual(books.map((b) => b.id), legacySmartSort(books).map((b) => b.id), 'základní pořadí');
    assert.equal(byId.get(db.foreignId).hasAccess, false, 'cizí licence se nepočítá');
    assert.equal(byId.get(db.foreignId).isRead, false);
  });

  test('čtení je řazené podle klíče, s limitem a bez offsetu', async () => {
    const client = makeClient(dbFixture(10));
    await D.loadLibrary(client, USER);
    const keyFor = { books: 'id', user_books: 'book_id', book_likes: 'book_id' };
    for (const l of client.log) {
      if (l.table === 'profiles') continue;
      assert.deepEqual(l.order, [keyFor[l.table]], `${l.table} se řadí podle ${keyFor[l.table]}`);
      assert.equal(l.limit, 500, `${l.table}: část po 500`);
      assert.equal(l.range, null, `${l.table}: žádný offset`);
      assert.deepEqual(l.gts, [], `${l.table}: první část bez podmínky na klíč`);
    }
  });

  test('víc knih než jedna část (i než omezení databáze na 1000 řádků): načtou se všechny, další část vždy za posledním klíčem', async () => {
    const db = dbFixture(1250);
    const client = makeClient(db, { cap: 1000 });
    const { books } = await D.loadLibrary(client, USER);
    assert.equal(books.length, 1250);
    assert.equal(new Set(books.map((b) => b.id)).size, 1250);
    const bookQueries = client.log.filter((l) => l.table === 'books');
    assert.equal(bookQueries.length, 3, '500 + 500 + 250');
    assert.deepEqual(bookQueries.map((q) => q.gts.map(([, v]) => v)), [[], [bookQueries[1].gts[0][1]], [bookQueries[2].gts[0][1]]]);
    const sortedIds = [...db.books.map((b) => b.id)].sort();
    assert.equal(bookQueries[1].gts[0][1], sortedIds[499], 'druhá část začíná za 500. knihou');
    assert.equal(bookQueries[2].gts[0][1], sortedIds[999], 'třetí část začíná za 1000. knihou');
  });

  test('bez podpory vložených počtů se použije starý postup, bere jen book_id a dá stejné knihy', async () => {
    const db = dbFixture(60);
    const a = await D.loadLibrary(makeClient(db), USER);
    const client = makeClient(db, { failEmbedded: true });
    const b = await D.loadLibrary(client, USER);
    assert.deepEqual(stripped(b.books), stripped(a.books));
    assert.ok(client.log.some((l) => l.table === 'books' && l.select === '*'), 'knihy se přečetly znovu bez vložených počtů');
    const all = client.log.filter((l) => l.table === 'book_likes' && !l.filters.some(([c]) => c === 'user_id'));
    assert.ok(all.length > 0, 'lajky se spočítaly zvlášť');
    assert.ok(all.every((l) => l.select === 'book_id' && l.order.join() === 'book_id,user_id'), 'stahuje se jen book_id (id čtenářů ne), řadí se podle obou');
  });

  test('záložní postup také zvládne víc než jednu část lajků', async () => {
    const db = dbFixture(700, 3);
    assert.ok(db.book_likes.length > 1000);
    const a = await D.loadLibrary(makeClient(db), USER);
    const b = await D.loadLibrary(makeClient(db, { failEmbedded: true, cap: 1000 }), USER);
    assert.deepEqual(stripped(b.books), stripped(a.books));
  });

  test('záloha jen při chybě vložených počtů; výpadek sítě, chyba serveru či jiná chyba dotazu ji nespustí', async () => {
    const db = dbFixture(30);
    for (const err of [{ code: 'PGRST200', message: 'x' }, { code: 'PGRST201', message: 'x' }, { code: '42501', message: 'permission denied' }]) {
      const client = makeClient(db, { failEmbedded: err });
      assert.equal((await D.loadLibrary(client, USER, FAST)).books.length, 30, JSON.stringify(err));
    }
    const warn = console.warn; console.warn = () => {};
    try {
      for (const faults of [
        (t) => (t === 'books' ? { data: null, error: { message: 'TypeError: Failed to fetch' }, status: 0 } : null),
        (t) => (t === 'books' ? { data: null, error: { message: 'Bad gateway' }, status: 502 } : null),
        (t) => (t === 'books' ? { data: null, error: { code: '42703', message: 'sloupec neexistuje' }, status: 400 } : null),
      ]) {
        const client = makeClient(db, { faults });
        await assert.rejects(() => D.loadLibrary(client, USER, FAST));
        assert.ok(!client.log.some((l) => l.table === 'books' && l.select === '*'), 'knihy se nečetly znovu bez vložených počtů');
        assert.ok(!client.log.some((l) => l.table === 'book_likes' && !l.filters.some(([c]) => c === 'user_id')), 'lajky všech čtenářů se nestahovaly');
      }
    } finally { console.warn = warn; }
  });

  test('zakopnutí jedné části (přechodná chyba) se opraví a knihovna se načte celá', async () => {
    const db = dbFixture(1100);
    const client = makeClient(db, { faults: (t, n) => (t === 'books' && n === 2 ? { data: null, error: { message: 'timeout' }, status: 504 } : null) });
    const { books } = await D.loadLibrary(client, USER, FAST);
    assert.equal(books.length, 1100);
    assert.equal(client.log.filter((l) => l.table === 'books').length, 4, '3 části + jedno opakování druhé');
  });

  test('licence čtenáře se musí načíst: chyba se vyhodí místo tiše špatného vlastnictví', async () => {
    const db = dbFixture(20);
    await assert.rejects(() => D.loadLibrary(makeClient(db, { failTables: ['user_books'] }), USER, FAST), { message: 'chyba user_books' });
    const warn = console.warn; console.warn = () => {};
    try {
      const noLikes = await D.loadLibrary(makeClient(db, { failTables: ['book_likes'] }), USER, FAST); // vlastní lajky: jen srdíčka se nevyplní
      assert.equal(noLikes.books.length, 20);
      assert.ok(noLikes.books.every((b) => b.isLiked === false));
    } finally { console.warn = warn; }
    const { books, coins } = await D.loadLibrary(makeClient(db, { failTables: ['profiles'] }), USER, FAST);
    assert.equal(books.length, 20);
    assert.equal(coins, null);
    const none = await D.loadLibrary(makeClient({ ...db, profiles: [] }), USER, FAST);
    assert.equal(none.coins, null);
  });

  test('chyba při čtení knih se vyhodí (i po záložním pokusu)', async () => {
    await assert.rejects(() => D.loadLibrary(makeClient(dbFixture(5), { failTables: ['books'] }), USER, FAST), { message: 'chyba books' });
    await assert.rejects(() => D.loadLibrary(makeClient(dbFixture(5), { failEmbedded: true, faults: (t, n, e) => (t === 'books' && e.select === '*' ? { data: null, error: { message: 'i bez vložených počtů selhalo' }, status: 400 } : null) }), USER, FAST), { message: 'i bez vložených počtů selhalo' });
  });

  test('přerušení: načítání se zastaví mezi částmi a vyhodí chybu, kterou jde poznat', async () => {
    const db = dbFixture(1300);
    let queries = 0;
    const client = makeClient(db, { faults: () => { queries += 1; return null; } });
    await assert.rejects(() => D.loadLibrary(client, USER, { isCancelled: () => queries >= 1 }), (e) => D.isCancelledError(e));
    assert.ok(client.log.filter((l) => l.table === 'books').length <= 1, 'další části knih se nečetly');
    // bez přerušení vše proběhne
    assert.equal((await D.loadLibrary(makeClient(db), USER, { isCancelled: () => false })).books.length, 1300);
  });

  test('hlášení průběhu: kolik knih je načteno po každé části', async () => {
    const progress = [];
    await D.loadLibrary(makeClient(dbFixture(1200)), USER, { onProgress: (n) => progress.push(n) });
    assert.deepEqual(progress, [500, 1000, 1200]);
  });

  test('žánry z databáze se vyčistí a sjednotí (Sci-Fi / sci-fi); divná data nic nerozbijí', async () => {
    const db = dbFixture(6);
    db.books[0].genres = ['Sci-Fi', ' sci-fi ', 'Román'];
    db.books[1].genres = ['sci-fi', { a: 1 }, null, 42, '   ', 'Fantasy'];
    db.books[2].genres = ['Sci-Fi'];
    db.books[3].genres = 'Román';
    db.books[4].genres = null;
    db.books[5].genres = ['roman', 'Román'];
    const { books } = await D.loadLibrary(makeClient(db), USER);
    const g = Object.fromEntries(books.map((b) => [b.id, b.genres]));
    assert.deepEqual(g[db.books[0].id], ['Sci-Fi', 'Román']);
    assert.deepEqual(g[db.books[1].id], ['Sci-Fi', 'Fantasy'], 'sjednocený zápis a bez divných prvků');
    assert.deepEqual(g[db.books[2].id], ['Sci-Fi']);
    assert.deepEqual(g[db.books[3].id], []);
    assert.deepEqual(g[db.books[4].id], []);
    assert.deepEqual(g[db.books[5].id], ['Román'], 'roman a Román jsou jeden žánr (nejčastější zápis)');
  });

  test('loadCatalog (pro vyhledávací okno): řádky, licence čtenáře, počty lajků jedním číslem a zůstatek', async () => {
    const db = dbFixture(50);
    const client = makeClient(db);
    const { rows, userBooks, likes, coins } = await D.loadCatalog(client, USER);
    assert.equal(rows.length, 50);
    assert.equal(coins, 321);
    assert.ok(userBooks.length > 0 && userBooks.every((u) => u.user_id === undefined || u.user_id === USER), 'jen licence tohoto čtenáře');
    assert.ok(!userBooks.some((u) => u.book_id === db.foreignId), 'cizí licence se nevrací');
    for (const row of rows) {
      assert.equal(likes.count(row), db.book_likes.filter((l) => l.book_id === row.id).length, row.id);
      assert.equal(likes.liked(row.id), db.book_likes.some((l) => l.book_id === row.id && l.user_id === USER), row.id);
    }
    assert.ok(client.log.filter((l) => l.table === 'book_likes').every((l) => l.filters.some(([c, v]) => c === 'user_id' && v === USER)), 'lajky všech čtenářů se nestahují');
    // záloha dává tytéž počty
    const fb = await D.loadCatalog(makeClient(db, { failEmbedded: true }), USER);
    for (const row of fb.rows) assert.equal(fb.likes.count(row), likes.count(rows.find((r) => r.id === row.id)), row.id);
  });

  test('kniha vložená nebo smazaná mezi dvěma částmi nic nezdvojí ani nepřeskočí', async () => {
    const mutate = async (change) => {
      const db = dbFixture(600); // víc než jedna část (500)
      const base = makeClient(db);
      let bookQueries = 0;
      const client = { from: (table) => {
        const q = base.from(table);
        if (table !== 'books') return q;
        const run = q.then.bind(q);
        q.then = (res, rej) => { bookQueries += 1; if (bookQueries === 2) change(db); return run(res, rej); };
        return q;
      } };
      const { rows } = await D.loadCatalog(client, USER);
      assert.equal(bookQueries, 2, 'zkouška opravdu čte dvě části');
      return { ids: rows.map((r) => r.id), db };
    };
    // vložení na začátek (offset by všechno posunul a poslední řádek první části by přišel podruhé)
    const inserted = await mutate((db) => db.books.unshift({ ...db.books[0], id: 'a-nova' }));
    assert.equal(new Set(inserted.ids).size, inserted.ids.length, 'žádné id dvakrát');
    assert.equal(inserted.ids.length, 600, 'všech 600 původních knih (nová se objeví při dalším načtení)');
    // smazání už přečtené knihy (offset by přeskočil jednu knihu z druhé části)
    const deleted = await mutate((db) => { db.books.splice(100, 1); });
    assert.equal(new Set(deleted.ids).size, deleted.ids.length);
    assert.equal(deleted.ids.length, 600, 'smazaná kniha už byla načtená, žádná jiná se nepřeskočí');
  });

  test('prázdná knihovna', async () => {
    const { books } = await D.loadLibrary(makeClient({ books: [], profiles: [{ id: USER, coins: 0 }] }), USER);
    assert.deepEqual(books, []);
  });
});

describe('zapamatování v úložišti', () => {
  const fakeStorage = (initial = {}) => { const m = new Map(Object.entries(initial)); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } }; };
  const st = { sort: 'alpha', status: 'owned', genre: 'Sci-Fi', query: 'noc', visible: 48, scrollY: 1234 };

  test('způsob zobrazení: výchozí mřížka, uloží se a přečte; nesmysl a nedostupné úložiště = mřížka', () => {
    const s = fakeStorage();
    assert.equal(S.readViewMode(s), 'grid');
    S.writeViewMode('list', s);
    assert.equal(S.readViewMode(s), 'list');
    S.writeViewMode('nesmysl', s);
    assert.equal(S.readViewMode(s), 'grid');
    assert.deepEqual([...s.m.values()], ['grid'], 'nesmyslná hodnota se do úložiště vůbec nezapíše');
    S.writeViewMode('list', s);
    assert.deepEqual([...s.m.values()], ['list']);
    const key = [...s.m.keys()][0];
    assert.equal(S.readViewMode(fakeStorage({ [key]: 'tabulka' })), 'grid', 'nesmyslná hodnota už v úložišti (stará verze, ruční zásah)');
    assert.equal(S.readViewMode(fakeStorage({ [key]: 'list' })), 'list');
    const broken = { getItem() { throw new Error('zakázáno'); }, setItem() { throw new Error('zakázáno'); } };
    assert.equal(S.readViewMode(broken), 'grid');
    assert.doesNotThrow(() => S.writeViewMode('list', broken));
    assert.equal(S.readViewMode(null), 'grid');
    assert.doesNotThrow(() => S.writeViewMode('list', null));
  });

  test('stav knihovny: uložit a obnovit stejnému uživateli; jinému ne', () => {
    const s = fakeStorage();
    S.writeLibraryState(USER, st, { storage: s, now: NOW });
    assert.deepEqual(S.readLibraryState(USER, { storage: s, now: NOW + 5000 }), st);
    assert.equal(S.readLibraryState('jiny', { storage: s, now: NOW + 5000 }), null);
    assert.equal(S.readLibraryState(USER, { storage: s, now: NOW + L.STATE_TTL_MS + 5000 }), null, 'po uplynutí platnosti se zapomene');
  });

  test('propadlý, cizí nebo rozbitý stav se při čtení smaže; platný zůstane; odhlášení smaže všechno', () => {
    const fresh = () => { const s = fakeStorage(); S.writeLibraryState(USER, st, { storage: s, now: NOW }); return s; };
    const s1 = fresh(); assert.equal(S.readLibraryState(USER, { storage: s1, now: NOW + 1000 })?.query, 'noc'); assert.equal(s1.m.size, 1, 'platný stav zůstane');
    const s2 = fresh(); assert.equal(S.readLibraryState('jiny', { storage: s2, now: NOW + 1000 }), null); assert.equal(s2.m.size, 0, 'cizí stav se smaže');
    const s3 = fresh(); assert.equal(S.readLibraryState(USER, { storage: s3, now: NOW + L.STATE_TTL_MS + 1000 }), null); assert.equal(s3.m.size, 0, 'propadlý stav se smaže');
    const s4 = fakeStorage({ 'jomarid.library.state': '{rozbité' }); assert.equal(S.readLibraryState(USER, { storage: s4, now: NOW }), null); assert.equal(s4.m.size, 0, 'rozbitý stav se smaže');
    const s5 = fresh(); assert.equal(S.readLibraryState(undefined, { storage: s5, now: NOW }), null); assert.equal(s5.m.size, 1, 'bez uživatele se nic nemaže');
    const s6 = fresh(); S.clearLibraryState({ storage: s6 }); assert.equal(s6.m.size, 0);
    assert.doesNotThrow(() => S.clearLibraryState({ storage: null }));
    assert.doesNotThrow(() => S.clearLibraryState({ storage: { removeItem() { throw new Error('x'); } } }));
  });

  test('rozbitá data, nedostupné úložiště a chybějící uživatel nic nerozbijí', () => {
    const key = [...(() => { const s = fakeStorage(); S.writeLibraryState(USER, st, { storage: s, now: NOW }); return s.m.keys(); })()][0];
    assert.equal(S.readLibraryState(USER, { storage: fakeStorage({ [key]: '{rozbité' }), now: NOW }), null);
    assert.equal(S.readLibraryState(USER, { storage: fakeStorage({ [key]: 'null' }), now: NOW }), null);
    const broken = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
    assert.equal(S.readLibraryState(USER, { storage: broken, now: NOW }), null);
    assert.doesNotThrow(() => S.writeLibraryState(USER, st, { storage: broken, now: NOW }));
    assert.equal(S.readLibraryState(USER, { storage: null, now: NOW }), null);
    const s = fakeStorage();
    S.writeLibraryState(undefined, st, { storage: s, now: NOW });
    assert.equal(s.m.size, 0, 'bez uživatele se nic neukládá');
  });
});
