import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { computeCardPosition, computeSpotlight } from './tourLayout';

// Prohlídka: ztmavená plocha se zvýrazněným prvkem a karta s popisem kroku.
// Ovládání: tlačítka, šipky vlevo/vpravo, Esc = přeskočit. Na telefonu je karta přilepená k dolnímu okraji;
// když se v okně nevejde (telefon na šířku, zvětšené písmo), zmenší se a její text se posouvá, tlačítka zůstávají vidět.

const ANCHOR_RE = /^[a-z][a-z-]*$/;
const FIND_TIMEOUT_MS = 1500; // jak dlouho se čeká na cíl (např. po přechodu na jinou stránku), než se karta ukáže uprostřed
const FAST_POLL_MS = 1500;    // po změně kroku se cíl hledá každý snímek, pak už jen občas

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
// Prvek v přilepené liště (menu) je vždy na očích, ten se neposouvá.
const hasStickyAncestor = (el) => {
  for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
    const p = window.getComputedStyle(n).position;
    if (p === 'sticky' || p === 'fixed') return true;
  }
  return false;
};
const navbarHeight = () => parseFloat(window.getComputedStyle(document.documentElement).getPropertyValue('--navbar-h')) || 0;
// Cíl, který není celý vidět pod horní lištou, se posune hned pod ni: dole zbude nejvíc místa pro kartu.
const ensureInView = (el) => {
  if (hasStickyAncestor(el)) return;
  const r = el.getBoundingClientRect();
  const top = navbarHeight() + 12;
  if (r.top >= top - 1 && r.bottom <= document.documentElement.clientHeight - 12) return;
  window.scrollBy({ top: r.top - top, left: 0, behavior: 'auto' });
};
const sameRect = (a, b) => a && b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;

export const TourOverlay = ({ steps, index, onIndex, onClose }) => {
  const step = steps[index];
  const anchor = step?.anchor;
  const stepId = step?.id;
  const isFirst = index === 0;
  const isLast = index === steps.length - 1;
  const cardRef = useRef(null);
  const bodyRef = useRef(null);
  const [rect, setRect] = useState(null);
  const [finding, setFinding] = useState(false);
  const [cardSize, setCardSize] = useState({ width: 360, height: 220 });
  const [viewport, setViewport] = useState(readViewport);
  const titleId = useId();
  const counterId = useId();
  const textId = useId();

  // Vždy aktuální funkce pro posluchače klávesnice (ten se registruje jen jednou).
  const api = useRef({});
  api.current = {
    next: () => (isLast ? onClose(true) : onIndex(index + 1)),
    arrowNext: () => { if (!isLast) onIndex(index + 1); }, // šipka nikdy nedokončí prohlídku, to dělá jen tlačítko Hotovo
    prev: () => { if (!isFirst) onIndex(index - 1); },
    close: () => onClose(false),
  };

  // Při zapnutí: zamknout posouvání stránky (karta se zvýrazněním se nesmí rozjet), zaměřit kartu a po skončení vrátit zaměření.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const previous = { overflow: html.style.overflow, paddingRight: html.style.paddingRight, bodyOverflowX: body.style.overflowX };
    const scrollbar = window.innerWidth - html.clientWidth;
    html.style.overflow = 'hidden';
    if (scrollbar > 0) html.style.paddingRight = `${scrollbar}px`; // stránka po zmizení posuvníku neposkočí a ztmavení pokryje celou šířku
    // Bez toho by body s overflow-x:hidden po zamčení html převzalo roli posuvníku a přilepená lišta by se uvolnila.
    body.style.overflowX = 'clip';
    const focusedBefore = document.activeElement;
    bodyRef.current?.focus({ preventScroll: true });
    return () => {
      html.style.overflow = previous.overflow;
      html.style.paddingRight = previous.paddingRight;
      body.style.overflowX = previous.bodyOverflowX;
      try { if (focusedBefore && document.contains(focusedBefore)) focusedBefore.focus({ preventScroll: true }); } catch { /* prvek už neexistuje */ }
    };
  }, []);

  // Klávesnice: Esc přeskočí, šipky listují, Tab zůstává uvnitř karty. Klávesové zkratky prohlížeče (Alt+šipka) a
  // podržená šipka se nechají být.
  useEffect(() => {
    const onKey = (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); api.current.close(); return; }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        if (e.repeat) return;
        if (e.key === 'ArrowRight') api.current.arrowNext(); else api.current.prev();
        return;
      }
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
  // Po změně kroku se hledá každý snímek (aby se po přechodu nic neukazovalo na špatném místě), pak jen občas.
  useEffect(() => {
    setRect(null);
    if (!stepId || !anchor || anchor === 'none') { setFinding(false); return undefined; }
    setFinding(true);
    let cancelled = false;
    let el = null;
    let scrolled = false;
    let fastRaf = 0;
    let schedRaf = 0;
    const startedAt = performance.now();
    const run = () => {
      if (cancelled) return;
      if (!el || !el.isConnected || !isVisible(el)) { el = findTarget(anchor); scrolled = false; }
      if (!el) {
        setRect((prev) => (prev === null ? prev : null));
        if (performance.now() - startedAt > FIND_TIMEOUT_MS) setFinding(false);
        return;
      }
      if (!scrolled) { scrolled = true; ensureInView(el); }
      const r = el.getBoundingClientRect();
      const next = { top: r.top, left: r.left, width: r.width, height: r.height };
      setRect((prev) => (sameRect(prev, next) ? prev : next));
      setFinding(false);
    };
    const fastLoop = () => {
      fastRaf = 0;
      run();
      if (!cancelled && performance.now() - startedAt < FAST_POLL_MS) fastRaf = window.requestAnimationFrame(fastLoop);
    };
    const schedule = () => { if (!schedRaf) schedRaf = window.requestAnimationFrame(() => { schedRaf = 0; run(); }); };
    const onResize = () => { scrolled = false; schedule(); }; // po otočení telefonu se cíl znovu dostane do okna
    run();
    fastRaf = window.requestAnimationFrame(fastLoop);
    const timer = window.setInterval(run, 250);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', schedule, true);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (fastRaf) window.cancelAnimationFrame(fastRaf);
      if (schedRaf) window.cancelAnimationFrame(schedRaf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [stepId, anchor]);

  // Přirozená výška karty (bez omezení maxHeight) - podle ní se rozhoduje, kam karta půjde a zda se musí zmenšit.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return undefined;
    const measure = () => {
      const keep = el.style.maxHeight;
      el.style.maxHeight = 'none';
      const r = el.getBoundingClientRect();
      el.style.maxHeight = keep;
      setCardSize((prev) => (prev.width === r.width && prev.height === r.height ? prev : { width: r.width, height: r.height }));
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [stepId]);

  if (!step) return null;

  const spotlight = computeSpotlight(rect, viewport);
  const pos = computeCardPosition({ target: spotlight, card: cardSize, viewport });
  // Dokud se po přechodu na jinou stránku hledá cíl, karta se neukazuje (neposkakovala by do středu a zase zpátky).
  const waiting = finding && !rect && anchor !== 'none';

  const ghost = { backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)', borderColor: 'var(--border-color)' };
  const primary = { backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', borderColor: 'transparent' };
  const btn = 'min-h-[44px] px-4 border rounded-lg font-black uppercase text-[11px] tracking-wider cursor-pointer';

  return createPortal(
    <div data-testid="tour-root" className="fixed inset-0" style={{ zIndex: 1100 }}>
      {/* Zachytává kliknutí a tahy, aby se pod prohlídkou nic nepřepínalo. Bez zvýraznění ztmavuje celou plochu sám. */}
      <div aria-hidden="true" className="absolute inset-0" style={{ touchAction: 'none', backgroundColor: spotlight ? 'transparent' : 'rgba(0,0,0,0.62)' }} />
      {spotlight && (
        <div
          aria-hidden="true"
          data-testid="tour-spotlight"
          // outline: v režimu vysokého kontrastu se stíny nevykreslují, průhledný obrys se změní na viditelnou barvu systému
          style={{ position: 'absolute', ...spotlight, borderRadius: 12, pointerEvents: 'none', transition: 'all 200ms ease', outline: '3px solid transparent', boxShadow: '0 0 0 3px rgba(255,255,255,0.92), 0 0 0 9999px rgba(0,0,0,0.62)' }}
        />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={step.title ? undefined : 'Prohlídka appky'}
        aria-labelledby={step.title ? titleId : undefined}
        aria-describedby={step.text ? `${counterId} ${textId}` : counterId}
        data-testid="tour-card"
        data-placement={pos.placement}
        style={{
          position: 'absolute', left: pos.left, top: pos.top, width: 'min(360px, calc(100vw - 24px))', maxHeight: pos.maxHeight,
          display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-card)', color: 'var(--text-body)', borderColor: 'var(--border-color)',
          opacity: waiting ? 0 : 1, pointerEvents: waiting ? 'none' : 'auto', transition: 'opacity 150ms ease',
        }}
        className="border rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Text se v případě potřeby posouvá, tlačítka pod ním zůstávají vidět. */}
        <div ref={bodyRef} tabIndex={-1} data-testid="tour-body" style={{ overscrollBehavior: 'contain' }} className="min-h-0 overflow-y-auto p-4 sm:p-5 pb-2 sm:pb-2 outline-none">
          <p id={counterId} style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider m-0">Krok {index + 1} z {steps.length}</p>
          {step.title && <h2 id={titleId} className="text-base font-black m-0 mt-1 leading-snug break-words">{step.title}</h2>}
          {step.text && <p id={textId} className="text-sm m-0 mt-2 leading-relaxed whitespace-pre-line break-words">{step.text}</p>}
        </div>

        <div className="shrink-0 px-4 sm:px-5 pb-4 sm:pb-5 pt-2">
          <div className="flex items-center gap-1" aria-hidden="true">
            {steps.map((s, i) => (
              <span key={s.id} style={{ width: i === index ? 18 : 6, backgroundColor: i === index ? 'var(--bg-primary)' : 'var(--border-color)' }} className="h-1.5 rounded-full transition-all" />
            ))}
          </div>
          {/* V pořadí pro Tab je první Další, pak Zpět a až nakonec Přeskočit; vizuálně je Přeskočit vlevo. */}
          <div className="flex flex-row-reverse items-center justify-between gap-3 mt-3">
            <div className="flex flex-row-reverse items-center gap-3">
              <button type="button" data-testid="tour-next" onClick={() => api.current.next()} style={primary} className={btn}>{isLast ? 'Hotovo' : 'Další'}</button>
              {!isFirst && <button type="button" data-testid="tour-prev" onClick={() => api.current.prev()} style={ghost} className={btn}>Zpět</button>}
            </div>
            {isLast
              ? <span />
              : <button type="button" data-testid="tour-skip" onClick={() => api.current.close()} style={{ color: 'var(--text-muted)' }} className="min-h-[44px] px-2 bg-transparent border-none font-black uppercase text-[11px] tracking-wider cursor-pointer">Přeskočit</button>}
          </div>
        </div>
        {/* Čtečky obrazovky tak ohlásí změnu kroku i při listování šipkami, kdy se zaměření nemění. */}
        <p role="status" aria-live="polite" className="sr-only">Krok {index + 1} z {steps.length}{step.title ? `: ${step.title}` : ''}</p>
      </div>
    </div>,
    document.body,
  );
};
