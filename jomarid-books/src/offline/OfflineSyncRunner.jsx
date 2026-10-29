import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { syncNow } from './index.js';
import { needsRefresh, prepareGames } from './gamesPrep.js';

// Odesílá změny z offline režimu (čtení, hry) a obnovuje stažené knihy: po přihlášení, po návratu připojení, při návratu do appky a jednou za pět minut.
export const OfflineSyncRunner = () => {
  const { user, offline } = useAuth();
  const uid = user?.id;
  useEffect(() => {
    if (!uid || offline) return undefined;
    const u = { id: uid };
    // Po nové verzi appky mají soubory her nové názvy: kdo si hry už připravil pro offline, má je znovu stáhnout (na pozadí, jen online).
    const refreshGames = () => {
      if (!needsRefresh() || navigator.onLine === false) return;
      import('../pages/Games').then((m) => prepareGames(m.preloadGames)).catch(() => {});
    };
    const run = () => { syncNow(u).catch(() => {}); refreshGames(); };
    run();
    const onVisible = () => { if (document.visibilityState === 'visible') run(); };
    window.addEventListener('online', run);
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(run, 5 * 60 * 1000);
    return () => { window.removeEventListener('online', run); document.removeEventListener('visibilitychange', onVisible); clearInterval(timer); };
  }, [uid, offline]);
  return null;
};
