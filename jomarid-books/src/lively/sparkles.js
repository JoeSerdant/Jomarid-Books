// Jiskřičky po kliknutí na tlačítko nebo odkaz (Živý režim). Kreslí se do dokumentu přes Web Animations API a hned se uklidí.
// Čistá logika (směry jiskřiček) i napojení na dokument jdou testovat v Node s atrapou dokumentu.

export const SPARKLE_COUNT = 12;
export const BURST_SIZE = SPARKLE_COUNT + 1; // jiskřičky a rázový kruh
export const MAX_LIVE_SPARKLES = 42; // strop současně žijících jiskřiček (rychlé klikání nesmí zahltit stránku)
const COLORS = ['var(--bg-primary)', '#fbbf24', '#38bdf8', '#fb7185'];
const INTERACTIVE = 'button, a[href], [role="button"], summary, label[for], input[type="checkbox"], input[type="radio"]';

// Malý opakovatelný generátor: stejná semínka dají stejné jiskry (testy), každé kliknutí má semínko jiné (vypadá to živě).
const rng = (seed) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;

/** Směry, velikosti a barvy jiskřiček jednoho výbuchu. Směry jsou rozprostřené do kruhu s drobnou odchylkou. */
export const sparkleSpecs = (count = SPARKLE_COUNT, seed = 1) => {
  const r = rng(seed >>> 0);
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 + (r() - 0.5) * 0.7;
    const dist = 26 + r() * 34;
    return {
      dx: Math.round(Math.cos(angle) * dist),
      dy: Math.round(Math.sin(angle) * dist),
      size: 6 + Math.round(r() * 6),
      rot: Math.round((r() - 0.5) * 240),
      ms: 520 + Math.round(r() * 260),
      color: COLORS[i % COLORS.length],
      star: i % 2 === 0,
    };
  });
};

/** Nejbližší ovladatelný prvek (tlačítko, odkaz, přepínač), který není vypnutý; jinak null. */
export const sparkleTarget = (el) => {
  const t = el && typeof el.closest === 'function' ? el.closest(INTERACTIVE) : null;
  if (!t) return null;
  if (t.disabled === true) return null;
  if (typeof t.getAttribute === 'function' && t.getAttribute('aria-disabled') === 'true') return null;
  return t;
};

const STAR = 'polygon(50% 0%, 61% 35%, 98% 38%, 68% 59%, 79% 91%, 50% 72%, 21% 91%, 32% 59%, 2% 38%, 39% 35%)';

// Jeden prvek výbuchu: vytvoří, přidá do stránky, spustí animaci a po jejím dohrání uklidí. Vrací false, když prohlížeč animace neumí.
const spawn = (doc, live, style, frames, options) => {
  const el = doc.createElement('span');
  if (typeof el.animate !== 'function') return false;
  Object.assign(el.style, { position: 'fixed', pointerEvents: 'none', zIndex: '2147483000', ...style });
  el.setAttribute?.('aria-hidden', 'true');
  doc.body.appendChild(el);
  live.n += 1;
  const done = () => { live.n = Math.max(0, live.n - 1); el.remove?.(); };
  const anim = el.animate(frames, options);
  if (anim && anim.finished && typeof anim.finished.then === 'function') anim.finished.then(done, done); else done();
  return true;
};

/** Vykreslí jeden výbuch na souřadnicích okna: rázový kruh a jiskřičky. Vrací počet vytvořených prvků (0, když prohlížeč animace neumí). */
export const burstAt = (x, y, { doc = globalThis.document, seed = 1, live = { n: 0 } } = {}) => {
  if (!doc || !doc.body || !Number.isFinite(x) || !Number.isFinite(y)) return 0;
  let made = 0;
  if (live.n < MAX_LIVE_SPARKLES) {
    const ring = spawn(doc, live, { left: `${x}px`, top: `${y}px`, width: '14px', height: '14px', margin: '-7px 0 0 -7px', borderRadius: '50%', border: '2px solid var(--bg-primary)', boxSizing: 'border-box' },
      [{ transform: 'scale(0.4)', opacity: 0.9 }, { transform: 'scale(4.2)', opacity: 0 }], { duration: 520, easing: 'cubic-bezier(0.1, 0.7, 0.3, 1)', fill: 'forwards' });
    if (!ring) return 0;
    made += 1;
  }
  for (const s of sparkleSpecs(SPARKLE_COUNT, seed)) {
    if (live.n >= MAX_LIVE_SPARKLES) break;
    const ok = spawn(doc, live,
      { left: `${x}px`, top: `${y}px`, width: `${s.size}px`, height: `${s.size}px`, margin: `${-s.size / 2}px 0 0 ${-s.size / 2}px`, background: s.color, borderRadius: s.star ? '0' : '50%', clipPath: s.star ? STAR : 'none' },
      // vyletí, na okamžik se zvětší (aby byla vidět) a teprve pak zmizí; na konci mírně klesá (jako by měla váhu)
      [{ transform: 'translate(0, 0) scale(0.4) rotate(0deg)', opacity: 1 },
        { offset: 0.4, transform: `translate(${Math.round(s.dx * 0.8)}px, ${Math.round(s.dy * 0.8)}px) scale(1.3) rotate(${Math.round(s.rot / 2)}deg)`, opacity: 1 },
        { transform: `translate(${s.dx}px, ${s.dy + 16}px) scale(0.2) rotate(${s.rot}deg)`, opacity: 0 }],
      { duration: s.ms, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)', fill: 'forwards' });
    if (!ok) return made;
    made += 1;
  }
  return made;
};

/** Zapne jiskřičky po kliknutí. getScope vrací livelyScope aktuální stránky. Vrací funkci, která je zase vypne. */
export const installClickSparkles = ({ doc = globalThis.document, getScope = () => ({ sparkles: true }) } = {}) => {
  if (!doc || typeof doc.addEventListener !== 'function') return () => {};
  const live = { n: 0 };
  let counter = 0;
  const onDown = (e) => {
    const root = doc.documentElement;
    if (!root || root.dataset?.lively !== '1' || root.dataset?.reduceMotion === '1') return;
    if (e.button > 0 || !getScope().sparkles) return;
    if (!sparkleTarget(e.target)) return;
    counter += 1;
    burstAt(e.clientX, e.clientY, { doc, seed: counter * 7919 + 13, live });
  };
  doc.addEventListener('pointerdown', onDown, { passive: true, capture: true });
  return () => doc.removeEventListener('pointerdown', onDown, { capture: true });
};
