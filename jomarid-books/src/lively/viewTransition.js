// Přepnutí motivu v Živém režimu: nový vzhled se „rozlije“ kruhem z místa, kde jsi klikl (View Transitions API). Prohlížeč, který to neumí,
// nebo omezený pohyb, motiv prostě přepne hned. Vzhled přechodu je v src/lively.css (::view-transition-new(root)).

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

/** Provede změnu (update) s přechodem, pokud to jde. flush zajistí, že se změna promítne do DOM hned (v Reactu flushSync). */
export const withViewTransition = (update, { enabled = true, flush = (fn) => fn(), doc = globalThis.document } = {}) => {
  const reduce = !!doc && doc.documentElement && doc.documentElement.dataset && doc.documentElement.dataset.reduceMotion === '1';
  if (!enabled || reduce || !supportsViewTransition(doc)) { update(); return false; }
  try {
    doc.startViewTransition(() => { flush(update); });
    return true;
  } catch {
    update();
    return false;
  }
};
