import { useEffect, useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { livelyScope } from './scope';
import { createReveal } from './reveal';
import { installTilt } from './tilt';
import { installFlip } from './flip';
import { installPageTransitions } from './pageTransition';
import { installClickRipple } from './ripple';
import { trackPointerOrigin } from './viewTransition';
import { prefersReducedMotion } from './reduced';

// Pohyb samotného rozhraní v Živém režimu (Nastavení -> Vzhled): karty, sekce a řádky se objevují postupně a s odrazem, karty knih se
// naklánějí za myší a při změně filtru nebo řazení doplují na nová místa, stránky se přepínají odjezdem a příjezdem, po kliknutí se rozšíří
// kruh a motiv se přepíná kruhovým přechodem. Čísla a ukazatele řeší CountUp a data-lv-grow přímo na místě, okna a tlačítka CSS
// (src/lively.css). Nic se nekreslí, jen se dávají atributy (data-lv) a CSS s nimi pracuje.
// Čtečka, hry a krátké knihy jsou klidné (livelyScope), při omezeném pohybu se nehýbe nic.

export const LivelyMotion = ({ enabled }) => {
  const { pathname } = useLocation();
  const scope = livelyScope(pathname);
  const on = enabled && scope.motion;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const navigate = useNavigate();
  const navigateRef = useRef(navigate); // useNavigate se mění s adresou, posluchač potřebuje vždy aktuální
  navigateRef.current = navigate;

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
    if (on) off.push(installTilt(), installFlip(), installPageTransitions({ navigate: (to) => navigateRef.current(to), flush: flushSync, getScope: () => scopeRef.current }));
    return () => off.forEach((fn) => fn());
  }, [enabled, on]);

  return null;
};
