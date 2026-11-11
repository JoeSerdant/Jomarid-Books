/* sim.js - simulace Chaos Arény (hlavní herní pravidla): vlny nepřátel, bossové, třídy hráčů, střely, power-upy, pasti a pohyblivé zdi.
   Bez DOM a bez kreslení. Počítá ji vždy jen hostitel zápasu (hráč na místě 1), host dostává obraz světa (mp.js). Hráči jsou dva: P[0] hostitel, P[1] host.
   Vstupy hráčů jsou v INP[i] ({x, y, f, aim}); poloha hráče, kterého řídí druhý prohlížeč (REMOTE[i]), se do simulace nastavuje zvenku (setRemote).
   Efekty (částice, kruhy, texty, otřes, zvuky) jdou přes funkce níže; hostitel si je navíc ukládá do EVQ a posílá hostovi, ať je uvidí taky.
   Náhoda: R() (v zkouškách jde nahradit pevnou posloupností přes setRandom). */
const WW = 1800, WH = 1200;                          // velikost světa
const COLS = ['#ff4d6d', '#4dd2ff'];                 // barvy hráčů (místo 1, místo 2)
const TAU = 6.2832;
const WIN_WAVE = 9;                                  // výhra: přežít devět vln (každá třetí je boss) a pobít poslední
// modifikátory kol
const MODS = [{ n: 'Klid před bouří' }, { n: 'Rychlí nepřátelé!', es: 1.4 }, { n: 'Dvojité body!', sc: 2 }, { n: 'Kluzký led!', ice: 1 }, { n: 'Obří nepřátelé!', big: 1.5 }];
// obtížnosti: ph = životy hráče, es = rychlost nepřátel, eh = životy nepřátel, cnt = počet nepřátel, sr = rychlost spawnu, drop = šance na power-up, as = pomoc s mířením (rad)
const DIFFS = [
  { name: 'Lehká', col: '#69db7c', ph: 5, es: 0.8, eh: 0.7, cnt: 0.75, sr: 0.8, drop: 0.2, as: 0.7 },
  { name: 'Normální', col: '#ffd43b', ph: 3, es: 1, eh: 1, cnt: 1, sr: 1, drop: 0.12, as: 0.5 },
  { name: 'Těžká', col: '#ff6b81', ph: 2, es: 1.2, eh: 1.5, cnt: 1.35, sr: 1.3, drop: 0.09, as: 0.3 },
];
const DIFF_INDEX = { easy: 0, normal: 1, hard: 2 };
// TŘÍDY HRÁČE: k = typ, cd = pauza mezi výstřely, sp = rychlost, hp = bonus životů, bs = rychlost střely
const CLS = [
  { k: 'gun', n: 'Střelec', cd: 0.16, sp: 262, hp: 0, bs: 720, d: 'Rychlá palba, přesné navádění' },
  { k: 'emp', n: 'EMP', cd: 1.1, sp: 250, hp: 0, bs: 520, d: 'Výboj kolem sebe ochromí nepřátele' },
  { k: 'heal', n: 'Healer', cd: 0.3, sp: 255, hp: 0, bs: 640, d: 'Léčí parťáka pulzem a oživuje dvakrát rychleji' },
  { k: 'tank', n: 'Tank', cd: 0.5, sp: 205, hp: 2, bs: 620, d: 'Víc životů, brokovnice a dotyk zraňuje' },
  { k: 'rkt', n: 'Raketomet', cd: 1.3, sp: 235, hp: 0, bs: 360, d: 'Navedené rakety s výbuchem' },
];

let P = [], E = [], Bu = [], Pu = [], Pa = [], Ob = [], Tx = [], Rg = [], EB = [], Tr = [];
let wave = 0, modI = 0, mod = MODS[0], toSpawn = 0, spawnT = 0, bossDone = true, banner = 0, shake = 0, teamKills = 0, combo = 0, comboT = 0, gt = 0, AK = 1, diff = 1;
let state = 'idle';                                  // idle | play | won | over
let ASSIST = 1;                                      // síla pomoci s mířením (násobek DIFFS[].as)
const INP = [{ x: 0, y: 0, f: 0, aim: null }, { x: 0, y: 0, f: 0, aim: null }];
const REMOTE = [false, false];                       // hráče řídí jiný prohlížeč: pohyb se nepočítá, poloha přichází zvenku
let EVQ = null;                                      // události pro hosta (nastavuje hostitel), jinak null
let NID = 0;
let RNG = Math.random;
function setRandom(fn) { RNG = fn; }
function R() { return RNG(); }
const rnd = (a, b) => a + R() * (b - a);
const nid = (o) => o._id || (o._id = ++NID);
const r1 = (v) => Math.round(v * 10) / 10;

// ===== EFEKTY =====
let audioBeep = function () {};                      // zvuk dodá mp.js (Web Audio); v zkouškách nic
function beep(f, d, t, v, sl) { if (EVQ && EVQ.length < 60) EVQ.push(['z', Math.round(f), d, t, v, sl || 0]); audioBeep(f, d, t, v, sl); }
function burst(x, y, c, n, s = 200) {
  if (EVQ && EVQ.length < 60) EVQ.push(['b', r1(x), r1(y), c, n, s]);
  for (let i = 0; i < n; i++) { const a = rnd(0, 6.28), v = rnd(0.2, 1) * s; Pa.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(0.3, 0.7), c, s: rnd(2, 5) }); }
}
function ring(x, y, r, life, c) { if (EVQ && EVQ.length < 60) EVQ.push(['r', r1(x), r1(y), r, life, c]); Rg.push({ x, y, r, life, c }); }
function floatText(x, y, t, c) { if (EVQ && EVQ.length < 60) EVQ.push(['t', r1(x), r1(y), t, c]); Tx.push({ x, y, t, c, life: 0.8 }); }
function shk(v) { shake = Math.max(shake, v); if (EVQ && EVQ.length < 60) EVQ.push(['s', v]); }

// ===== ZAČÁTEK HRY =====
// o: { diff: 'easy' | 'normal' | 'hard', classes: [třída hráče 1, třída hráče 2], arena: 1 klasika, 2 pasti, 3 pohyblivé zdi }
function simStart(o) {
  diff = DIFF_INDEX[o && o.diff] === undefined ? 1 : DIFF_INDEX[o.diff];
  AK = o && o.arena >= 1 && o.arena <= 3 ? o.arena : 1;
  const cl = (o && o.classes) || [0, 1];
  gt = 0; combo = 0; comboT = 0; Tx = []; Rg = []; EB = []; Tr = []; E = []; Bu = []; Pu = []; Pa = []; Ob = []; wave = 0; shake = 0; teamKills = 0;
  for (let i = 0; i < 14; i++) {
    const r = { x: 80 + R() * (WW - 160), y: 80 + R() * (WH - 160), r: 28 + R() * 32 };
    if (Math.hypot(r.x - WW / 2, r.y - WH / 2) > 220) Ob.push(r);          // náhodná mapa
  }
  P = [];
  for (let i = 0; i < 2; i++) {
    const c = CLS[Math.max(0, Math.min(CLS.length - 1, cl[i] | 0))];
    P.push({ x: WW / 2 + (i - 0.5) * 70, y: WH / 2, vx: 0, vy: 0, ax: 1, ay: 0, cl: c, hp: DIFFS[diff].ph + c.hp, mhp: DIFFS[diff].ph + c.hp, down: 0, rev: 0, inv: 0, cd: 0,
      rapid: 0, shield: 0, score: 0, kills: 0, downs: 0, revives: 0 });
  }
  setupArena(); nextWave(); state = 'play';
  beep(500, 0.2, 'triangle', 0.06, 400);
}
function nextWave() {
  wave++; modI = wave === 1 ? 0 : 1 + Math.floor(R() * (MODS.length - 1)); mod = MODS[modI];
  toSpawn = Math.round((5 + wave * 3) * DIFFS[diff].cnt); spawnT = 1; bossDone = wave % 3 !== 0; banner = 2.8;
  if (wave > 1) P.forEach(p => { if (p.down) { p.down = 0; p.hp = 2; p.inv = 2; } else p.hp = Math.min(p.mhp, p.hp + 1); });   // odměna za vlnu
  if (!bossDone) banner = 3.5;
}

// ===== NEPŘÁTELÉ =====
function spawnE(boss) {
  let x, y, tries = 0;
  do { x = rnd(40, WW - 40); y = rnd(40, WH - 40); } while (P.some(p => Math.hypot(p.x - x, p.y - y) < 450) && tries++ < 20);
  const r = R(), big = mod.big || 1, D = DIFFS[diff];
  let e;
  if (boss) e = { k: 'boss', r: 44, hp: 30 + wave * 6, sp: 70, c: '#b197fc', pts: 100, boss: 1 };
  else if (r < 0.2 + wave * 0.01) e = { k: 'fast', r: 13, hp: 1, sp: 165, c: '#ffa94d', pts: 15 };
  else if (r < 0.35 + wave * 0.015) e = { k: 'tank', r: 24, hp: 5 + wave * 0.5 | 0, sp: 60, c: '#e64980', pts: 30 };
  else if (wave >= 2 && r < 0.52) e = { k: 'shoot', r: 15, hp: 2, sp: 85, c: '#8ce99a', pts: 25 };   // střelec: drží odstup a pálí
  else if (wave >= 3 && r < 0.65) e = { k: 'split', r: 23, hp: 3, sp: 75, c: '#e599f7', pts: 30 };   // dělící se: po smrti 2 malí
  else e = { k: 'blob', r: 17, hp: 2, sp: 95, c: '#74c0fc', pts: 10 };
  e.r *= big; e.hp = Math.max(1, Math.round(e.hp * big * D.eh)); e.sp *= (mod.es || 1) / (big > 1 ? 1.3 : 1); e.mhp = e.hp; e.tid = Math.floor(R() * 4); e.side = R() < 0.5 ? -1 : 1;
  e.ph = rnd(0, 6.28); e.cyc = rnd(2, 4); e.vx = 0; e.vy = 0; e.x = x; e.y = y; e.hit = 0; E.push(e);
}
// Každý nepřítel má svého "lovce" (rozdělí se mezi hráče), ale blízkého hráče napadne vždy.
function pickTarget(e) {
  let n = null, bd = 1e9;
  for (const p of P) { if (p.down) continue; const d = Math.hypot(p.x - e.x, p.y - e.y); if (d < bd) { bd = d; n = p; } }
  if (!n || bd < 200) return n;
  const h = P[e.tid % P.length];
  return h && !h.down ? h : n;
}
function steer(e, tg, dx, dy, d, dt) {
  const D = DIFFS[diff], k = e.k;
  e.t = (e.t || 0) + dt; e.dx = dx / d; e.dy = dy / d;
  if (e.stun > 0) { e.vx *= 0.85; e.vy *= 0.85; return; }   // ochromený EMP
  let nx = dx / d, ny = dy / d, sp = e.sp * D.es;
  if (k === 'blob') { const a = e.side * Math.min(0.9, d / 450), c = Math.cos(a), s = Math.sin(a); [nx, ny] = [nx * c - ny * s, nx * s + ny * c]; }   // obkličuje hráče
  if (k === 'shoot') {
    const ux = nx, uy = ny;
    if (d < 260) { nx = -ux; ny = -uy; } else if (d < 340) { [nx, ny] = [-uy * e.side, ux * e.side]; }   // couvá a krouží kolem hráče
    e.fcd = (e.fcd === undefined ? rnd(1, 2) : e.fcd) - dt;
    if (e.fcd <= 0 && d < 560) { e.fcd = 2.4; EB.push({ x: e.x, y: e.y, vx: ux * 250, vy: uy * 250, life: 3.2 }); beep(260, 0.08, 'square', 0.025, -100); }
  }
  if (k === 'tank' && e.hp <= e.mhp / 2) sp *= 1.6;                                                  // naštvaný tank zrychlí
  if (k === 'fast' || k === 'boss') {                                                                // varování -> výpad
    if (e.lunge > 0) { e.lunge -= dt; nx = e.lx; ny = e.ly; sp *= k === 'boss' ? 4.5 : 3.4; }
    else if (e.windup > 0) {
      e.windup -= dt; sp = 0; e.lx = dx / d; e.ly = dy / d;
      if (e.windup <= 0) { e.lunge = k === 'boss' ? 0.6 : 0.35; if (k === 'boss') shk(12); beep(120, 0.2, 'sawtooth', 0.05, 200); }
    } else {
      e.cyc -= dt;
      if (k === 'fast') { const w = Math.sin(e.t * 6 + e.ph) * 0.9; [nx, ny] = [nx - ny * w, ny + nx * w]; }   // rychlík kličkuje
      if (e.cyc <= 0 && d < (k === 'boss' ? 600 : 380)) { e.windup = k === 'boss' ? 0.8 : 0.45; e.cyc = k === 'boss' ? rnd(3.5, 5) : rnd(2.5, 4); }
    }
  }
  // odpuzování od ostatních nepřátel (netvoří jednu hromadu)
  let sx = 0, sy = 0;
  for (const o of E) { if (o === e) continue; const ox = e.x - o.x, oy = e.y - o.y, od = Math.hypot(ox, oy), m = e.r + o.r + 16; if (od < m && od > 0) { sx += ox / od * (m - od) / m; sy += oy / od * (m - od) / m; } }
  // obcházení překážek (kloužou kolem nich místo zaseknutí)
  let ax = 0, ay = 0;
  for (const b of Ob) {
    const ox = e.x - b.x, oy = e.y - b.y, od = Math.hypot(ox, oy), m = b.r + e.r + 60;
    if (od < m && od > 0) { const f = (m - od) / m; let tx = -oy / od, ty = ox / od; if (tx * nx + ty * ny < 0) { tx = -tx; ty = -ty; } ax += ox / od * f * 0.6 + tx * f * 1.5; ay += oy / od * f * 0.6 + ty * f * 1.5; }
  }
  const wx = nx * sp + sx * 110 + ax * sp, wy = ny * sp + sy * 110 + ay * sp, sm = Math.min(1, dt * (e.lunge > 0 ? 18 : 6));
  e.vx += (wx - e.vx) * sm; e.vy += (wy - e.vy) * sm;
}

// ===== POMOC S MÍŘENÍM =====
// Vybere nejlepšího nepřítele v kuželu před hráčem (blízký a skoro v ose má přednost; kužel roste podle velikosti cíle).
function aimTarget(p) {
  const cone = DIFFS[diff].as * ASSIST;
  if (cone <= 0) return null;
  const a = Math.atan2(p.ay, p.ax);
  let b = null, bs = 1e9;
  for (const e of E) {
    const ex = e.x - p.x, ey = e.y - p.y, d = Math.hypot(ex, ey);
    if (d > 560 || d < 1) continue;
    const g = Math.atan2(ey, ex), df = Math.abs(Math.atan2(Math.sin(g - a), Math.cos(g - a)));
    if (df > cone + e.r / d) continue;
    const sc = d * (1 + df * 3);
    if (sc < bs) { bs = sc; b = e; }
  }
  return b;
}
// Předpokládaná pozice cíle v okamžiku zásahu (střela letí 720 px/s)
function lead(p, e) { const t = Math.hypot(e.x - p.x, e.y - p.y) / (p.cl.bs || 720); return { x: e.x + (e.vx || 0) * t, y: e.y + (e.vy || 0) * t }; }

// ===== STŘELBA PODLE TŘÍDY =====
function fire(p, i, a) {
  const k = p.cl.k, v = p.cl.bs;
  const B = (ang, o) => Bu.push(Object.assign({ x: p.x, y: p.y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, life: 0.9, o: i, c: COLS[i], dmg: 1 }, o));
  if (k === 'gun') { B(a); beep(rnd(620, 760), 0.06, 'square', 0.025, -300); }
  else if (k === 'emp') { explode({ x: p.x, y: p.y, aoe: 150, dmg: 2, stun: 1.5, o: i, c: '#7df9ff' }); }   // EMP: plošný výboj + ochromí
  else if (k === 'heal') { B(a, { c: '#9dffb0' }); beep(900, 0.05, 'triangle', 0.02); }
  else if (k === 'tank') { for (let j = -1; j <= 1; j++) B(a + j * 0.22, { life: 0.35 }); beep(160, 0.1, 'sawtooth', 0.04, -60); }   // brokovnice na blízko
  else { B(a, { aoe: 80, dmg: 4, homing: 1, life: 2.6, rk: 1, c: '#ff922b' }); beep(120, 0.25, 'sawtooth', 0.05, 300); }   // navedená raketa
}
function hit(e, d, o) { e.hp -= d; e.hit = 0.1; if (o !== undefined) e.by = o; }
// Navedení rakety: pomalu zatočí k nejbližšímu nepříteli
function home(b, dt) {
  let t = null, bd = 640;
  for (const e of E) { const d = Math.hypot(e.x - b.x, e.y - b.y); if (d < bd) { bd = d; t = e; } }
  if (t) {
    const sp = Math.hypot(b.vx, b.vy), cur = Math.atan2(b.vy, b.vx), df = Math.atan2(Math.sin(Math.atan2(t.y - b.y, t.x - b.x) - cur), Math.cos(Math.atan2(t.y - b.y, t.x - b.x) - cur));
    const na = cur + Math.max(-3 * dt, Math.min(3 * dt, df));
    b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;
  }
  Pa.push({ x: b.x, y: b.y, vx: rnd(-30, 30), vy: rnd(-30, 30), life: 0.35, c: '#ffa94d', s: 3 });
}
function explode(b) {
  burst(b.x, b.y, b.c, b.rk ? 30 : 20, 380); ring(b.x, b.y, b.aoe, 0.3, b.c); shk(b.rk ? 10 : 5); beep(b.rk ? 90 : 400, 0.3, 'sawtooth', 0.07, -40);
  for (const e of E) if (e.hp > 0 && Math.hypot(e.x - b.x, e.y - b.y) < b.aoe + e.r) { hit(e, b.dmg || 1, b.o); if (b.stun) e.stun = b.stun; }
}
function hurtP(tg) {
  if (tg.inv > 0 || tg.down) return;
  if (tg.shield) { tg.shield = 0; tg.inv = 1; beep(300, 0.2, 'sine', 0.08); return; }
  tg.hp--; combo = 0; tg.inv = 1.1; shk(14); beep(140, 0.25, 'sawtooth', 0.08, -80); burst(tg.x, tg.y, COLS[P.indexOf(tg)], 20);
  if (tg.hp <= 0) { tg.down = 1; tg.downs++; tg.rev = 0; burst(tg.x, tg.y, '#fff', 40, 350); }
}
// Smrt nepřátel: body (kombo), drop, dělení. Funguje pro všechny zdroje poškození (střely, výbuchy, bomba, tank).
function reap() {
  E.slice().forEach(e => {
    if (e.hp > 0 || e.dead) return;
    e.dead = 1;
    const p = P[e.by];
    if (p) { const cm = 1 + Math.min(4, Math.floor(combo / 5)), gain = e.pts * (mod.sc || 1) * cm; p.score += gain; p.kills++; combo++; comboT = 3; floatText(e.x, e.y, '+' + gain, COLS[e.by]); }
    teamKills++; burst(e.x, e.y, e.c, e.boss ? 80 : 16, e.boss ? 600 : 300); shk(e.boss ? 25 : 4); beep(rnd(150, 250), 0.12, 'sawtooth', 0.05, -80);
    if (R() < (e.boss ? 1 : DIFFS[diff].drop)) addPow(e.x, e.y);
    if (e.k === 'split') for (let j = 0; j < 2; j++) E.push({ k: 'mini', r: 10, hp: 1, mhp: 1, sp: 150, c: e.c, pts: 5, x: e.x + rnd(-18, 18), y: e.y + rnd(-18, 18), hit: 0, vx: 0, vy: 0, tid: j, side: 1, ph: 0, cyc: 9 });
  });
}

// ===== ARÉNY: pasti a pohyblivé zdi =====
function setupArena() {
  Tr = [];
  if (AK === 2) for (let i = 0; i < 6; i++) { const x = 200 + R() * (WW - 400), y = 200 + R() * (WH - 400); if (Math.hypot(x - WW / 2, y - WH / 2) > 260) Tr.push({ x, y, r: 46, ph: R() * 3.2 }); }
  if (AK === 3) Ob.forEach((o, i) => { if (i % 2 === 0) { o.m = 1; o.ox = o.x; o.oy = o.y; o.ax = R() < 0.5 ? 1 : 0; o.am = 150 + R() * 150; o.ph = R() * 6.28; } });
}
function arenaTick(dt) {
  gt += dt;
  for (const o of Ob) if (o.m) { const s = Math.sin(gt * 0.8 + o.ph) * o.am; o.x = o.ox + (o.ax ? s : 0); o.y = o.oy + (o.ax ? 0 : s); }
  for (const t of Tr) if ((gt + t.ph) % 3.2 > 2.2) {
    P.forEach(p => { if (!p.down && Math.hypot(p.x - t.x, p.y - t.y) < t.r + 8) hurtP(p); });
    E.forEach(e => { if (Math.hypot(e.x - t.x, e.y - t.y) < t.r + e.r) e.hp -= dt * 4; });
  }
}
function addPow(x, y) { const T = ['R', 'S', 'B', 'H'][Math.floor(R() * 4)]; Pu.push({ x, y, t: T, life: 12 }); }
function pushOut(o, r) {
  for (const b of Ob) { const dx = o.x - b.x, dy = o.y - b.y, d = Math.hypot(dx, dy), m = b.r + r; if (d < m && d > 0) { o.x = b.x + dx / d * m; o.y = b.y + dy / d * m; } }
}

// Poloha hráče, kterého řídí druhý prohlížeč (host si pohyb počítá sám a posílá ho): omezí se rychlostí, ať nejde létat po aréně
function setRemote(i, x, y, vx, vy, dt) {
  const p = P[i];
  if (!p || p.down) return;
  const lim = Math.max(60, p.cl.sp * 1.6 * Math.max(dt, 0.05) + 20);   // nejvýš zhruba rychlost třídy + rezerva na zpoždění zpráv
  let dx = x - p.x, dy = y - p.y; const d = Math.hypot(dx, dy);
  if (d > lim) { dx = dx / d * lim; dy = dy / d * lim; }
  p.x = Math.max(16, Math.min(WW - 16, p.x + dx)); p.y = Math.max(16, Math.min(WH - 16, p.y + dy));
  pushOut(p, 16);
  p.vx = Math.max(-400, Math.min(400, vx || 0)); p.vy = Math.max(-400, Math.min(400, vy || 0));
}

// ===== AKTUALIZACE (jeden krok, dt v sekundách) =====
function update(dt) {
  shake = Math.max(0, shake - dt * 40); banner = Math.max(0, banner - dt); arenaTick(dt);
  P.forEach((p, i) => {
    const n = INP[i];
    p.inv = Math.max(0, p.inv - dt); p.rapid = Math.max(0, p.rapid - dt);
    if (p.down) return;
    const sp = p.cl.sp;
    if (!REMOTE[i]) {
      if (mod.ice) { p.vx += (n.x * sp - p.vx) * Math.min(1, dt * 2); p.vy += (n.y * sp - p.vy) * Math.min(1, dt * 2); } else { p.vx = n.x * sp; p.vy = n.y * sp; }
    }
    if (n.aim) { const m = Math.hypot(n.aim[0], n.aim[1]) || 1; p.ax = n.aim[0] / m; p.ay = n.aim[1] / m; }
    else if (n.x || n.y) { const m = Math.hypot(n.x, n.y); p.ax = n.x / m; p.ay = n.y / m; }
    if (!REMOTE[i]) { p.x = Math.max(16, Math.min(WW - 16, p.x + p.vx * dt)); p.y = Math.max(16, Math.min(WH - 16, p.y + p.vy * dt)); pushOut(p, 16); }
    p.cd -= dt; p.tg = aimTarget(p);
    if (p.cl.k === 'heal') {
      p.hc = (p.hc || 0) - dt;
      if (p.hc <= 0) {   // healer: léčí pulz každých ~4 s
        p.hc = 4.5; let any = 0;
        P.forEach(q => { if (q !== p && !q.down && q.hp < q.mhp && Math.hypot(q.x - p.x, q.y - p.y) < 220) { q.hp++; any = 1; burst(q.x, q.y, '#9dffb0', 12, 120); } });
        if (any) { ring(p.x, p.y, 220, 0.3, '#9dffb0'); beep(700, 0.2, 'sine', 0.06, 300); } else p.hc = 0.8;
      }
    }
    if (p.cl.k === 'tank') {
      p.tc = (p.tc || 0) - dt;
      if (p.tc <= 0) {   // tank: dotyk zraňuje a odhazuje nepřátele
        p.tc = 0.3;
        for (const e of E) { const ex = e.x - p.x, ey = e.y - p.y, dd = Math.hypot(ex, ey) || 1; if (dd < e.r + 26) { hit(e, 1, i); e.vx += ex / dd * 320; e.vy += ey / dd * 320; burst(e.x, e.y, '#ffa94d', 4, 150); } }
      }
    }
    if (n.f && p.cd <= 0) {
      p.cd = (p.rapid > 0 ? 0.4 : 1) * p.cl.cd;
      let a = Math.atan2(p.ay, p.ax);
      if (p.tg) { const L = lead(p, p.tg); a = Math.atan2(L.y - p.y, L.x - p.x); }   // pomoc s mířením: míří předem na pohybující se cíl
      a += (p.rapid > 0 ? rnd(-0.1, 0.1) : 0);
      fire(p, i, a);
    }
    // sbírání power-upů
    Pu.forEach(u => {
      if (Math.hypot(u.x - p.x, u.y - p.y) < 28) {
        u.life = 0; beep(900, 0.15, 'sine', 0.06, 500); burst(u.x, u.y, '#fff', 12);
        if (u.t === 'R') p.rapid = 8;
        if (u.t === 'S') p.shield = 1;
        if (u.t === 'H') p.hp = Math.min(p.mhp, p.hp + 1);
        if (u.t === 'B') { E.forEach(e => { if (Math.hypot(e.x - p.x, e.y - p.y) < 320) { e.hp -= e.boss ? 8 : 99; e.by = P.indexOf(p); } }); shk(20); beep(90, 0.4, 'sawtooth', 0.1, -50); burst(p.x, p.y, '#ffa94d', 50, 500); }
      }
    });
  });
  // oživování: dotek živého hráče
  P.forEach(p => {
    if (!p.down) return;
    const h = P.find(q => !q.down && Math.hypot(q.x - p.x, q.y - p.y) < 45);
    if (h) { p.rev += dt * (h.cl.k === 'heal' ? 2 : 1); if (p.rev >= 1.2) { p.down = 0; p.hp = 2; p.inv = 2; p.rev = 0; h.revives++; beep(400, 0.3, 'triangle', 0.07, 500); burst(p.x, p.y, '#fff', 25); } }
    else p.rev = Math.max(0, p.rev - dt);
  });
  // spawn
  spawnT -= dt;
  if (!bossDone) { spawnE(1); bossDone = 1; }
  if (toSpawn > 0 && spawnT <= 0) { spawnE(0); toSpawn--; spawnT = Math.max(0.25, 1.1 - wave * 0.06) / DIFFS[diff].sr; }
  // nepřátelé
  E.forEach(e => {
    e.hit = Math.max(0, e.hit - dt); e.stun = Math.max(0, (e.stun || 0) - dt);
    const tg = pickTarget(e);
    if (!tg) return;
    const dx = tg.x - e.x, dy = tg.y - e.y, d = Math.hypot(dx, dy) || 1;
    steer(e, tg, dx, dy, d, dt);
    e.x = Math.max(e.r, Math.min(WW - e.r, e.x + e.vx * dt)); e.y = Math.max(e.r, Math.min(WH - e.r, e.y + e.vy * dt)); pushOut(e, e.r);
    if (d < e.r + 14 && tg.inv <= 0) {
      if (tg.shield) { tg.shield = 0; tg.inv = 1; beep(300, 0.2, 'sine', 0.08); }
      else {
        tg.hp--; combo = 0; tg.inv = 1.1; shk(14); beep(140, 0.25, 'sawtooth', 0.08, -80); burst(tg.x, tg.y, COLS[P.indexOf(tg)], 20);
        if (tg.hp <= 0) { tg.down = 1; tg.downs++; tg.rev = 0; burst(tg.x, tg.y, '#fff', 40, 350); }
      }
      e.x -= e.dx * 40; e.y -= e.dy * 40;
    }
  });
  // střely
  Bu.forEach(b => {
    if (b.homing) home(b, dt);
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    for (const o of Ob) if (Math.hypot(b.x - o.x, b.y - o.y) < o.r) { b.life = 0; burst(b.x, b.y, '#888', 3, 80); }
    for (const e of E) if (e.hp > 0 && Math.hypot(b.x - e.x, b.y - e.y) < e.r + 4) { b.life = 0; if (!b.aoe) { hit(e, b.dmg || 1, b.o); burst(b.x, b.y, e.c, 4, 120); beep(220, 0.05, 'triangle', 0.03); } break; }   // smrt se řeší v reap()
  });
  Bu.forEach(b => { if (b.life <= 0 && b.aoe && !b.done) { b.done = 1; explode(b); } });   // plošné výbuchy (EMP, rakety)
  EB.forEach(s => {
    s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
    for (const o of Ob) if (Math.hypot(s.x - o.x, s.y - o.y) < o.r) s.life = 0;
    for (const p of P) if (!p.down && Math.hypot(s.x - p.x, s.y - p.y) < 20) { s.life = 0; hurtP(p); }
  });
  EB = EB.filter(s => s.life > 0);
  reap();
  Bu = Bu.filter(b => b.life > 0); E = E.filter(e => e.hp > 0); Pu.forEach(u => { u.life -= dt; }); Pu = Pu.filter(u => u.life > 0);
  Pa.forEach(a => { a.x += a.vx * dt; a.y += a.vy * dt; a.vx *= 0.94; a.vy *= 0.94; a.life -= dt; }); Pa = Pa.filter(a => a.life > 0);
  comboT -= dt; if (comboT <= 0) combo = 0;
  Tx.forEach(t => { t.y -= 40 * dt; t.life -= dt; }); Tx = Tx.filter(t => t.life > 0); Rg.forEach(r => { r.life -= dt; }); Rg = Rg.filter(r => r.life > 0);
  if (toSpawn === 0 && bossDone && E.length === 0) {
    if (wave >= WIN_WAVE) { state = 'won'; beep(660, 0.5, 'sine', 0.08, 300); } else nextWave();
  }
  if (P.every(p => p.down) && state === 'play') { state = 'over'; beep(200, 0.8, 'sawtooth', 0.1, -150); }
}
