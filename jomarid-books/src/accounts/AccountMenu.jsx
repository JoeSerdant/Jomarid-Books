import { useEffect, useRef, useState } from 'react';
import { LogOut, UserPlus, Users } from 'lucide-react';
import { t } from '../i18n';
import { useAccounts } from './useAccounts.js';
import { useAccountActions } from './useAccountActions.js';
import { AccountList } from './AccountList.jsx';
import { AddAccountDialog } from './AddAccountDialog.jsx';

// Tlačítko v horní liště: seznam účtů na tomto zařízení, přepnutí bez odhlášení, přidání dalšího účtu, odhlášení z aktuálního nebo ze všech.
export const AccountMenu = () => {
  const { active, accounts } = useAccounts();
  const { busy, error, setError, doSwitch, doRemove, logout, logoutAll } = useAccountActions();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setError(''); }}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={t('Účty na tomto zařízení')}
        title={t('Účty na tomto zařízení')}
        data-testid="account-menu-button"
        style={{ backgroundColor: open ? 'var(--bg-primary)' : 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: open ? 'var(--text-primary)' : 'var(--text-body)' }}
        className="p-2 border rounded-xl cursor-pointer hover:brightness-95 active:scale-95 transition-all flex items-center justify-center gap-1"
      >
        <Users size={16} />
        {accounts.length > 1 && <span className="text-[0.625rem] font-black leading-none">{accounts.length}</span>}
      </button>

      {open && (
        <div
          role="group"
          aria-label={t('Účty na tomto zařízení')}
          data-testid="account-menu"
          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
          className="fixed left-3 right-3 top-[4.25rem] sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-72 border rounded-2xl shadow-xl p-3 space-y-2.5 z-[60]"
        >
          <p style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider m-0 opacity-80">{t('Účty na tomto zařízení')}</p>
          <div className="max-h-64 overflow-y-auto">
            <AccountList accounts={accounts} active={active} busy={busy} onSwitch={doSwitch} onRemove={doRemove} />
          </div>
          {error && <p role="alert" className="text-xs font-bold rounded-lg px-3 py-2 m-0 leading-relaxed" style={{ backgroundColor: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>{error}</p>}
          <div className="flex flex-col gap-1.5 pt-1 border-t" style={{ borderColor: 'var(--border-color)' }}>
            <button type="button" onClick={() => { setOpen(false); setAdding(true); }} data-testid="account-add" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }} className="px-3 py-2 border rounded-lg text-[0.6875rem] font-black uppercase tracking-wider cursor-pointer inline-flex items-center justify-center gap-2">
              <UserPlus size={13} /> {t('Přidat účet')}
            </button>
            {accounts.length > 1 && (
              <button type="button" onClick={() => { setOpen(false); logoutAll(); }} data-testid="account-logout-all" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-muted)' }} className="px-3 py-2 border rounded-lg text-[0.6875rem] font-black uppercase tracking-wider cursor-pointer inline-flex items-center justify-center gap-2 hover:text-red-500">
                <LogOut size={13} /> {t('Odhlásit ze všech účtů')}
              </button>
            )}
            <button type="button" onClick={() => { setOpen(false); logout(); }} data-testid="account-logout" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-muted)' }} className="px-3 py-2 border rounded-lg text-[0.6875rem] font-black uppercase tracking-wider cursor-pointer inline-flex items-center justify-center gap-2 hover:text-red-500">
              <LogOut size={13} /> {accounts.length > 1 ? t('Odhlásit se z tohoto účtu') : t('Odhlásit se')}
            </button>
          </div>
        </div>
      )}
      {adding && <AddAccountDialog onClose={() => setAdding(false)} />}
    </div>
  );
};
