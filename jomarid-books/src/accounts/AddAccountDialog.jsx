import { useEffect, useRef, useState } from 'react';
import { Loader2, UserPlus, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { t } from '../i18n';
import { addErrorText } from './useAccountActions.js';

const INPUT_STYLE = { backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' };
const INPUT_CLASS = 'w-full p-3 border rounded-lg text-sm font-bold outline-none transition-colors placeholder:opacity-50';

// Přidání dalšího účtu (heslem nebo přihlašovacím kódem) bez odhlášení toho aktuálního: přihlášení běží mimo hlavního klienta,
// a teprve když projde, appka na nový účet přepne. Aktuální účet zůstane na zařízení uložený a jde se k němu vrátit.
export const AddAccountDialog = ({ onClose }) => {
  const { addAccount } = useAuth();
  const [method, setMethod] = useState('password'); // 'password' | 'code'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const firstRef = useRef(null);

  useEffect(() => { firstRef.current?.focus(); }, [method]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    const res = await addAccount(method === 'code' ? { method: 'code', code } : { method: 'password', email: email.trim(), password });
    if (res.ok) {
      if (res.same) { onClose(); return; }
      setDone(true); // stránka se právě načítá znovu pod novým účtem
      return;
    }
    setBusy(false);
    setError(res.reason === 'login' || res.reason === 'full' ? addErrorText(res, method) : t('Účet se přidal, ale přepnutí se nepovedlo. Zkus ho vybrat v seznamu účtů.'));
  };

  const canSubmit = method === 'code' ? code.trim().length > 0 : email.trim().length > 0 && password.length > 0;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/50" onClick={() => { if (!busy) onClose(); }} data-testid="add-account-backdrop">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('Přidat účet')}
        onClick={(e) => e.stopPropagation()}
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
        className="w-full max-w-sm border rounded-2xl shadow-xl p-5 space-y-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-black uppercase tracking-wider m-0 flex items-center gap-2"><UserPlus size={16} /> {t('Přidat účet')}</h2>
            <p style={{ color: 'var(--text-muted)' }} className="text-xs mt-1 mb-0 opacity-80 leading-relaxed">{t('Další účet se přidá na toto zařízení a přepneš se na něj. Aktuální účet zůstane přihlášený a půjde se k němu vrátit.')}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label={t('Zavřít')} className="p-1.5 border-none bg-transparent cursor-pointer opacity-60 hover:opacity-100 disabled:opacity-30" style={{ color: 'var(--text-body)' }}><X size={16} /></button>
        </div>

        <div role="tablist" aria-label={t('Způsob přihlášení')} className="grid grid-cols-2 gap-1.5">
          {[['password', t('Heslo')], ['code', t('Přihlašovací kód')]].map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={method === key}
              onClick={() => { if (!busy) { setMethod(key); setError(''); } }}
              style={{ backgroundColor: method === key ? 'var(--bg-primary)' : 'var(--bg-secondary)', color: method === key ? 'var(--text-primary)' : 'var(--text-body)', borderColor: 'var(--border-color)' }}
              className="px-3 py-2 border rounded-lg text-[0.6875rem] font-black uppercase tracking-wider cursor-pointer"
            >{label}</button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-3">
          {method === 'password' ? (
            <>
              <input ref={firstRef} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('E-mail')} aria-label={t('E-mail')} autoComplete="username" required style={INPUT_STYLE} className={INPUT_CLASS} data-testid="add-account-email" />
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('Heslo')} aria-label={t('Heslo')} autoComplete="current-password" required style={INPUT_STYLE} className={INPUT_CLASS} data-testid="add-account-password" />
            </>
          ) : (
            <input ref={firstRef} type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('Přihlašovací kód')} aria-label={t('Přihlašovací kód')} autoComplete="off" autoCapitalize="characters" spellCheck={false} required style={INPUT_STYLE} className={`${INPUT_CLASS} font-mono tracking-wider`} data-testid="add-account-code" />
          )}
          {error && <p role="alert" className="text-xs font-bold rounded-lg px-3 py-2 m-0 leading-relaxed" style={{ backgroundColor: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>{error}</p>}
          {done && <p role="status" className="text-xs font-bold m-0" style={{ color: '#10b981' }}>{t('Přepínám na nový účet...')}</p>}
          <button
            type="submit"
            disabled={busy || !canSubmit}
            style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
            className="w-full px-4 py-3 rounded-lg border-none font-black uppercase text-[0.6875rem] tracking-wider cursor-pointer inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy && <Loader2 size={13} className="animate-spin" />} {t('Přidat a přepnout')}
          </button>
        </form>
      </div>
    </div>
  );
};
