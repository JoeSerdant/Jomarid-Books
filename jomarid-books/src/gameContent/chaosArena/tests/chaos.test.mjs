// Testy simulace Chaos Arény (sim.js): vlny a bossové, třídy, oživování, výhra a prohra, omezení polohy hosta, události pro hosta.
//   npm run test:chaos
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
function load(seed = 1) {
  const ctx = vm.createContext({ Math });
  vm.runInContext(fs.readFileSync(path.join(DIR, 'sim.js'), 'utf8'), ctx, { filename: 'sim.js' });
  const ev = (expr) => vm.runInContext(expr, ctx);
  let s = seed | 0;
  ctx.__rng = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  ev('setRandom(__rng)');
  return ev;
}
// Hráč, který míří na nejbližšího nepřítele a střílí; druhý chodí kolem
function bots(ev) {
  ev(`(function () {
    P.forEach((p, i) => {
      if (p.down) { INP[i].f = 0; INP[i].x = 0; INP[i].y = 0; return; }
      let t = null, bd = 1e9;
      for (const e of E) { const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < bd) { bd = d; t = e; } }
      INP[i].f = 1;
      if (t) { const d = Math.hypot(t.x - p.x, t.y - p.y) || 1; INP[i].aim = [(t.x - p.x) / d, (t.y - p.y) / d]; INP[i].x = d < 260 ? -(t.x - p.x) / d : 0; INP[i].y = d < 260 ? -(t.y - p.y) / d : 0; }
      else { INP[i].aim = null; INP[i].x = 0; INP[i].y = 0; }
    });
  })()`);
}
const J = (ev, expr) => JSON.parse(ev(`JSON.stringify(${expr})`));

test('začátek: dva hráči podle třídy a obtížnosti, první vlna, aréna podle druhu', () => {
  const ev = load();
  ev("simStart({ diff: 'easy', classes: [3, 0], arena: 2 })");
  assert.equal(ev('P.length'), 2);
  assert.equal(ev('P[0].cl.k'), 'tank'); assert.equal(ev('P[1].cl.k'), 'gun');
  assert.equal(ev('P[0].hp'), 5 + 2, 'lehká: 5 životů + 2 tankovi');
  assert.equal(ev('P[1].hp'), 5);
  assert.equal(ev('wave'), 1); assert.equal(ev('state'), 'play');
  assert.ok(ev('Tr.length') > 0, 'aréna s pastmi má pasti');
  ev("simStart({ diff: 'hard', classes: [4, 2], arena: 3 })");
  assert.equal(ev('P[1].hp'), 2, 'těžká: 2 životy');
  assert.ok(ev('Ob.some((o) => o.m)'), 'aréna s pohyblivými zdmi je má');
  ev("simStart({ diff: 'nesmysl', classes: [99, -4], arena: 9 })");
  assert.equal(ev('P[0].cl.k'), 'rkt', 'neznámá třída se ořízne'); assert.equal(ev('P[1].cl.k'), 'gun');
  assert.equal(ev('AK'), 1); assert.equal(ev('diff'), 1);
});

test('hra běží: vlny postupují, bossové přijdou ve třetí vlně, nic nezmizí do NaN a počty zůstanou rozumné', () => {
  const ev = load(7);
  ev("simStart({ diff: 'easy', classes: [0, 3], arena: 1 })");
  let sawBoss = false, maxE = 0, maxBu = 0;
  for (let i = 0; i < 60 * 240 && ev('state') === 'play'; i++) {
    bots(ev); ev('update(1 / 60)');
    if (i % 30 === 0) {
      if (ev('E.some((e) => e.boss)')) sawBoss = true;
      maxE = Math.max(maxE, ev('E.length')); maxBu = Math.max(maxBu, ev('Bu.length'));
      assert.ok(ev('P.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 16 && p.x <= WW - 16)'), 'hráči zůstávají ve světě');
      assert.ok(ev('E.every((e) => Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.hp))'), 'nepřátelé mají čísla');
    }
  }
  assert.ok(ev('wave') >= 3, 'za čtyři minuty se dostali aspoň do třetí vlny (je ' + ev('wave') + ')');
  assert.ok(sawBoss || ev('wave') < 3, 've třetí vlně byl boss');
  assert.ok(ev('teamKills') > 20, 'bylo zabito dost nepřátel');
  assert.ok(maxE < 140 && maxBu < 120, `rozumné počty (nepřátel ${maxE}, střel ${maxBu})`);
  assert.ok(ev('P[0].score + P[1].score') > 0);
});

test('bossové jsou ve vlnách 3, 6 a 9 a mají víc životů s vlnou', () => {
  const ev = load(3);
  for (const w of [3, 6, 9]) {
    ev("simStart({ diff: 'normal', classes: [0, 1] })");
    ev(`wave = ${w - 1}; nextWave()`);
    assert.equal(ev('wave'), w); assert.equal(ev('bossDone'), false);
    ev('update(0.016)');
    assert.equal(ev('E.filter((e) => e.boss).length'), 1, `vlna ${w}: jeden boss`);
    assert.equal(ev('E.find((e) => e.boss).hp'), 30 + w * 6);
  }
  ev("simStart({ diff: 'normal', classes: [0, 1] })"); ev('wave = 3; nextWave()');
  assert.equal(ev('bossDone'), true, 'vlna 4 boss nemá');
});

test('výhra: po pobití poslední vlny (devátá) hra skončí výhrou, jinak jde další vlna', () => {
  const ev = load(5);
  ev("simStart({ diff: 'normal', classes: [0, 1] })");
  ev('wave = 4; toSpawn = 0; bossDone = true; E = []'); ev('update(0.016)');
  assert.equal(ev('wave'), 5); assert.equal(ev('state'), 'play');
  ev('wave = 9; toSpawn = 0; bossDone = true; E = []'); ev('update(0.016)');
  assert.equal(ev('state'), 'won');
});

test('prohra: když padnou oba hráči', () => {
  const ev = load(6);
  ev("simStart({ diff: 'normal', classes: [0, 1] })");
  ev('P[0].down = 1; P[0].hp = 0'); ev('update(0.016)'); assert.equal(ev('state'), 'play');
  ev('P[1].down = 1; P[1].hp = 0'); ev('update(0.016)'); assert.equal(ev('state'), 'over');
});

test('oživování: živý hráč poblíž padlého ho za 1,2 s oživí (healer dvakrát rychleji), s dvěma životy', () => {
  const ev = load(8);
  for (const [cls, secs] of [[0, 1.3], [2, 0.7]]) {
    ev(`simStart({ diff: 'easy', classes: [${cls}, 1] })`);
    ev('E = []; toSpawn = 99; spawnT = 1e9; bossDone = true');   // vlna běží dál, nikdo nepřichází (dokončená vlna by padlého oživila sama)
    ev('P[1].down = 1; P[1].hp = 0');
    ev('P[0].x = 400; P[0].y = 400; P[1].x = 420; P[1].y = 400');
    for (let i = 0; i < Math.round(secs * 60); i++) { ev('E = []; update(1 / 60)'); }
    assert.equal(ev('P[1].down'), 0, `třída ${cls}: oživen`);
    assert.equal(ev('P[1].hp'), 2); assert.equal(ev('P[0].revives'), 1);
  }
  ev("simStart({ diff: 'easy', classes: [0, 1] })"); ev('E = []; toSpawn = 99; spawnT = 1e9; bossDone = true');
  ev('P[1].down = 1; P[1].hp = 0; P[0].x = 400; P[0].y = 400; P[1].x = 700; P[1].y = 700');
  for (let i = 0; i < 180; i++) ev('E = []; update(1 / 60)');
  assert.equal(ev('P[1].down'), 1, 'daleko od sebe se neoživí');
});

test('třídy: tank odhazuje a zraňuje dotykem, EMP ochromí v okruhu, raketa vybuchne a zraní, healer léčí parťáka', () => {
  let ev = load(9);
  ev("simStart({ diff: 'normal', classes: [3, 0] })"); ev('E = []; toSpawn = 0; spawnT = 99; bossDone = true');
  ev('P[0].x = 600; P[0].y = 600; P[1].x = 1400; P[1].y = 900; E.push({ k: "blob", r: 17, hp: 2, mhp: 2, sp: 0, c: "#fff", pts: 10, x: 612, y: 600, hit: 0, vx: 0, vy: 0, tid: 0, side: 1, ph: 0, cyc: 9 })');
  ev('toSpawn = 99; spawnT = 1e9');
  for (let i = 0; i < 12; i++) ev('update(1 / 60)');
  assert.ok(ev('E[0].hp') <= 1, 'tank dotykem nepřítele zranil');
  assert.ok(Math.hypot(ev('E[0].x') - ev('P[0].x'), ev('E[0].y') - ev('P[0].y')) > 30, 'a odhodil ho');
  ev = load(10);
  ev("simStart({ diff: 'normal', classes: [1, 0] })"); ev('E = []; toSpawn = 0; spawnT = 99; bossDone = true');
  ev('P[0].x = 600; P[0].y = 600; E.push({ k: "tank", r: 24, hp: 9, mhp: 9, sp: 0, c: "#fff", pts: 30, x: 700, y: 600, hit: 0, vx: 0, vy: 0, tid: 0, side: 1, ph: 0, cyc: 9 })');
  ev('INP[0].f = 1; INP[0].aim = [1, 0]; update(1 / 60)');
  assert.ok(ev('E[0].stun') > 1 && ev('E[0].hp') <= 7, 'EMP ochromilo a zranilo (2)');
  ev = load(11);
  ev("simStart({ diff: 'normal', classes: [4, 0] })"); ev('E = []; toSpawn = 0; spawnT = 99; bossDone = true');
  ev('P[0].x = 600; P[0].y = 600; E.push({ k: "blob", r: 17, hp: 40, mhp: 40, sp: 0, c: "#fff", pts: 10, x: 800, y: 600, hit: 0, vx: 0, vy: 0, tid: 0, side: 1, ph: 0, cyc: 9 })');
  ev('INP[0].f = 1; INP[0].aim = [1, 0]; toSpawn = 99; spawnT = 1e9');
  for (let i = 0; i < 120; i++) ev('update(1 / 60)');
  assert.ok(ev('E.length === 0 || E[0].hp < 40'), 'raketa zasáhla');
  ev = load(12);
  ev("simStart({ diff: 'normal', classes: [2, 0] })"); ev('E = []; toSpawn = 99; spawnT = 1e9; bossDone = true');
  ev('P[0].x = 600; P[0].y = 600; P[1].x = 700; P[1].y = 600; P[1].hp = 1; P[0].hc = 0');
  ev('update(1 / 60)');
  assert.equal(ev('P[1].hp'), 2, 'healer pulzem vyléčil parťáka');
});

test('poloha hosta: omezí se rychlostí (nejde létat), mimo svět a skály se opraví, padlý se nehýbe', () => {
  const ev = load(13);
  ev("simStart({ diff: 'normal', classes: [0, 0] })"); ev('Ob = []');
  ev('P[1].x = 500; P[1].y = 500; setRemote(1, 1500, 500, 100, 0, 0.05)');
  assert.ok(ev('P[1].x') > 500 && ev('P[1].x') < 700, 'skok o tisíc pixelů se zkrátí (je ' + ev('P[1].x') + ')');
  ev('P[1].x = 500; setRemote(1, 520, 500, 100, 0, 0.05)');
  assert.equal(ev('P[1].x'), 520, 'pohyb v mezích projde celý');
  ev('P[1].x = 30; setRemote(1, -500, 500, 0, 0, 0.5)'); assert.ok(ev('P[1].x') >= 16);
  ev('Ob = [{ x: 600, y: 500, r: 40 }]; P[1].x = 540; P[1].y = 500; setRemote(1, 590, 500, 0, 0, 0.5)');
  assert.ok(Math.hypot(ev('P[1].x') - 600, ev('P[1].y') - 500) >= 40 + 16 - 0.5, 'skála hráče vytlačí');
  ev('P[1].down = 1; P[1].x = 100; setRemote(1, 300, 500, 0, 0, 0.5)'); assert.equal(ev('P[1].x'), 100, 'padlý se nehýbe');
});

test('události pro hosta: hostitel si efekty ukládá (EVQ), bez EVQ nic; fronta je omezená', () => {
  const ev = load(14);
  ev("simStart({ diff: 'normal', classes: [0, 1] })");
  ev('EVQ = []; INP[0].f = 1; INP[0].aim = [1, 0]; P[0].cd = 0; update(1 / 60)');
  const q = J(ev, 'EVQ');
  assert.ok(q.some((e) => e[0] === 'z'), 'výstřel má zvuk');
  ev('EVQ = null; update(1 / 60)');
  ev('EVQ = []; for (let i = 0; i < 200; i++) burst(10, 10, "#fff", 1)');
  assert.ok(ev('EVQ.length') <= 60, 'fronta událostí je omezená');
  ev('EVQ = []; floatText(5, 6, "+10", "#f00"); ring(1, 2, 30, 0.3, "#0f0"); shk(8)');
  assert.deepEqual(J(ev, 'EVQ').map((e) => e[0]), ['t', 'r', 's']);
});

test('pomoc s mířením: vybere nepřítele v kuželu před hráčem, jiné ne', () => {
  const ev = load(15);
  ev("simStart({ diff: 'normal', classes: [0, 1] })"); ev('E = []');
  ev('P[0].x = 500; P[0].y = 500; P[0].ax = 1; P[0].ay = 0');
  ev('E.push({ x: 800, y: 505, r: 17, vx: 0, vy: 0 }, { x: 500, y: 900, r: 17, vx: 0, vy: 0 })');
  assert.equal(ev('aimTarget(P[0]).y'), 505);
  ev('E = [{ x: 500, y: 900, r: 17, vx: 0, vy: 0 }]'); assert.equal(ev('aimTarget(P[0])'), null);
});

test('simulace je čistá: nic nekreslí a nesahá na DOM ani čas', () => {
  const src = fs.readFileSync(path.join(DIR, 'sim.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//, '');
  assert.doesNotMatch(src, /document\.|window\.|performance\.|requestAnimationFrame|localStorage|ctx\./);
});
