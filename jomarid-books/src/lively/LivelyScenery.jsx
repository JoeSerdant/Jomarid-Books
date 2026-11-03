import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { livelyScope, pointerOffset, scrollProgress } from './scope';
import { SIDE_ITEMS, ROAMERS, particles } from './items';
import { SCENES } from './Scenes';
import { installClickSparkles } from './sparkles';

// Živý režim (Nastavení -> Vzhled): animované postavičky po stranách, tvorové přelétající obrazovku, pohyblivé pozadí, světlo za myší,
// pruh průběhu stránky a jiskřičky po kliknutí. Vykresluje se jen při zapnutém režimu a jen mimo čtečku a hry.
// Všechno je jen ozdoba: aria-hidden, žádné ovládání (pointer-events: none), barvy z motivu, pohyb vypíná „Omezit pohyb“.
const PARTICLES = particles();
const reduced = () => document.documentElement.dataset.reduceMotion === '1';

const SideColumn = ({ side, items }) => (
  <div className={`lv-side lv-side-${side}`}>
    {items.map((it, i) => {
      const Scene = SCENES[it.scene];
      return (
        <span key={`${it.scene}-${i}`} className="lv-item" style={{ '--x': `${it.x}%`, '--y': `${it.y}%`, '--f': it.par, '--dp': it.dp }}>
          <span className="lv-art" style={{ '--sz': `${it.size}px`, '--i': i + (side === 'right' ? 1 : 0) }}>
            <Scene className={`lv-float-${it.float}`} style={{ '--dur': `${it.dur}s`, '--del': `${it.del}s` }} />
          </span>
        </span>
      );
    })}
  </div>
);

const Roamer = ({ r }) => {
  const Scene = SCENES[r.scene];
  const style = { '--w': `${r.w}px`, '--dur': `${r.dur}s`, '--del': `${r.del}s`, ...(r.top != null ? { '--top': `${r.top}%` } : {}), ...(r.c1 ? { '--c1': r.c1, '--c2': r.c2 } : {}) };
  return (
    <div className={`lv-roam lv-roam-${r.kind} ${r.desktop ? 'lv-desktop-only' : ''}`} style={style}>
      <div className="lv-wander"><Scene /></div>
    </div>
  );
};

// Pruh průběhu stránky nahoře a houpání ozdob po stranách při posouvání (každá jinak, jako hloubka). Píše přímo do prvků
// (žádné překreslování Reactu při každém posunu). Při omezeném pohybu se ozdoby nehýbou, pruh zůstává.
const ScrollEffects = () => {
  const ref = useRef(null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const el = ref.current;
      if (!el) return;
      const doc = document.documentElement;
      el.style.transform = `scaleX(${scrollProgress(window.scrollY, doc.scrollHeight, window.innerHeight)})`;
      const sides = document.querySelector('.lv-sides');
      if (sides) sides.style.setProperty('--lv-scroll', reduced() ? '0' : String(Math.round(window.scrollY)));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); if (frame) cancelAnimationFrame(frame); };
  }, []);
  return <div ref={ref} className="lv-progress" data-testid="lively-progress" aria-hidden="true" />;
};

// Světlo, které se pomalu vleče za myší, a lehký posun ozdob a skvrn podle polohy myši (sova se dívá za ní). Jen s myší nebo touchpadem.
const usePointerEffects = (enabled) => {
  useEffect(() => {
    if (!enabled || !window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return undefined;
    let frame = 0; let x = 0; let y = 0;
    const apply = () => {
      frame = 0;
      if (reduced()) return;
      const { px, py } = pointerOffset(x, y, window.innerWidth, window.innerHeight);
      for (const el of document.querySelectorAll('.lv-sides, .lv-bg')) { el.style.setProperty('--px', px.toFixed(3)); el.style.setProperty('--py', py.toFixed(3)); }
      const spot = document.querySelector('.lv-spot');
      if (spot) { spot.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`; spot.style.opacity = '0.2'; }
    };
    const onMove = (e) => { x = e.clientX; y = e.clientY; if (!frame) frame = requestAnimationFrame(apply); };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => { window.removeEventListener('pointermove', onMove); if (frame) cancelAnimationFrame(frame); };
  }, [enabled]);
};

export const LivelyScenery = ({ enabled }) => {
  const { pathname } = useLocation();
  const scope = livelyScope(pathname);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  // Čtečka a hry jsou klidné: stránce se dá značka, kterou lively.css respektuje u vstupních animací stránek a karet.
  // Layout effect proto, aby značka platila ještě před prvním vykreslením nové stránky.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (enabled && !scope.ambient) root.dataset.livelyCalm = '1'; else delete root.dataset.livelyCalm;
    return () => { delete root.dataset.livelyCalm; };
  }, [enabled, scope.ambient]);

  // Jiskřičky po kliknutí: jeden posluchač na dokumentu, zapnutý jen při zapnutém režimu.
  useEffect(() => (enabled ? installClickSparkles({ getScope: () => scopeRef.current }) : undefined), [enabled]);
  usePointerEffects(enabled && scope.ambient);

  if (!enabled || !scope.ambient) return null;
  return (
    <>
      <div className="lv-bg" data-testid="lively-bg" aria-hidden="true">
        <i className="lv-blob lv-blob-a" />
        <i className="lv-blob lv-blob-b" />
        <i className="lv-blob lv-blob-c" />
        <i className="lv-spot" />
        {PARTICLES.map((p, i) => <i key={i} className={`lv-dot lv-dot-${p.shape}`} style={{ '--x': `${p.x}%`, '--s': `${p.size}px`, '--dur': `${p.dur}s`, '--del': `${p.del}s` }} />)}
        <i className="lv-shoot" />
      </div>
      {scope.sides && (
        <div className="lv-sides" data-testid="lively-sides" aria-hidden="true">
          <SideColumn side="left" items={SIDE_ITEMS.left} />
          <SideColumn side="right" items={SIDE_ITEMS.right} />
        </div>
      )}
      <div className="lv-roamers" data-testid="lively-roamers" aria-hidden="true">
        {ROAMERS.map((r, i) => <Roamer key={i} r={r} />)}
      </div>
      <ScrollEffects />
    </>
  );
};
