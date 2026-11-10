import { useCallback, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { t } from '../i18n';
import { tk } from '../i18n/mark.js';
import { MAX_ACCOUNTS } from './vault.js';

// Texty chyb přepínače účtů: co se stalo a co s tím.
export const SWITCH_ERRORS = {
  expired: tk('Přihlášení účtu {email} vypršelo, proto zmizel ze seznamu. Přihlas se do něj znovu přes „Přidat účet“.'),
  network: tk('Bez internetu se na jiný účet přepnout nejde.'),
  unknown: tk('Tenhle účet už na zařízení není.'),
  error: tk('Přepnutí se nepovedlo. Zkus to znovu.'),
};

export const ADD_ERRORS = {
  login: tk('Neplatný e-mail nebo přístupové heslo.'),
  unconfirmed: tk('E-mail zatím není potvrzený - klikni na odkaz v potvrzovacím e-mailu.'),
  throttled: tk('Příliš mnoho pokusů. Zkus to za chvíli.'),
  full: tk('Na zařízení je nejvíc {n} účtů. Nejdřív některý odeber.'),
  network: tk('Bez internetu se další účet přidat nejde.'),
};

export const switchErrorText = (res) => t(SWITCH_ERRORS[res?.reason] || SWITCH_ERRORS.error, { email: res?.email || '' });

// Chyba přidání účtu: kód má vlastní hlášky (CodeLoginError už je přeložená), heslo se rozliší podle toho, co Supabase řekl.
export function addErrorText(res, method) {
  if (res?.reason === 'full') return t(ADD_ERRORS.full, { n: MAX_ACCOUNTS });
  const err = res?.error;
  if (method === 'code' && err?.name === 'CodeLoginError') return String(err.message || t(ADD_ERRORS.login));
  const msg = String(err?.message || '').toLowerCase();
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return t(ADD_ERRORS.network);
  if (msg.includes('email not confirmed')) return t(ADD_ERRORS.unconfirmed);
  if (err?.status === 429 || msg.includes('rate limit') || msg.includes('too many')) return t(ADD_ERRORS.throttled);
  return t(ADD_ERRORS.login);
}

// Společné jednání pro seznam účtů v horní liště i v Nastavení: přepnout, odebrat, odhlásit.
export function useAccountActions() {
  const { switchAccount, removeAccount, logout, logoutAll } = useAuth();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const doSwitch = useCallback(async (id) => {
    setError('');
    setBusy(id);
    const res = await switchAccount(id);
    if (!res.ok) { setError(switchErrorText(res)); setBusy(''); }
    else if (res.same) setBusy(''); // stránka se po úspěšném přepnutí načte znovu, tak se tu nic nevrací
  }, [switchAccount]);

  const doRemove = useCallback(async (id) => {
    setError('');
    setBusy(id);
    const res = await removeAccount(id);
    if (!res.ok) setError(t(SWITCH_ERRORS.error));
    setBusy('');
  }, [removeAccount]);

  return { busy, error, setError, doSwitch, doRemove, logout, logoutAll };
}
