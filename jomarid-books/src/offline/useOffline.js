import { useCallback, useEffect, useRef, useState } from 'react';
import { OFFLINE_ERRORS, OfflineBookError } from './books.js';
import { offlineBooks, offlineSupported } from './index.js';

// Stav stažení jedné knihy pro tlačítko: { supported, meta, busy, error, download, remove }.
export function useOfflineBook(user, bookId) {
  const [meta, setMeta] = useState(undefined);   // undefined: načítá se; null: není stažená
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const uid = user?.id;

  const refresh = useCallback(async () => {
    if (!uid || !bookId || !offlineSupported()) { if (alive.current) setMeta(null); return; }
    try { const m = await offlineBooks.getMeta(uid, bookId); if (alive.current) setMeta(m); } catch { if (alive.current) setMeta(null); }
  }, [uid, bookId]);
  useEffect(() => { setError(''); refresh(); }, [refresh]);

  const download = useCallback(async () => {
    if (!user || busy) return;
    setBusy(true); setError('');
    try { const m = await offlineBooks.download(user, bookId); if (alive.current) setMeta(m); }
    catch (e) { if (alive.current) setError(e instanceof OfflineBookError ? e.message : OFFLINE_ERRORS.network); }
    finally { if (alive.current) setBusy(false); }
  }, [user, bookId, busy]);

  const remove = useCallback(async () => {
    if (!uid || busy) return;
    setBusy(true); setError('');
    try { await offlineBooks.remove(uid, bookId); if (alive.current) setMeta(null); }
    catch { if (alive.current) setError('Smazání se nepovedlo. Zkus to znovu.'); }
    finally { if (alive.current) setBusy(false); }
  }, [uid, bookId, busy]);

  return { supported: offlineSupported(), meta, busy, error, download, remove };
}
