// Testy uloženého postupu her na serveru: katalog a shoda se SQL, náhrada localStorage ve hře, synchronizace (odklad, opakování, konflikt),
// přenos starého postupu z prohlížeče, volání serveru a napojení do Her, lišty a exportu dat.
//   npm run test:gamesave
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { GAME_SAVE_LIMITS, LEGACY_KEYS, SAVE_GAME_IDS, saveProblem, cleanMap } from '../gameSave/catalog.js';
import { buildStorageShim, withStorageShim } from '../gameSave/shim.js';
import { createGameSync } from '../gameSave/sync.js';
import { normalizeState, loadGameState, importLegacyGameState, saveGameState, saveGameStateKeepalive, loadAllGameSaves } from '../gameSave/api.js';
import { readLegacyStorage, clearLegacyStorage } from '../gameSave/legacy.js';
import { SAVE_MESSAGES, SAVE_CHIPS } from '../gameSave/messages.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.join(SRC, '..', 'db');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8').replace(/\r\n/g, '\n');
const sql = fs.readFileSync(path.join(DB, 'game-saves.sql'), 'utf8');

// Texty her tak, jak je appka vkládá do iframu (u City Clickeru a Warroomu jde o řetězec zapsaný v JS souboru).
const gameHtml = (file) => {
  const raw = read('gameContent', file);
  if (!['cityClicker.js', 'warroom.js'].includes(file)) return raw;
  const m = /export const \w+ = /.exec(raw);
  return JSON.parse(raw.slice(m.index + m[0].length).trim().replace(/;$/, ''));
};
const GAME_SOURCES = {
  rocket: ['rocket/index.html'],
  warroom: ['warroom.js'],
  cityclicker: ['cityClicker.js'],
  polygonarena: ['polygonArena/index.html', 'polygonArena/core.js'],
  chess: ['chess/index.html', 'chess/league.js', 'chess/ui.js'],
  koulovikamosi: ['koulovi/index.html', 'koulovi/game.js'],
};

/* ---------------------------------------------------------------- katalog a shoda se SQL */
test('meze v appce jsou stejné jako v db/game-saves.sql a hry jako v seznamu her', () => {
  assert.match(sql, new RegExp(`jsonb_object_keys\\(p_data\\)\\) > ${GAME_SAVE_LIMITS.maxKeys} then`));
  assert.match(sql, new RegExp(`length\\(e\\.key\\) > ${GAME_SAVE_LIMITS.maxKeyLength}\\) then`));
  assert.match(sql, new RegExp(`octet_length\\(p_data::text\\) > ${GAME_SAVE_LIMITS.maxBytes} then`));
  const ids = [...sql.matchAll(/p_game_id not in \(([^)]+)\)/g)][0][1].split(',').map((x) => x.trim().replace(/'/g, ''));
  assert.deepEqual(ids, [...SAVE_GAME_IDS]);
  const games = read('pages', 'Games.jsx');
  const hub = [...games.matchAll(/^\s+id: '(\w+)',$/gm)].map((m) => m[1]);
  assert.deepEqual([...hub].sort(), [...SAVE_GAME_IDS].sort(), 'každá hra z Her má uložený postup a naopak');
});

test('SQL: funkce jsou jen pro přihlášené, tabulka má RLS a nikdo k ní nemá přímý přístup', () => {
  for (const fn of ['load_game_state(text)', 'save_game_state(text, jsonb, int)', 'import_legacy_game_state(text, jsonb)', 'my_game_saves()']) {
    assert.ok(sql.includes(`revoke all on function public.${fn} from public, anon;`), `revoke ${fn}`);
    assert.ok(sql.includes(`grant execute on function public.${fn} to authenticated;`), `grant ${fn}`);
  }
  assert.ok(sql.includes('alter table public.game_saves enable row level security;'));
  assert.ok(sql.includes('revoke all on public.game_saves from public, anon, authenticated;'));
  assert.ok(sql.includes('revoke all on function public.game_save_check(text, jsonb) from public, anon, authenticated;'));
  assert.equal((sql.match(/security definer set search_path to 'public'/g) || []).length, 4);
  assert.match(sql, /select rev into v_rev from public\.game_saves where user_id = v_uid and game_id = p_game_id for update;/, 'uložení zamyká řádek, dvě uložení naráz se nepředběhnou');
});

test('klíče v localStorage, které hry používají, jsou v katalogu (a katalog neobsahuje klíč, který hra nezná)', () => {
  for (const [game, files] of Object.entries(GAME_SOURCES)) {
    const text = files.map(gameHtml).join('\n');
    for (const key of LEGACY_KEYS[game]) assert.ok(text.includes(`'${key}'`) || text.includes(`"${key}"`), `${game}: klíč ${key} ve zdroji hry`);
    // žádný jiný klíč zapsaný přímo u getItem/setItem/removeItem
    const used = [...text.matchAll(/(?:getItem|setItem|removeItem)\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const key of used) assert.ok(LEGACY_KEYS[game].includes(key), `${game}: klíč ${key} chybí v katalogu`);
  }
  assert.deepEqual(Object.keys(LEGACY_KEYS), Object.keys(GAME_SOURCES));
});

test('hry se do localStorage pořád zapisují obyčejně (shim je jediná vrstva) a každá má <head>, kam se vloží', () => {
  for (const [game, files] of Object.entries(GAME_SOURCES)) {
    const text = files.map(gameHtml).join('\n');
    assert.match(text, /localStorage/, `${game}: používá localStorage`);
    assert.ok(!/IndexedDB|indexedDB|document\.cookie/.test(text), `${game}: žádné jiné trvalé úložiště`);
  }
  for (const file of ['rocket/index.html', 'warroom.js', 'cityClicker.js', 'polygonArena/index.html', 'chess/index.html', 'koulovi/index.html']) {
    assert.match(gameHtml(file), /<head(\s[^>]*)?>/i, `${file}: <head>`);
  }
});

test('saveProblem a cleanMap', () => {
  assert.equal(saveProblem({}), null);
  assert.equal(saveProblem({ a: 'x' }), null);
  assert.equal(saveProblem([]), 'invalid_data');
  assert.equal(saveProblem(null), 'invalid_data');
  assert.equal(saveProblem({ a: 5 }), 'invalid_data');
  assert.equal(saveProblem({ '': 'x' }), 'invalid_data');
  assert.equal(saveProblem({ ['k'.repeat(101)]: 'x' }), 'invalid_data');
  assert.equal(saveProblem({ ['k'.repeat(100)]: 'x' }), null);
  assert.equal(saveProblem(Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`k${i}`, 'x']))), 'invalid_data');
  assert.equal(saveProblem(Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, 'x']))), null);
  assert.deepEqual(cleanMap({ a: 'x', b: 1, c: null, d: { e: 'f' } }), { a: 'x' });
  assert.deepEqual(cleanMap([1, 2]), {});
  assert.deepEqual(cleanMap(null), {});
});

/* ---------------------------------------------------------------- náhrada localStorage ve hře */
class FakeStorage {
  constructor() { this.m = new Map(); this.calls = []; }
  getItem(k) { this.calls.push(['get', k]); return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.calls.push(['set', k]); this.m.set(String(k), String(v)); }
  removeItem(k) { this.calls.push(['remove', k]); this.m.delete(k); }
  clear() { this.calls.push(['clear']); this.m.clear(); }
  key(i) { return [...this.m.keys()][i] ?? null; }
  get length() { return this.m.size; }
}
const runShim = (gameId, seed, { ls = new FakeStorage(), ss = new FakeStorage() } = {}) => {
  const messages = [];
  const win = { Storage: FakeStorage, localStorage: ls, sessionStorage: ss, parent: { postMessage: (m) => messages.push(JSON.parse(JSON.stringify(m))) } };
  win.window = win;
  vm.runInNewContext(buildStorageShim(gameId, seed), win);
  return { win, ls, ss, messages };
};

test('shim: localStorage hry čte z předvyplněného postupu a do skutečného úložiště nesahá', () => {
  const { win, ls, messages } = runShim('chess', { 'chessLeague.save.v1': '{"rating":900}', jiny: 'x' });
  assert.equal(win.localStorage.getItem('chessLeague.save.v1'), '{"rating":900}');
  assert.equal(win.localStorage.getItem('neni'), null);
  win.localStorage.setItem('a', 5);
  assert.equal(win.localStorage.getItem('a'), '5', 'hodnota se převede na text jako u skutečného úložiště');
  win.localStorage.setItem('chessLeague.save.v1', '{"rating":950}');
  assert.equal(win.localStorage.getItem('chessLeague.save.v1'), '{"rating":950}');
  assert.deepEqual(ls.calls.filter((c) => c[0] !== 'get'), [], 'skutečný localStorage nic nedostal');
  assert.deepEqual(ls.calls, [], 'ani se ho nikdo neptal');
  assert.deepEqual(messages, [
    { op: 'set', key: 'a', value: '5', source: 'jomarid-game', type: 'storage', game: 'chess' },
    { op: 'set', key: 'chessLeague.save.v1', value: '{"rating":950}', source: 'jomarid-game', type: 'storage', game: 'chess' },
  ]);
});

test('shim: removeItem a clear se hlásí, smazání neexistujícího klíče ne, key() a length odpovídají paměti', () => {
  const { win, messages } = runShim('rocket', { a: '1', b: '2' });
  assert.equal(win.localStorage.length, 2);
  assert.equal(win.localStorage.key(0), 'a');
  assert.equal(win.localStorage.key(1), 'b');
  assert.equal(win.localStorage.key(2), null);
  assert.equal(win.localStorage.key(-1), null);
  win.localStorage.removeItem('a');
  win.localStorage.removeItem('nikdy-nebyl');
  assert.equal(win.localStorage.getItem('a'), null);
  assert.equal(win.localStorage.length, 1);
  win.localStorage.clear();
  assert.equal(win.localStorage.length, 0);
  assert.equal(win.localStorage.getItem('b'), null);
  assert.deepEqual(messages.map((m) => [m.op, m.key]), [['remove', 'a'], ['clear', undefined]]);
});

test('shim: sessionStorage a jiné objekty Storage zůstávají beze změny', () => {
  const { win, ss, ls, messages } = runShim('rocket', { a: '1' });
  win.sessionStorage.setItem('s', 'v');
  assert.equal(win.sessionStorage.getItem('s'), 'v');
  assert.equal(win.sessionStorage.length, 1);
  win.sessionStorage.removeItem('s');
  assert.equal(ss.m.size, 0);
  assert.equal(messages.length, 0, 'sessionStorage se na server neposílá');
  const other = new FakeStorage();
  other.setItem('x', 'y');
  assert.equal(FakeStorage.prototype.getItem.call(other, 'x'), 'y');
  assert.equal(other.length, 1);
  assert.equal(ls.m.size, 0);
});

test('shim: klíč __proto__ a podobné se z postupu načtou, nic se nezmění v prototypu a hodnoty se neupravují', () => {
  const seed = JSON.parse('{"__proto__":"prototyp","constructor":"c","a</script><!--":"$& $1 </script>","unicode":"x\\u2028y\\u2029z \\"uvozovky\\" \\\\ zpetne"}');
  assert.ok(Object.prototype.hasOwnProperty.call(seed, '__proto__'), 'příprava: vlastní klíč __proto__');
  const { win } = runShim('cityclicker', seed);
  assert.equal(win.localStorage.getItem('__proto__'), 'prototyp');
  assert.equal(win.localStorage.getItem('constructor'), 'c');
  assert.equal(win.localStorage.getItem('a</script><!--'), '$& $1 </script>');
  assert.equal(win.localStorage.getItem('unicode'), 'x\u2028y\u2029z "uvozovky" \\ zpetne');
  assert.equal(win.localStorage.getItem('toString'), null);
  assert.ok(!buildStorageShim('x', { a: '</script>' }).includes('</script>'), 'v kódu skriptu nesmí zůstat ukončení <script>');
  assert.ok(!buildStorageShim('x', { a: '\u2028' }).includes('\u2028'));
});

test('withStorageShim vloží skript hned za <head> (před skripty hry), jinak za <html>, jinak na začátek; zbytek dokumentu nechá', () => {
  const tag = (g, m) => `<script>${buildStorageShim(g, m)}</script>`;
  const html = '<!DOCTYPE html>\n<html lang="cs">\n<HEAD data-x="1">\n<meta charset="utf-8">\n<script>var hra = 1;</script>\n</HEAD><body></body></html>';
  const out = withStorageShim(html, 'chess', { a: '1' });
  assert.equal(out, html.replace('<HEAD data-x="1">', () => `<HEAD data-x="1">${tag('chess', { a: '1' })}`));
  assert.ok(out.indexOf('jomarid-game') < out.indexOf('var hra'), 'shim je před skripty hry');
  assert.equal(withStorageShim('<html><body>x</body></html>', 'g', {}), `<html>${tag('g', {})}<body>x</body></html>`);
  assert.equal(withStorageShim('<p>jen text</p>', 'g', {}), `${tag('g', {})}<p>jen text</p>`);
  assert.equal(withStorageShim('<header>x</header><head>y</head>', 'g', {}), `<header>x</header><head>${tag('g', {})}y</head>`, '<header> není <head>');
});

test('shim v reálných hrách: dokument se po vložení pořád dá rozebrat a skript je před prvním skriptem hry', () => {
  for (const file of ['rocket/index.html', 'warroom.js', 'cityClicker.js', 'polygonArena/index.html', 'chess/index.html', 'koulovi/index.html']) {
    const html = gameHtml(file);
    const out = withStorageShim(html, 'g', { k: 'v' });
    assert.equal(out.length, html.length + buildStorageShim('g', { k: 'v' }).length + '<script></script>'.length, file);
    const first = out.search(/<script/i);
    assert.ok(out.slice(first).startsWith('<script>(function () {\n  var GAME'), `${file}: první skript je shim`);
  }
});

/* ---------------------------------------------------------------- volání serveru */
const fakeClient = (handlers) => {
  const calls = [];
  // Chyby jako Error (v supabase-js jsou to Error), ať je assert.rejects pozná podle textu.
  const asError = (res) => (res?.error && !(res.error instanceof Error) ? { ...res, error: new Error(res.error.message) } : res);
  return { calls, rpc: async (name, args) => { calls.push([name, args]); const h = handlers[name]; if (!h) return asError({ data: null, error: { message: 'function does not exist' } }); return asError(await h(args)); } };
};
const ok = (data) => async () => ({ data, error: null });

test('normalizeState: revize je celé číslo od 0, data jen text; cokoli jiného je chyba', () => {
  assert.deepEqual(normalizeState({ rev: 3, data: { a: 'x', b: 5 } }), { rev: 3, data: { a: 'x' } });
  assert.deepEqual(normalizeState({ rev: 0, data: {} }), { rev: 0, data: {} });
  assert.deepEqual(normalizeState({ rev: 0 }), { rev: 0, data: {} });
  for (const bad of [null, undefined, 5, 'x', [], {}, { rev: -1 }, { rev: 1.5 }, { rev: 'a' }]) assert.throws(() => normalizeState(bad), /invalid_response/, JSON.stringify(bad));
});

test('loadGameState, importLegacyGameState a loadAllGameSaves volají správné funkce a chyby nepolykají', async () => {
  const c = fakeClient({
    load_game_state: ok({ rev: 2, data: { a: 'x' } }),
    import_legacy_game_state: ok({ imported: true, rev: 1, data: { b: 'y' } }),
    my_game_saves: ok({ chess: { rev: 1, data: {} } }),
  });
  assert.deepEqual(await loadGameState(c, 'chess'), { rev: 2, data: { a: 'x' } });
  assert.deepEqual(await importLegacyGameState(c, 'chess', { b: 'y' }), { imported: true, rev: 1, data: { b: 'y' } });
  assert.deepEqual(await loadAllGameSaves(c), { chess: { rev: 1, data: {} } });
  assert.deepEqual(c.calls, [['load_game_state', { p_game_id: 'chess' }], ['import_legacy_game_state', { p_game_id: 'chess', p_data: { b: 'y' } }], ['my_game_saves', undefined]]);
  assert.equal((await importLegacyGameState(fakeClient({ import_legacy_game_state: ok({ imported: false, rev: 4, data: {} }) }), 'chess', {})).imported, false);
  await assert.rejects(loadGameState(fakeClient({}), 'chess'), /does not exist/);
  await assert.rejects(loadGameState(fakeClient({ load_game_state: ok({}) }), 'chess'), /invalid_response/);
  await assert.rejects(importLegacyGameState(fakeClient({ import_legacy_game_state: ok(null) }), 'chess', {}), /invalid_response/);
});

test('saveGameState: úspěch, konflikt a chyby', async () => {
  const c = fakeClient({ save_game_state: ok({ ok: true, rev: 5 }) });
  assert.deepEqual(await saveGameState(c, 'rocket', { a: 'x' }, 4), { ok: true, rev: 5 });
  assert.deepEqual(c.calls, [['save_game_state', { p_game_id: 'rocket', p_data: { a: 'x' }, p_base_rev: 4 }]]);
  assert.deepEqual(await saveGameState(fakeClient({ save_game_state: ok({ ok: false, reason: 'conflict', rev: 9 }) }), 'rocket', {}, 4), { ok: false, reason: 'conflict', rev: 9 });
  await assert.rejects(saveGameState(fakeClient({ save_game_state: async () => ({ data: null, error: { message: 'too_large' } }) }), 'rocket', {}, 0), /too_large/);
  await assert.rejects(saveGameState(fakeClient({ save_game_state: ok({ ok: false, reason: 'jine' }) }), 'rocket', {}, 0), /invalid_response/);
  await assert.rejects(saveGameState(fakeClient({ save_game_state: ok({}) }), 'rocket', {}, 0), /invalid_response/, 'prázdná odpověď se nesmí tvářit jako uloženo');
  await assert.rejects(saveGameState(fakeClient({ save_game_state: ok({ ok: true }) }), 'rocket', {}, 0), /invalid_response/);
});

test('saveGameStateKeepalive: bez tokenu se nic neposílá, malý postup jde s keepalive, velký bez něj', async () => {
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push([url, init]); return { ok: true }; };
  const base = { url: 'https://x.supabase.co', apiKey: 'klic', gameId: 'chess', baseRev: 3, fetchImpl };
  assert.equal(await saveGameStateKeepalive({ ...base, token: null, map: { a: 'b' } }), false);
  assert.equal(sent.length, 0);
  assert.equal(await saveGameStateKeepalive({ ...base, token: 'tok', map: { a: 'b' } }), true);
  const [url, init] = sent[0];
  assert.equal(url, 'https://x.supabase.co/rest/v1/rpc/save_game_state');
  assert.equal(init.method, 'POST');
  assert.equal(init.keepalive, true);
  assert.deepEqual(init.headers, { apikey: 'klic', Authorization: 'Bearer tok', 'Content-Type': 'application/json' });
  assert.deepEqual(JSON.parse(init.body), { p_game_id: 'chess', p_data: { a: 'b' }, p_base_rev: 3 });
  await saveGameStateKeepalive({ ...base, token: 'tok', map: { velky: 'x'.repeat(70000) } });
  assert.equal(sent[1][1].keepalive, false, 'nad 64 kB keepalive prohlížeč nepřijme');
  assert.equal(await saveGameStateKeepalive({ ...base, token: 'tok', map: {}, fetchImpl: async () => { throw new Error('síť'); } }), false);
  assert.equal(await saveGameStateKeepalive({ ...base, token: 'tok', map: {}, fetchImpl: async () => ({ ok: false }) }), false);
});

/* ---------------------------------------------------------------- starý postup z prohlížeče */
test('readLegacyStorage čte jen klíče dané hry, clearLegacyStorage maže jen je; chyby úložiště nevadí', () => {
  const st = new FakeStorage();
  st.setItem('chessLeague.save.v1', '{"a":1}');
  st.setItem('chessLeague.game.v1', '{"b":2}');
  st.setItem('space_shooter_v2_9', 'cizi-hra');
  st.setItem('theme', 'dark');
  assert.deepEqual(readLegacyStorage('chess', st), { 'chessLeague.save.v1': '{"a":1}', 'chessLeague.game.v1': '{"b":2}' });
  assert.deepEqual(readLegacyStorage('neznama', st), {});
  assert.deepEqual(readLegacyStorage('rocket', null), {});
  clearLegacyStorage('chess', ['chessLeague.save.v1', 'chessLeague.game.v1', 'theme', 'space_shooter_v2_9'], st);
  assert.deepEqual([...st.m.keys()], ['space_shooter_v2_9', 'theme'], 'cizí klíče a klíče jiných her zůstaly');
  const broken = { getItem() { throw new Error('zakázáno'); }, removeItem() { throw new Error('zakázáno'); } };
  assert.deepEqual(readLegacyStorage('chess', broken), {});
  assert.doesNotThrow(() => clearLegacyStorage('chess', ['chessLeague.save.v1'], broken));
});

/* ---------------------------------------------------------------- synchronizace */
// Falešné hodiny a časovače: čas jde jen dopředu přes advance(), asynchronní práce se dojede přes tick().
const makeClock = () => {
  let t = 0; let seq = 0; const timers = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => { const id = ++seq; timers.push({ id, at: t + ms, fn }); return id; },
    clearTimer: (id) => { const i = timers.findIndex((x) => x.id === id); if (i >= 0) timers.splice(i, 1); },
    pending: () => timers.map((x) => x.at - t).sort((a, b) => a - b),
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
const tick = async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r)); };
const store = (initial = { rev: 0, data: {} }) => {
  const server = { ...initial, saves: [], fail: 0, conflict: false, reject: null, legacy: [], importResult: null };
  const client = fakeClient({
    load_game_state: async () => ({ data: { rev: server.rev, data: server.data }, error: null }),
    import_legacy_game_state: async ({ p_data }) => {
      server.legacy.push(p_data);
      if (server.importError) return { data: null, error: { message: server.importError } };
      if (server.importResult) return { data: server.importResult, error: null };
      return { data: { imported: true, rev: 1, data: p_data }, error: null };
    },
    save_game_state: async ({ p_data, p_base_rev }) => {
      server.saves.push({ data: p_data, base: p_base_rev });
      if (server.fail > 0) { server.fail -= 1; return { data: null, error: { message: 'Failed to fetch' } }; }
      if (server.reject) return { data: null, error: { message: server.reject } };
      if (server.conflict) return { data: { ok: false, reason: 'conflict', rev: p_base_rev + 3 }, error: null };
      server.rev = p_base_rev + 1; server.data = p_data;
      return { data: { ok: true, rev: server.rev }, error: null };
    },
  });
  return { server, client };
};
const mkSync = (over = {}) => {
  const clock = makeClock(); const statuses = []; const s = store(over.initial);
  const sync = createGameSync({ client: s.client, gameId: 'rocket', setTimer: clock.setTimer, clearTimer: clock.clearTimer, now: clock.now, onStatus: (x) => statuses.push(x), ...over.opts });
  return { sync, clock, statuses, ...s };
};
const set = (sync, key, value) => sync.apply({ op: 'set', key, value });

test('sync.load: nový hráč má prázdný postup s revizí 0; zprávy ze hry před načtením se zahodí', async () => {
  const { sync } = mkSync();
  assert.equal(sync.isLoaded(), false);
  assert.equal(set(sync, 'a', '1'), false, 'než je postup načtený, změny se nepřijímají');
  await sync.load();
  assert.equal(sync.isLoaded(), true);
  assert.deepEqual(sync.snapshot(), { map: {}, rev: 0 });
});

test('sync.load: uložený postup se načte přesně jako text; snapshot je kopie', async () => {
  const { sync } = mkSync({ initial: { rev: 7, data: { k: '{"x":1}' } } });
  await sync.load();
  const snap = sync.snapshot();
  assert.deepEqual(snap, { map: { k: '{"x":1}' }, rev: 7 });
  snap.map.k = 'zmena';
  assert.equal(sync.snapshot().map.k, '{"x":1}');
});

test('sync.load: starý postup z prohlížeče se pošle serveru a smaže se až po úspěchu; platí odpověď serveru', async () => {
  const cleared = [];
  const legacy = { space_shooter_v2_9: '{"coins":50}' };
  const a = mkSync({ opts: { readLegacy: () => legacy, clearLegacy: (g, keys) => cleared.push([g, keys]) } });
  await a.sync.load();
  assert.deepEqual(a.server.legacy, [legacy]);
  assert.deepEqual(cleared, [['rocket', ['space_shooter_v2_9']]]);
  assert.deepEqual(a.sync.snapshot(), { map: legacy, rev: 1 });

  const cleared2 = [];
  const b = mkSync({ initial: { rev: 5, data: { z: 'server' } }, opts: { readLegacy: () => legacy, clearLegacy: (g, k) => cleared2.push(k) } });
  b.server.importResult = { imported: false, rev: 5, data: { z: 'server' } };
  await b.sync.load();
  assert.deepEqual(b.sync.snapshot(), { map: { z: 'server' }, rev: 5 }, 'když server už postup má, hraje se z něj');
  assert.deepEqual(cleared2, [['space_shooter_v2_9']], 'starý z prohlížeče se i tak smaže (server si ho uložil jako zálohu)');
});

test('sync.load: bez starého postupu se server na přenos neptá', async () => {
  const c = mkSync({ opts: { readLegacy: () => ({}) } });
  await c.sync.load();
  assert.deepEqual(c.client.calls.map((x) => x[0]), ['load_game_state']);
});

test('sync.load: chyba spojení při přenosu nebo načtení hru zastaví a starý postup zůstane v prohlížeči', async () => {
  const cleared = [];
  const a = mkSync({ opts: { readLegacy: () => ({ k: 'v' }), clearLegacy: (g, k) => cleared.push(k) } });
  a.server.importError = 'Failed to fetch';
  await assert.rejects(a.sync.load(), /Failed to fetch/);
  assert.equal(cleared.length, 0, 'starý postup se nesmí smazat, když se nepřenesl');
  assert.equal(a.sync.isLoaded(), false);
  const b = mkSync();
  b.client.rpc = async () => ({ data: null, error: new Error('network') });
  await assert.rejects(b.sync.load(), /network/);
  assert.equal(b.sync.isLoaded(), false);
});

test('sync.load: server starý postup odmítl kvůli tvaru: hraje se z uloženého a starý v prohlížeči zůstane nedotčený', async () => {
  const cleared = [];
  const quietWarn = console.warn; console.warn = () => {};
  try {
    const a = mkSync({ initial: { rev: 2, data: { z: 'server' } }, opts: { readLegacy: () => ({ k: 'v' }), clearLegacy: (g, k) => cleared.push(k) } });
    a.server.importError = 'too_large';
    await a.sync.load();
    assert.deepEqual(a.sync.snapshot(), { map: { z: 'server' }, rev: 2 });
    assert.equal(cleared.length, 0);
  } finally { console.warn = quietWarn; }
});

test('sync: změny se ukládají až po odkladu, jedním požadavkem s posledními hodnotami a se správnou revizí', async () => {
  const { sync, clock, server } = mkSync({ initial: { rev: 3, data: { old: 'x' } } });
  await sync.load();
  set(sync, 'a', '1'); await clock.advance(1000);
  set(sync, 'a', '2'); set(sync, 'b', '3'); await clock.advance(2000);
  assert.equal(server.saves.length, 0, 'odklad se při každé změně prodlužuje');
  await clock.advance(1000);
  assert.deepEqual(server.saves, [{ data: { old: 'x', a: '2', b: '3' }, base: 3 }]);
  assert.deepEqual(sync.snapshot(), { map: { old: 'x', a: '2', b: '3' }, rev: 4 });
  assert.equal(sync.state().dirty, false);
  set(sync, 'c', '4'); await clock.advance(2500);
  assert.equal(server.saves[1].base, 4, 'další uložení nese novou revizi');
});

test('sync: při nepřetržitých změnách se nejpozději po 15 s uloží', async () => {
  const { sync, clock, server } = mkSync();
  await sync.load();
  for (let i = 0; i < 12; i += 1) { set(sync, 'a', String(i)); await clock.advance(2000); }
  assert.ok(server.saves.length >= 1, 'uložilo se i přes stálé změny');
  assert.ok(server.saves.length <= 2);
});

test('sync: stejná hodnota, smazání neexistujícího klíče a prázdný clear nic neodešlou; remove a clear se ukládají', async () => {
  const { sync, clock, server } = mkSync({ initial: { rev: 1, data: { a: '1', b: '2' } } });
  await sync.load();
  assert.equal(set(sync, 'a', '1'), true);
  assert.equal(sync.apply({ op: 'remove', key: 'nikdy' }), true);
  await clock.advance(10000);
  assert.equal(server.saves.length, 0);
  sync.apply({ op: 'remove', key: 'a' }); await clock.advance(2500);
  assert.deepEqual(server.saves.at(-1).data, { b: '2' });
  sync.apply({ op: 'clear' }); await clock.advance(2500);
  assert.deepEqual(server.saves.at(-1).data, {});
  assert.equal(sync.apply({ op: 'clear' }), true);
  await clock.advance(10000);
  assert.equal(server.saves.length, 2, 'druhý clear už nic neposlal');
  for (const bad of [null, undefined, 'x', {}, { op: 'set' }, { op: 'set', key: 1, value: 'x' }, { op: 'set', key: 'a', value: 5 }, { op: 'remove' }, { op: 'jine' }]) assert.equal(sync.apply(bad), false, JSON.stringify(bad));
});

test('sync.flush uloží hned a bez změn nic neposílá; flush za běhu uložení počká a dosadí novější změny', async () => {
  const { sync, clock, server } = mkSync();
  await sync.load();
  await sync.flush();
  assert.equal(server.saves.length, 0);
  set(sync, 'a', '1');
  await sync.flush();
  assert.deepEqual(server.saves, [{ data: { a: '1' }, base: 0 }]);
  set(sync, 'a', '2');
  const first = sync.flush();
  set(sync, 'a', '3');
  const second = sync.flush();
  await Promise.all([first, second]);
  assert.equal(server.saves.at(-1).data.a, '3', 'poslední hodnota je na serveru');
  assert.equal(sync.state().dirty, false);
  await clock.advance(20000);
  assert.equal(server.saves.at(-1).data.a, '3');
});

test('sync: chyba spojení: jednou se ohlásí, opakuje se s rostoucími prodlevami, po úspěchu se ohlásí obnovení', async () => {
  const { sync, clock, server, statuses } = mkSync();
  await sync.load();
  server.fail = 3;
  set(sync, 'a', '1'); await clock.advance(2500);
  assert.deepEqual(statuses, [{ state: 'failing', failures: 1 }]);
  assert.equal(server.saves.length, 1);
  set(sync, 'a', '2'); await clock.advance(2500);
  assert.equal(server.saves.length, 1, 'během čekání na opakování nová změna odklad nezkracuje ani neprodlužuje');
  await clock.advance(1000);
  assert.equal(server.saves.length, 2, 'první opakování po 3 s');
  assert.deepEqual(statuses.length, 1, 'neohlašuje se při každém neúspěchu');
  await clock.advance(7000);
  assert.equal(server.saves.length, 2);
  await clock.advance(1000);
  assert.equal(server.saves.length, 3, 'druhé opakování po 8 s');
  await clock.advance(20000);
  assert.equal(server.saves.length, 4, 'třetí opakování po 20 s uspělo');
  assert.deepEqual(server.saves.at(-1), { data: { a: '2' }, base: 0 }, 'uložila se poslední hodnota');
  assert.deepEqual(statuses, [{ state: 'failing', failures: 1 }, { state: 'ok', recovered: true }]);
  assert.equal(sync.state().dirty, false);
});

test('sync: konflikt revize ukládání zastaví a ohlásí; nová změna už nic neposílá; load() ho zase rozběhne', async () => {
  const { sync, clock, server, statuses } = mkSync({ initial: { rev: 2, data: { a: 'x' } } });
  await sync.load();
  server.conflict = true;
  set(sync, 'a', 'moje'); await clock.advance(2500);
  assert.deepEqual(statuses, [{ state: 'conflict', rev: 5 }]);
  assert.equal(sync.state().stopped, true);
  set(sync, 'a', 'jeste-moje'); await clock.advance(30000);
  assert.equal(server.saves.length, 1, 'po konfliktu se už nic neposílá');
  await sync.flush();
  assert.equal(server.saves.length, 1);
  server.conflict = false; server.rev = 5; server.data = { a: 'z-druheho-zarizeni' };
  await sync.load();
  assert.deepEqual(sync.snapshot(), { map: { a: 'z-druheho-zarizeni' }, rev: 5 });
  assert.equal(sync.state().stopped, false);
  set(sync, 'b', '1'); await clock.advance(2500);
  assert.deepEqual(server.saves.at(-1), { data: { a: 'z-druheho-zarizeni', b: '1' }, base: 5 });
});

test('sync: server postup odmítl (příliš velký) nebo má nesmyslný tvar: stav "rejected", žádné opakování', async () => {
  const a = mkSync();
  await a.sync.load();
  a.server.reject = 'too_large';
  set(a.sync, 'a', 'x'); await a.clock.advance(2500);
  assert.deepEqual(a.statuses, [{ state: 'rejected', reason: 'too_large' }]);
  await a.clock.advance(120000);
  assert.equal(a.server.saves.length, 1);

  const b = mkSync();
  await b.sync.load();
  for (let i = 0; i < 41; i += 1) set(b.sync, `k${i}`, 'x');
  await b.clock.advance(2500);
  assert.equal(b.server.saves.length, 0, 'nesmyslný tvar se na server ani neposílá');
  assert.deepEqual(b.statuses, [{ state: 'rejected', reason: 'invalid_data' }]);
});

test('sync.flushOnHide: pošle neuložený postup přes keepalive, jinak nic', async () => {
  const sent = [];
  const { sync, clock } = mkSync({ initial: { rev: 2, data: {} }, opts: { keepalive: (a) => sent.push(a) } });
  await sync.load();
  sync.flushOnHide();
  assert.equal(sent.length, 0, 'bez změn se nic neposílá');
  set(sync, 'a', '1');
  sync.flushOnHide();
  assert.deepEqual(sent, [{ gameId: 'rocket', map: { a: '1' }, baseRev: 2 }]);
  assert.deepEqual(clock.pending(), [], 'odložený časovač se zrušil, ať se nic neodešle dvakrát');
  const noHook = mkSync();
  await noHook.sync.load();
  set(noHook.sync, 'a', '1');
  assert.doesNotThrow(() => noHook.sync.flushOnHide());
});

test('sync.dispose: zruší časovač i opakování, ale flush před tím dokončí', async () => {
  const { sync, clock, server } = mkSync();
  await sync.load();
  set(sync, 'a', '1');
  const done = sync.flush();
  sync.dispose();
  await done;
  assert.equal(server.saves.length, 1, 'rozpracované uložení doběhlo');
  server.fail = 5;
  set(sync, 'a', '2');
  await sync.flush();
  assert.equal(server.saves.length, 2);
  assert.deepEqual(clock.pending(), [], 'po dispose se opakování neplánuje');
});

/* ---------------------------------------------------------------- napojení */
test('Games.jsx: hra se spustí až po načtení postupu, iframe dostává dokument s náhradou úložiště a zprávy ze hry se ukládají', () => {
  const g = read('pages', 'Games.jsx');
  assert.match(g, /import \{ createGameSync \} from '\.\.\/gameSave\/sync';/);
  assert.match(g, /srcDoc=\{gameDoc\}/);
  assert.ok(!/srcDoc=\{html\}/.test(g), 'iframe nesmí dostat dokument bez náhrady úložiště');
  assert.match(g, /setGameDoc\(withStorageShim\(src, game\.id, sync\.snapshot\(\)\.map\)\)/);
  const open = g.slice(g.indexOf('const handleOpenGame'), g.indexOf('// Při najetí myší'));
  assert.ok(open.indexOf('await sync.load()') > -1 && open.indexOf('await sync.load()') < open.indexOf('setShowGame(true)'), 'postup se načte dřív, než se hra ukáže');
  assert.match(open, /if \(mountedRef\.current\) \{ setSaveLoadError\(true\); setLoadingGame\(false\); \}\n\s+return;/, 'při chybě se hra nespustí');
  assert.match(open, /!sync\.isLoaded\(\) \|\| sync\.state\(\)\.stopped/, 'načtený postup se znovu nenačítá, jen po konfliktu');
  assert.match(g, /event\.data\?\.type === 'storage'\) \{[^}]*syncRef\.current\?\.apply\(event\.data\);/);
  assert.match(g, /syncRef\.current\?\.flush\(\); \/\/ postup se uloží hned/);
  assert.match(g, /addEventListener\('pagehide', onHide\)/);
  assert.match(g, /visibilityState === 'hidden'\) syncRef\.current\?\.flush\(\)/);
  assert.match(g, /sync\.flush\(\)\.finally\(\(\) => sync\.dispose\(\)\)/, 'při odchodu ze stránky se postup dohraje');
  assert.match(g, /data-testid="save-load-error"/);
  assert.match(g, /<GameBar [^>]*saveStatus=\{saveStatus\}/);
  assert.match(g, /Postup ve hře \(vylepšení, nastavení, rozehraná partie\), rekordy i herní odznaky se ukládají k tvému účtu/);
  assert.ok(!/zůstávají jen v tomhle prohlížeči/.test(g), 'stará věta o ukládání jen v prohlížeči je pryč');
});

test('zprávy z hry se přijímají jen z iframu této hry (stejná kontrola jako u mincí a rekordů)', () => {
  const g = read('pages', 'Games.jsx');
  const handler = g.slice(g.indexOf('const handleMessage = (event) => {'), g.indexOf("if (event.data?.type === 'close')"));
  assert.match(handler, /event\.data\?\.source !== 'jomarid-game'\) return;/);
  assert.match(handler, /event\.source !== iframeRef\.current\.contentWindow\) return;/);
});

test('lišta nad hrou ukáže štítek, když se postup neukládá, a hlášky jsou česky bez kódů', () => {
  const bar = read('components', 'GameBar.jsx');
  assert.match(bar, /saveStatus && SAVE_CHIPS\[saveStatus\]/);
  assert.match(bar, /data-testid="game-bar-save"/);
  for (const text of [...Object.values(SAVE_MESSAGES), ...Object.values(SAVE_CHIPS)]) assert.ok(text.length > 5 && !/[a-z]_[a-z]/.test(text), text);
  assert.deepEqual(Object.keys(SAVE_CHIPS).sort(), ['conflict', 'failing', 'rejected']);
});

test('export dat účtu obsahuje uložený postup her (funkce nemusí v databázi být)', () => {
  const modal = read('components', 'SettingsModal.jsx');
  assert.match(modal, /\{ key: 'game_saves', rpc: 'my_game_saves', optional: true \}/);
});

test('npm test pouští i testy uloženého postupu a SQL testy je zahrnují', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(SRC, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['test:gamesave'], 'node --test src/tests/gameSave.test.mjs');
  assert.ok(pkg.scripts.test.includes('npm run test:gamesave'));
  assert.ok(fs.readFileSync(path.join(DB, 'tests', 'run.sh'), 'utf8').includes('game_saves.test.sql'));
});

test('znovu otevřená hra přebírá stav ukládání (štítek zůstane, dokud se postup neukládá)', () => {
  const g = read('pages', 'Games.jsx');
  assert.match(g, /const \{ status \} = sync\.state\(\);[^\n]*\n\s+setSaveStatus\(status === 'ok' \? null : status\);/);
});

test('shim: hra, která se sama znovu načte, dostane aktuální postup z okna appky; bez něj (nebo při chybě) ten vložený', () => {
  const run = (parent) => {
    const win = { Storage: FakeStorage, localStorage: new FakeStorage(), sessionStorage: new FakeStorage(), parent };
    win.window = win;
    vm.runInNewContext(buildStorageShim('warroom', { a: 'vlozeny', jen_vlozeny: '1' }), win);
    return win.localStorage;
  };
  const posts = () => {};
  const live = run({ postMessage: posts, __jomaridGameSave: { read: (g) => (g === 'warroom' ? { a: 'aktualni' } : null) } });
  assert.equal(live.getItem('a'), 'aktualni');
  assert.equal(live.getItem('jen_vlozeny'), null, 'platí aktuální postup, ne směs s vloženým');
  assert.equal(run({ postMessage: posts, __jomaridGameSave: { read: () => null } }).getItem('a'), 'vlozeny');
  assert.equal(run({ postMessage: posts, __jomaridGameSave: { read: () => { throw new Error('x'); } } }).getItem('a'), 'vlozeny');
  assert.equal(run({ postMessage: posts }).getItem('a'), 'vlozeny');
  assert.equal(run({ postMessage: posts, __jomaridGameSave: { read: () => 'text' } }).getItem('a'), 'vlozeny', 'nesmyslná odpověď se ignoruje');
  const g = read('pages', 'Games.jsx');
  assert.match(g, /window\.__jomaridGameSave = store;/);
  assert.match(g, /read: \(gameId\) => \(gameId === game\.id && syncRef\.current \? syncRef\.current\.snapshot\(\)\.map : null\)/);
});
