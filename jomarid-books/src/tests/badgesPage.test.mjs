// Testy stránky Odznaky (odznaky knih a her, tituly, vzhled her) a sdíleného načítání statistik, které ze Statistik přešlo do src/stats/loadStats.js.
//   npm run test:badges
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMPTY_LEADERBOARDS, EMPTY_STATS, loadLeaderboards, loadMyStats } from '../stats/loadStats.js';
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
  assert.match(stats, /Odznaky knih: \{stats\.unlockedBadges\.length\} z \{BOOK_BADGES\.length\}\. Odznaky her: \{stats\.gameProgress\?\.unlocked\?\.length \|\| 0\} z \{GAME_BADGES\.length\}\./);
  assert.match(stats, /loadMyStats\(supabase, user\)/);
  assert.match(stats, /loadLeaderboards\(supabase, user\)/);
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
    const q = { select: () => q, eq: () => q, order: () => q, maybeSingle: async () => ({ data: single, error: null }), then: (resolve) => resolve({ data: rows, error: null }) };
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
