// Přepínač účtů: trezor relací (src/accounts/vault.js) a přepínání, přidání a odebrání účtu (src/accounts/accountManager.js) na zkušebních klientech,
// bez prohlížeče a bez Supabase. Zapojení do appky (AuthContext, horní lišta, Nastavení, přihlašovací stránka) hlídají zkoušky nad zdrojem.
//   npm run test:accounts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VAULT_KEY, MAX_ACCOUNTS, emptyVault, sanitizeVault, readVault, writeVault, upsertSession, setProfile, removeAccount, setActive, nextAccount, listAccounts, getAccount, accountInitial,
} from '../accounts/vault.js';
import { createAccountManager, classifyAuthError } from '../accounts/accountManager.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

const memStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, raw: m };
};
const session = (id, extra = {}) => ({ access_token: `a-${id}${extra.n || ''}`, refresh_token: `r-${id}${extra.n || ''}`, expires_at: 1000, user: { id, email: `${id}@x.cz` }, ...extra });

// Zkušební klient: drží jednu relaci; setSession a signInWithPassword se řídí tabulkou serveru (které obnovovací tokeny platí).
function fakeServer(valid = {}) {
  const log = [];
  const makeClient = (state = { session: null }) => ({
    state,
    auth: {
      getSession: async () => ({ data: { session: state.session } }),
      setSession: async ({ access_token: access, refresh_token: refresh }) => {
        log.push(['setSession', refresh]);
        if (state.netDown) return { data: { session: null }, error: Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError', status: 0 }) };
        const id = valid[refresh];
        if (!id) return { data: { session: null }, error: Object.assign(new Error('Invalid Refresh Token: Refresh Token Not Found'), { status: 400, code: 'refresh_token_not_found' }) };
        state.session = session(id, { n: `+${log.length}` });
        valid[state.session.refresh_token] = id; // rotace: nový obnovovací token platí
        delete valid[refresh];
        return { data: { session: state.session, user: state.session.user }, error: null };
      },
      signInWithPassword: async ({ email, password }) => {
        log.push(['signIn', email]);
        if (password !== 'good') return { data: { session: null }, error: Object.assign(new Error('Invalid login credentials'), { status: 400 }) };
        const id = email.split('@')[0];
        state.session = session(id, { n: '-login' });
        valid[state.session.refresh_token] = id;
        return { data: { session: state.session }, error: null };
      },
      signOut: async (opts) => { log.push(['signOut', opts?.scope || 'global']); state.session = null; return { error: null }; },
    },
  });
  return { valid, log, makeClient };
}

function setup({ accounts = ['u1', 'u2'], active = 'u1', hooks = {} } = {}) {
  const server = fakeServer();
  const storage = memStorage();
  let vault = emptyVault();
  let t = 1000;
  for (const id of accounts) {
    const s = session(id);
    server.valid[s.refresh_token] = id;
    vault = upsertSession(vault, s, { now: (t += 1), makeActive: id === active }).vault;
  }
  writeVault(vault, storage);
  const main = server.makeClient({ session: active ? (() => { const s = session(active); return s; })() : null });
  const calls = { reload: 0, notify: [], before: [], forget: [], reset: 0 };
  const mgr = createAccountManager({
    client: main,
    makeTempClient: () => server.makeClient({ session: null }),
    loginWithCode: async (client, code) => { if (code !== 'GOODCODE') throw Object.assign(new Error('bad'), { name: 'CodeLoginError' }); const s = session('coder', { n: '-code' }); server.valid[s.refresh_token] = 'coder'; return { session: s }; },
    storage,
    now: () => (t += 1),
    hooks: { beforeLeave: async (id) => { calls.before.push(id); }, afterForget: async (id) => { calls.forget.push(id); }, resetPersonalState: () => { calls.reset += 1; }, ...hooks },
    reload: () => { calls.reload += 1; },
    notify: (m) => calls.notify.push(m),
  });
  return { server, storage, main, mgr, calls, vaultNow: () => readVault(storage) };
}

// ---- trezor ----
test('trezor: poškozené nebo cizí úložiště dá prázdný trezor, neplatné účty se zahodí, duplicity a přebytek také', () => {
  assert.deepEqual(sanitizeVault(null), emptyVault());
  assert.deepEqual(sanitizeVault({ v: 2, accounts: [] }), emptyVault());
  assert.deepEqual(readVault(memStorage({ [VAULT_KEY]: '{rozbité' })), emptyVault());
  const good = { id: 'a', email: 'a@x.cz', session: { access_token: 'x', refresh_token: 'y', expires_at: 5 }, addedAt: 1, usedAt: 2 };
  const raw = { v: 1, active: 'ghost', accounts: [good, { ...good }, { id: 'b', session: { access_token: 'x' } }, null, 'text', { ...good, id: 'c', session: { access_token: 'x', refresh_token: '' } }] };
  const v = sanitizeVault(raw);
  assert.equal(v.accounts.length, 1);
  assert.equal(v.active, null, 'aktivní účet, který v seznamu není, se zahodí');
  const many = { v: 1, active: null, accounts: Array.from({ length: MAX_ACCOUNTS + 3 }, (_, i) => ({ ...good, id: `id${i}` })) };
  assert.equal(sanitizeVault(many).accounts.length, MAX_ACCOUNTS);
});

test('trezor: zápis a čtení přes úložiště, prázdný seznam klíč smaže, nepovedený zápis nespadne', () => {
  const st = memStorage();
  const v = upsertSession(emptyVault(), session('u1'), { makeActive: true, now: 5 }).vault;
  assert.equal(writeVault(v, st), true);
  assert.deepEqual(readVault(st), sanitizeVault(v));
  assert.equal(writeVault(emptyVault(), st), true);
  assert.equal(st.getItem(VAULT_KEY), null);
  const broken = { getItem() { return null; }, setItem() { throw new Error('plné'); }, removeItem() {} };
  assert.equal(writeVault(v, broken), false);
  assert.equal(writeVault(v, null), false);
  assert.deepEqual(readVault(null), emptyVault());
});

test('trezor: upsertSession přidá účet, obnoví tokeny, drží jméno a roli, aktivní nastaví jen na požádání a nikdy nepřijme relaci bez tokenů', () => {
  let r = upsertSession(emptyVault(), session('u1'), { now: 10, makeActive: true, profile: { username: 'ctenar', role: 'user' } });
  assert.equal(r.added, true);
  assert.equal(r.vault.active, 'u1');
  assert.equal(getAccount(r.vault, 'u1').username, 'ctenar');
  r = upsertSession(r.vault, { ...session('u1'), access_token: 'novy', refresh_token: 'novy-r' }, { now: 20, makeActive: true });
  assert.equal(r.added, false);
  assert.equal(getAccount(r.vault, 'u1').session.refresh_token, 'novy-r');
  assert.equal(getAccount(r.vault, 'u1').username, 'ctenar', 'jméno z dřívějška zůstane');
  r = upsertSession(r.vault, session('u2'), { now: 30 });
  assert.equal(r.vault.active, 'u1', 'jen uložený další účet nemění aktivní');
  assert.equal(upsertSession(r.vault, { user: { id: 'x' } }, {}).changed, false);
  assert.equal(upsertSession(r.vault, { access_token: 'a', refresh_token: 'b' }, {}).changed, false);
  assert.equal(setProfile(r.vault, 'zadny', { username: 'x' }), r.vault, 'neznámý účet se nemění');
  assert.equal(getAccount(setProfile(r.vault, 'u2', { username: 'dvojka', role: 'nakladatel' }), 'u2').role, 'nakladatel');
});

test('trezor: plný trezor nový účet při přidání odmítne, při automatickém zapamatování vyhodí nejdéle nepoužitý neaktivní', () => {
  let v = emptyVault();
  for (let i = 0; i < MAX_ACCOUNTS; i += 1) v = upsertSession(v, session(`u${i}`), { now: 100 + i, makeActive: i === MAX_ACCOUNTS - 1 }).vault;
  const refused = upsertSession(v, session('novy'), { now: 500 });
  assert.equal(refused.full, true);
  assert.equal(refused.changed, false);
  const evicted = upsertSession(v, session('novy'), { now: 500, makeActive: true, evict: true });
  assert.equal(evicted.vault.accounts.length, MAX_ACCOUNTS);
  assert.ok(getAccount(evicted.vault, 'novy'));
  assert.equal(getAccount(evicted.vault, 'u0'), null, 'nejstarší se vyhodil');
  assert.ok(getAccount(evicted.vault, `u${MAX_ACCOUNTS - 1}`), 'aktivní zůstal');
});

test('trezor: odebrání, aktivace, další účet po odhlášení a pořadí seznamu', () => {
  let v = emptyVault();
  v = upsertSession(v, session('a'), { now: 10, makeActive: true }).vault;
  v = upsertSession(v, session('b'), { now: 20 }).vault;
  v = upsertSession(v, session('c'), { now: 30 }).vault;
  v = setActive(v, 'c', 40);
  assert.deepEqual(listAccounts(v).map((a) => a.id), ['c', 'a', 'b'], 'aktivní je první, ostatní od naposledy použitého');
  assert.equal(nextAccount(v, 'c').id, 'a', 'po odhlášení se nabídne naposledy použitý z ostatních');
  const removed = removeAccount(v, 'c');
  assert.equal(removed.active, null);
  assert.equal(removeAccount(removed, 'neexistuje'), removed);
  assert.equal(setActive(v, 'neexistuje'), v);
  assert.equal(nextAccount(upsertSession(emptyVault(), session('sam'), { makeActive: true }).vault, 'sam'), null);
  assert.equal(accountInitial({ username: 'ctenar' }), 'C');
  assert.equal(accountInitial({ email: 'ab@x.cz' }), 'A');
  assert.equal(accountInitial({}), '?');
});

// ---- přepínání ----
test('classifyAuthError: neplatná relace, síť a ostatní se rozliší', () => {
  assert.equal(classifyAuthError(Object.assign(new Error('Invalid Refresh Token: Already Used'), { status: 400 })), 'expired');
  assert.equal(classifyAuthError({ code: 'refresh_token_not_found' }), 'expired');
  assert.equal(classifyAuthError({ status: 401, message: 'x' }), 'expired');
  assert.equal(classifyAuthError(Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError', status: 0 })), 'network');
  assert.equal(classifyAuthError({ status: 500, message: 'boom' }), 'error');
  assert.equal(classifyAuthError(null), 'error');
});

test('přepnutí: ověří cílový účet mimo hlavního klienta, opustí aktuální, uloží otočené tokeny, přenačte stránku a řekne ostatním kartám', async () => {
  const { mgr, main, calls, vaultNow, server } = setup();
  const before = getAccount(vaultNow(), 'u2').session.refresh_token;
  const res = await mgr.switchTo('u2');
  assert.deepEqual(res, { ok: true });
  assert.equal(main.state.session.user.id, 'u2', 'hlavní klient má relaci cílového účtu');
  assert.deepEqual(calls.before, ['u1'], 'zařízení přestalo dostávat oznámení opuštěného účtu');
  assert.equal(calls.reload, 1);
  assert.deepEqual(calls.notify, [{ type: 'switched', id: 'u2' }]);
  assert.equal(calls.reset, 1);
  const v = vaultNow();
  assert.equal(v.active, 'u2');
  assert.notEqual(getAccount(v, 'u2').session.refresh_token, before, 'obnovovací token se otočil a nový je uložený');
  assert.ok(getAccount(v, 'u1'), 'opuštěný účet zůstává uložený');
  assert.ok(server.log.some(([op]) => op === 'setSession'));
  assert.deepEqual(await mgr.switchTo('u2'), { ok: true, same: true }, 'přepnutí na aktivní účet nic neudělá');
  assert.equal(calls.reload, 1);
});

test('přepnutí: neplatná relace cíle účet ze seznamu odebere a aktuální relaci vůbec nezmění', async () => {
  const { mgr, main, calls, vaultNow, server } = setup();
  for (const k of Object.keys(server.valid)) if (server.valid[k] === 'u2') delete server.valid[k];
  const res = await mgr.switchTo('u2');
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'expired');
  assert.equal(res.email, 'u2@x.cz');
  assert.equal(main.state.session.user.id, 'u1', 'aktuální účet zůstal');
  assert.equal(calls.reload, 0);
  assert.deepEqual(calls.before, [], 'ani oznámení aktuálního účtu se nevypnula');
  assert.equal(getAccount(vaultNow(), 'u2'), null);
  assert.deepEqual(calls.forget, ['u2']);
  assert.deepEqual(await mgr.switchTo('neznamy'), { ok: false, reason: 'unknown' });
});

test('přepnutí: bez internetu zůstane cílový účet uložený a nic se nezmění', async () => {
  const { mgr, main, calls, vaultNow, server } = setup();
  const offline = server.makeClient({ session: null });
  offline.state.netDown = true;
  const mgr2 = createAccountManager({ client: main, makeTempClient: () => offline, storage: (() => { const s = memStorage(); writeVault(vaultNow(), s); return s; })(), hooks: {}, reload: () => { calls.reload += 1; } });
  const res = await mgr2.switchTo('u2');
  assert.deepEqual(res, { ok: false, reason: 'network', email: 'u2@x.cz' });
  assert.equal(main.state.session.user.id, 'u1');
  assert.equal(calls.reload, 0);
  assert.ok(getAccount(vaultNow(), 'u2'), 'účet se kvůli síti neodebírá');
});

test('přidání účtu: heslo i kód jdou přes dočasného klienta, účet se uloží a přepne se na něj; špatné heslo nic nezmění', async () => {
  const { mgr, main, calls, vaultNow } = setup({ accounts: ['u1'], active: 'u1' });
  const bad = await mgr.add({ method: 'password', email: 'u3@x.cz', password: 'spatne' });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'login');
  assert.equal(vaultNow().accounts.length, 1);
  const ok = await mgr.add({ method: 'password', email: 'u3@x.cz', password: 'good' });
  assert.equal(ok.ok, true);
  assert.equal(ok.existing, false);
  assert.equal(main.state.session.user.id, 'u3');
  assert.equal(vaultNow().active, 'u3');
  assert.ok(getAccount(vaultNow(), 'u1'), 'původní účet zůstal uložený');
  assert.equal(calls.reload, 1);
  const again = await mgr.add({ method: 'password', email: 'u1@x.cz', password: 'good' });
  assert.equal(again.ok, true);
  assert.equal(again.existing, true, 'účet, který už tu je, se jen obnoví a přepne se na něj');
  assert.equal(vaultNow().accounts.length, 2);
  const code = await mgr.add({ method: 'code', code: 'GOODCODE' });
  assert.equal(code.ok, true);
  assert.equal(vaultNow().active, 'coder');
  const badCode = await mgr.add({ method: 'code', code: 'ZLE' });
  assert.equal(badCode.reason, 'login');
  assert.equal(badCode.error.name, 'CodeLoginError');
});

test('přidání účtu: plné zařízení další účet odmítne a jeho dočasnou relaci odhlásí', async () => {
  const ids = Array.from({ length: MAX_ACCOUNTS }, (_, i) => `u${i}`);
  const { mgr, server, vaultNow } = setup({ accounts: ids, active: 'u0' });
  const res = await mgr.add({ method: 'password', email: 'dalsi@x.cz', password: 'good' });
  assert.deepEqual({ ok: res.ok, reason: res.reason }, { ok: false, reason: 'full' });
  assert.equal(vaultNow().accounts.length, MAX_ACCOUNTS);
  assert.ok(server.log.some((e) => e[0] === 'signOut' && e[1] === 'local'));
});

test('odebrání účtu: neaktivní se odebere, relace tohoto zařízení se zneplatní jen lokálně, data se uklidí; aktivní nejde odebrat', async () => {
  const { mgr, calls, vaultNow, server } = setup();
  assert.deepEqual(await mgr.remove('u1'), { ok: false, reason: 'active' });
  assert.deepEqual(await mgr.remove('u2'), { ok: true });
  assert.equal(getAccount(vaultNow(), 'u2'), null);
  assert.deepEqual(calls.forget, ['u2']);
  assert.ok(server.log.some((e) => e[0] === 'signOut' && e[1] === 'local'), 'jen tato relace, ne všechna zařízení účtu');
  assert.deepEqual(await mgr.remove('u2'), { ok: true }, 'odebrat neexistující není chyba');
});

test('odhlášení: aktivní účet se vyřadí a nabídne se další; „ze všech“ zneplatní ostatní a vyprázdní trezor', async () => {
  const { mgr, calls, vaultNow } = setup({ accounts: ['u1', 'u2', 'u3'], active: 'u1' });
  const next = mgr.forgetActive('u1');
  assert.ok(['u2', 'u3'].includes(next));
  assert.equal(getAccount(vaultNow(), 'u1'), null);
  assert.deepEqual(mgr.others('u9').map((a) => a.id).sort(), ['u2', 'u3']);
  await mgr.forgetAll('u2');
  assert.deepEqual(vaultNow().accounts, []);
  assert.deepEqual(calls.forget, ['u3'], 'úklid proběhl u ostatních účtů; aktivní uklízí odhlášení samo');
  const solo = setup({ accounts: ['u1'], active: 'u1' });
  assert.equal(solo.mgr.forgetActive('u1'), null, 'poslední účet: žádný další se nenabízí');
});

test('zapamatování: relace aktivního účtu se ukládá při přihlášení a obnovení tokenu, profil doplní jméno a role, odběratelé se dozvědí o změně', () => {
  const { mgr, vaultNow } = setup({ accounts: [], active: null });
  let notified = 0;
  const off = mgr.subscribe(() => { notified += 1; });
  mgr.remember(session('u1'));
  mgr.rememberProfile('u1', { username: 'ctenar', role: 'user' });
  mgr.remember({ ...session('u1'), refresh_token: 'otocen' });
  assert.equal(getAccount(vaultNow(), 'u1').session.refresh_token, 'otocen');
  assert.equal(getAccount(vaultNow(), 'u1').username, 'ctenar');
  assert.equal(vaultNow().active, 'u1');
  assert.ok(notified >= 3);
  mgr.rememberProfile('u1', { username: 'ctenar', role: 'user' });
  const n = notified;
  mgr.rememberProfile('u1', { username: 'ctenar', role: 'user' });
  assert.equal(notified, n, 'beze změny se nic nepřekresluje');
  off();
  mgr.remember(session('u2'));
  assert.equal(notified, n);
  assert.equal(mgr.snapshot().active, 'u2');
  assert.equal(mgr.snapshot().accounts[0].id, 'u2');
});

// ---- zapojení do appky ----
test('AuthContext: relace se pamatuje, odhlášení při dalším účtu uklízí jen data odhlášeného, „odhlásit všude“ je v kontextu, původní odhlášení zůstává', () => {
  const ctx = read('contexts', 'AuthContext.jsx');
  assert.match(ctx, /accounts\.remember\(session\)/);
  assert.match(ctx, /accounts\.rememberProfile\(sessionUser\.id/);
  assert.match(ctx, /if \(user\?\.id && accounts\.others\(user\.id\)\.length > 0\) \{ await logoutKeepingOthers\(user\.id\); return; \}/);
  assert.match(ctx, /await purgeUserData\(userId\)/);
  assert.match(ctx, /const res = nextId \? await accounts\.switchTo\(nextId\) : \{ ok: false \};/);
  assert.match(ctx, /await accounts\.forgetAll\(user\?\.id\);/);
  assert.match(ctx, /switchAccount: accounts\.switchTo, addAccount: accounts\.add, removeAccount: accounts\.remove/);
  assert.match(ctx, /await runLogoutCleanups\(\);/, 'poslední účet: úplný úklid zařízení jako dřív');
});

test('rozhraní: tlačítko účtů v horní liště, sekce v Nastavení, seznam na přihlašovací stránce; přepnutí přenačte stránku a dává vědět ostatním kartám', () => {
  assert.match(read('components', 'Navbar.jsx'), /<AccountMenu \/>/);
  assert.match(read('components', 'SettingsModal.jsx'), /<AccountsSection \/>/);
  assert.match(read('pages', 'LoginPage.jsx'), /data-testid="login-saved-accounts"/);
  const index = read('accounts', 'index.js');
  assert.match(index, /new BroadcastChannel\('jomarid-accounts'\)/);
  assert.match(index, /window\.location\.assign\('\/app'\)/);
  assert.match(index, /persistSession: false, autoRefreshToken: false/, 'přihlášení dalšího účtu nic neukládá do hlavního úložiště Supabase');
  assert.match(index, /e\.key === VAULT_KEY/);
  const pkg = JSON.parse(fs.readFileSync(path.join(SRC, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['test:accounts'], 'node --test src/tests/accounts.test.mjs');
  assert.ok(pkg.scripts.test.includes('npm run test:accounts'));
});
