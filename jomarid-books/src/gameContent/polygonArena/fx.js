// Zvuk a vizuální efekty: barvy, předrenderované záře, částice, plovoucí texty a kvalita vykreslování.
/* ---------- zvuk (minimalistický syntezátor) ---------- */
const sfx = { ctx: null, last: {} };
const SFX = { shoot: [520, 0.05, 'square', 0.014, -260], hit: [170, 0.05, 'sawtooth', 0.016, -60], pop: [320, 0.09, 'triangle', 0.03, 180], level: [520, 0.25, 'sine', 0.05, 500], die: [220, 0.55, 'sawtooth', 0.05, -170], click: [700, 0.04, 'square', 0.02, 0] };
Object.assign(SFX, { pick: [880, 0.09, 'triangle', 0.03, 300], boom: [120, 0.3, 'sawtooth', 0.05, -90], dash: [300, 0.12, 'sine', 0.04, 500], boss: [140, 0.9, 'sawtooth', 0.06, 70], ach: [660, 0.4, 'triangle', 0.05, 440], perk: [440, 0.3, 'sine', 0.05, 330] });
function beep(kind) {
  if (!save.sound) return;
  const now = performance.now(); if (now - (sfx.last[kind] || 0) < 60) return; sfx.last[kind] = now;
  try {
    if (!sfx.ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; sfx.ctx = new AC(); }
    const c = sfx.ctx; if (c.state === 'suspended') c.resume();
    const [f, d, type, vol, slide] = SFX[kind];
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, c.currentTime);
    if (slide) o.frequency.linearRampToValueAtTime(Math.max(40, f + slide), c.currentTime + d);
    g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + d);
    o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + d + 0.02);
  } catch (e) { /* zvuk není kritický */ }
}

/* ---------- barvy ---------- */
const colorCache = new Map();
// Přečte barvu zadanou jako #rgb, #rrggbb, rgb() nebo rgba(); vrací [r, g, b] (0-255).
function parseColor(c) {
  let v = colorCache.get(c); if (v) return v;
  let m;
  if (typeof c === 'string' && (m = /^#([0-9a-f]{3})$/i.exec(c))) v = [...m[1]].map(x => parseInt(x + x, 16));
  else if (typeof c === 'string' && (m = /^#([0-9a-f]{6})/i.exec(c))) { const n = parseInt(m[1], 16); v = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  else if (typeof c === 'string' && (m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(c))) v = [+m[1], +m[2], +m[3]];
  else v = [150, 160, 170];
  colorCache.set(c, v); return v;
}
const rgbaStr = (c, a) => { const v = parseColor(c); return 'rgba(' + v[0] + ',' + v[1] + ',' + v[2] + ',' + a + ')'; };
const mixCache = new Map();
// Smíchá dvě barvy (t = 0 první, t = 1 druhá).
function mixColor(c1, c2, t) {
  const key = c1 + '|' + c2 + '|' + t; let r = mixCache.get(key); if (r) return r;
  const a = parseColor(c1), b = parseColor(c2);
  r = 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * t) + ',' + Math.round(a[1] + (b[1] - a[1]) * t) + ',' + Math.round(a[2] + (b[2] - a[2]) * t) + ')';
  if (mixCache.size > 3000) mixCache.clear();
  mixCache.set(key, r); return r;
}
const tint = (c, t) => mixColor(c, '#ffffff', t);       // zesvětlení
const deepen = (c, t) => mixColor(c, '#000000', t);     // ztmavení

/* ---------- kvalita vykreslování ---------- */
// 0 = nízká (ploché barvy, žádné záře ani stíny), 1 = střední, 2 = plná. Nastavení "Efekty" určuje strop, rychlost
// snímků ho případně sníží (a po uklidnění zase zvýší), aby hra zůstala plynulá i na slabším zařízení.
const fxState = { level: 2, auto: 2, ema: 16.7, slow: 0, fast: 0, forced: -1 };
const fxLevelNow = () => (fxState.forced >= 0 ? fxState.forced : Math.min(save.set.fx ? 2 : 0, fxState.auto));
function fxFrame(dtMs) {
  const f = fxState; f.ema += (Math.min(dtMs, 100) - f.ema) * 0.08;
  if (f.ema > 26) { f.slow += dtMs; f.fast = 0; } else if (f.ema < 19) { f.fast += dtMs; f.slow = 0; } else { f.slow = 0; f.fast = 0; }
  if (f.slow > 1500 && f.auto > 0) { f.auto--; f.slow = 0; f.ema = 18; } else if (f.fast > 8000 && f.auto < 2) { f.auto++; f.fast = 0; }
  f.level = fxLevelNow();
}

/* ---------- záře a stíny (předrenderované) ---------- */
const spriteCache = new Map();
function glowSprite(color) {
  let s = spriteCache.get(color); if (s) return s;
  s = document.createElement('canvas'); s.width = s.height = 64;
  const g = s.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, rgbaStr(color, 1)); gr.addColorStop(0.3, rgbaStr(color, 0.5)); gr.addColorStop(1, rgbaStr(color, 0));
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  if (spriteCache.size > 200) spriteCache.clear();
  spriteCache.set(color, s); return s;
}
let shadowSpr = null;
function shadowSprite() {
  if (shadowSpr) return shadowSpr;
  shadowSpr = document.createElement('canvas'); shadowSpr.width = shadowSpr.height = 64;
  const g = shadowSpr.getContext('2d'), gr = g.createRadialGradient(32, 32, 6, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(0.65, 'rgba(0,0,0,0.28)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return shadowSpr;
}
// Aditivní záře (světlo), jen od střední kvality výš.
function glowAt(g, x, y, r, color, a) {
  if (fxState.level < 1 || r < 1) return;
  g.globalCompositeOperation = 'lighter'; g.globalAlpha = a;
  g.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2);
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
}
// Měkký stín pod předmětem (mírně posunutý dolů a doprava).
function shadowAt(g, x, y, r, a) {
  if (fxState.level < 1) return;
  g.globalAlpha = a === undefined ? 0.55 : a;
  g.drawImage(shadowSprite(), x - r * 1.05 + r * 0.14, y - r * 1.05 + r * 0.26, r * 2.1, r * 2.1);
  g.globalAlpha = 1;
}

/* ---------- částice ---------- */
// Druhy: 0 čtvereček, 1 jiskra (úsečka ve směru letu), 2 kouř (roste a bledne), 3 střep (otáčející se trojúhelník), 4 záře.
const PCAP = [90, 220, 380];
const partCap = () => PCAP[fxState.level];
function addPart(p) { if (parts.length < partCap()) parts.push(p); }
function burst(x, y, color, n, speed, size, kind) {
  const lv = fxState.level;
  if (lv === 0) kind = 0; else if (kind === undefined) kind = 3;
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), s = rand(0.3, 1) * speed;
    addPart({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.35, 0.75), max: 0.75, r: size * rand(0.5, 1), color, rot: rand(0, TAU), kind, vr: rand(-9, 9) });
  }
}
function sparks(x, y, color, n, speed) {
  if (fxState.level === 0) return;
  for (let i = 0; i < n; i++) { const a = rand(0, TAU), s = rand(0.4, 1) * speed; addPart({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.18, 0.4), max: 0.4, r: rand(1.2, 2.6), color, rot: 0, kind: 1, vr: 0 }); }
}
function smoke(x, y, n, size, color) {
  if (fxState.level < 2) return;
  for (let i = 0; i < n; i++) { const a = rand(0, TAU), s = rand(10, 60); addPart({ x: x + rand(-size, size) * 0.4, y: y + rand(-size, size) * 0.4, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.6, 1.1), max: 1.1, r: size * rand(0.5, 1), color: color || '#8d98a2', rot: 0, kind: 2, vr: 0 }); }
}
// Rozšiřující se prstenec; fill = i s jasnou výplní (záblesk výbuchu).
function ringFx(x, y, r0, max, life, color, fill) { world.rings.push({ x, y, r: r0, max, life, m: life, color, fill: !!fill }); }
function explosionFx(x, y, r, color) {
  ringFx(x, y, 6, r, 0.34, color, true);
  burst(x, y, color, 14, 230, Math.max(3, r * 0.1));
  sparks(x, y, '#ffe9a8', 10, 380);
  smoke(x, y, 5, r * 0.28);
}
function deathFx(t) {
  const big = t.boss;
  ringFx(t.x, t.y, t.r, t.r * (big ? 6 : 3.2), 0.5, t.color, false);
  ringFx(t.x, t.y, t.r * 0.4, t.r * (big ? 3 : 1.8), 0.28, '#ffffff', true);
  burst(t.x, t.y, t.color, big ? 60 : 26, 290, t.r * 0.3);
  burst(t.x, t.y, '#ffffff', big ? 14 : 6, 200, t.r * 0.16);
  sparks(t.x, t.y, '#ffe9a8', big ? 24 : 12, 420);
  smoke(t.x, t.y, big ? 12 : 6, t.r * 0.8);
}
function shapeBreakFx(s) {
  const big = s.type === 'hex' || s.type === 'alpha', mid = s.type === 'pent' || s.type === 'crystal';
  burst(s.x, s.y, s.color, big ? 22 : mid ? 14 : 8, 160 + s.r * 2, s.r * 0.22);
  if (fxState.level > 0) { burst(s.x, s.y, tint(s.color, 0.55), big ? 8 : 4, 120 + s.r, s.r * 0.12, 1); if (big) ringFx(s.x, s.y, s.r * 0.5, s.r * 2.2, 0.35, s.color, false); }
}
function floatText(x, y, text, color) {
  if (texts.length > 24) texts.shift();
  texts.push({ x, y, text, color, life: 1.1, max: 1.1 });
}
