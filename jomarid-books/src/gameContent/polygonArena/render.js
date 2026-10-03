// Vykreslování.
/* =====================================================================
   Vykreslování
   ===================================================================== */
const FONT = "'Chakra Petch', system-ui, -apple-system, 'Segoe UI', sans-serif";
const SHAPE_DRAW = { square: 1.22, tri: 1.28, pent: 1.06, hex: 1.02, gold: 1.22, crystal: 1.1, bomb: 1.08, alpha: 1.04 };

function resize() {
  const ap = $('app'); if (!ap) return;
  const r = ap.getBoundingClientRect();
  view.w = Math.max(200, Math.round(r.width)); view.h = Math.max(200, Math.round(r.height));
  view.dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(view.w * view.dpr); canvas.height = Math.round(view.h * view.dpr);
  view.scale = clamp(Math.min(view.w, view.h) / 640, 0.55, 1.35);
}
function poly(g, x, y, r, n, rot) {
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + i * TAU / n, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    if (i) g.lineTo(px, py); else g.moveTo(px, py);
  }
  g.closePath();
}
function drawTankBody(g, x, y, R, angle, clsId, color, rec, flash, tur) {
  const cls = CLASSES[clsId];
  g.save(); g.translate(x, y); g.rotate(angle);
  g.lineJoin = 'round'; g.lineWidth = Math.max(1.5, R * 0.13);
  g.fillStyle = theme.barrel; g.strokeStyle = theme.barrelStroke;
  for (let i = 0; i < cls.barrels.length; i++) {
    const b = cls.barrels[i]; if (b.turret) continue;
    const len = b.len * R - (rec ? rec[i] * R * 0.18 : 0), w = b.w * R, y0 = b.off * R - w / 2;
    g.save(); g.rotate(b.a); g.beginPath();
    if (b.flare) { g.moveTo(0, y0 + w * 0.22); g.lineTo(len, y0); g.lineTo(len, y0 + w); g.lineTo(0, y0 + w * 0.78); g.closePath(); }
    else g.rect(0, y0, len, w);
    g.fill(); g.stroke(); g.restore();
  }
  if (cls.boss) poly(g, 0, 0, R, cls.bn, 0); else { g.beginPath(); g.arc(0, 0, R, 0, TAU); }
  g.fillStyle = color; g.strokeStyle = shade(color, 0.6); g.lineWidth = Math.max(1.5, R * 0.14);
  g.fill(); g.stroke();
  if (flash) { g.fillStyle = 'rgba(255,255,255,.4)'; g.fill(); }
  if (cls.hasTur) {
    for (let i = 0; i < cls.barrels.length; i++) {
      const b = cls.barrels[i]; if (!b.turret) continue;
      const mx = Math.cos(b.a) * b.dist * R, my = Math.sin(b.a) * b.dist * R, ta = (tur ? tur[i] : angle) - angle;
      const rt = b.tsize * R, bl = b.len * R * 0.55 - (rec ? rec[i] * R * 0.06 : 0), bw = b.w * R * 0.5;
      g.save(); g.translate(mx, my); g.rotate(ta);
      g.fillStyle = theme.barrel; g.strokeStyle = theme.barrelStroke; g.lineWidth = Math.max(1.2, R * 0.08);
      g.beginPath(); g.rect(0, -bw / 2, bl, bw); g.fill(); g.stroke();
      g.beginPath(); g.arc(0, 0, rt, 0, TAU); g.fillStyle = shade(color, 0.78); g.strokeStyle = shade(color, 0.5); g.fill(); g.stroke();
      g.restore();
    }
  }
  g.restore();
}
function drawIcon(g, id, size) {
  g.clearRect(0, 0, size, size);
  const cls = CLASSES[id]; let ext = 1;
  for (const b of cls.barrels) if (!b.turret) ext = Math.max(ext, b.len + Math.abs(b.off) * 0.3);
  const R = Math.min(size * 0.2, (size * 0.46) / (ext + 0.1));
  drawTankBody(g, size / 2, size / 2, R, -PI / 2, id, playerColor(), null, false, null);
}

function updateCamera(dt) {
  let f = null, zt = 1;
  if (state === 'play' && player.alive) { f = player; zt = player.zoomT; }
  else if (state === 'dead' && ui.deadT > 0) f = null;
  else {
    ui.specT -= dt;
    if (!ui.spec || !ui.spec.alive || ui.specT <= 0) {
      let top = null;
      for (const t of tanks) if (t.alive && !t.isPlayer && !t.boss && (!top || t.score > top.score)) top = t;
      ui.spec = top; ui.specT = 6;
    }
    f = ui.spec;
  }
  if (f) {
    const k = 1 - Math.exp(-(f === player ? 12 : 3) * dt);
    cam.x += (f.x - cam.x) * k; cam.y += (f.y - cam.y) * k;
    if (f !== player) zt = f.zoomT || 1;
  }
  cam.z += (zt - cam.z) * (1 - Math.exp(-2.5 * dt));
}

function drawJoystick(s, label) {
  ctx.lineWidth = 2; ctx.strokeStyle = theme.ink; ctx.fillStyle = theme.ink;
  const SR = 58 * save.set.ctl;
  ctx.globalAlpha = 0.22; ctx.beginPath(); ctx.arc(s.ox, s.oy, SR, 0, TAU); ctx.stroke();
  ctx.globalAlpha = 0.34; ctx.beginPath();
  const dx = s.x - s.ox, dy = s.y - s.oy, l = Math.hypot(dx, dy), k = l > SR ? SR / l : 1;
  ctx.arc(s.ox + dx * k, s.oy + dy * k, 26 * save.set.ctl, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
}

function render() {
  const g = ctx, W = view.w, H = view.h, z = view.scale * cam.z, px = 1 / z;
  g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  g.fillStyle = theme.bg; g.fillRect(0, 0, W, H);
  const shx = shake > 0 && save.set.fx ? (Math.random() - 0.5) * shake * 2 : 0, shy = shake > 0 && save.set.fx ? (Math.random() - 0.5) * shake * 2 : 0;
  g.setTransform(view.dpr * z, 0, 0, view.dpr * z, view.dpr * (W / 2 - cam.x * z + shx), view.dpr * (H / 2 - cam.y * z + shy));
  const vx0 = cam.x - W / 2 * px, vx1 = cam.x + W / 2 * px, vy0 = cam.y - H / 2 * px, vy1 = cam.y + H / 2 * px;

  g.fillStyle = theme.arena; g.fillRect(0, 0, WORLD, WORLD);
  const GS = 60, gx0 = Math.max(0, Math.floor(vx0 / GS) * GS), gx1 = Math.min(WORLD, vx1);
  const gy0 = Math.max(0, Math.floor(vy0 / GS) * GS), gy1 = Math.min(WORLD, vy1);
  g.beginPath();
  for (let x = gx0; x <= gx1; x += GS) { g.moveTo(x, Math.max(0, vy0)); g.lineTo(x, Math.min(WORLD, vy1)); }
  for (let y = gy0; y <= gy1; y += GS) { g.moveTo(Math.max(0, vx0), y); g.lineTo(Math.min(WORLD, vx1), y); }
  g.lineWidth = 1.2 * px; g.strokeStyle = theme.grid; g.stroke();
  g.lineWidth = 3 * px; g.strokeStyle = theme.barrelStroke; g.globalAlpha = 0.5; g.strokeRect(0, 0, WORLD, WORLD); g.globalAlpha = 1;

  // zóny
  for (let i = 0; i < world.zones.length; i++) {
    const zn = world.zones[i];
    if (zn.x + zn.r < vx0 || zn.x - zn.r > vx1 || zn.y + zn.r < vy0 || zn.y - zn.r > vy1) continue;
    const pulse = 0.5 + 0.5 * Math.sin(time * 2 + zn.ph);
    const col = zn.type === 'lava' ? '255,96,48' : zn.type === 'ice' ? '158,231,255' : '95,220,122';
    const gr = g.createRadialGradient(zn.x, zn.y, zn.r * 0.2, zn.x, zn.y, zn.r);
    gr.addColorStop(0, 'rgba(' + col + ',' + (zn.type === 'lava' ? 0.22 + 0.16 * pulse : 0.14) + ')'); gr.addColorStop(1, 'rgba(' + col + ',0.34)');
    g.fillStyle = gr; g.beginPath(); g.arc(zn.x, zn.y, zn.r, 0, TAU); g.fill();
    g.lineWidth = 3 * px; g.strokeStyle = 'rgba(' + col + ',' + (0.55 + 0.25 * pulse) + ')'; g.setLineDash([14 * px, 10 * px]); g.stroke(); g.setLineDash([]);
    if (zn.type === 'lava') { g.fillStyle = 'rgba(255,190,90,' + (0.25 + 0.2 * pulse) + ')'; for (let k = 0; k < 5; k++) { const a = zn.ph + k * 1.7 + time * 0.3; g.beginPath(); g.arc(zn.x + Math.cos(a) * zn.r * 0.55, zn.y + Math.sin(a * 1.3) * zn.r * 0.5, 10 + 6 * pulse, 0, TAU); g.fill(); } }
  }
  // tvary
  g.lineJoin = 'round';
  for (let i = 0; i < shapes.length; i++) {
    const s = shapes[i], R = s.r * SHAPE_DRAW[s.type];
    if (s.x + R < vx0 || s.x - R > vx1 || s.y + R < vy0 || s.y - R > vy1) continue;
    poly(g, s.x, s.y, R, s.n, s.rot);
    g.fillStyle = s.color; g.strokeStyle = shade(s.color, 0.62); g.lineWidth = 3; g.fill(); g.stroke();
    if (s.hit > 0) { g.fillStyle = 'rgba(255,255,255,.4)'; g.fill(); }
    if (s.type === 'bomb') { g.fillStyle = 'rgba(255,90,70,' + (0.55 + 0.4 * Math.sin(time * 6 + s.id)) + ')'; g.beginPath(); g.arc(s.x, s.y, R * 0.34, 0, TAU); g.fill(); }
    else if (s.type === 'crystal') { poly(g, s.x, s.y, R * 0.55, 6, s.rot + 0.5); g.fillStyle = 'rgba(255,255,255,.4)'; g.fill(); }
    else if (s.type === 'alpha') { poly(g, s.x, s.y, R * 0.62, 5, s.rot); g.fillStyle = 'rgba(255,255,255,.18)'; g.fill(); g.lineWidth = 3; g.stroke(); }
    else if (s.type === 'gold') { g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(s.x - R * 0.2, s.y - R * 0.5, R * 0.16, R * 0.5); }
    if (s.hp < s.maxHp) {
      const w = s.r * 1.6, bh = 4 * px, by = s.y + R + 7 * px;
      g.fillStyle = 'rgba(0,0,0,.32)'; g.fillRect(s.x - w / 2, by, w, bh);
      g.fillStyle = s.color; g.fillRect(s.x - w / 2, by, w * Math.max(0, s.hp) / s.maxHp, bh);
    }
  }
  // bonusy
  for (let i = 0; i < world.pickups.length; i++) {
    const pu = world.pickups[i];
    if (pu.x + 40 < vx0 || pu.x - 40 > vx1 || pu.y + 40 < vy0 || pu.y - 40 > vy1) continue;
    const PP = PICKS[pu.type], bob = Math.sin(time * 3 + pu.ph) * 3, fade = pu.life < 6 ? (Math.sin(time * 14) > 0 ? 0.35 : 1) : 1;
    g.globalAlpha = 0.28 * fade; g.fillStyle = PP.color; g.beginPath(); g.arc(pu.x, pu.y + bob, pu.r * 1.9, 0, TAU); g.fill();
    g.globalAlpha = fade; g.fillStyle = theme.arena; g.strokeStyle = PP.color; g.lineWidth = 3;
    g.beginPath(); g.arc(pu.x, pu.y + bob, pu.r, 0, TAU); g.fill(); g.stroke();
    drawGlyph(g, PP.ic, pu.x, pu.y + bob, pu.r * 1.15, PP.color); g.globalAlpha = 1;
  }
  // střely
  for (let i = 0; i < bullets.length; i++) {
    const b = bullets[i];
    if (b.x + b.r < vx0 || b.x - b.r > vx1 || b.y + b.r < vy0 || b.y - b.r > vy1) continue;
    g.fillStyle = b.color; g.strokeStyle = shade(b.color, 0.6); g.lineWidth = Math.max(1.5, b.r * 0.3);
    if (b.drone) { poly(g, b.x, b.y, b.r * 1.7, 3, Math.atan2(b.vy, b.vx)); g.fill(); g.stroke(); }
    else if (b.trap) { g.globalAlpha = Math.min(1, b.life / 1.2); poly(g, b.x, b.y, b.r * 1.25, 4, time * 0.9 + b.id); g.fill(); g.stroke(); g.globalAlpha = 1; }
    else if (b.streak) {
      g.strokeStyle = b.color; g.lineCap = 'round'; g.lineWidth = b.r * 1.6; g.globalAlpha = 0.85;
      g.beginPath(); g.moveTo(b.x - b.vx * 0.045, b.y - b.vy * 0.045); g.lineTo(b.x, b.y); g.stroke(); g.lineCap = 'butt'; g.globalAlpha = 1;
    } else if (b.missile) {
      const ang = Math.atan2(b.vy, b.vx);
      g.globalAlpha = 0.5; g.fillStyle = '#ffb04d'; poly(g, b.x - Math.cos(ang) * b.r * 1.7, b.y - Math.sin(ang) * b.r * 1.7, b.r * (0.7 + 0.3 * Math.sin(time * 40 + b.id)), 3, ang + PI); g.fill(); g.globalAlpha = 1;
      g.fillStyle = b.color; g.strokeStyle = shade(b.color, 0.6); g.lineWidth = Math.max(1.5, b.r * 0.3); poly(g, b.x, b.y, b.r * 1.35, 3, ang); g.fill(); g.stroke();
    } else if (b.blast && b.bdmg > b.dmg) {
      g.beginPath(); g.arc(b.x, b.y, b.r, 0, TAU); g.fill(); g.stroke();
      g.strokeStyle = '#ffb04d'; g.lineWidth = 2; g.globalAlpha = 0.5 + 0.5 * Math.sin(time * 18); g.beginPath(); g.arc(b.x, b.y, b.r * 1.4, 0, TAU); g.stroke(); g.globalAlpha = 1;
    } else {
      g.beginPath(); g.arc(b.x, b.y, b.r, 0, TAU); g.fill(); g.stroke();
      if (b.crit) { g.strokeStyle = '#ffe27a'; g.lineWidth = 2; g.beginPath(); g.arc(b.x, b.y, b.r * 1.5, 0, TAU); g.stroke(); }
    }
  }
  // tanky
  for (let i = 0; i < tanks.length; i++) {
    const t = tanks[i];
    if (!t.alive || t.x + t.r * 3 < vx0 || t.x - t.r * 3 > vx1 || t.y + t.r * 3 < vy0 || t.y - t.r * 3 > vy1) continue;
    if (t.invuln > 0) g.globalAlpha = Math.sin(time * 18) > 0 ? 0.5 : 0.85;
    drawTankBody(g, t.x, t.y, t.r, t.angle, t.cls, t.isPlayer ? playerColor(t) : t.color, t.rec, t.hit > 0, t.tur);
    g.globalAlpha = 1;
    if (t.shield > 0) { g.strokeStyle = '#9aa8ff'; g.globalAlpha = 0.35 + 0.4 * Math.min(1, t.shield / (t.maxHp * 0.4)); g.lineWidth = 3 * px; g.beginPath(); g.arc(t.x, t.y, t.r * 1.28, 0, TAU); g.stroke(); g.globalAlpha = 1; }
    if (t.buff.speed > 0 || t.buff.dmg > 0) { g.lineWidth = 2 * px; g.globalAlpha = 0.6; if (t.buff.dmg > 0) { g.strokeStyle = '#f2695f'; g.beginPath(); g.arc(t.x, t.y, t.r * 1.42, 0, TAU); g.stroke(); } if (t.buff.speed > 0) { g.strokeStyle = '#5fd6f2'; g.beginPath(); g.arc(t.x, t.y, t.r * 1.55, 0, TAU); g.stroke(); } g.globalAlpha = 1; }
    if (t.onIce || t.dashT > 0) { g.globalAlpha = 0.25; g.fillStyle = theme.ink; for (let k = 1; k <= 3; k++) { g.beginPath(); g.arc(t.x - t.vx * 0.02 * k, t.y - t.vy * 0.02 * k, t.r * (1 - k * 0.15), 0, TAU); g.fill(); } g.globalAlpha = 1; }
  }
  // částice
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]; g.globalAlpha = Math.max(0, p.life / p.max) * 0.9; g.fillStyle = p.color;
    g.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
  }
  g.globalAlpha = 1;
  for (let i = 0; i < world.rings.length; i++) {
    const rg = world.rings[i]; g.globalAlpha = Math.max(0, rg.life / rg.m) * 0.75; g.strokeStyle = rg.color; g.lineWidth = 5 * px;
    g.beginPath(); g.arc(rg.x, rg.y, Math.max(1, rg.r), 0, TAU); g.stroke();
  }
  g.globalAlpha = 1;
  // jména a životy
  g.textAlign = 'center'; g.textBaseline = 'bottom'; g.lineJoin = 'round';
  for (let i = 0; i < tanks.length; i++) {
    const t = tanks[i];
    if (!t.alive || t.x + 200 < vx0 || t.x - 200 > vx1 || t.y + 200 < vy0 || t.y - 200 > vy1) continue;
    if (t.hp < t.maxHp * 0.999) {
      const w = t.r * 2.2, bh = 5 * px, by = t.y + t.r + 9 * px, f = clamp(t.hp / t.maxHp, 0, 1);
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(t.x - w / 2, by, w, bh);
      g.fillStyle = f > 0.5 ? '#6fdc7a' : f > 0.25 ? '#f2c14b' : '#f2695f'; g.fillRect(t.x - w / 2, by, w * f, bh);
    }
    g.font = '700 ' + 13 * px + 'px ' + FONT; g.lineWidth = 3.5 * px; g.strokeStyle = theme.arena;
    const ny = t.y - t.r - 8 * px;
    g.strokeText(t.name, t.x, ny); g.fillStyle = t.isPlayer ? theme.accent : t.boss ? '#ff6b6b' : t.team && player.team ? (t.team === player.team ? '#7ec3ff' : '#ff8a80') : theme.ink; g.fillText(t.name, t.x, ny);
    g.font = '600 ' + 10 * px + 'px ' + FONT; g.lineWidth = 3 * px;
    const ly = ny - 14 * px; const lv = 'Ú' + t.level;
    g.strokeText(lv, t.x, ly); g.fillStyle = theme.ink; g.globalAlpha = 0.6; g.fillText(lv, t.x, ly); g.globalAlpha = 1;
  }
  // plovoucí texty
  g.font = '700 ' + 15 * px + 'px ' + FONT;
  for (let i = 0; i < texts.length; i++) {
    const p = texts[i]; g.globalAlpha = Math.min(1, p.life / p.max * 1.6);
    g.lineWidth = 3.5 * px; g.strokeStyle = theme.arena; g.strokeText(p.text, p.x, p.y);
    g.fillStyle = p.color; g.fillText(p.text, p.x, p.y);
  }
  g.globalAlpha = 1;

  // dotykové páčky
  g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  if (state === 'play' && world.boss && world.boss.alive) {
    const bx = view.w / 2 + (world.boss.x - cam.x) * z, by = view.h / 2 + (world.boss.y - cam.y) * z;
    if (bx < 20 || bx > view.w - 20 || by < 20 || by > view.h - 20) {
      const a = Math.atan2(by - view.h / 2, bx - view.w / 2), m = 34, ex = clamp(view.w / 2 + Math.cos(a) * 9999, m, view.w - m), ey = clamp(view.h / 2 + Math.sin(a) * 9999, m + 40, view.h - m - 60);
      const sc = Math.min((view.w / 2 - m) / Math.max(1e-3, Math.abs(Math.cos(a))), (view.h / 2 - m - 40) / Math.max(1e-3, Math.abs(Math.sin(a))));
      const ax = view.w / 2 + Math.cos(a) * sc, ay = view.h / 2 + Math.sin(a) * sc;
      g.fillStyle = '#ff4f5e'; g.globalAlpha = 0.85; g.save(); g.translate(ax, ay); g.rotate(a); g.beginPath(); g.moveTo(14, 0); g.lineTo(-9, -10); g.lineTo(-9, 10); g.closePath(); g.fill(); g.restore(); g.globalAlpha = 1;
    }
  }
  if (state === 'play') { if (input.stickL) drawJoystick(input.stickL); if (input.stickR) drawJoystick(input.stickR); }
}

function starPath(g, r, n, ir) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) { const a = -PI / 2 + i * PI / n, rr = i % 2 ? r * ir : r; if (i) g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  g.closePath();
}
function drawGlyph(g, k, cx, cy, s, color) {
  g.save(); g.translate(cx, cy); g.fillStyle = color; g.strokeStyle = color; g.lineWidth = Math.max(1.5, s * 0.16); g.lineCap = 'round'; g.lineJoin = 'round';
  const u = s * 0.5;
  switch (k) {
    case 'plus': g.fillRect(-u * 0.28, -u * 0.85, u * 0.56, u * 1.7); g.fillRect(-u * 0.85, -u * 0.28, u * 1.7, u * 0.56); break;
    case 'star': starPath(g, u, 5, 0.45); g.fill(); break;
    case 'burst': starPath(g, u, 8, 0.5); g.fill(); break;
    case 'spike': starPath(g, u, 6, 0.55); g.fill(); g.beginPath(); g.arc(0, 0, u * 0.3, 0, TAU); g.fillStyle = theme.arena; g.fill(); break;
    case 'heart': g.beginPath(); g.moveTo(0, u * 0.85); g.bezierCurveTo(-u * 1.5, -u * 0.1, -u * 0.7, -u * 1.05, 0, -u * 0.35); g.bezierCurveTo(u * 0.7, -u * 1.05, u * 1.5, -u * 0.1, 0, u * 0.85); g.fill(); break;
    case 'shield': g.beginPath(); g.moveTo(0, -u); g.lineTo(u * 0.85, -u * 0.6); g.lineTo(u * 0.75, u * 0.15); g.quadraticCurveTo(u * 0.5, u * 0.75, 0, u); g.quadraticCurveTo(-u * 0.5, u * 0.75, -u * 0.75, u * 0.15); g.lineTo(-u * 0.85, -u * 0.6); g.closePath(); g.fill(); break;
    case 'bolt': g.beginPath(); g.moveTo(u * 0.25, -u); g.lineTo(-u * 0.65, u * 0.15); g.lineTo(-u * 0.05, u * 0.15); g.lineTo(-u * 0.25, u); g.lineTo(u * 0.65, -u * 0.2); g.lineTo(u * 0.05, -u * 0.2); g.closePath(); g.fill(); break;
    case 'wing': g.beginPath(); g.moveTo(-u, -u * 0.55); g.lineTo(u * 0.1, -u * 0.55); g.moveTo(-u, 0); g.lineTo(u * 0.35, 0); g.moveTo(-u, u * 0.55); g.lineTo(u * 0.1, u * 0.55); g.stroke(); g.beginPath(); g.moveTo(u * 0.3, -u * 0.75); g.lineTo(u, 0); g.lineTo(u * 0.3, u * 0.75); g.closePath(); g.fill(); break;
    case 'clock': g.beginPath(); g.arc(0, 0, u * 0.85, 0, TAU); g.stroke(); g.beginPath(); g.moveTo(0, -u * 0.5); g.lineTo(0, 0); g.lineTo(u * 0.4, u * 0.25); g.stroke(); break;
    case 'target': g.beginPath(); g.arc(0, 0, u * 0.9, 0, TAU); g.stroke(); g.beginPath(); g.arc(0, 0, u * 0.5, 0, TAU); g.stroke(); g.beginPath(); g.arc(0, 0, u * 0.16, 0, TAU); g.fill(); break;
    case 'zig': g.beginPath(); g.moveTo(-u, u * 0.6); g.lineTo(-u * 0.35, -u * 0.55); g.lineTo(u * 0.25, u * 0.45); g.lineTo(u, -u * 0.7); g.stroke(); break;
    case 'arrow': g.beginPath(); g.moveTo(-u, -u * 0.32); g.lineTo(u * 0.15, -u * 0.32); g.lineTo(u * 0.15, -u * 0.75); g.lineTo(u, 0); g.lineTo(u * 0.15, u * 0.75); g.lineTo(u * 0.15, u * 0.32); g.lineTo(-u, u * 0.32); g.closePath(); g.fill(); break;
    case 'magnet': g.lineWidth = Math.max(2, s * 0.22); g.lineCap = 'butt'; g.beginPath(); g.moveTo(-u * 0.7, -u * 0.85); g.lineTo(-u * 0.7, 0); g.arc(0, 0, u * 0.7, PI, 0, true); g.lineTo(u * 0.7, -u * 0.85); g.stroke(); break;
    case 'snow': for (let i = 0; i < 3; i++) { const a = i * PI / 3; g.beginPath(); g.moveTo(Math.cos(a) * u, Math.sin(a) * u); g.lineTo(-Math.cos(a) * u, -Math.sin(a) * u); g.stroke(); } break;
    case 'swarm': for (const [x, y, r] of [[-0.5, -0.4, 0.3], [0.5, -0.4, 0.3], [0, 0.05, 0.34], [-0.5, 0.6, 0.26], [0.5, 0.6, 0.26]]) { g.beginPath(); g.arc(x * u * 1.1, y * u * 1.1, r * u, 0, TAU); g.fill(); } break;
    case 'coin': g.beginPath(); g.arc(0, 0, u * 0.9, 0, TAU); g.fill(); g.strokeStyle = theme.arena; g.lineWidth = Math.max(1, s * 0.09); g.beginPath(); g.arc(0, 0, u * 0.55, 0, TAU); g.stroke(); break;
    case 'fist': g.beginPath(); g.rect(-u * 0.75, -u * 0.55, u * 1.5, u * 1.1); g.fill(); g.strokeStyle = theme.arena; g.lineWidth = Math.max(1, s * 0.08); g.beginPath(); g.moveTo(-u * 0.25, -u * 0.55); g.lineTo(-u * 0.25, u * 0.05); g.moveTo(u * 0.25, -u * 0.55); g.lineTo(u * 0.25, u * 0.05); g.stroke(); break;
    default: g.beginPath(); g.arc(0, 0, u * 0.7, 0, TAU); g.fill();
  }
  g.restore();
}
function drawPerkIcon(cv, id, size) {
  const g = cv.getContext('2d'), P = PERK_BY[id];
  g.clearRect(0, 0, size, size); g.fillStyle = theme.accent; g.globalAlpha = 0.18; g.beginPath(); g.arc(size / 2, size / 2, size * 0.46, 0, TAU); g.fill(); g.globalAlpha = 1;
  drawGlyph(g, P ? P.ic : 'star', size / 2, size / 2, size * 0.5, theme.accent);
}
function drawMini() {
  const S = mini.width, k = S / WORLD, g = mctx;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, S, S);
  g.globalAlpha = 0.85; g.fillStyle = theme.arena; g.fillRect(0, 0, S, S); g.globalAlpha = 1;
  for (const z of world.zones) { g.fillStyle = z.type === 'lava' ? 'rgba(255,96,48,.5)' : z.type === 'ice' ? 'rgba(158,231,255,.4)' : 'rgba(95,220,122,.45)'; g.beginPath(); g.arc(z.x * k, z.y * k, Math.max(2, z.r * k), 0, TAU); g.fill(); }
  const z = view.scale * cam.z;
  g.strokeStyle = theme.ink; g.globalAlpha = 0.35; g.lineWidth = 1.5;
  g.strokeRect((cam.x - view.w / 2 / z) * k, (cam.y - view.h / 2 / z) * k, view.w / z * k, view.h / z * k);
  g.globalAlpha = 1;
  for (const p of world.pickups) { g.fillStyle = PICKS[p.type].color; g.fillRect(p.x * k - 1.5, p.y * k - 1.5, 3, 3); }
  let top = null;
  for (const t of tanks) if (t.alive && !t.boss && (!top || t.score > top.score)) top = t;
  for (const t of tanks) {
    if (!t.alive || t.isPlayer) continue;
    if (t.boss) { g.fillStyle = '#ff4f5e'; g.beginPath(); g.arc(t.x * k, t.y * k, 6.5, 0, TAU); g.fill(); g.strokeStyle = '#ff4f5e'; g.globalAlpha = 0.5 + 0.5 * Math.sin(time * 6); g.lineWidth = 2; g.beginPath(); g.arc(t.x * k, t.y * k, 10, 0, TAU); g.stroke(); g.globalAlpha = 1; continue; }
    g.fillStyle = t.color; g.beginPath(); g.arc(t.x * k, t.y * k, t === top ? 5 : 3.4, 0, TAU); g.fill();
    if (t === top) { g.strokeStyle = theme.ink; g.lineWidth = 1.5; g.stroke(); }
  }
  if (player.alive) {
    g.fillStyle = theme.accent; g.strokeStyle = theme.ink; g.lineWidth = 2;
    g.beginPath(); g.arc(player.x * k, player.y * k, 5.2, 0, TAU); g.fill(); g.stroke();
  }
}
