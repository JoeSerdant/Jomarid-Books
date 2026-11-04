import { useContext, useLayoutEffect, useRef } from 'react';
import { ThemeContext } from '../contexts/AuthContext';
import { countAt, countDuration } from './motion';
import { prefersReducedMotion } from './reduced';

// Číslo, které se v Živém režimu „dotočí“ z nuly (nebo z předchozí hodnoty) na cílovou hodnotu. Mimo Živý režim, při omezeném pohybu
// a u hodnoty, která není číslo, se ukáže rovnou. Text se zapisuje přímo do prvku (žádné překreslování Reactu v každém snímku).

export const CountUp = ({ value, format = String, delay = 250 }) => {
  const ctx = useContext(ThemeContext);
  const lively = !!(ctx && ctx.lively);
  const ref = useRef(null);
  const shown = useRef(null); // číslo, které je právě vidět (null = zatím nic)
  const target = typeof value === 'number' ? value : Number(value);
  const animated = lively && Number.isFinite(target) && !prefersReducedMotion();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (!animated) { shown.current = Number.isFinite(target) ? target : null; el.textContent = format(value); return undefined; }
    const from = shown.current == null ? 0 : shown.current;
    if (from === target) { el.textContent = format(target); return undefined; }
    el.textContent = format(from);
    const duration = countDuration(from, target);
    let raf = 0; let startAt = 0;
    const tick = (now) => {
      if (!startAt) startAt = now;
      const p = (now - startAt) / duration;
      const v = p >= 1 ? target : countAt(from, target, p);
      shown.current = v;
      el.textContent = format(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    const timer = setTimeout(() => { raf = requestAnimationFrame(tick); }, delay);
    return () => { clearTimeout(timer); cancelAnimationFrame(raf); };
  }, [animated, target]); // eslint-disable-line react-hooks/exhaustive-deps

  return <span ref={ref} />;
};
