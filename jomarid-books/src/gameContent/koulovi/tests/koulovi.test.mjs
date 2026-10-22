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
  assert.doesNotMatch(shell, /addEventListener\('message'/, 'hra od appky žádné zprávy nepřijímá (zůstatek ukazuje lišta appky)');
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
  const records = [];
  const els = new Map();
  const rafs = [];
  const docListeners = {};
  const ctx2d = () => {
    const t = { measureText: () => ({ width: 10 }), createPattern: () => ({}), createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }) };
    return new Proxy(t, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  };
  const mkEl = () => {
    const cls = new Set();
    const listeners = {};
    return {
      style: {}, dataset: {}, textContent: '', innerHTML: '', value: '', blur() {}, focus() {}, width: 540, height: 960, clientWidth: 540, clientHeight: 960,
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
    addEventListener: (type, fn) => { (docListeners[type] = docListeners[type] || []).push(fn); },
  };
  const sandbox = {
    document, console,
    performance: { now: () => 0 },
    requestAnimationFrame: (fn) => { rafs.push(fn); return rafs.length; },
    addEventListener() {},
    navigator: { vibrate() {} },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    jomaridReward: (reason, amount) => { rewards.push([reason, amount]); },
    jomaridRecord: (stat, value) => { records.push([stat, value]); },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  // Pevné náhodné číslo, ať jsou testy opakovatelné; Math patří vm kontextu, vnější proces se nemění.
  vm.runInContext('(function () { var s = 12345; Math.random = function () { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; })()', sandbox);
  new vm.Script(game, { filename: 'game.js' }).runInContext(sandbox);
  const run = (code) => vm.runInContext(code, sandbox);
  return { sandbox, run, store, rewards, records, docListeners };
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
test('hra nemá vlastní počítadlo Jomarid Coins: zůstatek ukazuje lišta appky nad hrou, appka ho hře neposílá', () => {
  assert.doesNotMatch(gamesPage, /type: 'balance'/);
  assert.doesNotMatch(gamesPage, /onLoad=\{sendBalance\}/);
  assert.doesNotMatch(shell, /balance|jomarid-host|id="jb"|jbn/i, 'most ani menu o zůstatku nic neví');
  assert.doesNotMatch(game, /jomaridBalance|onJomaridBalance|hasJb|txt\('🔶 '/, 'ani v herním panelu; 🔶 zůstává jen jako značka zlaté koule');
  const { run, sandbox } = makeEnv();
  assert.equal(typeof sandbox.onJomaridBalance, 'undefined');
  assert.doesNotThrow(() => run("start('classic')"));
});

/* ---------------------------------------------------------------- cheat menu */
test('cheat menu: pole jako číslo verze úplně dole v menu, bez popisku, a 67MILUJU ho otevře', () => {
  const menu = shell.slice(shell.indexOf('<div id="menu"'), shell.indexOf('<div id="cheatm"'));
  assert.match(menu, /<div class="vfoot"><input type="text" id="vf" class="vfield" placeholder="v\d+\.\d+"[^>]*aria-label="Tajný kód"><\/div>\s*<\/div>\s*$/, 'pole je poslední v menu');
  assert.doesNotMatch(menu, /Tajný kód<|cheat/i, 'v menu není vidět žádný popisek');
  assert.match(css, /\.vfield\{[^}]*font-size:16px;/, 'písmo aspoň 16 px, ať iOS při klepnutí nepřibližuje');
  const { run, sandbox, docListeners } = makeEnv();
  const key = (code, k) => { for (const fn of docListeners.keydown || []) fn({ code, key: k, repeat: false }); };
  const hidden = () => sandbox.document.getElementById('cheatm').classList.contains('hide');
  assert.equal(hidden(), false, 'bez hide = zatím není nic zavřeno (stav z jednoduchého stubu)');
  sandbox.document.getElementById('cheatm').classList.add('hide');
  // 67MILUJU na české klávesnici: číslice podle kódu klávesy, písmena podle znaku
  const seq = [['Digit6', 'ž'], ['Digit7', 'ý'], ['KeyM', 'm'], ['KeyI', 'i'], ['KeyL', 'l'], ['KeyU', 'u'], ['KeyJ', 'j']];
  for (const [c, k] of seq) key(c, k);
  assert.equal(hidden(), true, 'rozepsaný kód menu neotevře');
  key('KeyU', 'u');
  assert.equal(hidden(), false, 'celý kód otevře menu');
  key('Escape', 'Escape');
  assert.equal(hidden(), true, 'Esc menu zavře');
  // pole: hotový text (velká/malá písmena, mezery)
  const vf = sandbox.document.getElementById('vf');
  vf.value = '67MILU'; for (const fn of vf.listeners.input) fn(); assert.equal(hidden(), true);
  vf.value = ' 67miluju '; for (const fn of vf.listeners.input) fn(); assert.equal(hidden(), false);
  assert.equal(vf.value, '', 'pole se vyprázdní');
  run('cheatClose()'); vf.value = 'blbost'; for (const fn of vf.listeners.blur) fn(); assert.equal(vf.value, '');
});

test('cheat menu: cheaty jdou do skutečného postupu, ukládají se a hlásí se appce (odznaky)', () => {
  const { run, sandbox, records, rewards, store } = makeEnv();
  const click = (c) => sandbox.document.getElementById('cl').onclick({ target: { closest: () => ({ dataset: { c } }) } });
  click('score');
  assert.equal(run('S.bm.classic'), 10000); assert.equal(run('S.best'), 10000);
  assert.deepEqual([run('S.bm.time'), run('S.bm.drops'), run('S.bm.chaos')], [1000, 500, 1500], 'rekordy ve všech čtyřech režimech');
  assert.deepEqual(rewards, [['record', 3], ['record', 3], ['record', 3], ['record', 3]], 'každý nový rekord žádá o odměnu jako každý jiný (strop hlídá server)');
  for (const [k, want] of [['score_classic', 10000], ['score_time', 1000], ['score_drops', 500], ['score_chaos', 1500]]) assert.ok(records.some(([kk, v]) => kk === k && v === want), `${k} ${want} (odznaky za skóre)`);
  click('disc');
  assert.equal(run('S.disc'), 11);
  assert.ok(records.some(([k, v]) => k === 'balls_discovered' && v === 12), 'všech 12 koulí (odznaky Velká koule i Všichni kámoši)');
  const c0 = run('S.coins'); click('coins'); assert.equal(run('S.coins'), c0 + 1000);
  const saved = JSON.parse(store['koulovi-kamosi-v1']);
  assert.equal(saved.bm.classic, 10000); assert.equal(saved.bm.chaos, 1500); assert.equal(saved.disc, 11); assert.equal(saved.coins, c0 + 1000, 'uloženo');
  assert.equal(sandbox.document.getElementById('cmsg').textContent.length > 0, true, 'hláška o cheatu');
  // neznámé hodnoty (dědičné klíče) nic nespustí
  for (const k of ['constructor', 'toString', 'nope']) assert.doesNotThrow(() => click(k));
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


/* ---------------------------------------------------------------- zlatá koule (vzácný bonus jako v ostatních hrách) */
test('zlatá koule: šance 4 %, jen mimo Zen, nejvýš 3 za hru a vždy jen jedna naráz', () => {
  const a = makeEnv();
  a.run("start('classic')");
  a.run('Math.random = () => 0.0399');
  assert.equal(a.run('goldRoll()'), 1, 'těsně pod 4 % padne');
  a.run('g.nG = 0; g.gn = 0; Math.random = () => 0.0401');
  assert.equal(a.run('goldRoll()'), 0, 'těsně nad 4 % nepadne');
  assert.equal(a.run('g.gn'), 0, 'nepadlo = nepočítá se');
  // opakovaně házím, zlaté koule z misky mezitím mizí (spojí se) - víc než 3 za hru nepřijdou
  const b = makeEnv();
  b.run("start('classic')"); b.run('Math.random = () => 0');
  let golden = 0; let together = 0;
  for (let i = 0; i < 60; i += 1) {
    b.run('g.cool = 0; g.left = 99; drop();');
    together = Math.max(together, b.run('g.cG + g.nG + g.balls.filter(q => q.gold).length'));
    golden += b.run('g.balls.filter(q => q.gold).length');
    b.run('g.balls = g.balls.filter(q => !q.gold)');
  }
  assert.equal(b.run('g.gn'), 3, 'nejvýš tři za hru');
  assert.equal(golden, 3);
  assert.ok(together <= 1, 'jedna naráz: ' + together);
  const z = makeEnv();
  z.run("start('zen')"); z.run('Math.random = () => 0');
  for (let i = 0; i < 40; i += 1) z.run('g.cool = 0; drop();');
  assert.equal(z.run('g.gn'), 0, 'Zen zlatou kouli nemá');
  assert.equal(z.run('g.balls.some(q => q.gold) || g.cG || g.nG'), 0);
});

test('zlatá koule: spojením dá žádost o 4 Jomarid Coins a 25 🪙, jen za zlatou, nejvýš 3krát za hru, mimo Zen', () => {
  const { run, rewards } = makeEnv();
  run("start('classic')"); run('S.disc = 11');
  run('g.balls = [mk(270, 600, 2), mk(270, 600, 2)]; step();');
  assert.equal(rewards.length, 0, 'běžné spojení bez odměny');
  assert.equal(run('S.coins'), 0);
  run('{ const a = mk(270, 600, 2), b = mk(270, 600, 2); a.gold = 1; g.balls = [a, b]; } step();');
  assert.deepEqual(rewards, [['golden_ball', 4]]);
  assert.equal(run('S.coins'), 25);
  assert.equal(run('g.pp.some(p => p.s === "+4 🔶")'), true, 'hra ukáže +4 🔶');
  assert.equal(run('g.balls.some(q => q.gold)'), false, 'spojením vznikne běžná koule');
  for (let i = 0; i < 5; i += 1) run('{ const a = mk(270, 600, 2), b = mk(270, 600, 2); b.gold = 1; g.balls = [a, b]; } step();');
  assert.equal(rewards.length, 3, 'nejvýš 3 odměny za hru (i při vracení tahů)');
  const z = makeEnv();
  z.run("start('zen')"); z.run('S.disc = 11');
  z.run('{ const a = mk(270, 600, 2), b = mk(270, 600, 2); a.gold = 1; g.balls = [a, b]; } step();');
  assert.equal(z.rewards.length, 0);
  assert.equal(z.run('S.coins'), 0);
  // nová hra počítá znovu
  run("start('classic')");
  run('{ const a = mk(270, 600, 2), b = mk(270, 600, 2); a.gold = 1; g.balls = [a, b]; } step();');
  assert.equal(rewards.length, 4);
});

test('zlatá koule přežije uložení rozehrané hry i vrácení tahu', () => {
  const { run } = makeEnv();
  run("start('classic')"); run('g.cG = 1; g.nG = 0; g.gn = 1; g.gr = 1;');
  run('g.cool = 0; drop();');
  assert.equal(run('g.balls.length'), 1);
  assert.equal(run('g.balls[0].gold'), 1, 'padlá koule je zlatá');
  // vrácení tahu vrátí zlatou kouli do ruky
  run('S.inv.undo = 1; ability("undo");');
  assert.equal(run('g.cG'), 1);
  assert.equal(run('g.balls.length'), 0);
  run('g.cool = 0; drop();');
  assert.equal(run('g.balls[0].gold'), 1);
  run('saveRun();');
  run("start('time'); resume();");
  assert.equal(run('g.mode'), 'classic');
  assert.equal(run('g.balls.filter(q => q.gold).length'), 1, 'po pokračování je pořád zlatá');
  assert.equal(run('g.gn'), 1);
  assert.equal(run('g.gr'), 1);
  // starý uložený postup bez zlatých koulí se načte
  run('S.run = { mode: "classic", score: 5, cur: 0, next: 1, merges: 0, f: 0, t: 5400, left: 30, balls: [{ t: 0, ph: 1, P: [[1,1,0,0],[1,1,0,0],[1,1,0,0],[1,1,0,0],[1,1,0,0],[1,1,0,0],[1,1,0,0],[1,1,0,0]] }] }; resume();');
  assert.equal(run('g.cG + g.nG + g.gn + g.gr'), 0);
  assert.equal(run('g.balls.length'), 1);
});

test('zlatá koule je vidět: zář kolem koule a 🔶 v ruce, v dalším poli i v misce, odměna jde přes most se jménem golden_ball', () => {
  assert.match(game, /goldRoll\(\)\)\{g\.nG=1;/);
  assert.match(game, /jomaridReward\('golden_ball',GOLD\.jc\)/);
  assert.match(game, /ball\(60,204,Math\.min\(RAD\[g\.next\],26\),g\.next,0,1,undefined,1,g\.nG\)/);
  assert.match(game, /ball\(hx,DROP_Y,hr,g\.cur,0,1,undefined,1,g\.cG\)/);
  assert.match(game, /bl,b\.gold\)\}/);
  assert.match(game, /if\(gd\)\{ctx\.font=/);
});

test('rekordy se hlásí appce: skóre režimů a objevené koule při startu i při uložení, režimy bez skóre se neposílají', () => {
  const a = makeEnv();
  assert.deepEqual(a.records.filter(([k]) => k !== 'balls_discovered'), [['score_classic', undefined], ['score_time', undefined], ['score_drops', undefined], ['score_chaos', undefined]], 'bez rekordů se posílá jen undefined, které most zahodí');
  assert.deepEqual(a.records.find(([k]) => k === 'balls_discovered'), ['balls_discovered', 1], 'jedna koule je odemčená vždy');
  const b = makeEnv();
  b.records.length = 0;
  b.run("start('classic')"); b.run('g.score = 150; finish(1);');
  assert.ok(b.records.some(([k, v]) => k === 'score_classic' && v === 150), 'konec hry nahlásí skóre Klasiky');
  assert.ok(!b.records.some(([k]) => k === 'score_zen'), 'Zen se nehlásí');
  b.records.length = 0;
  b.run('g.balls = [mk(270, 600, 4), mk(270, 600, 4)]; S.disc = 3; step();');
  assert.ok(b.records.some(([k, v]) => k === 'balls_discovered' && v === 6), 'objevení nové koule (typ 5) nahlásí 6 objevených');
});

test('grafika: koule mají stínování a lesk, mísa vnitřek, částice konfety a kruh a celé kreslení proběhne ve všech stavech bez chyby', () => {
  for (const needle of ['createRadialGradient(-r*.38', 'function rr(', 'bg2', 'g.rg', 'const shd=']) assert.ok(game.includes(needle), needle);
  const { run } = makeEnv();
  for (const mode of ['classic', 'time', 'drops', 'chaos', 'zen']) {
    run(`start('${mode}')`);
    for (let i = 0; i < 240; i += 1) {
      run(`g.aimX = ${150 + ((i * 53) % 240)}; if (g.cool <= 0) drop(); step();`);
      if (i % 20 === 0) run('draw()');
      if (run('st') !== 'play') break;
    }
    run('fx(270, 600, 320, COL[3]); g.disc = { t: 7, l: 100 }; g.tgt = true; draw();');
    assert.ok(run('g.rg.length') > 0 && run('g.pt.length') > 0, 'fx přidá kruh i konfety');
    for (let i = 0; i < 60; i += 1) run('step()');
    assert.equal(run('g.rg.length'), 0, 'kruh po čase zmizí');
  }
  run("start('classic'); S.disc = 11; g.balls.push(Object.assign(mk(270, 600, 1), { gold: 1 })); draw()");
});
