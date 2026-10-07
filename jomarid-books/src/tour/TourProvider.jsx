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

const loadTourConfig = async () => {
  try {
    const { data, error } = await supabase.from('site_settings').select('value').eq('key', TOUR_SETTINGS_KEY).maybeSingle();
    return normalizeTour(error ? null : data?.value);
  } catch {
    return defaultTour();
  }
};

export const TourProvider = ({ children }) => {
  const { user, role, loading, recoveryMode } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const userId = user?.id;

  const [config, setConfig] = useState(null); // null = ještě nenačteno
  const [active, setActive] = useState(null); // { steps, index, version, source, startPath, runId }
  const activeRef = useRef(null);
  activeRef.current = active;
  const locationRef = useRef(location);
  locationRef.current = location;
  const autoTried = useRef(new Set()); // uživatelé, kterým se prohlídka v tomhle načtení stránky už sama spustila
  const runCounter = useRef(0);
  const navigatedFor = useRef('');

  // Nastavení prohlídky (jen pro přihlášené; při změně v administraci se načte znovu).
  useEffect(() => {
    if (!userId) { setConfig(null); return undefined; }
    let cancelled = false;
    const run = async () => { const c = await loadTourConfig(); if (!cancelled) setConfig(c); };
    run();
    window.addEventListener(TOUR_CONFIG_EVENT, run);
    return () => { cancelled = true; window.removeEventListener(TOUR_CONFIG_EVENT, run); };
  }, [userId]);

  /**
   * Spustí prohlídku. opts.steps = vlastní kroky (náhled z editoru), opts.source = 'auto' | 'manual' | 'preview'.
   * Náhled se nezapisuje jako "viděno". Vrací false, když není co ukázat.
   */
  const start = useCallback((opts = {}) => {
    if (activeRef.current) return false;
    const tour = config || defaultTour();
    const steps = (opts.steps ? opts.steps.filter((st) => st.enabled !== false) : activeSteps(tour, role));
    if (steps.length === 0) return false;
    runCounter.current += 1;
    navigatedFor.current = '';
    setActive({
      steps, index: 0, version: tour.version, source: opts.source || 'manual', runId: runCounter.current,
      startPath: locationRef.current.pathname + locationRef.current.search,
    });
    return true;
  }, [config, role]);

  // Konec prohlídky (dokončení i přeskočení): zapamatovat, že ji uživatel viděl, a vrátit ho tam, kde byl.
  const end = useCallback(() => {
    const cur = activeRef.current;
    if (!cur) return;
    setActive(null);
    if (cur.source !== 'preview' && user) markTourSeen({ client: supabase, user, version: cur.version });
    const here = locationRef.current.pathname + locationRef.current.search;
    if (cur.startPath && cur.startPath !== here) navigate(cur.startPath);
  }, [navigate, user]);

  const setIndex = useCallback((i) => setActive((cur) => (cur && i >= 0 && i < cur.steps.length ? { ...cur, index: i } : cur)), []);

  // Krok, jehož prvek je na jiné stránce, na ni přejde (u každého kroku nejvýš jednou, ať se nezacyklí).
  useEffect(() => {
    if (!active) return;
    const key = `${active.runId}:${active.index}`;
    if (navigatedFor.current === key) return;
    navigatedFor.current = key;
    const target = routeForAnchor(active.steps[active.index]?.anchor, location.pathname);
    if (target) navigate(target);
  }, [active, location.pathname, navigate]);

  // Odhlášení uprostřed prohlídky ji tiše ukončí.
  useEffect(() => { if (!user && activeRef.current) setActive(null); }, [user]);

  // Automatické spuštění po prvním přihlášení (pravidla: shouldAutoStart).
  useEffect(() => {
    if (loading || !user || recoveryMode || active || !config) return undefined;
    if (autoTried.current.has(user.id)) return undefined;
    const go = shouldAutoStart({
      tour: config, role, seenVersion: readSeenVersion(user), createdAt: user.created_at, pathname: location.pathname,
    });
    if (!go) return undefined;
    const timer = window.setTimeout(() => { autoTried.current.add(user.id); start({ source: 'auto' }); }, AUTO_START_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [loading, user, role, recoveryMode, active, config, location.pathname, start]);

  const value = useMemo(() => ({ config, start, running: !!active }), [config, start, active]);

  return (
    <TourContext.Provider value={value}>
      {children}
      {active && <TourOverlay steps={active.steps} index={active.index} onIndex={setIndex} onClose={end} />}
    </TourContext.Provider>
  );
};
