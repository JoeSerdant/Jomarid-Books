// Warroom: grafická vrstva (karty s emblémy, HUD rámečky, přístroje) a celistvost dokumentu.
//   npm run test:warroom
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(SRC, 'gameContent', 'warroom', 'index.html'), 'utf8');
const css = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'));
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const game = scripts.find((s) => s.includes('const RAW_SCENARIOS'));

test('dokument: jedno style, skripty se dají přeložit a CSS má vyvážené závorky', () => {
  assert.equal(html.split('<style>').length, 2);
  assert.ok(scripts.length >= 2 && game);
  for (const code of scripts) assert.doesNotThrow(() => new vm.Script(code));
  let depth = 0;
  for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''")) { if (ch === '{') depth += 1; if (ch === '}') depth -= 1; assert.ok(depth >= 0, 'přebývá }'); }
  assert.equal(depth, 0, 'chybí }');
});

test('grafika: každý štítek scénáře a každá doktrína má ikonu a karty dostávají barvu a číslo operace', () => {
  const tags = [...new Set([...game.matchAll(/tag: '([A-Z -]+)'/g)].map((m) => m[1]))];
  const iconTags = game.match(/const TAG_ICONS = \{([^}]*)\}/)[1];
  for (const t of tags) assert.ok(iconTags.includes(`'${t}'`), 'chybí ikona štítku ' + t);
  const docIds = [...game.slice(game.indexOf('const DOCTRINES')).matchAll(/\{ id: '([a-z_]+)', name:/g)].map((m) => m[1]);
  assert.ok(docIds.length >= 10);
  const iconDocs = game.match(/const DOCTRINE_ICONS = \{([^}]*)\}/)[1];
  for (const d of docIds) assert.ok(new RegExp(`\\b${d}:`).test(iconDocs), 'chybí ikona doktríny ' + d);
  assert.match(game, /card\.style\.setProperty\('--tag', badgeBg\)/);
  assert.match(game, /OP-\$\{String\(scIdx \+ 1\)\.padStart\(2, '0'\)\}/);
  assert.match(game, /DOK-\$\{String\(docIdx \+ 1\)\.padStart\(2, '0'\)\}/);
  // zamčené karty ukazují zámek, ne ikonu scénáře
  assert.match(game, /isUnlocked \? \(TAG_ICONS\[sc\.tag\] \|\| '🎖️'\) : '🔒'/);
});

test('grafika: HUD vrstva (rohové značky, ukazatele, fronta, radar, terminál) a původní chování tlačítek zůstalo', () => {
  for (const sel of ['.glass-panel {', '.card-emblem {', '.stat-box {', '#gauge {', '#gauge::after', '#radar {', '.target-zone {', '#pointer {', '.terminal-log {', '#overlay-sector {']) assert.ok(css.includes(sel), sel);
  for (const name of ['gaugeFlow', 'zonePulse']) assert.ok(css.includes(`@keyframes ${name}`), name);
  // původní funkční třídy a animace zůstaly
  for (const sel of ['.crisis {', '.vietnam-hidden #gauge', '.flash-good', '@keyframes crisisPulse', '.btn-main {', '.btn-gold {']) assert.ok(css.includes(sel), sel);
  // ukazatel fronty se barví přes backgroundColor, takže vrstvy v background-image na něj nesmí sahat shorthandem
  assert.match(game, /g\.style\.backgroundColor = /);
  const layer = css.slice(css.indexOf('#gauge {\n            background-image'));
  assert.ok(layer.startsWith('#gauge {\n            background-image'), 'gauge používá background-image, ne background');
  // tlačítka zvuk a nápověda stojí vedle odkazu zpět
  assert.match(css, /#sound-toggle \{ top: 8px; left: 148px; \}/);
});

/* ---------------------------------------------------------------- čítače pro odznaky (src/gameRecords/defs/warroom.js) */
const fnSrc = (name) => { const i = game.indexOf(`    function ${name}(`); assert.ok(i >= 0, name); const j = game.indexOf('\n    function ', i + 10); return game.slice(i, j < 0 ? undefined : j); };
const ids = (marker, re) => [...game.slice(game.indexOf(marker)).matchAll(re)].map((m) => m[1]);
const makeStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };

function makeEnv() {
  const records = new Map();
  const storage = makeStorage();
  const cheatLit = game.match(/const CHEAT_STATS = (\{[^}]*\});/)[1];
  const scenarios = ids('const RAW_SCENARIOS', /\{ id: '([a-z0-9_]+)', tag:/g).slice(0, 24);
  const doctrines = ids('const DOCTRINES', /\{ id: '([a-z_]+)', name:/g);
  const toasts = [];
  const ctx = vm.createContext({
    Math, Object, JSON, Array, console, localStorage: storage, setTimeout: () => 0, location: { reload() {} }, toasts,
    jomaridRecord: (k, v) => { records.set(k, Math.max(records.get(k) || 0, Math.floor(Number(v)) || 0)); },
    SCENARIOS: scenarios.map((id) => ({ id })), DOCTRINES: doctrines.map((id) => ({ id })),
    Sound: { buy() {} }, el: () => ({ style: { display: 'none' }, innerText: '' }), showUnlockNotification: (t) => toasts.push(t), updateUI() {}, checkWinLoss() {},
    state: {},
  });
  vm.runInContext(`${fnSrc('loadProgress')}\n${fnSrc('reportRecords')}\n${fnSrc('saveProgress')}\n${fnSrc('warTrack')}\nconst CHEAT_STATS = ${cheatLit};\n${fnSrc('cheatAction')}`, ctx);
  return { ctx, records, storage, scenarios, doctrines, run: (code) => vm.runInContext(code, ctx) };
}

test('čítače: warTrack přičítá, drží nejvyšší hodnoty a pamatuje si vyzkoušené scénáře a doktríny', () => {
  const e = makeEnv();
  e.run("warTrack({ attacks: 1, crits: 0 }); warTrack({ attacks: 2 }, { best_day: 10, cp_peak: 50 }); warTrack(null, { best_day: 4, cp_peak: 900 }, { scen: 'zombie' }); warTrack(null, null, { scen: 'zombie' }); warTrack(null, null, { docts: 'blitz' });");
  const st = JSON.parse(e.storage.getItem('warroom_frontlines_save_v1')).stats;
  assert.deepEqual(st, { attacks: 3, crits: 0, best_day: 10, cp_peak: 900, scen: { zombie: 1 }, docts: { blitz: 1 } });
  assert.equal(e.records.get('attacks'), 3);
  assert.equal(e.records.get('scenarios_started'), 1);
  assert.equal(e.records.get('doctrines_used'), 1);
});

test('čítače: starý uložený postup bez statistik se načte a nic se neztratí', () => {
  const e = makeEnv();
  e.storage.setItem('warroom_frontlines_save_v1', JSON.stringify({ unlockedScenarios: ['default', 'korea'], unlockedDoctrines: ['blitz'], highScores: { default: 12 } }));
  e.run('warTrack({ sectors_cleared: 1 });');
  const p = JSON.parse(e.storage.getItem('warroom_frontlines_save_v1'));
  assert.deepEqual([p.unlockedScenarios, p.highScores.default, p.stats.sectors_cleared], [['default', 'korea'], 12, 1]);
});

test('čítače: každý z nich má ve hře své místo a unlockall čítače nesmaže', () => {
  const tracked = JSON.parse(game.match(/const TRACKED_STATS = (\[[^\]]*\])/s)[1].replace(/'/g, '"').replace(/\s+/g, ' '));
  assert.ok(tracked.length >= 20);
  for (const key of tracked) assert.match(game, new RegExp(`warTrack\\([^;]*\\b${key}\\b`), key);
  assert.match(game, /saveProgress\(\{ unlockedScenarios: allScen, unlockedDoctrines: allDoc, highScores: \{\}, stats: loadProgress\(\)\.stats \}\)/);
  assert.match(game, /if \(typeof msg === 'string' && msg\.indexOf\('SKILL:'\) === 0\) warTrack\(\{ skills_used: 1 \}\);/);
  assert.match(html, /cheatAction\('badges'\)/);
});

test('hra hlásí přesně statistiky z katalogu a cheat Všechny odznaky je dotáhne na prahy odznaků', async () => {
  const { GAME_CATALOG, GAME_BADGES } = await import('../gameRecords/catalog.js');
  const want = GAME_CATALOG.find((g) => g.id === 'warroom').stats.map((s) => s.key).sort();
  const e = makeEnv();
  e.run("cheatAction('badges');");
  e.run('reportRecords(loadProgress());');
  assert.deepEqual([...e.records.keys()].sort(), want, 'hra hlásí přesně statistiky z katalogu');
  for (const key of want) {
    const need = Math.max(...GAME_BADGES.filter((b) => b.game === 'warroom' && b.stat === key).map((b) => b.threshold));
    assert.ok(e.records.get(key) >= need, `${key}: cheat dá ${e.records.get(key)}, odznak chce ${need}`);
  }
  assert.ok(e.records.get('scenarios_unlocked') === e.scenarios.length, 'odemknuty všechny scénáře');
});
