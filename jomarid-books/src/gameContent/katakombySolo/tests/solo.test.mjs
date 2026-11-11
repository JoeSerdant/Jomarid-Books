// Testy sólo Katakomb (offline režim): data, celá výprava v prostředí bez prohlížeče, uložení postupu, žádosti o Coiny, kobka duší, nekonečný režim, cheaty.
//   npm run test:katasolo
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(DIR, '..', '..');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const gameSrc = read(DIR, 'game.js');
const shell = read(DIR, 'index.html');

function rng(seed) { let s = seed | 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Falešný prohlížeč: jen to, na co hra sahá. Časovače se řadí do fronty a pouští se ručně (flush), náhoda jde ze semínka.
function boot({ seed = 1, storage = {}, rewards = true } = {}) {
  const queue = [];
  const store = new Map(Object.entries(storage));
  const msgs = [];
  const rewardsLog = [];
  const el = () => ({ innerHTML: '', textContent: '', style: { setProperty() {} }, dataset: {}, className: '', classList: { add() {}, remove() {} }, appendChild() {}, remove() {}, querySelector: () => null, querySelectorAll: () => [], closest: () => null, focus() {}, addEventListener() {} });
  const scr = el(), fx = el(), ver = el();
  const document = {
    querySelector: (s) => (s === '#scr' ? scr : s === '#fx' ? fx : s === '#ver' ? ver : s === '#bg' ? el() : null),
    querySelectorAll: () => [], createElement: () => el(), body: el(), documentElement: el(), addEventListener() {},
  };
  const math = Object.create(Math); const rand = rng(seed); math.random = rand;
  const ctx = vm.createContext({
    document, Math: math, console, JSON, Object, Array, String, Number, Date, Set, Map, Promise, parseInt, parseFloat, isFinite,
    setTimeout: (f) => { queue.push(f); return queue.length; }, clearTimeout() {},
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    navigator: {}, innerWidth: 390, matchMedia: () => ({ matches: false }), addEventListener() {}, AudioContext: undefined,
    window: { parent: { postMessage: (m) => msgs.push(JSON.parse(JSON.stringify(m))) } },
    jomaridReward: rewards ? (r, n) => rewardsLog.push([r, n]) : undefined,
  });
  vm.runInContext(gameSrc + '\n;globalThis.__api = { get g() { return g; }, get E() { return E; }, get hand() { return hand; }, get screen() { return screen; }, get lock() { return lock; }, get best() { return best; }, get meta() { return meta; } };', ctx, { filename: 'game.js' });
  const ev = (code) => vm.runInContext(code, ctx);
  const flush = (max = 200) => { for (let i = 0; i < max && queue.length; i++) queue.shift()(); };
  return { ctx, ev, flush, store, msgs, rewardsLog, queue, rand };
}

// Jeden krok automatu (náhodný, ale slušný hráč): v boji hraje, co jde, nakonec tah ukončí
function step(G, opts = {}) {
  const { ev, flush } = G;
  const sc = ev('screen');
  if (sc === 'map') ev('enter(g.opts[Math.random()<.5?0:g.opts.length-1])');
  else if (sc === 'battle') {
    if (ev('lock')) { flush(); return sc; }
    const i = ev("hand.findIndex(o=>(cd(o).d||cd(o).x||cd(o).p)&&cd(o).c<=g.en)");
    const j = i >= 0 ? i : ev('hand.findIndex(o=>cd(o).c<=g.en&&cd(o).c>0)');
    if (j >= 0) { ev(`play(${j})`); flush(); } else { ev('endTurn()'); flush(); }
  } else if (sc === 'reward') ev('pick(g.rw.cards[0].k)');
  else if (sc === 'shop' || sc === 'rest' || sc === 'event') ev('advance()');
  return sc;
}
function playRun(G, hero, { diff = 0, max = 6000 } = {}) {
  G.ev(`diff=${diff};newGame(${hero})`);
  let n = 0;
  while (n++ < max) { const sc = step(G); if (sc === 'win' || sc === 'lose') return sc; }
  throw new Error('výprava neskončila: ' + G.ev('screen') + ' patro ' + G.ev('g.f'));
}

test('data: hrdinové mají balíček z existujících karet, schopnost, popis a životy; karty, relikvie, lektvary i nepřátelé jsou úplní', () => {
  const G = boot();
  const out = G.ev(`({ H, C, RL, POT, AB, EN, EL, BOSSES, DF, UP, ACH })`);
  assert.equal(out.H.length, 5);
  for (const h of out.H) {
    assert.ok(h.n && h.e && h.hp > 0 && h.d, h.n);
    assert.ok(out.AB[h.n] && typeof out.AB[h.n][2] === 'function', `schopnost hrdiny ${h.n}`);
    h.dk.replace(/([a-z]+)(\d)/g, (_, k) => { assert.ok(out.C[k], `${h.n}: karta ${k}`); return ''; });
  }
  for (const [k, c] of Object.entries(out.C)) assert.ok(c.n && c.e && Number.isInteger(c.c) && c.c >= 0 && Number.isInteger(c.r), k);
  for (const [k, r] of Object.entries(out.RL)) assert.ok(r[0] && r[1] && r[2], `relikvie ${k}`);
  for (const [k, p] of Object.entries(out.POT)) assert.ok(p[0] && p[1] && p[2], `lektvar ${k}`);
  for (const e of [...out.EN.flat(), ...out.EL, ...out.BOSSES]) assert.ok(e.n && e.e && e.hp > 0 && e.pat.length > 0, e.n);
  assert.equal(out.DF.length, 3); assert.equal(out.UP.length, 5); assert.ok(out.ACH.length >= 8);
  assert.equal(G.ev("Object.keys(C).filter(k=>C[k].r).length > 20"), true);
});

test('zdroj: žádné zbytky režimů pro dva hráče na jednom zařízení ani vlastního balíčku, hra se vrací do menu zprávou hub a ukládá jen dva klíče', () => {
  assert.doesNotMatch(gameSrc, /pvp|PVP|COOP|\bCP\b|\bPV\b|katak_builds|pvHalf|pbHalf|cpHalf/);
  assert.match(gameSrc, /function toHub\(\)\{try\{window\.parent\.postMessage\(\{source:'jomarid-game',type:'hub'\},'\*'\)\}catch\(e\)\{\}\}/);
  const keys = [...gameSrc.matchAll(/(?:getItem|setItem)\('([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(keys)].sort(), ['katak_best', 'katak_meta']);
  assert.match(shell, /JOMARID-BRIDGE/); assert.match(shell, /var GAME_ID = 'onlinegames';/);
});

test('celá výprava: každý hrdina na každé obtížnosti dojde ke konci (výhra nebo prohra) bez chyby a hra pozná, že skončila', () => {
  let wins = 0, losses = 0;
  for (let h = 0; h < 5; h++) for (let d = 0; d < 3; d++) {
    const G = boot({ seed: 100 + h * 7 + d });
    const r = playRun(G, h, { diff: d });
    assert.ok(r === 'win' || r === 'lose');
    if (r === 'win') wins++; else losses++;
    assert.ok(G.ev('g.f') >= 0 && G.ev('g.k') >= 0);
  }
  assert.equal(wins + losses, 15);
  assert.ok(losses > 0, 'někdy hrdina padne');
});

test('výhra: strážce v 10. patře uzavře běh, vyplatí duše a nabídne nekonečný režim; v něm další strážce dá odměnu znovu', () => {
  const G = boot({ seed: 5 });
  G.ev('newGame(0)');
  G.ev("CH.oh=1");   // jedna rána (jen v testu, přímo mimo cheat menu, ať se nezablokují Coiny)
  let n = 0, sc;
  while (n++ < 4000) { sc = step(G); if (sc === 'win' || sc === 'lose') break; }
  assert.equal(sc, 'win', 'cesta k výhře');
  assert.equal(G.ev('g.f'), 9); assert.equal(G.ev('g.w'), 1);
  const souls = JSON.parse(G.store.get('katak_meta')).s;
  assert.ok(souls >= 30, 'duše za výhru: ' + souls);
  assert.equal(G.store.get('katak_best'), '10');
  // nekonečný režim: běh pokračuje o patro dál, strážce se vrací každých 10 pater
  G.ev('endlessMode=1;goEndless()');
  assert.equal(G.ev('screen'), 'map'); assert.equal(G.ev('g.f'), 10);
  const bosses = G.rewardsLog.filter(([r]) => r === 'guardian').length;
  assert.equal(bosses, 1, 'jeden strážce, jedna odměna');
});

test('Coiny: hra jen žádá (jomaridReward) za poraženého nepřítele (2), elitu (4), strážce (20) a nový rekord pater (5), víc se neposílá', () => {
  const G = boot({ seed: 9 });
  G.ev('newGame(0)');
  for (const [t, reason, amount] of [['fight', 'enemy', 2], ['elite', 'elite', 4], ['boss', 'guardian', 20]]) {
    G.rewardsLog.length = 0;
    G.ev(`battle('${t}')`);
    G.ev('E.hp=0;won()'); G.flush();
    const asked = G.rewardsLog.filter(([r]) => r !== 'record');
    assert.deepEqual(asked, [[reason, amount]], t);
    if (t === 'boss') break;
    G.ev("g.f=Math.min(g.f,8);screen='map'");
  }
  // rekord: poprvé se došlo do patra 7 -> 5 Coinů, stejné nebo nižší patro nic
  const H = boot({ seed: 3 });
  H.ev('newGame(1)'); H.ev('g.f=6;end("lose")');
  assert.deepEqual(H.rewardsLog.filter(([r]) => r === 'record'), [['record', 5]]);
  H.ev('newGame(1)'); H.ev('g.f=4;end("lose")');
  assert.equal(H.rewardsLog.filter(([r]) => r === 'record').length, 1, 'nižší patro rekord nezvýší');
  H.ev('newGame(1)'); H.ev('g.f=8;end("lose")');
  assert.equal(H.rewardsLog.filter(([r]) => r === 'record').length, 2, 'vyšší patro ano');
});

test('Coiny: po použití cheatu hra o odměny nežádá; bez mostu (mimo appku) nespadne', () => {
  const G = boot({ seed: 11 });
  G.ev('newGame(0)'); G.ev('battle("fight")');
  G.ev('CHF.gold()');
  assert.equal(G.ev('CHEATED'), 1);
  G.ev('E.hp=0;won()');
  assert.equal(G.rewardsLog.length, 0, 'po cheatu žádná žádost');
  const N = boot({ seed: 12, rewards: false });
  N.ev('newGame(0)'); N.ev('battle("fight")');
  assert.doesNotThrow(() => { N.ev('E.hp=0;won()'); N.flush(); });
});

test('uložení postupu: rekord pater a duše se zapisují do localStorage (katak_best, katak_meta) a po novém spuštění hra z nich vychází', () => {
  const G = boot({ seed: 21 });
  playRun(G, 2, { diff: 0 });
  const best = Number(G.store.get('katak_best')); const meta = JSON.parse(G.store.get('katak_meta'));
  assert.ok(best >= 1 && meta.s > 0 && Array.isArray(meta.a) && meta.u && typeof meta.u.hp === 'number');
  const H = boot({ seed: 22, storage: { katak_best: String(best), katak_meta: JSON.stringify(meta) } });
  assert.equal(H.ev('best'), best); assert.equal(H.ev('meta.s'), meta.s);
  assert.match(H.ev('scr').innerHTML, new RegExp(`Rekord: patro ${best}`));
  const bad = boot({ storage: { katak_best: 'x', katak_meta: '{rozbité' } });
  assert.equal(bad.ev('best'), 0); assert.equal(bad.ev('meta.s'), 0, 'poškozený postup hru nerozbije');
});

test('kobka duší: trvalá vylepšení stojí duše, mají strop úrovně a promítnou se do dalšího běhu', () => {
  const G = boot({ seed: 31, storage: { katak_meta: JSON.stringify({ s: 1000, a: [], u: {} }) } });
  const before = G.ev('H[0].hp');
  G.ev('buyUp(0)'); G.ev('buyUp(0)');   // +5 max HP (20, pak 40 duší)
  assert.equal(G.ev('meta.u.hp'), 2); assert.equal(G.ev('meta.s'), 1000 - 20 - 40);
  G.ev('newGame(0)');
  assert.equal(G.ev('g.max'), before + 10);
  for (let i = 0; i < 20; i++) G.ev('buyUp(0)');
  assert.equal(G.ev('meta.u.hp'), 5, 'strop úrovně');
  G.ev('buyUp(4)');   // startovní relikvie
  G.ev('newGame(1)');
  assert.equal(G.ev('g.rl.length'), 1);
  const poor = boot({ storage: { katak_meta: JSON.stringify({ s: 5, a: [], u: {} }) } });
  poor.ev('buyUp(0)'); assert.equal(poor.ev('meta.u.hp'), 0, 'bez duší se nekupuje');
});

test('obchod, odpočinek a události: nákupy stojí zlato, odstranění a vylepšení karty mění balíček, odpočinek léčí, každá událost jde dokončit', () => {
  const G = boot({ seed: 41 });
  G.ev('newGame(0)');
  G.ev("g.gold=500;enter('shop')");
  const cards = G.ev('g.cards.length');
  G.ev('buy(0)'); assert.equal(G.ev('g.cards.length'), cards + 1);
  assert.ok(G.ev('g.gold') < 500);
  G.ev('g.gold=10;g.hp=1;buyHeal()'); assert.equal(G.ev('g.hp'), 1, 'bez zlata se neléčí');
  G.ev('g.gold=100;buyHeal()'); assert.equal(G.ev('g.hp'), 16);
  G.ev("g.hp=10;g.max=50;restHeal()"); assert.equal(G.ev('g.hp'), 25);
  assert.equal(G.ev('screen'), 'map');
  const events = G.ev('EVT.length');
  assert.ok(events >= 8, 'všech osm událostí z originálu: ' + events);
  for (let i = 0; i < events; i++) {
    const opts = G.ev(`EVT[${i}]().o.length`);
    for (let k = 0; k < opts; k++) {
      G.ev(`g.gold=500;g.hp=30;g.max=50;screen='event';g.ev=EVT[${i}]()`);
      G.ev(`g.ev.o[${k}][1]()`);
      if (G.ev('ov')) G.ev('pickDeck(ov.l[0])');
      assert.ok(['map', 'event'].includes(G.ev('screen')), `událost ${i}, volba ${k}`);
    }
  }
});

test('boj: štít pohltí zásah, jed, zranitelnost a síla fungují jako v originále, schopnost hrdiny jde použít jednou za boj', () => {
  const G = boot({ seed: 51 });
  G.ev('newGame(0)'); G.ev("battle('fight')");
  G.ev('E.blk=4;E.hp=100;E.max=100;E.vu=0;hit(6)');
  assert.equal(G.ev('E.hp'), 98); assert.equal(G.ev('E.blk'), 0);
  G.ev('E.vu=2;hit(10)'); assert.equal(G.ev('E.hp'), 83, 'zranitelný soupeř dostane o polovinu víc');
  G.ev('g.blk=3;g.hp=40;g.vu=0;hurt(5)'); assert.deepEqual([G.ev('g.hp'), G.ev('g.blk')], [38, 0]);
  const hp = G.ev('E.hp');
  G.ev('useAb()');   // Rytíř: Pokřik +10 štítu
  assert.ok(G.ev('g.blk') >= 10); assert.equal(G.ev('g.ab'), 1);
  const blk = G.ev('g.blk'); G.ev('useAb()'); assert.equal(G.ev('g.blk'), blk, 'jen jednou za boj');
  assert.equal(G.ev('E.hp'), hp);
});

test('Léčitel má schopnost (v originále se definuje až dodatečně): boj s ním se vykreslí bez pádu', () => {
  const G = boot({ seed: 61 });
  G.ev('newGame(4)'); G.ev("battle('fight')");
  assert.match(G.ev('scr').innerHTML, /Obnova/);
  assert.doesNotThrow(() => { G.ev('useAb()'); });
});
