// Vytváření tvarů a tanků, osobnosti botů.
/* ---------- tvary: vytvoření ---------- */
function pickShapeType(x, y) {
  const MD = M(); if (MD.shapeType) { const ty = MD.shapeType(); if (ty) return ty; }
  if (mode !== 'sandbox') { const q2 = Math.random(); if (q2 < 0.02) return 'bomb'; if (q2 < 0.032) return 'crystal'; }
  const f = 1 - clamp(Math.hypot(x - HALF, y - HALF) / (HALF * 0.95), 0, 1);
  const q = Math.random(), hex = 0.0025 + 0.02 * f * f, pent = 0.035 + 0.16 * f, tri = 0.24;
  if (q < hex) return 'hex';
  if (q < hex + pent) return 'pent';
  if (q < hex + pent + tri) return 'tri';
  return 'square';
}
function spawnShape() {
  const x = rand(80, WORLD - 80), y = rand(80, WORLD - 80);
  const type = pickShapeType(x, y), d = SHAPES[type], sp = rand(4, 12), da = rand(0, TAU);
  const s = {
    id: nextId++, isShape: true, type, x, y, vx: 0, vy: 0, dvx: Math.cos(da) * sp, dvy: Math.sin(da) * sp,
    r: d.r * rand(0.92, 1.08), hp: d.hp, maxHp: d.hp, rot: rand(0, TAU), spin: rand(-0.5, 0.5),
    xp: d.xp, dps: d.dps, loss: d.loss, n: d.n, color: d.color, hit: 0, dead: false, lastAttacker: null, born: time,
  };
  shapes.push(s); return s;
}

/* ---------- tanky: vytvoření a reset ---------- */
const ARCH = {
  balanced: { w: [0.8, 1, 0.4, 1, 1, 1.2, 1.4, 1], aggr: 0.5, courage: 0.5,
    pref: ['twin', 'sniper', 'mg', 'flank', 'triple', 'gunner', 'hunter', 'sprayer', 'quad', 'penta', 'spreadshot', 'vulcan', 'predator', 'hurricane', 'octo'] },
  glass:    { w: [0.3, 0.3, 0, 1, 1.2, 2, 2, 1.2], aggr: 0.65, courage: 0.3,
    pref: ['sniper', 'mg', 'assassin', 'hunter', 'ranger', 'stalker', 'predator', 'streamliner', 'sprayer', 'cannonade', 'overseer', 'overlord'] },
  tank:     { w: [1.4, 2, 1.5, 0.6, 0.8, 1, 0.8, 0.8], aggr: 0.55, courage: 0.7,
    pref: ['twin', 'flank', 'trapper', 'fortress', 'builder', 'gunTrapper', 'twinflank', 'citadel', 'engineer', 'siege', 'guardian', 'hexa', 'cruiser', 'destroyer', 'annihilator'] },
  rammer:   { w: [1.5, 1.8, 2.6, 0.1, 0.1, 0.4, 0.4, 1.6], aggr: 0.8, courage: 0.75, rammer: true,
    pref: ['flank', 'twin', 'fortress', 'triangle', 'berserker', 'fighter', 'thruster', 'citadel', 'twinflank', 'cruiser'] },
  speedy:   { w: [0.5, 0.6, 0.2, 1, 0.8, 1, 1.5, 2.6], aggr: 0.6, courage: 0.35,
    pref: ['mg', 'flank', 'sniper', 'triangle', 'flamer', 'shotgun', 'sprayer', 'stalker', 'fighter', 'thruster', 'inferno', 'vichr', 'ravager', 'canister', 'streamliner'] },
};
function uniqueName() {
  const used = new Set(tanks.filter(t => t.alive).map(t => t.name));
  for (let i = 0; i < 12; i++) { const n = pick(NAMES); if (!used.has(n)) return n; }
  return pick(NAMES) + ((Math.random() * 90 + 10) | 0);
}
function spawnPos(team) {
  let best = null, bd = -1;
  for (let i = 0; i < 24; i++) {
    let x = rand(260, WORLD - 260); const y = rand(260, WORLD - 260);
    if (mode === 'teams') { if (team === 1) x = rand(260, 1100); else if (team === 2) x = rand(WORLD - 1100, WORLD - 260); }
    let bad = false; for (const z of world.zones) if (z.type === 'lava' && Math.hypot(z.x - x, z.y - y) < z.r + 60) bad = true;
    if (bad) continue;
    let md = 1e9;
    for (const o of tanks) if (o.alive) md = Math.min(md, Math.hypot(o.x - x, o.y - y));
    if (md > bd) { bd = md; best = { x, y }; }
    if (md > 900) break;
  }
  return best;
}
function newPersona(t) {
  const key = pick(Object.keys(ARCH)), A = ARCH[key], D = DIFFS[diffKey];
  t.ai = {
    arch: key, w: A.w, pref: A.pref, rammer: !!A.rammer,
    aggr: clamp((A.aggr + rand(-0.15, 0.15)) * D.aggr, 0.1, 1), courage: clamp(A.courage + rand(-0.2, 0.2), 0, 1),
    orbit: Math.random() < 0.5 ? 1 : -1, mode: 'farm', target: null, fleeFrom: null,
    thinkT: rand(0, 0.3), err: 0, wander: null, wanderT: 0, dodgeX: 0, dodgeY: 0, dodgeT: 0,
  };
}
function resetTank(t) {
  const p = spawnPos(t.team) || { x: HALF, y: HALF };
  t.x = p.x; t.y = p.y; t.vx = 0; t.vy = 0; t.angle = rand(0, TAU);
  t.score = 0; t.level = 1; t.points = 0; t.bonusN = 0; t.traps = 0; t.stats = [0, 0, 0, 0, 0, 0, 0, 0];
  t.cls = 'basic'; t.tierDone = 0; t.bt = [0]; t.rec = [0]; t.tur = [0]; t.drones = 0;
  t.perks = {}; t.perkN = 0; t.perkOffer = null; t.buff = { speed: 0, dmg: 0 }; t.shield = 0; t.dashCd = 0; t.dashT = 0; t.slowT = 0; t.burnT = 0; t.burnDps = 0; t.burnSrc = null; t.boss = false; t.adr = false; t.onIce = false; t.inOasis = false; t.combo = 0;
  t.maxHp = 0; t.hp = 0; recalc(t);
  t.alive = true; t.invuln = t.isPlayer ? DIFFS[diffKey].inv : 3; t.dmgT = 99; t.kills = 0; t.lastAttacker = null; t.lastAtkT = -99;
  t.born = time; t.wantFire = false; t.wasFiring = false; t.hit = 0; t.moveX = 0; t.moveY = 0;
  t.tx = t.x; t.ty = t.y; t.autoT = null; t.autoTimer = 0; t.respawnT = 0;
  if (!t.isPlayer) { t.name = uniqueName(); t.color = t.team ? TEAM_COLORS[t.team] : pick(BOT_COLORS); newPersona(t); }
}
function makeTank(isPlayer, name, color, team) {
  const t = { id: nextId++, isTank: true, isPlayer, name, color, alive: false, ai: null, respawnT: 0, team: team || 0 };
  tanks.push(t); resetTank(t); return t;
}
