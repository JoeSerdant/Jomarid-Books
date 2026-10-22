// Předrenderovaná grafika: textura arény (desky s nýty a šumem), pruhy na okraji, textury zón, osvětlení a zkosené tvary.
// Všechno se vyrobí jednou do plátna mimo obrazovku (a znovu při změně motivu), za běhu se jen kopíruje.
const LIGHT = -2.35;                                    // směr světla (vlevo nahoře); stojí na místě bez ohledu na otočení předmětů

function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const toneStep = k => Math.round(k * 12) / 12;           // zaokrouhlení, ať se barvy fazet vejdou do keše
// Barva stěny podle toho, jak moc je natočená ke světlu (k = cos úhlu mezi normálou a světlem, -1 až 1).
const faceTone = (col, k) => (k >= 0 ? tint(col, toneStep(k) * 0.42) : deepen(col, toneStep(-k) * 0.46));

// Zkosený mnohoúhelník: n stěn mezi vnějším a vnitřním okrajem a horní plocha. ang = otočení souřadnic (osvětlení stojí).
function bevelPoly(g, x, y, R, n, rot, col, ang, q, inset) {
  const ri = R * (inset || 0.6), la = LIGHT - ang, step = TAU / n;
  g.lineJoin = 'round';
  g.fillStyle = deepen(col, 0.18); g.beginPath();                          // podklad pod stěnami: spáry mezi nimi nepropustí pozadí
  for (let i = 0; i < n; i++) { const a = rot + i * step; if (i) g.lineTo(x + Math.cos(a) * R, y + Math.sin(a) * R); else g.moveTo(x + Math.cos(a) * R, y + Math.sin(a) * R); }
  g.closePath(); g.fill();
  for (let i = 0; i < n; i++) {
    const a0 = rot + i * step, a1 = a0 + step, k = Math.cos(a0 + step / 2 - la);
    g.fillStyle = faceTone(col, k);
    g.beginPath();
    g.moveTo(x + Math.cos(a0) * R, y + Math.sin(a0) * R); g.lineTo(x + Math.cos(a1) * R, y + Math.sin(a1) * R);
    g.lineTo(x + Math.cos(a1) * ri, y + Math.sin(a1) * ri); g.lineTo(x + Math.cos(a0) * ri, y + Math.sin(a0) * ri);
    g.closePath(); g.fill();
  }
  g.beginPath();
  for (let i = 0; i < n; i++) { const a = rot + i * step; if (i) g.lineTo(x + Math.cos(a) * ri, y + Math.sin(a) * ri); else g.moveTo(x + Math.cos(a) * ri, y + Math.sin(a) * ri); }
  g.closePath();
  if (q >= 2) {
    const gr = g.createRadialGradient(x + Math.cos(la) * ri * 0.5, y + Math.sin(la) * ri * 0.5, ri * 0.08, x, y, ri * 1.05);
    gr.addColorStop(0, tint(col, 0.5)); gr.addColorStop(0.55, tint(col, 0.1)); gr.addColorStop(1, deepen(col, 0.12));
    g.fillStyle = gr;
  } else g.fillStyle = tint(col, 0.14);
  g.fill();
  if (q >= 1) {                                         // světlé hrany na osvětlených stěnách
    g.lineCap = 'round'; g.lineWidth = 1.6;
    for (let i = 0; i < n; i++) {
      const a0 = rot + i * step, a1 = a0 + step, k = Math.cos(a0 + step / 2 - la);
      if (k < 0.35) continue;
      g.strokeStyle = 'rgba(255,255,255,' + (0.5 * k).toFixed(2) + ')';
      g.beginPath(); g.moveTo(x + Math.cos(a0) * R * 0.97, y + Math.sin(a0) * R * 0.97); g.lineTo(x + Math.cos(a1) * R * 0.97, y + Math.sin(a1) * R * 0.97); g.stroke();
    }
    g.lineCap = 'butt';
  }
}

const Art = {
  key: '', light: false, tile: null, pat: null, hazard: null, hazardPat: null, zones: {}, motes: null, TILE: 480, S: 2,

  // Přestaví textury, když se změnil motiv (barvy se čtou z CSS tokenů).
  ensure(g) {
    const k = theme.arena + '|' + theme.grid + '|' + theme.accent + '|' + theme.bg;
    if (k === this.key && this.pat) return;
    this.key = k;
    const v = parseColor(theme.arena); this.light = v[0] * 0.299 + v[1] * 0.587 + v[2] * 0.114 > 150;
    this.tile = this.buildTile(); this.hazard = this.buildHazard(); this.zones = {};
    this.pat = g.createPattern(this.tile, 'repeat'); this.hazardPat = g.createPattern(this.hazard, 'repeat');
  },

  // Dlaždice 480 x 480 jednotek (osm polí po 60), na okrajích na sebe navazuje.
  buildTile() {
    const T = this.TILE, S = this.S, c = document.createElement('canvas'); c.width = c.height = T * S;
    const g = c.getContext('2d'), R = seeded(11), L = this.light;
    g.scale(S, S);
    g.fillStyle = theme.arena; g.fillRect(0, 0, T, T);
    for (let i = 0; i < 16; i++) {                                           // velké měkké skvrny: světlejší a tmavší místa v kovu
      const x = R() * T, y = R() * T, r = 80 + R() * 140, col = R() < 0.5 ? '0,0,0' : '255,255,255', a = (L ? 0.04 : 0.055) * (0.5 + R());
      for (const ox of [-T, 0, T]) for (const oy of [-T, 0, T]) {
        const px = x + ox, py = y + oy; if (px + r < 0 || px - r > T || py + r < 0 || py - r > T) continue;
        const gr = g.createRadialGradient(px, py, 0, px, py, r); gr.addColorStop(0, 'rgba(' + col + ',' + a + ')'); gr.addColorStop(1, 'rgba(' + col + ',0)');
        g.fillStyle = gr; g.fillRect(px - r, py - r, r * 2, r * 2);
      }
    }
    for (let cx = 0; cx < 8; cx++) for (let cy = 0; cy < 8; cy++) {            // desky: šachovnice a zkosené hrany
      const x = cx * 60, y = cy * 60;
      g.fillStyle = (cx + cy) % 2 ? 'rgba(255,255,255,0.014)' : 'rgba(0,0,0,0.03)'; g.fillRect(x, y, 60, 60);
      g.fillStyle = 'rgba(255,255,255,' + (L ? 0.3 : 0.05) + ')'; g.fillRect(x + 1, y + 1, 58, 1.4); g.fillRect(x + 1, y + 1, 1.4, 58);
      g.fillStyle = 'rgba(0,0,0,0.1)'; g.fillRect(x + 1, y + 57.6, 58, 1.4); g.fillRect(x + 57.6, y + 1, 1.4, 58);
    }
    g.strokeStyle = theme.grid; g.lineWidth = 1.4; g.beginPath();            // mřížka (dělení po 60)
    for (let i = 0; i <= 8; i++) { g.moveTo(i * 60, 0); g.lineTo(i * 60, T); g.moveTo(0, i * 60); g.lineTo(T, i * 60); }
    g.stroke();
    const rv = mixColor(theme.grid, L ? '#000000' : '#ffffff', 0.22);          // nýty v rozích polí
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
      g.fillStyle = rv; g.beginPath(); g.arc(i * 60, j * 60, 1.8, 0, TAU); g.fill();
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.arc(i * 60 + 0.5, j * 60 + 0.6, 0.8, 0, TAU); g.fill();
    }
    for (let i = 0; i < 900; i++) { g.fillStyle = (R() < 0.5 ? 'rgba(255,255,255,' : 'rgba(0,0,0,') + (0.03 + R() * 0.06).toFixed(3) + ')'; g.fillRect(R() * T, R() * T, 0.7 + R() * 1.2, 0.7 + R() * 1.2); }   // zrnění
    g.lineWidth = 0.8;                                                        // škrábance
    for (let i = 0; i < 30; i++) {
      const x = R() * T, y = R() * T, a = R() * TAU, l = 6 + R() * 22;
      g.strokeStyle = R() < 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.12)'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    return c;
  },

  // Výstražné pruhy na okraji světa.
  buildHazard() {
    const s = 32, S = this.S, c = document.createElement('canvas'); c.width = c.height = s * S;
    const g = c.getContext('2d'); g.scale(S, S);
    g.fillStyle = this.light ? '#2b2f33' : '#0b1115'; g.fillRect(0, 0, s, s);
    g.strokeStyle = this.light ? '#c9962b' : '#b8861f'; g.lineWidth = s * 0.5;
    g.beginPath(); for (const k of [0, s, 2 * s]) { g.moveTo(k, 0); g.lineTo(0, k); } g.stroke();
    return c;
  },

  // Textura zóny (256 px), kruhová s měkkým okrajem.
  zoneTex(type) {
    let c = this.zones[type]; if (c) return c;
    const N = 256, h = N / 2; c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d'), R = seeded(type === 'lava' ? 3 : type === 'ice' ? 5 : 9);
    g.lineJoin = 'round'; g.lineCap = 'round';
    const walk = (x, y, steps, a, len, jit, forks) => {
      g.beginPath(); g.moveTo(x, y);
      for (let i = 0; i < steps; i++) { a += (R() - 0.5) * jit; x += Math.cos(a) * len; y += Math.sin(a) * len; g.lineTo(x, y); if (forks && R() < 0.25) walk(x, y, 3, a + (R() < 0.5 ? 1 : -1) * 0.9, len, jit, false); g.moveTo(x, y); }
      g.stroke();
    };
    if (type === 'lava') {
      const bg = g.createRadialGradient(h, h, 10, h, h, h); bg.addColorStop(0, '#ffc15a'); bg.addColorStop(0.6, '#e8501e'); bg.addColorStop(1, '#7a160f'); g.fillStyle = bg; g.fillRect(0, 0, N, N);
      for (let i = 0; i < 26; i++) { g.fillStyle = 'rgba(40,10,6,' + (0.25 + R() * 0.3).toFixed(2) + ')'; g.beginPath(); g.ellipse(R() * N, R() * N, 12 + R() * 26, 8 + R() * 18, R() * PI, 0, TAU); g.fill(); }   // ztuhlá kůra
      g.shadowColor = '#ff7a30'; g.shadowBlur = 8; g.strokeStyle = '#ffd27a';
      for (let i = 0; i < 14; i++) { g.lineWidth = 1.5 + R() * 3; walk(R() * N, R() * N, 7, R() * TAU, 14 + R() * 10, 1.6, true); }
      g.shadowBlur = 0;
    } else if (type === 'ice') {
      const bg = g.createRadialGradient(h * 0.8, h * 0.8, 8, h, h, h); bg.addColorStop(0, '#f2fcff'); bg.addColorStop(0.7, '#bfe9f7'); bg.addColorStop(1, '#7ec3e0'); g.fillStyle = bg; g.fillRect(0, 0, N, N);
      for (let i = 0; i < 16; i++) { g.fillStyle = 'rgba(255,255,255,' + (0.1 + R() * 0.2).toFixed(2) + ')'; g.beginPath(); g.ellipse(R() * N, R() * N, 10 + R() * 30, 6 + R() * 16, R() * PI, 0, TAU); g.fill(); }
      g.strokeStyle = 'rgba(70,130,170,0.55)'; for (let i = 0; i < 10; i++) { g.lineWidth = 1 + R() * 1.6; walk(h + (R() - 0.5) * 80, h + (R() - 0.5) * 80, 8, R() * TAU, 16 + R() * 10, 1.1, true); }
      g.strokeStyle = 'rgba(255,255,255,0.85)'; for (let i = 0; i < 10; i++) { g.lineWidth = 0.8; walk(R() * N, R() * N, 6, R() * TAU, 12, 1.4, true); }
    } else {
      const bg = g.createRadialGradient(h, h, 8, h, h, h); bg.addColorStop(0, '#6fe0a0'); bg.addColorStop(0.65, '#2fa96a'); bg.addColorStop(1, '#16603f'); g.fillStyle = bg; g.fillRect(0, 0, N, N);
      g.strokeStyle = 'rgba(210,255,225,0.28)'; g.lineWidth = 2; for (let r = 24; r < h; r += 22) { g.beginPath(); g.arc(h, h, r, 0, TAU); g.stroke(); }
      for (let i = 0; i < 12; i++) {                                              // listy leknínů
        const x = h + (R() - 0.5) * 170, y = h + (R() - 0.5) * 170, r = 9 + R() * 11, a = R() * TAU;
        g.fillStyle = 'rgba(30,120,70,0.9)'; g.beginPath(); g.moveTo(x, y); g.arc(x, y, r, a + 0.35, a + TAU - 0.35); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(160,240,190,0.6)'; g.lineWidth = 1.2; g.stroke();
      }
      for (let i = 0; i < 6; i++) { const x = h + (R() - 0.5) * 150, y = h + (R() - 0.5) * 150; g.fillStyle = '#fff6c8'; g.beginPath(); g.arc(x, y, 3.2, 0, TAU); g.fill(); g.fillStyle = '#ffd34d'; g.beginPath(); g.arc(x, y, 1.4, 0, TAU); g.fill(); }
    }
    g.globalCompositeOperation = 'destination-in';                                 // měkký okraj
    const m = g.createRadialGradient(h, h, h * 0.72, h, h, h); m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = m; g.fillRect(0, 0, N, N);
    this.zones[type] = c; return c;
  },

  // Poletující prach v popředí (na obrazovce, s paralaxou), jen od střední kvality.
  drawMotes(g, W, H, cx, cy, z, q) {
    if (q < 2) return;
    if (!this.motes) { const R = seeded(21); this.motes = []; for (let i = 0; i < 60; i++) this.motes.push({ x: R(), y: R(), r: 1 + R() * 2.4, d: 0.25 + R() * 0.55, ph: R() * TAU, v: 4 + R() * 9 }); }
    const n = 60, add = !this.light;
    g.save(); g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    if (add) g.globalCompositeOperation = 'lighter';
    const col = add ? theme.accent : '#000000';
    for (let i = 0; i < n; i++) {
      const m = this.motes[i], sx = (((m.x * W - cx * z * m.d + Math.sin(time * 0.3 + m.ph) * 14 + time * m.v * 0.2) % W) + W) % W, sy = (((m.y * H - cy * z * m.d - time * m.v) % H) + H) % H;
      g.globalAlpha = (0.12 + 0.12 * Math.sin(time * 1.4 + m.ph)) * (add ? 1 : 0.5);
      const r = m.r * 3.2; g.drawImage(glowSprite(col), sx - r, sy - r, r * 2, r * 2);
    }
    g.restore(); g.globalAlpha = 1;
  },
};
