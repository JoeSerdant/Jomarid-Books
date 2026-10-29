import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { syncNow } from './index.js';

// Odesílá změny z offline čtení a obnovuje stažené knihy: po přihlášení, po návratu připojení, při návratu do appky a jednou za pět minut.
export const OfflineSyncRunner = () => {
  const { user, offline } = useAuth();
  const uid = user?.id;
  useEffect(() => {
    if (!uid || offline) return undefined;
    const u = { id: uid };
    const run = () => { syncNow(u).catch(() => {}); };
    run();
    const onVisible = () => { if (document.visibilityState === 'visible') run(); };
    window.addEventListener('online', run);
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(run, 5 * 60 * 1000);
    return () => { window.removeEventListener('online', run); document.removeEventListener('visibilitychange', onVisible); clearInterval(timer); };
  }, [uid, offline]);
  return null;
};
