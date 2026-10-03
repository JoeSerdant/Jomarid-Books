// Vykreslování scény: pozadí, zóny, předměty, částice, překryvy a mini mapa. Jednotlivé předměty kreslí draw.js.
function resize() {
  const ap = $('app'); if (!ap) return;
  const r = ap.getBoundingClientRect();
  view.w = Math.max(200, Math.round(r.width)); view.h = Math.max(200, Math.round(r.height));
  view.dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(view.w * view.dpr); canvas.height = Math.round(view.h * view.dpr);
  view.scale = clamp(Math.min(view.w, view.h) / 640, 0.55, 1.35);
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

function offscreenArrow(g, wx, wy, color, z) {
  const bx = view.w / 2 + (wx - cam.x) * z, by = view.h / 2 + (wy - cam.y) * z;
  if (!(bx < 20 || bx > view.w - 20 || by < 20 || by > view.h - 20)) return;
  const a = Math.atan2(by - view.h / 2, bx - view.w / 2), m = 34;
  const sc = Math.min((view.w / 2 - m) / Math.max(1e-3, Math.abs(Math.cos(a))), (view.h / 2 - m - 40) / Math.max(1e-3, Math.abs(Math.sin(a))));
  const ax = view.w / 2 + Math.cos(a) * sc, ay = view.h / 2 + Math.sin(a) * sc;
  g.fillStyle = color; g.globalAlpha = 0.85; g.save(); g.translate(ax, ay); g.rotate(a); g.beginPath(); g.moveTo(14, 0); g.lineTo(-9, -10); g.lineTo(-9, 10); g.closePath(); g.fill(); g.restore(); g.globalAlpha = 1;
}

// Zóny arény: láva proudí a bublá, led má praskliny a třpyt, oáza vlní hladinu.
function drawZone(g, zn, px) {
  const q = fxState.level, pulse = 0.5 + 0.5 * Math.sin(time * 2 + zn.ph);
  const col = zn.type === 'lava' ? '255,96,48' : zn.type === 'ice' ? '158,231,255' : '95,220,122';
  const gr = g.createRadialGradient(zn.x, zn.y, zn.r * 0.15, zn.x, zn.y, zn.r);
  if (zn.type === 'lava') { gr.addColorStop(0, 'rgba(255,176,70,' + (0.34 + 0.14 * pulse) + ')'); gr.addColorStop(0.7, 'rgba(255,96,48,0.26)'); gr.addColorStop(1, 'rgba(170,34,22,0.4)'); }
  else if (zn.type === 'ice') { gr.addColorStop(0, 'rgba(220,245,255,0.2)'); gr.addColorStop(1, 'rgba(' + col + ',0.34)'); }
  else { gr.addColorStop(0, 'rgba(150,255,170,0.16)'); gr.addColorStop(1, 'rgba(' + col + ',0.34)'); }
  g.fillStyle = gr; g.beginPath(); g.arc(zn.x, zn.y, zn.r, 0, TAU); g.fill();
  if (q >= 1) {
    if (zn.type === 'lava') {
      glowAt(g, zn.x, zn.y, zn.r * 1.3, '#ff6a30', 0.26 + 0.1 * pulse);
      g.strokeStyle = 'rgba(255,210,120,0.42)'; g.lineWidth = 3 * px;
      for (let k = 0; k < 4; k++) { const a0 = time * 0.5 * (k % 2 ? -1 : 1) + zn.ph + k * 1.6; g.beginPath(); g.arc(zn.x, zn.y, zn.r * (0.3 + 0.17 * k), a0, a0 + 0.9); g.stroke(); }
    } else if (zn.type === 'ice') {
      g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 2 * px; g.beginPath();
      for (let k = 0; k < 6; k++) { const a = zn.ph + k * 1.05, r1 = zn.r * (0.25 + 0.5 * ((Math.sin(zn.ph * 7 + k * 2.3) + 1) / 2)); g.moveTo(zn.x + Math.cos(a) * r1 * 0.15, zn.y + Math.sin(a) * r1 * 0.15); g.lineTo(zn.x + Math.cos(a) * r1, zn.y + Math.sin(a) * r1); g.lineTo(zn.x + Math.cos(a + 0.25) * r1 * 1.25, zn.y + Math.sin(a + 0.25) * r1 * 1.25); }
      g.stroke();
    } else {
      g.strokeStyle = 'rgba(190,255,200,0.5)'; g.lineWidth = 2.5 * px;
      for (let k = 0; k < 3; k++) { const t = ((time * 0.3 + k / 3 + zn.ph) % 1); g.globalAlpha = (1 - t) * 0.7; g.beginPath(); g.arc(zn.x, zn.y, zn.r * (0.15 + 0.8 * t), 0, TAU); g.stroke(); }
      g.globalAlpha = 1;
    }
  }
  g.lineWidth = 3 * px; g.strokeStyle = 'rgba(' + col + ',' + (0.55 + 0.25 * pulse) + ')'; g.setLineDash([14 * px, 10 * px]); g.lineDashOffset = -time * 10 * px;
  g.beginPath(); g.arc(zn.x, zn.y, zn.r, 0, TAU); g.stroke(); g.setLineDash([]);
  if (zn.type === 'lava') { g.fillStyle = 'rgba(255,200,100,' + (0.3 + 0.2 * pulse) + ')'; for (let k = 0; k < 5; k++) { const a = zn.ph + k * 1.7 + time * 0.3; g.beginPath(); g.arc(zn.x + Math.cos(a) * zn.r * 0.55, zn.y + Math.sin(a * 1.3) * zn.r * 0.5, 10 + 6 * pulse, 0, TAU); g.fill(); } }
  else if (q >= 1 && zn.type !== 'lava') {                               // třpyt
    for (let k = 0; k < 5; k++) { const tw = 0.5 + 0.5 * Math.sin(time * 3 + k * 1.9 + zn.ph), a = zn.ph + k * 2.4, r1 = zn.r * (0.2 + 0.6 * ((k * 0.37) % 1)); g.fillStyle = 'rgba(255,255,255,' + tw * 0.8 + ')'; g.save(); g.translate(zn.x + Math.cos(a) * r1, zn.y + Math.sin(a) * r1); starPath(g, 4 + 4 * tw, 4, 0.25); g.fill(); g.restore(); }
  }
}

function rrect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arc(x + w - r, y + r, r, -PI / 2, 0); g.lineTo(x + w, y + h - r); g.arc(x + w - r, y + h - r, r, 0, PI / 2);
  g.lineTo(x + r, y + h); g.arc(x + r, y + h - r, r, PI / 2, PI); g.lineTo(x, y + r); g.arc(x + r, y + r, r, PI, PI * 1.5); g.closePath();
}

function render() {
  const g = ctx, W = view.w, H = view.h, z = view.scale * cam.z, px = 1 / z, q = fxState.level;
  g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  g.fillStyle = theme.bg; g.fillRect(0, 0, W, H);
  const shx = shake > 0 && q > 0 ? (Math.random() - 0.5) * shake * 2 : 0, shy = shake > 0 && q > 0 ? (Math.random() - 0.5) * shake * 2 : 0;
  g.setTransform(view.dpr * z, 0, 0, view.dpr * z, view.dpr * (W / 2 - cam.x * z + shx), view.dpr * (H / 2 - cam.y * z + shy));
  const vx0 = cam.x - W / 2 * px, vx1 = cam.x + W / 2 * px, vy0 = cam.y - H / 2 * px, vy1 = cam.y + H / 2 * px;

  // aréna a mřížka
  g.fillStyle = theme.arena; g.fillRect(0, 0, WORLD, WORLD);
  const GS = 60, gx0 = Math.max(0, Math.floor(vx0 / GS) * GS), gx1 = Math.min(WORLD, vx1);
  const gy0 = Math.max(0, Math.floor(vy0 / GS) * GS), gy1 = Math.min(WORLD, vy1);
  g.beginPath();
  for (let x = gx0; x <= gx1; x += GS) if (x % (GS * 5)) { g.moveTo(x, Math.max(0, vy0)); g.lineTo(x, Math.min(WORLD, vy1)); }
  for (let y = gy0; y <= gy1; y += GS) if (y % (GS * 5)) { g.moveTo(Math.max(0, vx0), y); g.lineTo(Math.min(WORLD, vx1), y); }
  g.lineWidth = 1.2 * px; g.strokeStyle = theme.grid; g.stroke();
  if (q >= 1) {                                                              // výraznější čáry po pěti polích
    g.beginPath();
    for (let x = gx0; x <= gx1; x += GS) if (!(x % (GS * 5))) { g.moveTo(x, Math.max(0, vy0)); g.lineTo(x, Math.min(WORLD, vy1)); }
    for (let y = gy0; y <= gy1; y += GS) if (!(y % (GS * 5))) { g.moveTo(Math.max(0, vx0), y); g.lineTo(Math.min(WORLD, vx1), y); }
    g.lineWidth = 2 * px; g.strokeStyle = theme.grid; g.globalAlpha = 0.9; g.stroke(); g.globalAlpha = 1;
    const edge = (x0, y0, x1, y1, w, h) => { const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, rgbaStr(theme.accent, 0.2)); gr.addColorStop(1, rgbaStr(theme.accent, 0)); g.fillStyle = gr; g.fillRect(Math.min(x0, x1), Math.min(y0, y1), w, h); };
    if (vx0 < 140) edge(0, 0, 140, 0, 140, WORLD); if (vx1 > WORLD - 140) edge(WORLD, 0, WORLD - 140, 0, 140, WORLD);
    if (vy0 < 140) edge(0, 0, 0, 140, WORLD, 140); if (vy1 > WORLD - 140) edge(0, WORLD, 0, WORLD - 140, WORLD, 140);
  }
  g.lineWidth = 6 * px; g.strokeStyle = theme.barrelStroke; g.globalAlpha = 0.65; g.strokeRect(0, 0, WORLD, WORLD); g.globalAlpha = 1;

  // zóny
  for (let i = 0; i < world.zones.length; i++) {
    const zn = world.zones[i];
    if (zn.x + zn.r < vx0 || zn.x - zn.r > vx1 || zn.y + zn.r < vy0 || zn.y - zn.r > vy1) continue;
    drawZone(g, zn, px);
  }
  // cíl režimu (kopec...)
  const MD = M();
  if (MD.draw) MD.draw(g, { x0: vx0, y0: vy0, x1: vx1, y1: vy1 }, px);
  // tvary
  g.lineJoin = 'round';
  for (let i = 0; i < shapes.length; i++) {
    const s = shapes[i], R = s.r * SHAPE_DRAW[s.type];
    if (s.x + R * 1.4 < vx0 || s.x - R * 1.4 > vx1 || s.y + R * 1.4 < vy0 || s.y - R * 1.4 > vy1) continue;
    drawShape(g, s, px);
  }
  // bonusy
  for (let i = 0; i < world.pickups.length; i++) {
    const pu = world.pickups[i];
    if (pu.x + 60 < vx0 || pu.x - 60 > vx1 || pu.y + 60 < vy0 || pu.y - 60 > vy1) continue;
    drawPickup(g, pu);
  }
  // stíny tanků
  if (q >= 1) for (let i = 0; i < tanks.length; i++) {
    const t = tanks[i]; if (!t.alive || t.x + t.r * 3 < vx0 || t.x - t.r * 3 > vx1 || t.y + t.r * 3 < vy0 || t.y - t.r * 3 > vy1) continue;
    shadowAt(g, t.x, t.y, t.r * 1.15, 0.6);
  }
  // střely
  for (let i = 0; i < bullets.length; i++) {
    const b = bullets[i];
    if (b.x + b.r < vx0 || b.x - b.r > vx1 || b.y + b.r < vy0 || b.y - b.r > vy1) continue;
    drawBullet(g, b, px);
  }
  // tanky
  for (let i = 0; i < tanks.length; i++) {
    const t = tanks[i];
    if (!t.alive || t.x + t.r * 3 < vx0 || t.x - t.r * 3 > vx1 || t.y + t.r * 3 < vy0 || t.y - t.r * 3 > vy1) continue;
    if (t.burnT > 0) glowAt(g, t.x, t.y, t.r * 2, '#ff7a2a', 0.45);
    if (t.buff.dmg > 0) glowAt(g, t.x, t.y, t.r * 2.2, '#f2695f', 0.3);
    if (t.buff.speed > 0) glowAt(g, t.x, t.y, t.r * 2.2, '#5fd6f2', 0.28);
    if (t.invuln > 0) g.globalAlpha = 0.62 + 0.2 * Math.sin(time * 18);
    drawTankBody(g, t.x, t.y, t.r, t.angle, t.cls, t.isPlayer ? playerColor(t) : t.color, t.rec, t.hit > 0, t.tur);
    g.globalAlpha = 1;
    if (t.invuln > 0) { g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 2 * px; g.setLineDash([8 * px, 8 * px]); g.lineDashOffset = -time * 30 * px; g.beginPath(); g.arc(t.x, t.y, t.r * 1.4, 0, TAU); g.stroke(); g.setLineDash([]); }
    if (t.shield > 0) {
      const sa = 0.35 + 0.4 * Math.min(1, t.shield / (t.maxHp * 0.4)), rr = t.r * 1.3;
      if (q >= 1) { const sg = g.createRadialGradient(t.x, t.y, rr * 0.55, t.x, t.y, rr); sg.addColorStop(0, 'rgba(154,168,255,0)'); sg.addColorStop(1, 'rgba(154,168,255,' + 0.28 * sa + ')'); g.fillStyle = sg; g.beginPath(); g.arc(t.x, t.y, rr, 0, TAU); g.fill(); }
      g.strokeStyle = '#9aa8ff'; g.globalAlpha = sa; g.lineWidth = 3 * px; g.beginPath(); g.arc(t.x, t.y, rr, 0, TAU); g.stroke();
      if (q >= 1) { g.lineWidth = 2 * px; g.globalAlpha = sa * 0.8; g.strokeStyle = '#d8deff'; for (let k = 0; k < 2; k++) { const a = time * 2.4 + k * PI; g.beginPath(); g.arc(t.x, t.y, rr, a, a + 0.8); g.stroke(); } }
      g.globalAlpha = 1;
    }
    if (t.buff.speed > 0 || t.buff.dmg > 0) { g.lineWidth = 2 * px; g.globalAlpha = 0.6; if (t.buff.dmg > 0) { g.strokeStyle = '#f2695f'; g.beginPath(); g.arc(t.x, t.y, t.r * 1.42, 0, TAU); g.stroke(); } if (t.buff.speed > 0) { g.strokeStyle = '#5fd6f2'; g.beginPath(); g.arc(t.x, t.y, t.r * 1.55, 0, TAU); g.stroke(); } g.globalAlpha = 1; }
    if (t.slowT > 0 && t.slowF < 1) { g.strokeStyle = 'rgba(158,231,255,0.8)'; g.lineWidth = 2 * px; g.setLineDash([3 * px, 6 * px]); g.beginPath(); g.arc(t.x, t.y, t.r * 1.22, 0, TAU); g.stroke(); g.setLineDash([]); }
    if (t.onIce || t.dashT > 0) { g.globalAlpha = 0.25; g.fillStyle = theme.ink; for (let k = 1; k <= 3; k++) { g.beginPath(); g.arc(t.x - t.vx * 0.02 * k, t.y - t.vy * 0.02 * k, t.r * (1 - k * 0.15), 0, TAU); g.fill(); } g.globalAlpha = 1; }
  }
  // režimy, které přebarvují celou scénu (bouře)
  if (MD.drawTop) MD.drawTop(g, { x0: vx0, y0: vy0, x1: vx1, y1: vy1 }, px);
  // částice
  let anyAdd = false;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i], f = Math.max(0, p.life / p.max);
    if (p.kind === 1 || p.kind === 4) { anyAdd = true; continue; }
    if (p.kind === 2) { g.globalAlpha = f * 0.3; g.fillStyle = p.color; g.beginPath(); g.arc(p.x, p.y, p.r * (1 + (1 - f) * 1.8), 0, TAU); g.fill(); }
    else if (p.kind === 3) { g.globalAlpha = Math.min(1, f * 1.3); g.fillStyle = p.color; g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.beginPath(); g.moveTo(p.r, 0); g.lineTo(-p.r * 0.7, p.r * 0.8); g.lineTo(-p.r * 0.5, -p.r * 0.8); g.closePath(); g.fill(); g.restore(); }
    else { g.globalAlpha = f * 0.9; g.fillStyle = p.color; g.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2); }
  }
  if (anyAdd) {
    g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i], f = Math.max(0, p.life / p.max);
      if (p.kind === 1) { g.globalAlpha = f; g.strokeStyle = p.color; g.lineWidth = p.r; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045); g.stroke(); }
      else if (p.kind === 4) { g.globalAlpha = f * 0.9; g.drawImage(glowSprite(p.color), p.x - p.r * 2, p.y - p.r * 2, p.r * 4, p.r * 4); }
    }
    g.globalCompositeOperation = 'source-over'; g.lineCap = 'butt';
  }
  g.globalAlpha = 1;
  for (let i = 0; i < world.rings.length; i++) {
    const rg = world.rings[i], f = Math.max(0, rg.life / rg.m);
    if (rg.fill && q >= 1) glowAt(g, rg.x, rg.y, Math.max(2, rg.r) * 1.15, rg.color, f * 0.9);
    g.globalAlpha = f * 0.75; g.strokeStyle = rg.color; g.lineWidth = 5 * px * (0.4 + f * 0.6);
    g.beginPath(); g.arc(rg.x, rg.y, Math.max(1, rg.r), 0, TAU); g.stroke();
  }
  g.globalAlpha = 1;
  // jména a životy
  g.textAlign = 'center'; g.textBaseline = 'bottom'; g.lineJoin = 'round';
  for (let i = 0; i < tanks.length; i++) {
    const t = tanks[i];
    if (!t.alive || t.x + 200 < vx0 || t.x - 200 > vx1 || t.y + 200 < vy0 || t.y - 200 > vy1) continue;
    const hf = clamp(t.hp / t.maxHp, 0, 1);
    if (t.ghost === undefined || t.ghost < hf) t.ghost = hf;                       // bílý "duch" ukazuje, kolik zdraví právě ubylo
    else if (t.ghost > hf) { t.ghost += (hf - t.ghost) * 0.06; if (t.ghost - hf < 0.002) t.ghost = hf; }
    if (hf < 0.999 || t.ghost > hf + 0.002) {
      const w = t.r * 2.2, bh = 6 * px, by = t.y + t.r + 9 * px, f = hf;
      g.fillStyle = 'rgba(0,0,0,.45)'; rrect(g, t.x - w / 2 - px, by - px, w + 2 * px, bh + 2 * px, 3 * px); g.fill();
      if (t.ghost > f) { g.fillStyle = 'rgba(255,255,255,.55)'; rrect(g, t.x - w / 2, by, w * t.ghost, bh, 2.5 * px); g.fill(); }
      g.fillStyle = f > 0.5 ? '#6fdc7a' : f > 0.25 ? '#f2c14b' : '#f2695f'; rrect(g, t.x - w / 2, by, Math.max(2 * px, w * f), bh, 2.5 * px); g.fill();
    }
    g.font = '700 ' + 13 * px + 'px ' + FONT; g.lineWidth = 3.5 * px; g.strokeStyle = theme.arena;
    const ny = t.y - t.r - 8 * px;
    g.strokeText(t.name, t.x, ny); g.fillStyle = t.isPlayer ? theme.accent : t.boss ? '#ff6b6b' : t.team && player.team ? (t.team === player.team ? '#7ec3ff' : '#ff8a80') : theme.ink; g.fillText(t.name, t.x, ny);
    g.font = '600 ' + 10 * px + 'px ' + FONT; g.lineWidth = 3 * px;
    const ly = ny - 14 * px; const lv = 'Ú' + t.level;
    g.strokeText(lv, t.x, ly); g.fillStyle = theme.ink; g.globalAlpha = 0.6; g.fillText(lv, t.x, ly); g.globalAlpha = 1;
  }
  // plovoucí texty
  for (let i = 0; i < texts.length; i++) {
    const p = texts[i], f = p.life / p.max, pop = 1 + 0.45 * Math.max(0, (f - 0.82) / 0.18);
    g.font = '700 ' + 15 * px * pop + 'px ' + FONT;
    g.globalAlpha = Math.min(1, f * 1.6);
    g.lineWidth = 3.5 * px; g.strokeStyle = theme.arena; g.strokeText(p.text, p.x, p.y);
    g.fillStyle = p.color; g.fillText(p.text, p.x, p.y);
  }
  g.globalAlpha = 1;

  // vrstva přes obrazovku
  g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  const low = player && player.alive && state === 'play' ? clamp(1 - player.hp / (player.maxHp * 0.3), 0, 1) : 0;
  const vig = clamp(ui.vig * 0.6 + low * (0.22 + 0.12 * Math.sin(time * 6)), 0, 0.7);
  if (vig > 0.01 && q > 0) {
    const vgr = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.hypot(W, H) * 0.58);
    vgr.addColorStop(0, 'rgba(220,40,40,0)'); vgr.addColorStop(1, 'rgba(220,40,40,' + vig + ')');
    g.fillStyle = vgr; g.fillRect(0, 0, W, H);
  }
  if (state === 'play') {
    if (world.boss && world.boss.alive) offscreenArrow(g, world.boss.x, world.boss.y, '#ff4f5e', z);
    const tg = MD.target && MD.target(); if (tg) offscreenArrow(g, tg.x, tg.y, tg.color, z);
    if (input.stickL) drawJoystick(input.stickL); if (input.stickR) drawJoystick(input.stickR);
  }
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
  g.globalAlpha = 0.88; g.fillStyle = theme.arena; g.fillRect(0, 0, S, S); g.globalAlpha = 1;
  for (const z of world.zones) { g.fillStyle = z.type === 'lava' ? 'rgba(255,96,48,.5)' : z.type === 'ice' ? 'rgba(158,231,255,.4)' : 'rgba(95,220,122,.45)'; g.beginPath(); g.arc(z.x * k, z.y * k, Math.max(2, z.r * k), 0, TAU); g.fill(); }
  { const MD = M(); if (MD.mini) MD.mini(g, k); }
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
    g.strokeStyle = t === top ? theme.ink : 'rgba(0,0,0,0.45)'; g.lineWidth = t === top ? 1.5 : 1; g.stroke();
  }
  if (player.alive) {
    g.save(); g.translate(player.x * k, player.y * k); g.rotate(player.angle);
    g.fillStyle = theme.accent; g.strokeStyle = theme.ink; g.lineWidth = 1.6; g.beginPath(); g.moveTo(7, 0); g.lineTo(-4.6, -4.6); g.lineTo(-2.6, 0); g.lineTo(-4.6, 4.6); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }
  g.strokeStyle = theme.barrelStroke; g.globalAlpha = 0.7; g.lineWidth = 2; g.strokeRect(1, 1, S - 2, S - 2); g.globalAlpha = 1;
}
