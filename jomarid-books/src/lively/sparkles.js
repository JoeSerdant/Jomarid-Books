// Jiskřičky po kliknutí na tlačítko nebo odkaz (Živý režim). Kreslí se do dokumentu přes Web Animations API a hned se uklidí.
// Čistá logika (směry jiskřiček) i napojení na dokument jdou testovat v Node s atrapou dokumentu.

export const SPARKLE_COUNT = 7;
export const MAX_LIVE_SPARKLES = 42; // strop současně žijících jiskřiček (rychlé klikání nesmí zahltit stránku)
const COLORS = ['var(--bg-primary)', '#fbbf24', '#38bdf8'];
const INTERACTIVE = 'button, a[href], [role="button"], summary, label[for], input[type="checkbox"], input[type="radio"]';

// Malý opakovatelný generátor: stejná semínka dají stejné jiskry (testy), každé kliknutí má semínko jiné (vypadá to živě).
const rng = (seed) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;

/** Směry, velikosti a barvy jiskřiček jednoho výbuchu. Směry jsou rozprostřené do kruhu s drobnou odchylkou. */
export const sparkleSpecs = (count = SPARKLE_COUNT, seed = 1) => {
  const r = rng(seed >>> 0);
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 + (r() - 0.5) * 0.7;
    const dist = 20 + r() * 26;
    return {
      dx: Math.round(Math.cos(angle) * dist),
      dy: Math.round(Math.sin(angle) * dist),
      size: 4 + Math.round(r() * 4),
      rot: Math.round((r() - 0.5) * 240),
      ms: 480 + Math.round(r() * 220),
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

/** Vykreslí jeden výbuch na souřadnicích okna. Vrací počet vytvořených jiskřiček (0, když prohlížeč animace neumí). */
export const burstAt = (x, y, { doc = globalThis.document, seed = 1, live = { n: 0 } } = {}) => {
  if (!doc || !doc.body || !Number.isFinite(x) || !Number.isFinite(y)) return 0;
  let made = 0;
  for (const s of sparkleSpecs(SPARKLE_COUNT, seed)) {
    if (live.n >= MAX_LIVE_SPARKLES) break;
    const el = doc.createElement('span');
    if (typeof el.animate !== 'function') return made;
    Object.assign(el.style, {
      position: 'fixed', left: `${x}px`, top: `${y}px`, width: `${s.size}px`, height: `${s.size}px`, margin: `${-s.size / 2}px 0 0 ${-s.size / 2}px`,
      background: s.color, borderRadius: s.star ? '0' : '50%', clipPath: s.star ? STAR : 'none', pointerEvents: 'none', zIndex: '2147483000',
    });
    el.setAttribute?.('aria-hidden', 'true');
    doc.body.appendChild(el);
    live.n += 1; made += 1;
    const done = () => { live.n = Math.max(0, live.n - 1); el.remove?.(); };
    const anim = el.animate(
      [{ transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 1 }, { transform: `translate(${s.dx}px, ${s.dy}px) scale(0.3) rotate(${s.rot}deg)`, opacity: 0 }],
      { duration: s.ms, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)', fill: 'forwards' },
    );
    if (anim && anim.finished && typeof anim.finished.then === 'function') anim.finished.then(done, done); else done();
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
