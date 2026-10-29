import { Download, Loader2, Trash2, WifiOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useOnline } from './useOnline';
import { useOfflineBook } from './useOffline';
import { daysLeft } from './model';

// Tlačítko v detailu knihy: stáhnout pro čtení bez internetu (šifrovaně do zařízení), nebo stažené smazat.
export const OfflineDownloadButton = ({ bookId }) => {
  const { user } = useAuth();
  const online = useOnline();
  const { supported, meta, busy, error, download, remove } = useOfflineBook(user, bookId);
  if (!user || !supported || meta === undefined) return null;
  const textStyle = { color: 'var(--text-muted)' };
  return (
    <div data-testid="offline-download" className="mt-2 space-y-1.5">
      {meta ? (
        <div className="flex items-center gap-2">
          <p style={textStyle} className="text-[0.6875rem] font-bold m-0 flex-1" data-testid="offline-status">
            Staženo pro čtení offline, platí ještě {daysLeft(meta.expiresAt, Date.now())} dní (po připojení se prodlouží).
          </p>
          <button type="button" onClick={remove} disabled={busy} style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)' }} className="px-3 py-2 rounded-lg border-none cursor-pointer text-[0.625rem] font-black uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} aria-hidden="true" />} Smazat
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={download}
          disabled={busy || !online}
          style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)' }}
          className="w-full py-2.5 rounded-xl border-none cursor-pointer text-[0.6875rem] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? <><Loader2 size={13} className="animate-spin" /> Stahuji…</> : !online ? <><WifiOff size={13} aria-hidden="true" /> Stáhnout jde jen online</> : <><Download size={13} aria-hidden="true" /> Stáhnout pro čtení offline</>}
        </button>
      )}
      {error && <p role="alert" className="text-red-500 text-[0.6875rem] font-bold m-0">{error}</p>}
    </div>
  );
};
