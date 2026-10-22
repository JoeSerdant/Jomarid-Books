// City Clicker: grafická vrstva (skyline s gradientem a majáky, plastické panely a tlačítka, vzhled čtyř motivů) a celistvost dokumentu.
//   npm run test:city
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = fs.readFileSync(path.join(SRC, 'gameContent', 'cityClicker.js'), 'utf8');
const html = JSON.parse(file.match(/^export const CITY_CLICKER_HTML = (".*");\s*$/s)[1]);
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
