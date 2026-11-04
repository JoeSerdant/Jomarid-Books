// City Clicker: grafická vrstva (skyline s gradientem a majáky, plastické panely a tlačítka, vzhled čtyř motivů) a celistvost dokumentu.
//   npm run test:city
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(SRC, 'gameContent', 'cityClicker', 'index.html'), 'utf8');
const css = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'));
const THEMES = ['classic', 'steampunk', 'cyberpunk', 'mars'];

test('dokument: jedno style, skripty se dají přeložit a CSS má vyvážené závorky', () => {
  assert.equal(html.split('<style>').length, 2);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 2);
  for (const code of scripts) assert.doesNotThrow(() => new vm.Script(code));
  let depth = 0;
  for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"[^"]*"/g, '""')) { if (ch === '{') depth += 1; if (ch === '}') depth -= 1; assert.ok(depth >= 0, 'přebývá }'); }
  assert.equal(depth, 0, 'chybí }');
});

test('grafika: skyline má gradienty, vzdálenou vrstvu a majáky u nejvyšších budov', () => {
  const sky = html.slice(html.indexOf('<div class="skyline-banner"'), html.indexOf('</svg>', html.indexOf('<div class="skyline-banner"')));
  assert.match(sky, /<linearGradient id="skG"/);
  assert.match(sky, /<linearGradient id="skF"/);
  assert.ok((sky.match(/class="sk-far"/g) || []).length > 10, 'vzdálená vrstva');
  assert.ok((sky.match(/class="sk-beacon"/g) || []).length >= 3, 'majáky');
  assert.ok((sky.match(/class="sk-ant"/g) || []).length === (sky.match(/class="sk-beacon"/g) || []).length, 'každý maják má anténu');
  assert.match(css, /\.skyline-banner \.sk-building\{ fill:url\(#skG\)/);
  // odkazy na gradienty vedou na existující id
  for (const id of ['skG', 'skF']) assert.ok(sky.includes(`id="${id}"`), id);
});

test('grafika: každý motiv má vlastní vzhled a stavové třídy z původního stylu zůstaly funkční', () => {
  for (const t of THEMES) assert.match(css, new RegExp(`\\[data-theme="${t}"\\]\\{`), t + ' má své barvy');
  for (const t of ['steampunk', 'cyberpunk', 'mars']) assert.ok(css.includes(`[data-theme="${t}"] .column`) || css.includes(`body[data-theme="${t}"]`), t + ' má vlastní grafiku');
  // pulz tlačítka radnice a blesk ve frenzy musí mít vyšší specificitu než nový základ tlačítka
  assert.match(css, /\.btn-townhall\.pulse\{ animation:pulseBtn/);
  assert.match(css, /body\.frenzy \.btn-townhall\{[^}]*box-shadow/);
  // grafika se nesmí dotknout EndCraze pozadí
  assert.match(css, /body:not\(\.endcraze\)\{/);
  assert.match(css, /body\.endcraze\{/);
});

test('grafika: panely, tlačítka a ikony zón mají plastický vzhled a zůstává vypnutelná animace při omezeném pohybu', () => {
  for (const sel of ['.column{', '.stat-gauge{', '.btn-build, .btn-policy{', '.btn-mega, .btn-prestige{', '.ledger-icon{', '.toast{', '.modal-box{']) assert.ok(css.includes(sel), sel);
  assert.match(css, /prefers-reduced-motion: reduce\)\{\s*\*\{ animation-duration:0\.01ms !important/);
  // nové animace pocházejí z @keyframes definovaných v tomtéž stylu
  for (const name of ['thSpin', 'comboShine', 'sk-blink']) assert.ok(css.includes(`@keyframes ${name}`), name);
});

/* ---------------------------------------------------------------- těžba Temné hmoty */
// Funkce těžby se vytáhnou ze hry a spustí s atrapou stavu (celá hra potřebuje DOM).
const gameJs = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes('var SAVE_KEY'));
const fnSrc = (name) => { const i = gameJs.indexOf(`  function ${name}(`); assert.ok(i >= 0, name); const j = gameJs.indexOf('\n  function ', i + 10); return gameJs.slice(i, j < 0 ? undefined : j); };
const constNum = (name) => Number(gameJs.match(new RegExp(`var ${name} = ([0-9]+)`))[1]);
function makeDm({ income = 5e8, buildings = 300, permits = 0, peak = 0, faction = null } = {}) {
  const st = { endgame: { peakIncome: peak, hystericalActive: false, faction, sacrificeMultiplier: 0, darkMatter: 0, activeRift: null }, goldenPermits: permits, dimension: null, buildings: { a: { count: buildings } } };
  const box = { state: st, Math, income, buildingOrder: ['a'], hasRelic: () => false, getStardustBonusMultiplier: () => 1, computePassiveIncome: () => box.income };
  vm.createContext(box);
  for (const n of ['getDarkMatterPower', 'getEndgameClickValue', 'getTechnocratPassiveRate']) vm.runInContext(fnSrc(n), box);
  return { box, st, power: () => vm.runInContext('getDarkMatterPower()', box), click: () => vm.runInContext('getEndgameClickValue()', box), passive: () => vm.runInContext('getTechnocratPassiveRate()', box) };
}

test('Temná hmota: síla těžby roste s městem (odmocnina z příjmu) a má minimum i pro slabá města z cheatů', () => {
  const lo = makeDm({ income: 1.8e8 }), mid = makeDm({ income: 5.6e8 }), hi = makeDm({ income: 2.5e9 }), none = makeDm({ income: 0 });
  assert.ok(lo.power() < mid.power() && mid.power() < hi.power());
  assert.ok(Math.abs(hi.power() / lo.power() - Math.sqrt(2.5e9 / 1.8e8)) < 1e-9, 'odmocnina');
  assert.equal(none.power(), 1000, 'minimum');
  assert.ok(lo.click() >= 1000 && none.click() >= 100, 'jedno kliknutí dá smysluplné číslo, ne 0,05 TH');
});

test('Temná hmota: nejvyšší příjem se pamatuje, takže ztráta infrastruktury po boostu těžbu nesrazí', () => {
  const d = makeDm({ income: 5.6e8 });
  const before = d.power();
  d.box.income = 5.6e8 * 0.2;                                  // boost zničil 80 % města
  assert.equal(d.power(), before);
  assert.ok(d.st.endgame.peakIncome >= 5.6e8);
  d.box.income = 2e9; assert.ok(d.power() > before, 'růst se projeví');
});

test('Temná hmota: Archa jde dokončit v rozumném čase u slabého i silného města a bez klikání za hodiny, ne za roky', () => {
  const cost = constNum('ARCHA_PHASE_COST') * constNum('ARCHA_PHASES');
  assert.ok(cost <= 5e9 && cost >= 5e8, 'celková cena Archy odpovídá rychlosti těžby: ' + cost);
  // aktivní hráč: 5 kliků/s, Hysterický boost (×100 na 10 s) po každých ~11 klicích, cyklus asi 12 s
  const perSecActive = (d) => (11 * d.click() + 50 * 100 * d.click()) / 12;
  for (const [income, minMin, maxMin] of [[1.8e8, 20, 90], [5.6e8, 12, 60], [2.5e9, 5, 30]]) {
    const d = makeDm({ income }); const minutes = cost / perSecActive(d) / 60;
    assert.ok(minutes >= minMin && minutes <= maxMin, `aktivně ${income}: ${minutes.toFixed(1)} min`);
  }
  // Technokraté bez klikání (jen pasivně)
  for (const income of [1.8e8, 5.6e8, 2.5e9]) {
    const d = makeDm({ income, buildings: 300 }); const hours = cost / d.passive() / 3600;
    assert.ok(hours > 0.3 && hours < 8, `pasivně ${income}: ${hours.toFixed(2)} h`);
  }
});

test('Temná hmota: pasivní těžba roste s počtem budov a zlatými povoleními a hlídá se i odměna z trhlin', () => {
  assert.ok(makeDm({ buildings: 400 }).passive() > makeDm({ buildings: 100 }).passive());
  assert.ok(makeDm({ permits: 50 }).passive() > makeDm({ permits: 0 }).passive());
  assert.match(gameJs, /var power = getDarkMatterPower\(\);\s*var reward = Math\.round\(Math\.max\(power \* 2, state\.endgame\.darkMatter \* 0\.01 \+ power \* 2\)\)/);
  assert.match(gameJs, /peakIncome: 0,/);
});

/* ---------------------------------------------------------------- čítače pro odznaky (src/gameRecords/defs/cityClicker.js) */
// Funkce čítačů se spustí s atrapou stavu; hra jako celek potřebuje DOM.
const run = (code, scope = {}) => { const ctx = vm.createContext({ Math, Object, JSON, Array, ...scope }); vm.runInContext(code, ctx); return ctx; };

test('čítače: trk přičítá, trkMax drží nejvyšší hodnotu, trkSeen si pamatuje jen různé klíče', () => {
  const ctx = run(`${fnSrc('trk')}\n${fnSrc('trkMax')}\n${fnSrc('trkSeen')}\nvar state = { stats: {} };\ntrk('a'); trk('a', 4); trkMax('b', 3); trkMax('b', 2); trkMax('b', 9); trkSeen('themes', 'mars'); trkSeen('themes', 'mars'); trkSeen('themes', 'classic');`);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.state.stats)), { a: 5, b: 9, themes: { mars: 1, classic: 1 } });
});

test('čítače: řád čísla a vrcholy výdělků, příjmu, populace a Temné hmoty (zapisují se i před přestavbou)', () => {
  const ctx = run(`${fnSrc('trkMax')}\n${fnSrc('magnitude')}\n${fnSrc('updatePeaks')}\nvar state = { stats: {}, lifetimeEarnings: 2.5e12, endgame: { darkMatter: 4000 } };\nfunction computePassiveIncome(){ return 150; }\nfunction computePopulation(){ return 0.5; }\nupdatePeaks();`);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.state.stats)), { wealth_exp: 12, income_exp: 2, dark_matter_exp: 3 });
  ctx.state.lifetimeEarnings = 10; ctx.updatePeaks();
  assert.equal(ctx.state.stats.wealth_exp, 12, 'nižší hodnota rekord nesníží');
});

test('čítače: každý z nich má ve hře své místo (trk / trkMax) a prestiž i skok je přenášejí', () => {
  const tracked = JSON.parse(gameJs.match(/var TRACKED_STATS = (\[[^\]]*\])/s)[1].replace(/'/g, '"').replace(/\s+/g, ' '));
  assert.ok(tracked.length >= 25);
  for (const key of tracked) assert.match(gameJs, new RegExp(`(?:trk(?:Max)?\\([^;]*|BUILD_STAT = [^;]*)'${key}'`), key);
  assert.equal((gameJs.match(/state\.stats = keepStats;/g) || []).length, 2, 'prestiž i skok');
  assert.equal((gameJs.match(/var keepStats = JSON\.parse\(JSON\.stringify\(state\.stats\)\);/g) || []).length, 2);
  assert.match(gameJs, /function doPrestige\(\)[\s\S]*?updatePeaks\(\);[\s\S]*?var keepStats/, 'vrcholy se zapíšou dřív, než se stav vynuluje');
  assert.match(gameJs, /defaultState\(\)\{[\s\S]*?stats: \{\}/);
});

test('hra hlásí přesně statistiky z katalogu a cheat Všechny odznaky je dotáhne na prahy odznaků', async () => {
  const { GAME_CATALOG, GAME_BADGES } = await import('../gameRecords/catalog.js');
  const want = GAME_CATALOG.find((g) => g.id === 'cityclicker').stats.map((s) => s.key).sort();
  const reported = new Map();
  const relics = [...gameJs.matchAll(/var RELIC_ORDER = \[([^\]]*)\]/g)][0][1].split(',').map((x) => x.trim().replace(/'/g, ''));
  const achBlock = gameJs.slice(gameJs.indexOf('var ACHIEVEMENT_DEFS = ['), gameJs.indexOf('var buildingOrder'));
  const ach = [...achBlock.matchAll(/\{ key:'(\w+)'/g)].map((m) => ({ key: m[1] }));
  const tracked = gameJs.match(/var TRACKED_STATS = \[[^\]]*\];/s)[0];
  const cheatLit = gameJs.match(/var CHEAT_STATS = (\{[^}]*\});/)[1];
  const ctx = run(`${fnSrc('trk')}\n${fnSrc('trkMax')}\n${fnSrc('trkSeen')}\n${fnSrc('magnitude')}\n${fnSrc('updatePeaks')}\n${tracked}\n${fnSrc('reportRecords')}\nvar CHEAT_STATS = ${cheatLit};\n${fnSrc('cheatAllBadges')}`, {
    state: { stats: {}, prestigeCount: 1, totalClicks: 5, jumpCount: 0, goldenPermits: 0, totalPlaytimeSeconds: 0, relics: [], achievements: [], lifetimeEarnings: 0, endgame: { darkMatter: 0 }, theme: 'classic', dimension: null },
    RELIC_ORDER: relics, ACHIEVEMENT_DEFS: ach, themeOrder: ['classic', 'steampunk', 'cyberpunk', 'mars'], MUTATOR_DEFS: { carefree: 1, volatile: 1, boomtown: 1, serene: 1 },
    showToast() {}, saveGame() {}, renderAll() {}, computePassiveIncome: () => 0, computePopulation: () => 0,
    jomaridRecord: (k, v) => { reported.set(k, Math.max(reported.get(k) || 0, Math.floor(Number(v)) || 0)); },
  });
  ctx.cheatAllBadges();
  ctx.reportRecords();
  assert.deepEqual([...reported.keys()].sort(), want, 'hra hlásí přesně statistiky z katalogu');
  for (const key of want) {
    const need = Math.max(...GAME_BADGES.filter((b) => b.game === 'cityclicker' && b.stat === key).map((b) => b.threshold));
    assert.ok(reported.get(key) >= need, `${key}: cheat dá ${reported.get(key)}, odznak chce ${need}`);
  }
});
