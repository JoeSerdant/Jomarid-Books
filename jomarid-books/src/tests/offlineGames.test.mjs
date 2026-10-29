// Testy her offline: šifrovaná kopie postupu, sloučení po připojení (pokročilejší vyhrává, druhý je záloha), hraní bez spojení v synchronizaci,
// fronta odměn a rekordů a napojení v appce.
//   npm run test:offlinegames
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryStore, STORES } from '../offline/store.js';
import { createGameSaves } from '../offline/gameSaves.js';
import { reconcileGameSave, reconcileAllGames } from '../offline/gameMerge.js';
import { compareProgress, genericScore, progressTuple, sameMap } from '../offline/gameProgress.js';
import { createOutbox, MAX_QUEUED_COINS } from '../offline/outbox.js';
import { queueRecord, requestCoins } from '../offline/gameQueue.js';
import { buildId, clearPrepared, needsRefresh, prepareGames, preparedGames } from '../offline/gamesPrep.js';
import { createGameSync, NoLocalSaveError } from '../gameSave/sync.js';
import { reportGameRecord } from '../gameRecords/api.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8').replace(/\r\n/g, '\n');
const quiet = async (fn) => { const w = console.warn; const e = console.error; console.warn = () => {}; console.error = () => {}; try { return await fn(); } finally { console.warn = w; console.error = e; } };
const tick = async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r)); };
const NETERR = { message: 'TypeError: Failed to fetch', name: 'TypeError' };

/* ---------------------------------------------------------------- napodobenina serveru (db/game-saves.sql) */
function makeServer() {
  const saves = {};            // hra -> { rev, data, backup }
  const log = [];
  const state = { down: false, onSave: null };
  const cur = (g) => (saves[g] = saves[g] || { rev: 0, data: {}, backup: null });
  const rpc = async (fn, args) => {
    log.push([fn, args]);
    if (state.down) return { data: null, error: NETERR };
    const g = args.p_game_id; const c = cur(g);
    if (fn === 'load_game_state') return { data: { rev: c.rev, data: c.data }, error: null };
    if (fn === 'save_game_state') {
      if (state.onSave) state.onSave(g, c);
      if (c.rev !== args.p_base_rev) return { data: { ok: false, reason: 'conflict', rev: c.rev }, error: null };
      c.rev += 1; c.data = args.p_data; return { data: { ok: true, rev: c.rev }, error: null };
    }
    if (fn === 'import_legacy_game_state') {
      if (c.rev === 0) { c.rev = 1; c.data = args.p_data; return { data: { imported: true, rev: 1, data: c.data }, error: null }; }
      c.backup = args.p_data; return { data: { imported: false, rev: c.rev, data: c.data }, error: null };
    }
    if (fn === 'award_game_coins' || fn === 'report_game_record') { if (state.fail) return { data: null, error: state.fail }; return { data: { ok: true, granted: 1 }, error: null }; }
    return { data: null, error: { message: 'unknown' } };
  };
  return { client: { rpc }, saves, log, state };
}
const rocket = (stats, extra = {}) => ({ space_shooter_v2_9: JSON.stringify({ coins: 5, stats: { totalPlaytime: 0, runsPlayed: 0, totalKills: 0, ...stats }, ...extra }) });

const setup = () => {
  const server = makeServer();
  const store = createMemoryStore();
  let clock = 1000;
  const gameSaves = createGameSaves({ store, now: () => clock });
  return { server, store, gameSaves, advance: (ms) => { clock += ms; } };
};
const U = 'u1';

/* ---------------------------------------------------------------- pokrok hry */
test('pokrok: čítače hry rozhodují v pořadí důležitosti, nastavení a měny ne', () => {
  const a = rocket({ totalPlaytime: 500, runsPlayed: 3 });
  const b = rocket({ totalPlaytime: 900, runsPlayed: 1 });
  assert.equal(compareProgress('rocket', a, b), -1, 'čas hraní je důležitější než počet běhů');
  assert.equal(compareProgress('rocket', b, a), 1);
  assert.equal(compareProgress('rocket', a, { ...a }), 0);
  assert.equal(compareProgress('rocket', rocket({ totalPlaytime: 5 }, { coins: 9999 }), rocket({ totalPlaytime: 5 }, { coins: 1 })), 0, 'utracené a vydělané mince nejsou pokrok');
  const city = (over) => ({ cityClickerSaveV1: JSON.stringify({ totalPlaytimeSeconds: 100, lifetimeEarnings: 5e6, totalClicks: 40, prestigeCount: 0, ...over }) });
  assert.equal(compareProgress('cityclicker', city({ prestigeCount: 2, totalPlaytimeSeconds: 300 }), city({})), 1);
  const chess = (over) => ({ 'chessLeague.save.v1': JSON.stringify({ ratedGames: 4, peak: 1300, unlockedIndex: 1, ...over }) });
  assert.equal(compareProgress('chess', chess({ ratedGames: 9 }), chess({})), 1);
  const kou = (over) => ({ 'koulovi-kamosi-v1': JSON.stringify({ games: 3, merges: 40, best: 500, bm: {}, ...over }) });
  assert.equal(compareProgress('koulovikamosi', kou({ games: 2 }), kou({})), -1);
});

test('pokrok: hra bez známých čítačů se porovná obecně (odemčené uzly, úrovně), nastavení se nepočítá, rozbitý JSON nevadí', () => {
  const han = (nodes, gold = 100) => ({ hannibal_save_v1: JSON.stringify({ v: 1, savedAt: Date.now(), gold, nodes }) });
  const few = han({ a: { unlocked: true, completed: true }, b: { unlocked: false, completed: false } }, 900);
  const many = han({ a: { unlocked: true, completed: true }, b: { unlocked: true, completed: true }, c: { unlocked: true, completed: false } }, 5);
  assert.equal(compareProgress('hannibal', many, few), 1, 'víc dokončených uzlů vyhrává, i když má méně zlata');
  assert.equal(compareProgress('warroom', { warroom_muted: '1', warroom_frontlines_save_v1: '{"unlockedScenarios":["a"]}' }, { warroom_muted: '0', warroom_frontlines_save_v1: '{"unlockedScenarios":["a"]}' }), 0, 'zvuk není pokrok');
  assert.doesNotThrow(() => progressTuple('rocket', { space_shooter_v2_9: '{rozbite' }));
  assert.equal(compareProgress('rocket', { space_shooter_v2_9: '{rozbite' }, rocket({ totalPlaytime: 1 })), -1);
  assert.equal(genericScore({ best: 8, mute: 1, deep: { level: 3 } }) > genericScore({ best: 8 }), true);
  assert.equal(sameMap({ a: '1', b: '2' }, { b: '2', a: '1' }), true);
  assert.equal(sameMap({ a: '1' }, { a: '2' }), false);
  assert.equal(sameMap({ a: '1' }, { a: '1', b: '2' }), false);
});

/* ---------------------------------------------------------------- šifrovaná kopie */
test('kopie postupu: uložená zašifrovaně, vázaná na účet a hru, poškozená se bere jako žádná', async () => {
  const { gameSaves, store } = setup();
  const map = rocket({ totalPlaytime: 77 }, { jmeno: 'Tajná přezdívka Mrkev' });
  await gameSaves.put(U, 'rocket', { map, rev: 3, dirty: true });
  const raw = await store.get(STORES.meta, 'gamesave:u1:rocket');
  const bytes = Buffer.from(new Uint8Array(raw.data));
  assert.ok(!bytes.includes(Buffer.from('Mrkev')) && !bytes.includes(Buffer.from('totalPlaytime')), 'v zařízení není čitelný postup');
  const rec = await gameSaves.get(U, 'rocket');
  assert.deepEqual([rec.map, rec.rev, rec.dirty, rec.at > 0], [map, 3, true, true]);
  assert.equal(await gameSaves.get('u2', 'rocket'), null, 'jiný účet nic nemá');
  await store.put(STORES.meta, 'gamesave:u2:rocket', raw);
  assert.equal(await gameSaves.get('u2', 'rocket'), null, 'kopie přenesená k jinému účtu se neotevře');
  await store.put(STORES.meta, 'gamesave:u1:chess', raw);
  assert.equal(await gameSaves.get(U, 'chess'), null, 'ani k jiné hře');
  const flipped = new Uint8Array(raw.data.slice(0)); flipped[3] ^= 1;
  await store.put(STORES.meta, 'gamesave:u1:rocket', { ...raw, data: flipped.buffer });
  assert.equal(await gameSaves.get(U, 'rocket'), null, 'změněný bajt = žádná kopie (hra se z ní neotevře)');
  assert.equal(await gameSaves.get(U, 'nikdy'), null);
});

test('kopie postupu: seznam, čekající změny, smazání; zápisy za sebou se nepředběhnou', async () => {
  const { gameSaves } = setup();
  await gameSaves.put(U, 'rocket', { map: rocket({}), rev: 1, dirty: true });
  await gameSaves.put(U, 'chess', { map: {}, rev: 2, dirty: false });
  await gameSaves.put('u2', 'rocket', { map: {}, rev: 1, dirty: true });
  assert.deepEqual(await gameSaves.dirtyGames(U), ['rocket']);
  assert.deepEqual((await gameSaves.list(U)).map((x) => [x.gameId, x.dirty]), [['chess', false], ['rocket', true]]);
  await Promise.all([1, 2, 3, 4, 5].map((n) => gameSaves.put(U, 'koulovikamosi', { map: { k: String(n) }, rev: n, dirty: n % 2 === 1 })));
  assert.deepEqual([(await gameSaves.get(U, 'koulovikamosi')).rev, (await gameSaves.get(U, 'koulovikamosi')).map.k], [5, '5'], 'poslední zápis platí');
  await gameSaves.remove(U, 'rocket');
  assert.equal(await gameSaves.get(U, 'rocket'), null);
  assert.deepEqual(await gameSaves.dirtyGames(U), ['koulovikamosi']);
});

/* ---------------------------------------------------------------- sloučení po připojení */
test('sloučení: bez změn v zařízení se nic neděje; server beze změny dostane offline postup', async () => {
  const { gameSaves, server } = setup();
  const args = { client: server.client, userId: U, gameId: 'rocket', gameSaves };
  assert.equal((await reconcileGameSave(args)).action, 'none');
  await gameSaves.put(U, 'rocket', { map: rocket({ totalPlaytime: 1 }), rev: 0, dirty: false });
  assert.equal((await reconcileGameSave(args)).action, 'none');
  assert.equal(server.log.length, 0, 'bez změn se server nevolá');
  server.saves.rocket = { rev: 4, data: rocket({ totalPlaytime: 100 }), backup: null };
  const offlinePlay = rocket({ totalPlaytime: 160 });
  await gameSaves.put(U, 'rocket', { map: offlinePlay, rev: 4, dirty: true });
  const res = await reconcileGameSave(args);
  assert.deepEqual([res.action, res.rev], ['pushed', 5]);
  assert.deepEqual(server.saves.rocket.data, offlinePlay);
  assert.equal(server.saves.rocket.backup, null, 'záloha není potřeba');
  assert.deepEqual(await gameSaves.get(U, 'rocket'), { ...(await gameSaves.get(U, 'rocket')), map: offlinePlay, rev: 5, dirty: false });
});

test('sloučení: hrálo se i jinde, offline postup je pokročilejší -> uloží se a starý server je záloha', async () => {
  const { gameSaves, server } = setup();
  const onServer = rocket({ totalPlaytime: 300, runsPlayed: 5 });
  server.saves.rocket = { rev: 7, data: onServer, backup: null };
  const offlinePlay = rocket({ totalPlaytime: 900, runsPlayed: 12 });
  await gameSaves.put(U, 'rocket', { map: offlinePlay, rev: 4, dirty: true });
  const res = await reconcileGameSave({ client: server.client, userId: U, gameId: 'rocket', gameSaves });
  assert.equal(res.action, 'local_won');
  assert.deepEqual(server.saves.rocket.data, offlinePlay, 'na serveru je pokročilejší postup');
  assert.deepEqual(server.saves.rocket.backup, onServer, 'starší postup ze serveru zůstal jako záloha');
  assert.equal(server.saves.rocket.rev, 8);
  const rec = await gameSaves.get(U, 'rocket');
  assert.deepEqual([rec.rev, rec.dirty], [8, false]);
});

test('sloučení: hrálo se i jinde, server je pokročilejší nebo nerozhodno -> platí server, offline postup je záloha', async () => {
  for (const [serverStats, offlineStats, label] of [[{ totalPlaytime: 900 }, { totalPlaytime: 100 }, 'server je dál'], [{ totalPlaytime: 500 }, { totalPlaytime: 500 }, 'nerozhodno']]) {
    const { gameSaves, server } = setup();
    const onServer = rocket(serverStats, { poznamka: 'server' });
    const offlinePlay = rocket(offlineStats, { poznamka: 'offline' });
    server.saves.rocket = { rev: 9, data: onServer, backup: null };
    await gameSaves.put(U, 'rocket', { map: offlinePlay, rev: 2, dirty: true });
    const res = await reconcileGameSave({ client: server.client, userId: U, gameId: 'rocket', gameSaves });
    assert.equal(res.action, 'server_won', label);
    assert.deepEqual(server.saves.rocket.data, onServer, label + ': server beze změny');
    assert.deepEqual(server.saves.rocket.backup, offlinePlay, label + ': offline postup je záloha');
    assert.equal(server.saves.rocket.rev, 9);
    const rec = await gameSaves.get(U, 'rocket');
    assert.deepEqual([rec.map, rec.rev, rec.dirty], [onServer, 9, false], label + ': zařízení převzalo server');
  }
});

test('sloučení: stejná data jen srovná revizi, prázdný server dostane offline postup, výpadek sítě nic nezahodí', async () => {
  const { gameSaves, server } = setup();
  const same = rocket({ totalPlaytime: 3 });
  server.saves.rocket = { rev: 6, data: same, backup: null };
  await gameSaves.put(U, 'rocket', { map: same, rev: 2, dirty: true });
  assert.equal((await reconcileGameSave({ client: server.client, userId: U, gameId: 'rocket', gameSaves })).action, 'same');
  assert.deepEqual([server.saves.rocket.rev, (await gameSaves.get(U, 'rocket')).rev, (await gameSaves.get(U, 'rocket')).dirty], [6, 6, false]);

  await gameSaves.put(U, 'chess', { map: { 'chessLeague.save.v1': '{"ratedGames":1}' }, rev: 3, dirty: true });   // server s prázdnou databází (rev 0)
  const fresh = await reconcileGameSave({ client: server.client, userId: U, gameId: 'chess', gameSaves });
  assert.equal(fresh.action, 'pushed');
  assert.equal(server.saves.chess.backup, null, 'prázdný server se nezálohuje (import by se jinak chopil dat)');

  const down = setup();
  await down.gameSaves.put(U, 'rocket', { map: rocket({ totalPlaytime: 5 }), rev: 1, dirty: true });
  down.server.state.down = true;
  await assert.rejects(reconcileGameSave({ client: down.server.client, userId: U, gameId: 'rocket', gameSaves: down.gameSaves }), (e) => e.name === 'TypeError');
  assert.equal((await down.gameSaves.get(U, 'rocket')).dirty, true, 'změny zůstaly na zařízení');
});

test('sloučení: konflikt revize během ukládání se zopakuje s čerstvým stavem a nakonec to vzdá', async () => {
  const { gameSaves, server } = setup();
  server.saves.rocket = { rev: 4, data: rocket({ totalPlaytime: 10 }), backup: null };
  const offlinePlay = rocket({ totalPlaytime: 50 });
  await gameSaves.put(U, 'rocket', { map: offlinePlay, rev: 4, dirty: true });
  let bumped = false;
  server.state.onSave = (g, c) => { if (!bumped) { bumped = true; c.rev += 1; c.data = rocket({ totalPlaytime: 12 }); } };   // někdo uložil mezi načtením a uložením
  const res = await reconcileGameSave({ client: server.client, userId: U, gameId: 'rocket', gameSaves });
  assert.equal(res.action, 'local_won', 'po opakování se rozhodlo podle pokroku');
  assert.deepEqual(server.saves.rocket.data, offlinePlay);

  const stuck = setup();
  stuck.server.saves.rocket = { rev: 1, data: rocket({}), backup: null };
  await stuck.gameSaves.put(U, 'rocket', { map: rocket({ totalPlaytime: 9 }), rev: 1, dirty: true });
  stuck.server.state.onSave = (g, c) => { c.rev += 1; };
  await assert.rejects(reconcileGameSave({ client: stuck.server.client, userId: U, gameId: 'rocket', gameSaves: stuck.gameSaves }), /conflict_retry/);
  assert.equal((await stuck.gameSaves.get(U, 'rocket')).dirty, true, 'změny nezmizely');
});

test('sloučení všech her: přeskočí hry otevřené ve hře a chyby nesmí zastavit ostatní', async () => {
  const { gameSaves, server } = setup();
  await gameSaves.put(U, 'rocket', { map: rocket({ totalPlaytime: 1 }), rev: 0, dirty: true });
  await gameSaves.put(U, 'chess', { map: { 'chessLeague.save.v1': '{}' }, rev: 0, dirty: true });
  const res = await reconcileAllGames({ client: server.client, userId: U, gameSaves, skip: new Set(['chess']) });
  assert.deepEqual(Object.keys(res), ['rocket']);
  assert.equal(res.rocket.action, 'pushed');
  assert.equal((await gameSaves.get(U, 'chess')).dirty, true, 'otevřená hra zůstala své synchronizaci');
  server.state.down = true;
  const failed = await reconcileAllGames({ client: server.client, userId: U, gameSaves });
  assert.equal(failed.chess.action, 'failed');
});

/* ---------------------------------------------------------------- synchronizace bez spojení */
const makeClock = () => {
  let t = 0; let seq = 0; const timers = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => { const id = ++seq; timers.push({ id, at: t + ms, fn }); return id; },
    clearTimer: (id) => { const i = timers.findIndex((x) => x.id === id); if (i >= 0) timers.splice(i, 1); },
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        if (!timers.length || timers[0].at > end) break;
        const next = timers.shift(); t = next.at; next.fn(); await tick();
      }
      t = end; await tick();
    },
  };
};
const syncEnv = (over = {}) => {
  const env = setup();
  const clock = makeClock();
  const net = { offline: false };
  const statuses = [];
  const offline = {
    read: () => env.gameSaves.get(U, 'rocket'),
    write: (rec) => env.gameSaves.put(U, 'rocket', rec),
    reconcile: () => reconcileGameSave({ client: env.server.client, userId: U, gameId: 'rocket', gameSaves: env.gameSaves }),
  };
  const sync = createGameSync({ client: env.server.client, gameId: 'rocket', setTimer: clock.setTimer, clearTimer: clock.clearTimer, now: clock.now, onStatus: (s) => statuses.push(s), offline, isOffline: () => net.offline, ...over });
  return { ...env, clock, net, statuses, sync };
};
const setKey = (sync, value, key = 'space_shooter_v2_9') => sync.apply({ op: 'set', key, value });

test('hra online zrcadlí postup do zařízení: po načtení, při změně (dirty) a po uložení na server (čisto)', async () => {
  const e = syncEnv();
  e.server.saves.rocket = { rev: 2, data: rocket({ totalPlaytime: 40 }), backup: null };
  await e.sync.load();
  assert.deepEqual([(await e.gameSaves.get(U, 'rocket')).rev, (await e.gameSaves.get(U, 'rocket')).dirty], [2, false], 'po načtení je v zařízení stejný postup jako na serveru');
  const next = rocket({ totalPlaytime: 41 }).space_shooter_v2_9;
  setKey(e.sync, next);
  await e.clock.advance(700);
  const mid = await e.gameSaves.get(U, 'rocket');
  assert.deepEqual([mid.map.space_shooter_v2_9, mid.dirty], [next, true], 'změna je v zařízení hned (zatím neuložená na server)');
  await e.clock.advance(3000);
  for (let i = 0; i < 50 && (await e.gameSaves.get(U, 'rocket')).dirty; i += 1) await tick();   // zápis do kopie (šifrování) doběhne chvíli po uložení na server
  const done = await e.gameSaves.get(U, 'rocket');
  assert.deepEqual([e.server.saves.rocket.data.space_shooter_v2_9, done.rev, done.dirty], [next, 3, false]);
});

test('server nejde načíst kvůli spojení: hra se otevře z kopie v zařízení; bez kopie NoLocalSaveError; jiná chyba se nepřekryje', async () => {
  const e = syncEnv();
  const copy = rocket({ totalPlaytime: 70 });
  await e.gameSaves.put(U, 'rocket', { map: copy, rev: 5, dirty: false });
  e.server.state.down = true;
  e.net.offline = true;
  await e.sync.load();
  assert.deepEqual(e.sync.snapshot(), { map: copy, rev: 5 });
  assert.deepEqual([e.sync.state().status, e.sync.state().dirty], ['offline', false]);
  assert.deepEqual(e.statuses.map((s) => s.state), ['offline']);

  const none = syncEnv();
  none.server.state.down = true;
  none.net.offline = true;
  await assert.rejects(none.sync.load(), NoLocalSaveError);

  // zařízení je online, jen server vypadl: bez kopie je to obyčejná chyba načtení (ne „jsi offline“), s kopií se hra otevře a lišta řekne „neuloženo“
  const flaky = syncEnv();
  flaky.server.state.down = true;
  await assert.rejects(flaky.sync.load(), (e) => !(e instanceof NoLocalSaveError) && e.name === 'TypeError');
  const flakyCopy = syncEnv();
  await flakyCopy.gameSaves.put(U, 'rocket', { map: copy, rev: 5, dirty: false });
  flakyCopy.server.state.down = true;
  await flakyCopy.sync.load();
  assert.equal(flakyCopy.sync.state().status, 'failing');

  const other = syncEnv();
  other.server.client.rpc = async () => ({ data: null, error: { message: 'not_authenticated', code: 'P0001' } });
  await assert.rejects(other.sync.load(), (e) => e.message === 'not_authenticated');
});

test('offline bez kopie si hráč může zvolit hru od začátku: po připojení se sloučí s účtem (prázdný účet dostane postup, jinak vyhraje pokročilejší a druhý je záloha)', async () => {
  // účet bez postupu: nový offline postup se prostě uloží
  const a = syncEnv();
  a.server.state.down = true; a.net.offline = true;
  await a.sync.load({ allowEmpty: true });
  assert.deepEqual([a.sync.snapshot().map, a.sync.snapshot().rev, a.sync.state().status], [{}, 0, 'offline']);
  const fresh = rocket({ totalPlaytime: 30 }).space_shooter_v2_9;
  setKey(a.sync, fresh);
  await a.clock.advance(1000);
  assert.deepEqual([(await a.gameSaves.get(U, 'rocket')).dirty, (await a.gameSaves.get(U, 'rocket')).rev], [true, 0], 'změna je v zařízení');
  a.server.state.down = false; a.net.offline = false;
  await a.sync.retryNow();
  assert.equal(a.server.saves.rocket.data.space_shooter_v2_9, fresh);
  assert.deepEqual([a.sync.state().status, a.sync.state().stopped], ['ok', false]);

  // účet už má pokročilý postup: platí ten, krátký offline postup je záloha (a hra to řekne)
  const b = syncEnv();
  b.server.state.down = true; b.net.offline = true;
  await b.sync.load({ allowEmpty: true });
  setKey(b.sync, fresh);
  await b.clock.advance(1000);
  b.server.state.down = false; b.net.offline = false;
  const long = rocket({ totalPlaytime: 5000 });
  b.server.saves.rocket = { rev: 12, data: long, backup: null };
  await b.sync.retryNow();
  assert.deepEqual(b.server.saves.rocket.data, long, 'postup z účtu zůstal');
  assert.equal(b.server.saves.rocket.backup.space_shooter_v2_9, fresh, 'offline začátek je záloha');
  assert.equal(b.sync.state().stopped, true);
  assert.deepEqual(b.statuses.filter((x) => x.state === 'conflict').map((x) => x.reason), ['server_won']);

  // bez volby se pořád hlásí NoLocalSaveError, i když je kopie jiné hry
  const c = syncEnv();
  c.server.state.down = true; c.net.offline = true;
  await assert.rejects(c.sync.load(), NoLocalSaveError);
});

test('hraní bez spojení: nic se neposílá, změny jsou v zařízení, po připojení se uloží a lišta řekne „zase uloženo“', async () => {
  const e = syncEnv();
  e.server.saves.rocket = { rev: 2, data: rocket({ totalPlaytime: 40 }), backup: null };
  await e.sync.load();
  e.net.offline = true; e.server.state.down = true;
  e.server.log.length = 0;
  const v1 = rocket({ totalPlaytime: 90 }).space_shooter_v2_9;
  setKey(e.sync, v1);
  await e.clock.advance(20000);
  assert.equal(e.server.log.length, 0, 'bez spojení se server nevolá');
  assert.equal(e.sync.state().status, 'offline');
  assert.equal((await e.gameSaves.get(U, 'rocket')).dirty, true);
  assert.equal((await e.gameSaves.get(U, 'rocket')).map.space_shooter_v2_9, v1);
  const v2 = rocket({ totalPlaytime: 95 }).space_shooter_v2_9;
  setKey(e.sync, v2);
  e.net.offline = false; e.server.state.down = false;
  await e.sync.retryNow();
  assert.equal(e.server.saves.rocket.data.space_shooter_v2_9, v2, 'po připojení je na serveru poslední stav');
  assert.deepEqual([e.sync.state().status, e.sync.state().dirty, e.statuses.map((s) => s.state + (s.recovered ? '+' : ''))], ['ok', false, ['offline', 'ok+']]);
  assert.equal((await e.gameSaves.get(U, 'rocket')).dirty, false);
});

test('po offline hraní se mezitím hrálo jinde: pokročilejší vyhrává (a druhý je záloha), hra to nepřehlédne', async () => {
  // offline postup je pokročilejší
  const a = syncEnv();
  a.server.saves.rocket = { rev: 2, data: rocket({ totalPlaytime: 40 }), backup: null };
  await a.sync.load();
  a.net.offline = true; a.server.state.down = true;
  setKey(a.sync, rocket({ totalPlaytime: 500 }).space_shooter_v2_9);
  await a.clock.advance(1000);
  a.server.state.down = false; a.net.offline = false;
  a.server.saves.rocket = { rev: 6, data: rocket({ totalPlaytime: 120 }), backup: null };    // jiné zařízení
  await a.sync.retryNow();
  assert.equal(JSON.parse(a.server.saves.rocket.data.space_shooter_v2_9).stats.totalPlaytime, 500);
  assert.equal(JSON.parse(a.server.saves.rocket.backup.space_shooter_v2_9).stats.totalPlaytime, 120, 'starší postup z jiného zařízení je záloha');
  assert.equal(a.sync.state().stopped, false);
  assert.equal(a.sync.state().status, 'ok');

  // postup na serveru je pokročilejší: hra se zastaví s hláškou, ať se otevře znovu
  const b = syncEnv();
  b.server.saves.rocket = { rev: 2, data: rocket({ totalPlaytime: 40 }), backup: null };
  await b.sync.load();
  b.net.offline = true; b.server.state.down = true;
  setKey(b.sync, rocket({ totalPlaytime: 60 }).space_shooter_v2_9);
  await b.clock.advance(1000);
  b.server.state.down = false; b.net.offline = false;
  b.server.saves.rocket = { rev: 6, data: rocket({ totalPlaytime: 900 }), backup: null };
  await b.sync.retryNow();
  assert.equal(b.sync.state().stopped, true);
  assert.deepEqual(b.statuses.filter((s) => s.state === 'conflict').map((s) => s.reason), ['server_won']);
  assert.equal(JSON.parse(b.server.saves.rocket.data.space_shooter_v2_9).stats.totalPlaytime, 900, 'server beze změny');
  assert.equal(JSON.parse(b.server.saves.rocket.backup.space_shooter_v2_9).stats.totalPlaytime, 60);
  assert.equal(JSON.parse((await b.gameSaves.get(U, 'rocket')).map.space_shooter_v2_9).stats.totalPlaytime, 900, 'při dalším otevření hra dostane postup ze serveru');
});

test('obyčejný konflikt online (bez hraní offline) zůstává jako dřív: ukládání se zastaví', async () => {
  const e = syncEnv();
  e.server.saves.rocket = { rev: 2, data: rocket({ totalPlaytime: 40 }), backup: null };
  await e.sync.load();
  e.server.saves.rocket = { rev: 3, data: rocket({ totalPlaytime: 41 }), backup: null };    // jiné zařízení uložilo
  setKey(e.sync, rocket({ totalPlaytime: 999 }).space_shooter_v2_9);
  await e.clock.advance(3000);
  assert.equal(e.sync.state().stopped, true);
  assert.deepEqual(e.statuses.map((s) => s.state), ['conflict']);
  assert.equal(JSON.parse(e.server.saves.rocket.data.space_shooter_v2_9).stats.totalPlaytime, 41, 'nic se nepřepsalo');
  assert.equal(e.server.saves.rocket.backup, null);
});

test('otevření hry po dřívějším hraní offline: nejdřív se sloučí s serverem; co se sloučit nepovede, hru nespustí', async () => {
  const ok = syncEnv();
  ok.server.saves.rocket = { rev: 3, data: rocket({ totalPlaytime: 10 }), backup: null };
  await ok.gameSaves.put(U, 'rocket', { map: rocket({ totalPlaytime: 80 }), rev: 3, dirty: true });
  await ok.sync.load();
  assert.equal(JSON.parse(ok.sync.snapshot().map.space_shooter_v2_9).stats.totalPlaytime, 80, 'hra dostane sloučený postup');
  assert.equal(ok.sync.snapshot().rev, 4);

  const bad = syncEnv();
  bad.server.saves.rocket = { rev: 3, data: rocket({ totalPlaytime: 10 }), backup: null };
  await bad.gameSaves.put(U, 'rocket', { map: rocket({ totalPlaytime: 80 }), rev: 3, dirty: true });
  bad.server.state.onSave = (g, c) => { c.rev += 1; };   // sloučení pořád naráží na konflikt
  await assert.rejects(quiet(() => bad.sync.load()), /offline_reconcile_pending/);
  assert.equal((await bad.gameSaves.get(U, 'rocket')).dirty, true, 'offline postup nezmizel');
});

test('bez volby offline (hry bez podpory úložiště) se synchronizace chová jako dřív', async () => {
  const env = setup();
  const clock = makeClock();
  const sync = createGameSync({ client: env.server.client, gameId: 'rocket', setTimer: clock.setTimer, clearTimer: clock.clearTimer, now: clock.now });
  env.server.state.down = true;
  await assert.rejects(sync.load(), (e) => e.name === 'TypeError');
});

/* ---------------------------------------------------------------- fronta odměn a rekordů */
test('fronta: rekordy se pro statistiku slučují na nejvyšší hodnotu, žádostí o Coiny je rozumný strop', async () => {
  const store = createMemoryStore();
  const outbox = createOutbox({ store });
  await queueRecord(outbox, U, { game: 'rocket', stat: 'best_normal', value: 500 });
  await queueRecord(outbox, U, { game: 'rocket', stat: 'best_normal', value: 900 });
  await queueRecord(outbox, U, { game: 'rocket', stat: 'best_normal', value: 700 });
  await queueRecord(outbox, U, { game: 'rocket', stat: 'best_hard', value: 10 });
  await queueRecord(outbox, U, { game: 'chess', stat: 'best_normal', value: 3 });
  assert.deepEqual((await outbox.list(U)).map((e) => [e.value.gameId, e.value.stat, e.value.value]), [['rocket', 'best_normal', 900], ['rocket', 'best_hard', 10], ['chess', 'best_normal', 3]]);
  for (let i = 0; i < MAX_QUEUED_COINS + 30; i += 1) await outbox.enqueue({ userId: U, type: 'game_coin', gameId: 'cityclicker', amount: 1, reason: 'golden' });
  assert.equal((await outbox.list(U)).filter((e) => e.value.type === 'game_coin').length, MAX_QUEUED_COINS);
});

test('odeslání fronty her: rekordy a žádosti jdou na server pod stejným voláním; výpadek sítě zastaví, odmítnutí zahodí', async () => {
  const store = createMemoryStore();
  const outbox = createOutbox({ store });
  const server = makeServer();
  await queueRecord(outbox, U, { game: 'rocket', stat: 'best_normal', value: 900 });
  await outbox.enqueue({ userId: U, type: 'game_coin', gameId: 'cityclicker', amount: 3, reason: 'golden' });
  server.state.down = true;
  let res = await outbox.flush(server.client, U);
  assert.deepEqual([res.stopped, res.sent, res.remaining], [true, 0, 2]);
  server.state.down = false;
  res = await outbox.flush(server.client, U);
  assert.deepEqual([res.stopped, res.sent, res.remaining], [false, 2, 0]);
  const calls = server.log.filter(([fn]) => fn === 'report_game_record' || fn === 'award_game_coins');
  assert.deepEqual(calls.at(-2), ['report_game_record', { p_game_id: 'rocket', p_stat_key: 'best_normal', p_value: 900 }]);
  assert.deepEqual(calls.at(-1), ['award_game_coins', { p_game_id: 'cityclicker', p_amount: 3, p_reason: 'golden' }]);
  server.state.fail = { message: 'unknown_stat', code: 'P0001' };
  await queueRecord(outbox, U, { game: 'rocket', stat: 'nesmysl', value: 1 });
  res = await quiet(() => outbox.flush(server.client, U));
  assert.deepEqual([res.dropped, res.remaining], [1, 0], 'odmítnutou žádost nemá smysl posílat pořád dokola');
});

test('žádost o Coiny: online odpověď serveru, offline nebo při výpadku do fronty, odmítnutí se vrátí jako chyba', async () => {
  const store = createMemoryStore();
  const outbox = createOutbox({ store });
  const server = makeServer();
  const base = { client: server.client, outbox, userId: U, gameId: 'cityclicker', amount: 2, reason: 'golden' };
  const online = await requestCoins(base);
  assert.deepEqual([online.queued, online.data.granted], [false, 1]);
  assert.equal(await outbox.pending(U), 0);
  const off = await requestCoins({ ...base, offline: true });
  assert.equal(off.queued, true);
  server.state.down = true;
  assert.equal((await requestCoins(base)).queued, true, 'výpadek sítě při odeslání');
  assert.equal(await outbox.pending(U), 2);
  server.state.down = false;
  server.state.fail = { message: 'invalid_amount', code: 'P0001' };
  const rejected = await requestCoins(base);
  assert.deepEqual([rejected.queued, rejected.error.message], [false, 'invalid_amount']);
  assert.equal(await outbox.pending(U), 2, 'odmítnutá žádost se nefrontuje');
});

test('reportGameRecord: při výpadku spojení zavolá onTransient (rekord do fronty), jinak se chová jako dřív', async () => {
  const queued = [];
  const down = { rpc: async () => ({ data: null, error: NETERR }) };
  const res = await reportGameRecord(down, 'rocket', 'score_normal', 1200, { onTransient: (r) => queued.push(r) });
  assert.equal(res.queued, true);
  assert.deepEqual(queued, [{ game: 'rocket', stat: 'score_normal', value: 1200 }]);
  assert.equal(await quiet(() => reportGameRecord(down, 'rocket', 'score_normal', 1200)), null, 'bez onTransient dřívější chování');
  const denied = { rpc: async () => ({ data: null, error: { message: 'denied', code: '42501' } }) };
  assert.equal(await quiet(() => reportGameRecord(denied, 'rocket', 'score_normal', 1200, { onTransient: (r) => queued.push(r) })), null);
  assert.equal(queued.length, 1, 'odmítnutí se do fronty nedává');
  assert.equal(await reportGameRecord(down, 'rocket', 'neexistuje', 5, { onTransient: () => queued.push('x') }), null, 'neplatné hlášení se zahodí dřív');
});

/* ---------------------------------------------------------------- příprava her */
test('příprava her offline: zapamatuje se jen úplné stažení a po nové verzi appky se má zopakovat', async () => {
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  const seen = [];
  const part = await prepareGames(async (cb) => { cb(1, 2); return { total: 2, failed: ['chess'] }; }, { storage, build: '/assets/index-A.js', onProgress: (d, t) => seen.push([d, t]) });
  assert.equal(part.ok, false);
  assert.equal(preparedGames(storage), null, 'neúplné stažení se nepočítá');
  assert.deepEqual(seen, [[1, 2]]);
  const full = await prepareGames(async () => ({ total: 7, failed: [] }), { storage, build: '/assets/index-A.js', now: () => 5000 });
  assert.equal(full.ok, true);
  assert.deepEqual(preparedGames(storage), { at: 5000, build: '/assets/index-A.js', total: 7 });
  assert.equal(needsRefresh(storage, '/assets/index-A.js'), false);
  assert.equal(needsRefresh(storage, '/assets/index-B.js'), true, 'nová verze appky = nové názvy souborů');
  clearPrepared(storage);
  assert.equal(needsRefresh(storage, '/assets/index-B.js'), false, 'kdo hry nepřipravil, nic se nestahuje');
  mem.set('jomarid-games-offline', '{rozbite');
  assert.equal(preparedGames(storage), null);
  assert.equal(buildId({ querySelector: () => ({ getAttribute: () => '/assets/index-Z.js' }) }), '/assets/index-Z.js');
  assert.equal(buildId({ querySelector: () => { throw new Error('x'); } }), 'dev');
});

/* ---------------------------------------------------------------- napojení v appce */
test('napojení: hry berou postup z kopie, slučují se po připojení, odměny a rekordy jdou do fronty, nastavení umí hry připravit', () => {
  const g = read('pages', 'Games.jsx');
  assert.match(g, /offline: user \? \{\n\s+read: \(\) => gameSaves\.get\(user\.id, game\.id\),\n\s+write: \(rec\) => gameSaves\.put\(user\.id, game\.id, rec\),\n\s+reconcile: \(\) => reconcileGameSave\(/);
  assert.match(g, /activeGames\.add\(game\.id\)/);
  assert.match(g, /activeGames\.delete\(game\.id\)/);
  assert.match(g, /window\.addEventListener\('online', onOnline\)/);
  assert.match(g, /const onOnline = \(\) => \{ syncRef\.current\?\.retryNow\(\); \};/);
  assert.match(g, /setSaveLoadError\(err instanceof NoLocalSaveError \? 'nocopy' : true\)/);
  assert.match(g, /saveLoadError === 'nocopy' \? SAVE_NO_LOCAL_COPY : SAVE_LOAD_ERROR/);
  assert.match(g, /await sync\.load\(\{ allowEmpty: allowEmpty === true \}\)/);
  assert.match(g, /onClick=\{\(\) => handleOpenGame\(true\)\}\n\s+data-testid="play-fresh-offline"/);
  assert.match(g, /requestCoins\(\{ client: supabase, outbox, userId: user\.id, gameId: game\.id, amount, reason, offline: navigator\.onLine === false \}\)/);
  assert.match(g, /if \(navigator\.onLine === false\) \{ queueRecord\(outbox, user\.id, rec\)/);
  assert.match(g, /onTransient: \(r\) => \{ queueRecord\(outbox, user\.id, r\)/);
  assert.match(g, /!online \? \(\n\s+<>Odměna za hraní jde jen online/);
  assert.match(g, /export async function preloadGames\(/);
  assert.doesNotMatch(g, /supabase\.rpc\('award_game_coins'/, 'odměny jdou přes frontu');
  assert.match(read('components', 'SettingsModal.jsx'), /<OfflineGamesSection Section=\{Section\} Notice=\{Notice\} ActionButton=\{ActionButton\} \/>/);
  const idx = read('offline', 'index.js');
  assert.match(idx, /gameSaves\.dirtyGames\(userId\)/);
  assert.match(idx, /reconcileAllGames\(\{ client: supabase, userId: user\.id, gameSaves, skip: activeGames \}\)/);
  assert.match(read('offline', 'OfflineSyncRunner.jsx'), /needsRefresh\(\)/);
  assert.match(read('components', 'GameBar.jsx'), /saveStatus === 'offline'/);
  const pkg = JSON.parse(fs.readFileSync(path.join(SRC, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['test:offlinegames'], 'node --test src/tests/offlineGames.test.mjs');
  assert.ok(pkg.scripts.test.includes('npm run test:offlinegames'));
});
