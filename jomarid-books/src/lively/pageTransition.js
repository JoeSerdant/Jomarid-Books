// Přechod mezi stránkami v Živém režimu: klik na odkaz uvnitř appky nepřepne stránku skokem, ale stará stránka odjede a nová naskočí
// (View Transitions API, vzhled v src/lively.css pod data-vt="page"). Odkaz se jinak chová úplně normálně: s Ctrl, Shiftem, prostředním
// tlačítkem, v novém okně, na jiný web, ke stažení i uvnitř oken se nic nezachytává. Nevyhovuje-li prohlížeč, nebo je pohyb omezený, jede se jako dřív.
import { livelyScope } from './scope.js';
import { runViewTransition } from './viewTransition.js';

/** Kam má odkaz vést, pokud se má přechod použít; jinak null (nechá se na prohlížeči a routeru). Čistá funkce, jde testovat bez prohlížeče. */
export const transitionTarget = (e, a, loc) => {
  if (!e || !a || !loc || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  if (typeof a.hasAttribute === 'function' && (a.hasAttribute('data-lv-no-transition') || a.hasAttribute('download'))) return null;
  if (typeof a.closest === 'function' && a.closest('[role="dialog"], [data-lv-no-transition]')) return null;
  if (a.target && a.target !== '_self') return null;
  if (/\bexternal\b/.test(String(a.rel || ''))) return null;
  if (a.origin !== loc.origin) return null;
  if (a.pathname === loc.pathname && (a.search || '') === (loc.search || '')) return null; // ta samá stránka nebo jen kotva
  if (!livelyScope(a.pathname).motion) return null; // do čtečky a her se jde bez efektů
  return `${a.pathname}${a.search || ''}${a.hash || ''}`;
};

/** Počká, až se po přepnutí stránky objeví její obsah (líně načítané stránky nejdřív ukážou „Načítám...“), nejvýš timeout ms.
 *  Čeká na časovač, ne na requestAnimationFrame: po dobu přechodu prohlížeč pozastaví vykreslování a snímky by nepřišly (přechod by vypršel). */
export const waitForPage = ({ doc = globalThis.document, later = (fn) => globalThis.setTimeout(fn, 40), now = () => globalThis.performance.now(), timeout = 900 } = {}) => new Promise((resolve) => {
  const start = now();
  const loading = () => { const main = doc.querySelector('main'); const status = main && main.querySelector('[role="status"]'); return !!status && /Načítám/.test(status.textContent || ''); };
  const tick = () => { if (!loading() || now() - start >= timeout) resolve(); else later(tick); };
  later(tick);
});

export const installPageTransitions = ({
  doc = globalThis.document, win = globalThis.window, navigate, flush = (fn) => fn(), getScope = () => ({ motion: true }), wait = () => waitForPage({ doc }),
} = {}) => {
  if (!doc || typeof doc.addEventListener !== 'function' || typeof navigate !== 'function') return () => {};
  const onClick = (e) => {
    const root = doc.documentElement;
    if (!root || !root.dataset || root.dataset.lively !== '1' || root.dataset.reduceMotion === '1' || typeof doc.startViewTransition !== 'function') return;
    if (!getScope().motion) return;
    const a = e.target && typeof e.target.closest === 'function' ? e.target.closest('a[href]') : null;
    const to = a ? transitionTarget(e, a, win.location) : null;
    if (!to) return;
    e.preventDefault();
    runViewTransition(() => { navigate(to); return wait(); }, { kind: 'page', flush, doc });
  };
  doc.addEventListener('click', onClick, true);
  return () => doc.removeEventListener('click', onClick, true);
};
