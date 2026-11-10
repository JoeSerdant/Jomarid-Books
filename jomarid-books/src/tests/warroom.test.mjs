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
  vm.runInContext(`${fnSrc('cleanProgress')}\n${fnSrc('loadProgress')}\n${fnSrc('statValues')}\n${fnSrc('reportRecords')}\n${fnSrc('saveProgress')}\n${fnSrc('warTrack')}\nconst CHEAT_STATS = ${cheatLit};\n${fnSrc('cheatAction')}`, ctx);
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

/* ---------------------------------------------------------------- rozehrané tažení, šance na kritický zásah, záhlaví */
function makeRunEnv(extra = {}) {
  const storage = makeStorage();
  const timers = [];
  const els = { 'game-screen': { style: { display: 'block' } } };
  const baseState = () => ({
    scenario: '', doctrine: '', front: 250, maxFront: 500, supplies: 10, cp: 0, day: 1, sector: 1, baseEnemyPush: 6, isAiming: false, currentPointerPos: 50, enemyStunned: 0,
    exclusiveBought1: false, exclusiveBought2: false, exclusiveBought3: false, gamePaused: false, fanaticUsed: false, alienShield: 0, godMode: false, pendingSector: false,
    ww1_trenchPrep: 0, ww2_momentumPlayer: 0, ww2_momentumEnemy: 0, viet_revealed: 0, modern_counterTimer: 0, zombie_mutation: 0, costArt: 30, costAir: 20, costSkill: 0,
    upgrades: { supply: { name: 'Logistika', level: 1, cost: 15 }, radar: { name: 'Optika', level: 1, cost: 25 }, dmg: { name: 'Zbraně', level: 1, cost: 40 }, cpGain: { name: 'Velení', level: 1, cost: 20 },
      armor: { name: 'Pancíř', level: 1, cost: 30 }, recon: { name: 'Průzkum', level: 1, cost: 35 }, critical: { name: 'Kritika', level: 1, cost: 30 }, intel_gain: { name: 'Rozvědka', level: 1, cost: 25 }, engineering: { name: 'Ženisté', level: 1, cost: 35 } },
  });
  const code = `const RUN_KEY = 'warroom_run_v1'; let runSaveTimer = null;\n${['runIsActive', 'saveRunNow', 'scheduleRunSave', 'clearRun', 'normalizeRun', 'loadRun', 'getCritChance'].map(fnSrc).join('\n')}`;
  const ctx = vm.createContext({
    state: baseState(), localStorage: storage, el: (id) => els[id], SCENARIOS: [{ id: 'default' }, { id: 'ww2_pacific' }, { id: 'falklands' }, { id: 'vietnam' }],
    DOCTRINES: [{ id: 'blitz' }, { id: 'fortress' }, { id: 'intel' }, { id: 'artillery' }], JSON, Math, Object, Number, Date, isFinite, Array,
    setTimeout: (f, ms) => { timers.push([f, ms]); return timers.length; }, clearTimeout() {}, getSynergyBonus: () => 0, ...extra,
  });
  vm.runInContext(code, ctx);
  return { ctx, storage, timers, els, fresh: baseState };
}
const plain = (v) => JSON.parse(JSON.stringify(v));

test('šance na kritický zásah: základ doktríny, scénáře, výzkum Kritika a synergie se sčítají a ukazatel nahoře ukazuje totéž, s čím se hází', () => {
  const crit = (patch, bonus = 0) => { const e = makeRunEnv({ getSynergyBonus: (t) => (t === 'crit' ? bonus : 0) }); Object.assign(e.ctx.state, patch); return Math.round(vm.runInContext('getCritChance()', e.ctx) * 100); };
  assert.equal(crit({ doctrine: 'blitz', scenario: 'default' }), 15);
  assert.equal(crit({ doctrine: 'intel', scenario: 'default' }), 40);
  assert.equal(crit({ doctrine: 'artillery', scenario: 'default' }), 5);
  assert.equal(crit({ doctrine: 'blitz', scenario: 'falklands' }), 25, 'Falklandy +10 %');
  assert.equal(crit({ doctrine: 'blitz', scenario: 'vietnam', exclusiveBought2: true, viet_revealed: 2 }), 35, 'Tunelové krysy +20 %');
  assert.equal(crit({ doctrine: 'blitz', scenario: 'vietnam', exclusiveBought2: true, viet_revealed: 0 }), 15, 'bez odhalené džungle ne');
  assert.equal(crit({ doctrine: 'blitz', scenario: 'default' }, 0.15), 30, 'synergie');
  const e = makeRunEnv(); e.ctx.state.doctrine = 'blitz'; e.ctx.state.scenario = 'default'; e.ctx.state.upgrades.critical.level = 5;
  assert.equal(Math.round(vm.runInContext('getCritChance()', e.ctx) * 100), 35, 'výzkum Kritika +5 % za úroveň');
  // ukazatel se překresluje při každém updateUI, ne jen při volbě doktríny
  assert.match(game, /el\('val-crit'\)\.innerText = `\$\{Math\.round\(Math\.max\(0, Math\.min\(1, getCritChance\(\)\)\) \* 100\)\}%`;/);
  assert.match(game, /let critChance = getCritChance\(\);/);
  assert.doesNotMatch(fnSrc('resolveAttack'), /state\.doctrine === 'intel' \? 0\.40/, 'výpočet už není rozepsaný podruhé');
});

test('rozehrané tažení: uloží se jen za hry, ne při míření a ne při pauze, a debounce nezahltí úložiště', () => {
  const e = makeRunEnv();
  Object.assign(e.ctx.state, { scenario: 'default', doctrine: 'blitz', day: 7 });
  e.ctx.scheduleRunSave(); e.ctx.scheduleRunSave(); e.ctx.scheduleRunSave();
  assert.equal(e.timers.length, 1, 'jedno odložené uložení');
  e.timers[0][0]();
  const saved = JSON.parse(e.storage.getItem('warroom_run_v1'));
  assert.equal(saved.v, 1);
  assert.equal(saved.state.day, 7);
  e.storage.removeItem('warroom_run_v1');
  e.ctx.state.isAiming = true; e.ctx.saveRunNow(false);
  assert.equal(e.storage.getItem('warroom_run_v1'), null, 'při míření se neukládá (zásoby za útok už jsou strženy)');
  e.ctx.state.isAiming = false; e.ctx.state.gamePaused = true; e.ctx.saveRunNow(false);
  assert.equal(e.storage.getItem('warroom_run_v1'), null, 'při pauze ne');
  e.ctx.saveRunNow(true);
  assert.equal(e.storage.getItem('warroom_run_v1'), null, 'vynucené uložení jen pro zabraný sektor');
  e.ctx.state.pendingSector = true; e.ctx.saveRunNow(true);
  assert.equal(JSON.parse(e.storage.getItem('warroom_run_v1')).state.pendingSector, true);
  e.ctx.clearRun();
  assert.equal(e.storage.getItem('warroom_run_v1'), null);
  // před výběrem doktríny (hra se ještě nezobrazila) nic
  const f = makeRunEnv(); f.els['game-screen'].style.display = 'none'; Object.assign(f.ctx.state, { scenario: 'default', doctrine: 'blitz' }); f.ctx.saveRunNow(false);
  assert.equal(f.storage.getItem('warroom_run_v1'), null);
});

test('rozehrané tažení: uložení se při načtení ověří (poškozená, upravená a cizí data se zahodí), neznámá pole se nepřenesou a přechodné stavy se vynulují', () => {
  const e = makeRunEnv();
  const good = () => { const s = plain(e.fresh()); Object.assign(s, { scenario: 'ww2_pacific', doctrine: 'fortress', front: 120, maxFront: 230, supplies: 9, cp: 55, day: 14, sector: 3 }); s.upgrades.dmg.level = 4; s.upgrades.dmg.cost = 164; return { v: 1, t: 1700000000000, state: s }; };
  const run = e.ctx.normalizeRun(JSON.stringify(good()));
  assert.ok(run);
  assert.equal(run.state.sector, 3); assert.equal(run.state.upgrades.dmg.level, 4); assert.equal(run.state.upgrades.dmg.cost, 164);
  assert.equal(run.savedAt, 1700000000000);
  // zahozené případy
  const bad = [];
  const mut = (fn) => { const g = good(); fn(g); return JSON.stringify(g); };
  bad.push('nesmysl', '{', 'null', '[]', '{"v":2}', JSON.stringify({ v: 1 }), JSON.stringify({ v: 1, state: 5 }));
  bad.push(mut((g) => { g.state.scenario = 'neexistuje'; }), mut((g) => { g.state.doctrine = 'neexistuje'; }), mut((g) => { g.state.front = 'x'; }), mut((g) => { g.state.front = NaN; }),
    mut((g) => { g.state.front = 0; }), mut((g) => { g.state.maxFront = 0; }), mut((g) => { g.state.front = 5000; }), mut((g) => { g.state.supplies = -1; }), mut((g) => { g.state.cp = -3; }),
    mut((g) => { g.state.day = 0; }), mut((g) => { g.state.sector = 1e9; }), mut((g) => { delete g.state.upgrades.radar; }), mut((g) => { g.state.upgrades.radar.level = 0; }), mut((g) => { g.state.upgrades.radar.cost = 'x'; }));
  for (const text of bad) assert.equal(e.ctx.normalizeRun(text), null, text.slice(0, 60));
  // neznámá pole a přechodné stavy
  const extra = good(); extra.state.hax = 'x'; extra.state.isAiming = true; extra.state.godMode = true; extra.state.currentPointerPos = 3; extra.state.alienShield = 'x';
  const n = e.ctx.normalizeRun(extra).state;
  assert.equal(n.hax, undefined);
  assert.equal(n.isAiming, false); assert.equal(n.godMode, false); assert.equal(n.currentPointerPos, 50);
  assert.equal(n.alienShield, undefined, 'špatný typ pole se nepřevezme (zůstane hodnota z nové hry)');
  // sektor zabraný před zavřením: po obnovení čeká na potvrzení
  const pend = good(); pend.state.pendingSector = true;
  assert.equal(e.ctx.normalizeRun(pend).state.gamePaused, true);
  assert.equal(e.ctx.normalizeRun(good()).state.gamePaused, false);
  // loadRun zahodí poškozené uložení i z úložiště
  e.storage.setItem('warroom_run_v1', '{"v":1,"state":{"scenario":"default"}}');
  assert.equal(e.ctx.loadRun(), null);
  assert.equal(e.storage.getItem('warroom_run_v1'), null);
  e.storage.setItem('warroom_run_v1', JSON.stringify(good()));
  assert.ok(e.ctx.loadRun());
  assert.ok(e.storage.getItem('warroom_run_v1'), 'platné uložení zůstane');
});

test('rozehrané tažení: napojení do hry (uložení po každé změně, smazání při porážce a resetu, obnovení bez dvojího započítání sektoru, odkaz zpět po porážce)', async () => {
  assert.match(game, /checkWinLoss\(\); \n        scheduleRunSave\(\);\n    \}/);
  assert.match(game, /state\.pendingSector = true;\n\s*saveRunNow\(true\);/, 'zabraný sektor se uloží hned');
  assert.match(game, /state\.gamePaused = true;\n\s*clearRun\(\);\n\s*warTrack\(\{ defeats: 1 \}/, 'porážka maže uložení');
  assert.match(game, /localStorage\.removeItem\('warroom_frontlines_save_v1'\); localStorage\.removeItem\(RUN_KEY\);/, 'reset postupu maže i rozehrané tažení');
  assert.match(game, /state\.gamePaused = false; \n\s*state\.pendingSector = false;/, 'nový sektor zruší čekání');
  const resume = fnSrc('resumeRun');
  assert.match(resume, /if \(state\.pendingSector\) \{[\s\S]*?showSectorOverlay\(\);[\s\S]*?state\.gamePaused = true;[\s\S]*?\} else \{[\s\S]*?updateUI\(\);/, 'u zabraného sektoru se updateUI nevolá (výhra se nesmí započítat podruhé)');
  assert.match(game, /window\.addEventListener\('pagehide', \(\) => saveRunNow\(false\)\);/);
  assert.match(game, /document\.addEventListener\('visibilitychange', \(\) => \{ if \(document\.hidden\) saveRunNow\(false\); \}\);/);
  // odkaz zpět do appky přežije obrazovku porážky
  assert.match(game, /const backLink = document\.getElementById\('btn-back-to-jomarid'\);[\s\S]*?document\.body\.innerHTML = backHtml \+ `<div id="vignette-flash">/);
  // tlačítka na výběru scénáře a nový klíč v katalogu uložení
  assert.match(html, /<button class="btn-main resume-btn" id="btn-resume" onclick="resumeRun\(\)">/);
  assert.match(html, /onclick="discardRun\(\)"/);
  const { LEGACY_KEYS } = await import('../gameSave/catalog.js');
  assert.ok(LEGACY_KEYS.warroom.includes('warroom_run_v1'));
  assert.match(game, /const RUN_KEY = 'warroom_run_v1';/);
  // štítky z výběru doktríny a obnovení pocházejí ze stejných tabulek
  assert.match(game, /const scMap = SCENARIO_SHORT;/);
  assert.match(fnSrc('resumeRun'), /SCENARIO_SHORT\[state\.scenario\]/);
  const tags = vm.runInNewContext(`${game.match(/const SCENARIO_SHORT = \{[\s\S]*?\n    \};/)[0]}\nSCENARIO_SHORT`);
  const docs = vm.runInNewContext(`${game.match(/const DOCTRINE_SHORT = \{[\s\S]*?\n    \};/)[0]}\nDOCTRINE_SHORT`);
  const scIds = ids('const RAW_SCENARIOS', /\{ id: '([a-z0-9_]+)', tag:/g).slice(0, 24);
  const docIds = ids('const DOCTRINES', /\{ id: '([a-z_]+)', name:/g);
  for (const id of scIds) assert.ok(tags[id], 'štítek scénáře ' + id);
  for (const id of docIds) assert.ok(docs[id], 'štítek doktríny ' + id);
});

test('záhlaví hry: štítky scénáře, doktríny a dne se na úzkém displeji zalomí a nepřekrývají', () => {
  assert.match(css, /\.header \{ flex-wrap: wrap; gap: 8px 12px; \}/);
  assert.match(css, /\.header > div \{ display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; \}/);
  assert.match(css, /\.header > div \.badge \{ margin-left: 0; \}/);
});

test('omezený pohyb: radar, otřes, pulzování a částice se při nastavení systému vypnou, čísla nad polem se jen zprůhlední', () => {
  const start = css.indexOf('@media (prefers-reduced-motion: reduce) {');
  assert.ok(start > 0, 'blok pro omezený pohyb existuje');
  const block = css.slice(start, css.indexOf('\n        }', start) + 10);
  for (const rule of [
    /body::before \{ animation: none; \}/,
    /\.shake, \.crisis, \.wizard-screen\.active \{ animation: none !important; \}/,
    /#gauge::after, \.target-zone \{ animation: none; \}/,
    /button:hover:not\(:disabled\)::before \{ animation: none; \}/,
    /\.float-text \{ animation: floatFadeCalm 1\.2s linear forwards; \}/,
    /\.particle \{ display: none; \}/,
    /#stats-menu \{ animation: none; \}/,
  ]) assert.match(block, rule);
  assert.doesNotMatch(css.match(/@keyframes floatFadeCalm [^\n]*/)[0], /transform/, 'klidná varianta se nehýbe');
  // hlídač: každé nekonečné pulzování nebo otáčení v CSS musí být v bloku vypnuté (jinak by přibylo něco, co omezený pohyb obejde)
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const infinite = [...new Set([...bare.matchAll(/([^{}]+)\{[^{}]*animation:[^;}]*infinite[^;}]*[;}]/g)].map((m) => m[1].trim().split(/\s*,\s*/)).flat())];
  assert.deepEqual([...infinite].sort(), ['#gauge::after', '.crisis', '.target-zone', 'body::before'], 'známé nekonečné animace: ' + infinite.join(' | '));
  // blok je na konci stylů (přebíjí pozdější pravidla se stejnou přesností)
  assert.ok(css.lastIndexOf('@media (prefers-reduced-motion: reduce) {') > css.lastIndexOf('animation: zonePulse'), 'blok je za posledním pravidlem s animací');
  for (const sel of infinite) assert.ok(block.includes(sel), `${sel} má nekonečnou animaci a v bloku pro omezený pohyb chybí`);
});

test('uložený postup: vadné seznamy, rekordy a čítače se při čtení opraví, platný postup zůstane beze změny', () => {
  const src = game.match(/    function cleanProgress\(raw\) \{[\s\S]*?\n    \}\n/)[0];
  const clean = vm.runInNewContext(`(${src.trim().replace(/^function cleanProgress/, 'function')})`, { Array, Object, Set, Number, isFinite });
  const plain = (v) => JSON.parse(JSON.stringify(v));
  const valid = { unlockedScenarios: ['default', 'ww1_west'], unlockedDoctrines: ['blitz', 'fortress', 'intel'], highScores: { default: 7, ww1_west: 3 }, stats: { attacks: 12, best_day: 40.5, scen: { default: 1, ww1_west: 1 }, docts: { blitz: 1 } }, budoucí: { a: 1 } };
  assert.deepEqual(plain(clean(valid)), valid, 'platný postup (i s neznámým klíčem) se nezmění');
  assert.notEqual(clean(valid), valid);
  // nic použitelného: výchozí postup, žádná výjimka
  for (const junk of [null, undefined, 5, 'x', [], true, {}]) assert.deepEqual(plain(clean(junk)), { unlockedScenarios: ['default'], unlockedDoctrines: ['blitz', 'fortress'], highScores: {}, stats: {} }, String(junk));
  const bad = plain(clean({ unlockedScenarios: { a: 1 }, unlockedDoctrines: 'intel', highScores: [1, 2], stats: [3] }));
  assert.deepEqual(bad, { unlockedScenarios: ['default'], unlockedDoctrines: ['blitz', 'fortress'], highScores: {}, stats: {} }, 'objekt, text a pole místo seznamů či map');
  const mixed = plain(clean({ unlockedScenarios: ['ww1_east', 5, null, {}, '', 'x'.repeat(41), 'ww1_east'], unlockedDoctrines: ['intel', 'intel', 7], highScores: { a: '12', b: 'x', c: -1, d: null, e: 1e999, f: 4 }, stats: { attacks: 'x', crits: -3, misses: NaN, saves: 5, scen: { a: 1, b: 0, c: 'ano' }, docts: [1], jiný: { a: 1 }, turns_total: 1e308 } }));
  assert.deepEqual(mixed.unlockedScenarios, ['ww1_east', 'default'], 'jen neprázdné texty, bez opakování, vždy se základním scénářem');
  assert.deepEqual(mixed.unlockedDoctrines, ['intel', 'blitz', 'fortress']);
  assert.deepEqual(mixed.highScores, { a: 12, d: 0, f: 4 }, 'rekordy jako čísla od nuly (null je číslo 0, nekonečno a text ne)');
  assert.deepEqual(mixed.stats, { saves: 5, scen: { a: 1, c: 1 }, turns_total: 1e308 }, 'čítače jen jako nezáporná čísla, scen a docts jako mapy');
  assert.match(game, /return cleanProgress\(JSON\.parse\(saved\)\);/, 'loadProgress používá čištění');
});

test('čeština: počet dní odhalené džungle se skloňuje (1 den, 2 až 4 dny, jinak dní) a skrytý vstup má název', () => {
  const src = game.match(/    function czPlural\(n, one, few, many\) \{[\s\S]*?\n    \}\n/)[0];
  const f = vm.runInNewContext(`(${src.trim().replace(/^function czPlural/, 'function')})`, { Math });
  const cases = { 0: 'dní', 1: 'den', 2: 'dny', 3: 'dny', 4: 'dny', 5: 'dní', 11: 'dní', 12: 'dní', 14: 'dní', 21: 'dní', 22: 'dny', 101: 'dní', 102: 'dny' };
  for (const [n, word] of Object.entries(cases)) assert.equal(f(Number(n), 'den', 'dny', 'dní'), word, `${n}`);
  assert.match(game, /DŽUNGLE ODHALENA \(\$\{state\.viet_revealed\} \$\{czPlural\(state\.viet_revealed, 'den', 'dny', 'dní'\)\}\)/);
  assert.match(html, /<input type="text" id="cheat-input"[^>]*value="v4\.2" aria-label="Tajný kód"/, 'pole dole na stránce má stejný název jako v ostatních hrách (čtečky obrazovky jinak hlásí nepopsané pole)');
});

test('okno: viewport pro telefon a panel se na užším okně posune pod tlačítka zvuku a nápovědy', () => {
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1/);
  const m = css.match(/@media \(max-width: 1300px\) \{\s*#game-screen, \.wizard-screen \{([^}]*)\}/);
  assert.ok(m, 'chybí pravidlo pro užší okno');
  const margin = Number((m[1].match(/margin-top:\s*(\d+)px/) || [])[1]);
  assert.match(m[1], /max-height:\s*calc\(100vh - \d+px\)/);
  // tlačítka (nejnižší umístění top + výška) musí skončit nad horním okrajem panelu
  // platné umístění je pravidlo "#id { top: Npx; left: Npx; }" (pozdější přebíjí první, které má top 16 px), výška je z původní definice
  const top = (id) => Number((css.match(new RegExp('^\\s*#' + id + ' \\{ top: (\\d+)px; left: \\d+px; \\}', 'm')) || [])[1]);
  const height = (id) => Number((css.match(new RegExp('#' + id + ' \\{[^}]*?height:\\s*(\\d+)px')) || [])[1]);
  for (const id of ['sound-toggle', 'tutorial-help-btn']) {
    assert.ok(top(id) > 0 && height(id) > 0, id);
    assert.ok(top(id) + height(id) <= margin, id + ' by zasahovalo do panelu: ' + top(id) + ' + ' + height(id) + ' > ' + margin);
  }
});

/* ---------------------------------------------------------------- okno Statistiky */
test('statistiky: statValues skládá hodnoty z postupu (odvozené i uložené) a reportRecords hlásí tytéž', () => {
  const e = makeEnv();
  const prog = { highScores: { a: 12, b: 3, c: 5 }, unlockedScenarios: ['default', 'korea', 'vietnam'], unlockedDoctrines: ['blitz', 'fortress'], stats: { scen: { x: 1, y: 1 }, docts: { blitz: 1 }, attacks: 7, best_day: 31 } };
  e.ctx.__prog = prog;
  const v = JSON.parse(e.run('JSON.stringify(statValues(__prog))'));
  assert.equal(v.best_sector, 12);
  assert.equal(v.scenarios_cleared, 3);
  assert.equal(v.scenarios_deep, 2, 'sektor 12 a 5 jsou "do 5. sektoru"');
  assert.equal(v.scenarios_unlocked, 3);
  assert.equal(v.scenarios_started, 2);
  assert.equal(v.doctrines_unlocked, 2);
  assert.equal(v.doctrines_used, 1);
  assert.equal(v.attacks, 7);
  assert.equal(v.best_day, 31);
  assert.equal(v.crits, undefined, 'co se nikdy nezapsalo, není definované (okno ukáže 0)');
  // prázdný postup: nuly
  const z = JSON.parse(e.run('JSON.stringify(statValues({}))'));
  assert.equal(z.best_sector, 0);
  assert.equal(z.scenarios_unlocked, 0);
  // reportRecords hlásí právě tytéž klíče
  e.run('reportRecords(__prog)');
  assert.equal(e.records.get('best_sector'), 12);
  assert.equal(e.records.get('attacks'), 7);
  assert.equal(e.records.get('doctrines_used'), 1);
});

test('statistiky: okno ukazuje přesně statistiky z katalogu se stejnými názvy a v pořadí skupin', async () => {
  const { GAME_CATALOG } = await import('../gameRecords/catalog.js');
  const cat = GAME_CATALOG.find((g) => g.id === 'warroom').stats;
  const groups = plain(vm.runInNewContext(game.match(/const STAT_GROUPS = (\[[\s\S]*?\n    \]);/)[1]));
  const rows = groups.flatMap(([, list]) => list.map(([key, label]) => ({ key, label })));
  assert.deepEqual(rows.map((r) => r.key).sort(), cat.map((c) => c.key).sort(), 'každá statistika z katalogu je v okně právě jednou');
  for (const r of rows) assert.equal(r.label, cat.find((c) => c.key === r.key).label, 'název ' + r.key);
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length);
});

test('statistiky: okno se vykreslí z postupu (české formátování čísel, poměr u scénářů a doktrín, nuly u neuložených)', () => {
  const e = makeEnv();
  const made = [];
  const mk = (tag) => { const n = { tag, className: '', textContent: '', children: [], appendChild(c) { n.children.push(c); } }; made.push(n); return n; };
  const body = mk('div');
  e.ctx.document = { createElement: mk };
  e.ctx.el = (id) => (id === 'stats-body' ? body : { style: { display: 'none' }, innerText: '' });
  e.storage.setItem('warroom_frontlines_save_v1', JSON.stringify({ unlockedScenarios: ['default', 'korea'], unlockedDoctrines: ['blitz', 'fortress', 'intel'], highScores: { default: 12, korea: 4 }, stats: { sectors_cleared: 1234567, attacks: 9, scen: { default: 1 }, docts: { blitz: 1, fortress: 1 } } }));
  e.run(`${game.match(/const STAT_GROUPS = \[[\s\S]*?\n    \];/)[0]}\n${fnSrc('renderStatsBody')}\nrenderStatsBody();`);
  const lis = made.filter((n) => n.tag === 'li');
  assert.equal(lis.length, 29, 'všech 29 statistik');
  const val = (label) => lis.find((li) => li.children[0].textContent === label).children[1].textContent;
  const nbsp = (t) => t.replace(/\s/g, ' ');
  assert.equal(nbsp(val('Dobyté sektory celkem')), '1 234 567', 'tisíce po česku');
  assert.equal(val('Nejdál v kampani (sektor)'), '12');
  assert.equal(val('Provedené ofenzívy'), '9');
  assert.equal(val('Prohraná tažení'), '0', 'neuloženo = 0');
  assert.equal(val('Odemčené scénáře'), '2 / ' + e.scenarios.length);
  assert.equal(val('Vyzkoušené scénáře'), '1 / ' + e.scenarios.length);
  assert.equal(val('Odemčené doktríny'), '3 / ' + e.doctrines.length);
  assert.equal(val('Vyzkoušené doktríny'), '2 / ' + e.doctrines.length);
  assert.equal(made.filter((n) => n.tag === 'h3').length, 4, 'čtyři skupiny');
  // opakované otevření nedělá duplicity (tělo se vždy nejdřív vyprázdní)
  assert.equal(body.textContent, '');
});

test('statistiky: tlačítko na výběru scénáře, okno je dialog, vrací fokus a zavírá se Escape, klepnutím mimo i tlačítkem', () => {
  assert.match(html, /<button class="btn-spec" id="btn-stats"[^>]*onclick="openStatsMenu\(\)">📊 STATISTIKY<\/button>/);
  assert.match(html, /<div id="stats-menu" role="dialog" aria-modal="true" aria-labelledby="stats-title" onclick="if \(event\.target === this\) closeStatsMenu\(\)">/);
  assert.match(html, /<h2 id="stats-title">/);
  assert.match(html, /<button id="stats-close" class="btn-main stats-close" onclick="closeStatsMenu\(\)">ZAVŘÍT<\/button>/);
  const open = fnSrc('openStatsMenu'), close = fnSrc('closeStatsMenu');
  assert.match(open, /statsOpener = document\.activeElement;/);
  assert.match(open, /panel\.scrollTop = 0;\s*\n\s*panel\.focus\(\{ preventScroll: true \}\);/, 'fokus jde na okno a seznam začíná nahoře');
  assert.match(html, /<div class="stats-panel" id="stats-panel" tabindex="-1">/);
  assert.match(game, /else if \(e\.key === 'Tab'\) \{ e\.preventDefault\(\); el\('stats-close'\)\.focus\(\); \}/, 'Tab zůstane v okně');
  assert.match(close, /statsOpener\.focus\(\)/, 'a po zavření zpátky');
  assert.match(game, /if \(el\('stats-menu'\)\.style\.display !== 'flex'\) return;\s*\n\s*if \(e\.key === 'Escape'\) closeStatsMenu\(\);/, 'Escape zavře jen otevřené okno');
  // okno je nad herními vrstvami a roluje se, když se nevejde
  assert.match(css, /#stats-menu \{[^}]*z-index: 3000;/);
  assert.match(css, /\.stats-panel \{[^}]*max-height: 90vh; overflow-y: auto;/);
  // kontrast textu v okně: popisky světle šedé a hodnoty bílé na tmavém pozadí
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const fg of ['#cbd5e1', '#9ca3af', '#93c5fd', '#ffffff']) assert.ok(contrast(fg, '#0a101c') >= 4.5, fg);
});

/* ---------------------------------------------------------------- online souboj velitelů (multiplayer) */
const mpSrc = fs.readFileSync(path.join(SRC, 'gameContent', 'warroom', 'mp.js'), 'utf8');
const assembler = fs.readFileSync(path.join(SRC, 'gameContent', 'warroom.js'), 'utf8');

test('souboj: denní tlak nepřítele je v online souboji útok soupeře (zbytek výpočtu zůstal), mp.js se do dokumentu skládá a bez rozhraní z appky nic nemění', () => {
  assert.equal(html.split('<!--__MP__-->').length, 2, 'jedno místo pro mp.js');
  assert.match(assembler, /import mp from '\.\/warroom\/mp\.js\?raw'/);
  assert.match(assembler, /html\.replace\('<!--__MP__-->', \(\) =>/);
  assert.match(fnSrc('getEnemyPush'), /let base = window\.jomaridMP \? \(state\.mpIncoming \|\| 0\) \+ 1 \+ Math\.floor\(state\.day \/ 2\) : state\.baseEnemyPush \+ Math\.floor\(state\.day \/ 4\) \+ \(\(state\.sector - 1\) \* 3\);/);
  assert.match(fnSrc('getEnemyPush'), /pctMod -= \(\(state\.upgrades\.armor\.level - 1\) \* 0\.05\);/, 'pancíř a doktríny zmírňují útok soupeře jako dřív tlak nepřítele');
  assert.doesNotMatch(mpSrc, /67MILUJU|CHEAT/);
});

// mp.js v atrapě hry: stav, den, tlak a funkce, které hra má. Ukáže se, co mp.js přidává: zamčení mimo tah, posun fronty, zprávy soupeře, konec.
function makeDuel({ slot = 1 } = {}) {
  const handlers = {}; const sent = []; const reports = []; const logs = [];
  const session = {};
  const mp = {
    enabled: true, init: { slot, match: 'm-test', opponent: { name: 'Marie' } },
    on(ev, fn) { handlers[ev] = fn; return mp; }, listen() { mp.listening = true; },
    move(p) { sent.push(p); return Promise.resolve({ ok: true }); }, report(o, r) { reports.push([o, r]); return Promise.resolve({}); }, serverNow: () => Date.now(),
  };
  const nodes = new Map();
  const el = (id) => { if (!nodes.has(id)) nodes.set(id, { style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, querySelector: () => el('q'), innerHTML: '', textContent: '', className: '' }); return nodes.get(id); };
  const store = new Map();
  const sandbox = {
    console, Math, Object, JSON, Date, Number, String, setInterval: () => 0, el, mp,
    localStorage: { setItem() {}, getItem: () => null },
    document: { createElement: () => el('x'), head: el('head'), body: el('body'), getElementById: el },
    DOCTRINE_SHORT: { intel: 'INTEL' }, Sound: { deny() {} }, logMessage: (m) => logs.push(m),
    state: { front: 250, maxFront: 500, cp: 0, doctrine: '', gamePaused: false, enemyStunned: 0 },
    updateUI() {}, warTrack() {}, saveRunNow() {},
  };
  sandbox.window = sandbox; sandbox.jomaridMP = mp;
  sandbox.window.parent = { sessionStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) } };
  const listeners = {};
  sandbox.window.addEventListener = (t, f) => { (listeners[t] = listeners[t] || []).push(f); };
  vm.createContext(sandbox);
  // funkce hry, které mp.js přepisuje: den jen použije tlak soupeře a přičte den
  vm.runInContext(`
    function getEnemyPush() { return Math.floor((state.mpIncoming || 0) * (1 - (state.armor || 0))); }
    function endTurn(msg) { state.front -= getEnemyPush(); state.day = (state.day || 1) + 1; checkWinLoss(); updateUI(); }
    function checkWinLoss() {}
    function setDoctrine(doc) { state.doctrine = doc; state.front = 250; }
    function setScenario(s) { state.scenario = s; }
    function startTutorial() {}
    function startAttack() { state.front += 30; endTurn('OFENZÍVA'); }
    function doLogistics() { state.front -= 12; endTurn('Logistika'); }
    function useArtillery() { state.front += 25; }
    function useAirdrop() {}
    function useScenarioSkill() {}
    function buyUpgrade() {}
    function buyExclusiveTech() {}
  `, sandbox);
  new vm.Script(mpSrc).runInContext(sandbox);
  for (const f of listeners.load || []) f();
  const run = (code) => vm.runInContext(code, sandbox);
  const view = (o = {}) => Object.assign({ status: 'active', turn: 1, slot, deadline: Date.now() + 120000 }, o);
  return { sandbox, handlers, sent, reports, logs, run, view, store, mp };
}
const settleMicro = async () => { for (let i = 0; i < 4; i += 1) await Promise.resolve(); };

test('souboj: po načtení se hra přihlásí k odběru, zvolí scénář Základ a čeká na doktrínu; mimo tah jsou akce zamčené', () => {
  const d = makeDuel({ slot: 2 });
  assert.equal(d.mp.listening, true);
  assert.equal(d.run('state.scenario'), 'default');
  d.handlers.sync({ match: d.view({ turn: 1 }), moves: [], outcome: null });
  d.run("setDoctrine('intel')");
  const front = d.run('state.front');
  d.run('startAttack()');
  assert.equal(d.run('state.front'), front, 'nejsem na tahu: nic se nestane');
  assert.equal(d.sent.length, 0);
});

test('souboj: den jde soupeři jako zpráva s posunem fronty, další den až po jeho odpovědi; jeho posun se stane mým tlakem na konci mého dne', async () => {
  const d = makeDuel({ slot: 1 });
  d.handlers.sync({ match: d.view({ turn: 1 }), moves: [], outcome: null });
  d.run("setDoctrine('intel')");
  d.run('startAttack()');
  assert.equal(d.run('state.front'), 130, 'začátek 100 + útok 30');
  assert.equal(d.sent.length, 1);
  const m = d.sent[0];
  assert.deepEqual(JSON.parse(JSON.stringify({ t: m.t, k: m.k, adv: m.adv, d: m.d })), { t: 'a', k: 1, adv: 30, d: 'intel' });
  d.run('startAttack()');
  assert.equal(d.sent.length, 1, 'dokud neodpoví soupeř, další den nejde');
  d.handlers.match({ match: d.view({ turn: 2 }) });
  d.handlers.moves({ moves: [{ seq: 2, p: 2, payload: { t: 'a', k: 1, adv: 40, m: 'OFENZÍVA: Přesný zásah!' } }] });
  assert.ok(d.logs.some((l) => /Marie: OFENZÍVA/.test(l)));
  assert.equal(d.run('state.mpIncoming'), 40);
  d.handlers.match({ match: d.view({ turn: 1 }) });
  d.run('state.armor = 0.25');
  const before = d.run('state.front');
  d.run('startAttack()');
  assert.equal(d.run('state.front'), before + 30 - 30, 'útok +30, tlak soupeře 40 zmírněný pancířem o čtvrtinu = -30');
  assert.equal(d.run('state.mpIncoming'), 0, 'vyřízený tlak se nepřičítá podruhé');
  assert.equal(d.sent[1].adv, 30);
});

test('souboj: souboj je kratší než tažení (po volbě doktríny je fronta i její maximum na 40 %, maximum aspoň 120) a pozdější volba to nezopakuje', () => {
  const d = makeDuel({ slot: 1 });
  d.handlers.sync({ match: d.view({ turn: 1 }), moves: [], outcome: null });
  d.run("setDoctrine('intel')");
  assert.equal(d.run('state.maxFront'), 200);
  assert.equal(d.run('state.front'), 100);
  d.run("setDoctrine('intel')");
  assert.equal(d.run('state.maxFront'), 200, 'podruhé se nezkracuje');
  const tiny = makeDuel({ slot: 1 });
  tiny.run('state.maxFront = 100');
  tiny.handlers.sync({ match: tiny.view({ turn: 1 }), moves: [], outcome: null });
  tiny.run("setDoctrine('intel')");
  assert.equal(tiny.run('state.maxFront'), 120, 'nejmenší maximum');
});

test('souboj: okamžité akce se do posunu fronty počítají (dělostřelectvo +25 a útok +30 = 55)', async () => {
  const d = makeDuel({ slot: 1 });
  d.handlers.sync({ match: d.view({ turn: 1 }), moves: [], outcome: null });
  d.run("setDoctrine('intel')");
  d.run('useArtillery()');
  d.run('startAttack()');
  assert.equal(d.sent[0].adv, 55);
});

test('souboj: logistika (cena v frontě) soupeři nic nepřidá', () => {
  const d = makeDuel({ slot: 1 });
  d.handlers.sync({ match: d.view({ turn: 1 }), moves: [], outcome: null });
  d.run("setDoctrine('intel')");
  d.run('doLogistics()');
  assert.equal(d.sent[0].adv, 0);
});

test('souboj: dotlačím frontu na maximum: vítězství se ohlásí serveru i soupeři (w), hra se zastaví', async () => {
  const d = makeDuel({ slot: 1 });
  d.handlers.sync({ match: d.view({ turn: 1 }), moves: [], outcome: null });
  d.run("setDoctrine('intel')");
  d.run('state.front = 190');
  d.run('startAttack()');
  assert.equal(d.run('state.gamePaused'), true);
  assert.deepEqual(d.reports, [['win', 'front']]);
  assert.equal(d.sent[0].w, 1);
  assert.equal(d.sent.length, 1);
});

test('souboj: zpráva soupeře s w znamená moji porážku, s l moje výhru; po konci se zprávy nepřijímají', () => {
  const lost = makeDuel({ slot: 2 });
  lost.handlers.sync({ match: lost.view({ turn: 1 }), moves: [], outcome: null });
  lost.run("setDoctrine('intel')");
  lost.handlers.moves({ moves: [{ seq: 1, p: 1, payload: { t: 'a', k: 1, adv: 10, w: 1 } }] });
  assert.deepEqual(lost.reports, [['loss', 'front']]);
  assert.equal(lost.run('state.mpIncoming || 0'), 0);
  lost.handlers.moves({ moves: [{ seq: 3, p: 1, payload: { t: 'a', k: 2, adv: 99 } }] });
  assert.equal(lost.run('state.mpIncoming || 0'), 0, 'po konci se nic nepřijme');
  const won = makeDuel({ slot: 1 });
  won.handlers.sync({ match: won.view({ turn: 2 }), moves: [], outcome: null });
  won.run("setDoctrine('intel')");
  won.handlers.moves({ moves: [{ seq: 2, p: 2, payload: { t: 'a', k: 1, adv: 0, l: 1 } }] });
  assert.deepEqual(won.reports, [['win', 'front']]);
});

test('souboj: zprávy soupeře, které přišly dřív než výběr doktríny, se vyřídí po něm; zpráva se dvakrát nepřičte', () => {
  const d = makeDuel({ slot: 2 });
  d.handlers.sync({ match: d.view({ turn: 1 }), moves: [{ seq: 1, p: 1, payload: { t: 'a', k: 1, adv: 33, d: 'intel', m: 'Rychlý start' } }], outcome: null });
  assert.equal(d.run('state.mpIncoming || 0'), 0, 'doktrína ještě není vybraná');
  d.run("setDoctrine('intel')");
  assert.equal(d.run('state.mpIncoming'), 0, 'zahajovací útok prvního hráče druhému tlak nepřidá');
  assert.ok(d.logs.some((l) => /Marie - zahajovací útok \(\+33\)/.test(l)));
  assert.ok(d.logs.some((l) => /Marie - doktrína INTEL/.test(l)));
  d.handlers.moves({ moves: [{ seq: 1, p: 1, payload: { t: 'a', k: 1, adv: 33 } }] });
  assert.equal(d.run('state.mpIncoming'), 0, 'stejné číslo zprávy se nepřičte znovu');
  d.handlers.match({ match: d.view({ turn: 2 }) });
  d.run('startAttack()');
  d.handlers.match({ match: d.view({ turn: 1 }) });
  d.handlers.moves({ moves: [{ seq: 3, p: 1, payload: { t: 'a', k: 2, adv: 33 } }] });
  assert.equal(d.run('state.mpIncoming'), 33, 'od druhého dne už útok soupeře tlačí');
});

test('souboj: nesmyslná zpráva se ignoruje, posun se ořízne na rozumnou mez', () => {
  const d = makeDuel({ slot: 1 });
  d.handlers.sync({ match: d.view({ turn: 1 }), moves: [], outcome: null });
  d.run("setDoctrine('intel')");
  d.run('startAttack()');
  d.handlers.match({ match: d.view({ turn: 2 }) });
  d.handlers.moves({ moves: [{ seq: 2, p: 2, payload: 'x' }, { seq: 3, p: 2, payload: { t: 'jine' } }, { seq: 4, p: 2, payload: { t: 'a', adv: -500 } }] });
  assert.equal(d.run('state.mpIncoming || 0'), 0);
  d.handlers.moves({ moves: [{ seq: 5, p: 2, payload: { t: 'a', adv: 1e9 } }] });
  assert.equal(d.run('state.mpIncoming'), 1000);
});

test('souboj: stav hry se ukládá po každém dni a obnovená stránka z něj pokračuje; v cizím okně se partie obnovit nedá', () => {
  const d = makeDuel({ slot: 1 });
  d.handlers.sync({ match: d.view({ turn: 1 }), moves: [], outcome: null });
  d.run("setDoctrine('intel')");
  d.run('startAttack()');
  const saved = JSON.parse(d.store.get('jomarid-mp-warroom:m-test'));
  assert.equal(saved.state.front, 130);
  assert.equal(saved.turnNo, 1);
  // obnovená stránka (nové okno hry, stejné úložiště okna appky)
  const again = makeDuel({ slot: 1 });
  for (const [k, v] of d.store) again.store.set(k, v);
  again.handlers.sync({ match: again.view({ turn: 2 }), moves: [{ seq: 1, p: 1, payload: { t: 'a', k: 1, adv: 30 } }, { seq: 2, p: 2, payload: { t: 'a', k: 1, adv: 20 } }], outcome: null });
  assert.equal(again.run('state.front'), 130, 'stav z uložení');
  assert.equal(again.run('state.mpIncoming'), 20, 'zpráva soupeře, která přišla při obnově, se vyřídí');
  assert.equal(again.run('state.doctrine'), 'intel');
  // jiné okno: moje zprávy v historii jsou, uložení ne
  const other = makeDuel({ slot: 1 });
  other.handlers.sync({ match: other.view({ turn: 2 }), moves: [{ seq: 1, p: 1, payload: { t: 'a', k: 1, adv: 30 } }], outcome: null });
  assert.equal(other.sent.length, 0);
  assert.equal(other.run('typeof state.mpIncoming'), 'undefined');
});

test('souboj: konec od serveru (čas, vzdání soupeře) hru zastaví a nic neodesílá', () => {
  const d = makeDuel({ slot: 1 });
  d.handlers.sync({ match: d.view({ turn: 2 }), moves: [], outcome: null });
  d.run("setDoctrine('intel')");
  d.handlers.end({ match: { status: 'finished', winner: 1, slot: 1, reason: 'timeout' }, outcome: 'win' });
  assert.equal(d.run('state.gamePaused'), true);
  d.run('startAttack()');
  assert.equal(d.sent.length, 0);
  assert.equal(d.reports.length, 0);
});
