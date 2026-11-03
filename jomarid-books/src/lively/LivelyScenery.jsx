import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { BookOpen, Coffee, Crown, Feather, Flame, Gamepad2, Glasses, Lamp, Moon, Rocket, Sparkles, Star, Trophy } from 'lucide-react';
import { livelyScope, scrollProgress } from './scope';
import { SIDE_ITEMS, particles } from './items';
import { installClickSparkles } from './sparkles';

// Ozdoby Živého režimu (Nastavení -> Vzhled). Vykresluje se jen při zapnutém režimu a jen mimo čtečku a hry.
// Všechno je jen ozdoba: aria-hidden, žádné ovládání (pointer-events: none), barvy z motivu, pohyb vypíná „Omezit pohyb“.
const ICONS = { BookOpen, Coffee, Crown, Feather, Flame, Gamepad2, Glasses, Lamp, Moon, Rocket, Sparkles, Star, Trophy };
const PARTICLES = particles();

const SideColumn = ({ side, items }) => (
  <div className={`lv-side lv-side-${side}`}>
    {items.map((it, i) => {
      const Icon = ICONS[it.icon];
      return (
        <span key={`${it.icon}-${i}`} className="lv-item" style={{ '--x': `${it.x}%`, '--y': `${it.y}%`, '--f': it.par }}>
          <Icon className={`lv-icon lv-${it.anim}`} size={it.size} strokeWidth={1.75} style={{ '--sz': `${it.size}px`, '--dur': `${it.dur}s`, '--del': `${it.del}s` }} />
        </span>
      );
    })}
  </div>
);

// Tenký pruh nahoře ukazuje, kolik stránky je za tebou, a ozdoby po stranách se při posouvání houpou (každá jinak, jako hloubka).
// Píše přímo do prvků (žádné překreslování Reactu při každém posunu). Při omezeném pohybu se ozdoby nehýbou, pruh zůstává.
const ScrollBar = () => {
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
      if (sides) sides.style.setProperty('--lv-scroll', doc.dataset.reduceMotion === '1' ? '0' : String(Math.round(window.scrollY)));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); if (frame) cancelAnimationFrame(frame); };
  }, []);
  return <div ref={ref} className="lv-progress" data-testid="lively-progress" aria-hidden="true" />;
};

export const LivelyScenery = ({ enabled }) => {
  const { pathname } = useLocation();
  const scope = livelyScope(pathname);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  // Jiskřičky po kliknutí: jeden posluchač na dokumentu, zapnutý jen při zapnutém režimu.
  useEffect(() => (enabled ? installClickSparkles({ getScope: () => scopeRef.current }) : undefined), [enabled]);

  if (!enabled || !scope.ambient) return null;
  return (
    <>
      <div className="lv-bg" data-testid="lively-bg" aria-hidden="true">
        <i className="lv-blob lv-blob-a" />
        <i className="lv-blob lv-blob-b" />
        <i className="lv-blob lv-blob-c" />
        {PARTICLES.map((p, i) => <i key={i} className="lv-dot" style={{ '--x': `${p.x}%`, '--s': `${p.size}px`, '--dur': `${p.dur}s`, '--del': `${p.del}s` }} />)}
        <i className="lv-shoot" />
      </div>
      {scope.sides && (
        <div className="lv-sides" data-testid="lively-sides" aria-hidden="true">
          <SideColumn side="left" items={SIDE_ITEMS.left} />
          <SideColumn side="right" items={SIDE_ITEMS.right} />
        </div>
      )}
      <ScrollBar />
    </>
  );
};
