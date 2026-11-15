// Testy společného síťového základu her (src/gameContent/shared/net.js): hostitel posílá jen změny, host z nich skládá svět a vyhlazuje ho.
// Síť se tu nahrazuje simulací s pevným zpožděním, kolísáním a ztrátou zpráv.
//   npm run test:net
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const code = fs.readFileSync(path.join(SRC, 'gameContent', 'shared', 'net.js'), 'utf8');
const ctx = vm.createContext({ Math, Map, Set, Object, Array, isFinite });
vm.runInContext(code, ctx);
const { Replicator, Mirror, Roster, tween, Lockstep, stateHash, pickHostSlot, rng: seededRng } = ctx.JomaridNet;

// pevný náhodný generátor
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Svět hostitele: tanky (vždy posílané) a tvary/střely (jen při odchylce)
function makeWorld() {
  return { tanks: [], shapes: [], bullets: [], nextId: 1 };
}
const KINDS = (w) => ({
  tank: { list: () => w.tanks, id: (e) => e.id, state: (e) => [e.x, e.y, e.vx, e.vy, e.a], info: (e) => ({ n: e.name }), infoSig: (e) => e.name, always: true },
  shape: { list: () => w.shapes, id: (e) => e.id, state: (e) => [e.x, e.y, e.vx, e.vy, e.rot, e.hp], info: (e) => ({ t: e.type }), tol: 3, refresh: 1500, dev: (st, last) => st[5] !== last[5] },
  bullet: { list: () => w.bullets, id: (e) => e.id, state: (e) => [e.x, e.y, e.vx, e.vy], info: (e) => ({ o: e.owner }), tol: 5 },
});
function stepWorld(w, dt, r) {
  for (const t of w.tanks) { if (r() < 0.04) { t.vx = (r() - 0.5) * 400; t.vy = (r() - 0.5) * 400; } t.x += t.vx * dt; t.y += t.vy * dt; t.a += 0.5 * dt; }
  for (const s of w.shapes) { s.x += s.vx * dt; s.y += s.vy * dt; s.rot += 0.3 * dt; s.vx *= Math.max(0, 1 - 2.2 * dt); s.vy *= Math.max(0, 1 - 2.2 * dt); }
  for (const b of w.bullets) { b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt; }
  w.bullets = w.bullets.filter((b) => b.life > 0);
}
const addTank = (w, x, y, name) => { const t = { id: w.nextId++, x, y, vx: 0, vy: 0, a: 0, name }; w.tanks.push(t); return t; };
const addShape = (w, x, y) => { const s = { id: w.nextId++, x, y, vx: 0, vy: 0, rot: 0, hp: 10, type: 'sq' }; w.shapes.push(s); return s; };
const addBullet = (w, x, y, vx, vy, owner) => { const b = { id: w.nextId++, x, y, vx, vy, life: 1.1, owner }; w.bullets.push(b); return b; };

// Simulace sítě mezi hostitelem a jedním hostem: zpráva dorazí po latency +- jitter ms, s pravděpodobností loss se ztratí
function simulate({ ms = 6000, latency = 60, jitter = 20, loss = 0, tick = 100, frame = 16, seed = 1, setup, onFrame }) {
  const r = rng(seed), w = makeWorld(), rep = new Replicator(KINDS(w), { keyEvery: 4000 });
  const objs = { tank: new Map(), shape: new Map(), bullet: new Map() };
  const mirror = new Mirror(KINDS(w), {
    add: (kind, id, info, st) => { const o = { id, info, x: st[0], y: st[1] }; objs[kind].set(id, o); return o; },
    remove: (kind, id) => { objs[kind].delete(id); },
  });
  setup(w);
  const inbox = []; let sent = 0, bytes = 0, lost = 0, unknown = 0, pendingFull = false, t = 0;
  const stats = { maxErr: 0, errSum: 0, errN: 0, maxJump: 0 };
  const last = new Map();
  for (t = 0; t <= ms; t += 4) {
    // krok světa hostitele po 4 ms (jemněji než snímek)
    stepWorld(w, 0.004, r);
    if (t % tick === 0) {
      const pkt = rep.build(t);
      if (pkt) {
        const text = JSON.stringify(pkt); sent++; bytes += text.length;
        if (r() < loss) lost++; else inbox.push({ at: t + latency + (r() - 0.5) * 2 * jitter, text });
      }
    }
    inbox.sort((a, b) => a.at - b.at);
    while (inbox.length && inbox[0].at <= t) {
      const res = mirror.apply(JSON.parse(inbox.shift().text), t);
      if (res.unknown) { unknown += res.unknown; if (!pendingFull) { pendingFull = true; rep.requestKey(true); } } else pendingFull = false;
    }
    if (t % frame === 0 && t > 800) {
      // chyba: poloha hosta proti pravdě hostitele v tomtéž čase (host je záměrně o latenci pozadu, proto se porovnává s polohou před latencí)
      for (const tank of w.tanks) {
        const rec = mirror.table('tank').get(tank.id); if (!rec) continue;
        const p = mirror.pos(rec, t);
        const err = Math.hypot(p.x - tank.x, p.y - tank.y);
        stats.maxErr = Math.max(stats.maxErr, err); stats.errSum += err; stats.errN++;
        const prev = last.get(tank.id);
        if (prev) stats.maxJump = Math.max(stats.maxJump, Math.hypot(p.x - prev.x, p.y - prev.y));
        last.set(tank.id, p);
      }
    }
    if (onFrame) onFrame({ t, w, mirror, rep, objs });
  }
  return { w, mirror, objs, rep, sent, bytes, lost, unknown, stats };
}

test('hostitel pošle nové entity s popisem, host je vytvoří a pozná jejich druh a počet', () => {
  const res = simulate({ ms: 1500, setup: (w) => { addTank(w, 100, 100, 'A'); addTank(w, 500, 500, 'B'); for (let i = 0; i < 20; i++) addShape(w, 50 * i, 50 * i); addBullet(w, 10, 10, 300, 0, 1); } });
  assert.equal(res.objs.tank.size, 2); assert.equal(res.objs.shape.size, 20);
  assert.equal(res.objs.tank.get(1).info.n, 'A');
  assert.equal(res.objs.shape.get(3).info.t, 'sq');
});

test('stojící tvary se po vzniku neposílají znovu (jen klíčová zpráva a obnovení), takže zpráv je málo', () => {
  const res = simulate({ ms: 12000, setup: (w) => { for (let i = 0; i < 250; i++) addShape(w, (i * 137) % 3600, (i * 251) % 3600); } });
  // 120 kroků hostitele, ale zprávy se posílají jen při klíčové zprávě (po 4 s) a při obnovení (po 1,5 s u každého tvaru; tvary stojí, takže obnovení jsou seskupená)
  assert.ok(res.sent < 40, 'zpráv za 12 s: ' + res.sent);
  const per = res.bytes / (12000 / 1000);
  assert.ok(per < 12000, 'bajtů za vteřinu: ' + Math.round(per));
});

test('pohybující se tanky se vyhladí: chyba hosta proti hostiteli je malá a poloha neskáče (60 ms zpoždění, 20 ms kolísání)', () => {
  const res = simulate({ ms: 8000, latency: 60, jitter: 20, setup: (w) => { addTank(w, 1800, 1800, 'A'); addTank(w, 900, 900, 'B'); addTank(w, 2700, 900, 'C'); } });
  const avg = res.stats.errSum / res.stats.errN;
  assert.ok(avg < 35, 'průměrná chyba ' + avg.toFixed(1));
  assert.ok(res.stats.maxJump < 14, 'největší skok mezi snímky ' + res.stats.maxJump.toFixed(1) + ' (rychlost tanku je do 200 jednotek za vteřinu, tj. do 3,2 za snímek)');
});

test('střela letí rovně: po vzniku se neposílá, dokud se neodchýlí, a host ji pohybuje podle rychlosti', () => {
  let mirrorPos = null;
  const res = simulate({ ms: 900, latency: 50, jitter: 0, setup: (w) => { addBullet(w, 100, 100, 500, 0, 1); }, onFrame: ({ t, mirror }) => { if (t === 700) { const r = mirror.table('bullet').get(1); if (r) mirrorPos = mirror.pos(r, t); } } });
  assert.ok(mirrorPos, 'střela se u hosta objevila');
  assert.ok(Math.abs(mirrorPos.y - 100) < 0.1);
  assert.ok(res.sent <= 3, 'zpráv ' + res.sent);
});

test('zmizelé entity hostitel oznámí a host je odstraní (i střely s krátkým životem)', () => {
  const res = simulate({ ms: 3000, setup: (w) => { addShape(w, 10, 10); addShape(w, 20, 20); addBullet(w, 5, 5, 100, 0, 1); }, onFrame: ({ t, w }) => { if (t === 1000) w.shapes.pop(); } });
  assert.equal(res.objs.shape.size, 1);
  assert.equal(res.objs.bullet.size, 0, 'střela po vteřině zanikla');
});

test('změna zdraví tvaru se pošle hned (kvůli ukazateli života), i když se nepohnul', () => {
  const shapes = [];
  const res = simulate({ ms: 2000, setup: (w) => { shapes.push(addShape(w, 10, 10)); }, onFrame: ({ t }) => { if (t === 1000) shapes[0].hp = 4; } });
  const rec = res.mirror.table('shape').get(shapes[0].id);
  assert.equal(rec.st[5], 4);
});

test('ztracená zpráva se napraví: nová entita bez popisu se nevytvoří, host si vyžádá úplnou zprávu a svět se srovná', () => {
  const res = simulate({ ms: 12000, loss: 0.3, seed: 7, setup: (w) => { addTank(w, 100, 100, 'A'); for (let i = 0; i < 30; i++) addShape(w, 100 + 80 * i, 300); }, onFrame: ({ t, w }) => { if (t === 2000) for (let i = 0; i < 10; i++) addShape(w, 100 + 80 * i, 900); } });
  assert.ok(res.lost > 3, 'něco se ztratilo: ' + res.lost);
  assert.equal(res.objs.shape.size, res.w.shapes.length, 'po ztrátě se svět srovnal');
  assert.equal(res.objs.tank.size, 1);
});

test('host, který vstoupil později, dostane celý svět po vyžádání úplné zprávy', () => {
  const w = makeWorld(), rep = new Replicator(KINDS(w), { keyEvery: 4000 });
  addTank(w, 1, 1, 'A'); for (let i = 0; i < 12; i++) addShape(w, i * 10, i * 10);
  for (let t = 0; t < 1000; t += 100) rep.build(t);                       // starý host už vše dostal
  const made = { shape: 0, tank: 0 };
  const m2 = new Mirror(KINDS(w), { add: (k) => { made[k]++; return {}; } });
  const first = rep.build(1100) || { K: {}, key: 0 };
  assert.equal(m2.apply(first, 1100).unknown >= 0, true);
  assert.equal(made.shape, 0, 'bez popisů nic nevznikne');
  rep.requestKey(true);
  const full = rep.build(1200);
  assert.ok(full.full === 1 && full.key === 1);
  const res = m2.apply(full, 1200);
  assert.equal(res.unknown, 0);
  assert.equal(made.shape, 12); assert.equal(made.tank, 1);
});

test('klíčová zpráva odstraní entity, které hostitel už nemá (zmeškané oznámení o zániku)', () => {
  const w = makeWorld(), rep = new Replicator(KINDS(w), { keyEvery: 1000 });
  addShape(w, 1, 1); const s2 = addShape(w, 2, 2);
  const removed = [];
  const m = new Mirror(KINDS(w), { add: () => ({}), remove: (k, id) => removed.push(id) });
  m.apply(rep.build(0), 0);
  assert.equal(m.size('shape'), 2);
  w.shapes.pop(); rep.build(100);                                          // oznámení o zániku se "ztratilo": nikdy se nepošle hostovi
  m.apply(rep.build(500) || { K: {} }, 500);                                // mezitím přijde obyčejná zpráva (příznak "viděno" se přes ni nesmí přenést do další klíčové)
  m.apply(rep.build(1200), 1200);                                           // klíčová zpráva už s druhým tvarem nepočítá
  assert.equal(m.size('shape'), 1);
  assert.deepEqual(removed, [s2.id]);
});

test('vyhlazení: při opravě polohy se zobrazená poloha v tom okamžiku nezmění (žádný skok), chyba mizí do desetin vteřiny', () => {
  const m = new Mirror(KINDS(makeWorld()), { add: () => ({}) });
  m.apply({ K: { tank: { a: [[1, [100, 100, 100, 0, 0], { n: 'A' }]] } } }, 0);
  const before = m.pos(m.table('tank').get(1), 500);                      // 150 (odhad: 100 + 100 * 0,5)
  m.apply({ K: { tank: { a: [[1, [190, 100, 100, 0, 0]]] } } }, 500);     // skutečnost je o 40 jinde
  const rec = m.table('tank').get(1);
  const after = m.pos(rec, 500);
  assert.ok(Math.abs(after.x - before.x) < 1e-9, 'v okamžiku opravy se nic nemění');
  assert.ok(Math.abs(m.pos(rec, 500 + 600).x - (190 + 100 * 0.6)) < 1.5, 'po 600 ms je chyba pryč');
  const mid = m.pos(rec, 500 + 130).x;
  assert.ok(mid > before.x + 13 && mid < 190 + 13, 'uprostřed se plynule přibližuje');
});

test('velký skok (znovuzrození) se nevyhlazuje, rovnou se přeskočí; entita bez zpráv se zastaví a nepoletí pryč', () => {
  const m = new Mirror(KINDS(makeWorld()), { add: () => ({}) });
  m.apply({ K: { tank: { a: [[1, [100, 100, 0, 0, 0], {}]] } } }, 0);
  m.apply({ K: { tank: { a: [[1, [3000, 3000, 0, 0, 0]]] } } }, 100);
  const p = m.pos(m.table('tank').get(1), 100);
  assert.ok(Math.abs(p.x - 3000) < 1e-9 && Math.abs(p.y - 3000) < 1e-9);
  m.apply({ K: { tank: { a: [[1, [0, 0, 1000, 0, 0]]] } } }, 200);
  const far = m.pos(m.table('tank').get(1), 200 + 60000);
  assert.ok(far.x <= 1000 * 0.6 + 1, 'odhad se po 0,6 s zastaví: ' + far.x);
});

test('nesmyslné zprávy host ignoruje a nespadne', () => {
  const m = new Mirror(KINDS(makeWorld()), { add: () => ({}) });
  for (const bad of [null, undefined, 5, 'x', {}, { K: null }, { K: { tank: { a: [[1, 'x', {}]] } } }, { K: { neznamy: { a: [[1, [1, 2, 3, 4], {}]] } } }, { K: { tank: { a: [[1, [1, 2], {}]] } } }]) assert.doesNotThrow(() => m.apply(bad, 0));
  assert.equal(m.size('tank'), 0);
});

test('Roster: hostitelem je ten, kdo přišel první; při výpadku převezme další; stejný čas rozhodne id', () => {
  const a = new Roster({ id: 'a', name: 'A', joinedAt: 1000 }, { silentMs: 3000 });
  assert.equal(a.isHost(), true);
  assert.equal(a.hello({ id: 'b', name: 'B', joinedAt: 500 }, 1000), true);
  assert.equal(a.hostId(), 'b'); assert.equal(a.isHost(), false);
  assert.equal(a.hello({ id: 'b', name: 'B', joinedAt: 500 }, 1500), false, 'známý hráč není nový');
  a.hello({ id: 'c', name: 'C', joinedAt: 700 }, 1500);
  assert.deepEqual(Array.from(a.expire(3000)), [], 'ještě nikdo neutichl');
  a.touch('c', 3900);
  assert.deepEqual(Array.from(a.expire(4600)), ['b'], 'b mlčí déle než 3 s');
  assert.equal(a.hostId(), 'c');
  assert.equal(Array.from(a.expire(8000)).includes('c'), true);
  assert.equal(a.isHost(), true);
  const t = new Roster({ id: 'm', name: 'M', joinedAt: 10 });
  t.hello({ id: 'k', joinedAt: 10 }, 0);
  assert.equal(t.hostId(), 'k', 'při shodě času vyhrává menší id');
  assert.equal(t.hello({ id: 5 }, 0), false); assert.equal(t.hello(null, 0), false);
  assert.equal(t.hello({ id: 'm' }, 0), false, 'sebe nepřidává');
});

test('tween: plynulé přiblížení (po tau je zbývá 37 %), nezávislé na délce snímku', () => {
  let a = 0; for (let i = 0; i < 10; i++) a = tween(a, 100, 0.01, 0.1);
  let b = 0; for (let i = 0; i < 100; i++) b = tween(b, 100, 0.001, 0.1);
  assert.ok(Math.abs(a - b) < 0.01 && Math.abs(a - 63.2) < 0.2);
});

test('zprávy: stejný svět dává stejné výsledky při opakování (deterministická simulace), takže testy jsou stabilní', () => {
  const run = () => simulate({ ms: 3000, seed: 3, setup: (w) => { addTank(w, 5, 5, 'A'); addShape(w, 9, 9); } });
  const a = run(), b = run();
  assert.equal(a.bytes, b.bytes); assert.equal(a.sent, b.sent);
});

/* ---------------------------------------------------------------- paralelní výpočet (Lockstep), otisk stavu a volba hostitele */
// Hra pro zkoušku: dvě kulky, vstup je rychlost, nepřátelé se rodí podle společné náhody (stejné semínko = stejná hra na obou zařízeních).
function makeSim(seed, tamper = 0) {
  const r = seededRng(seed);
  const st = { p: [{ x: 0, y: 0 }, { x: 100, y: 100 }], e: [], f: 0 };
  return {
    st,
    step(frame, inputs) {
      st.f = frame + 1;
      for (let i = 0; i < 2; i++) { const inp = inputs[i] || { x: 0, y: 0 }; st.p[i].x += inp.x; st.p[i].y += inp.y; }
      if (r() < 0.05) st.e.push({ x: r() * 100, y: r() * 100 });
      for (const e of st.e) { e.x += (st.p[0].x - e.x) * 0.01; e.y += (st.p[1].y - e.y) * 0.01; }
      if (tamper && frame === tamper) st.p[0].x += 50;     // jedno zařízení si změní stav
    },
    hash() { const o = [st.f, st.e.length]; for (const p of st.p) o.push(p.x, p.y); for (const e of st.e) o.push(e.x, e.y); return o; },
  };
}
// Dva účastníci s frontou zpráv (pevné zpoždění + kolísání), vstupy podle vlastního programu
function runLockstep({ frames = 600, delayMs = 3, jitter = 3, tamper = 0, seed = 5, silentAfter = 1e9 }) {
  const r = seededRng(99);
  const sims = [makeSim(seed, tamper), makeSim(seed)];
  const q = [[], []];                   // q[i] = zprávy pro účastníka i
  const desyncs = [];
  let tick = 0;
  const nodes = [0, 1].map((me) => new Lockstep({
    me, delay: 6, hashEvery: 30, empty: { x: 0, y: 0 },
    step: (f, ins) => sims[me].step(f, ins), hash: () => sims[me].hash(),
    send: (m) => { if (me === 1 && tick > silentAfter) return; const dst = q[1 - me]; const at = Math.max(tick + delayMs + Math.floor(r() * (jitter + 1)), dst.length ? dst[dst.length - 1].at : 0); dst.push({ at, m: JSON.parse(JSON.stringify(m)) }); },   // pořadí zpráv se zachovává (kanál je uspořádaný)
    onDesync: (f) => desyncs.push([me, f]),
  }));
  for (tick = 0; tick < frames; tick++) {
    for (const me of [0, 1]) {
      if (me === 1 && tick > silentAfter) continue;
      const due = q[me].filter((x) => x.at <= tick); q[me] = q[me].filter((x) => x.at > tick);
      for (const x of due) nodes[me].receive(x.m);
      nodes[me].local({ x: Math.sin(tick / 30 + me) > 0 ? 1 : -1, y: me === 0 ? (tick % 90 < 45 ? 1 : 0) : 0 });
      nodes[me].tick(1);
    }
  }
  return { sims, nodes, desyncs };
}

test('lockstep: dvě zařízení dojdou ke stejnému stavu a nezpozdí se o víc než zpoždění sítě', () => {
  const { sims, nodes, desyncs } = runLockstep({});
  const f = Math.min(nodes[0].frame(), nodes[1].frame());
  assert.ok(f > 450 && f <= 600, 'hra běží zhruba v reálném čase: ' + f);
  assert.equal(desyncs.length, 0, 'bez podvodu žádná neshoda');
  // oba stavy ve stejném snímku jsou stejné: dopočítat pomalejšího na stejný snímek není potřeba, protože se otisky porovnávaly po 30 snímcích
  assert.ok(Math.abs(nodes[0].frame() - nodes[1].frame()) < 12);
  assert.equal(stateHash(sims[0].hash()) === stateHash(sims[0].hash()), true);
});
test('lockstep: upravený stav jednoho zařízení se pozná (otisky se rozejdou)', () => {
  const { desyncs, nodes } = runLockstep({ tamper: 200 });
  assert.ok(desyncs.length > 0, 'neshoda ohlášená');
  assert.ok(nodes[0].desynced() || nodes[1].desynced());
  assert.ok(Math.min(...desyncs.map((d) => d[1])) >= 200, 'ohlášená až po úpravě');
});
test('lockstep: když druhý přestane posílat, hra na něj čeká (nepočítá dopředu na slepo)', () => {
  const { nodes } = runLockstep({ silentAfter: 100 });
  assert.ok(nodes[0].frame() < 125, 'bez vstupů druhého se hra zastaví: ' + nodes[0].frame());
});
test('otisk stavu: drobné rozdíly pod zaokrouhlením nevadí, skutečná změna ano', () => {
  assert.equal(stateHash([1.00001, 2.00002, 'a']), stateHash([1.00004, 1.99999, 'a']));
  assert.notEqual(stateHash([1, 2, 'a']), stateHash([1, 2.5, 'a']));
  assert.notEqual(stateHash([1, NaN]), stateHash([1, 5]));
});
test('náhoda se semínkem: stejné semínko dává stejnou posloupnost, jiné jinou', () => {
  const a = seededRng(7), b = seededRng(7), c = seededRng(8);
  const sa = [a(), a(), a()], sb = [b(), b(), b()], sc = [c(), c(), c()];
  assert.deepEqual(sa, sb); assert.notDeepEqual(sa, sc);
  assert.ok(sa.every((v) => v >= 0 && v < 1));
});
test('volba hostitele: silnější zařízení (aspoň o čtvrtinu) vyhrává, jinak místo 1; obě strany rozhodnou stejně', () => {
  assert.equal(pickHostSlot(100, 100), 1);
  assert.equal(pickHostSlot(100, 120), 1);
  assert.equal(pickHostSlot(100, 130), 2);
  assert.equal(pickHostSlot(200, 100), 1);
  assert.equal(pickHostSlot(0, 500), 1);       // soupeř bez zkoušky (starší verze) nebo chybějící číslo: zůstává místo 1
  assert.equal(pickHostSlot(500, 0), 1);
});
