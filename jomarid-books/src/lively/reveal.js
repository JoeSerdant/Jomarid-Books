// Postupné objevování karet, sekcí a řádků (Živý režim): prvek, který se dostane do okna, vyjede s odrazem a sousedé se objevují
// jeden po druhém. Platí při otevření stránky, při načtení dat (karty přijdou později) i při scrollu.
//
// Jak to funguje: každému vhodnému prvku se dá atribut data-lv="wait" (v CSS je průhledný a posunutý), IntersectionObserver ho pozná,
// jakmile se dostane do okna, a atribut se změní na data-lv="in" (CSS pustí animaci se zpožděním --lv-d). Po dohrání se atribut odebere
// a prvek je zase úplně obyčejný (žádná zbytková transformace, hover a přechody fungují jako dřív). Prvek uvnitř jiné karty (řádek
// v žebříčku, ukazatel) čeká „zaparkovaný“ (data-lv="parked"), dokud se neobjeví karta, a začne chvíli po ní.
//
// Bezpečnost: nic se nedělá bez IntersectionObserveru; po vteřině a půl se objeví všechno, co je v okně a ještě čeká; a stránka bez JavaScriptu
// nikdy nic skryté nemá (atributy dává až skript). Prvky ve vyskakovacích oknech, přilepené a s position: fixed se nechávají být.
import { NESTED_BASE, staggerDelay } from './motion.js';

export const CARD_SELECTOR = 'main :is(section, article), main :is(div, li, a).border:is(.rounded-xl, .rounded-2xl, .rounded-3xl)';
export const GROW_SELECTOR = 'main [data-lv-grow]';
export const REVEAL_SELECTOR = `${CARD_SELECTOR}, ${GROW_SELECTOR}`;
export const SKIP_SELECTOR = '[data-lv-skip], [role="dialog"], .fixed, .sticky, nav';
export const MIN_WIDTH = 120;  // menší prvky (štítky, tlačítka, políčka) se nehýbou
export const MIN_HEIGHT = 44;
export const ANIMATIONS = ['lvIn', 'lvGrow']; // názvy animací z lively.css, jejichž dohrání prvek „uvolní“
const SWEEP_MS = 1500;
const SETTLE_EXTRA_MS = 1400; // pojistka: kdyby animationend nedorazil, prvek se uvolní sám

export const isCandidate = (el) => {
  if (!el || el.nodeType !== 1 || typeof el.matches !== 'function') return false;
  if (el.hasAttribute('data-lv')) return false;
  if (el.closest(SKIP_SELECTOR)) return false;
  if (el.matches(GROW_SELECTOR)) return true;
  if (!el.matches(CARD_SELECTOR) || el.classList.contains('absolute')) return false;
  const r = el.getBoundingClientRect();
  return r.width >= MIN_WIDTH && r.height >= MIN_HEIGHT;
};

export const createReveal = ({
  doc = globalThis.document, win = globalThis.window, IO = globalThis.IntersectionObserver, MO = globalThis.MutationObserver,
  setTimer = (fn, ms) => globalThis.setTimeout(fn, ms), clearTimer = (id) => globalThis.clearTimeout(id),
} = {}) => {
  let info = new WeakMap();    // prvek -> {status: 'wait' | 'parked' | 'in', base, until, timer}
  let settled = new WeakSet(); // prvky, které už jednou vyjely (znovu se nehýbou, ani když je React přesune)
  let kids = new WeakMap();    // karta -> zaparkované prvky uvnitř
  let live = new Set();        // všechny prvky, které čekají nebo právě jedou
  let io = null; let mo = null; let sweepTimer = 0; let running = false;

  const status = (el) => (info.get(el) || {}).status;
  const byPosition = (a, b) => { const ra = a.getBoundingClientRect(); const rb = b.getBoundingClientRect(); return (ra.top - rb.top) || (ra.left - rb.left); };
  const inWindow = (el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < (win.innerHeight || 0) && r.height > 0; };

  const settle = (el) => {
    const st = info.get(el);
    if (!st) return;
    clearTimer(st.timer);
    info.delete(el); live.delete(el); settled.add(el);
    el.removeAttribute('data-lv');
    el.style.removeProperty('--lv-d');
  };

  const show = (el, index) => {
    const st = info.get(el);
    if (!st || st.status === 'in') return;
    io.unobserve(el);
    const delay = staggerDelay(index, st.base);
    el.style.setProperty('--lv-d', `${delay.toFixed(2)}s`);
    el.setAttribute('data-lv', 'in');
    st.status = 'in';
    st.until = delay + NESTED_BASE;
    st.timer = setTimer(() => settle(el), (delay * 1000) + 700 + SETTLE_EXTRA_MS);
    const inside = kids.get(el);
    if (inside) {
      kids.delete(el);
      for (const child of inside) {
        const cs = info.get(child);
        if (cs && cs.status === 'parked') { cs.status = 'wait'; cs.base = st.until; child.setAttribute('data-lv', 'wait'); io.observe(child); }
      }
    }
  };

  const trackedAncestor = (el) => {
    let p = el.parentElement;
    while (p) {
      const card = p.closest(CARD_SELECTOR);
      if (!card) return null;
      if (info.has(card)) return card;
      p = card.parentElement;
    }
    return null;
  };

  const register = (el) => {
    const parent = trackedAncestor(el);
    const pst = parent && info.get(parent);
    const parked = !!pst && pst.status !== 'in';
    info.set(el, { status: parked ? 'parked' : 'wait', base: pst && pst.status === 'in' ? pst.until : 0, until: 0, timer: 0 });
    el.setAttribute('data-lv', parked ? 'parked' : 'wait');
    live.add(el);
    if (parked) { if (!kids.has(parent)) kids.set(parent, new Set()); kids.get(parent).add(el); } else io.observe(el);
  };

  const scan = (node) => {
    if (!node || node.nodeType !== 1) return;
    const list = [];
    if (typeof node.matches === 'function' && node.matches(REVEAL_SELECTOR)) list.push(node);
    list.push(...node.querySelectorAll(REVEAL_SELECTOR)); // v pořadí dokumentu: rodiče před dětmi
    for (const el of list) if (!settled.has(el) && !info.has(el) && isCandidate(el)) register(el);
  };

  const sweep = () => {
    sweepTimer = 0;
    let i = 0;
    for (const el of [...live]) {
      if (!el.isConnected) { const st = info.get(el); if (st) clearTimer(st.timer); info.delete(el); live.delete(el); continue; }
      if (status(el) === 'wait' && inWindow(el)) show(el, i++);
    }
  };
  const scheduleSweep = () => { if (!sweepTimer && running) sweepTimer = setTimer(sweep, SWEEP_MS); };

  const onIntersect = (entries) => {
    const hits = entries.filter((e) => e.isIntersecting && status(e.target) === 'wait').map((e) => e.target);
    if (!hits.length) return;
    hits.sort(byPosition).forEach((el, i) => show(el, i));
  };
  const onMutations = (records) => {
    for (const r of records) for (const n of r.addedNodes) scan(n);
    scheduleSweep();
  };
  const onAnimationEnd = (e) => { if (status(e.target) === 'in' && ANIMATIONS.includes(e.animationName)) settle(e.target); };

  const start = () => {
    if (running) return true;
    const main = doc && doc.querySelector ? doc.querySelector('main') : null;
    if (!IO || !MO || !main) return false;
    running = true;
    io = new IO(onIntersect, { rootMargin: '0px 0px -6% 0px', threshold: 0 });
    mo = new MO(onMutations);
    mo.observe(main, { childList: true, subtree: true });
    doc.addEventListener('animationend', onAnimationEnd, true);
    scan(main);
    scheduleSweep();
    return true;
  };

  const stop = () => {
    if (!running) return;
    running = false;
    if (io) io.disconnect();
    if (mo) mo.disconnect();
    doc.removeEventListener('animationend', onAnimationEnd, true);
    if (sweepTimer) clearTimer(sweepTimer);
    sweepTimer = 0;
    for (const el of live) { const st = info.get(el); if (st) clearTimer(st.timer); el.removeAttribute('data-lv'); el.style.removeProperty('--lv-d'); }
    info = new WeakMap(); settled = new WeakSet(); kids = new WeakMap(); live = new Set(); io = null; mo = null;
  };

  return { start, stop, scan, counts: () => { const c = { wait: 0, parked: 0, in: 0 }; for (const el of live) { const s = status(el); if (s) c[s] += 1; } return c; } };
};
