// Plynulé přeskládání karet (Živý režim): když se v knihovně změní filtr, hledání nebo řazení, karty, které zůstaly, se nepřeskočí na nové místo,
// ale na ně doplují z původního (technika FLIP). Nové karty se objeví normálně (reveal.js), zmizelé prostě zmizí.
//
// Jak to funguje: při každé akci uživatele (klik, klávesa, změna pole), tedy dřív než React překreslí seznam, si zapamatuju polohy karet.
// Když se potom do 1 s změní obsah stránky, porovnám nové polohy se starými a každou kartu, která se pohnula, na chvíli vrátím na
// původní místo a nechám ji doletět. Polohy jsou v souřadnicích dokumentu, takže posun stránky nevadí. Pozdější změny (data z internetu)
// se neanimují, vypnutý režim, omezený pohyb a klidné stránky taky ne.

export const FLIP_SELECTOR = '[data-testid="library-card"], [data-flip]';
export const FLIP_MS = 650;
export const SNAPSHOT_TTL = 1000;  // jak dlouho po akci uživatele platí zapamatované polohy (ms)
export const MIN_MOVE = 4;         // menší posun se neanimuje (px)
export const MAX_VIEWPORTS = 1.5;  // karty, které by letěly dál než 1,5 okna, se jen přeskočí

const finite = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

/** Posun karty z původní polohy na novou {dx, dy} (kolik se má na začátku vrátit zpět), nebo null, když se nemá animovat. */
export const flipDelta = (before, after, viewportHeight = 800) => {
  if (!before || !after) return null;
  const dx = finite(before.x) - finite(after.x);
  const dy = finite(before.y) - finite(after.y);
  if (Math.abs(dx) < MIN_MOVE && Math.abs(dy) < MIN_MOVE) return null;
  if (Math.abs(dy) > MAX_VIEWPORTS * Math.max(finite(viewportHeight), 1)) return null;
  return { dx: Math.round(dx), dy: Math.round(dy) };
};

export const installFlip = ({ doc = globalThis.document, win = globalThis.window, MO = globalThis.MutationObserver, now = () => globalThis.performance.now() } = {}) => {
  const main = doc && doc.querySelector ? doc.querySelector('main') : null;
  if (!main || !MO || !win) return () => {};
  let snap = null; let taken = 0;
  const active = () => { const r = doc.documentElement; return !!r && !!r.dataset && r.dataset.lively === '1' && r.dataset.reduceMotion !== '1'; };
  const place = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + finite(win.scrollX), y: r.top + finite(win.scrollY) }; };

  const take = () => {
    if (!active()) return;
    const t = now();
    if (snap && t - taken < 40) return; // klávesy se opakují: stačí jednou za chvíli
    const m = new Map();
    for (const el of main.querySelectorAll(FLIP_SELECTOR)) m.set(el, place(el));
    snap = m; taken = t;
  };

  const play = () => {
    if (!snap) return;
    const before = snap; const fresh = now() - taken <= SNAPSHOT_TTL;
    snap = null; // jedna změna = jedno přeskládání
    if (!fresh || !active()) return;
    for (const el of main.querySelectorAll(FLIP_SELECTOR)) {
      const b = before.get(el);
      if (!b || el.hasAttribute('data-lv') || typeof el.animate !== 'function') continue; // nová karta, nebo se zrovna objevuje
      const d = flipDelta(b, place(el), win.innerHeight);
      if (d) el.animate([{ transform: `translate(${d.dx}px, ${d.dy}px)` }, { transform: 'translate(0px, 0px)' }], { duration: FLIP_MS, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.08)' });
    }
  };

  const mo = new MO(play);
  mo.observe(main, { childList: true, subtree: true });
  const events = ['pointerdown', 'keydown', 'input', 'change'];
  for (const t of events) doc.addEventListener(t, take, { capture: true, passive: true });
  return () => {
    mo.disconnect();
    for (const t of events) doc.removeEventListener(t, take, { capture: true });
    snap = null;
  };
};
