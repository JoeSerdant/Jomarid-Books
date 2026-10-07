import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { TourOverlay } from './TourOverlay';
import { TOUR_SETTINGS_KEY, activeSteps, defaultTour, normalizeTour, routeForAnchor, shouldAutoStart } from './tourModel';
import { markTourSeen, readSeenVersion } from './tourSeen';

// Prohlídka appky: načte nastavení ze site_settings, po prvním přihlášení se sama spustí a jde spustit i ručně
// (Nastavení -> Prohlídka appky, náhled v administraci). Obsah kroků a pravidla jsou v tourModel.js.

const TourContext = createContext(null);
export const useTour = () => useContext(TourContext);

// Administrace po uložení vyšle tuhle událost, ať si prohlídka načte nový obsah.
export const TOUR_CONFIG_EVENT = 'jomarid-tour-config-changed';
const AUTO_START_DELAY_MS = 900; // nechat stránku po přihlášení nejdřív vykreslit

// ok = nastavení se opravdu načetlo (i "žádný záznam" je v pořádku). Při chybě sítě se použije výchozí obsah jen pro ruční
// spuštění; sama se prohlídka nespustí (nevíme, jestli ji správce třeba nevypnul).
const loadTourConfig = async () => {
  try {
    const { data, error } = await supabase.from('site_settings').select('value').eq('key', TOUR_SETTINGS_KEY).maybeSingle();
    if (error) return { config: defaultTour(), ok: false };
    return { config: normalizeTour(data?.value), ok: true };
  } catch {
    return { config: defaultTour(), ok: false };
  }
};

/** blocked = zrovna je otevřené jiné okno (hledání), ve kterém by se prohlídka sama spouštět neměla. */
export const TourProvider = ({ children, blocked = false }) => {
  const { user, role, loading, recoveryMode } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const userId = user?.id;

  const [loaded, setLoaded] = useState(null); // { config, ok } | null = ještě nenačteno
  const [active, setActive] = useState(null); // { steps, index, version, source, startPath, runId }
  const activeRef = useRef(null);
  activeRef.current = active;
  const locationRef = useRef(location);
  locationRef.current = location;
  const autoTried = useRef(new Set()); // uživatelé, kterým se prohlídka v tomhle načtení stránky už zobrazila
  const runCounter = useRef(0);
  const navigatedFor = useRef('');

  // Nastavení prohlídky (jen pro přihlášené; při změně v administraci se načte znovu).
  useEffect(() => {
    if (!userId) { setLoaded(null); return undefined; }
    let cancelled = false;
    const run = async () => { const c = await loadTourConfig(); if (!cancelled) setLoaded(c); };
    run();
    window.addEventListener(TOUR_CONFIG_EVENT, run);
    return () => { cancelled = true; window.removeEventListener(TOUR_CONFIG_EVENT, run); };
  }, [userId]);

  /**
   * Spustí prohlídku. opts.steps = vlastní kroky (náhled z editoru), opts.source = 'auto' | 'manual' | 'preview'.
   * Že uživatel prohlídku viděl, se zapíše hned při zobrazení (ne až na konci): zápis do metadat účtu vyvolá v appce
   * znovunačtení dat a na konci prohlídky by to bylo vidět jako záblesk načítání. Náhled se nezapisuje.
   * Vrací false, když není co ukázat.
   */
  const start = useCallback((opts = {}) => {
    if (activeRef.current) return false;
    const tour = loaded?.config || defaultTour();
    const steps = opts.steps ? opts.steps.filter((st) => st.enabled !== false) : activeSteps(tour, role);
    if (steps.length === 0) return false;
    const source = opts.source || 'manual';
    if (source !== 'preview' && user) {
      autoTried.current.add(user.id); // v téhle relaci se už sama znovu nespustí, ať dopadne zápis jakkoli
      markTourSeen({ client: supabase, user, version: tour.version });
    }
    runCounter.current += 1;
    navigatedFor.current = '';
    setActive({
      steps, index: 0, version: tour.version, source, runId: runCounter.current,
      startPath: locationRef.current.pathname + locationRef.current.search,
    });
    return true;
  }, [loaded, role, user]);

  // Konec prohlídky (dokončení i přeskočení): vrátit uživatele tam, kde byl (bez nového záznamu v historii).
  const end = useCallback(() => {
    const cur = activeRef.current;
    if (!cur) return;
    setActive(null);
    const here = locationRef.current.pathname + locationRef.current.search;
    if (cur.startPath && cur.startPath !== here) navigate(cur.startPath, { replace: true });
  }, [navigate]);

  const setIndex = useCallback((i) => setActive((cur) => (cur && i >= 0 && i < cur.steps.length ? { ...cur, index: i } : cur)), []);

  // Krok, jehož prvek je na jiné stránce, na ni přejde (u každého kroku nejvýš jednou, ať se nezacyklí).
  // Nahrazuje záznam v historii: tlačítko Zpět po prohlídce nesmí vést na stránky, které uživatel sám neotevřel.
  useEffect(() => {
    if (!active) return;
    const key = `${active.runId}:${active.index}`;
    if (navigatedFor.current === key) return;
    navigatedFor.current = key;
    const target = routeForAnchor(active.steps[active.index]?.anchor, location.pathname);
    if (target) navigate(target, { replace: true });
  }, [active, location.pathname, navigate]);

  // Odhlášení uprostřed prohlídky ji tiše ukončí.
  useEffect(() => { if (!user && activeRef.current) setActive(null); }, [user]);

  // Automatické spuštění po prvním přihlášení (pravidla: shouldAutoStart). Čeká na načtenou roli i nastavení.
  useEffect(() => {
    if (loading || !user || !role || recoveryMode || blocked || active || !loaded?.ok) return undefined;
    if (autoTried.current.has(user.id)) return undefined;
    const go = shouldAutoStart({
      tour: loaded.config, role, seenVersion: readSeenVersion(user), createdAt: user.created_at, pathname: location.pathname,
    });
    if (!go) return undefined;
    const timer = window.setTimeout(() => start({ source: 'auto' }), AUTO_START_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [loading, user, role, recoveryMode, blocked, active, loaded, location.pathname, start]);

  const value = useMemo(() => ({ config: loaded?.config ?? null, start, running: !!active }), [loaded, start, active]);

  return (
    <TourContext.Provider value={value}>
      {children}
      {active && <TourOverlay steps={active.steps} index={active.index} onIndex={setIndex} onClose={end} />}
    </TourContext.Provider>
  );
};
