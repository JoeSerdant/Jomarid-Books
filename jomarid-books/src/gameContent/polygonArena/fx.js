// Zvuk a vizuální efekty (částice, plovoucí texty).
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

/* ---------- efekty ---------- */
function burst(x, y, color, n, speed, size) {
  for (let i = 0; i < n && parts.length < 320; i++) {
    const a = rand(0, TAU), s = rand(0.3, 1) * speed;
    parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.35, 0.7), max: 0.7, r: size * rand(0.5, 1), color, rot: rand(0, TAU) });
  }
}
function floatText(x, y, text, color) {
  if (texts.length > 24) texts.shift();
  texts.push({ x, y, text, color, life: 1.1, max: 1.1 });
}
