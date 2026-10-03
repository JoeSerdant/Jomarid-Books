// Simulace: střelba, pohyb, střely, kolize, smrt.
/* =====================================================================
   Simulace
   ===================================================================== */
const tmpA = [], tmpB = [], tmpC = [];
for (const id in CLASSES) CLASSES[id].hasTur = CLASSES[id].barrels.some(b => b.turret);
function enemy(a, e) {
  if (e.isShape) return !e.dead;
  if (!e.alive || e === a) return false;
  return !(a.team && a.team === e.team);
}
function heal(t, amt) { if (t.alive) t.hp = Math.min(t.maxHp, t.hp + amt); }
const aimOut = { x: 0, y: 0 };

function botRange(t) {
  const cls = CLASSES[t.cls]; let mx = 0, trap = false;
  for (const b of cls.barrels) { if (b.kind === 'bullet') mx = Math.max(mx, b.spd); else if (b.kind === 'trap') trap = true; }
  if (!mx) return trap ? 300 : 520;
  return t.bulletSpeed * mx * BULLET_LIFE * cls.range;
}
const power = t => (t.level + 4) * (0.45 + 0.55 * t.hp / t.maxHp) * (1 + 0.1 * t.tierDone);

function aimPoint(from, T, lead) {
  let ax = T.x, ay = T.y;
  if (T.isTank) {
    const d = Math.hypot(T.x - from.x, T.y - from.y), tt = d / Math.max(200, from.bulletSpeed);
    ax += T.vx * tt * lead; ay += T.vy * tt * lead;
  }
  aimOut.x = ax; aimOut.y = ay;
}

function hurt(t, amt, src) {
  if (!t.alive || t.invuln > 0) return false;
  if (t.isPlayer) {                    // obtížnost: zranění hráče od botů / tvarů
    const D = DIFFS[diffKey];
    if (!src) amt *= D.shapeDmg; else if (src !== t && !src.isPlayer) amt *= D.botDmg;
  }
  if (src && src !== t) { t.lastAttacker = src; t.lastAtkT = time; }
  t.dmgT = 0; t.hit = 0.08;
  if (t.shield > 0) { const a = Math.min(t.shield, amt); t.shield -= a; amt -= a; if (amt <= 0.0001) return true; }
  t.hp -= amt;
  if (t.isPlayer && amt > 1) { shake = Math.max(shake, Math.min(9, amt * 0.3)); if (amt > t.maxHp * 0.07) buzz(22); }
  return true;
}

/* ---------- střelba ---------- */
function shoot(t, br, idx, ang0, ox, oy) {
  const cls = CLASSES[t.cls], R = t.r, pk = t.pk, tur = ox !== undefined;
  const base = tur ? ang0 : t.angle + br.a, ca = Math.cos(base), sa = Math.sin(base);
  const a = br.spread ? base + rand(-br.spread, br.spread) : base;
  let px, py;
  if (tur) { const L = br.len * R * 0.55; px = ox + ca * L; py = oy + sa * L; }
  else { px = t.x + ca * br.len * R - sa * br.off * R; py = t.y + sa * br.len * R + ca * br.off * R; }
  const spd = t.bulletSpeed * br.spd, drone = br.kind === 'drone', trap = br.kind === 'trap', missile = br.kind === 'missile', bomb = br.kind === 'bomb';
  let dmg = t.bulletDmg * br.dmg * (t.buff.dmg > 0 ? 1.4 : 1) * (t.adr ? 1.2 : 1), crit = false;
  if (pk.crit && !drone && !trap && Math.random() < pk.crit) { dmg *= 2.2; crit = true; }
  const hpm = br.hp * (trap ? 2.4 : 1) * (drone || trap ? 1 + (pk.minion - 1) * 0.6 : 1);
  const life = trap ? 7.5 : missile ? 2.4 * pk.rng : BULLET_LIFE * cls.range * pk.rng;
  const sp = spd * (drone ? 0.8 : 1);
  const b = {
    id: nextId++, owner: t, x: px, y: py, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
    r: Math.max(3, br.w * R * 0.5 * br.size * (tur ? 0.85 : 1)), hp: t.bulletHp * hpm, dmg, life, drone, trap, missile, crit,
    vmax: sp, orb: Math.random() < 0.5 ? 1 : -1, color: t.color, hitId: 0, hitT: 0, dead: false,
    pierce: br.pierce, streak: br.streak, bounce: Math.max(br.bounce, drone || trap ? 0 : pk.bounce),
    blast: br.blast, bdmg: 0, seen: br.pierce ? [] : null, tgt: null, tgtT: 0, boomed: false,
  };
  if (br.blast) { b.bdmg = dmg * (bomb ? 1 : 0.5); if (bomb) { b.dmg = dmg * 0.2; b.hp = 1; } }
  else if (pk.blast && !drone && !trap) { b.blast = 52; b.bdmg = dmg * 0.4; }
  if (bomb && br.lob) {
    const d = Math.hypot(t.tx - px, t.ty - py), maxL = BULLET_LIFE * cls.range * 1.3 * pk.rng;
    b.life = clamp(d / sp, 0.18, maxL);
  }
  bullets.push(b);
  if (drone) t.drones++;
  else {
    if (trap) t.traps++;
    const imp = 14 * br.recoil * Math.pow(br.dmg, 0.6) * br.spd;
    t.vx -= Math.cos(a) * imp; t.vy -= Math.sin(a) * imp;
  }
  t.rec[idx] = 1;
  if (t.isPlayer) beep('shoot');
}
function turretTarget(t, range) {
  gBody.near(t.x, t.y, range, tmpC);
  let best = null, bd = range * range;
  for (let i = 0; i < tmpC.length; i++) {
    const e = tmpC[i]; if (!enemy(t, e) || (e.isTank && e.invuln > 0) || (e.type === 'bomb')) continue;
    const dx = e.x - t.x, dy = e.y - t.y, d2 = (e.isTank ? 0.45 : 1) * (dx * dx + dy * dy);
    if (d2 < bd) { bd = d2; best = e; }
  }
  return best;
}
function fireBarrels(t, dt) {
  const cls = CLASSES[t.cls], bs = cls.barrels, starting = t.wantFire && !t.wasFiring, R = t.r;
  const maxD = Math.floor(cls.maxDrones * t.pk.minion), maxT = Math.floor(cls.maxTraps * t.pk.minion);
  if (cls.hasTur) {
    t.turT = (t.turT || 0) - dt;
    if (t.turT <= 0) { t.turT = 0.14; t.turTarget = turretTarget(t, Math.min(720, t.bulletSpeed * 1.1 * BULLET_LIFE * cls.range * 0.85)); }
    const T = t.turTarget; if (T && (T.isShape ? T.dead : !T.alive)) t.turTarget = null;
  }
  for (let i = 0; i < bs.length; i++) {
    const br = bs[i], period = t.reload * br.rel;
    t.bt[i] = Math.max(t.bt[i] - dt, -dt);
    t.rec[i] = Math.max(0, t.rec[i] - dt * 6);
    if (br.turret) {
      const wa = t.angle + br.a, mx = t.x + Math.cos(wa) * br.dist * R, my = t.y + Math.sin(wa) * br.dist * R, T = t.turTarget;
      let want = t.angle, live = false;
      if (T) { aimPoint(t, T, 0.85); want = Math.atan2(aimOut.y - my, aimOut.x - mx); live = true; }
      t.tur[i] += clamp(angDiff(t.tur[i], want), -10 * dt, 10 * dt);
      if ((live || t.wantFire) && t.bt[i] <= 0 && Math.abs(angDiff(t.tur[i], want)) < 0.25) { shoot(t, br, i, t.tur[i], mx, my); t.bt[i] += period; }
      continue;
    }
    if (starting && br.delay) t.bt[i] = Math.max(t.bt[i], br.delay * period);
    if (!t.wantFire || t.bt[i] > 0) continue;
    if (br.kind === 'drone' && t.drones >= maxD) continue;
    if (br.kind === 'trap' && t.traps >= maxT) continue;
    shoot(t, br, i);
    t.bt[i] += period;
  }
  t.wasFiring = t.wantFire;
}

/* ---------- pohyb ---------- */
function moveTank(t, dt) {
  if (t.dashT > 0) {
    t.dashT -= dt; const sp = t.speed * 3.2 + 300; t.vx = t.dvx * sp; t.vy = t.dvy * sp;
  } else {
    let mx = t.moveX, my = t.moveY;
    const m = Math.hypot(mx, my);
    if (!(m === m)) { mx = 0; my = 0; }
    if (m > 1) { mx /= m; my /= m; }
    const spd = t.speed * (t.buff.speed > 0 ? 1.3 : 1) * (t.slowT > 0 ? t.slowF : 1) * (t.adr ? 1.25 : 1);
    let k = Math.min(1, 6 * dt) * (m > 0.02 ? 1 : 0.7); if (t.onIce) k *= 0.2;
    t.vx += (mx * spd - t.vx) * k; t.vy += (my * spd - t.vy) * k;
    const sp = Math.hypot(t.vx, t.vy), cap = spd * 1.9 + 60;
    if (sp > cap) { t.vx *= cap / sp; t.vy *= cap / sp; }
  }
  t.x += t.vx * dt; t.y += t.vy * dt;
  if (t.x < t.r) { t.x = t.r; if (t.vx < 0) t.vx = 0; } else if (t.x > WORLD - t.r) { t.x = WORLD - t.r; if (t.vx > 0) t.vx = 0; }
  if (t.y < t.r) { t.y = t.r; if (t.vy < 0) t.vy = 0; } else if (t.y > WORLD - t.r) { t.y = WORLD - t.r; if (t.vy > 0) t.vy = 0; }
}
function tickTank(t, dt) {
  if (t.invuln > 0) t.invuln -= dt;
  t.dmgT += dt; if (t.hit > 0) t.hit -= dt;
  if (t.dashCd > 0) t.dashCd -= dt;
  if (t.slowT > 0) t.slowT -= dt;
  if (t.buff.speed > 0) t.buff.speed -= dt;
  if (t.buff.dmg > 0) t.buff.dmg -= dt;
  t.adr = !!(t.pk.adren && t.hp < t.maxHp * 0.4);
  const pct = t.regenPct * (t.dmgT > 4 || t.inOasis ? 5 : 1) * (t.inOasis ? 1.8 : 1);
  t.hp = Math.min(t.maxHp, t.hp + t.maxHp * pct * dt);
  if (t.pk.shield > 0 && t.dmgT > 4) { const cap = t.maxHp * t.pk.shield; if (t.shield < cap) t.shield = Math.min(cap, t.shield + cap * 0.3 * dt); }
}
function moveShape(s, dt) {
  s.x += (s.vx + s.dvx) * dt; s.y += (s.vy + s.dvy) * dt; s.rot += s.spin * dt;
  const dr = Math.max(0, 1 - 2.2 * dt); s.vx *= dr; s.vy *= dr;
  if (s.hit > 0) s.hit -= dt;
  if (s.x < s.r) { s.x = s.r; s.vx = Math.abs(s.vx); s.dvx = Math.abs(s.dvx); } else if (s.x > WORLD - s.r) { s.x = WORLD - s.r; s.vx = -Math.abs(s.vx); s.dvx = -Math.abs(s.dvx); }
  if (s.y < s.r) { s.y = s.r; s.vy = Math.abs(s.vy); s.dvy = Math.abs(s.dvy); } else if (s.y > WORLD - s.r) { s.y = WORLD - s.r; s.vy = -Math.abs(s.vy); s.dvy = -Math.abs(s.dvy); }
}

/* ---------- střely ---------- */
function steerDrone(b, dt) {
  const o = b.owner;
  if (!o.alive) { b.dead = true; return; }
  const dx = o.tx - b.x, dy = o.ty - b.y, d = Math.hypot(dx, dy) || 1;
  let vx, vy;
  if (d > 80) { vx = dx / d * b.vmax; vy = dy / d * b.vmax; }
  else { vx = -dy / d * b.vmax * 0.6 * b.orb + dx / d * (d - 55) * 2; vy = dx / d * b.vmax * 0.6 * b.orb + dy / d * (d - 55) * 2; }
  const k = Math.min(1, 4 * dt);
  b.vx += (vx - b.vx) * k; b.vy += (vy - b.vy) * k;
}
function steerMissile(b, dt) {
  const o = b.owner; b.tgtT -= dt;
  if (b.tgtT <= 0 || !b.tgt || (b.tgt.isShape ? b.tgt.dead : !b.tgt.alive)) {
    b.tgtT = 0.15; b.tgt = null; let bd = 1e18;
    gBody.near(b.x, b.y, 760, tmpC);
    for (let i = 0; i < tmpC.length; i++) {
      const e = tmpC[i]; if (!enemy(o, e) || (e.isTank && e.invuln > 0) || e.type === 'bomb') continue;
      const dx = e.x - b.x, dy = e.y - b.y, d2 = (e.isTank ? 0.4 : 1) * (dx * dx + dy * dy);
      if (d2 < bd) { bd = d2; b.tgt = e; }
    }
  }
  if (b.tgt) {
    const want = Math.atan2(b.tgt.y - b.y, b.tgt.x - b.x), cur = Math.atan2(b.vy, b.vx);
    const a = cur + clamp(angDiff(cur, want), -4.4 * dt, 4.4 * dt);
    b.vx = Math.cos(a) * b.vmax; b.vy = Math.sin(a) * b.vmax;
  }
}
function bulletHit(b) {
  const o = b.owner, pk = o.pk;
  gBody.near(b.x, b.y, b.r + 70, tmpB);
  for (let i = 0; i < tmpB.length; i++) {
    const e = tmpB[i];
    if (e === o) continue;
    if (e.isTank) { if (!e.alive || (o.team && e.team === o.team)) continue; } else if (e.dead) continue;
    const rr = b.r + e.r, dx = e.x - b.x, dy = e.y - b.y;
    if (dx * dx + dy * dy > rr * rr) continue;
    if (b.seen) { if (b.seen.indexOf(e.id) >= 0) continue; }
    else if (e.id === b.hitId && b.hitT > 0) continue;
    if (e.isTank && e.invuln > 0) return true;
    b.hitId = e.id; b.hitT = b.drone ? 0.8 : 0.3; if (b.seen) b.seen.push(e.id);
    const sp = Math.hypot(b.vx, b.vy) || 1, ux = b.vx / sp, uy = b.vy / sp;
    if (e.isTank) {
      const dmg = b.dmg * pk.tank;
      if (hurt(e, dmg, o)) {
        if (pk.vamp) heal(o, dmg * pk.vamp);
        if (pk.slow) { e.slowT = 1.6; e.slowF = 1 - pk.slow; }
      }
      const kb = clamp(b.dmg * 3, 8, 160) / (1 + e.r / 24) * pk.knock;
      e.vx += ux * kb; e.vy += uy * kb;
      b.hp -= e.ramLoss;
      if (e.isPlayer) beep('hit');
    } else {
      const dmg = b.dmg * pk.shape;
      e.hp -= dmg; e.lastAttacker = o; e.hit = 0.08;
      e.vx += ux * dmg * 8 * Math.min(pk.knock, 1.6); e.vy += uy * dmg * 8 * Math.min(pk.knock, 1.6);
      b.hp -= e.loss;
    }
    if (b.drone) { b.vx = -ux * b.vmax * 0.5; b.vy = -uy * b.vmax * 0.5; }
    if (b.pierce > 0) { b.pierce--; if (b.pierce <= 0) return true; b.hp = Math.max(b.hp, 1); continue; }
    if (b.hp <= 0) return true;
  }
  return false;
}
function updateBullets(dt) {
  for (let i = 0; i < bullets.length; i++) {
    const b = bullets[i]; if (b.dead) continue;
    if (b.drone) steerDrone(b, dt);
    else if (b.trap) { const k = Math.exp(-2.6 * dt); b.vx *= k; b.vy *= k; }
    else if (b.missile) steerMissile(b, dt);
    if (b.dead) continue;
    const n = Math.max(1, Math.ceil(Math.hypot(b.vx, b.vy) * dt / 14)), hs = dt / n;
    for (let s = 0; s < n; s++) {
      b.x += b.vx * hs; b.y += b.vy * hs; b.hitT -= hs;
      if (bulletHit(b)) { b.dead = true; break; }
    }
    if (b.dead) continue;
    if (!b.drone) {
      b.life -= dt;
      if (b.life <= 0) { b.dead = true; continue; }
      if (b.x < 0 || b.y < 0 || b.x > WORLD || b.y > WORLD) {
        if (b.bounce > 0) {
          if (b.x < 0) { b.x = 0; b.vx = Math.abs(b.vx); } else if (b.x > WORLD) { b.x = WORLD; b.vx = -Math.abs(b.vx); }
          if (b.y < 0) { b.y = 0; b.vy = Math.abs(b.vy); } else if (b.y > WORLD) { b.y = WORLD; b.vy = -Math.abs(b.vy); }
          b.bounce--; b.life += 0.4;
        } else if (b.x < -80 || b.y < -80 || b.x > WORLD + 80 || b.y > WORLD + 80) b.dead = true;
      }
    } else { b.x = clamp(b.x, 0, WORLD); b.y = clamp(b.y, 0, WORLD); }
  }
}
function bulletVsBullet() {
  gBul.clear();
  for (let i = 0; i < bullets.length; i++) if (!bullets[i].dead) gBul.add(bullets[i]);
  for (let i = 0; i < bullets.length; i++) {
    const b = bullets[i]; if (b.dead) continue;
    gBul.near(b.x, b.y, b.r + 40, tmpB);
    for (let j = 0; j < tmpB.length; j++) {
      const o = tmpB[j];
      if (o.id <= b.id || o.dead || o.owner === b.owner || (b.owner.team && b.owner.team === o.owner.team)) continue;
      const rr = b.r + o.r, dx = o.x - b.x, dy = o.y - b.y;
      if (dx * dx + dy * dy > rr * rr) continue;
      const bd = b.dmg, od = o.dmg;
      b.hp -= od; o.hp -= bd;
      if (b.hp <= 0) { b.dead = true; }
      if (o.hp <= 0) { o.dead = true; }
      if (b.dead) break;
    }
  }
}

/* ---------- kolize těl ---------- */
function collide(a, b, ma, mb, ov, nx, ny) {
  const tot = ma + mb;
  b.x += nx * ov * (ma / tot); b.y += ny * ov * (ma / tot);
  a.x -= nx * ov * (mb / tot); a.y -= ny * ov * (mb / tot);
  const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rv < 0) {
    const j = -1.5 * rv / (1 / ma + 1 / mb);
    a.vx -= j * nx / ma; a.vy -= j * ny / ma; b.vx += j * nx / mb; b.vy += j * ny / mb;
  }
}
function bodyCollisions(dt) {
  for (let i = 0; i < tanks.length; i++) {
    const t = tanks[i]; if (!t.alive) continue;
    gBody.near(t.x, t.y, t.r + 70, tmpA);
    for (let j = 0; j < tmpA.length; j++) {
      const e = tmpA[j]; if (e === t) continue;
      const dx = e.x - t.x, dy = e.y - t.y, rr = t.r + e.r, d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr) continue;
      let d = Math.sqrt(d2), nx = 1, ny = 0;
      if (d > 0.001) { nx = dx / d; ny = dy / d; } else d = 0.001;
      const ov = rr - d;
      if (e.isShape) {
        if (e.dead) continue;
        collide(t, e, t.r * t.r, e.r * e.r * 1.3, ov, nx, ny);
        e.hp -= t.ramDps * dt; e.lastAttacker = t; e.hit = 0.06;
        hurt(t, e.dps * dt, null);
      } else if (e.isTank) {
        if (!e.alive || e.id < t.id) continue;
        collide(t, e, t.r * t.r, e.r * e.r, ov, nx, ny);
        if (!(t.team && t.team === e.team)) { hurt(e, t.ramDps * dt, t); hurt(t, e.ramDps * dt, e); }
      }
    }
  }
}

/* ---------- smrt ---------- */
function killShape(s) {
  s.dead = true;
  const k = s.lastAttacker, D = DIFFS[diffKey];
  burst(s.x, s.y, s.color, s.type === 'hex' || s.type === 'alpha' ? 22 : s.type === 'pent' || s.type === 'crystal' ? 14 : 8, 160 + s.r * 2, s.r * 0.22);
  if (s.type === 'bomb') explode(s.x, s.y, 135, 55, null);
  if (s.type === 'alpha') { world.alphaT = 100; banner('Alfa pětiúhelník zničen', 'good'); dropPickup(s.x, s.y, 4); }
  else if (Math.random() < (s.type === 'crystal' ? 0.3 : 0.045)) dropPickup(s.x, s.y, 1);
  if (k && k.alive && !(k.ai && k.ai.dummy)) {
    const pk = k.pk;
    const xp = Math.max(1, Math.round(s.xp * (k.level < 30 ? 1 : 1 - (k.level - 30) / 30) * (k.isPlayer ? D.xpMul : D.botXp) * pk.sxp * pk.xp));
    addScore(k, xp);
    if (pk.greed) heal(k, k.maxHp * 0.03);
    if (k.isPlayer) {
      floatText(s.x, s.y - s.r, '+' + xp, s.type === 'gold' ? '#ffd34d' : '#ffffff');
      beep('pop'); save.st.shapes++;
      // Krystalové tvary jsou vzácný bonus navrch k běžnému XP - dávají
      // i trvalou měnu Krystaly, zvlášť viditelnou vlastní hláškou, ať
      // je jasné, že tohle není jen další zabitý tvar.
      if (s.type === 'crystal') {
        const gain = 3 + Math.floor(Math.random() * 4);
        save.st.crystals = (save.st.crystals || 0) + gain;
        floatText(s.x, s.y - s.r - 22, '💎 +' + gain, '#9ee7ff');
        if (typeof jomaridReward === 'function') jomaridReward('crystal', 5);
        persist();
      }
    }
  }
}
function killTank(t) {
  t.alive = false;
  const k = t.lastAttacker && time - t.lastAtkT < 10 ? t.lastAttacker : null, D = DIFFS[diffKey];
  burst(t.x, t.y, t.color, t.boss ? 60 : 28, 280, t.r * 0.3);
  world.rings.push({ x: t.x, y: t.y, r: t.r, max: t.r * (t.boss ? 6 : 3.2), life: 0.5, m: 0.5, color: t.color });
  if (t.boss) shake = Math.max(shake, 12); else if (Math.hypot(t.x - cam.x, t.y - cam.y) < 500) shake = Math.max(shake, 4);
  for (const b of bullets) if ((b.drone || b.trap) && b.owner === t) b.dead = true;
  t.drones = 0; t.traps = 0; t.wantFire = false;
  let msg;
  if (k && k !== t) {
    k.kills++;
    const gain = Math.round((t.score * 0.5 + 25) * (k.isPlayer ? D.xpMul : D.botXp) * k.pk.xp);
    if (k.alive && !(k.ai && k.ai.dummy)) { addScore(k, gain); if (k.pk.greed) heal(k, k.maxHp * 0.25); if (k.isPlayer) floatText(t.x, t.y - t.r, '+' + gain, theme.accent); }
    msg = k.name + ' zničil ' + t.name;
    if (k.isPlayer && !t.boss) { save.st.kills++; }
    if (k.team && t.team && k.team !== t.team) world.teamScore[k.team]++;
  } else msg = t.name + ' zahynul';
  feed(msg, !!(k && k.isPlayer) || t.isPlayer);
  if (t.boss) bossDown(t, k);
  else if (!(t.ai && t.ai.dummy) && Math.random() < 0.35) dropPickup(t.x, t.y, 1);
  if (t.isPlayer) {
    state = 'dead'; ui.deadT = 1.15; ui.spec = k && k.alive ? k : null; ui.specT = 0;
    Object.assign(deathInfo, { by: k ? k.name : '', level: t.level, score: Math.round(t.score), kills: t.kills, time: time - t.born });
    save.st.deaths++; save.st.secs += Math.round(time - t.born);
    beep('die'); buzz(70);
  } else t.respawnT = t.ai && t.ai.dummy ? 2.5 : rand(3, 7);
}
