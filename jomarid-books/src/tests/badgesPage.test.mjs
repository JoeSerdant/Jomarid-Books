// Testy stránky Odznaky (odznaky knih a her, tituly, vzhled her) a sdíleného načítání statistik, které ze Statistik přešlo do src/stats/loadStats.js.
//   npm run test:badges
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMPTY_LEADERBOARDS, EMPTY_STATS, boardStreak, boardStreakInfo, loadLeaderboards, loadMyStats } from '../stats/loadStats.js';
import { FROZEN_ROW_IMAGE, FROZEN_ROW_BORDER, boardRowStyle, isFrozenRow } from '../stats/boardRow.js';
import { BOOK_BADGES } from '../constants/badges.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8').replace(/\r\n/g, '\n');

/* ---------------------------------------------------------------- napojení do appky */
test('trasa /badges/:tab? je jen pro přihlášené a stránka se stahuje až při otevření', () => {
  const app = read('App.jsx');
  assert.match(app, /const BadgesPage = lazyPage\(\(\) => import\('\.\/pages\/Badges'\), 'BadgesPage'\);/);
  assert.match(app, /<Route path="\/badges\/:tab\?" element=\{<ProtectedUserRoute><BadgesPage \/><\/ProtectedUserRoute>\} \/>/);
});

test('v menu je odkaz Odznaky mezi Statistikami a Hrami a prohlídka ho zná', () => {
  const nav = read('components', 'Navbar.jsx');
  const at = (needle) => nav.indexOf(needle);
  assert.ok(at('to="/stats"') < at('to="/badges"') && at('to="/badges"') < at('to="/games"'), 'pořadí odkazů');
  assert.match(nav, /to="\/badges" \n\s*data-tour="nav-badges"/);
  assert.match(nav, />Odznaky</);
  assert.match(read('pages', 'HomePage.jsx'), /navigate\('\/badges'\)[^\n]*\n\s*<Trophy size=\{18\} \/> Odznaky/, 'tlačítko Odznaky na úvodní stránce vede na novou stránku');
});

test('stránka má záložky Odznaky knih, Odznaky her a Tituly a vzhled her; obchůdek jen když je v databázi', () => {
  const page = read('pages', 'Badges.jsx');
  assert.deepEqual([...page.matchAll(/\{ id: '(\w+)', label: '([^']+)', icon:/g)].map((m) => [m[1], m[2]]),
    [['books', 'Odznaky knih'], ['games', 'Odznaky her'], ['shop', 'Tituly a vzhled her']]);
  assert.match(page, /export const tabPath = \(id\) => \(id === BADGE_TABS\[0\]\.id \? '\/badges' : `\/badges\/\$\{id\}`\);/);
  assert.match(page, /const tabs = cosmetics \? BADGE_TABS : BADGE_TABS\.filter\(\(t\) => t\.id !== 'shop'\);/);
  assert.match(page, /const active = tabs\.some\(\(t\) => t\.id === tab\) \? tab : tabs\[0\]\.id;/, 'neznámá záložka nebo chybějící obchůdek spadne na první');
  assert.match(page, /\{active === 'books' && <BadgesSection stats=\{stats\} \/>\}/);
  assert.match(page, /\{active === 'games' && <GamesProgress progress=\{stats\.gameProgress \|\| EMPTY_PROGRESS\} userId=\{user\?\.id\} \/>\}/);
  assert.match(page, /\{active === 'shop' && cosmetics && \(\s*<Shop/);
  assert.match(page, /aria-current=\{on \? 'page' : undefined\}/);
  assert.match(page, /role="alert"/, 'chyba načtení se řekne, ne bílá stránka');
});

test('Statistiky už odznaky ani obchůdek nenesou, jen odkaz na stránku Odznaky se souhrnem', () => {
  const stats = read('pages', 'UserStats.jsx');
  assert.doesNotMatch(stats, /BadgesSection|GamesProgress|<Shop/);
  assert.match(stats, /<Link\s+to="\/badges"\s+data-testid="badges-link"/);
  assert.match(stats, /Odznaky knih: \{stats\.unlockedBadges\.length\} z \{BOOK_BADGES\.length\}\. Odznaky her: \{countGameBadges\(stats\.gameProgress\?\.unlocked\)\.unlocked\} z \{countGameBadges\(stats\.gameProgress\?\.unlocked\)\.total\}\./);
  assert.match(stats, /loadMyStats\(supabase, user\)/);
  assert.match(stats, /loadLeaderboards\(supabase, user, mine\.stats\)/);
});

test('stránka Odznaky načítá jen vlastní statistiky (žebříčky ne), stejným výpočtem jako Statistiky', () => {
  const page = read('pages', 'Badges.jsx');
  assert.match(page, /loadMyStats\(supabase, user\)/);
  assert.doesNotMatch(page, /loadLeaderboards/);
});

test('npm test pouští i testy stránky Odznaky', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(SRC, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['test:badges'], 'node --test src/tests/badgesPage.test.mjs');
  assert.ok(pkg.scripts.test.includes('npm run test:badges'));
});

/* ---------------------------------------------------------------- sdílené načtení statistik */
// Atrapa klienta: tabulky vrací zadané řádky (dotaz jde řetězit a jde ho očekávat), funkce serveru podle mapy.
function fakeClient({ profile = {}, books = [], activity = [], rpc = {} } = {}) {
  const calls = [];
  const table = (rows, single) => {
    const q = { select: () => q, eq: () => q, order: () => q, range: () => q, maybeSingle: async () => ({ data: single, error: null }), then: (resolve) => resolve({ data: rows, error: null }) };
    return q;
  };
  return {
    calls,
    from: (name) => (name === 'profiles' ? table(null, profile) : name === 'user_books' ? table(books) : table(activity)),
    rpc: async (fn, args) => {
      calls.push([fn, args]);
      const handler = rpc[fn];
      return handler ? handler(args) : { data: null, error: { message: `chybí funkce ${fn}` } };
    },
  };
}
const quiet = async (fn) => { const e = console.error; const w = console.warn; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; } };
const USER = { id: 'u1' };
globalThis.localStorage = { getItem: () => null, setItem() {} };   // loader čte starý místní cíl, když ho profil nemá
const doneBook = (daysAgo = 1) => ({ updated_at: new Date(Date.now() - daysAgo * 864e5).toISOString(), first_completed_at: new Date(Date.now() - daysAgo * 864e5).toISOString(), is_read: true });

test('loadMyStats: čtenář bez knih má úroveň 1, žádné odznaky a na server se nic nehlásí', async () => {
  const client = fakeClient({ profile: { coins: 40, lifetime_coins_earned: 40 }, rpc: { resolve_streak: async () => ({ data: { streak: 0, streak_freezes: 1, frozen_dates: [] }, error: null }) } });
  const { stats, cosmetics } = await quiet(() => loadMyStats(client, USER));
  assert.equal(stats.totalRead, 0); assert.equal(stats.level, 1); assert.deepEqual(stats.unlockedBadges, []);
  assert.equal(stats.jomaridCoins, 40); assert.equal(stats.streakFreezes, 1);
  assert.equal(cosmetics, null, 'bez obchůdku v databázi (funkce chybí) je null a stránka záložku neukáže');
  assert.ok(!client.calls.some(([fn]) => fn === 'grant_badge_rewards'), 'bez splněného odznaku se nic neodemyká');
  assert.deepEqual(Object.keys(stats).sort(), Object.keys(EMPTY_STATS).sort().concat('gameProgress').sort(), 'stejný tvar jako prázdný stav (plus herní postup)');
});

test('loadMyStats: přečtená kniha odemkne odznak knihy jen přes server (posílá se jen seznam id) a vrátí jeho mince', async () => {
  const first = BOOK_BADGES.find((b) => b.id === 'bookworm_1');
  const client = fakeClient({
    profile: { coins: 10, lifetime_coins_earned: 10, unlocked_badges: [] },
    books: [doneBook()],
    rpc: {
      resolve_streak: async () => ({ data: { streak: 0, streak_freezes: 0, frozen_dates: [] }, error: null }),
      grant_badge_rewards: async ({ badge_ids }) => ({ data: { unlocked_badges: badge_ids, coins: 10 + first.rewardCoins }, error: null }),
      my_cosmetics: async () => ({ data: { owned: ['title_night'], equipped: { title: 'title_night' } }, error: null }),
    },
  });
  const { stats, cosmetics } = await quiet(() => loadMyStats(client, USER));
  const grant = client.calls.find(([fn]) => fn === 'grant_badge_rewards');
  assert.ok(grant && grant[1].badge_ids.includes('bookworm_1'), 'první kniha odemkne První Průzkumník');
  assert.deepEqual(Object.keys(grant[1]), ['badge_ids'], 'klient nikdy neposílá vlastní částku');
  assert.ok(stats.unlockedBadges.includes('bookworm_1'));
  assert.equal(stats.jomaridCoins, 10 + first.rewardCoins, 'zůstatek je ten, který vrátil server');
  assert.deepEqual(cosmetics, { owned: ['title_night'], equipped: { title: 'title_night' } });
  assert.equal(stats.totalRead, 1); assert.equal(stats.monthlyRead, 1);
});

test('loadMyStats: když server odznak nepřipíše, odznak se ukáže aspoň v téhle návštěvě a příště se zkusí znovu', async () => {
  const client = fakeClient({
    profile: { coins: 0, lifetime_coins_earned: 0, unlocked_badges: [] },
    books: [doneBook()],
    rpc: { resolve_streak: async () => ({ data: { streak: 0, streak_freezes: 0, frozen_dates: [] }, error: null }), grant_badge_rewards: async () => ({ data: null, error: { message: 'výpadek' } }) },
  });
  const { stats } = await quiet(() => loadMyStats(client, USER));
  assert.ok(stats.unlockedBadges.includes('bookworm_1'));
  assert.equal(stats.jomaridCoins, 0, 'mince se bez serveru nepřipíšou');
});

test('loadMyStats: herní XP se do úrovně přičítá až po vyhodnocení odznaků knih (hry neodemykají odznaky za úroveň)', async () => {
  const client = fakeClient({
    profile: { coins: 0, lifetime_coins_earned: 0 },
    rpc: {
      resolve_streak: async () => ({ data: { streak: 0, streak_freezes: 0, frozen_dates: [] }, error: null }),
      my_game_progress: async () => ({ data: { records: {}, unlocked: ['rocket_ace'], xp: 400 }, error: null }),
    },
  });
  const { stats } = await quiet(() => loadMyStats(client, USER));
  assert.equal(stats.gameProgress.xp, 400);
  assert.ok(stats.level >= 4, `s 400 XP z her je úroveň aspoň 4 (je ${stats.level})`);
  assert.ok(!client.calls.some(([fn]) => fn === 'grant_badge_rewards'), 'herní XP nespustí odznaky za úroveň');
});

test('loadLeaderboards: bez žebříčku nebo při chybě vrací null; jinak deset nejlepších v pěti kategoriích s titulem a značkou „já“', async () => {
  assert.equal(await quiet(() => loadLeaderboards(fakeClient({}), USER)), null, 'funkce chybí');
  assert.equal(await quiet(() => loadLeaderboards(fakeClient({ rpc: { leaderboard_profiles: async () => ({ data: [], error: null }) } }), USER)), null, 'prázdný žebříček');
  const board = await quiet(() => loadLeaderboards(fakeClient({
    books: [{ user_id: 'u1', first_completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
    rpc: {
      leaderboard_profiles: async () => ({ data: [{ id: 'u1', username: 'jana', highest_goal_completed: 25 }, { id: 'u2', username: 'petr', highest_goal_completed: 25 }], error: null }),
      game_xp_totals: async () => ({ data: [{ user_id: 'u2', xp: 30 }], error: null }),
      equipped_titles: async () => ({ data: [{ user_id: 'u1', item_id: 'title_night' }], error: null }),
    },
  }), USER));
  assert.deepEqual(Object.keys(board).sort(), Object.keys(EMPTY_LEADERBOARDS).sort());
  const me = board.totalRead.find((r) => r.isMe);
  assert.equal(me.email, 'jana'); assert.equal(me.title, 'Noční sova'); assert.equal(me.totalRead, 1);
  assert.equal(board.level.length, 2);
  assert.equal(board.xp.find((r) => r.email === 'petr').xp > 0, true, 'XP z her se do žebříčku počítá');
});

// Atrapa, která drží rozsah dotazu (range) jako opravdový server: vrací nejvýš 1000 řádků na stránku.
function pagingClient({ books, activity, profiles, rpc = {} }) {
  const seen = { books: 0, activity: 0 };
  const table = (rows, key) => {
    let from = 0; let to = 999;
    const q = { select: () => q, eq: () => q, order: () => q, range: (a, b) => { from = a; to = Math.min(b, a + 999); return q; }, then: (resolve) => { seen[key] += 1; resolve({ data: rows.slice(from, to + 1), error: null }); } };
    return q;
  };
  return {
    seen,
    from: (name) => (name === 'user_books' ? table(books, 'books') : table(activity, 'activity')),
    rpc: async (fn) => (fn === 'leaderboard_profiles' ? { data: profiles, error: null } : rpc[fn] ? rpc[fn]() : { data: null, error: { message: 'chybí' } }),
  };
}
const dayStr = (daysAgo) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); return d.toLocaleDateString('sv'); };

test('loadLeaderboards: čte všechny stránky dat (server vrací najednou nejvýš 1000 řádků), ať žebříček nepodhodnotí nikoho', async () => {
  // 1500 dnů aktivity u jednoho čtenáře a 1200 knih u druhého: bez stránkování by se po 1000. řádku ostatní data ztratila
  const activity = Array.from({ length: 1500 }, (_, i) => ({ user_id: 'u1', activity_date: dayStr(i) }));
  const books = Array.from({ length: 1200 }, () => ({ user_id: 'u2', first_completed_at: '2020-01-01T10:00:00Z', updated_at: '2020-01-01T10:00:00Z' }));
  const client = pagingClient({ books, activity, profiles: [{ id: 'u1', username: 'jana' }, { id: 'u2', username: 'petr' }] });
  const board = await quiet(() => loadLeaderboards(client, USER));
  assert.equal(board.streak.find((r) => r.email === 'jana').streak, 1500, 'celá série se dočetla i za hranici 1000 řádků');
  assert.equal(board.totalRead.find((r) => r.email === 'petr').totalRead, 1200);
  assert.equal(client.seen.activity, 2, '1500 řádků = dvě stránky');
  assert.equal(client.seen.books, 2);
});

test('loadLeaderboards: řádek přihlášeného se bere z jeho vlastních statistik; při shodě rozhoduje XP; kdo není v desítce, přibude pod ní s pořadím', async () => {
  const profiles = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, username: `hrac${String(i).padStart(2, '0')}`, highest_goal_completed: 25 }));
  profiles.push({ id: 'u1', username: 'jana', highest_goal_completed: 25 });
  const books = profiles.slice(0, 12).flatMap((p, i) => Array.from({ length: 12 - i }, () => ({ user_id: p.id, first_completed_at: '2020-01-01T10:00:00Z', updated_at: '2020-01-01T10:00:00Z' })));
  const mine = { streak: 4, level: 2, totalRead: 0, monthlyRead: 0, totalXp: 250 };
  const board = await quiet(() => loadLeaderboards(pagingClient({ books, activity: [], profiles }), USER, mine));
  const me = board.xp.at(-1);
  assert.equal(me.isMe, true); assert.equal(me.xp, 250, 'XP je to, co vidí sám nahoře');
  assert.equal(board.xp.length, 11, 'deset nejlepších a pod nimi přihlášený');
  assert.ok(me.rank > 10 && me.rank <= 13, `skutečné pořadí (${me.rank}), ne pozice v seznamu`);
  assert.equal(board.xp.filter((r) => r.rank < me.rank).length, 10, 'před ním je přesně těch deset zobrazených');
  assert.equal(board.streak[0].isMe, true, 'série 4 dny z vlastních statistik je první');
  assert.equal(board.streak[0].rank, 1);
  // stejný počet knih: výš je ten s víc XP, při úplné shodě podle jména
  const tie = await quiet(() => loadLeaderboards(pagingClient({ books: [], activity: [], profiles: [{ id: 'b', username: 'bara', fake_xp: 0 }, { id: 'a', username: 'adam', fake_xp: 500 }, { id: 'c', username: 'cyril', fake_xp: 500 }] }), { id: 'x' }));
  assert.deepEqual(tie.totalRead.map((r) => r.email), ['adam', 'cyril', 'bara']);
});

test('série v žebříčku: zmeškaný den zachráněný pojistkou sérii nepřeruší (čtenář s osmi dny nemá 0)', async () => {
  const set = (...d) => new Set(d);
  const [today, yest, before] = [dayStr(0), dayStr(1), dayStr(2)];
  const base = (streak, ...frozen) => ({ streak, frozen: new Set(frozen) });
  const s = (b, acts) => boardStreak({ base: b, acts, todayStr: today, yestStr: yest });
  assert.equal(s(base(8, yest), set(before)), 8, 'včera pojistka, dnes ještě nečetl: série drží');
  assert.equal(s(base(8, yest), set(before, today)), 9, 'a dnes četl: dnešek se připočte jako u vlastní série');
  assert.equal(s(base(8), set(yest)), 8, 'včera četl, dnes ještě ne');
  assert.equal(s(base(8), set(before)), 0, 'včera ani dnes nečetl a nemá pojistku: série skončila');
  assert.equal(s(base(0), set(today)), 1, 'nová série dnešním čtením');
  // bez dat ze serveru (SQL ještě neběží) se počítá jen z dnů čtení
  assert.equal(s(null, set(today, yest, before)), 3);
  assert.equal(s(null, set(yest, before)), 2);
  assert.equal(s(null, set(before)), 0);
});

test('loadLeaderboards: série ostatních se bere ze serveru (leaderboard_streaks), bez něj ze dnů čtení', async () => {
  const profiles = [{ id: 'alex', username: 'alex' }, { id: 'pavla', username: 'pavla' }, { id: 'u1', username: 'jana' }];
  const activity = [{ user_id: 'pavla', activity_date: dayStr(0) }, { user_id: 'alex', activity_date: dayStr(2) }];
  const withServer = await quiet(() => loadLeaderboards(pagingClient({ books: [], activity, profiles, rpc: {
    leaderboard_streaks: async () => ({ data: [{ user_id: 'alex', current_streak: 8, frozen_dates: [dayStr(1)] }, { user_id: 'pavla', current_streak: 0, frozen_dates: [] }], error: null }),
  } }), USER));
  assert.equal(withServer.streak.find((r) => r.email === 'alex').streak, 8, 'pojistka včera: série drží');
  assert.equal(withServer.streak.find((r) => r.email === 'pavla').streak, 1);
  const withoutServer = await quiet(() => loadLeaderboards(pagingClient({ books: [], activity, profiles }), USER));
  assert.equal(withoutServer.streak.find((r) => r.email === 'alex').streak, 0, 'bez SQL se pojistky neznají (původní chování)');
  assert.equal(withoutServer.streak.find((r) => r.email === 'pavla').streak, 1);
});

// ---- zmrzlá série v žebříčku: řádek je modrý, ne nula ----
test('boardStreakInfo: série drží pojistka (včera zachráněný den, dnes se nečetlo) → zmrzlá, ne nula', () => {
  const set = (...d) => new Set(d);
  const [today, yest, before, older] = [dayStr(0), dayStr(1), dayStr(2), dayStr(3)];
  const info = (base, acts) => boardStreakInfo({ base, acts, todayStr: today, yestStr: yest });
  const base = (streak, frozen = [], freezes = 0) => ({ streak, frozen: new Set(frozen), freezes });
  assert.deepEqual(info(base(8, [yest]), set(before)), { streak: 8, frozen: true }, 'včera pojistka, dnes ještě nečetl');
  assert.deepEqual(info(base(8, [today]), set(before)), { streak: 8, frozen: true }, 'pojistka zachránila i dnešek');
  assert.deepEqual(info(base(8, [yest]), set(before, today)), { streak: 9, frozen: false }, 'dnes zase četl: už není zmrzlá, dnešek se připočte');
  assert.deepEqual(info(base(8), set(yest)), { streak: 8, frozen: false }, 'včera četl: obyčejná série, žádná pojistka');
  assert.deepEqual(info(base(0, [yest]), set()), { streak: 0, frozen: false }, 'není co držet: nula bez modré');
  assert.deepEqual(info(base(8), set(before)), { streak: 0, frozen: false }, 'bez pojistky a bez čtení série skončila');
  assert.deepEqual(info(null, set(today, yest)), { streak: 2, frozen: false }, 'bez dat ze serveru se nic nepředpokládá');
  assert.equal(boardStreak({ base: base(8, [yest]), acts: set(before), todayStr: today, yestStr: yest }), 8, 'boardStreak vrací jen číslo jako dřív');
  void older;
});

test('boardStreakInfo: čtenář, který zmeškal den a appku ještě neotevřel (pojistky v zásobě, server je zatím nespotřeboval)', () => {
  const set = (...d) => new Set(d);
  const [today, yest, before, older, oldest] = [dayStr(0), dayStr(1), dayStr(2), dayStr(3), dayStr(4)];
  const info = (base, acts) => boardStreakInfo({ base, acts, todayStr: today, yestStr: yest });
  const base = (streak, freezes, frozen = []) => ({ streak, frozen: new Set(frozen), freezes });
  assert.deepEqual(info(base(8, 1), set(before)), { streak: 8, frozen: true }, 'jeden zmeškaný den, jedna pojistka');
  assert.deepEqual(info(base(8, 2), set(older)), { streak: 8, frozen: true }, 'dva zmeškané dny, dvě pojistky');
  assert.deepEqual(info(base(8, 1), set(older)), { streak: 0, frozen: false }, 'dva zmeškané dny, ale jen jedna pojistka: série skončila');
  assert.deepEqual(info(base(8, 3), set(oldest)), { streak: 8, frozen: true }, 'tři dny, tři pojistky');
  assert.deepEqual(info(base(8, 0), set(before)), { streak: 0, frozen: false }, 'bez pojistky se nic nepředpokládá');
  assert.deepEqual(info(base(8, 1, [before]), set(older)), { streak: 8, frozen: true }, 'dřívější den už zachráněn serverem, včerejšek pokryje zásoba');
  assert.deepEqual(info(base(8, 5), set()), { streak: 0, frozen: false }, 'bez jediného dne čtení a bez zachráněného dne není na co navázat');
  assert.deepEqual(info(base(0, 2), set(before)), { streak: 0, frozen: false }, 'nulová série se nezmrazuje');
  assert.deepEqual(info({ streak: 8, frozen: new Set() }, set(before)), { streak: 0, frozen: false }, 'starší funkce bez počtu pojistek: chování jako dřív');
});

test('boardStreakInfo: přechod měsíce, roku a letního času nezmění počítání dní', () => {
  const info = (base, acts, today, yest) => boardStreakInfo({ base, acts, todayStr: today, yestStr: yest });
  const base = { streak: 5, frozen: new Set(), freezes: 2 };
  assert.deepEqual(info(base, new Set(['2026-02-28']), '2026-03-02', '2026-03-01'), { streak: 5, frozen: true }, 'únor → březen');
  assert.deepEqual(info(base, new Set(['2025-12-30']), '2026-01-02', '2026-01-01'), { streak: 5, frozen: true }, 'konec roku');
  assert.deepEqual(info(base, new Set(['2026-03-28']), '2026-03-30', '2026-03-29'), { streak: 5, frozen: true }, 'přechod na letní čas (29. 3. 2026)');
  assert.deepEqual(info(base, new Set(['2026-10-24']), '2026-10-26', '2026-10-25'), { streak: 5, frozen: true }, 'přechod na zimní čas (25. 10. 2026)');
});

test('loadLeaderboards: zmrzlá série (pojistka včera nebo v zásobě) není nula a řádek je označený; ostatní ne', async () => {
  const profiles = [{ id: 'alex', username: 'alex' }, { id: 'pavla', username: 'pavla' }, { id: 'ivo', username: 'ivo' }, { id: 'dana', username: 'dana' }, { id: 'u1', username: 'jana' }];
  const activity = [
    { user_id: 'alex', activity_date: dayStr(2) },   // včera pojistka
    { user_id: 'pavla', activity_date: dayStr(0) },  // dnes četla
    { user_id: 'ivo', activity_date: dayStr(2) },    // zmeškal včerejšek, má pojistku v zásobě, appku neotevřel
    { user_id: 'dana', activity_date: dayStr(3) },   // zmeškal dva dny a jen jedna pojistka
  ];
  const rpc = { leaderboard_streaks: async () => ({ data: [
    { user_id: 'alex', current_streak: 8, frozen_dates: [dayStr(1)], streak_freezes: 0 },
    { user_id: 'pavla', current_streak: 3, frozen_dates: [], streak_freezes: 1 },
    { user_id: 'ivo', current_streak: 6, frozen_dates: [], streak_freezes: 1 },
    { user_id: 'dana', current_streak: 4, frozen_dates: [], streak_freezes: 1 },
  ], error: null }) };
  const lb = await quiet(() => loadLeaderboards(pagingClient({ books: [], activity, profiles, rpc }), USER));
  const row = (name) => lb.streak.find((r) => r.email === name);
  assert.deepEqual([row('alex').streak, row('alex').streakFrozen], [8, true], 'pojistka včera');
  assert.deepEqual([row('ivo').streak, row('ivo').streakFrozen], [6, true], 'pojistka v zásobě pokryje zmeškaný včerejšek');
  assert.deepEqual([row('pavla').streak, row('pavla').streakFrozen], [4, false], 'dnes četla: obyčejný řádek');
  assert.deepEqual([row('dana').streak, row('dana').streakFrozen], [0, false], 'pojistek je míň než zmeškaných dní');
  assert.equal(row('jana').streakFrozen, false);
  assert.ok(lb.streak.findIndex((r) => r.email === 'alex') < lb.streak.findIndex((r) => r.email === 'pavla'), 'zmrzlá série se řadí podle své hodnoty, ne jako nula');
  for (const key of ['level', 'totalRead', 'monthlyRead', 'xp']) assert.ok(lb[key].every((r) => 'streakFrozen' in r), 'příznak je u každého řádku');
});

test('loadLeaderboards: bez nového SQL (chybí streak_freezes) i bez SQL vůbec nic nespadne a nic se nezmrazí domýšlením', async () => {
  const profiles = [{ id: 'alex', username: 'alex' }, { id: 'pavla', username: 'pavla' }];
  const activity = [{ user_id: 'alex', activity_date: dayStr(2) }, { user_id: 'pavla', activity_date: dayStr(2) }];
  const oldSql = await quiet(() => loadLeaderboards(pagingClient({ books: [], activity, profiles, rpc: {
    leaderboard_streaks: async () => ({ data: [{ user_id: 'alex', current_streak: 8, frozen_dates: [dayStr(1)] }, { user_id: 'pavla', current_streak: 5, frozen_dates: [] }], error: null }),
  } }), USER));
  const get = (lb, n) => lb.streak.find((r) => r.email === n);
  assert.deepEqual([get(oldSql, 'alex').streak, get(oldSql, 'alex').streakFrozen], [8, true], 'starší funkce: zachráněný včerejšek pozná dál');
  assert.deepEqual([get(oldSql, 'pavla').streak, get(oldSql, 'pavla').streakFrozen], [0, false]);
  const noSql = await quiet(() => loadLeaderboards(pagingClient({ books: [], activity, profiles }), USER));
  assert.ok(noSql.streak.every((r) => r.streakFrozen === false));
});

test('loadLeaderboards: vlastní řádek bere sérii a pojistky z vlastních statistik (zmrzlá série i u tebe)', async () => {
  const profiles = [{ id: USER.id, username: 'ja' }, { id: 'pavla', username: 'pavla' }];
  const activity = [{ user_id: USER.id, activity_date: dayStr(2) }];
  const lb = await quiet(() => loadLeaderboards(pagingClient({ books: [], activity, profiles }), USER, { ...EMPTY_STATS, streak: 6, frozenDates: [dayStr(1)], streakFreezes: 0, level: 1, totalRead: 0, monthlyRead: 0, totalXp: 0 }));
  const me = lb.streak.find((r) => r.isMe);
  assert.deepEqual([me.streak, me.streakFrozen], [6, true]);
  const read = await quiet(() => loadLeaderboards(pagingClient({ books: [], activity: [{ user_id: USER.id, activity_date: dayStr(0) }, { user_id: USER.id, activity_date: dayStr(2) }], profiles }), USER, { ...EMPTY_STATS, streak: 7, frozenDates: [dayStr(1)], streakFreezes: 0, level: 1, totalRead: 0, monthlyRead: 0, totalXp: 0 }));
  assert.deepEqual([read.streak.find((r) => r.isMe).streak, read.streak.find((r) => r.isMe).streakFrozen], [7, false], 'dnes četl: už nezmrzlá');
});

test('styl řádku: zmrzlý jen na záložce Plamínky, modrý přechod bez zbytečné změny ostatních řádků', () => {
  const frozen = { email: 'alex', streak: 8, streakFrozen: true };
  assert.equal(isFrozenRow(frozen, 'streak'), true);
  for (const tab of ['level', 'totalRead', 'monthlyRead', 'xp']) assert.equal(isFrozenRow(frozen, tab), false, tab);
  assert.equal(isFrozenRow({ streak: 8 }, 'streak'), false);
  assert.equal(isFrozenRow(null, 'streak'), false);
  const s = boardRowStyle(frozen, 'streak');
  assert.equal(s.backgroundImage, FROZEN_ROW_IMAGE);
  assert.equal(s.borderColor, FROZEN_ROW_BORDER);
  assert.match(FROZEN_ROW_IMAGE, /^linear-gradient\(90deg, rgba\(56, 189, 248/, 'modrý přechod');
  assert.deepEqual(boardRowStyle({ email: 'x', streak: 3 }, 'streak'), { backgroundColor: 'rgba(0,0,0,0.02)', backgroundImage: undefined, borderColor: 'transparent' });
  assert.deepEqual(boardRowStyle({ email: 'me', isMe: true, streak: 3 }, 'streak'), { backgroundColor: 'var(--bg-badge)', backgroundImage: undefined, borderColor: 'var(--bg-primary)' });
  assert.equal(boardRowStyle({ ...frozen, isMe: true }, 'streak').backgroundColor, 'var(--bg-badge)', 'svůj zmrzlý řádek zůstane svůj (štítek Ty)');
  assert.equal(boardRowStyle(frozen, 'xp').backgroundImage, undefined, 'na jiné záložce se nezbarví');
});

test('UserStats: zmrzlý řádek ukazuje sněhovou vločku a hodnotu (ne nulu), legenda jen když nějaký je', () => {
  const src = fs.readFileSync(new URL('../pages/UserStats.jsx', import.meta.url), 'utf8');
  assert.match(src, /boardRowStyle\(row, activeTab\)/);
  assert.match(src, /data-testid="lb-frozen"/);
  assert.match(src, /<CountUp value=\{row\[activeTab\]\} format=\{\(n\) => n\.toLocaleString\(\)\}/, 'hodnota se ukazuje vždy (v Živém režimu se dotočí)');
  assert.match(src, /data-testid="lb-frozen-legend"/);
  assert.match(src, /activeTab === 'streak' && leaderboards\.streak\?\.some\(r => isFrozenRow\(r, 'streak'\)\)/);
});
