// Vstupy (myš, dotyk, klávesnice).
/* =====================================================================
   Vstupy
   ===================================================================== */
const input = { keys: {}, mouse: { x: 0, y: 0, down: false, active: false }, stickL: null, stickR: null, touch: false, auto: false };

const canvas = $('game'), ctx = canvas.getContext('2d');
const mini = $('mini'), mctx = mini.getContext('2d');
const elMenu = $('menu'), elHud = $('hud'), elDead = $('dead'), elPause = $('pause');
const elFeed = $('feed'), elLb = $('lb'), elStats = $('stats'), elStatHead = $('statHead'), elClasses = $('classes');
const elLvl = $('lvlText'), elScore = $('scoreText'), elXp = $('xpFill');
const elName = $('nameIn'), elAuto = $('autoBtn');

function cpos(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function updateStick(s, x, y) {
  s.x = x; s.y = y;
  let dx = x - s.ox, dy = y - s.oy; const R = 58 * save.set.ctl, len = Math.hypot(dx, dy);
  if (len > R) { const ex = len - R; s.ox += dx / len * ex; s.oy += dy / len * ex; dx = x - s.ox; dy = y - s.oy; }
  const l2 = Math.hypot(dx, dy); s.mag = Math.min(1, l2 / R);
  if (s.mag < 0.08) { s.vx = 0; s.vy = 0; s.mag = 0; } else { s.vx = dx / l2 * s.mag; s.vy = dy / l2 * s.mag; }
}
canvas.addEventListener('pointerdown', e => {
  e.preventDefault();
  const p = cpos(e);
  if (e.pointerType === 'mouse') {
    if (e.button === 0) input.mouse.down = true;
    input.mouse.x = p.x; input.mouse.y = p.y; input.mouse.active = true; return;
  }
  input.touch = true; elApp.classList.add('touch');
  const slot = (p.x < view.w / 2) !== !!save.set.lefty ? 'stickL' : 'stickR';
  if (input[slot]) return;
  input[slot] = { id: e.pointerId, ox: p.x, oy: p.y, x: p.x, y: p.y, vx: 0, vy: 0, mag: 0 };
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
});
canvas.addEventListener('pointermove', e => {
  const p = cpos(e);
  if (e.pointerType === 'mouse') { input.mouse.x = p.x; input.mouse.y = p.y; input.mouse.active = true; return; }
  for (const slot of ['stickL', 'stickR']) if (input[slot] && input[slot].id === e.pointerId) updateStick(input[slot], p.x, p.y);
});
function pointerEnd(e) {
  if (e.pointerType === 'mouse') { input.mouse.down = false; return; }
  for (const slot of ['stickL', 'stickR']) if (input[slot] && input[slot].id === e.pointerId) input[slot] = null;
}
window.addEventListener('pointerup', pointerEnd);
window.addEventListener('pointercancel', pointerEnd);
canvas.addEventListener('contextmenu', e => e.preventDefault());

window.addEventListener('keydown', e => {
  const tg = evTarget(e);
  if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA')) { if (e.key === 'Enter' && state === 'menu' && $('app').contains(tg)) startGame(); return; }
  const k = (e.key || '').toLowerCase();
  input.keys[k] = true;
  if (state === 'play') {
    if (k.length === 1 && k >= '1' && k <= '8') buyStat(player, +k - 1);
    else if (k === 'e') setAuto(!input.auto);
    else if (k === 'shift') dash(player);
    else if (k === 'c' && mode === 'sandbox') openColl('classes');
    else if (k === 'p' || k === 'escape') setPause(!paused);
  } else if (k === 'enter' && !(tg && tg.tagName === 'BUTTON')) {
    if (state === 'menu' || (state === 'dead' && !elDead.classList.contains('hidden'))) startGame(state === 'menu' ? true : world.over);
  }
  if (state === 'play' && (k === 'arrowup' || k === 'arrowdown' || k === 'arrowleft' || k === 'arrowright' || k === ' ')) e.preventDefault();
});
window.addEventListener('keyup', e => { input.keys[(e.key || '').toLowerCase()] = false; });
window.addEventListener('blur', () => { input.keys = {}; input.mouse.down = false; if (state === 'play' && !paused) setPause(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play' && !paused) setPause(true); });
