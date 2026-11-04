// Přechody mezi stavy rozhraní v Živém režimu přes View Transitions API: přepnutí motivu (nový vzhled se rozlije kruhem z místa kliknutí)
// a přechod mezi stránkami (stará stránka odjede, nová naskočí). Prohlížeč, který to neumí, nebo omezený pohyb, změnu provede hned.
// Vzhled přechodu je v src/lively.css; podle atributu data-vt na <html> ("theme" nebo "page") se pozná, který přechod běží.

export const supportsViewTransition = (doc = globalThis.document) => !!doc && typeof doc.startViewTransition === 'function';

/** Zapamatuje si, kam se naposledy kliklo (--vt-x, --vt-y na <html>), ať kruh vyroste z toho místa. Vrací funkci, která to zase vypne. */
export const trackPointerOrigin = (doc = globalThis.document) => {
  if (!doc || typeof doc.addEventListener !== 'function') return () => {};
  const onDown = (e) => {
    const style = doc.documentElement && doc.documentElement.style;
    if (!style || !Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
    style.setProperty('--vt-x', `${Math.round(e.clientX)}px`);
    style.setProperty('--vt-y', `${Math.round(e.clientY)}px`);
  };
  doc.addEventListener('pointerdown', onDown, { passive: true, capture: true });
  return () => doc.removeEventListener('pointerdown', onDown, { capture: true });
};

let counter = 0;

/** Provede změnu (update) s přechodem druhu kind ("theme" nebo "page"), pokud to jde. flush zajistí, že se změna promítne do DOM hned (v Reactu
 *  flushSync). Změna smí vrátit slib: přechod pak čeká, až bude nová stránka hotová. Vrací, zda přechod běží (jinak se změna provedla hned). */
export const runViewTransition = (update, { kind = 'theme', enabled = true, flush = (fn) => fn(), doc = globalThis.document } = {}) => {
  const root = doc && doc.documentElement;
  const reduce = !!root && !!root.dataset && root.dataset.reduceMotion === '1';
  if (!enabled || reduce || !supportsViewTransition(doc) || !root || !root.dataset) { update(); return false; }
  const token = ++counter;
  const clear = () => { if (root.dataset.vt && counter === token) delete root.dataset.vt; };
  try {
    root.dataset.vt = kind;
    const transition = doc.startViewTransition(() => { let result; flush(() => { result = update(); }); return result; });
    if (transition && transition.finished && typeof transition.finished.then === 'function') transition.finished.then(clear, clear); else clear();
    return true;
  } catch {
    clear();
    update();
    return false;
  }
};

/** Přepnutí motivu nebo akcentu: nový vzhled se rozlije kruhem. */
export const withViewTransition = (update, options = {}) => runViewTransition(update, { ...options, kind: 'theme' });
