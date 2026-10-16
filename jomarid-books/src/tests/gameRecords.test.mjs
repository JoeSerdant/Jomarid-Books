// Testy herních rekordů a odznaků: katalog, shoda se SQL, volání serveru, most ve hrách, napojení do úrovně a do Statistik.
//   npm run test:gamerecords
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { GAME_CATALOG, GAME_BADGES, GAME_BADGES_TOTAL_XP, getBadge, getGame, getStat, normalizeRecord, sumGameBadgeXp } from '../gameRecords/catalog.js';
import { EMPTY_PROGRESS, normalizeProgress, loadGameProgress, loadGameXpTotals, loadGameLeaderboard, reportGameRecord } from '../gameRecords/api.js';
import { computeTotalXp, calculateLevelAndProgress } from '../constants/leveling.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.join(SRC, '..', 'db');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');
const sql = fs.readFileSync(path.join(DB, 'game-records.sql'), 'utf8');

/* ---------------------------------------------------------------- katalog */
test('katalog: unikátní id, každý odznak sedí na existující statistiku v mezích a každá hra má hlavní statistiku', () => {
  const ids = GAME_BADGES.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(GAME_CATALOG.map((g) => g.id)).size, GAME_CATALOG.length);
  for (const g of GAME_CATALOG) {
    assert.equal(new Set(g.stats.map((s) => s.key)).size, g.stats.length, g.id);
    assert.ok(g.stats.some((s) => s.key === g.headline), `${g.id}: hlavní statistika`);
    for (const s of g.stats) assert.ok(Number.isInteger(s.max) && s.max > 0 && s.label.length > 2, `${g.id}.${s.key}`);
  }
  for (const b of GAME_BADGES) {
    const stat = getStat(b.game, b.stat);
    assert.ok(stat, `${b.id}: statistika ${b.game}.${b.stat}`);
    assert.ok(b.threshold > 0 && b.threshold <= stat.max, `${b.id}: práh v mezích`);
    assert.ok(b.xp > 0 && b.title && b.description.endsWith('.'), b.id);
  }
});

test('id her v katalogu jsou stejná jako v Games.jsx a v mostech her', () => {
  const games = read('pages', 'Games.jsx');
  const hub = [...games.matchAll(/^\s+id: '(\w+)',$/gm)].map((m) => m[1]);
  assert.deepEqual([...hub].sort(), GAME_CATALOG.map((g) => g.id).sort());
  assert.deepEqual(GAME_CATALOG.map((g) => g.title).sort(), [...games.matchAll(/^\s+title: '([^']+)',$/gm)].map((m) => m[1]).sort(), 'názvy her sedí s hubem');
});

test('XP herních odznaků: ve stejné statistice těžší odznak vždy dává víc, každý dává aspoň 30 XP, hry samy dovedou čtenáře zhruba na úroveň 12', () => {
  const chains = new Map();
  for (const b of GAME_BADGES) { const k = `${b.game}.${b.stat}`; chains.set(k, [...(chains.get(k) || []), b]); }
  for (const [key, list] of chains) {
    const sorted = [...list].sort((a, b) => a.threshold - b.threshold);
    for (let i = 1; i < sorted.length; i += 1) assert.ok(sorted[i].xp > sorted[i - 1].xp, `${key}: ${sorted[i].id} (${sorted[i].xp} XP) musí dávat víc než lehčí ${sorted[i - 1].id} (${sorted[i - 1].xp} XP)`);
  }
  for (const b of GAME_BADGES) assert.ok(b.xp >= 30 && b.xp % 10 === 0, `${b.id}: ${b.xp} XP`);
  assert.equal(GAME_BADGES_TOTAL_XP, 12080);
  assert.equal(calculateLevelAndProgress(GAME_BADGES_TOTAL_XP).level, 12);
});

test('sumGameBadgeXp a pomocné funkce katalogu', () => {
  assert.equal(sumGameBadgeXp(['rocket_ace', 'chess_first', 'neznamy', 5]), 150);
  assert.equal(sumGameBadgeXp('x'), 0);
  assert.equal(sumGameBadgeXp(undefined), 0);
  assert.equal(getBadge('rocket_ace').game, 'rocket');
  assert.equal(getBadge('toString'), null);
  assert.equal(getGame('chess').title, 'Chess League');
  assert.equal(getGame('x'), null);
  assert.equal(getStat('chess', '__proto__'), null);
});

test('normalizeRecord: jen známá statistika, celé číslo od 1 do meze', () => {
  assert.deepEqual(normalizeRecord('rocket', 'score_normal', 1234.9), { game: 'rocket', stat: 'score_normal', value: 1234 });
  assert.deepEqual(normalizeRecord('chess', 'rating_peak', '1500'), { game: 'chess', stat: 'rating_peak', value: 1500 });
  for (const bad of [[ 'rocket', 'score_normal', 0 ], ['rocket', 'score_normal', -3], ['rocket', 'score_normal', NaN], ['rocket', 'score_normal', Infinity], ['rocket', 'score_normal', 100000001],
    ['rocket', 'nic', 5], ['nic', 'score_normal', 5], ['rocket', 'score_normal', null], ['rocket', 'score_normal', undefined], ['rocket', 'score_normal', 'abc'], ['chess', 'bots_unlocked', 6]]) {
    assert.equal(normalizeRecord(...bad), null, JSON.stringify(bad));
  }
  assert.deepEqual(normalizeRecord('chess', 'bots_unlocked', 5), { game: 'chess', stat: 'bots_unlocked', value: 5 }, 'přesně na mezi projde');
});

/* ---------------------------------------------------------------- shoda se SQL */
test('db/game-records.sql má stejné statistiky, meze, odznaky, prahy a XP jako katalog v appce', () => {
  const stats = [...sql.matchAll(/^\s+\('(\w+)', '(\w+)', (\d+)\),?$/gm)].map((m) => `${m[1]}.${m[2]}=${m[3]}`);
  const wantStats = GAME_CATALOG.flatMap((g) => g.stats.map((s) => `${g.id}.${s.key}=${s.max}`));
  assert.deepEqual(stats, wantStats, 'statistiky a meze');
  const badges = [...sql.matchAll(/^\s+\('(\w+)', '(\w+)', '(\w+)', (\d+), (\d+)\),?$/gm)].map((m) => `${m[1]}|${m[2]}.${m[3]}>=${m[4]}|${m[5]}`);
  const wantBadges = GAME_BADGES.map((b) => `${b.id}|${b.game}.${b.stat}>=${b.threshold}|${b.xp}`);
  assert.deepEqual(badges, wantBadges, 'odznaky, prahy a XP');
  assert.match(sql, new RegExp(`dohromady\\s+(?:--\\s+)?${GAME_BADGES_TOTAL_XP} XP`), 'komentář o součtu XP');
});

test('SQL: funkce jsou jen pro přihlášené, tabulky mají zapnutou RLS a nikdo k nim nemá přímý přístup', () => {
  for (const fn of ['report_game_record(text, text, bigint)', 'my_game_progress()', 'game_xp_totals()', 'game_leaderboard(text, text, int)']) {
    assert.ok(sql.includes(`revoke all on function public.${fn} from public, anon;`), `revoke ${fn}`);
    assert.ok(sql.includes(`grant execute on function public.${fn} to authenticated;`), `grant ${fn}`);
  }
  for (const t of ['game_stat_limits', 'game_badge_defs', 'game_records', 'game_badge_unlocks']) assert.ok(sql.includes(`alter table public.${t} enable row level security;`), t);
  assert.match(sql, /revoke all on public\.game_stat_limits, public\.game_badge_defs, public\.game_records, public\.game_badge_unlocks from public, anon, authenticated;/);
  assert.equal((sql.match(/security definer set search_path to 'public'/g) || []).length, 4);
});

/* ---------------------------------------------------------------- volání serveru */
const fakeClient = (handlers) => ({ rpc: async (name, args) => { const h = handlers[name]; if (!h) return { data: null, error: { message: 'function does not exist' } }; return h(args); } });
const quiet = async (fn) => { const w = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = w; } };

test('normalizeProgress zahodí neznámé hry, statistiky a odznaky, zaokrouhlí a vezme XP ze serveru', () => {
  const p = normalizeProgress({ records: { rocket: { score_normal: 1500.7, nic: 4, score_hard: -1, score_blitz: 'x' }, chess: 'rozbité', nova_hra: { a: 1 } },
    unlocked: ['rocket_ace', 'rocket_ace', 'neznamy', 5, 'chess_first'], xp: 77 });
  assert.deepEqual(p.records, { rocket: { score_normal: 1500 } });
  assert.deepEqual(p.unlocked, ['rocket_ace', 'chess_first']);
  assert.equal(p.xp, 77);
  assert.equal(normalizeProgress({ unlocked: ['rocket_ace', 'chess_first'] }).xp, 150, 'bez XP ze serveru se spočítá z odznaků');
  for (const bad of [null, undefined, 5, 'x', [], true]) assert.deepEqual(normalizeProgress(bad), EMPTY_PROGRESS);
});

test('loadGameProgress: úspěch, chyba serveru i vyhozená výjimka (SQL ještě nemusí běžet) vrací prázdný postup', async () => {
  const ok = await loadGameProgress(fakeClient({ my_game_progress: async () => ({ data: { records: { chess: { rating_peak: 1210 } }, unlocked: ['chess_r1000'], xp: 10 }, error: null }) }));
  assert.deepEqual(ok, { records: { chess: { rating_peak: 1210 } }, unlocked: ['chess_r1000'], xp: 10 });
  assert.deepEqual(await quiet(() => loadGameProgress(fakeClient({}))), EMPTY_PROGRESS, 'funkce v databázi není');
  assert.deepEqual(await quiet(() => loadGameProgress(fakeClient({ my_game_progress: async () => { throw new Error('síť'); } }))), EMPTY_PROGRESS);
  assert.equal(EMPTY_PROGRESS.xp, 0);
});

test('loadGameXpTotals: Map id -> XP, špatné řádky se přeskočí, chyba dá prázdnou mapu', async () => {
  const m = await loadGameXpTotals(fakeClient({ game_xp_totals: async () => ({ data: [{ user_id: 'a', xp: 35 }, { user_id: 'b', xp: '5' }, { user_id: 'c', xp: 0 }, { user_id: 'd', xp: 'x' }, { xp: 9 }, null], error: null }) }));
  assert.deepEqual([...m.entries()], [['a', 35], ['b', 5]]);
  assert.equal((await quiet(() => loadGameXpTotals(fakeClient({})))).size, 0);
});

test('loadGameLeaderboard: názvy bez jména jsou „Anonym“, neznámá statistika se na server ani neposílá', async () => {
  const calls = [];
  const client = fakeClient({ game_leaderboard: async (args) => { calls.push(args); return { data: [{ user_id: 'a', username: 'jana', value: 9000 }, { user_id: 'b', username: null, value: '800' }, { user_id: 'c', username: '  ', value: 5 }], error: null }; } });
  const rows = await loadGameLeaderboard(client, 'rocket', 'score_normal', 3);
  assert.deepEqual(rows, [{ userId: 'a', name: 'jana', value: 9000 }, { userId: 'b', name: 'Anonym', value: 800 }, { userId: 'c', name: 'Anonym', value: 5 }]);
  assert.deepEqual(calls, [{ p_game_id: 'rocket', p_stat_key: 'score_normal', p_limit: 3 }]);
  assert.deepEqual(await loadGameLeaderboard(client, 'rocket', 'nic'), []);
  assert.equal(calls.length, 1);
  assert.deepEqual(await quiet(() => loadGameLeaderboard(fakeClient({}), 'chess', 'rating_peak')), []);
});

test('reportGameRecord: neplatné hlášení se neposílá, výsledek se převede na odznaky s názvy a XP', async () => {
  const calls = [];
  const client = fakeClient({ report_game_record: async (args) => { calls.push(args); return { data: { ok: true, value: 14, improved: true, unlocked: ['rocket_nemesis', 'rocket_glitch', 'neznamy'], xp: 400 }, error: null }; } });
  assert.equal(await reportGameRecord(client, 'rocket', 'nic', 5), null);
  assert.equal(await reportGameRecord(client, 'rocket', 'boss_level', 0), null);
  assert.equal(calls.length, 0);
  const r = await reportGameRecord(client, 'rocket', 'boss_level', 14.8);
  assert.deepEqual(calls, [{ p_game_id: 'rocket', p_stat_key: 'boss_level', p_value: 14 }]);
  assert.equal(r.improved, true); assert.equal(r.xp, 400);
  assert.deepEqual(r.unlocked.map((b) => b.title), ['Konec NEMESIS', 'Chyba v systému']);
  assert.equal(await reportGameRecord(fakeClient({ report_game_record: async () => ({ data: { ok: false, reason: 'implausible' }, error: null }) }), 'rocket', 'boss_level', 5), null);
  assert.equal(await quiet(() => reportGameRecord(fakeClient({}), 'rocket', 'boss_level', 5)), null, 'SQL ještě neběží');
  assert.equal((await reportGameRecord(fakeClient({ report_game_record: async () => ({ data: { ok: true, improved: false, unlocked: [], xp: 0 }, error: null }) }), 'chess', 'rating_peak', 900)).unlocked.length, 0);
});

/* ---------------------------------------------------------------- XP v úrovni */
test('computeTotalXp: gameXp se přičte, špatné hodnoty a záporné se ignorují, bez něj se nic nemění', () => {
  const base = { totalRead: 3, highestGoalCompleted: 30, fakeXp: '10', bonusXp: 5, streak: 10, badgeXp: 100 };
  assert.equal(computeTotalXp(base), 695);
  assert.equal(computeTotalXp({ ...base, gameXp: 80 }), 775);
  assert.equal(computeTotalXp({ ...base, gameXp: 12.9 }), 707);
  for (const bad of [undefined, null, NaN, -5, 'x', Infinity]) assert.equal(computeTotalXp({ ...base, gameXp: bad }), 695, String(bad));
});

test('všude, kde se počítá úroveň, se přičítá XP z herních odznaků (úvodní stránka, Statistiky vč. žebříčku, lišta nad hrou)', () => {
  const home = read('pages', 'HomePage.jsx');
  assert.match(home, /loadGameProgress\(supabase\)/);
  assert.match(home, /gameXp: gameProgress\.xp/);
  const loader = read('stats', 'loadStats.js');
  assert.match(loader, /const totalXp = xpBeforeBadges \+ badgeBonusXp \+ gameProgress\.xp;/);
  assert.match(loader, /gameXp: gameXpTotals\.get\(p\.id\) \|\| 0/);
  assert.doesNotMatch(loader, /xpBeforeBadges = computeTotalXp\(\{[^}]*gameXp/s, 'do vyhodnocení odznaků z úrovně herní XP nevstupuje (jinak by hry odemykaly odznaky a s nimi mince)');
  assert.match(read('pages', 'Badges.jsx'), /<GamesProgress progress=\{stats\.gameProgress \|\| EMPTY_PROGRESS\} userId=\{user\?\.id\} \/>/);
  assert.match(read('gameBar', 'useReaderSnapshot.js'), /gameXp: gameProgress\.xp/);
  assert.match(read('gameBar', 'readerSnapshot.js'), /gameXp,\n\s*\}\);/);
});

/* ---------------------------------------------------------------- most ve hrách */
const GAMES = {
  rocket: ['gameContent', 'rocket', 'index.html'], polygonarena: ['gameContent', 'polygonArena', 'index.html'], chess: ['gameContent', 'chess', 'index.html'],
  koulovikamosi: ['gameContent', 'koulovi', 'index.html'], cityclicker: ['gameContent', 'cityClicker.js'], warroom: ['gameContent', 'warroom.js'],
};
const decode = (rel) => {
  const text = read(...rel);
  return rel[rel.length - 1].endsWith('.js') && /^export const \w+ = "/.test(text) ? JSON.parse(text.match(/^export const \w+ = (".*");\s*$/s)[1]) : text;
};
const bridgeOf = (rel) => { const t = decode(rel); const i = t.indexOf('JOMARID-BRIDGE'); return t.slice(i, t.indexOf('</script>', i)); };

function makeBridge(inFrame = true) {
  const posts = []; const timers = []; const listeners = {};
  const parent = { postMessage: (m) => posts.push(m) };
  const win = { addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); } };
  win.parent = inFrame ? parent : win;
  const sandbox = { window: win, document: { addEventListener() {}, createElement: () => ({ setAttribute() {}, style: {} }) }, setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout: () => {}, console };
  vm.createContext(sandbox);
  vm.runInContext(bridgeOf(GAMES.rocket).replace(/^JOMARID-BRIDGE \*\//, ''), sandbox);
  return { win, posts, timers, listeners, tick: () => { const f = timers.splice(0); f.forEach((fn) => fn()); } };
}

test('most: jomaridRecord pošle jen zvýšení, sloučí rychlé hlášení a zahodí nesmysly', () => {
  const b = makeBridge();
  b.win.jomaridRecord('score_normal', 100);
  b.win.jomaridRecord('score_normal', 250);        // sloučí se: odejde jen vyšší
  b.win.jomaridRecord('score_hard', 40);
  assert.equal(b.posts.length, 0, 'nic neodešlo hned');
  b.tick();
  assert.deepEqual(b.posts.map((m) => [m.stat, m.value]), [['score_normal', 250], ['score_hard', 40]]);
  assert.ok(b.posts.every((m) => m.source === 'jomarid-game' && m.type === 'record' && m.game === 'rocket'));
  b.win.jomaridRecord('score_normal', 250);        // stejné
  b.win.jomaridRecord('score_normal', 100);        // nižší
  b.tick();
  assert.equal(b.posts.length, 2, 'stejná ani nižší hodnota se neposílá znovu');
  b.win.jomaridRecord('score_normal', 251.9);
  b.tick();
  assert.equal(b.posts[2].value, 251);
  for (const bad of [0, -4, NaN, 'x', undefined, null, Infinity]) b.win.jomaridRecord('score_hard', bad);
  b.win.jomaridRecord(5, 10); b.win.jomaridRecord(undefined, 10);
  b.tick();
  assert.equal(b.posts.length, 3, 'nesmysly se zahodí');
  b.win.jomaridRecord('rush_streak', 3, true);
  assert.equal(b.posts[3].stat, 'rush_streak', 'immediate odešle hned');
  assert.equal(b.timers.length, 0);
});

test('most: při zavření stránky se nedoposlané rekordy odešlou a mimo appku se neodesílá nic', () => {
  const b = makeBridge();
  b.win.jomaridRecord('boss_level', 8);
  assert.equal(b.posts.length, 0);
  b.listeners.pagehide.forEach((f) => f());
  assert.deepEqual(b.posts.map((m) => [m.stat, m.value]), [['boss_level', 8]]);
  const out = makeBridge(false);
  out.win.jomaridRecord('boss_level', 8, true);
  out.tick();
  assert.equal(out.posts.length, 0);
});

test('každá hra hlásí všechny statistiky ze svého katalogu a ostatní hry jen své', () => {
  const sources = {
    rocket: [decode(['gameContent', 'rocket', 'index.html'])],
    chess: [read('gameContent', 'chess', 'ui.js')],
    koulovikamosi: [read('gameContent', 'koulovi', 'game.js')],
    polygonarena: [read('gameContent', 'polygonArena', 'core.js')],
    cityclicker: [decode(['gameContent', 'cityClicker.js'])],
    warroom: [decode(['gameContent', 'warroom.js'])],
  };
  for (const g of GAME_CATALOG) {
    const text = sources[g.id].join('\n');
    const reported = new Set([...text.matchAll(/jomaridRecord\(\s*['"]([a-z_]+)['"]\s*,/g)].map((m) => m[1]));
    if (g.id === 'koulovikamosi') {
      assert.match(text, /for\(const m of\['classic','time','drops','chaos'\]\)jomaridRecord\('score_'\+m,S\.bm\[m\]\)/);
      for (const m of ['classic', 'time', 'drops', 'chaos']) reported.add('score_' + m);
    }
    assert.deepEqual([...reported].sort(), g.stats.map((s) => s.key).sort(), g.id);
  }
});

test('prahy odznaků za „všechno“ sedí na obsah her: 24 scénářů ve Warroom, 5 soupeřů v šachách', () => {
  const war = decode(['gameContent', 'warroom.js']);
  const raw = war.slice(war.indexOf('const RAW_SCENARIOS'));
  const scenarios = [...raw.slice(0, raw.indexOf('];')).matchAll(/\{ id: '(\w+)'/g)].length;
  const badge = (id) => GAME_BADGES.find((b) => b.id === id);
  assert.equal(badge('war_scen24').threshold, scenarios, 'všech scénářů ve Warroom');
  assert.ok(badge('war_scen24').description.includes(`všech ${scenarios} `));
  assert.ok(badge('war_scen12').threshold < scenarios && badge('war_scen4').threshold < badge('war_scen12').threshold);
  const bots = [...read('gameContent', 'chess', 'bots.js').matchAll(/^\s+key: "(\w+)", name:/gm)].length;
  assert.equal(badge('chess_bots5').threshold, bots, 'všech soupeřů v šachách');
  assert.equal(getStat('chess', 'bots_unlocked').max, bots);
  assert.ok(badge('chess_bots5').description.includes(`všech ${bots} `));
});

/* ---------------------------------------------------------------- hub, Statistiky */
test('Games.jsx předává hlášení rekordů serveru, nový odznak potvrdí v liště a text u hry říká, co se ukládá k účtu', () => {
  const g = read('pages', 'Games.jsx');
  assert.match(g, /event\.data\?\.type === 'record' && user/);
  assert.match(g, /normalizeRecord\(game\.id, event\.data\.stat, event\.data\.value\)/);
  assert.match(g, /reportGameRecord\(supabase, rec\.game, rec\.stat, rec\.value\)/);
  assert.match(g, /showFlash\(\{ text: `\+\$\{res\.xp\} XP`, label: `Odznak: /);
  assert.match(g, /rekordy i herní odznaky se ukládají k tvému účtu, takže je máš na všech zařízeních stejné \(rekordy a odznaky najdeš na stránce Odznaky, záložka Odznaky her\)/);
  assert.doesNotMatch(g, /Skóre a vylepšení ve hře jsou jen pro zábavu/);
});

test('záložka Odznaky her: shrnutí, karta každé hry s rekordy, odznaky a žebříčkem', () => {
  const c = read('components', 'GamesProgress.jsx');
  assert.match(c, /data-testid="games-progress"/);
  assert.match(c, /GAME_CATALOG\.map\(\(game\) =>/);
  assert.match(c, /loadGameLeaderboard\(supabase, game\.id, game\.headline, 5\)/);
  assert.match(c, /aria-expanded=\{open\}/);
  assert.match(c, /Nejlepší hráči: /);
});
