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

/* ---------------------------------------------------------------- nákup po více kusech, návratnost, čas podle hodin, stabilní tlačítka */
const varLine = (name) => { const m = gameJs.match(new RegExp(`^  var ${name} = [^\\n]*;`, 'm')); assert.ok(m, name); return m[0]; };
function makeShop({ budget = 1e6, counts = {}, policies = {}, dimension = null, relics = [] } = {}) {
  const buildings = { residential: { count: 0 }, commercial: { count: 0 }, industrial: { count: 0 }, techeco: { count: 0 }, park: { count: 0 }, ...Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, { count: v }])) };
  const state = { budget, buildings, policies: { taxCuts: false, ...policies }, dimension, buyAmount: 1, stats: {}, endgame: { active: false } };
  const buildingDefs = { residential: { baseCost: 50 }, commercial: { baseCost: 180 }, industrial: { baseCost: 480 }, techeco: { baseCost: 1500 }, park: { baseCost: 350 } };
  const toasts = [];
  const ctx = run(`${varLine('BUY_AMOUNTS')}\n${fnSrc('buildingCostAt')}\n${fnSrc('getBuildingCost')}\n${fnSrc('normalizeBuyAmount')}\n${fnSrc('planPurchase')}\n${fnSrc('zoneGain')}\n${fnSrc('buyBuilding')}`, {
    state, buildingDefs, hasRelic: (k) => relics.includes(k), showToast: (m) => toasts.push(m), playBuySound() {}, renderAll() {}, trk(k, n) { state.stats[k] = (state.stats[k] || 0) + (n === undefined ? 1 : n); },
    BUILD_STAT: { residential: 'houses_built', commercial: 'shops_built', industrial: 'factories_built', techeco: 'labs_built', park: 'parks_built' },
    computePassiveIncome: () => buildings.commercial.count * 1.4 + buildings.residential.count * 0.5, computeSatisfaction: () => 100 - buildings.industrial.count, computePopulation: () => 80 + buildings.residential.count * 20,
  });
  return { ctx, state, toasts };
}

test('nákup po více kusech: cena ×N je součet cen jednotlivých kusů a stejná jako při koupi po jednom', () => {
  const a = makeShop({ budget: 1e9, counts: { commercial: 7 } });
  const plan = a.ctx.planPurchase('commercial', 10);
  assert.equal(plan.n, 10);
  let sum = 0;
  for (let i = 0; i < 10; i++) { sum += a.ctx.getBuildingCost('commercial'); a.state.buildings.commercial.count++; }
  assert.equal(plan.cost, sum);
  // hra tohle skutečně strhne z rozpočtu a přičte kusy najednou
  const b = makeShop({ budget: 1e9, counts: { commercial: 7 } });
  b.state.buyAmount = 10;
  b.ctx.buyBuilding('commercial');
  assert.equal(b.state.buildings.commercial.count, 17);
  assert.equal(1e9 - b.state.budget, plan.cost);
  assert.equal(b.state.stats.zones_built, 10);
  assert.equal(b.state.stats.shops_built, 10);
});

test('nákup po více kusech: Max koupí nejvíc, co rozpočet unese, a nikdy nejde do minusu; bez peněz ukáže cenu jednoho kusu', () => {
  for (const budget of [0, 49, 50, 51, 1000, 123456, 9.9e7]) {
    const s = makeShop({ budget });
    s.state.buyAmount = 'max';
    const plan = s.ctx.planPurchase('residential', 'max');
    if (budget < 50) { assert.equal(plan.n, 1); assert.equal(plan.cost, 50); assert.ok(budget < plan.cost); s.ctx.buyBuilding('residential'); assert.equal(s.state.buildings.residential.count, 0, 'bez peněz se nekupuje'); continue; }
    assert.ok(plan.cost <= budget, `Max v rozpočtu ${budget}`);
    // o jeden kus víc už by se nevešel
    const next = s.ctx.getBuildingCost('residential');
    s.ctx.buyBuilding('residential');
    assert.ok(s.state.budget >= 0);
    assert.ok(s.state.budget < s.ctx.getBuildingCost('residential'), 'zbytek už na další kus nestačí');
    assert.ok(next >= 50);
  }
  const cap = makeShop({ budget: 1e300 });
  assert.ok(cap.ctx.planPurchase('residential', 'max').n <= 1000, 'strop 1000 kusů najednou');
});

test('nákup po více kusech: ceny respektují daňové úlevy, dimenzi a relikvii a špatné množství se opraví na 1', () => {
  const base = makeShop().ctx.getBuildingCost('industrial');
  assert.equal(base, 480);
  assert.equal(makeShop({ policies: { taxCuts: true } }).ctx.getBuildingCost('industrial'), 720);
  assert.equal(makeShop({ dimension: 'carefree' }).ctx.getBuildingCost('industrial'), 960);
  assert.ok(makeShop({ counts: { industrial: 30 }, relics: ['voidCompressor'] }).ctx.getBuildingCost('industrial') < makeShop({ counts: { industrial: 30 } }).ctx.getBuildingCost('industrial'));
  const c = makeShop().ctx;
  for (const bad of [0, -5, 7, '10', null, undefined, NaN, 'MAX', {}]) assert.equal(c.normalizeBuyAmount(bad), 1, String(bad));
  for (const ok of [1, 10, 100, 'max']) assert.equal(c.normalizeBuyAmount(ok), ok);
});

test('zoneGain jen počítá: stav zůstane beze změny a přínos odpovídá skutečné změně příjmu a populace', () => {
  const s = makeShop({ counts: { commercial: 3, residential: 4 } });
  const before = JSON.stringify(s.state.buildings);
  const g = s.ctx.zoneGain('commercial', 5);
  assert.equal(JSON.stringify(s.state.buildings), before);
  assert.ok(Math.abs(g.income - 5 * 1.4) < 1e-9);
  assert.equal(s.ctx.zoneGain('residential', 2).pop, 40);
  assert.equal(s.ctx.zoneGain('industrial', 3).sat, -3);
});

test('čas podle hodin: tik po 100 ms dělá totéž co dřív, delší pauza (záložka na pozadí) připíše příjem za celou dobu, nejvýš za limit offline', () => {
  const MAX = 12 * 3600 * 1000;
  const mk = (income = 50) => {
    const t = { now: 1_700_000_000_000 };
    const state = { budget: 0, lifetimeEarnings: 0, totalPlaytimeSeconds: 0, comboMeter: 80, frenzyActive: false, frenzyEnd: 0, endgame: { active: false } };
    const toasts = [];
    const ctx = run(`${varLine('lastTickAt')}\n${varLine('AWAY_TOAST_MS')}\n${fnSrc('mainTick')}`, {
      state, Date: { now: () => t.now }, computePassiveIncome: () => income, getMaxOfflineMs: () => MAX, showToast: (m) => toasts.push(m), formatDuration: (ms) => `${ms / 1000} s`, formatCurrency: (n) => '$' + Math.round(n),
      deactivateFrenzy() { state.frenzyActive = false; }, endgameTick() {}, renderFast() {},
    });
    return { t, state, toasts, ctx };
  };
  const a = mk();
  for (let i = 0; i < 10; i++) { a.ctx.mainTick(); a.t.now += 100; }
  assert.ok(Math.abs(a.state.budget - 50) < 1e-9, 'deset tiků po 100 ms = sekunda příjmu');
  assert.ok(Math.abs(a.state.comboMeter - (80 - 13)) < 1e-9, 'combo klesá 1,3 za tik');
  assert.ok(Math.abs(a.state.totalPlaytimeSeconds - 1) < 1e-9);
  assert.equal(a.toasts.length, 0);
  // záložka na pozadí: další tik přijde až za 5 minut
  a.t.now += 5 * 60 * 1000;
  const before = a.state.budget;
  a.ctx.mainTick();
  assert.ok(Math.abs(a.state.budget - before - 50 * 300) < 10, 'příjem za pět minut');
  assert.equal(a.toasts.length, 1, 'hráč se dozví, kolik město vyneslo');
  assert.ok(a.state.totalPlaytimeSeconds <= 1 + 2.1, 'čas na pozadí se nepočítá jako aktivní hraní');
  assert.equal(a.state.comboMeter, 0);
  // absurdní pauza se ořízne limitem offline
  const b = mk(10);
  b.ctx.mainTick(); b.t.now += 99 * 3600 * 1000; b.ctx.mainTick();
  assert.ok(Math.abs(b.state.budget - (1 + 10 * 12 * 3600)) < 1e3, 'nejvýš za 12 hodin');
  // hodiny, které se vrátí zpátky, neubírají
  const c = mk(10);
  c.ctx.mainTick(); c.t.now -= 5000; const bc = c.state.budget; c.ctx.mainTick();
  assert.ok(c.state.budget >= bc && c.state.budget - bc < 2, 'záporný rozdíl se bere jako obyčejný tik');
});

test('obchod se nepřekresluje zbytečně: řádky zón se vytvoří jednou, ostatní seznamy se přepíšou jen při změně a klikání se zachytává na obalu', () => {
  assert.match(gameJs, /function setHtml\(el, html\)\{\s*if\(el\.__html === html\) return false;/);
  const shop = fnSrc('renderShop');
  assert.doesNotMatch(shop, /container\.innerHTML = ''/, 'renderShop obsah nemaže');
  assert.match(gameJs, /function ensureShopRows\(container\)\{\s*if\(shopRows && container\.getAttribute\('data-mode'\) === 'rows'\) return;/);
  for (const fn of ['renderPolicies', 'renderMegaprojects', 'renderStardustMarket', 'renderEndcraze']) {
    const src = fnSrc(fn);
    assert.doesNotMatch(src, /\.innerHTML\s*=(?!=)/, `${fn} nepřepisuje innerHTML napřímo`);
    assert.doesNotMatch(src, /addEventListener\('click'/, `${fn} nepřidává posluchače na tlačítka, která se překreslují`);
  }
  for (const [host, sel] of [['shopList', '.btn-build'], ['policyList', '.btn-policy'], ['megaList', '.btn-mega'], ['stardustShopList', '.btn-build'], ['acceleratorPanel', '#acceleratorInvestBtn'], ['factionActionArea', '#sacrificeBtn'], ['archaPanel', '#archaInvestBtn']]) {
    assert.ok(gameJs.includes(`delegate('${host}', '${sel}'`), `${host} má zachytávání kliků`);
  }
  // přepínač množství a klávesy
  for (const a of ['1', '10', '100', 'max']) assert.match(html, new RegExp(`<button type="button" data-amt="${a}"`));
  assert.match(gameJs, /delegate\('buyAmount', '\[data-amt\]'/);
  assert.match(gameJs, /\^\(\?:Digit\|Numpad\)\(\[1-5\]\)\$/);
  assert.match(gameJs, /ev\.code === 'KeyB'/);
  assert.match(gameJs, /state\.buyAmount = normalizeBuyAmount\(state\.buyAmount\);[\s\S]*?isFreshGame = false;/, 'uložená hodnota se při načtení ověří');
});

test('tlačítko se při překreslení nevymění: DOM prvek tlačítka zůstane stejný po tisíci obnoveních (atrapa DOM)', () => {
  // renderShop se spustí v atrapě dokumentu a počítá, kolikrát se vytvořily nové prvky
  let created = 0;
  const el = (tag) => ({ tag, children: [], classList: { _s: new Set(), contains(c) { return this._s.has(c); }, toggle(c, on) { if (on === undefined ? !this._s.has(c) : on) this._s.add(c); else this._s.delete(c); }, add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); } },
    attrs: {}, textContent: '', disabled: false, _html: '', style: {},
    set innerHTML(v) { this._html = v; this.children = []; }, get innerHTML() { return this._html; },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; },
    appendChild(c) { this.children.push(c); created++; return c; },
    querySelector() { return el('span'); }, querySelectorAll() { return []; } });
  const container = el('div'); const picker = el('div');
  const s = makeShop({ budget: 5000, counts: { commercial: 3 } });
  const names = { residential: 'Obytná', commercial: 'Komerční', industrial: 'Průmyslová', techeco: 'Tech', park: 'Park' };
  const doc = { getElementById: (id) => (id === 'shopList' ? container : id === 'buyAmount' ? picker : null), createElement: (t) => el(t) };
  const ctx = run(`var shopRows = null;\n${fnSrc('setHtml')}\n${fnSrc('setText')}\n${fnSrc('formatPayback')}\n${fnSrc('ensureShopRows')}\n${fnSrc('renderShop')}\nfunction formatRate(x){ return '$' + x; }`, {
    document: doc, state: s.state, themeNames: { classic: { ...names } }, buildingOrder: ['residential', 'commercial', 'industrial', 'techeco', 'park'],
    buildingDefs: { residential: { icon: 'R', desc: '' }, commercial: { icon: 'C', desc: '' }, industrial: { icon: 'I', desc: '' }, techeco: { icon: 'T', desc: '' }, park: { icon: 'P', desc: '' } },
    formatCurrency: (n) => '$' + Math.round(n), formatNumber: (n) => String(Math.round(n)), normalizeBuyAmount: s.ctx.normalizeBuyAmount, planPurchase: s.ctx.planPurchase, zoneGain: s.ctx.zoneGain, getBuildingCost: s.ctx.getBuildingCost,
  });
  s.state.theme = 'classic';
  ctx.renderShop();
  const first = created, rows = container.children.slice();
  assert.equal(first, 5, 'pět řádků');
  for (let i = 0; i < 1000; i++) { s.state.budget += 7; ctx.renderShop(); }
  assert.equal(created, first, 'nové řádky se nevytvářejí');
  assert.deepEqual(container.children, rows);
});

test('formáty: čas dalšího nákupu, návratnost a malé částky jsou čitelné a nikdy nevypíšou NaN', () => {
  const ctx = run(`${fnSrc('formatEta')}\n${fnSrc('formatPayback')}\n${fnSrc('formatRate')}\nfunction formatCurrency(n){ return '$' + Math.round(n); }`, { themeNames: { classic: { currency: '$' } }, state: { theme: 'classic' } });
  assert.equal(ctx.formatEta(0.2), 'okamžik');
  assert.equal(ctx.formatEta(45), '45 s');
  assert.equal(ctx.formatEta(125), '2 min 5 s');
  assert.equal(ctx.formatEta(3 * 3600 + 600), '3 h 10 min');
  assert.equal(ctx.formatEta(3 * 86400), '3 d');
  assert.equal(ctx.formatEta(1e10), 'víc než rok');
  for (const bad of [NaN, Infinity, -1, undefined]) assert.equal(ctx.formatEta(bad), '');
  assert.equal(ctx.formatPayback(0.3), '1 s');
  assert.equal(ctx.formatPayback(90), '2 min');
  assert.equal(ctx.formatPayback(5400), '1,5 h');
  assert.equal(ctx.formatPayback(1e6), 'přes den');
  for (const bad of [0, -3, NaN, Infinity]) assert.equal(ctx.formatPayback(bad), '');
  assert.equal(ctx.formatRate(0.4), '$0.40');
  assert.equal(ctx.formatRate(4.26), '$4.3');
  assert.equal(ctx.formatRate(1234), '$1234');
});

test('panorama města: okna se rozsvěcují podle počtu zón a v EndCraze svítí všechna', () => {
  const wins = Array.from({ length: 200 }, () => ({ style: { display: '' } }));
  const mkSky = (total, endgame = false) => {
    const state = { buildings: { a: { count: total } }, endgame: { active: endgame } };
    const ctx = run(`var skyWindows = null;\nvar skyFrac = -1;\n${fnSrc('updateSkyline')}`, { state, document: { querySelectorAll: () => wins.map((w) => ({ ...w, style: w.style })) } });
    return { state, ctx };
  };
  const lit = (nodesTotal, endgame) => {
    const nodes = Array.from({ length: 200 }, () => ({ style: { display: '' } }));
    const state = { buildings: { a: { count: nodesTotal } }, endgame: { active: endgame } };
    const ctx = run(`var skyWindows = null;\nvar skyFrac = -1;\n${fnSrc('updateSkyline')}`, { state, document: { querySelectorAll: () => nodes } });
    ctx.updateSkyline();
    return nodes.filter((n) => n.style.display === '').length;
  };
  const a = lit(0, false), b = lit(20, false), c = lit(100, false), d = lit(2000, false), e = lit(0, true);
  assert.ok(a > 0 && a < b && b < c && c <= d, `${a} < ${b} < ${c} <= ${d}`);
  assert.ok(a < 200 * 0.3, 'nové město je skoro tmavé');
  assert.equal(d, 200);
  assert.equal(e, 200);
  assert.ok(typeof mkSky === 'function');
});

test('uložení: sloučení kontroluje typy, takže poškozený postup hru nerozbije a platný zůstane beze změny', () => {
  const grab = (name) => html.match(new RegExp(`  function ${name}\\([^)]*\\)\\{[\\s\\S]*?\\n  \\}\\n`))[0];
  const ctx = vm.createContext({ Date, Array, Object, Math, isFinite, themeOrder: THEMES });
  const decl = (re) => html.match(re)[0];
  const consts = [decl(/  var megaprojectOrder = [^\n]*\n/), decl(/  var megaprojectDefs = \{[\s\S]*?\n  \};\n/), decl(/  var ACCELERATOR_PHASES = \[[\s\S]*?\n  \];\n/), decl(/  var ARCHA_PHASES = [^\n]*\n/)].join('');
  vm.runInContext(`${consts}\n${grab('defaultState')}\n${grab('mergeSaved')}\n${grab('repairLoaded')}\nthis.load = (loaded) => repairLoaded(mergeSaved(defaultState(), loaded)); this.def = defaultState;`, ctx);
  const plain = (v) => JSON.parse(JSON.stringify(v));
  const load = (v) => plain(ctx.load(v));
  const def = plain(ctx.def());
  // platný, bohatý postup (všechny druhy hodnot) se načte přesně tak, jak byl uložený
  const rich = plain(ctx.def());
  Object.assign(rich, { budget: 1.5e12, lifetimeEarnings: 9e15, totalClicks: 12345, theme: 'mars', goldenPermits: 7, prestigeCount: 3, jumpCount: 2, relics: ['a', 'b'], stardust: 40, stardustUpgrades: { income: 3, click: 1 },
    dimension: 'boomtown', achievements: ['first', 'rich'], stats: { clicks: 50, houses_built: 12, seen: { a: 1, b: 1 } }, soundEnabled: false, buyAmount: 'max' });
  rich.buildings.residential.count = 120; rich.buildings.park.count = 8;
  rich.policies.homeOffice = true; rich.megaprojects.fusion = { phase: 2, completed: true };
  Object.assign(rich.endgame, { active: true, darkMatter: 55, faction: 'cultist', acceleratorBuilt: true, archaSpent: 123 });
  rich.cizí = { budoucí: true };
  assert.deepEqual(load(rich), rich, 'nic platného se neztratí ani nezmění (včetně neznámých klíčů a buyAmount "max")');
  // desítky druhů poškození: výsledek má vždy stejné typy jako výchozí stav a nic nespadne
  const kinds = (v) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Array.isArray(x) ? 'array' : x === null ? 'null' : typeof x]));
  const sameShape = (got, want, p = '') => { for (const k of Object.keys(want)) { const a = got[k], b = want[k]; if (b && typeof b === 'object' && !Array.isArray(b)) { assert.ok(a && typeof a === 'object' && !Array.isArray(a), `${p}${k} má být objekt`); sameShape(a, b, `${p}${k}.`); } else if (Array.isArray(b)) assert.ok(Array.isArray(a), `${p}${k} má být pole`); else if (b === null) assert.ok(a === null || typeof a === 'string', `${p}${k}`); else if (k !== 'buyAmount') assert.equal(typeof a, typeof b, `${p}${k}`); } };
  const damaged = [
    { policies: false }, { policies: '' }, { policies: [1, 2] }, { buildings: 5 }, { buildings: { commercial: 9999999999 } }, { buildings: { residential: { count: 'x' } } }, { buildings: { industrial: [] } },
    { megaprojects: { fusion: '' } }, { megaprojects: { fusion: { phase: 'x', completed: 'ano' } } }, { megaprojects: [] }, { endgame: null }, { endgame: { active: 9999999999, darkMatter: 'x' } },
    { theme: 'x' }, { theme: 9999999999 }, { goldenPermits: {} }, { budget: null }, { budget: 'x' }, { stardust: [] }, { relics: 'x' }, { relics: [1, null, 'ok', {}] }, { achievements: { a: 1 } },
    { stats: 5 }, { stats: { a: 'x', b: -1, c: null, d: 4 } }, { stardustUpgrades: [1] }, { stardustUpgrades: { a: 'x', b: 2 } }, { buyAmount: {} }, { soundEnabled: 'ano' }, { dimension: 5 }, { activeCrisis: { x: 1 } },
    { buildings: { residential: { count: -4 } } }, { buildings: { residential: { count: 2.7 } } },
  ];
  for (const d of damaged) {
    const got = load(d);
    sameShape(got, def);
    assert.ok(THEMES.includes(got.theme), 'téma je vždy platné');
    for (const b of Object.values(got.buildings)) assert.ok(Number.isInteger(b.count) && b.count >= 0, 'počty budov jsou celá nezáporná čísla');
    assert.ok(got.relics.every((r) => typeof r === 'string') && got.achievements.every((r) => typeof r === 'string'));
    assert.ok(Object.values(got.stardustUpgrades).every((n) => typeof n === 'number' && n >= 0));
    assert.ok(Object.values(got.stats).every((n) => (typeof n === 'number' && n >= 0) || (n && typeof n === 'object')));
  }
  // fáze: indexy do seznamů zůstanou v rozsahu a dokončený projekt je dokončený
  for (const phase of [9999999999, -1e308, 4.7, -1, 3]) {
    const mp = load({ megaprojects: { spaceElevator: { phase, completed: false }, fusion: { phase: 1, completed: false } }, endgame: { acceleratorPhase: phase, archaPhase: phase } });
    assert.ok(Number.isInteger(mp.megaprojects.spaceElevator.phase) && mp.megaprojects.spaceElevator.phase >= 0 && mp.megaprojects.spaceElevator.phase <= 3, `fáze ${phase}`);
    assert.equal(mp.megaprojects.spaceElevator.completed, mp.megaprojects.spaceElevator.phase >= 3);
    assert.ok(mp.endgame.acceleratorPhase >= 0 && mp.endgame.acceleratorPhase <= vm.runInContext('ACCELERATOR_PHASES.length', ctx));
    assert.ok(mp.endgame.archaPhase >= 0 && mp.endgame.archaPhase <= vm.runInContext('ARCHA_PHASES', ctx));
    assert.deepEqual(mp.megaprojects.fusion, { phase: 1, completed: false }, 'druhý projekt se nezmění');
  }
  assert.equal(load({ buyAmount: 'max' }).buyAmount, 'max');
  assert.equal(load({ buyAmount: {} }).buyAmount, 1, 'nesmyslná hodnota nahradí výchozí');
  assert.equal(load({ buildings: { residential: { count: 2.7 } } }).buildings.residential.count, 2);
  assert.deepEqual(load({ relics: [1, null, 'ok', {}] }).relics, ['ok']);
  assert.deepEqual(load({ stats: { a: 'x', b: -1, c: null, d: 4, g: { z: 1 } } }).stats, { d: 4, g: { z: 1 } });
  // nic použitelného: výchozí stav
  // časové značky se berou z okamžiku vytvoření stavu, takže se při porovnání vynechají (jinak by test selhal, když mezi voláními přeskočí milisekunda)
  const noTime = (o) => { const c = { ...o }; delete c.createdAt; delete c.lastSaveTimestamp; return c; };
  for (const junk of [null, undefined, 5, 'x', [], true]) assert.deepEqual(noTime(load(junk)), noTime(def), String(junk));
  // "__proto__" z uloženého JSON nesmí zasáhnout prototypy
  const evil = JSON.parse('{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":2}},"buildings":{"__proto__":{"polluted":3}}}');
  load(evil);
  assert.equal({}.polluted, undefined);
  assert.equal(vm.runInContext('({}).polluted', ctx), undefined);
  // obě místa, kde se postup čte (start hry a ruční načtení), používají to samé
  assert.equal((html.match(/state = repairLoaded\(mergeSaved\(defaultState\(\), loaded\)\);/g) || []).length, 2);
  assert.equal((html.match(/throw new Error\('uložení není objekt'\)/g) || []).length, 2);
  assert.doesNotMatch(html, /deepMerge/, 'starý sloučitel bez kontroly typů už nikde není');
});

test('přístupnost: každé dialogové okno má název, tlačítko radnice se jmenuje podle viditelného textu a posuvná nápověda jde ovládat klávesnicí', () => {
  const dialogs = [...html.matchAll(/<div class="modal hidden" id="(\w+)" role="dialog" aria-modal="true"( aria-labelledby="(\w+)")?>/g)];
  assert.equal(dialogs.length, 7, 'sedm dialogových oken');
  for (const [, id, , labelled] of dialogs) {
    assert.equal(labelled, `${id}Title`, `${id} má aria-labelledby`);
    const at = html.indexOf(`id="${id}"`);
    assert.ok(html.slice(at, at + 260).includes(`<h2 id="${id}Title">`), `${id}: nadpis s odpovídajícím id hned na začátku okna`);
  }
  const btn = html.match(/<button type="button" class="btn-townhall" id="townhallBtn"[^>]*>/)[0];
  assert.doesNotMatch(btn, /aria-label/, 'název tlačítka je jeho viditelný text, ne jiný popisek');
  assert.match(btn, /aria-describedby="townhallHint"/);
  assert.match(html, /<span class="sr-only" id="townhallHint">Radnice: každé kliknutí přidá peníze do rozpočtu\.<\/span>/);
  assert.match(css, /\.sr-only\{ position:absolute; width:1px; height:1px;/);
  assert.match(html, /<div class="help-body" tabindex="0">/);
});
