// Kreslení tanků, tvarů, střel a bonusů (samotné předměty; scénu skládá render.js).
const FONT = "'Chakra Petch', system-ui, -apple-system, 'Segoe UI', sans-serif";
const SHAPE_DRAW = { square: 1.22, tri: 1.28, pent: 1.06, hex: 1.02, gold: 1.22, crystal: 1.1, bomb: 1.08, alpha: 1.04 };
const DEFAULT_LOOK = { n: 0, rot: 0, spikes: 0, fins: 0, plates: 0, trim: '', tone: '' };

function poly(g, x, y, r, n, rot) {
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + i * TAU / n, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    if (i) g.lineTo(px, py); else g.moveTo(px, py);
  }
  g.closePath();
}
const easeOutBack = t => { const u = t - 1; return 1 + 2.70158 * u * u * u + 1.70158 * u * u; };

/* ---------- tank ---------- */
// Jedna hlaveň v souřadnicích těla tanku (už otočeného ve směru střelby). rec = zpětný ráz 0-1 (po výstřelu klesá).
function drawBarrel(g, b, R, rec, q) {
  const len = b.len * R - rec * R * 0.2, w = b.w * R, y0 = b.off * R - w / 2, lw = Math.max(1.5, R * 0.1);
  const base = theme.barrel, edge = theme.barrelStroke;
  g.save(); g.rotate(b.a);
  g.lineWidth = lw; g.strokeStyle = edge; g.fillStyle = base;
  g.beginPath();
  if (b.kind === 'missile') {                                       // trubice s kuželem a ploutvemi
    const t = w * 0.78, ty = b.off * R - t / 2;
    g.moveTo(0, ty); g.lineTo(len * 0.78, ty); g.lineTo(len, b.off * R); g.lineTo(len * 0.78, ty + t); g.lineTo(0, ty + t); g.closePath();
  } else if (b.kind === 'trap' || b.flare) {                        // rozšiřující se hlaveň
    g.moveTo(0, y0 + w * 0.22); g.lineTo(len, y0 - (b.kind === 'trap' ? w * 0.08 : 0)); g.lineTo(len, y0 + w + (b.kind === 'trap' ? w * 0.08 : 0)); g.lineTo(0, y0 + w * 0.78); g.closePath();
  } else g.rect(0, y0, len, w);
  g.fill(); g.stroke();
  if (q >= 1) {                                                      // odlesk a stín podél hlavně
    g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(len * 0.04, y0 + w * 0.12, len * 0.9, w * 0.2);
    g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(len * 0.04, y0 + w * 0.68, len * 0.9, w * 0.2);
  }
  g.fillStyle = edge; g.strokeStyle = edge;
  if (b.kind === 'drone') {                                          // zásobník dronů: šipky u ústí
    g.lineWidth = Math.max(1.2, lw * 0.7); g.beginPath();
    for (const k of [0.62, 0.8]) { g.moveTo(len * (k - 0.07), y0 + w * 0.22); g.lineTo(len * k, b.off * R); g.lineTo(len * (k - 0.07), y0 + w * 0.78); }
    g.stroke();
  } else if (b.kind === 'trap') {                                    // hlava s pastí
    g.fillRect(len * 0.78, y0 - w * 0.14, len * 0.22, w * 1.28);
  } else if (b.kind === 'bomb') {                                    // minomet: tlusté pásy
    g.fillRect(len * 0.28, y0 - w * 0.06, len * 0.09, w * 1.12); g.fillRect(len * 0.82, y0 - w * 0.1, len * 0.1, w * 1.2);
  } else if (b.kind === 'missile') {
    g.beginPath(); g.moveTo(0, b.off * R - w * 0.62); g.lineTo(len * 0.26, b.off * R - w * 0.36); g.lineTo(0, b.off * R - w * 0.1); g.closePath();
    g.moveTo(0, b.off * R + w * 0.62); g.lineTo(len * 0.26, b.off * R + w * 0.36); g.lineTo(0, b.off * R + w * 0.1); g.closePath(); g.fill();
  } else if (!b.flare) g.fillRect(len * 0.9, y0 - w * 0.04, len * 0.1, w * 1.08);      // ústí hlavně
  // značky druhu střel
  const cy = b.off * R;
  if (b.pierce >= 2 || b.streak) {                                    // cívky průrazné hlavně
    g.strokeStyle = tint(theme.barrel, 0.55); g.lineWidth = Math.max(1, lw * 0.55); g.beginPath();
    for (const k of [0.3, 0.46, 0.62]) { g.moveTo(len * k, y0 + w * 0.06); g.lineTo(len * k, y0 + w * 0.94); }
    g.stroke();
  }
  if (b.bounce > 0) {                                                 // pružina
    g.strokeStyle = '#7fe0c0'; g.lineWidth = Math.max(1, lw * 0.55); g.beginPath();
    for (let k = 0; k < 4; k++) { const x0 = len * (0.2 + k * 0.1); g.moveTo(x0, y0 + w * 0.08); g.lineTo(x0 + len * 0.06, y0 + w * 0.92); }
    g.stroke();
  }
  if (b.blast && b.kind !== 'bomb') {                                 // výbušná koule v ústí
    g.fillStyle = '#ff9a4d'; g.strokeStyle = edge; g.lineWidth = Math.max(1, lw * 0.6);
    g.beginPath(); g.arc(len, cy, w * 0.52, 0, TAU); g.fill(); g.stroke();
  }
  if (b.slow) { g.fillStyle = '#9ee7ff'; g.beginPath(); g.moveTo(len + w * 0.28, cy); g.lineTo(len, cy - w * 0.4); g.lineTo(len - w * 0.2, cy); g.lineTo(len, cy + w * 0.4); g.closePath(); g.fill(); }
  if (b.burn) { g.fillStyle = '#ff7a2a'; g.beginPath(); g.arc(len, cy, w * 0.32, 0, TAU); g.fill(); }
  if (b.knock > 1) { g.fillStyle = tint(theme.barrel, 0.15); g.strokeStyle = edge; g.lineWidth = Math.max(1, lw * 0.6); g.fillRect(len - w * 0.18, y0 - w * 0.16, w * 0.34, w * 1.32); g.strokeRect(len - w * 0.18, y0 - w * 0.16, w * 0.34, w * 1.32); }
  if (rec > 0.55 && q >= 1) glowAt(g, len + R * 0.18, cy, R * (0.55 + 0.55 * rec), '#ffe9a8', 0.85 * rec);   // záblesk výstřelu
  g.restore();
}

function bodyPath(g, R, cls, L) {
  if (cls.boss) poly(g, 0, 0, R, cls.bn, 0);
  else if (L.n >= 3) poly(g, 0, 0, R * (L.n === 3 ? 1.3 : L.n === 4 ? 1.1 : 1.04), L.n, L.rot || 0);       // trojúhelník je větší, ať jeho strany nejsou daleko uvnitř zásahového kruhu
  else { g.beginPath(); g.arc(0, 0, R, 0, TAU); }
}

// Tělo tanku s hlavněmi. q = kvalita (0 plochá, 1 střední, 2 plná); bez zadání se bere aktuální nastavení hry.
function drawTankBody(g, x, y, R, angle, clsId, color, rec, flash, tur, q) {
  const cls = CLASSES[clsId], L = cls.look || DEFAULT_LOOK, tone = L.tone || tint(color, 0.6);
  if (q === undefined) q = fxState.level;
  g.save(); g.translate(x, y); g.rotate(angle);
  g.lineJoin = 'round';
  // hlavně pod tělem
  for (let i = 0; i < cls.barrels.length; i++) { const b = cls.barrels[i]; if (!b.turret) drawBarrel(g, b, R, rec ? rec[i] : 0, q); }
  // ostny a ploutve za tělem
  const dark = deepen(color, 0.4), mid = deepen(color, 0.25);
  if (L.spikes) {
    g.fillStyle = mid; g.strokeStyle = dark; g.lineWidth = Math.max(1.2, R * 0.1);
    for (let k = 0; k < L.spikes; k++) {
      const a = k * TAU / L.spikes + (L.rot || 0) + 0.3;
      g.beginPath(); g.moveTo(Math.cos(a - 0.2) * R * 0.92, Math.sin(a - 0.2) * R * 0.92); g.lineTo(Math.cos(a) * R * 1.34, Math.sin(a) * R * 1.34); g.lineTo(Math.cos(a + 0.2) * R * 0.92, Math.sin(a + 0.2) * R * 0.92); g.closePath(); g.fill(); g.stroke();
    }
  }
  if (L.fins) {
    g.fillStyle = tone; g.strokeStyle = dark; g.lineWidth = Math.max(1.2, R * 0.09);
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(-R * 0.35, s * R * 0.8); g.lineTo(-R * 1.12, s * R * 1.12); g.lineTo(-R * 0.82, s * R * 0.4); g.closePath(); g.fill(); g.stroke(); }
  }
  // tělo
  bodyPath(g, R, cls, L);
  if (q >= 1) {                                                       // osvětlení stojí na místě bez ohledu na otočení tanku
    const ca = Math.cos(angle), sa = Math.sin(angle), ox = -R * 0.32, oy = -R * 0.34;
    const lx = ox * ca + oy * sa, ly = -ox * sa + oy * ca;
    const gr = g.createRadialGradient(lx, ly, R * 0.08, 0, 0, R * 1.08);
    gr.addColorStop(0, tint(color, 0.42)); gr.addColorStop(0.55, color); gr.addColorStop(1, deepen(color, 0.3));
    g.fillStyle = gr;
  } else g.fillStyle = color;
  g.strokeStyle = deepen(color, 0.4); g.lineWidth = Math.max(1.5, R * 0.14);
  g.fill(); g.stroke();
  // desky na obvodu
  if (L.plates) {
    g.strokeStyle = deepen(color, 0.5); g.lineWidth = R * 0.2; g.lineCap = 'round';
    for (let k = 0; k < L.plates; k++) { const a = k * TAU / L.plates + (L.rot || 0) + 0.2; g.beginPath(); g.arc(0, 0, R * 0.9, a - 0.3, a + 0.3); g.stroke(); }
    g.lineCap = 'butt';
  }
  // zdobení uvnitř
  g.lineCap = 'butt';
  switch (L.trim) {
    case 'ring': g.strokeStyle = rgbaStr(tone, 0.65); g.lineWidth = R * 0.11; g.beginPath(); g.arc(0, 0, R * 0.62, 0, TAU); g.stroke(); break;
    case 'stripe': g.fillStyle = rgbaStr(tone, 0.5); g.fillRect(-R * 0.86, -R * 0.13, R * 1.72, R * 0.26); break;
    case 'dots': g.fillStyle = rgbaStr(tone, 0.8); for (let k = 0; k < 6; k++) { const a = k * TAU / 6; g.beginPath(); g.arc(Math.cos(a) * R * 0.6, Math.sin(a) * R * 0.6, R * 0.085, 0, TAU); g.fill(); } break;
    case 'core': g.fillStyle = rgbaStr(tone, 0.55); g.beginPath(); g.arc(0, 0, R * 0.38, 0, TAU); g.fill(); g.strokeStyle = rgbaStr(tone, 0.9); g.lineWidth = R * 0.06; g.stroke(); break;
    case 'cross': g.strokeStyle = rgbaStr(tone, 0.6); g.lineWidth = R * 0.1; g.beginPath(); g.moveTo(-R * 0.62, 0); g.lineTo(R * 0.62, 0); g.moveTo(0, -R * 0.62); g.lineTo(0, R * 0.62); g.stroke(); break;
    default: if (q >= 1) { g.fillStyle = 'rgba(255,255,255,0.1)'; g.beginPath(); g.arc(0, 0, R * 0.42, 0, TAU); g.fill(); }
  }
  if (cls.boss && q >= 1) {                                           // bossové: vnitřní jádro
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = R * 0.06; poly(g, 0, 0, R * 0.62, cls.bn, 0); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.arc(0, 0, R * 0.22, 0, TAU); g.fill();
  }
  if (flash) { g.fillStyle = 'rgba(255,255,255,.42)'; bodyPath(g, R, cls, L); g.fill(); }
  // věže nad tělem
  if (cls.hasTur) {
    for (let i = 0; i < cls.barrels.length; i++) {
      const b = cls.barrels[i]; if (!b.turret) continue;
      const mx = Math.cos(b.a) * b.dist * R, my = Math.sin(b.a) * b.dist * R, ta = (tur ? tur[i] : angle) - angle;
      const rt = b.tsize * R, r = rec ? rec[i] : 0, bl = b.len * R * 0.55 - r * R * 0.06, bw = b.w * R * 0.5;
      g.save(); g.translate(mx, my); g.rotate(ta);
      g.fillStyle = theme.barrel; g.strokeStyle = theme.barrelStroke; g.lineWidth = Math.max(1.2, R * 0.08);
      g.beginPath(); g.rect(0, -bw / 2, bl, bw); g.fill(); g.stroke();
      g.beginPath(); g.arc(0, 0, rt, 0, TAU);
      if (q >= 1) { const gr = g.createRadialGradient(-rt * 0.3, -rt * 0.3, rt * 0.1, 0, 0, rt); gr.addColorStop(0, tint(color, 0.3)); gr.addColorStop(1, deepen(color, 0.28)); g.fillStyle = gr; } else g.fillStyle = shade(color, 0.78);
      g.strokeStyle = deepen(color, 0.5); g.fill(); g.stroke();
      if (q >= 1) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.arc(0, 0, rt * 0.32, 0, TAU); g.fill(); }
      if (r > 0.55 && q >= 1) glowAt(g, bl, 0, rt * (1 + r), '#ffe9a8', 0.8 * r);
      g.restore();
    }
  }
  g.restore();
}

// Ikona třídy (karty výběru, sbírka). Vždy v plné kvalitě.
function drawIcon(g, id, size) {
  g.clearRect(0, 0, size, size);
  const cls = CLASSES[id]; let ext = 1;
  for (const b of cls.barrels) if (!b.turret) ext = Math.max(ext, Math.hypot(b.len, Math.abs(b.off) + b.w / 2) + (b.blast && b.kind !== 'bomb' ? b.w * 0.52 : 0));
  const R = Math.min(size * 0.2, (size * 0.46) / (ext + 0.1));
  drawTankBody(g, size / 2, size / 2, R, -PI / 2, id, playerColor(), null, false, null, 2);
}

/* ---------- tvary ---------- */
function drawShape(g, s, px) {
  const q = fxState.level, age = time - (s.born || 0), sc = age < 0.3 ? 0.4 + 0.6 * easeOutBack(age / 0.3) : 1;
  const R = s.r * (SHAPE_DRAW[s.type] || 1) * sc, col = s.color, wob = s.hit > 0 ? 1 + 0.08 * Math.sin(s.hit * 90) : 1;
  const Rw = R * wob;
  if (q >= 2) {
    if (s.type === 'gold') glowAt(g, s.x, s.y, Rw * 2.4, '#ffd34d', 0.4 + 0.15 * Math.sin(time * 4 + s.id));
    else if (s.type === 'crystal') glowAt(g, s.x, s.y, Rw * 2.6, '#5cc8ff', 0.5 + 0.2 * Math.sin(time * 3 + s.id));
    else if (s.type === 'alpha') glowAt(g, s.x, s.y, Rw * 2.2, '#b46cf2', 0.5 + 0.2 * Math.sin(time * 2));
    shadowAt(g, s.x, s.y, Rw * 0.95, 0.5);
  }
  poly(g, s.x, s.y, Rw, s.n, s.rot);
  if (q >= 1) {
    const gr = g.createRadialGradient(s.x - Rw * 0.35, s.y - Rw * 0.4, Rw * 0.1, s.x, s.y, Rw * 1.1);
    gr.addColorStop(0, tint(col, 0.45)); gr.addColorStop(0.6, col); gr.addColorStop(1, deepen(col, 0.28));
    g.fillStyle = gr;
  } else g.fillStyle = col;
  g.strokeStyle = deepen(col, 0.42); g.lineWidth = 3; g.fill(); g.stroke();
  if (q >= 1) {
    g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 1.5; poly(g, s.x, s.y, Rw * 0.62, s.n, s.rot); g.stroke();
    if (s.n >= 5) { g.beginPath(); for (let k = 0; k < s.n; k++) { const a = s.rot + k * TAU / s.n; g.moveTo(s.x, s.y); g.lineTo(s.x + Math.cos(a) * Rw * 0.9, s.y + Math.sin(a) * Rw * 0.9); } g.strokeStyle = 'rgba(255,255,255,0.12)'; g.stroke(); }
  }
  if (s.hit > 0) { g.fillStyle = 'rgba(255,255,255,.4)'; poly(g, s.x, s.y, Rw, s.n, s.rot); g.fill(); }
  if (s.type === 'bomb') {
    const pulse = 0.55 + 0.4 * Math.sin(time * (s.hp < s.maxHp ? 11 : 6) + s.id);
    glowAt(g, s.x, s.y, Rw * 1.5, '#ff4a3a', 0.45 * pulse);
    g.fillStyle = 'rgba(255,90,70,' + pulse + ')'; g.beginPath(); g.arc(s.x, s.y, Rw * 0.34, 0, TAU); g.fill();
  } else if (s.type === 'crystal') {
    poly(g, s.x, s.y, Rw * 0.55, 6, s.rot + 0.5); g.fillStyle = 'rgba(255,255,255,.4)'; g.fill();
    if (q >= 2) { const tw = 0.5 + 0.5 * Math.sin(time * 5 + s.id * 2); g.fillStyle = 'rgba(255,255,255,' + tw + ')'; g.save(); g.translate(s.x - Rw * 0.35, s.y - Rw * 0.4); starPath(g, 5 + 3 * tw, 4, 0.3); g.fill(); g.restore(); }
  } else if (s.type === 'alpha') {
    poly(g, s.x, s.y, Rw * 0.62, 5, s.rot + time * 0.6); g.fillStyle = 'rgba(255,255,255,.18)'; g.fill(); g.lineWidth = 3; g.stroke();
  } else if (s.type === 'gold' && q >= 2) {                              // lesk přejíždějící po zlatě
    g.save(); poly(g, s.x, s.y, Rw, s.n, s.rot); g.clip();
    const sweep = ((time * 0.8 + s.id * 0.37) % 2.4) - 0.7;
    g.fillStyle = 'rgba(255,255,255,0.42)'; g.translate(s.x + sweep * Rw * 2, s.y); g.rotate(0.6); g.fillRect(-Rw * 0.18, -Rw * 2, Rw * 0.36, Rw * 4);
    g.restore();
  } else if (s.type === 'gold') { g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(s.x - Rw * 0.2, s.y - Rw * 0.5, Rw * 0.16, Rw * 0.5); }
  if (s.hp < s.maxHp) {
    const w = s.r * 1.6, bh = 4 * px, by = s.y + Rw + 7 * px;
    g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(s.x - w / 2 - px, by - px, w + 2 * px, bh + 2 * px);
    g.fillStyle = col; g.fillRect(s.x - w / 2, by, w * Math.max(0, s.hp) / s.maxHp, bh);
  }
}

/* ---------- střely ---------- */
function drawBullet(g, b, px) {
  const q = fxState.level, col = b.color;
  if (q >= 1 && !b.trap) glowAt(g, b.x, b.y, b.r * (b.missile || b.blast ? 4.4 : 3.3), col, b.drone ? 0.3 : 0.5);
  if (q >= 1 && !b.drone && !b.trap && !b.bomb && !b.streak) {         // stopa za střelou
    const k = b.missile ? 0.06 : 0.045, tx = b.x - b.vx * k, ty = b.y - b.vy * k;
    g.lineCap = 'round'; g.strokeStyle = rgbaStr(col, 0.2); g.lineWidth = b.r * 1.7; g.beginPath(); g.moveTo(tx, ty); g.lineTo(b.x, b.y); g.stroke();
    g.strokeStyle = rgbaStr(col, 0.38); g.lineWidth = b.r * 0.9; g.beginPath(); g.moveTo(b.x - b.vx * k * 0.6, b.y - b.vy * k * 0.6); g.lineTo(b.x, b.y); g.stroke(); g.lineCap = 'butt';
  }
  g.fillStyle = col; g.strokeStyle = deepen(col, 0.4); g.lineWidth = Math.max(1.5, b.r * 0.3);
  if (b.drone) {
    const ang = Math.atan2(b.vy, b.vx);
    if (q >= 1) glowAt(g, b.x - Math.cos(ang) * b.r * 1.4, b.y - Math.sin(ang) * b.r * 1.4, b.r * 2, '#ffe9a8', 0.35);
    poly(g, b.x, b.y, b.r * 1.7, 3, ang); g.fill(); g.stroke();
    if (q >= 1) { g.fillStyle = 'rgba(255,255,255,0.3)'; poly(g, b.x, b.y, b.r * 0.8, 3, ang); g.fill(); }
  } else if (b.trap) {
    g.globalAlpha = Math.min(1, b.life / 1.2);
    const rot = time * 0.9 + b.id;
    poly(g, b.x, b.y, b.r * 1.25, 4, rot); g.fill(); g.stroke();
    if (q >= 1) { g.strokeStyle = rgbaStr(col, 0.5 + 0.3 * Math.sin(time * 4 + b.id)); g.lineWidth = 1.5; poly(g, b.x, b.y, b.r * 1.8, 4, -rot); g.stroke(); }
    g.globalAlpha = 1;
  } else if (b.streak) {
    g.strokeStyle = col; g.lineCap = 'round'; g.lineWidth = b.r * 1.6; g.globalAlpha = 0.85;
    g.beginPath(); g.moveTo(b.x - b.vx * 0.05, b.y - b.vy * 0.05); g.lineTo(b.x, b.y); g.stroke();
    if (q >= 1) { g.strokeStyle = '#ffffff'; g.lineWidth = b.r * 0.6; g.globalAlpha = 0.7; g.beginPath(); g.moveTo(b.x - b.vx * 0.03, b.y - b.vy * 0.03); g.lineTo(b.x, b.y); g.stroke(); }
    g.lineCap = 'butt'; g.globalAlpha = 1;
  } else if (b.bomb) {                                                 // bomba: tmavá koule s doutnákem
    g.fillStyle = deepen(col, 0.35); g.beginPath(); g.arc(b.x, b.y, b.r, 0, TAU); g.fill(); g.stroke();
    const ft = 0.6 + 0.4 * Math.sin(time * 30 + b.id);
    glowAt(g, b.x + b.r * 0.4, b.y - b.r * 0.45, b.r * 1.5, '#ffb04d', 0.7 * ft);
    g.fillStyle = '#ffd27a'; g.beginPath(); g.arc(b.x + b.r * 0.4, b.y - b.r * 0.45, b.r * 0.26, 0, TAU); g.fill();
    if (b.blast) { g.strokeStyle = '#ffb04d'; g.lineWidth = 2; g.globalAlpha = 0.45 + 0.4 * Math.sin(time * 14 + b.id); g.beginPath(); g.arc(b.x, b.y, b.r * 1.45, 0, TAU); g.stroke(); g.globalAlpha = 1; }
  } else if (b.missile) {
    const ang = Math.atan2(b.vy, b.vx);
    glowAt(g, b.x - Math.cos(ang) * b.r * 1.7, b.y - Math.sin(ang) * b.r * 1.7, b.r * 3, '#ffb04d', 0.6);
    g.globalAlpha = 0.5; g.fillStyle = '#ffb04d'; poly(g, b.x - Math.cos(ang) * b.r * 1.7, b.y - Math.sin(ang) * b.r * 1.7, b.r * (0.7 + 0.3 * Math.sin(time * 40 + b.id)), 3, ang + PI); g.fill(); g.globalAlpha = 1;
    g.fillStyle = col; g.strokeStyle = deepen(col, 0.4); g.lineWidth = Math.max(1.5, b.r * 0.3); poly(g, b.x, b.y, b.r * 1.35, 3, ang); g.fill(); g.stroke();
  } else {
    g.beginPath(); g.arc(b.x, b.y, b.r, 0, TAU); g.fill(); g.stroke();
    if (q >= 1) { g.fillStyle = 'rgba(255,255,255,0.4)'; g.beginPath(); g.arc(b.x - b.r * 0.28, b.y - b.r * 0.3, b.r * 0.38, 0, TAU); g.fill(); }
    if (b.blast && b.bdmg > b.dmg) { g.strokeStyle = '#ffb04d'; g.lineWidth = 2; g.globalAlpha = 0.5 + 0.5 * Math.sin(time * 18); g.beginPath(); g.arc(b.x, b.y, b.r * 1.4, 0, TAU); g.stroke(); g.globalAlpha = 1; }
    if (b.crit) { g.strokeStyle = '#ffe27a'; g.lineWidth = 2; g.beginPath(); g.arc(b.x, b.y, b.r * 1.5, 0, TAU); g.stroke(); }
    if (b.slow) { g.strokeStyle = '#9ee7ff'; g.lineWidth = 1.6; g.beginPath(); g.arc(b.x, b.y, b.r * 1.35, 0, TAU); g.stroke(); }
    if (b.burn) { g.fillStyle = '#ff7a2a'; g.beginPath(); g.arc(b.x, b.y, b.r * 0.45, 0, TAU); g.fill(); }
  }
}

/* ---------- bonusy ---------- */
function drawPickup(g, pu) {
  const q = fxState.level, PP = PICKS[pu.type], bob = Math.sin(time * 3 + pu.ph) * 3, fade = pu.life < 6 ? (Math.sin(time * 14) > 0 ? 0.35 : 1) : 1, y = pu.y + bob;
  if (q >= 1) { glowAt(g, pu.x, y, pu.r * 3, PP.color, 0.5 * fade); shadowAt(g, pu.x, pu.y + 4, pu.r * 1.1, 0.4 * fade); }
  else { g.globalAlpha = 0.28 * fade; g.fillStyle = PP.color; g.beginPath(); g.arc(pu.x, y, pu.r * 1.9, 0, TAU); g.fill(); }
  g.globalAlpha = fade; g.fillStyle = theme.arena; g.strokeStyle = PP.color; g.lineWidth = 3;
  g.beginPath(); g.arc(pu.x, y, pu.r, 0, TAU); g.fill(); g.stroke();
  if (q >= 1) { g.lineWidth = 1.5; g.setLineDash([5, 6]); g.lineDashOffset = -time * 14; g.beginPath(); g.arc(pu.x, y, pu.r * 1.45, 0, TAU); g.stroke(); g.setLineDash([]); }
  drawGlyph(g, PP.ic, pu.x, y, pu.r * 1.15, PP.color); g.globalAlpha = 1;
}
