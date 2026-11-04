// Karty knih se při najetí myší lehce naklánějí za kurzorem a přes ně přejede odlesk (Živý režim). Jen s myší nebo perem, ne na dotyku.
// Skript jen zapisuje --rx, --ry, --mx a --my na kartu, vzhled řeší src/lively.css.
import { tiltFor } from './motion.js';

export const TILT_SELECTOR = '[data-testid="library-card"]';
const VARS = ['--rx', '--ry', '--mx', '--my'];

export const installTilt = ({ doc = globalThis.document, win = globalThis.window, raf = (fn) => globalThis.requestAnimationFrame(fn), cancel = (id) => globalThis.cancelAnimationFrame(id) } = {}) => {
  if (!doc || !win || !win.matchMedia || !win.matchMedia('(hover: hover) and (pointer: fine)').matches) return () => {};
  let current = null; let frame = 0; let last = null;
  const reset = (el) => { for (const v of VARS) el.style.removeProperty(v); };
  const apply = () => {
    frame = 0;
    if (!current || !last) return;
    const rect = current.getBoundingClientRect();
    const t = tiltFor(last.x - rect.left, last.y - rect.top, rect);
    current.style.setProperty('--rx', `${t.rx}deg`);
    current.style.setProperty('--ry', `${t.ry}deg`);
    current.style.setProperty('--mx', `${t.mx}%`);
    current.style.setProperty('--my', `${t.my}%`);
  };
  const onMove = (e) => {
    if (e.pointerType === 'touch') return;
    const root = doc.documentElement;
    if (root && root.dataset && (root.dataset.lively !== '1' || root.dataset.reduceMotion === '1')) { if (current) { reset(current); current = null; } return; }
    const card = e.target && typeof e.target.closest === 'function' ? e.target.closest(TILT_SELECTOR) : null;
    if (card !== current) { if (current) reset(current); current = card; }
    if (!card) return;
    last = { x: e.clientX, y: e.clientY };
    if (!frame) frame = raf(apply);
  };
  const onLeave = () => { if (current) { reset(current); current = null; } };
  doc.addEventListener('pointermove', onMove, { passive: true });
  doc.addEventListener('pointerleave', onLeave, true);
  return () => {
    doc.removeEventListener('pointermove', onMove);
    doc.removeEventListener('pointerleave', onLeave, true);
    if (frame) cancel(frame);
    if (current) reset(current);
  };
};
