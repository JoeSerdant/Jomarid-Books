// Svět: hlavní krok, zóny, bonusy, výbuchy, bossové, události, zápas.
/* ---------- hlavní krok ---------- */
const feedItems = [];
function respawnBot(t) {
  const dummy = t.ai && t.ai.dummy, x = t.x, y = t.y, Dk = DIFFS[diffKey], keep = dummy ? 0 : Math.min(t.score * Dk.keep, xpFor(Dk.keepLvl));
  resetTank(t);
  if (dummy) { t.ai.dummy = true; t.x = x; t.y = y; t.name = 'Terč'; t.color = '#8fa0aa'; t.invuln = 0; }
  else if (keep > 20) addScore(t, keep);
}
function update(dt) {
  time += dt; world.matchT += dt;
  for (let i = 0; i < tanks.length; i++) {
    const t = tanks[i];
    if (!t.alive) {
      if (t.boss) { tanks.splice(i, 1); i--; continue; }
      if (!t.isPlayer) { t.respawnT -= dt; if (t.respawnT <= 0) respawnBot(t); }
      continue;
    }
    if (t.isPlayer) controlPlayer(t, dt); else botControl(t, dt);
    tickTank(t, dt); fireBarrels(t, dt); moveTank(t, dt);
  }
  for (let i = 0; i < shapes.length; i++) moveShape(shapes[i], dt);
  zoneEffects(dt);

  gBody.clear();
  for (let i = 0; i < tanks.length; i++) if (tanks[i].alive) gBody.add(tanks[i]);
  for (let i = 0; i < shapes.length; i++) if (!shapes[i].dead) gBody.add(shapes[i]);

  updateBullets(dt);
  bodyCollisions(dt);
  bulletVsBullet();

  for (let i = 0; i < shapes.length; i++) if (!shapes[i].dead && shapes[i].hp <= 0) killShape(shapes[i]);
  for (let i = 0; i < tanks.length; i++) if (tanks[i].alive && tanks[i].hp <= 0) killTank(tanks[i]);

  let j = 0;
  for (let i = 0; i < shapes.length; i++) if (!shapes[i].dead) shapes[j++] = shapes[i];
  shapes.length = j;
  j = 0;
  for (let i = 0; i < bullets.length; i++) {
    const b = bullets[i];
    if (b.dead) {
      if (b.blast && !b.boomed) { b.boomed = true; explode(b.x, b.y, b.blast, b.bdmg, b.owner); }
      if (b.drone && b.owner.drones > 0) b.owner.drones--; else if (b.trap && b.owner.traps > 0) b.owner.traps--;
      continue;
    }
    bullets[j++] = b;
  }
  bullets.length = j;
  for (let n = 0; n < 2 && shapes.length < SHAPE_TARGET; n++) spawnShape();
  worldUpdate(dt);

  const pcap = save.set.fx ? 320 : 90;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.life -= dt;
    if (p.life <= 0 || (i > pcap && Math.random() < 0.5)) { parts.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; const f = Math.pow(0.02, dt); p.vx *= f; p.vy *= f; p.rot += dt * 4;
  }
  for (let i = texts.length - 1; i >= 0; i--) {
    const p = texts[i]; p.life -= dt;
    if (p.life <= 0) { texts.splice(i, 1); continue; }
    p.y -= 46 * dt;
  }
  while (feedItems.length && feedItems[0].t < time) { const it = feedItems.shift(); if (it.el.parentNode) it.el.parentNode.removeChild(it.el); }
}

/* =====================================================================
   Svět: zóny, bonusy, bossové, události, týmy, cvičiště
   ===================================================================== */
function nearestZone(t, type, maxD) {
  let best = null, bd = maxD;
  for (const z of world.zones) { if (z.type !== type) continue; const d = Math.hypot(z.x - t.x, z.y - t.y) - z.r * 0.4; if (d < bd) { bd = d; best = z; } }
  return best;
}
function nearestPickup(t, type, maxD) {
  let best = null, bd = maxD;
  for (const p of world.pickups) { if (type && p.type !== type) continue; const d = Math.hypot(p.x - t.x, p.y - t.y); if (d < bd) { bd = d; best = p; } }
  return best;
}
const MAP_PRESETS = [
  { name: 'Rovnováha', lava: 3, ice: 2, oasis: 2 },
  { name: 'Sopečná pláň', lava: 6, ice: 1, oasis: 1 },
  { name: 'Ledovcové pole', lava: 1, ice: 6, oasis: 2 },
  { name: 'Oáza hojnosti', lava: 2, ice: 1, oasis: 6 },
  { name: 'Spálená země', lava: 8, ice: 0, oasis: 0 },
];
function genZones() {
  world.zones.length = 0;
  const preset = pick(MAP_PRESETS); world.mapName = preset.name;
  const specs = [['lava', preset.lava, 150, 230], ['ice', preset.ice, 260, 340], ['oasis', preset.oasis, 160, 210]];
  for (const [type, n, r0, r1] of specs) for (let k = 0; k < n; k++) {
    for (let tries = 0; tries < 50; tries++) {
      const r = rand(r0, r1), x = rand(600, WORLD - 600), y = rand(500, WORLD - 500);
      if (mode === 'teams' && (x < 1100 || x > WORLD - 1100)) continue;
      if (Math.hypot(x - HALF, y - HALF) < 380) continue;
      let ok = true; for (const z of world.zones) if (Math.hypot(z.x - x, z.y - y) < z.r + r + 160) ok = false;
      if (ok) { world.zones.push({ x, y, r, type, ph: rand(0, TAU) }); break; }
    }
  }
}
function zoneEffects(dt) {
  const Z = world.zones;
  for (let n = 0; n < tanks.length; n++) {
    const t = tanks[n]; if (!t.alive) continue;
    t.onIce = false; t.inOasis = false;
    for (let i = 0; i < Z.length; i++) {
      const z = Z[i], dx = t.x - z.x, dy = t.y - z.y;
      if (dx * dx + dy * dy > z.r * z.r) continue;
      if (z.type === 'lava') { if (t.dashT <= 0) hurt(t, (7 + t.maxHp * 0.045) * dt, null); }
      else if (z.type === 'ice') t.onIce = true;
      else t.inOasis = true;
    }
  }
}

/* ---------- bonusy ---------- */
let pickId = 1;
const PICK_KEYS = Object.keys(PICKS), PICK_W = PICK_KEYS.reduce((a, k) => a + PICKS[k].w, 0);
function randPickType() { let q = Math.random() * PICK_W; for (const k of PICK_KEYS) { q -= PICKS[k].w; if (q <= 0) return k; } return 'heal'; }
function inLava(x, y) { for (const z of world.zones) if (z.type === 'lava' && Math.hypot(z.x - x, z.y - y) < z.r) return true; return false; }
function spawnPickup(type, x, y) {
  if (world.pickups.length >= 36 || inLava(x, y)) return;
  world.pickups.push({ id: pickId++, x: clamp(x, 60, WORLD - 60), y: clamp(y, 60, WORLD - 60), type, life: 55, r: 15, ph: rand(0, TAU) });
}
function spawnRandomPickup() { spawnPickup(randPickType(), rand(220, WORLD - 220), rand(220, WORLD - 220)); }
function dropPickup(x, y, n) { for (let i = 0; i < n; i++) spawnPickup(randPickType(), x + rand(-45, 45), y + rand(-45, 45)); }
function applyPickup(t, p) {
  const me = t.isPlayer, D = DIFFS[diffKey], P = PICKS[p.type];
  if (p.type === 'heal') heal(t, t.maxHp * 0.5);
  else if (p.type === 'xp') addScore(t, Math.round((25 + 0.07 * xpFor(t.level + 1)) * (me ? D.xpMul : D.botXp) * t.pk.xp));
  else if (p.type === 'speed') t.buff.speed = 10;
  else if (p.type === 'dmg') t.buff.dmg = 10;
  else if (p.type === 'shield') t.shield = Math.max(t.shield, t.maxHp * 0.6);
  if (me) { floatText(t.x, t.y - t.r - 18, P.name, P.color); beep('pick'); buzz(12); }
  burst(p.x, p.y, P.color, 8, 130, 3);
}
function updatePickups(dt) {
  const P = world.pickups;
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i]; p.life -= dt;
    if (p.life <= 0) { P.splice(i, 1); continue; }
    let taken = false;
    for (let n = 0; n < tanks.length; n++) {
      const t = tanks[n]; if (!t.alive || t.boss || (t.ai && t.ai.dummy)) continue;
      const dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy);
      if (t.pk.magnet && d < 380 && d > 1) { const f = (380 - d) / 380 * 520 * dt; p.x += dx / d * f; p.y += dy / d * f; }
      if (d < t.r + p.r) { applyPickup(t, p); taken = true; break; }
    }
    if (taken) P.splice(i, 1);
  }
  world.pickT -= dt;
  if (world.pickT <= 0) { world.pickT = 2.2; if (P.length < (mode === 'sandbox' ? 18 : 12)) spawnRandomPickup(); }
}

/* ---------- výbuchy, skok ---------- */
function explode(x, y, r, dmg, owner) {
  burst(x, y, '#ffb04d', 14, 230, r * 0.15);
  world.rings.push({ x, y, r: 6, max: r, life: 0.34, m: 0.34, color: '#ffb04d' });
  if (player && player.alive) { const dp = Math.hypot(player.x - x, player.y - y); if (dp < 700) { shake = Math.max(shake, 5 * (1 - dp / 700) + 1.5); beep('boom'); } }
  gBody.near(x, y, r + 90, tmpC);
  const pk = owner ? owner.pk : null;
  for (let i = 0; i < tmpC.length; i++) {
    const e = tmpC[i];
    if (e.isShape ? e.dead : !e.alive) continue;
    if (owner && !enemy(owner, e)) continue;
    const dx = e.x - x, dy = e.y - y, d = Math.hypot(dx, dy) || 1;
    if (d > r + e.r) continue;
    const f = 1 - clamp((d - e.r) / r, 0, 1) * 0.55;
    if (e.isTank) {
      if (e.invuln > 0) continue;
      const dealt = dmg * f * (pk ? pk.tank : 1);
      if (hurt(e, dealt, owner) && pk && pk.vamp) heal(owner, dealt * pk.vamp);
      const kb = 120 * f / (1 + e.r / 24); e.vx += dx / d * kb; e.vy += dy / d * kb;
    } else {
      e.hp -= dmg * f * (pk ? pk.shape : 1); if (owner) e.lastAttacker = owner; e.hit = 0.08;
      e.vx += dx / d * 90 * f; e.vy += dy / d * 90 * f;
    }
  }
}
function dash(t) {
  if (!t.alive || t.dashCd > 0 || t.dashT > 0) return false;
  let dx = t.moveX, dy = t.moveY; const m = Math.hypot(dx, dy);
  if (m < 0.1) { dx = Math.cos(t.angle); dy = Math.sin(t.angle); } else { dx /= m; dy /= m; }
  t.dashT = 0.2; t.dvx = dx; t.dvy = dy; t.dashCd = 7 * t.pk.dashCd; t.invuln = Math.max(t.invuln, 0.28);
  burst(t.x, t.y, t.color, 10, 200, t.r * 0.18);
  if (t.isPlayer) { beep('dash'); buzz(15); }
  return true;
}

/* ---------- výhody ---------- */
function perkOfferOf(t) {
  if (t.boss || t.perkN >= PERK_LEVELS.length || t.level < PERK_LEVELS[t.perkN]) return null;
  if (!t.perkOffer) {
    const pool = PERKS.filter(p => !t.perks[p.id]).map(p => p.id);
    for (let i = pool.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const x = pool[i]; pool[i] = pool[j]; pool[j] = x; }
    t.perkOffer = pool.slice(0, 3);
  }
  return t.perkOffer;
}
function choosePerk(t, id) {
  if (!PERK_BY[id] || t.perks[id]) return;
  t.perks[id] = true; t.perkN++; t.perkOffer = null; recalc(t);
  if (t.isPlayer) { ui.statsDirty = true; ui.perkDirty = true; beep('perk'); save.st.perks++; floatText(t.x, t.y - t.r - 26, PERK_BY[id].name, theme.accent); }
}

/* ---------- tvary, boss, události ---------- */
function makeShape(type, x, y) {
  const d = SHAPES[type], sp = rand(4, 12), da = rand(0, TAU);
  const s = {
    id: nextId++, isShape: true, type, x, y, vx: 0, vy: 0, dvx: Math.cos(da) * sp, dvy: Math.sin(da) * sp,
    r: d.r * rand(0.94, 1.06), hp: d.hp, maxHp: d.hp, rot: rand(0, TAU), spin: rand(-0.5, 0.5),
    xp: d.xp, dps: d.dps, loss: d.loss, n: d.n, color: d.color, hit: 0, dead: false, lastAttacker: null,
  };
  shapes.push(s); return s;
}
function spawnAlpha() {
  if (shapes.some(s => s.type === 'alpha')) return;
  const a = rand(0, TAU), rr = rand(0, 500);
  makeShape('alpha', HALF + Math.cos(a) * rr, HALF + Math.sin(a) * rr);
  banner('V aréně se objevila Alfa pětiúhelník', 'info');
}
function spawnBoss() {
  const id = BOSS_IDS[world.bossN % BOSS_IDS.length], cls = CLASSES[id];
  const t = makeTank(false, cls.name, '#ff4f5e', 0);
  t.boss = true; t.cls = id; const n = cls.barrels.length;
  t.bt = new Array(n).fill(0); t.rec = new Array(n).fill(0); t.tur = new Array(n).fill(0);
  t.level = Math.min(MAX_LEVEL, 22 + world.bossN * 3); t.stats = [1, 4, 3, 3, 3, 4, 3, 2]; t.points = 0; t.tierDone = TIER_LEVELS.length; t.perkN = 99;
  t.x = HALF + rand(-300, 300); t.y = HALF + rand(-300, 300); t.invuln = 2.5; t.name = cls.name; t.color = '#ff4f5e';
  t.ai.boss = true; t.ai.aggr = 1; t.ai.courage = 1; t.ai.rammer = cls.ram >= 3;
  recalc(t); t.hp = t.maxHp; t.score = 2200 + world.bossN * 900;
  world.boss = t; world.bossN++;
  banner('BOSS: ' + cls.name + ' se objevil ve středu arény!', 'boss'); beep('boss'); buzz(60);
  feed('Boss ' + cls.name + ' vstoupil do arény', false);
}
function bossDown(t, k) {
  world.boss = null; world.bossT = DIFFS[diffKey].bossT;
  banner((k ? k.name : 'Někdo') + ' porazil bosse ' + t.name + '!', 'good'); beep('boom');
  dropPickup(t.x, t.y, 6);
  if (k && k.isPlayer) { save.st.bosses++; save.st.bossKinds[t.cls] = true; }
}
function runEvent() {
  const k = pick(['gold', 'swarm', 'crystal', 'supply']);
  if (k === 'gold') { for (let i = 0; i < 34; i++) makeShape('gold', rand(200, WORLD - 200), rand(200, WORLD - 200)); banner('Zlatý déšť! Po aréně jsou zlaté čtverce', 'event'); }
  else if (k === 'swarm') { const cx = rand(600, WORLD - 600), cy = rand(600, WORLD - 600); for (let i = 0; i < 22; i++) makeShape('tri', cx + rand(-420, 420), cy + rand(-420, 420)); banner('Hejno trojúhelníků se slétlo do jednoho místa', 'event'); }
  else if (k === 'crystal') { for (let i = 0; i < 9; i++) makeShape('crystal', HALF + rand(-900, 900), HALF + rand(-900, 900)); banner('Krystalový roj! Vzácné krystaly dávají hodně XP', 'event'); }
  else { for (let i = 0; i < 10; i++) spawnRandomPickup(); banner('Zásoby! Po aréně přibyly bonusy', 'event'); }
}
function worldUpdate(dt) {
  updatePickups(dt);
  for (let i = world.rings.length - 1; i >= 0; i--) {
    const r = world.rings[i]; r.life -= dt;
    if (r.life <= 0) world.rings.splice(i, 1); else r.r = r.max * (1 - Math.pow(r.life / r.m, 2));
  }
  shake *= Math.exp(-9 * dt); if (shake < 0.15) shake = 0;
  if (state !== 'play' || mode === 'sandbox') return;
  if (!world.boss) { world.bossT -= dt; if (world.bossT <= 0) spawnBoss(); }
  else {
    const B = world.boss; B.age = (B.age || 0) + dt;
    if (B.age > 150) {                                   // boss odchází, ať se mohl objevit další
      B.alive = false; for (const b of bullets) if (b.owner === B) b.dead = true;
      world.boss = null; world.bossT = DIFFS[diffKey].bossT * 0.6; banner('Boss ' + B.name + ' opustil arénu', 'info');
    }
  }
  world.evT -= dt; if (world.evT <= 0) { runEvent(); world.evT = DIFFS[diffKey].evGap * rand(0.9, 1.6); }
  world.alphaT -= dt; if (world.alphaT <= 0) { spawnAlpha(); world.alphaT = 130; }
  if (mode === 'teams' && !world.over) { const g = DIFFS[diffKey].goal; for (const tm of [1, 2]) if (world.teamScore[tm] >= g) { endMatch(tm); break; } }
}

/* ---------- zápas, týmy, cvičiště ---------- */
function setupMatch() {
  for (let i = tanks.length - 1; i >= 0; i--) if (!tanks[i].isPlayer) tanks.splice(i, 1);
  bullets.length = 0; parts.length = 0; texts.length = 0;
  world.pickups.length = 0; world.rings.length = 0; world.zones.length = 0;
  world.boss = null; world.bossN = 0; world.over = false; world.winner = 0; world.teamScore = [0, 0, 0]; world.matchT = 0;
  const D = DIFFS[diffKey]; world.bossT = D.bossT1; world.evT = D.evGap; world.alphaT = 70; world.pickT = 0;
  player.team = mode === 'teams' ? 1 : 0;
  if (mode === 'teams') {
    const n = Math.max(3, Math.round(D.bots / 2));
    for (let i = 0; i < n - 1; i++) makeTank(false, '', TEAM_COLORS[1], 1);
    for (let i = 0; i < n - (diffKey === 'easy' ? 1 : 0); i++) makeTank(false, '', TEAM_COLORS[2], 2);
  } else if (mode === 'sandbox') {
    for (let i = 0; i < 5; i++) {
      const t = makeTank(false, 'Terč', '#8fa0aa', 0), a = i * TAU / 5;
      t.ai.dummy = true; t.name = 'Terč'; t.color = '#8fa0aa'; t.x = HALF + Math.cos(a) * 520; t.y = HALF + Math.sin(a) * 520;
    }
  } else for (let i = 0; i < D.bots; i++) makeTank(false, '', BOT_COLORS[0]);
  if (mode !== 'sandbox') { genZones(); save.st.mapsSeen[world.mapName] = true; }
  for (let i = 0; i < (mode === 'sandbox' ? 10 : 8); i++) spawnRandomPickup();
  builtDiff = diffKey; builtMode = mode;
}
function endMatch(team) {
  world.over = true; world.winner = team;
  const win = team === player.team;
  if (win) save.st.wins++;
  player.alive = false;
  state = 'dead'; ui.deadT = 0.8; ui.spec = null; ui.specT = 0;
  Object.assign(deathInfo, { by: '', level: player.level, score: Math.round(player.score), kills: player.kills, time: time - player.born });
  beep(win ? 'ach' : 'die');
}
function sandboxEquip(id) {
  const c = CLASSES[id]; if (!c || c.boss) return;
  for (const b of bullets) if ((b.drone || b.trap) && b.owner === player) b.dead = true;
  player.cls = id; player.tierDone = TIER_LEVELS.length; const n = c.barrels.length;
  player.bt = new Array(n).fill(0); player.rec = new Array(n).fill(0); player.tur = new Array(n).fill(player.angle); player.drones = 0; player.traps = 0;
  recalc(player); player.hp = player.maxHp;
}
function sandboxPrep() {
  player.level = MAX_LEVEL; player.score = xpFor(MAX_LEVEL); player.stats = [7, 7, 7, 7, 7, 7, 7, 7]; player.points = 0;
  player.tierDone = TIER_LEVELS.length; player.perkN = PERK_LEVELS.length; recalc(player); player.hp = player.maxHp;
}
