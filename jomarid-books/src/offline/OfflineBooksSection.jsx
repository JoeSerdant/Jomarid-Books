import { useCallback, useEffect, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { offlineBooks, offlineSupported, pendingChanges, syncNow } from './index.js';
import { daysLeft } from './model';
import { useOnline } from './useOnline';
import { t, formatNumber } from '../i18n';

const mb = (bytes) => `${formatNumber(Math.max(0.1, bytes / 1048576), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;

// Nastavení → Aplikace → Offline knihy: co je v zařízení stažené, kolik to zabírá, kolik změn čeká na odeslání, a smazání.
export const OfflineBooksSection = ({ Section, Notice, ActionButton }) => {
  const { user } = useAuth();
  const online = useOnline();
  const [books, setBooks] = useState(null);
  const [pending, setPending] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    if (!user || !offlineSupported()) { setBooks([]); return; }
    try {
      const [list, n, used] = await Promise.all([offlineBooks.list(user.id), pendingChanges(user.id), offlineBooks.usage(user.id)]);
      setBooks(list); setPending(n); setBytes(used);
    } catch { setBooks([]); }
  }, [user]);
  useEffect(() => { load(); }, [load]);

  if (!user) return null;
  const supported = offlineSupported();

  const removeOne = async (id) => { setBusy(id); setMsg(null); try { await offlineBooks.remove(user.id, id); await load(); } catch { setMsg({ type: 'error', text: t('Smazání se nepovedlo.') }); } finally { setBusy(''); } };
  const sendNow = async () => {
    setBusy('sync'); setMsg(null);
    try {
      const res = await syncNow(user, { force: true });
      await load();
      setMsg(res?.flushed && !res.flushed.stopped ? { type: 'success', text: t('Změny jsou odeslané.') } : { type: 'error', text: t('Odeslání se nepovedlo, zkusí se to znovu samo.') });
    } catch { setMsg({ type: 'error', text: t('Odeslání se nepovedlo, zkusí se to znovu samo.') }); } finally { setBusy(''); }
  };

  return (
    <Section title={t('Offline knihy')} description={t('Knihy, které sis stáhl pro čtení bez internetu. Jsou v zařízení zašifrované a otevřou se jen v téhle appce a jen tomuhle účtu. Po odhlášení se z zařízení smažou. Licence se po připojení vždy znovu ověří; bez připojení kniha platí 30 dní.')}>
      <div data-testid="offline-books-section" className="space-y-3">
        {!supported && <Notice type="info">{t('Tenhle prohlížeč nebo režim (třeba soukromé okno) ukládání knih do zařízení nepodporuje.')}</Notice>}
        {supported && books === null && <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0">{t('Načítám…')}</p>}
        {supported && books && books.length === 0 && <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0" data-testid="offline-books-empty">{t('Zatím nemáš stažené žádné knihy. Stáhneš je v detailu knihy v knihovně.')}</p>}
        {supported && books && books.length > 0 && (
          <>
            <ul className="list-none p-0 m-0 space-y-2">
              {books.map((b) => (
                <li key={b.id} data-testid={`offline-row-${b.id}`} style={{ borderColor: 'var(--border-color)' }} className="border rounded-lg px-3 py-2 flex items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-black truncate">{b.title}</span>
                    <span style={{ color: 'var(--text-muted)' }} className="block text-[0.6875rem] font-bold">{(() => { const n = daysLeft(b.expiresAt, Date.now()); return t.p(n, '{size} · platí ještě {n} den', '{size} · platí ještě {n} dny', '{size} · platí ještě {n} dní', { size: mb(b.chars * 2), n }); })()}</span>
                  </span>
                  <ActionButton variant="ghost" busy={busy === b.id} onClick={() => removeOne(b.id)} aria-label={t('Smazat stažené: {title}', { title: b.title })}>
                    <Trash2 size={13} aria-hidden="true" /> {t('Smazat')}
                  </ActionButton>
                </li>
              ))}
            </ul>
            <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0">{t('Dohromady asi {size}.', { size: mb(bytes) })}</p>
          </>
        )}
        {supported && pending > 0 && (
          <div className="space-y-2" data-testid="offline-pending">
            <Notice>{t.p(pending, 'Čeká na odeslání: {n} změna z offline režimu (čtení a hry).', 'Čeká na odeslání: {n} změny z offline režimu (čtení a hry).', 'Čeká na odeslání: {n} změn z offline režimu (čtení a hry).', { n: pending })}</Notice>
            <ActionButton busy={busy === 'sync'} disabled={!online} onClick={sendNow}>{busy === 'sync' && <Loader2 size={13} className="animate-spin" />} {t('Odeslat teď')}</ActionButton>
          </div>
        )}
        {msg && <Notice type={msg.type}>{msg.text}</Notice>}
      </div>
    </Section>
  );
};
