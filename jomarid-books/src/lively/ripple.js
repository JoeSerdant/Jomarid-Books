// Jemný kruh, který se rozšíří z místa kliknutí na tlačítko, odkaz nebo přepínač (Živý režim). Kreslí se do dokumentu přes Web Animations API
// a po dohrání se uklidí. Čistá logika (kam kliknout, strop počtu, úklid) jde testovat v Node s atrapou dokumentu.

export const MAX_RIPPLES = 6; // strop současně žijících kruhů (rychlé klikání nesmí zahltit stránku)
export const RIPPLE_MS = 560;
const INTERACTIVE = 'button, a[href], [role="button"], [role="radio"], [role="switch"], summary, label[for], input[type="checkbox"], input[type="radio"]';

/** Nejbližší ovladatelný prvek (tlačítko, odkaz, přepínač), který není vypnutý; jinak null. */
export const rippleTarget = (el) => {
  const t = el && typeof el.closest === 'function' ? el.closest(INTERACTIVE) : null;
  if (!t) return null;
  if (t.disabled === true) return null;
  if (typeof t.getAttribute === 'function' && t.getAttribute('aria-disabled') === 'true') return null;
  return t;
};

/** Vykreslí jeden kruh na souřadnicích okna. Vrací 1, 0 když prohlížeč animace neumí, nesmyslné souřadnice nebo je kruhů moc. */
export const rippleAt = (x, y, { doc = globalThis.document, live = { n: 0 } } = {}) => {
  if (!doc || !doc.body || !Number.isFinite(x) || !Number.isFinite(y) || live.n >= MAX_RIPPLES) return 0;
  const el = doc.createElement('span');
  if (typeof el.animate !== 'function') return 0;
  Object.assign(el.style, {
    position: 'fixed', left: `${x}px`, top: `${y}px`, width: '16px', height: '16px', margin: '-8px 0 0 -8px', borderRadius: '50%', boxSizing: 'border-box',
    border: '2px solid var(--bg-primary)', background: 'transparent', pointerEvents: 'none', zIndex: '2147483000',
  });
  el.setAttribute?.('aria-hidden', 'true');
  doc.body.appendChild(el);
  live.n += 1;
  const done = () => { live.n = Math.max(0, live.n - 1); el.remove?.(); };
  const anim = el.animate([{ transform: 'scale(0.3)', opacity: 0.85 }, { transform: 'scale(4.4)', opacity: 0 }], { duration: RIPPLE_MS, easing: 'cubic-bezier(0.1, 0.7, 0.3, 1)', fill: 'forwards' });
  if (anim && anim.finished && typeof anim.finished.then === 'function') anim.finished.then(done, done); else done();
  return 1;
};

/** Zapne kruhy po kliknutí. getScope vrací livelyScope aktuální stránky. Vrací funkci, která je zase vypne. */
export const installClickRipple = ({ doc = globalThis.document, getScope = () => ({ motion: true }) } = {}) => {
  if (!doc || typeof doc.addEventListener !== 'function') return () => {};
  const live = { n: 0 };
  const onDown = (e) => {
    const root = doc.documentElement;
    if (!root || root.dataset?.lively !== '1' || root.dataset?.reduceMotion === '1') return;
    if (e.button > 0 || !getScope().motion) return;
    if (!rippleTarget(e.target)) return;
    rippleAt(e.clientX, e.clientY, { doc, live });
  };
  doc.addEventListener('pointerdown', onDown, { passive: true, capture: true });
  return () => doc.removeEventListener('pointerdown', onDown, { capture: true });
};
