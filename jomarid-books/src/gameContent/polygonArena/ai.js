// Umělá inteligence botů a ovládání hráče.
/* ---------- AI botů ---------- */
function botUpgrade(b) {
  const ai = b.ai;
  while (b.points > 0) {
    let bi = -1, bs = -1;
    for (let i = 0; i < 8; i++) {
      const c = b.stats[i]; if (c >= STAT_MAX) continue;
      const sc = ai.w[i] / (c + 1.2) + Math.random() * 0.05;
      if (sc > bs) { bs = sc; bi = i; }
    }
    if (bi < 0) { b.points = 0; break; }
    b.stats[bi]++; b.points--;
  }
  recalc(b);
  const offer = offerOf(b);
  if (offer) {
    const pref = offer.filter(id => ai.pref.includes(id));
    chooseClass(b, pick(pref.length ? pref : offer));
  }
  const po = perkOfferOf(b);
  if (po) choosePerk(b, pick(po));
}
function pickFarmTarget(b) {
  const ai = b.ai;
  gBody.near(b.x, b.y, 700, tmpA);
  let best = null, bv = 0;
  for (let i = 0; i < tmpA.length; i++) {
    const e = tmpA[i]; if (!e.isShape || e.dead) continue;
    const d = Math.hypot(e.x - b.x, e.y - b.y); if (d > 700) continue;
    if (e.type === 'hex' && b.level < 9) continue;
    if (e.type === 'pent' && b.level < 4) continue;
    if (e.type === 'bomb' && d < 260) continue;
    if (e.type === 'alpha' && b.level < 14) continue;
    let v = e.xp / (d + 140);
    if (e === ai.target) v *= 1.25;
    if (v > bv) { bv = v; best = e; }
  }
  ai.target = best;
  if (!best && (!ai.wander || ai.wanderT <= 0)) {
    const a = rand(0, TAU), rr = Math.sqrt(Math.random()) * HALF * 0.85;
    ai.wander = { x: HALF + Math.cos(a) * rr, y: HALF + Math.sin(a) * rr }; ai.wanderT = 8;
  }
}
function botDecide(b) {
  const ai = b.ai, D = DIFFS[diffKey], myPow = power(b);
  if (ai.boss) {
    let best = null, bd = 1250;
    for (let i = 0; i < tanks.length; i++) {
      const o = tanks[i]; if (o === b || !o.alive || o.boss || o.invuln > 0) continue;
      const d = Math.hypot(o.x - b.x, o.y - b.y); if (d < bd) { bd = d; best = o; }
    }
    ai.mode = best ? 'hunt' : 'farm'; ai.target = best; ai.fleeFrom = null;
    if (!best && (!ai.wander || ai.wanderT <= 0)) { ai.wander = { x: HALF + rand(-700, 700), y: HALF + rand(-700, 700) }; ai.wanderT = 8; }
    ai.err = gauss() * 0.05; ai.dodgeX = 0; ai.dodgeY = 0; ai.pick = null; return;
  }
  let threat = null, tD = 1e9, prey = null, pD = 1e9, near = null, nD = 1e9;
  for (let i = 0; i < tanks.length; i++) {
    const o = tanks[i]; if (o === b || !o.alive || !enemy(b, o)) continue;
    const d = Math.hypot(o.x - b.x, o.y - b.y);
    if (d < nD) { nD = d; near = o; }
    if (d > 1000 || o.invuln > 0) continue;
    const op = power(o);
    if (op > myPow * (1.15 + ai.courage * 0.55) + 1 && d < 800) { if (d < tD) { tD = d; threat = o; } }
    else if (op < myPow * (0.8 + ai.aggr * 0.7) && d < (500 + ai.aggr * 450) * D.hunt) {
      if (o.isPlayer && o.level < D.mercy && !(b.lastAttacker === o && time - b.lastAtkT < 6)) continue;   // začátečníka nechají být
      if (d < pD) { pD = d; prey = o; }
    }
  }
  if (b.hp < b.maxHp * 0.35 && near && nD < 750) { ai.mode = 'flee'; ai.fleeFrom = near; }
  else if (threat) { ai.mode = 'flee'; ai.fleeFrom = threat; }
  else if (prey) { ai.mode = 'hunt'; ai.target = prey; ai.fleeFrom = null; }
  else { ai.mode = 'farm'; ai.fleeFrom = null; if (!ai.target || ai.target.isTank) ai.target = null; pickFarmTarget(b); }
  ai.zone = null;
  if (b.hp < b.maxHp * 0.45 && ai.mode !== 'flee') { const z = nearestZone(b, 'oasis', 1600); if (z) { ai.mode = 'heal'; ai.zone = z; } }
  ai.pick = nearestPickup(b, b.hp < b.maxHp * 0.65 ? 'heal' : null, ai.mode === 'flee' ? 260 : 620);
  ai.err = gauss() * D.noise;
  ai.dodgeX = 0; ai.dodgeY = 0;
  if (D.dodge > 0) {
    for (let i = 0; i < bullets.length; i++) {
      const bl = bullets[i];
      if (bl.owner === b || bl.dead || (b.team && bl.owner.team === b.team)) continue;
      const rx = b.x - bl.x, ry = b.y - bl.y;
      if (rx * rx + ry * ry > 340 * 340) continue;
      const sp2 = bl.vx * bl.vx + bl.vy * bl.vy; if (sp2 < 1) continue;
      const tt = (rx * bl.vx + ry * bl.vy) / sp2;
      if (tt < 0 || tt > 0.6) continue;
      const cx = rx - bl.vx * tt, cy = ry - bl.vy * tt, lim = b.r + bl.r + 22;
      if (cx * cx + cy * cy < lim * lim) {
        const sp = Math.sqrt(sp2); let px = -bl.vy / sp, py = bl.vx / sp;
        if (px * cx + py * cy < 0) { px = -px; py = -py; }
        ai.dodgeX += px; ai.dodgeY += py; ai.dodgeT = 0.35;
      }
    }
  }
}
function botAim(b, T, d, dt, range) {
  const D = DIFFS[diffKey];
  aimPoint(b, T, D.lead);
  const want = Math.atan2(aimOut.y - b.y, aimOut.x - b.x) + b.ai.err;
  const mt = D.turn * dt;
  b.angle += clamp(angDiff(b.angle, want), -mt, mt);
  const tol = 0.10 + Math.atan2(T.r, Math.max(d, 1));
  return d < range * 0.95 && Math.abs(angDiff(b.angle, want)) < tol;
}
function botControl(b, dt) {
  const ai = b.ai, D = DIFFS[diffKey];
  if (ai.dummy) { b.moveX = 0; b.moveY = 0; b.wantFire = false; return; }
  ai.thinkT -= dt; ai.wanderT -= dt; ai.dodgeT -= dt;
  if (b.points > 0 || offerOf(b) || perkOfferOf(b)) botUpgrade(b);
  if (ai.thinkT <= 0) { ai.thinkT = D.think * rand(0.8, 1.3); botDecide(b); }

  let T = null;
  if (ai.mode === 'flee') { T = ai.fleeFrom && ai.fleeFrom.alive ? ai.fleeFrom : null; if (!T) ai.mode = 'farm'; }
  if (ai.mode === 'heal') { if (!ai.zone || b.hp > b.maxHp * 0.9) ai.mode = 'farm'; }
  else if (ai.mode !== 'flee') { T = ai.target; if (T && (T.isShape ? T.dead : !T.alive)) { ai.target = T = null; } }

  const range = botRange(b);
  let mx = 0, my = 0, fire = false;
  if (ai.mode === 'heal') {
    const z = ai.zone, dx = z.x - b.x, dy = z.y - b.y, d = Math.hypot(dx, dy) || 1;
    if (d > z.r * 0.35) { mx = dx / d; my = dy / d; }
  } else if (T && ai.mode === 'flee') {
    const dx = b.x - T.x, dy = b.y - T.y, d = Math.hypot(dx, dy) || 1;
    mx = dx / d; my = dy / d;
    fire = botAim(b, T, d, dt, range);
  } else if (T) {
    const dx = T.x - b.x, dy = T.y - b.y, d = Math.hypot(dx, dy) || 1, nx = dx / d, ny = dy / d;
    const pref = ai.rammer ? 0 : clamp(range * (T.isShape ? 0.36 : 0.5), 150, 460);
    const rad = clamp((d - pref) / 110, -1, 1);
    const tan = ai.rammer ? 0.12 : 0.55 * (1 - Math.abs(rad) * 0.5);
    mx = nx * rad - ny * ai.orbit * tan; my = ny * rad + nx * ai.orbit * tan;
    fire = botAim(b, T, d, dt, range);
    if (ai.rammer && T.isTank) fire = fire && d < 260;
  } else if (ai.wander) {
    const dx = ai.wander.x - b.x, dy = ai.wander.y - b.y, d = Math.hypot(dx, dy) || 1;
    mx = dx / d * 0.8; my = dy / d * 0.8;
    if (d < 160) ai.wanderT = 0;
    b.angle += clamp(angDiff(b.angle, Math.atan2(my, mx)), -D.turn * dt * 0.5, D.turn * dt * 0.5);
    if (ai.wanderT <= 0) { ai.wander = null; ai.thinkT = 0; }
  }
  if (ai.pick && ai.pick.life > 0 && ai.mode !== 'heal') {          // sbírání bonusů
    const dx = ai.pick.x - b.x, dy = ai.pick.y - b.y, d = Math.hypot(dx, dy) || 1, w = ai.pick.type === 'heal' && b.hp < b.maxHp * 0.65 ? 1.6 : 0.9;
    mx += dx / d * w; my += dy / d * w;
  }
  const M = 300;
  if (b.x < M) mx += (M - b.x) / M * 1.5; else if (b.x > WORLD - M) mx -= (b.x - (WORLD - M)) / M * 1.5;
  if (b.y < M) my += (M - b.y) / M * 1.5; else if (b.y > WORLD - M) my -= (b.y - (WORLD - M)) / M * 1.5;
  for (let i = 0; i < world.zones.length; i++) {                     // vyhýbání se lávě
    const z = world.zones[i]; if (z.type !== 'lava') continue;
    const dx = b.x - z.x, dy = b.y - z.y, d = Math.hypot(dx, dy) || 1, lim = z.r + 120;
    if (d < lim) { const f = (lim - d) / 120 * 1.8; mx += dx / d * f; my += dy / d * f; }
  }
  for (let i = 0; i < tanks.length; i++) {
    const o = tanks[i]; if (o === b || !o.alive || o === T) continue;
    const dx = b.x - o.x, dy = b.y - o.y, d2 = dx * dx + dy * dy, lim = 200 + (o.boss ? 160 : 0);
    if (d2 < lim * lim && d2 > 1) { const d = Math.sqrt(d2), f = (lim - d) / lim * 0.7; mx += dx / d * f; my += dy / d * f; }
  }
  if (ai.dodgeT > 0 && D.dodge > 0) { mx += ai.dodgeX * D.dodge * 1.4; my += ai.dodgeY * D.dodge * 1.4; }
  b.moveX = mx === mx ? mx : 0; b.moveY = my === my ? my : 0;
  b.wantFire = fire;
  b.tx = T ? T.x : b.x; b.ty = T ? T.y : b.y;
  if (ai.mode === 'flee' && T && b.dashCd <= 0 && b.hp < b.maxHp * 0.55 && Math.hypot(T.x - b.x, T.y - b.y) < 380) dash(b);
}

/* ---------- řízení hráče ---------- */
function autoTarget(p) {
  const range = botRange(p) * 0.95;
  let best = null, bd = 1e9;
  for (let i = 0; i < tanks.length; i++) {
    const o = tanks[i]; if (o === p || !o.alive || o.invuln > 0 || !enemy(p, o)) continue;
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    if (d < range && d * 0.6 < bd) { bd = d * 0.6; best = o; }
  }
  const sr = Math.min(range, 800);
  gBody.near(p.x, p.y, sr, tmpA);
  for (let i = 0; i < tmpA.length; i++) {
    const e = tmpA[i]; if (!e.isShape || e.dead || e.type === 'bomb') continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < sr && d < bd) { bd = d; best = e; }
  }
  return best;
}
function controlPlayer(p, dt) {
  const k = input.keys;
  let mx = 0, my = 0;
  if (k.w || k.arrowup) my -= 1;
  if (k.s || k.arrowdown) my += 1;
  if (k.a || k.arrowleft) mx -= 1;
  if (k.d || k.arrowright) mx += 1;
  if (input.stickL) { mx += input.stickL.vx; my += input.stickL.vy; }
  p.moveX = mx; p.moveY = my;
  p.tx = p.x; p.ty = p.y;

  let fire = false;
  const R = input.stickR, zp = view.scale * cam.z;
  if (R) {
    if (R.mag > 0.15) { p.angle = Math.atan2(R.vy, R.vx); p.tx = p.x + Math.cos(p.angle) * 450; p.ty = p.y + Math.sin(p.angle) * 450; }
    fire = R.mag > 0.3;
  } else if (input.mouse.active && !input.touch) {
    const sx = view.w / 2 + (p.x - cam.x) * zp, sy = view.h / 2 + (p.y - cam.y) * zp;
    p.angle = Math.atan2(input.mouse.y - sy, input.mouse.x - sx);
    p.tx = cam.x + (input.mouse.x - view.w / 2) / zp; p.ty = cam.y + (input.mouse.y - view.h / 2) / zp;
    fire = input.mouse.down || !!k[' '];
  } else if (k[' ']) fire = true;

  if (input.auto && !fire) {
    p.autoTimer -= dt;
    if (p.autoTimer <= 0) { p.autoTimer = 0.1; p.autoT = autoTarget(p); }
    const T = p.autoT;
    if (T && (T.isShape ? !T.dead : T.alive)) {
      aimPoint(p, T, 0.9);
      p.angle = Math.atan2(aimOut.y - p.y, aimOut.x - p.x);
      p.tx = T.x; p.ty = T.y; fire = true;
    }
  }
  p.wantFire = fire;
}
