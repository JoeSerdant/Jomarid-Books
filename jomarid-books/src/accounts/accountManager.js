// Přepínač účtů: přepnutí na jiný uložený účet, přidání dalšího, odebrání z tohoto zařízení. Bez Reactu a bez přímého Supabase: klient, dočasný
// klient, úložiště, úklidové háčky a načtení stránky se předávají zvenku (src/accounts/index.js je zapojuje na skutečné služby), ať jde všechno zkoušet v Node.
//
// Přepnutí je dvoufázové, aby se při neplatném cílovém účtu aktuální relace vůbec nedotkla:
//   1. relace cílového účtu se ověří na dočasném klientovi, který nic neukládá (obnovovací token se tím otočí, nové tokeny se hned zapíšou do trezoru);
//   2. teprve potom se opustí aktuální účet (zařízení přestane dostávat jeho oznámení) a hlavní klient dostane relaci cílového účtu.
// Po přepnutí se stránka v této i ve všech ostatních kartách načte znovu, ať v paměti nic nezůstane po předchozím účtu.
import { readVault, writeVault, upsertSession, removeAccount, setActive, setProfile, getAccount, listAccounts, nextAccount } from './vault.js';
import { isNetworkProblem } from '../offline/session.js';

// Z chyby Supabase Auth: relace už neplatí (smazaná, použitý nebo neznámý obnovovací token), nebo je to jen síť či něco jiného.
export const classifyAuthError = (err) => {
  if (!err) return 'error';
  if (isNetworkProblem(err)) return 'network';
  const code = String(err.code || '').toLowerCase();
  const msg = String(err.message || '').toLowerCase();
  const status = Number(err.status) || 0;
  if (/refresh_token_not_found|refresh_token_already_used|session_not_found|session_expired|bad_jwt|invalid_grant|user_not_found/.test(code)) return 'expired';
  if (/invalid refresh token|refresh token not found|already used|session.*(not found|expired)|invalid jwt|invalid_grant|not authenticated|auth session missing/.test(msg)) return 'expired';
  if (status === 400 || status === 401 || status === 403) return 'expired';
  return 'error';
};

export function createAccountManager({ client, makeTempClient, loginWithCode, storage, now = Date.now, hooks = {}, reload = () => {}, notify = () => {} }) {
  const listeners = new Set();
  const read = () => readVault(storage);
  const emit = () => { for (const fn of [...listeners]) { try { fn(); } catch { /* posluchač nesmí shodit ostatní */ } } try { hooks.onVaultChange?.(); } catch { /* nic */ } };
  const write = (vault) => { writeVault(vault, storage); emit(); };
  const run = async (fn) => { try { await fn?.(); } catch { /* úklid nikdy nezablokuje přepnutí ani odebrání */ } };

  const currentId = async () => {
    try { const { data } = await client.auth.getSession(); return data?.session?.user?.id || null; } catch { return null; }
  };

  // Hlavní klient má novou nebo obnovenou relaci (přihlášení, obnovení tokenu): zapamatuje se jako aktivní účet.
  function remember(session, profile) {
    const { vault, changed } = upsertSession(read(), session, { now: now(), makeActive: true, evict: true, profile });
    if (changed) write(vault);
  }
  function rememberProfile(id, profile) {
    const vault = read();
    const next = setProfile(vault, id, profile);
    if (next !== vault) write(next);
  }

  const snapshot = () => { const v = read(); return { active: v.active, accounts: listAccounts(v) }; };
  const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

  async function switchTo(id) {
    const target = getAccount(read(), id);
    if (!target) return { ok: false, reason: 'unknown' };
    const cur = await currentId();
    if (cur === id) return { ok: true, same: true };

    // 1. ověření cílového účtu mimo hlavního klienta
    let fresh = null;
    let err = null;
    try {
      const probe = makeTempClient();
      const res = await probe.auth.setSession({ access_token: target.session.access_token, refresh_token: target.session.refresh_token });
      err = res.error;
      fresh = res.data?.session || null;
    } catch (e) { err = e; }
    if (err || !fresh?.user?.id || fresh.user.id !== id) {
      const reason = err ? classifyAuthError(err) : 'expired';
      if (reason === 'expired') { write(removeAccount(read(), id)); await run(() => hooks.afterForget?.(id)); }
      return { ok: false, reason, email: target.email };
    }
    write(upsertSession(read(), fresh, { now: now(), makeActive: false }).vault); // obnovovací token se otočil: nový se musí uložit dřív, než se cokoli dalšího povede nebo nepovede

    // 2. opustit aktuální účet a dát hlavnímu klientovi relaci cílového
    if (cur) await run(() => hooks.beforeLeave?.(cur));
    let res2;
    try { res2 = await client.auth.setSession({ access_token: fresh.access_token, refresh_token: fresh.refresh_token }); } catch (e) { res2 = { error: e }; }
    if (res2.error || !res2.data?.session) return { ok: false, reason: classifyAuthError(res2.error) === 'network' ? 'network' : 'error' };
    write(setActive(upsertSession(read(), res2.data.session, { now: now(), makeActive: true }).vault, id, now()));
    await run(() => hooks.resetPersonalState?.());
    try { notify({ type: 'switched', id }); } catch { /* ostatní karty se nepřenačtou, nic jiného se neděje */ }
    reload();
    return { ok: true };
  }

  // Přidá další účet (heslem nebo přihlašovacím kódem) přes dočasného klienta, ať se aktuální účet nedotkne, a hned na něj přepne.
  async function add(credentials) {
    const temp = makeTempClient();
    let session = null;
    let err = null;
    try {
      if (credentials.method === 'code') { const data = await loginWithCode(temp, credentials.code); session = data?.session || null; }
      else { const res = await temp.auth.signInWithPassword({ email: credentials.email, password: credentials.password }); err = res.error; session = res.data?.session || null; }
    } catch (e) { err = e; }
    if (err || !session?.user?.id) return { ok: false, reason: 'login', error: err };
    const up = upsertSession(read(), session, { now: now(), makeActive: false });
    if (up.full) { try { await temp.auth.signOut({ scope: 'local' }); } catch { /* relace se nepoužije */ } return { ok: false, reason: 'full' }; }
    write(up.vault);
    const res = await switchTo(session.user.id);
    return { ...res, existing: !up.added, email: session.user.email || '' };
  }

  // Zneplatní relaci tohoto zařízení u účtu, který se odebírá (jen tuhle: přihlášení na jiných zařízeních zůstanou). Nejde-li to (offline), nevadí.
  async function revokeStored(account) {
    try {
      const temp = makeTempClient();
      const res = await temp.auth.setSession({ access_token: account.session.access_token, refresh_token: account.session.refresh_token });
      if (!res.error) await temp.auth.signOut({ scope: 'local' });
    } catch { /* offline nebo relace už neplatí */ }
  }

  // Odebere neaktivní účet z tohoto zařízení.
  async function remove(id) {
    const vault = read();
    const target = getAccount(vault, id);
    if (!target) return { ok: true };
    if (id === (await currentId())) return { ok: false, reason: 'active' };
    write(removeAccount(vault, id));
    await revokeStored(target);
    await run(() => hooks.afterForget?.(id));
    return { ok: true };
  }

  // Aktivní účet se odhlašuje: vyřadí se z trezoru a vrátí se, na který z ostatních se má přepnout (nebo null, když žádný další není).
  function forgetActive(id) {
    const vault = read();
    const next = nextAccount(vault, id);
    write(removeAccount(vault, id));
    return next ? next.id : null;
  }

  // Odhlášení ze všech účtů: ostatní se odeberou (relace tohoto zařízení se zneplatní), trezor se vyprázdní.
  async function forgetAll(exceptId) {
    const vault = read();
    for (const a of vault.accounts) {
      if (a.id === exceptId) continue;
      await revokeStored(a);
      await run(() => hooks.afterForget?.(a.id));
    }
    write({ v: 1, active: null, accounts: [] });
  }

  const others = (id) => read().accounts.filter((a) => a.id !== id);

  return { remember, rememberProfile, snapshot, subscribe, refresh: emit, switchTo, add, remove, forgetActive, forgetAll, others, currentId };
}
