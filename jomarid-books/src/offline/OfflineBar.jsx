import { WifiOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useOnline } from './useOnline';

// Pruh pod horní lištou, když je zařízení bez internetu (nebo je přihlášení jen podle uložené relace). Říká, co offline platí.
export const OfflineBar = () => {
  const online = useOnline();
  const { user, offline } = useAuth();
  if (!user || (online && !offline)) return null;
  return (
    <div role="status" data-testid="offline-bar" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }} className="border-b px-4 py-2 text-xs font-bold flex items-center justify-center gap-2 text-center">
      <WifiOff size={14} aria-hidden="true" className="shrink-0" />
      <span>Jsi offline. Zůstáváš přihlášený, změny se po připojení odešlou a obnoví.</span>
    </div>
  );
};
