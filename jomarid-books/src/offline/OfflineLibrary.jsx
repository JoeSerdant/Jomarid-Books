import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, DownloadCloud, WifiOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { offlineBooks, offlineSupported } from './index.js';
import { daysLeft } from './model';

// Knihovna bez internetu: jen knihy stažené do zařízení. Server nejde dosáhnout, takže nic dalšího (nákup, lajky, hledání) tu není.
export const OfflineLibrary = () => {
  const { user } = useAuth();
  const [books, setBooks] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try { const list = user && offlineSupported() ? await offlineBooks.list(user.id) : []; if (alive) setBooks(list); } catch { if (alive) setBooks([]); }
    })();
    return () => { alive = false; };
  }, [user]);

  return (
    <div data-testid="offline-library" style={{ color: 'var(--text-body)' }} className="max-w-3xl mx-auto px-4 py-10">
      <div className="flex items-center gap-2 mb-2">
        <WifiOff size={18} aria-hidden="true" />
        <h2 className="text-lg font-black uppercase tracking-tight m-0">Knihovna offline</h2>
      </div>
      <p style={{ color: 'var(--text-muted)' }} className="text-xs mt-0 mb-6">Jsi bez internetu. Číst můžeš knihy, které sis stáhl do tohoto zařízení; pozice, záložky a zvýraznění se po připojení odešlou.</p>
      {books === null && <p style={{ color: 'var(--text-muted)' }} className="text-xs">Načítám…</p>}
      {books && books.length === 0 && (
        <div data-testid="offline-library-empty" className="text-center py-10">
          <DownloadCloud size={28} className="mx-auto mb-3 opacity-50" aria-hidden="true" />
          <p className="text-sm font-bold m-0">Zatím tu nemáš žádnou staženou knihu.</p>
          <p style={{ color: 'var(--text-muted)' }} className="text-xs mt-2">Až budeš online, otevři detail knihy a klepni na „Stáhnout pro čtení offline“.</p>
        </div>
      )}
      {books && books.length > 0 && (
        <ul className="list-none p-0 m-0 space-y-3">
          {books.map((b) => (
            <li key={b.id}>
              <Link to={`/read/${b.id}`} data-testid={`offline-book-${b.id}`} style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }} className="border rounded-xl p-4 flex items-center gap-3 no-underline">
                <BookOpen size={20} aria-hidden="true" className="shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-black truncate">{b.title}</span>
                  <span style={{ color: 'var(--text-muted)' }} className="block text-xs truncate">{b.author || 'Autor neuveden'} · přečteno {Math.round(b.percent || 0)} %{b.isRead ? ' · dočteno' : ''}</span>
                </span>
                <span style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-bold shrink-0 text-right">platí {daysLeft(b.expiresAt, Date.now())} dní</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
