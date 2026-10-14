// Testy hry Kouloví Kámoši: skládání dokumentu, shoda s Games.jsx, uložený postup a odměny a chod hry v Node (bez prohlížeče).
//   npm run test:koulovi
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(DIR, '..', '..');
const read = (p) => fs.readFileSync(p, 'utf8');
const shell = read(path.join(DIR, 'index.html'));
const css = read(path.join(DIR, 'style.css'));
const game = read(path.join(DIR, 'game.js'));
const assembler = read(path.join(SRC, 'gameContent', 'koulovi.js'));
const gamesPage = read(path.join(SRC, 'pages', 'Games.jsx'));

/* ---------------------------------------------------------------- skládání a napojení na appku */
test('kostra má právě jedno místo pro styl a jedno pro skripty a koncový </body></html>', () => {
  assert.equal(shell.split('/*__CSS__*/').length, 2);
  assert.equal(shell.split('<!--__SCRIPTS__-->').length, 2);
  assert.match(shell, /<\/body>\s*<\/html>\s*$/);
  assert.match(shell, /<html lang="cs">/);
});

test('koulovi.js skládá kostru, styl a hru stejně jako ostatní hry', () => {
  for (const f of ['index.html', 'style.css', 'game.js']) assert.ok(assembler.includes(`./koulovi/${f}?raw`), f);
  assert.match(assembler, /export const KOULOVI_HTML\b/);
  assert.match(assembler, /\.replace\('\/\*__CSS__\*\/', \(\) => css\)/);
  assert.match(assembler, /\.replace\('<!--__SCRIPTS__-->', \(\) =>/);
});

test('Games.jsx: hra je v seznamu, stahuje se až při spuštění a id sedí s mostem pro odměny', () => {
  const m = gamesPage.match(/id: '(koulovikamosi)',[\s\S]*?load: \(\) => import\('\.\.\/gameContent\/koulovi'\)\.then\(m => m\.KOULOVI_HTML\)/);
  assert.ok(m, 'položka hry v GAMES');
  assert.match(shell, /var GAME_ID = 'koulovikamosi';/);
  assert.doesNotMatch(gamesPage, /^import .*gameContent\/koulovi/m, 'nesmí se importovat staticky');
});

test('most pro odměny: jen žádost o odměnu, server rozhoduje o částce', () => {
  assert.match(shell, /window\.jomaridReward = function/);
  assert.match(shell, /source: 'jomarid-game', type: 'coin'/);
  assert.match(shell, /ev\.source !== window\.parent/);
});

test('hra nenačítá cizí skripty (jen písmo) a ukládá pod vlastním klíčem', () => {
  const external = [...shell.matchAll(/<(?:script|link)[^>]+(?:src|href)="(https?:[^"]+)"/g)].map((m) => m[1]);
  for (const u of external) assert.match(u, /^https:\/\/fonts\.(googleapis|gstatic)\.com(\/|$)/, u);
  assert.doesNotMatch(game, /localStorage\.(?:get|set)Item\('kk'/);
  assert.match(game, /const KEY='koulovi-kamosi-v1'/);
  assert.ok(css.length > 500);
});

/* ---------------------------------------------------------------- chod hry v Node */
function makeEnv() {
  const store = {};
  const rewards = [];
  const els = new Map();
  const rafs = [];
  const ctx2d = () => {
    const t = { measureText: () => ({ width: 10 }), createPattern: () => ({}), createLinearGradient: () => ({ addColorStop() {} }) };
    return new Proxy(t, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  };
  const mkEl = () => {
    const cls = new Set();
    const listeners = {};
    return {
      style: {}, dataset: {}, textContent: '', innerHTML: '', width: 540, height: 960, clientWidth: 540, clientHeight: 960,
      classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c), toggle: (c, f) => ((f === undefined ? !cls.has(c) : f) ? cls.add(c) : cls.delete(c)) },
      getContext: ctx2d, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 540, height: 960 }),
      addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
      listeners, closest: () => null,
    };
  };
  const document = {
    getElementById: (id) => { if (!els.has(id)) els.set(id, mkEl()); return els.get(id); },
    createElement: () => mkEl(),
    body: { clientWidth: 540, clientHeight: 960 },
    hidden: false,
    addEventListener() {},
  };
  const sandbox = {
    document, console,
    performance: { now: () => 0 },
    requestAnimationFrame: (fn) => { rafs.push(fn); return rafs.length; },
    addEventListener() {},
    navigator: { vibrate() {} },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    jomaridReward: (reason, amount) => { rewards.push([reason, amount]); },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  // Pevné náhodné číslo, ať jsou testy opakovatelné; Math patří vm kontextu, vnější proces se nemění.
  vm.runInContext('(function () { var s = 12345; Math.random = function () { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; })()', sandbox);
  new vm.Script(game, { filename: 'game.js' }).runInContext(sandbox);
  const run = (code) => vm.runInContext(code, sandbox);
  return { sandbox, run, store, rewards };
}

test('hra se spustí a ukáže menu bez chyby', () => {
  const { run } = makeEnv();
  assert.equal(run('st'), 'menu');
  assert.equal(run('MODES.length'), 5);
  assert.deepEqual(JSON.parse(run('JSON.stringify(MODES.map(m => m[0]))')), ['classic', 'time', 'drops', 'chaos', 'zen']);
  assert.equal(run('MODES[0][1]'), 'Klasika');
});

test('klasika: koule padají, fyzika zůstane konečná a skóre se nikdy nesníží', () => {
  const { run } = makeEnv();
  run("start('classic')");
  let lastScore = 0;
  for (let i = 0; i < 900; i += 1) {
    run(`g.aimX = ${150 + ((i * 37) % 240)}; if (g.cool <= 0) drop(); step();`);
    const bad = run('g.balls.some(b => !isFinite(b.x) || !isFinite(b.y) || b.P.some(p => !isFinite(p.x) || !isFinite(p.y)))');
    assert.equal(bad, false, `neplatná poloha ve snímku ${i}`);
    const sc = run('g.score');
    assert.ok(sc >= lastScore, 'skóre kleslo');
    lastScore = sc;
    if (run("st") !== 'play') break;
  }
  assert.ok(run('g.balls.length') > 0 || run("st") === 'over');
});

test('sloučení dvou stejných koulí: body, nový typ, první objevení dá mince a žádost o odměnu', () => {
  const { run, rewards } = makeEnv();
  run("start('classic')");
  run('g.balls.push(mk(270, 600, 0), mk(270, 600, 0)); step();');
  assert.equal(run('g.merges'), 1);
  assert.equal(run('g.score'), 10);
  assert.equal(run('S.disc'), 1);
  assert.equal(run('S.coins'), 10);
  assert.deepEqual(rewards, [['discover', 2]]);
  // už objevený typ podruhé odměnu nedá
  run('g.balls.push(mk(270, 600, 0), mk(270, 600, 0)); step();');
  assert.equal(rewards.length, 1);
});

test('Zen: žádné mince ani žádost o odměnu', () => {
  const { run, rewards } = makeEnv();
  run("start('zen')");
  run('g.balls.push(mk(270, 600, 0), mk(270, 600, 0)); step();');
  assert.equal(run('S.disc'), 1);
  assert.equal(run('S.coins'), 0);
  assert.equal(rewards.length, 0);
});

test('odměna za objevení každého typu koule je 2 až 4 Jomarid Coins (celé číslo)', () => {
  const { run, rewards } = makeEnv();
  run("start('classic')");
  for (let t = 0; t <= 10; t += 1) {
    run(`g.balls = [mk(270, 600, ${t}), mk(270, 600, ${t})]; step();`);
  }
  assert.equal(rewards.length, 11, JSON.stringify(rewards));
  rewards.forEach(([reason, amount], i) => {
    assert.equal(reason, 'discover');
    assert.ok(Number.isInteger(amount) && amount >= 2 && amount <= 4, `typ ${i + 1}: ${amount}`);
  });
});

test('Časovka končí po vypršení času a výsledek se uloží pod vlastním klíčem', () => {
  const { run, store } = makeEnv();
  run("start('time')");
  run('g.score = 123; g.t = 2;');
  run('step(); step(); step();');
  assert.equal(run('st'), 'over');
  assert.equal(run("$('oT').textContent"), 'Čas vypršel!');
  const saved = JSON.parse(store['koulovi-kamosi-v1']);
  assert.equal(saved.games, 1);
  assert.equal(saved.bm.time, 123);
  assert.equal(saved.best, 123);
  assert.ok(!('kk' in store));
});

test('30 hodů: po posledním hodu hra skončí', () => {
  const { run } = makeEnv();
  run("start('drops')");
  run('g.left = 1;');
  run('g.cool = 0; drop();');
  assert.equal(run('g.left'), 0);
  run('g.cool = -200; step();');
  assert.equal(run('st'), 'over');
});

test('rozehraná hra se uloží a po návratu obnoví včetně koulí', () => {
  const a = makeEnv();
  a.run("start('classic')");
  for (let i = 0; i < 200; i += 1) a.run(`g.aimX = ${180 + ((i * 53) % 180)}; if (g.cool <= 0) drop(); step();`);
  const nBefore = a.run('g.balls.length');
  const scoreBefore = a.run('g.score');
  assert.ok(nBefore > 0);
  a.run('saveRun()');
  const saved = a.store['koulovi-kamosi-v1'];
  assert.ok(saved && JSON.parse(saved).run, 'rozehraná hra se neuložila');
  // nové "otevření" hry se stejným úložištěm
  const b = makeEnv();
  b.store['koulovi-kamosi-v1'] = saved;
  b.run("S = JSON.parse(localStorage.getItem(KEY) || 'null'); stats();");
  b.run('resume()');
  assert.equal(b.run('g.balls.length'), nBefore);
  assert.equal(b.run('g.score'), scoreBefore);
  assert.equal(b.run("g.mode"), 'classic');
});

test('obchod: nákup odečte mince a přidá předmět, bez mincí se nic nestane', () => {
  const { run } = makeEnv();
  run('S.coins = 60; shop();');
  const before = run('S.inv.undo');
  run("$('items').onclick({ target: { dataset: { k: 'undo', p: '50' } } });");
  assert.equal(run('S.coins'), 10);
  assert.equal(run('S.inv.undo'), before + 1);
  run("$('items').onclick({ target: { dataset: { k: 'hit', p: '100' } } });");
  assert.equal(run('S.coins'), 10);
});

/* ---------------------------------------------------------------- opravy z kontroly: Zpět, konec hry, dotyk */
const fire = (env, type, ev) => (env.sandbox.document.getElementById('c').listeners[type] || []).forEach((fn) => fn(ev));

test('Zpět vrátí i hod, počet sloučení a combo: ve hře 30 hodů se neztratí hod', () => {
  const { run } = makeEnv();
  run("start('drops')");
  run('g.left = 1; g.cool = 0; g.merges = 4; g.cb = 3; g.cT = 20;');
  run('drop();');
  assert.equal(run('g.left'), 0);
  run('g.merges = 7; g.cb = 5; g.cT = 0;');
  run("ability('undo')");
  assert.equal(run('g.left'), 1, 'hod se nevrátil');
  assert.equal(run('g.balls.length'), 0);
  assert.equal(run('g.merges'), 4);
  assert.equal(run('g.cb'), 3);
  assert.equal(run('g.cT'), 20);
  // a koule jde znovu hodit
  run('g.cool = 0; drop();');
  assert.equal(run('g.balls.length'), 1);
});

test('po konci Časovky ani 30 hodů se krok nedokončí: sloučení v posledním snímku se nepřičte', () => {
  const t = makeEnv();
  t.run("start('time')");
  t.run('g.t = 1; g.balls = [mk(270, 600, 0), mk(270, 600, 0)];');
  t.run('step()');
  assert.equal(t.run('st'), 'over');
  assert.equal(t.run('g.score'), 0);
  assert.equal(t.run('g.merges'), 0);
  const d = makeEnv();
  d.run("start('drops')");
  d.run('g.left = 0; g.cool = -200; g.balls = [mk(270, 600, 0), mk(270, 600, 0)];');
  d.run('step()');
  assert.equal(d.run('st'), 'over');
  assert.equal(d.run('g.score'), 0);
});

test('zrušený dotyk koule neodhodí a táhnutí smí dokončit jen prst, který ho začal', () => {
  const env = makeEnv();
  const { run } = env;
  run("start('classic')");
  const left0 = run('g.left');
  fire(env, 'pointerdown', { clientX: 270, clientY: 400, pointerId: 1 });
  assert.equal(run('g.aiming'), true);
  fire(env, 'pointercancel', { pointerId: 1 });
  assert.equal(run('g.aiming'), false);
  fire(env, 'pointerup', { clientX: 270, clientY: 400, pointerId: 1 });
  assert.equal(run('g.left'), left0, 'po zrušení dotyku se nesmí házet');
  // cizí prst táhnutí nedokončí ani nezruší
  fire(env, 'pointerdown', { clientX: 270, clientY: 400, pointerId: 1 });
  fire(env, 'pointerup', { clientX: 270, clientY: 400, pointerId: 2 });
  fire(env, 'pointercancel', { pointerId: 2 });
  assert.equal(run('g.left'), left0);
  assert.equal(run('g.aiming'), true);
  fire(env, 'pointermove', { clientX: 200, clientY: 400, pointerId: 2 });
  assert.notEqual(run('g.aimX'), 200, 'cizí prst nesmí posouvat míření');
  fire(env, 'pointerup', { clientX: 200, clientY: 400, pointerId: 1 });
  assert.equal(run('g.left'), left0 - 1);
});

/* ---------------------------------------------------------------- Jomarid Coins ve hře */
test('appka posílá hře zůstatek (balance) a hra ho umí přijmout', () => {
  assert.match(gamesPage, /type: 'balance', balance: coins/);
  assert.match(gamesPage, /onLoad=\{sendBalance\}/);
  assert.match(shell, /d\.type === 'balance'/);
  assert.match(shell, /ev\.source !== window\.parent/);
});

test('zůstatek 🔶 se ukáže až po zprávě z appky a pak se mění', () => {
  const { run, sandbox } = makeEnv();
  assert.equal(run('hasJb()'), false);
  sandbox.jomaridBalance = 420;
  sandbox.onJomaridBalance();
  assert.equal(sandbox.document.getElementById('jbn').textContent, 420);
  assert.equal(sandbox.document.getElementById('jb').classList.contains('hide'), false);
  assert.equal(run('hasJb()'), true);
  sandbox.jomaridBalance = 427;
  sandbox.onJomaridBalance();
  assert.equal(sandbox.document.getElementById('jbn').textContent, 427);
  // nečíselný zůstatek se nepovažuje za známý
  sandbox.jomaridBalance = 'x';
  assert.equal(run('hasJb()'), false);
});

test('nový rekord (od 100 bodů, mimo Zen) dá žádost o 3 Jomarid Coins, jen jednou za rekord', () => {
  const a = makeEnv();
  a.run("start('classic')"); a.run('g.score = 150; finish(1);');
  assert.deepEqual(a.rewards, [['record', 3]]);
  a.run("start('classic')"); a.run('g.score = 150; finish(1);');
  assert.equal(a.rewards.length, 1, 'stejné skóre rekord není');
  a.run("start('classic')"); a.run('g.score = 151; finish(1);');
  assert.equal(a.rewards.length, 2);
  const b = makeEnv();
  b.run("start('classic')"); b.run('g.score = 99; finish(1);');
  assert.equal(b.rewards.length, 0, 'pod 100 bodů bez odměny');
  const z = makeEnv();
  z.run("start('zen')"); z.run('g.score = 5000; finish(1);');
  assert.equal(z.rewards.length, 0, 'Zen bez odměny');
});

test('rekord z přerušené hry (odchod do menu) o odměnu nepřijde: dostane se při odchodu, ne podruhé na konci', () => {
  const e = makeEnv();
  e.run("start('classic')"); e.run('g.score = 150; toMenu();');
  assert.deepEqual(e.rewards, [['record', 3]]);
  e.run("resume()");
  e.run('finish(1);');
  assert.equal(e.rewards.length, 1, 'stejný rekord podruhé');
  e.run("start('classic')"); e.run('g.score = 200; finish(1);');
  assert.equal(e.rewards.length, 2);
});

