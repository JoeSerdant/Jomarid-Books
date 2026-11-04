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
  vm.runInContext(`${fnSrc('cleanProgress')}\n${fnSrc('loadProgress')}\n${fnSrc('reportRecords')}\n${fnSrc('saveProgress')}\n${fnSrc('warTrack')}\nconst CHEAT_STATS = ${cheatLit};\n${fnSrc('cheatAction')}`, ctx);
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
