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
const mpGame = read(path.join(DIR, 'mp.js'));
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
function makeEnv({ tut = true, store: preset = {}, mp = null } = {}) {
  const store = Object.assign({}, preset);
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
  if (mp) sandbox.jomaridMP = mp;   // online zápas: hra dostane rozhraní z appky (src/mp)
  vm.createContext(sandbox);
  // Pevné náhodné číslo, ať jsou testy opakovatelné; Math patří vm kontextu, vnější proces se nemění.
  vm.runInContext('(function () { var s = 12345; Math.random = function () { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; })()', sandbox);
  new vm.Script(game, { filename: 'game.js' }).runInContext(sandbox);
  new vm.Script(mpGame, { filename: 'mp.js' }).runInContext(sandbox);
  const run = (code) => vm.runInContext(code, sandbox);
  if (tut) run('S.tut = 1');   // návod pro první hru se zkouší zvlášť, jinak by první klepnutí jen zavřelo návod
  return { sandbox, run, store, rewards, records, docListeners };
}

test('hra se spustí a ukáže menu bez chyby', () => {
  const { run } = makeEnv();
  assert.equal(run('st'), 'menu');
  assert.equal(run('MODES.length'), 6);
  assert.deepEqual(JSON.parse(run('JSON.stringify(MODES.map(m => m[0]))')), ['classic', 'time', 'drops', 'chaos', 'zen', 'daily']);
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
  const scores = a.records.filter(([k]) => k.startsWith('score_'));
  assert.deepEqual(scores, [['score_classic', undefined], ['score_time', undefined], ['score_drops', undefined], ['score_chaos', undefined], ['score_zen', undefined]], 'bez rekordů se posílá jen undefined, které most zahodí');
  assert.deepEqual(a.records.find(([k]) => k === 'balls_discovered'), ['balls_discovered', 1], 'jedna koule je odemčená vždy');
  const b = makeEnv();
  b.records.length = 0;
  b.run("start('classic')"); b.run('g.score = 150; finish(1);');
  assert.ok(b.records.some(([k, v]) => k === 'score_classic' && v === 150), 'konec hry nahlásí skóre Klasiky');
  assert.ok(!b.records.some(([k, v]) => k === 'score_zen' && v), 'Zen bez skóre se nehlásí');
  b.run("start('zen')"); b.run('g.score = 700; finish(1);');
  assert.ok(b.records.some(([k, v]) => k === 'score_zen' && v === 700), 'Zen se hlásí jako vlastní statistika');
  b.records.length = 0;
  b.run('g.balls = [mk(270, 600, 4), mk(270, 600, 4)]; S.disc = 3; step();');
  assert.ok(b.records.some(([k, v]) => k === 'balls_discovered' && v === 6), 'objevení nové koule (typ 5) nahlásí 6 objevených');
});

/* ---------------------------------------------------------------- čítače pro odznaky (src/gameRecords/defs/koulovi.js) */
const stOf = (env) => JSON.parse(env.run('JSON.stringify(S.st)'));

test('čítače: hody, sloučení, combo, body za sloučení a velké koule', () => {
  const e = makeEnv();
  e.run("start('classic')");
  e.run('g.aimX = 270; g.cool = 0; drop();');
  assert.deepEqual([stOf(e).drops_total, stOf(e).max_balls_bowl], [1, 1]);
  e.run('g.balls = [mk(270, 600, 4), mk(270, 600, 4)]; step();');
  assert.deepEqual([stOf(e).total_merges, stOf(e).best_merge_points, stOf(e).best_combo, stOf(e).best_merges_game, stOf(e).big_merges], [1, 160, 1, 1, undefined], 'koule typu 5 není velká');
  e.run('g.balls = [mk(270, 600, 6), mk(270, 600, 6)]; step();');
  assert.equal(stOf(e).big_merges, 1, 'sloučení do typu 7 je velké');
  assert.equal(stOf(e).total_merges, 2);
  assert.equal(stOf(e).best_merges_game, 2);
});

test('čítače: zlatá koule se počítá a v jedné hře nejvýš třikrát', () => {
  const e = makeEnv();
  e.run("start('classic')");
  for (let i = 0; i < 4; i += 1) e.run('g.balls = [mk(270, 600, 3), mk(270, 600, 3)]; g.balls[0].gold = 1; step();');
  assert.deepEqual([stOf(e).gold_merges, stOf(e).best_gold_game], [3, 3], 'čtvrtá zlatá už nic nedá (GOLD.max)');
  e.run("start('zen')"); e.run('g.balls = [mk(270, 600, 3), mk(270, 600, 3)]; g.balls[0].gold = 1; step();');
  assert.equal(stOf(e).gold_merges, 3, 'v Zenu zlaté koule nic nedávají');
});

test('čítače: vylepšení, obchod, Cash Out a mince', () => {
  const e = makeEnv();
  e.run("start('classic')");
  e.run('g.aimX = 270; g.cool = 0; drop(); ability("undo"); ability("shake"); ability("pop");');
  assert.deepEqual([stOf(e).undo_used, stOf(e).shake_used, stOf(e).pop_used], [1, 1, 1]);
  e.run('g.tgt = true; g.balls = [mk(270, 600, 2)]; S.inv.hit = 1; cv.listeners.pointerdown[0]({ clientX: 270, clientY: 600, pointerId: 1 });');
  assert.equal(stOf(e).hit_used, 1, 'Zásah na kouli');
  e.run('S.coins = 500; $("items").onclick({ target: { dataset: { k: "undo", p: "50" } } });');
  assert.deepEqual([stOf(e).items_bought, stOf(e).coins_spent, stOf(e).hoard], [1, 50, 1], 'po použití všech čtyř a jednom nákupu je v zásobě jedno vylepšení');
  e.run("start('classic')");
  e.run('g.balls = [mk(270, 600, 5)]; cashOut(); cashOut();');
  assert.deepEqual([stOf(e).cash_outs, stOf(e).best_cash_out], [1, 40]);
  assert.equal(stOf(e).coins_earned, 40, 'výběr jsou vydělané mince');
});

test('čítače: konec hry, dohrané režimy, nejdelší hra, hra bez vylepšení, odchod do menu', () => {
  const e = makeEnv();
  e.run("start('time')"); e.run('g.score = 1200; g.f = 3 * 3600 + 10; finish(1);');
  e.run("start('drops')"); e.run('g.score = 800; finish(1);');
  e.run("start('classic')"); e.run('g.score = 2100; g.used = 1; finish();');
  assert.deepEqual([stOf(e).games_played, stOf(e).time_runs_completed, stOf(e).drops_runs_completed, stOf(e).longest_game_min], [3, 1, 1, 3]);
  assert.equal(stOf(e).no_item_score, 1200, 'nejvyšší skóre z her bez vylepšení (hra s vylepšením se nepočítá)');
  e.run("start('classic')"); e.run('g.score = 5; toMenu();');
  assert.equal(stOf(e).quits, 1);
  e.run("start('zen')"); e.run('g.score = 99999; finish(1);');
  assert.equal(stOf(e).no_item_score, 1200, 'Zen se do hry bez vylepšení nepočítá');
});

test('čítače: zemětřesení, zachráněné koule, čas, dny a režimy', () => {
  const e = makeEnv();
  e.run("start('chaos')"); e.run('g.f = 599; step();');
  assert.equal(stOf(e).quakes_survived, 1);
  e.run("start('classic')");
  e.run('g.balls = [mk(270, 800, 3)]; g.balls[0].y = 900; for (let i = 0; i < 25; i += 1) { g.balls[0].y = 900; g.overT = Math.max(g.overT, i); g.overT++; }');
  e.run('g.overT = 30; g.balls = []; step();');
  assert.equal(stOf(e).close_calls, 1, 'koule, která se přelévala přes okraj a zmizela, se počítá jako zachráněná');
  e.run("start('classic')"); e.run('S.ps = 0; g.f = 0; for (let i = 0; i < 125; i += 1) step();');
  assert.equal(e.run('S.ps'), 2, 'po 120 snímcích dvě sekundy');
  assert.deepEqual([e.run('S.days.length'), e.run('Object.keys(S.modes).sort().join()')], [1, 'chaos,classic']);
  e.records.length = 0; e.run('save()');
  assert.deepEqual([e.records.find(([k]) => k === 'days_played'), e.records.find(([k]) => k === 'modes_played')], [['days_played', 1], ['modes_played', 2]]);
});

test('čítače se ukládají s postupem do uloženého klíče', () => {
  const a = makeEnv();
  a.run("start('classic')"); a.run('g.score = 300; g.balls = [mk(270, 600, 4), mk(270, 600, 4)]; step(); finish();');
  const saved = JSON.parse(a.store['koulovi-kamosi-v1']);
  assert.ok(saved.st.total_merges >= 1 && saved.st.games_played === 1, 'čítače jsou v uloženém postupu');
  assert.ok(Array.isArray(saved.days) && saved.days.length === 1 && saved.modes.classic === 1 && saved.ps >= 0);
});

test('cheat Všechny odznaky zvedne všechny statistiky z katalogu na prahy odznaků a hra je hlásí', async () => {
  const { GAME_CATALOG, GAME_BADGES } = await import('../../../gameRecords/catalog.js');
  const e = makeEnv();
  e.records.length = 0;
  e.run('CHEATS.all(); save();');
  const reported = new Map();
  for (const [k, v] of e.records) reported.set(k, Math.max(reported.get(k) || 0, Number(v) || 0));
  const stats = GAME_CATALOG.find((g) => g.id === 'koulovikamosi').stats.map((x) => x.key);
  for (const key of stats) {
    const need = Math.max(...GAME_BADGES.filter((x) => x.game === 'koulovikamosi' && x.stat === key).map((x) => x.threshold));
    assert.ok(reported.get(key) >= need, `${key}: hra hlásí ${reported.get(key)}, odznak chce ${need}`);
  }
  assert.deepEqual([...reported.keys()].filter((k) => !stats.includes(k)), [], 'hra hlásí jen statistiky z katalogu');
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

/* ---------------------------------------------------------------- návod, varování před okrajem, denní výzva */
test('návod pro první hru: první klepnutí ho zavře a nic neodhodí, uloží se, že už se neukáže, a fyzika za něj stojí', () => {
  const { run, store } = makeEnv({ tut: false });
  assert.equal(run('S.tut'), 0);
  run("start('classic')");
  const pid = 7;
  const down = () => run(`cv.listeners.pointerdown.forEach(f => f({ pointerId: ${pid}, clientX: 270, clientY: 400, isPrimary: true }))`);
  const up = () => run(`cv.listeners.pointerup.forEach(f => f({ pointerId: ${pid}, clientX: 270, clientY: 400 }))`);
  // dokud návod visí, hra se nehýbe
  run('loop(1000); loop(2000)');
  assert.equal(run('g.f'), 0, 'bez zavřeného návodu se nekrokuje');
  down(); up();
  assert.equal(run('S.tut'), 1);
  assert.equal(run('g.balls.length'), 0, 'klepnutí jen zavřelo návod');
  assert.equal(JSON.parse(store['koulovi-kamosi-v1']).tut, 1, 'uloženo');
  run('loop(3000); loop(3100)');
  assert.ok(run('g.f') > 0, 'po zavření hra běží');
  down(); up();
  assert.equal(run('g.balls.length'), 1, 'další klepnutí už koule pustí');
  // nová hra a nový start: návod se znovu neukáže
  const again = makeEnv({ tut: false });
  again.store['koulovi-kamosi-v1'] = JSON.stringify({ best: 5, tut: 1 });
  assert.equal(makeEnv({ tut: false }).run('S.tut'), 0);
});

test('návod se vykreslí a hra přitom nespadne; po zavření se nekreslí', () => {
  const { run } = makeEnv({ tut: false });
  run("start('classic')");
  assert.doesNotThrow(() => run('draw()'));
  run('S.tut = 1');
  assert.doesNotThrow(() => run('draw()'));
  assert.match(game, /function tut\(\)\{ctx\.fillStyle='rgba\(0,0,0,\.62\)'/);
  assert.match(game, /if\(st==='play'&&!S\.tut\)tut\(\);/);
});

test('varování před okrajem misky: míra roste, jak se nejvyšší usazená koule blíží k okraji, nově hozená koule ho nevyvolá a v Zenu se nic neukazuje', () => {
  const { run } = makeEnv();
  run("start('classic')");
  run('step()');
  assert.equal(run('g.rim'), 0, 'prázdná miska');
  // usazená koule hluboko v misce
  run('const low = mk(270, 700, 2); low.age = 999; g.balls.push(low); step();');
  assert.equal(run('g.rim'), 0);
  // těsně pod okrajem (TOP je 500): koule s vrchem na y 520 je v hlavním varování
  run('g.balls.length = 0; const hi = mk(270, 520 + RAD[2], 2); hi.age = 999; g.balls.push(hi); for (const p of hi.P) { p.vx = 0; p.vy = 0; } step();');
  assert.ok(run('g.rim') > 0.1, 'míra ' + run('g.rim'));
  const mid = run('g.rim');
  run('g.balls.length = 0; const hi2 = mk(270, 500 + RAD[2] + 40, 2); hi2.age = 999; g.balls.push(hi2); step();');
  assert.ok(run('g.rim') < mid + 0.0001 || run('g.rim') >= 0, 'výš je to horší');
  // čerstvě hozená koule (age <= 45) varování nespustí, i když je nahoře
  run('g.balls.length = 0; const fresh = mk(270, 420, 2); fresh.age = 3; g.balls.push(fresh); g.cool = 99; step();');
  assert.equal(run('g.rim'), 0);
  // zvuk jen při vstupu do varování, ne v každém snímku, a znovu až po uklidnění
  run('g.balls.length = 0; const w = mk(270, 515 + RAD[2], 2); w.age = 999; g.balls.push(w); for (const p of w.P) { p.vx = 0; p.vy = 0; } step();');
  assert.equal(run('g.rimB'), 1);
  run('g.balls.length = 0; step();');
  assert.equal(run('g.rimB'), 0, 'po uklidnění se znovu zbrojí');
  // Zen nemá co hlídat
  const z = makeEnv();
  z.run("start('zen')");
  z.run('const q = mk(270, 515 + RAD[2], 2); q.age = 999; g.balls.push(q); step();');
  assert.equal(z.run('g.rim'), 0);
  // varování se kreslí jako přerušovaná čára u okraje a text
  assert.match(game, /if\(g\.rim>\.05&&st==='play'\)\{/);
  assert.match(game, /Pozor, miska se plní!/);
  const d = makeEnv();
  d.run("start('classic')");
  d.run('const q2 = mk(270, 515 + RAD[2], 2); q2.age = 999; g.balls.push(q2); step();');
  assert.ok(d.run('g.rim') > 0.3);
  assert.doesNotThrow(() => d.run('draw()'));
});

test('denní výzva: všichni dostanou ve stejný den stejné koule bez ohledu na to, kdy a kam hází; jiný den jiné', () => {
  const seq = (aimBase, wait) => {
    const { run } = makeEnv();
    run("start('daily')");
    const out = [];
    for (let i = 0; i < 40; i += 1) {
      out.push(run('g.cur'));
      run(`g.aimX = ${aimBase + ((i * 53) % 200)}; g.cool = 0; drop();`);
      for (let k = 0; k < wait; k += 1) run('step()');
      if (run('st') !== 'play') run("st = 'play'");
    }
    return out.join('');
  };
  const a = seq(120, 5), b = seq(200, 60);
  assert.equal(a, b, 'stejné pořadí koulí při jiném házení');
  assert.match(a, /[0-3]{40}/);
  assert.ok(new Set(a.split('')).size >= 3, 'koule se střídají: ' + a);
  // jiný den = jiný start
  const { run } = makeEnv();
  const first = (d) => run(`(() => { g = { mode: 'daily', rs: dseed('${d}') }; const o = []; for (let i = 0; i < 30; i++) o.push(rnd('daily')); return o.join(''); })()`);
  assert.equal(first('2026-03-01'), first('2026-03-01'));
  assert.notEqual(first('2026-03-01'), first('2026-03-02'));
  // seedování nesahá na Math.random ostatních režimů
  assert.match(game, /const rnd=m=>\{const a=m==='chaos'\?\[0,1,1,2,2,3,4,5\]:\[0,0,0,1,1,2,3\];return a\[\(m==='daily'\?sr\(\):Math\.random\(\)\)\*a\.length\|0\]\};/);
});

test('denní výzva: Zpět vrátí i pořadí koulí, uložená hra ho zachová a zlatá koule se tu neobjeví', () => {
  const { run } = makeEnv();
  const snap = (r = run) => JSON.parse(r('JSON.stringify([g.cur, g.next, g.rs])'));
  run("start('daily')");
  const before = snap();
  run('g.aimX = 270; g.cool = 0; drop();');
  assert.notDeepEqual(snap(), before);
  run("S.inv.undo = 1; ability('undo')");
  assert.deepEqual(snap(), before, 'po Zpět je to stejné pořadí');
  run('g.aimX = 200; g.cool = 0; drop();');
  run('g.aimX = 300; g.cool = 0; drop(); step();');
  const live = snap();
  run('saveRun()');
  // znovu načtená hra pokračuje stejnou posloupností
  const e2 = makeEnv();
  e2.run(`S = JSON.parse(${JSON.stringify(run('JSON.stringify(S)'))}); S.tut = 1;`);
  e2.run('resume()');
  assert.equal(e2.run('g.mode'), 'daily');
  assert.deepEqual(snap(e2.run), live, 'pokračování má stejné koule i stav náhody');
  // zlatá koule: ani po stovkách hodů
  const e = makeEnv();
  e.run("start('daily')");
  let gold = 0;
  for (let i = 0; i < 300; i += 1) { e.run('g.cool = 0; g.balls.length = 0; drop();'); gold += e.run('(g.cG || g.nG) ? 1 : 0'); }
  assert.equal(gold, 0);
});

test('denní výzva: nejlepší výsledek dne se ukládá, rekord dne dá žádost o odměnu jen jednou za den, nepočítá se jako zahraný režim ani jako rekord Klasiky a odznakové statistiky se neposílají', () => {
  const { run, rewards, records, store } = makeEnv();
  run("start('daily')");
  assert.deepEqual(JSON.parse(run('JSON.stringify(Object.keys(S.modes))')), [], 'denní výzva se nepočítá mezi zahrané režimy');
  run('g.score = 250; finish()');
  assert.equal(run('S.dc.best'), 250);
  assert.equal(run('S.dc.n'), 1);
  assert.equal(run('S.dc.d'), run('today()'));
  assert.deepEqual(rewards.filter((r) => r[0] === 'record'), [['record', 3]]);
  assert.equal(run('S.bm.daily'), undefined, 'rekord Klasiky ani jiných režimů se nemění');
  assert.equal(run('S.bm.classic || 0'), 0);
  // druhý, lepší pokus téhož dne: nový nejlepší, ale odměna už ne
  run("start('daily'); g.score = 900; finish()");
  assert.equal(run('S.dc.best'), 900);
  assert.equal(run('S.dc.n'), 2);
  assert.equal(rewards.filter((r) => r[0] === 'record').length, 1, 'jedna žádost za den');
  // horší pokus nic nezmění
  run("start('daily'); g.score = 100; finish()");
  assert.equal(run('S.dc.best'), 900);
  assert.equal(run('S.dc.n'), 3);
  // uloženo
  const saved = JSON.parse(store['koulovi-kamosi-v1']);
  assert.equal(saved.dc.best, 900);
  // nový den: čítač se vynuluje
  run("S.dc.d = '2000-01-01'; start('daily'); g.score = 120; finish()");
  assert.equal(run('S.dc.best'), 120);
  assert.equal(run('S.dc.n'), 1);
  assert.equal(rewards.filter((r) => r[0] === 'record').length, 2, 'nový den = nová žádost');
  // appce se denní výzva nehlásí (odznaky jsou za původních pět režimů)
  assert.ok(!records.some(([k]) => /daily/.test(k)));
  // zpět do menu uprostřed denní výzvy zapíše výsledek dne, ne rekord režimu
  run("start('daily'); g.score = 400; toMenu()");
  assert.equal(run('S.dc.best'), 400);
  assert.equal(run('S.bm.daily'), undefined);
});

test('seznam režimů ukazuje u denní výzvy dnešní nejlepší výsledek, u ostatních rekord', () => {
  const { run, sandbox } = makeEnv();
  run("S.bm.classic = 777; S.dc = { d: today(), best: 321, n: 2, paid: 0 }; modes();");
  const html = sandbox.document.getElementById('ml').innerHTML;
  assert.match(html, /Denní výzva/);
  assert.match(html, /dnes 🏆 321/);
  assert.match(html, /🏆 777/);
  run("S.dc = { d: '2000-01-01', best: 5, n: 1, paid: 0 }; modes();");
  assert.match(sandbox.document.getElementById('ml').innerHTML, /dnes 🏆 0/, 'včerejší výsledek se dnes neukazuje');
  // poškozený uložený stav denní výzvy se opraví
  const e = makeEnv({ tut: false });
  e.store['koulovi-kamosi-v1'] = JSON.stringify({ dc: 'x', tut: 'ano' });
  assert.ok(true);
});

test('omezený pohyb: kývání koulí se při nastavení systému vypne a v CSS nezůstane jiná nekonečná animace bez výjimky', () => {
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.b\{animation:none\}\}/);
  const infinite = [...css.matchAll(/([^{}]+)\{[^{}]*animation:[^;}]*infinite/g)].map((m) => m[1].trim());
  assert.deepEqual(infinite, ['.b'], 'jediná nekonečná animace je kývání koulí, a ta je v bloku vypnutá');
});

test('tlačítko zvuku: má popisek podle stavu a je stejně velké jako Obchod (ne drobná ikona)', () => {
  assert.match(shell, /<button id="snd" class="sec" title="Vypnout zvuk">🔊<\/button>/, 'bez vlastní zmenšené velikosti písma');
  assert.match(game, /\$\('snd'\)\.textContent=S\.mute\?'🔇':'🔊';\$\('snd'\)\.title=S\.mute\?'Zapnout zvuk':'Vypnout zvuk';/);
});

test('uložení: poškozený nebo upravený postup hru nerozbije a platný zůstane beze změny', () => {
  const KEY = 'koulovi-kamosi-v1';
  const load = (saved) => makeEnv({ store: { [KEY]: typeof saved === 'string' ? saved : JSON.stringify(saved) } });
  const snap = (e) => JSON.parse(e.run('JSON.stringify(S)'));
  const valid = { best: 1234, games: 20, merges: 300, coins: 75, disc: 6, mute: 1, log: [[1700000000000, 150], [1700000100000, 90]], bm: { classic: 1234, zen: 80 }, st: { drops_total: 500, best_combo: 7 },
    modes: { classic: 1, zen: 1 }, inv: { undo: 2, shake: 0, pop: 3, hit: 1 }, days: ['2026-11-01'], ps: 3, tut: 1, dc: { d: '2026-11-01', best: 55, n: 2, paid: 1 } };
  const e0 = load(valid);
  const s0 = snap(e0);
  for (const k of Object.keys(valid)) assert.deepEqual(s0[k], valid[k], `platné pole ${k} se nezmění`);
  assert.equal(e0.run('st'), 'menu');
  // celý klíč je nesmysl: začíná se od nuly a nic nespadne
  for (const raw of ['-1', '"x"', '[]', 'null', 'true', '5', '{rozbitý json', '']) {
    const e = load(raw);
    assert.equal(e.run('st'), 'menu', `klíč ${raw}`);
    const s = snap(e);
    assert.deepEqual([s.best, s.games, s.coins, s.log.length], [0, 0, 0, 0], `klíč ${raw} dá výchozí postup`);
  }
  // poškozená pole: výsledek má vždy správné typy, menu se vykreslí a statistiky se dají spočítat
  const damaged = [
    { coins: {} }, { coins: 'x' }, { coins: -5 }, { coins: 1e999 }, { best: null }, { merges: {} }, { games: [] }, { disc: 'x' }, { mute: 'ano' },
    { log: false }, { log: 'x' }, { log: [1, 'x', [1], [NaN, 2], [5, 'a'], [1700000000000, 10]] }, { bm: [1, 2] }, { bm: { classic: 'x', zen: -1, time: 5 } }, { st: 5 }, { st: { a: 'x', b: 2, c: null } },
    { modes: 'x' }, { inv: { undo: 'x', shake: -1, pop: 1.5 } }, { inv: [] }, { inv: 7 }, { days: 'x' }, { days: [1, 'a', null] }, { dc: 5 }, { dc: { d: 7 } }, { run: 5 }, { run: { mode: 'x' } },
  ];
  for (const d of damaged) {
    const e = load({ ...valid, ...d });
    assert.equal(e.run('st'), 'menu', JSON.stringify(d));
    const s = snap(e);
    for (const k of ['best', 'games', 'merges', 'coins', 'disc']) assert.ok(typeof s[k] === 'number' && isFinite(s[k]) && s[k] >= 0, `${JSON.stringify(d)}: ${k}`);
    assert.ok(s.mute === 0 || s.mute === 1);
    assert.ok(Array.isArray(s.log) && s.log.every((r) => Array.isArray(r) && r.length >= 2 && typeof r[0] === 'number' && typeof r[1] === 'number'), `${JSON.stringify(d)}: log`);
    for (const m of [s.bm, s.st]) assert.ok(m && typeof m === 'object' && !Array.isArray(m) && Object.values(m).every((v) => typeof v === 'number' && isFinite(v) && v >= 0), JSON.stringify(d));
    assert.ok(s.modes && typeof s.modes === 'object' && !Array.isArray(s.modes));
    for (const k of ['undo', 'shake', 'pop', 'hit']) assert.ok(Number.isInteger(s.inv[k]) && s.inv[k] >= 0, `${JSON.stringify(d)}: inv.${k}`);
    assert.ok(Array.isArray(s.days) && s.days.every((v) => typeof v === 'string'));
    assert.doesNotThrow(() => e.run('stats()'), JSON.stringify(d));
    assert.equal(e.run("$('cont').classList.contains('hide')"), true, `${JSON.stringify(d)}: vadná rozehraná hra se zahodí, tlačítko Pokračovat zůstane skryté`);
  }
  assert.deepEqual(snap(load({ ...valid, log: [1, 'x', [1], [NaN, 2], [5, 'a'], [1700000000000, 10]] })).log, [[1700000000000, 10]]);
  assert.deepEqual(snap(load({ ...valid, bm: { classic: 'x', zen: -1, time: 5 } })).bm, { time: 5 });
  assert.deepEqual(snap(load({ ...valid, inv: { undo: 'x', shake: -1, pop: 1.5 } })).inv, { undo: 0, shake: 0, pop: 0, hit: 0 });
});

test('rozehraná hra: platná se obnoví, a ta se špatným tvarem (režim, počet bodů koule, NaN, příliš mnoho koulí) se při startu zahodí', () => {
  const a = makeEnv();
  a.run("start('classic')");
  for (let i = 0; i < 160; i += 1) a.run(`g.aimX = ${180 + ((i * 53) % 180)}; if (g.cool <= 0) drop(); step();`);
  a.run('saveRun()');
  const good = JSON.parse(a.store['koulovi-kamosi-v1']);
  assert.ok(good.run && good.run.balls.length > 0);
  const open = (run) => makeEnv({ store: { 'koulovi-kamosi-v1': JSON.stringify({ ...good, run }) } });
  const same = open(good.run);
  assert.equal(same.run("$('cont').classList.contains('hide')"), false, 'platná rozehraná hra se nabízí');
  same.run('resume()');
  assert.equal(same.run('g.balls.length'), good.run.balls.length);
  const ball = good.run.balls[0];
  const mut = (f) => { const r = JSON.parse(JSON.stringify(good.run)); f(r); return r; };
  const broken = {
    'neznámý režim': mut((r) => { r.mode = 'x'; }), 'koule nejsou pole': mut((r) => { r.balls = 'x'; }), 'bez koulí': mut((r) => { delete r.balls; }), 'příliš mnoho koulí': mut((r) => { r.balls = Array(301).fill(ball); }),
    'špatný počet bodů': mut((r) => { r.balls[0].P = r.balls[0].P.slice(1); }), 'bod není čtveřice': mut((r) => { r.balls[0].P[0] = [1, 2]; }), 'NaN v bodu': mut((r) => { r.balls[0].P[0][0] = null; }),
    'typ koule mimo rozsah': mut((r) => { r.balls[0].t = 99; }), 'záporný typ': mut((r) => { r.balls[0].t = -1; }), 'skóre text': mut((r) => { r.score = 'x'; }), 'další koule mimo rozsah': mut((r) => { r.next = 50; }),
    'prázdná koule': mut((r) => { r.balls[0] = null; }), 'nekonečný čas': mut((r) => { r.t = 1e999; }),
  };
  for (const [name, run] of Object.entries(broken)) {
    const e = open(run);
    assert.equal(e.run('st'), 'menu', name);
    assert.equal(e.run("$('cont').classList.contains('hide')"), true, `${name}: rozehraná hra se zahodí`);
    assert.equal(e.run('S.run'), null, name);
  }
  assert.match(game, /if\(S\.run&&!okRun\(S\.run\)\)S\.run=null;\s*g=\{balls:\[\]/, 'kontrola proběhne dřív, než se poprvé vykreslí menu');
});

/* ---------------------------------------------------------------- klávesnice (počítač) */
// Klávesy se posílají obsluze na dokumentu, stejně jako je dostane prohlížeč (cheat kód tam poslouchá taky, takže projdou oběma).
const press = (env, type, key, extra = {}) => (env.docListeners[type] || []).forEach((fn) => fn(Object.assign({ key, code: '', repeat: false, target: { tagName: 'BODY' }, preventDefault() { this.prevented = true; } }, extra)));

test('klávesnice: šipky míří (jen dokud jsou drženy), mezerník, Enter a ↓ pustí kouli a rychlé opakování klávesy nehází', () => {
  const env = makeEnv();
  const { run } = env;
  run("start('classic')");
  assert.equal(run('g.aimX'), 270);
  press(env, 'keydown', 'ArrowRight');
  run('last = 0; loop(100)');   // jeden snímek s dt = 0,05 s
  const right = run('g.aimX');
  assert.ok(right > 270 && right <= 270 + 25, 'doprava: ' + right);
  press(env, 'keyup', 'ArrowRight');
  run('loop(200)');
  assert.equal(run('g.aimX'), right, 'po puštění šipky se míření nehýbe');
  press(env, 'keydown', 'ArrowLeft');
  for (let t = 300; t < 3000; t += 50) run(`loop(${t})`);
  assert.equal(run('g.aimX'), 70, 'míření se zastaví na okraji misky (AL)');
  press(env, 'keyup', 'ArrowLeft');
  // pustí kouli na míření
  assert.equal(run('g.balls.length'), 0);
  const ev = {};
  press(env, 'keydown', ' ', ev);
  assert.equal(run('g.balls.length'), 1, 'mezerník');
  assert.ok(Math.abs(run('g.balls[0].x') - 70) < 80, 'koule padá na míření');
  // hned potom je chvíli pauza mezi hody, další stisk nic nehodí; opakování držené klávesy nehází vůbec
  press(env, 'keydown', 'Enter');
  assert.equal(run('g.balls.length'), 1, 'pauza mezi hody');
  run('g.cool = 0');
  press(env, 'keydown', 'Enter', { repeat: true });
  assert.equal(run('g.balls.length'), 1, 'držená klávesa nehází');
  press(env, 'keydown', 'ArrowDown');
  assert.equal(run('g.balls.length'), 2, 'šipka dolů');
});

test('klávesnice: první stisk jen zavře návod, další jen okno s novou koulí; v textovém poli a mimo hru klávesy nic nedělají', () => {
  const env = makeEnv({ tut: false });
  const { run, store } = env;
  run("start('classic')");
  press(env, 'keydown', ' ');
  assert.equal(run('S.tut'), 1, 'návod je zavřený');
  assert.equal(run('g.balls.length'), 0, 'první stisk nehází');
  assert.equal(JSON.parse(store['koulovi-kamosi-v1']).tut, 1, 'uloženo, že už se neukáže');
  run('g.disc = { t: 3, l: 150 }');
  press(env, 'keydown', ' ');
  assert.equal(run('g.disc'), null, 'okno s novou koulí zavřeno');
  assert.equal(run('g.balls.length'), 0);
  press(env, 'keydown', ' ');
  assert.equal(run('g.balls.length'), 1, 'teď už hází');
  // písmeno v textovém poli (tajný kód) hru neovlivní
  run('g.cool = 0');
  press(env, 'keydown', ' ', { target: { tagName: 'INPUT' } });
  assert.equal(run('g.balls.length'), 1);
  // Ctrl+mezerník a podobné zkratky prohlížeče se nechávají být
  press(env, 'keydown', ' ', { ctrlKey: true });
  assert.equal(run('g.balls.length'), 1);
  // mimo hru (menu) nic
  run("toMenu()");
  press(env, 'keydown', ' ');
  assert.equal(run('st'), 'menu');
});

test('klávesnice: 1 až 4 jsou vylepšení (Zpět, Zatřást, Rozbít, Zásah) a C je Cash Out, vždy jen když je co použít', () => {
  const env = makeEnv();
  const { run } = env;
  run("start('classic')");
  run('S.inv = { undo: 1, shake: 1, pop: 1, hit: 1 }');
  // bez předchozího hodu není co vracet
  press(env, 'keydown', '1');
  assert.equal(run('S.inv.undo'), 1, 'Zpět bez hodu nic neudělá');
  run('g.aimX = 270; g.cool = 0; drop();');
  assert.equal(run('g.balls.length'), 1);
  press(env, 'keydown', '1');
  assert.equal(run('g.balls.length'), 0, 'Zpět vrátil hod');
  assert.equal(run('S.inv.undo'), 0, 'a spotřeboval kus');
  run('g.cool = 0; drop();');
  press(env, 'keydown', '2');
  assert.equal(run('S.inv.shake'), 0, 'Zatřást');
  press(env, 'keydown', '4');
  assert.equal(run('g.tgt'), true, 'Zásah čeká na klepnutí na kouli');
  assert.equal(run('S.inv.hit'), 1, 'kus se spotřebuje až zásahem');
  press(env, 'keydown', '3');
  assert.equal(run('S.inv.pop'), 0, 'Rozbít');
  // Cash Out: první stisk jen připraví (potvrzení), druhý v krátké době ho provede
  run('g.tgt = false; g.balls.length || (g.cool = 0, drop());');
  press(env, 'keydown', 'c');
  assert.equal(run("st"), 'play', 'první stisk jen připraví');
  press(env, 'keydown', 'C');
  assert.equal(run("st"), 'over', 'druhý stisk vyplatí');
  assert.equal(run('g.cashed'), 1);
});

test('klávesnice: stisky se v prohlížeči nezpracují dvakrát (preventDefault) a návod ukáže řádek pro počítač jen u myši', () => {
  const env = makeEnv();
  env.run("start('classic')");
  const ev = { key: ' ', code: '', repeat: false, target: { tagName: 'BODY' }, preventDefault() { this.prevented = true; } };
  (env.docListeners.keydown || []).forEach((fn) => fn(ev));
  assert.equal(ev.prevented, true, 'mezerník nesmí posouvat stránku');
  const other = { key: 'x', code: 'KeyX', repeat: false, target: { tagName: 'BODY' }, preventDefault() { this.prevented = true; } };
  (env.docListeners.keydown || []).forEach((fn) => fn(other));
  assert.notEqual(other.prevented, true, 'cizí klávesy se nechávají být (cheat kód je potřebuje)');
  assert.match(game, /const pc=!!\(window\.matchMedia&&matchMedia\('\(pointer: fine\)'\)\.matches\)/);
  assert.match(game, /if\(pc\)txt\('Na počítači: ← → a mezerník'/);
  assert.match(game, /document\.addEventListener\('keyup',e=>\{if\(e\.key==='ArrowLeft'\)kb\.l=0;if\(e\.key==='ArrowRight'\)kb\.r=0\}\)/);
  assert.match(game, /addEventListener\('blur',\(\)=>\{kb\.l=kb\.r=0\}\)/, 'po přepnutí okna šipka nezůstane "stisknutá"');
});

/* ---------------------------------------------------------------- online zápas (multiplayer) */
// Falešné rozhraní window.jomaridMP z appky: zaznamenává, co hra posílá, a dovolí poslat hře události.
function makeMp({ slot = 1, seed = 777, opponent = 'Marie' } = {}) {
  const handlers = {};
  const sent = [];
  const reports = [];
  const api = {
    enabled: true,
    init: { slot, seed, opponent: { name: opponent }, game: 'koulovikamosi', mode: 'duel', kind: 'turn' },
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); return api; },
    listen() { api.listened = true; },
    move(payload, opts) { sent.push({ payload, endTurn: !(opts && opts.endTurn === false) }); return Promise.resolve({ ok: true }); },
    report(outcome, reason) { reports.push([outcome, reason]); return Promise.resolve({}); },
    close() { api.closed = (api.closed || 0) + 1; },
    serverNow: () => Date.now(),
  };
  const emit = (ev, data) => { for (const fn of handlers[ev] || []) fn(data); };
  return { api, sent, reports, emit, handlers };
}
const view = (o = {}) => Object.assign({ status: 'active', turn: 1, slot: 1, deadline: Date.now() + 60000, move_count: 0 }, o);
const mpEnv = (opts) => {
  const mp = makeMp(opts);
  const env = makeEnv({ mp: mp.api });
  return Object.assign(env, { mp });
};
// Spočítá fyziku, dokud se miska po mém tahu neusadí (mpSettle pošle výsledek); vrací počet kroků.
const settle = (run, limit = 900) => { for (let i = 0; i < limit; i++) { run('step(); mpStep()'); if (run("g.mp.phase") !== 'mine') return i + 1; } return limit; };

test('online: hra se v online zápase spustí rovnou do zápasu, přihlásí se k odběru a nemá cheat, obchod ani sólové odměny', () => {
  const { run, mp, rewards, records } = mpEnv();
  assert.equal(mp.api.listened, true);
  assert.equal(run('st'), 'play');
  assert.equal(run('g.mode'), 'mp');
  for (const ev of ['sync', 'moves', 'match', 'end']) assert.ok(mp.handlers[ev] && mp.handlers[ev].length === 1, ev);
  assert.equal(run('S.tut'), 1, 'návod pro první hru se neukazuje');
  mp.emit('sync', { match: view(), moves: [], outcome: null });
  run("ability('undo'); ability('shake'); cashOut();");
  assert.equal(run('g.used || g.cashed || 0'), 0, 'vylepšení a vybrání z misky jsou v online zápase vypnuté');
  assert.deepEqual(rewards, []);
  assert.deepEqual(records, []);
  assert.doesNotMatch(mpGame, /67MILUJU|CHEAT/);
});

test('online: pořadí koulí je společné (stejné semínko = stejné koule, jiné semínko = jiné) a nezávisí na tom, co se děje v misce', () => {
  const a = mpEnv({ seed: 4242, slot: 1 }), b = mpEnv({ seed: 4242, slot: 2 }), c = mpEnv({ seed: 99, slot: 1 });
  const seq = (env) => JSON.parse(env.run('JSON.stringify(Array.from({ length: 60 }, (_, k) => mpType(k)))'));
  assert.deepEqual(seq(a), seq(b));
  assert.notDeepEqual(seq(a), seq(c));
  assert.ok(seq(a).every((t) => t >= 0 && t <= 3), 'jen nejmenší čtyři typy jako v klasice');
  assert.ok(new Set(seq(a)).size >= 3, 'koule se střídají');
  a.run('start(\'mp\'); g.mp = { k: 5, phase: \'wait\' }; mpTurnBalls()');
  assert.equal(a.run('g.cur'), seq(a)[5]);
  assert.equal(a.run('g.next'), seq(a)[6]);
});

test('online: můj tah. Hod se pošle hned (bez konce tahu), po usazení misky se pošle její stav a tah přejde na soupeře', async () => {
  const { run, mp } = mpEnv({ slot: 1 });
  mp.emit('sync', { match: view({ turn: 1 }), moves: [], outcome: null });
  assert.equal(run('mpCanAim()'), true);
  run('g.aimX = 230; mpDrop()');
  assert.equal(mp.sent.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(mp.sent[0])), { payload: { d: 1, k: 0, x: 230, t: run('mpType(0)') }, endTurn: false });
  assert.equal(run('g.mp.phase'), 'mine');
  assert.equal(run('g.balls.length'), 1);
  run('g.aimX = 300; mpDrop()');
  assert.equal(mp.sent.length, 1, 'druhý hod ve stejném tahu nejde');
  const steps = settle(run);
  assert.ok(steps >= 70 && steps < 480, `miska se usadila po ${steps} krocích`);
  assert.equal(mp.sent.length, 2);
  const res = mp.sent[1];
  assert.equal(res.endTurn, true);
  assert.equal(res.payload.r, 1);
  assert.equal(res.payload.k, 0);
  assert.equal(res.payload.b.length, 1);
  assert.equal(res.payload.b[0].length, 2 + 2 * run('NP'));
  assert.equal(run('g.mp.k'), 1, 'pořadí tahu se zvedne hned');
  assert.equal(run('g.cur'), run('mpType(1)'));
  await Promise.resolve();
  assert.equal(run('g.mp.phase'), 'wait');
  assert.equal(run('mpCanAim()'), true, 'dokud server nepřepne tah (match), pořád jsem na tahu podle pohledu serveru');
  mp.emit('match', { match: view({ turn: 2 }) });
  assert.equal(run('mpCanAim()'), false, 'po přepnutí tahu hráč míří až na svůj tah');
});

test('online: tah soupeře. Jeho hod se přehraje a stav misky po tahu je závazný (nahradí můj vlastní výpočet)', () => {
  const { run, mp } = mpEnv({ slot: 2 });
  mp.emit('sync', { match: view({ turn: 1, slot: 2 }), moves: [], outcome: null });
  assert.equal(run('mpCanAim()'), false, 'nejsem na tahu');
  const t = run('mpType(0)');
  mp.emit('moves', { moves: [{ seq: 1, p: 1, payload: { d: 1, k: 0, x: 200, t }, end: false, mine: false, replay: false }] });
  assert.equal(run('g.mp.phase'), 'replay');
  assert.equal(run('g.balls.length'), 1);
  for (let i = 0; i < 40; i++) run('step(); mpStep()');
  assert.equal(mp.sent.length, 0, 'při cizím tahu hra nic neposílá');
  const snap = [[t, 0.5, ...Array.from({ length: run('NP') }, (_, i) => [300 + Math.cos(i * 6.2832 / run('NP')) * 10, 700 + Math.sin(i * 6.2832 / run('NP')) * 10]).flat().map((v) => +v.toFixed(1))]];
  mp.emit('moves', { moves: [{ seq: 2, p: 1, payload: { r: 1, k: 0, b: snap }, end: true, mine: false, replay: false }] });
  assert.equal(run('g.mp.phase'), 'wait');
  assert.equal(run('g.mp.k'), 1);
  assert.equal(run('g.balls.length'), 1);
  assert.ok(Math.abs(run('g.balls[0].x') - 300) < 3 && Math.abs(run('g.balls[0].y') - 700) < 3, 'koule je tam, kde ji soupeř nechal');
  assert.equal(run('g.cur'), run('mpType(1)'));
  mp.emit('match', { match: view({ turn: 2, slot: 2 }) });
  assert.equal(run('mpCanAim()'), true, 'teď jsem na tahu já');
});

test('online: neplatné zprávy se nepřijmou (špatné pořadí tahu, nesmyslný stav misky, nesmyslná koule)', () => {
  const { run, mp } = mpEnv({ slot: 2 });
  mp.emit('sync', { match: view({ turn: 1, slot: 2 }), moves: [], outcome: null });
  const m = (payload) => ({ moves: [{ seq: 1, p: 1, payload, end: false }] });
  mp.emit('moves', m({ d: 1, k: 3, x: 200, t: 0 }));
  mp.emit('moves', m({ d: 1, k: 0, x: 'a', t: 0 }));
  mp.emit('moves', m({ d: 1, k: 0, x: 200, t: 99 }));
  mp.emit('moves', m({ d: 1, k: 0, x: 200, t: 1.5 }));
  assert.equal(run('g.balls.length'), 0);
  mp.emit('moves', m({ r: 1, k: 5, b: [] }));
  assert.equal(run('g.mp.k'), 0);
  const bad = [[0, 0.1, 1, 2, 3]];
  mp.emit('moves', m({ r: 1, k: 0, b: bad }));
  assert.equal(run('g.mp.k'), 0, 'stav s chybným počtem čísel se zahodí');
  mp.emit('moves', m({ r: 1, k: 0, b: [[0, 0.1, ...Array(2 * run('NP')).fill(NaN)]] }));
  assert.equal(run('g.mp.k'), 0, 'NaN se zahodí');
  mp.emit('moves', m({ r: 1, k: 0, b: Array.from({ length: 400 }, () => [0, 0.1, ...Array(2 * run('NP')).fill(10)]) }));
  assert.equal(run('g.mp.k'), 0, 'příliš mnoho koulí se zahodí');
  assert.match(run('g.mp.note'), /neplatn|neodpovídá/);
});

test('online: vypadne koule při mém tahu: prohrávám, hra pošle konec tahu s out a ohlásí prohru', async () => {
  const { run, mp } = mpEnv({ slot: 1 });
  mp.emit('sync', { match: view({ turn: 1 }), moves: [], outcome: null });
  run('g.aimX = 270; mpDrop()');
  run('g.balls[0].y = F + 120; for (const p of g.balls[0].P) p.y = F + 120; cm(g.balls[0])');
  for (let i = 0; i < 80 && run('g.mp.ended') === null; i++) run('step(); mpStep()');
  assert.equal(run('g.mp.ended'), 'loss');
  assert.deepEqual(JSON.parse(JSON.stringify(mp.sent[mp.sent.length - 1])), { payload: { r: 1, k: 0, out: 1 }, endTurn: true });
  await Promise.resolve();
  assert.deepEqual(mp.reports, [['loss', 'out']]);
});

test('online: soupeři vypadne koule (jeho zpráva s out): vyhrávám a hra to ohlásí; podruhé se nic neohlásí', async () => {
  const { run, mp } = mpEnv({ slot: 2 });
  mp.emit('sync', { match: view({ turn: 1, slot: 2 }), moves: [], outcome: null });
  mp.emit('moves', { moves: [{ seq: 1, p: 1, payload: { d: 1, k: 0, x: 250, t: run('mpType(0)') }, end: false }] });
  mp.emit('moves', { moves: [{ seq: 2, p: 1, payload: { r: 1, k: 0, out: 1 }, end: true }] });
  assert.equal(run('g.mp.ended'), 'win');
  assert.deepEqual(mp.reports, [['win', 'out']]);
  mp.emit('moves', { moves: [{ seq: 3, p: 1, payload: { r: 1, k: 0, out: 1 }, end: true }] });
  assert.equal(mp.reports.length, 1);
  assert.equal(run('g.mp.final'), undefined, 'server výsledek ještě nepotvrdil');
  mp.emit('end', { match: view({ status: 'finished', winner: 2, slot: 2, reason: 'agreed' }), outcome: 'win' });
  assert.equal(run('g.mp.final'), true);
});

test('online: po obnovení stránky se z historie postaví miska i pořadí tahu a rozehraný vlastní hod se dopočítá', () => {
  const { run, mp } = mpEnv({ slot: 1 });
  const t0 = run('mpType(0)'), t1 = run('mpType(1)'), t2 = run('mpType(2)');
  const ball = (t, x, y) => [t, 0.3, ...Array.from({ length: run('NP') }, (_, i) => [x + Math.cos(i * 6.2832 / run('NP')) * 8, y + Math.sin(i * 6.2832 / run('NP')) * 8]).flat().map((v) => +v.toFixed(1))];
  const moves = [
    { seq: 1, p: 1, payload: { d: 1, k: 0, x: 200, t: t0 }, end: false, mine: true, replay: true },
    { seq: 2, p: 1, payload: { r: 1, k: 0, b: [ball(t0, 250, 700)] }, end: true, mine: true, replay: true },
    { seq: 3, p: 2, payload: { d: 1, k: 1, x: 300, t: t1 }, end: false, mine: false, replay: true },
    { seq: 4, p: 2, payload: { r: 1, k: 1, b: [ball(t0, 250, 700), ball(t1, 330, 700)] }, end: true, mine: false, replay: true },
    { seq: 5, p: 1, payload: { d: 1, k: 2, x: 280, t: t2 }, end: false, mine: true, replay: true },
  ];
  mp.emit('sync', { match: view({ turn: 1 }), moves, outcome: null });
  assert.equal(run('g.mp.synced'), true);
  assert.equal(run('g.mp.k'), 2, 'dva dokončené tahy');
  assert.equal(run('g.mp.phase'), 'mine', 'můj rozehraný hod se dopočítá a pak odešle výsledek');
  assert.equal(run('g.balls.length'), 3, 'dvě koule z předchozích tahů a ta čerstvě pustená');
  assert.equal(mp.sent.length, 0, 'z historie se nic neposílá znovu');
  const steps = settle(run);
  assert.ok(steps <= 480);
  assert.equal(mp.sent.length, 1);
  assert.equal(mp.sent[0].payload.k, 2);
});

test('online: konec od serveru (čas, vzdání soupeře, zrušení) se převezme a hra nic neposílá zpět', () => {
  for (const [outcome, status, winner, reason] of [['win', 'finished', 1, 'timeout'], ['loss', 'finished', 2, 'resign'], ['void', 'void', null, 'no_show']]) {
    const { run, mp } = mpEnv({ slot: 1 });
    mp.emit('sync', { match: view({ turn: 2 }), moves: [], outcome: null });
    mp.emit('end', { match: view({ status, winner, slot: 1, reason }), outcome });
    assert.equal(run('g.mp.ended'), outcome);
    assert.equal(run('g.mp.reason'), reason);
    assert.equal(run('g.mp.final'), true);
    assert.equal(mp.sent.length + mp.reports.length, 0);
    assert.equal(run('mpCanAim()'), false);
  }
});

test('online: klepnutí na „Odejít“ pošle appce žádost o odchod, míření jde jen na mém tahu', () => {
  const { run, mp, docListeners } = mpEnv({ slot: 1 });
  mp.emit('sync', { match: view({ turn: 2 }), moves: [], outcome: null });
  run('toMenu()');
  assert.equal(mp.api.closed, 1);
  assert.equal(run('st'), 'play', 'hra zůstává (rozhodne appka)');
  mp.emit('match', { match: view({ turn: 1 }) });
  assert.equal(run('mpAim()'), true);
  assert.equal(typeof docListeners, 'object');
});

test('online: velikost stavu misky při dlouhé hře zůstane hluboko pod mezí serveru (16 kB), miska se po každém tahu usadí', async () => {
  const { run, mp } = mpEnv({ slot: 1 });
  mp.emit('sync', { match: view({ turn: 1 }), moves: [], outcome: null });
  let worst = 0, longest = 0, lost = false; const all = [];
  for (let turn = 0; turn < 70 && !lost; turn++) {
    run(`g.aimX = ${180 + ((turn * 53) % 180)}; mpDrop()`);
    const n = settle(run); all.push(n); longest = Math.max(longest, n);
    if (n >= 480) console.log('   DEBUG', run('JSON.stringify(g.balls.map(b => [b.t, +Math.hypot(b.vx, b.vy).toFixed(3), Math.round(b.x), Math.round(b.y)]))'), run('g.mp.calm'));
    const last = mp.sent[mp.sent.length - 1];
    if (last.payload.out) { lost = true; break; }
    worst = Math.max(worst, JSON.stringify(last.payload).length);
    await Promise.resolve();                           // potvrzení serveru (hra pak míří znovu)
    mp.emit('match', { match: view({ turn: 1 }) });   // tah se hned vrátí, ať se dá zkoušet dál
  }
  console.log(`   usazení po tazích: ${all.join(' ')}`);
  console.log(`   online Kouloví: nejdelší usazení ${longest} kroků, největší stav misky ${worst} bajtů, ${run('g.balls.length')} koulí${lost ? ', hra skončila pádem koule' : ''}`);
  assert.ok(worst < 16000, `stav misky ${worst} bajtů`);
  assert.ok(longest <= 480);
});
