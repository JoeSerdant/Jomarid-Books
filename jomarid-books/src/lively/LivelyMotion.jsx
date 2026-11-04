import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { livelyScope } from './scope';
import { createReveal } from './reveal';
import { installTilt } from './tilt';
import { installClickRipple } from './ripple';
import { trackPointerOrigin } from './viewTransition';
import { prefersReducedMotion } from './reduced';

// Pohyb samotného rozhraní v Živém režimu (Nastavení -> Vzhled): karty, sekce a řádky se objevují postupně a s odrazem, karty knih se
// naklánějí za myší, po kliknutí se rozšíří kruh a motiv se přepíná kruhovým přechodem. Čísla a ukazatele řeší CountUp a data-lv-grow
// přímo na místě, okna a tlačítka CSS (src/lively.css). Nic se nekreslí, jen se dává atribut data-lv a CSS s ním pracuje.
// Čtečka, hry a krátké knihy jsou klidné (livelyScope), při omezeném pohybu se nehýbe nic.

export const LivelyMotion = ({ enabled }) => {
  const { pathname } = useLocation();
  const scope = livelyScope(pathname);
  const on = enabled && scope.motion;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  // Layout effect, ať se karty skryjí ještě před prvním vykreslením (jinak by na chvíli blikly a pak zmizely a vyjely).
  useLayoutEffect(() => {
    if (!on || prefersReducedMotion()) return undefined;
    const reveal = createReveal();
    reveal.start();
    return () => reveal.stop();
  }, [on]);

  useEffect(() => {
    if (!enabled) return undefined;
    const off = [trackPointerOrigin(), installClickRipple({ getScope: () => scopeRef.current })];
    if (on) off.push(installTilt());
    return () => off.forEach((fn) => fn());
  }, [enabled, on]);

  return null;
};
