import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { computeCardPosition, computeSpotlight } from './tourLayout';

// Prohlídka: ztmavená plocha se zvýrazněným prvkem a karta s popisem kroku.
// Ovládání: tlačítka, šipky vlevo/vpravo, Esc = přeskočit. Na telefonu je karta přilepená k dolnímu okraji.

const ANCHOR_RE = /^[a-z][a-z-]*$/;
const readViewport = () => ({ width: document.documentElement.clientWidth, height: document.documentElement.clientHeight });

const isVisible = (el) => {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const st = window.getComputedStyle(el);
  return st.visibility !== 'hidden' && st.display !== 'none';
};
// Prvek může mít víc výskytů (např. jiné rozložení na telefonu) - bere se první viditelný.
const findTarget = (anchor) => {
  if (!ANCHOR_RE.test(anchor)) return null;
  return Array.from(document.querySelectorAll(`[data-tour="${anchor}"]`)).find(isVisible) || null;
};
const ensureInView = (el) => {
  const r = el.getBoundingClientRect();
  if (r.top < 0 || r.bottom > document.documentElement.clientHeight) el.scrollIntoView({ block: 'center', inline: 'nearest' });
};
const sameRect = (a, b) => a && b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;

export const TourOverlay = ({ steps, index, onIndex, onClose }) => {
  const step = steps[index];
  const anchor = step?.anchor;
  const stepId = step?.id;
  const isFirst = index === 0;
  const isLast = index === steps.length - 1;
  const cardRef = useRef(null);
  const [rect, setRect] = useState(null);
  const [cardSize, setCardSize] = useState({ width: 360, height: 220 });
  const [viewport, setViewport] = useState(readViewport);
  const titleId = useId();
  const textId = useId();

  // Vždy aktuální funkce pro posluchače klávesnice (ten se registruje jen jednou).
  const api = useRef({});
  api.current = {
    next: () => (isLast ? onClose(true) : onIndex(index + 1)),
    arrowNext: () => { if (!isLast) onIndex(index + 1); }, // šipka nikdy nedokončí prohlídku, to dělá jen tlačítko Hotovo
    prev: () => { if (!isFirst) onIndex(index - 1); },
    close: () => onClose(false),
  };

  // Při zapnutí: zamknout posouvání stránky (karta s prvkem se nesmí rozjet) a po skončení vrátit zaměření.
  useEffect(() => {
    const html = document.documentElement;
    const previous = { overflow: html.style.overflow, gutter: html.style.scrollbarGutter };
    const hadScrollbar = window.innerWidth > html.clientWidth;
    html.style.overflow = 'hidden';
    if (hadScrollbar) html.style.scrollbarGutter = 'stable'; // aby stránka po zmizení posuvníku neposkočila do strany
    const focusedBefore = document.activeElement;
    return () => {
      html.style.overflow = previous.overflow;
      html.style.scrollbarGutter = previous.gutter;
      try { if (focusedBefore && document.contains(focusedBefore)) focusedBefore.focus({ preventScroll: true }); } catch { /* prvek už neexistuje */ }
    };
  }, []);

  // Klávesnice: Esc přeskočí, šipky listují, Tab zůstává uvnitř karty.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); api.current.close(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); api.current.arrowNext(); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); api.current.prev(); return; }
      if (e.key === 'Tab' && cardRef.current) {
        const items = Array.from(cardRef.current.querySelectorAll('button:not([disabled])'));
        if (items.length === 0) return;
        const i = items.indexOf(document.activeElement);
        e.preventDefault();
        items[e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i === items.length - 1 ? 0 : i + 1)].focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // Velikost okna.
  useEffect(() => {
    const onResize = () => setViewport((v) => { const n = readViewport(); return v.width === n.width && v.height === n.height ? v : n; });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Hledání a sledování zvýrazněného prvku: může se objevit až po přechodu na jinou stránku a hýbat se při posouvání.
  useEffect(() => {
    setRect(null);
    if (!stepId || !anchor || anchor === 'none') return undefined;
    let cancelled = false;
    let el = null;
    let raf = 0;
    let scrolled = false;
    const measure = () => {
      raf = 0;
      if (cancelled) return;
      if (!el || !el.isConnected || !isVisible(el)) { el = findTarget(anchor); scrolled = false; }
      if (!el) { setRect((prev) => (prev === null ? prev : null)); return; }
      if (!scrolled) { scrolled = true; ensureInView(el); }
      const r = el.getBoundingClientRect();
      const next = { top: r.top, left: r.left, width: r.width, height: r.height };
      setRect((prev) => (sameRect(prev, next) ? prev : next));
    };
    const schedule = () => { if (!raf) raf = window.requestAnimationFrame(measure); };
    measure();
    const timer = window.setInterval(measure, 250);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [stepId, anchor]);

  // Rozměry karty (kvůli umístění) a zaměření na ni při každém kroku, ať ji čtečky obrazovky přečtou.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return undefined;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setCardSize((prev) => (prev.width === r.width && prev.height === r.height ? prev : { width: r.width, height: r.height }));
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [index]);
  useEffect(() => { cardRef.current?.focus({ preventScroll: true }); }, [index]);

  if (!step) return null;

  const spotlight = computeSpotlight(rect, viewport);
  const pos = computeCardPosition({ target: spotlight, card: cardSize, viewport });

  const ghost = { backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)', borderColor: 'var(--border-color)' };
  const primary = { backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', borderColor: 'transparent' };
  const btn = 'px-3.5 py-2 border rounded-lg font-black uppercase text-[11px] tracking-wider cursor-pointer';

  return createPortal(
    <div data-testid="tour-root" className="fixed inset-0" style={{ zIndex: 1100 }}>
      {/* Zachytává kliknutí a tahy, aby se pod prohlídkou nic nepřepínalo. Bez zvýraznění ztmavuje celou plochu sám. */}
      <div aria-hidden="true" className="absolute inset-0" style={{ touchAction: 'none', backgroundColor: spotlight ? 'transparent' : 'rgba(0,0,0,0.62)' }} />
      {spotlight && (
        <div
          aria-hidden="true"
          data-testid="tour-spotlight"
          style={{ position: 'absolute', ...spotlight, borderRadius: 12, pointerEvents: 'none', transition: 'all 200ms ease', boxShadow: '0 0 0 3px rgba(255,255,255,0.92), 0 0 0 9999px rgba(0,0,0,0.62)' }}
        />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={step.title ? undefined : 'Prohlídka appky'}
        aria-labelledby={step.title ? titleId : undefined}
        aria-describedby={step.text ? textId : undefined}
        tabIndex={-1}
        data-testid="tour-card"
        data-placement={pos.placement}
        style={{ position: 'absolute', left: pos.left, top: pos.top, width: 'min(360px, calc(100vw - 24px))', backgroundColor: 'var(--bg-card)', color: 'var(--text-body)', borderColor: 'var(--border-color)', transition: 'top 200ms ease, left 200ms ease' }}
        className="border rounded-2xl shadow-2xl p-4 sm:p-5 outline-none"
      >
        <p style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider m-0">Krok {index + 1} z {steps.length}</p>
        {step.title && <h2 id={titleId} className="text-base font-black m-0 mt-1 leading-snug break-words">{step.title}</h2>}
        {step.text && <p id={textId} className="text-sm m-0 mt-2 leading-relaxed whitespace-pre-line break-words">{step.text}</p>}

        <div className="flex items-center gap-1 mt-3" aria-hidden="true">
          {steps.map((s, i) => (
            <span key={s.id} style={{ width: i === index ? 18 : 6, backgroundColor: i === index ? 'var(--bg-primary)' : 'var(--border-color)' }} className="h-1.5 rounded-full transition-all" />
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 mt-4">
          {isLast
            ? <span />
            : <button type="button" data-testid="tour-skip" onClick={() => api.current.close()} style={{ color: 'var(--text-muted)' }} className="px-1 py-2 bg-transparent border-none font-black uppercase text-[11px] tracking-wider cursor-pointer">Přeskočit</button>}
          <div className="flex items-center gap-2">
            {!isFirst && <button type="button" data-testid="tour-prev" onClick={() => api.current.prev()} style={ghost} className={btn}>Zpět</button>}
            <button type="button" data-testid="tour-next" onClick={() => api.current.next()} style={primary} className={btn}>{isLast ? 'Hotovo' : 'Další'}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
