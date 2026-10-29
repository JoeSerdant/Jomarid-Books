// Testy přihlašovacího kódu a přihlášení, které přežije offline: uložená relace (src/offline/session.js), kód (src/offline/loginCode.js),
// Edge Function db/auth/code-login.ts (s falešnými závislostmi, bez sítě) a napojení v appce.
//   npm run test:offlinelogin
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  sessionKeyFor, readStoredSession, clearStoredSession, readCachedProfile, writeCachedProfile, clearCachedProfiles, isNetworkProblem, registerLogoutCleanup, runLogoutCleanups,
} from '../offline/session.js';
import { normalizeCode, formatCode, loginWithCode, createLoginCode, getLoginCodeInfo, revokeLoginCode, CodeLoginError, CODE_ERRORS } from '../offline/loginCode.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8').replace(/\r\n/g, '\n');
let EDGE = null;
try { EDGE = await import('../../db/auth/code-login.ts'); } catch (e) {
  // Přeskočí se jen starší Node bez podpory TypeScriptu. Chyba v samotném souboru musí test shodit, ne ho tiše vynechat.
  if (!['ERR_UNKNOWN_FILE_EXTENSION', 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX'].includes(e?.code)) throw e;
}
const skip = !EDGE && 'Node bez podpory TypeScriptu';

const URL_ = 'https://vcdnqllluagmaxtwrnmf.supabase.co';
const KEY = 'sb-vcdnqllluagmaxtwrnmf-auth-token';
const memory = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, _m: m };
};
const GOOD = 'A1B2C3D4E5F60718293A4B5C6D7E8F90';

/* ---------------------------------------------------------------- uložená relace */
test('sessionKeyFor: klíč relace Supabase z adresy projektu; špatná adresa dá null', () => {
  assert.equal(sessionKeyFor(URL_), KEY);
  assert.equal(sessionKeyFor('není adresa'), null);
});

test('readStoredSession: vrací uživatele jen z úplné relace (uživatel + obnovovací token), jinak null', () => {
  const ok = JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: 1, user: { id: 'u1', email: 'a@b.cz' } });
  assert.deepEqual(readStoredSession(URL_, memory({ [KEY]: ok })), { user: { id: 'u1', email: 'a@b.cz' } });
  assert.equal(readStoredSession(URL_, memory()), null, 'žádná relace');
  assert.equal(readStoredSession(URL_, memory({ [KEY]: '{rozbité' })), null, 'poškozený JSON');
  assert.equal(readStoredSession(URL_, memory({ [KEY]: JSON.stringify({ refresh_token: 'r' }) })), null, 'bez uživatele');
  assert.equal(readStoredSession(URL_, memory({ [KEY]: JSON.stringify({ user: { id: 'u1' } }) })), null, 'bez obnovovacího tokenu se k relaci nejde vrátit');
  assert.equal(readStoredSession(URL_, memory({ [KEY]: JSON.stringify({ user: { id: 7 }, refresh_token: 'r' }) })), null, 'id musí být text');
  assert.equal(readStoredSession('není adresa', memory({ [KEY]: ok })), null);
  assert.equal(readStoredSession(URL_, null), null, 'bez úložiště');
});

test('clearStoredSession smaže jen relaci Supabase; profil z mezipaměti jde číst a mazat po účtech', () => {
  const st = memory({ [KEY]: 'x', jiny: 'y' });
  clearStoredSession(URL_, st);
  assert.equal(st.getItem(KEY), null); assert.equal(st.getItem('jiny'), 'y');
  writeCachedProfile('u1', { role: 'správce', username: 'jana' }, st);
  writeCachedProfile('u2', { role: 'uživatel', username: 'petr' }, st);
  assert.deepEqual(readCachedProfile('u1', st), { role: 'správce', username: 'jana' });
  assert.equal(readCachedProfile('u3', st), null);
  assert.equal(readCachedProfile('u1', memory({ 'jomarid-offline-profile:u1': 'rozbité' })), null);
  clearCachedProfiles(st);
  assert.equal(readCachedProfile('u1', st), null); assert.equal(readCachedProfile('u2', st), null); assert.equal(st.getItem('jiny'), 'y', 'ostatní klíče zůstanou');
});

test('isNetworkProblem pozná výpadek sítě, ale ne špatné přihlášení', () => {
  assert.equal(isNetworkProblem(null), false);
  assert.equal(isNetworkProblem({ name: 'AuthRetryableFetchError', message: 'x' }), true);
  assert.equal(isNetworkProblem(new TypeError('Failed to fetch')), true);
  assert.equal(isNetworkProblem({ message: 'NetworkError when attempting to fetch resource.' }), true);
  assert.equal(isNetworkProblem({ name: 'AuthApiError', status: 400, message: 'Invalid Refresh Token: Already Used' }), false);
  assert.equal(isNetworkProblem({ name: 'AuthApiError', status: 401, message: 'Invalid login credentials' }), false);
});

test('registerLogoutCleanup: úklid se spustí při odhlášení, chyba jednoho nezastaví ostatní, zrušený se nespustí', async () => {
  const calls = [];
  const off1 = registerLogoutCleanup(() => { calls.push('a'); });
  registerLogoutCleanup(() => { throw new Error('rozbité'); });
  const off3 = registerLogoutCleanup(async () => { calls.push('c'); });
  const e = console.error; console.error = () => {};
  try { await runLogoutCleanups(); } finally { console.error = e; }
  assert.deepEqual(calls, ['a', 'c']);
  off1(); off3(); calls.length = 0;
  console.error = () => {}; try { await runLogoutCleanups(); } finally { console.error = e; }
  assert.deepEqual(calls, []);
});

/* ---------------------------------------------------------------- kód a klient */
test('normalizeCode a formatCode: velká písmena, bez pomlček a mezer, jen 32 znaků 0-9 A-F', () => {
  assert.equal(normalizeCode(GOOD), GOOD);
  assert.equal(normalizeCode('a1b2-c3d4-e5f6-0718-293a-4b5c-6d7e-8f90'), GOOD);
  assert.equal(normalizeCode('  A1B2 C3D4\nE5F60718293A4B5C6D7E8F90  '), GOOD);
  for (const bad of ['', 'ABC', GOOD + '0', GOOD.slice(0, 31), 'G' + GOOD.slice(1), null, undefined, 12345, {}]) assert.equal(normalizeCode(bad), null, String(bad));
  assert.equal(formatCode(GOOD), 'A1B2-C3D4-E5F6-0718-293A-4B5C-6D7E-8F90');
  assert.equal(formatCode('špatný'), '');
});

const fakeFetch = (status, body, { reject } = {}) => { const calls = []; const f = async (url, init) => { calls.push({ url, init }); if (reject) throw new TypeError('Failed to fetch'); return { ok: status >= 200 && status < 300, status, json: async () => { if (body === undefined) throw new Error('bez těla'); return body; } }; }; f.calls = calls; return f; };
const fakeClient = (res = { data: { session: { access_token: 't' }, user: { id: 'u1' } }, error: null }) => { const calls = []; return { calls, auth: { verifyOtp: async (a) => { calls.push(a); return res; } } }; };
const CFG = { url: URL_, key: 'anon-key' };

test('loginWithCode: pošle funkci čistý kód, z odpovědi dokončí přihlášení přes verifyOtp', async () => {
  const f = fakeFetch(200, { token_hash: 'hash123' }); const c = fakeClient();
  const data = await loginWithCode(c, CFG, 'a1b2-c3d4-e5f6-0718-293a-4b5c-6d7e-8f90', f);
  assert.equal(f.calls[0].url, `${URL_}/functions/v1/code-login`);
  assert.equal(f.calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { code: GOOD });
  assert.equal(f.calls[0].init.headers.apikey, 'anon-key');
  assert.deepEqual(c.calls, [{ token_hash: 'hash123', type: 'magiclink' }]);
  assert.equal(data.user.id, 'u1');
});

test('loginWithCode: chyby dostanou českou hlášku podle příčiny a nikdy neprozradí víc', async () => {
  const code = async (f, c = fakeClient()) => loginWithCode(c, CFG, GOOD, f).then(() => null, (e) => e);
  assert.equal((await code(fakeFetch(401, { error: 'invalid' }))).code, 'invalid');
  assert.equal((await code(fakeFetch(429, { error: 'throttled' }))).code, 'throttled');
  assert.equal((await code(fakeFetch(404, { message: 'Function not found' }))).code, 'unavailable');
  assert.equal((await code(fakeFetch(500, undefined))).code, 'upstream');
  assert.equal((await code(fakeFetch(502, { error: 'upstream' }))).code, 'upstream');
  assert.equal((await code(fakeFetch(200, {}))).code, 'upstream', 'odpověď bez tokenu');
  assert.equal((await code(fakeFetch(200, { token_hash: 'h' }), fakeClient({ data: {}, error: { message: 'expired' } }))).code, 'upstream', 'token se nepodařilo uplatnit');
  assert.equal((await code(fakeFetch(0, null, { reject: true }))).code, 'offline', 'výpadek sítě');
  const none = fakeFetch(200, { token_hash: 'h' });
  const bad = await loginWithCode(fakeClient(), CFG, 'krátké', none).then(() => null, (e) => e);
  assert.equal(bad.code, 'invalid_input'); assert.equal(none.calls.length, 0, 'neplatný tvar se na server ani neposílá');
  assert.ok(bad instanceof CodeLoginError);
  for (const m of Object.values(CODE_ERRORS)) assert.ok(m.length > 10 && !/[A-F0-9]{32}/.test(m), 'hláška neobsahuje kód');
});

test('loginWithCode: když je zařízení bez internetu, na server se ani nevolá', async () => {
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
  try {
    const f = fakeFetch(200, { token_hash: 'h' });
    const e = await loginWithCode(fakeClient(), CFG, GOOD, f).then(() => null, (x) => x);
    assert.equal(e.code, 'offline'); assert.equal(f.calls.length, 0);
  } finally { if (prev) Object.defineProperty(globalThis, 'navigator', prev); else delete globalThis.navigator; }
});

test('createLoginCode, getLoginCodeInfo, revokeLoginCode: volají správné funkce serveru a hlídají tvar odpovědi', async () => {
  const rpc = (map) => ({ calls: [], rpc: async function (fn) { this.calls.push(fn); return map[fn]; } });
  const a = rpc({ create_login_code: { data: 'A1B2-C3D4', error: null } });
  assert.equal(await createLoginCode(a), 'A1B2-C3D4'); assert.deepEqual(a.calls, ['create_login_code']);
  assert.equal(await createLoginCode(rpc({ create_login_code: { data: null, error: null } })), '');
  await assert.rejects(createLoginCode(rpc({ create_login_code: { data: null, error: { message: 'x' } } })));
  assert.deepEqual(await getLoginCodeInfo(rpc({ my_login_code: { data: { exists: true, created_at: '2026-10-29T10:00:00Z', last_used_at: null, use_count: 2 }, error: null } })), { exists: true, createdAt: '2026-10-29T10:00:00Z', lastUsedAt: null, useCount: 2 });
  assert.deepEqual(await getLoginCodeInfo(rpc({ my_login_code: { data: null, error: null } })), { exists: false, createdAt: null, lastUsedAt: null, useCount: 0 });
  await assert.rejects(getLoginCodeInfo(rpc({ my_login_code: { data: null, error: { code: 'PGRST202' } } })), 'funkce v databázi chybí: Nastavení to ukáže jako „zatím není zapnutý“');
  assert.equal(await revokeLoginCode(rpc({ revoke_login_code: { data: true, error: null } })), true);
  assert.equal(await revokeLoginCode(rpc({ revoke_login_code: { data: false, error: null } })), false);
});

/* ---------------------------------------------------------------- Edge Function */
const req = (body, { method = 'POST', headers = {}, raw } = {}) => new Request('https://f.test/code-login', { method, headers: { 'content-type': 'application/json', ...headers }, body: method === 'POST' ? (raw ?? JSON.stringify(body)) : undefined });
const mkDeps = (over = {}) => { const calls = { redeem: [], mint: [] }; return { calls, deps: {
  redeem: async (h, client) => { calls.redeem.push({ h, client }); return { ok: true, userId: 'u1' }; },
  mint: async (id) => { calls.mint.push(id); return { tokenHash: 'th-1' }; },
  ...over,
} }; };

test('Edge Function: platný kód vrátí token_hash a hledá se podle SHA-256 kódu (bez pomlček, velká písmena)', { skip }, async () => {
  const { calls, deps } = mkDeps();
  const res = await EDGE.handle(req({ code: 'a1b2-c3d4-e5f6-0718-293a-4b5c-6d7e-8f90' }, { headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' } }), deps);
  assert.equal(res.status, 200); assert.deepEqual(await res.json(), { token_hash: 'th-1' });
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(calls.redeem[0].h, crypto.createHash('sha256').update(GOOD).digest('hex'));
  assert.equal(calls.redeem[0].client, '203.0.113.5', 'omezení pokusů jde podle adresy volajícího');
  assert.deepEqual(calls.mint, ['u1']);
});

test('Edge Function: špatný tvar kódu se odmítne ještě před databází', { skip }, async () => {
  const { calls, deps } = mkDeps();
  for (const body of [{ code: 'krátký' }, { code: GOOD + 'A' }, { code: 12 }, {}, null]) {
    const res = await EDGE.handle(req(body), deps);
    assert.equal(res.status, 400); assert.equal((await res.json()).error, 'invalid_input');
  }
  assert.equal((await EDGE.handle(req(null, { raw: '{rozbité' }), deps)).status, 400);
  assert.equal(calls.redeem.length, 0);
});

test('Edge Function: neplatný kód 401, omezení pokusů 429, výpadek databáze nebo vydání tokenu 502 (nikdy ne token)', { skip }, async () => {
  const run = async (over) => { const { deps } = mkDeps(over); const res = await EDGE.handle(req({ code: GOOD }), deps); return [res.status, await res.json()]; };
  const e = console.error; console.error = () => {};
  try {
    assert.deepEqual((await run({ redeem: async () => ({ ok: false, reason: 'invalid' }) })).map((x, i) => (i ? x.error : x)), [401, 'invalid']);
    assert.deepEqual((await run({ redeem: async () => ({ ok: false, reason: 'throttled' }) })).map((x, i) => (i ? x.error : x)), [429, 'throttled']);
    assert.equal((await run({ redeem: async () => { throw new Error('db'); } }))[0], 502);
    const noMint = await run({ mint: async () => null }); assert.equal(noMint[0], 502); assert.ok(!('token_hash' in noMint[1]));
    assert.equal((await run({ mint: async () => { throw new Error('auth'); } }))[0], 502);
    assert.equal((await run({ mint: async () => ({ tokenHash: '' }) }))[0], 502);
  } finally { console.error = e; }
});

test('Edge Function: jen POST, OPTIONS pro CORS; odpovědi nenesou kód ani otisk', { skip }, async () => {
  const { deps } = mkDeps();
  assert.equal((await EDGE.handle(req(null, { method: 'GET' }), deps)).status, 405);
  const opt = await EDGE.handle(req(null, { method: 'OPTIONS' }), deps);
  assert.equal(opt.status, 204); assert.match(opt.headers.get('access-control-allow-headers'), /authorization/);
  const bad = await EDGE.handle(req({ code: GOOD }), mkDeps({ redeem: async () => ({ ok: false, reason: 'invalid' }) }).deps);
  const text = await bad.text();
  assert.ok(!text.includes(GOOD) && !/[0-9a-f]{64}/.test(text));
});

test('Edge Function: normalizeCode a clientOf', { skip }, () => {
  assert.equal(EDGE.normalizeCode('  a1b2-c3d4-e5f6-0718-293a-4b5c-6d7e-8f90 '), GOOD);
  assert.equal(EDGE.normalizeCode(GOOD.slice(1)), null);
  assert.equal(EDGE.CODE_LENGTH, 32);
  assert.equal(EDGE.clientOf(new Request('https://x.test', { headers: { 'x-forwarded-for': '1.2.3.4' } })), '1.2.3.4');
  assert.equal(EDGE.clientOf(new Request('https://x.test', { headers: { 'x-real-ip': '5.6.7.8' } })), '5.6.7.8');
  assert.equal(EDGE.clientOf(new Request('https://x.test')), 'unknown');
});

test('klient (src/offline/loginCode.js) a Edge Function normalizují kód stejně', { skip }, () => {
  for (const s of [GOOD, 'a1b2-c3d4-e5f6-0718-293a-4b5c-6d7e-8f90', ' A1B2 C3D4 E5F6 0718 293A 4B5C 6D7E 8F90 ', 'xyz', GOOD + '1', '']) assert.equal(normalizeCode(s), EDGE.normalizeCode(s), JSON.stringify(s));
});

/* ---------------------------------------------------------------- napojení v appce a v databázi */
test('SQL a Edge Function si odpovídají: stejný otisk (SHA-256 z 32 znaků), stejné funkce, service_role jen pro uplatnění', () => {
  const sql = fs.readFileSync(path.join(SRC, '..', 'db', 'login-code.sql'), 'utf8');
  const edge = fs.readFileSync(path.join(SRC, '..', 'db', 'auth', 'code-login.ts'), 'utf8');
  assert.match(sql, /sha256\(convert_to\(v_raw, 'UTF8'\)\)/);
  assert.match(edge, /crypto\.subtle\.digest\('SHA-256'/);
  assert.match(edge, /rpc\('redeem_login_code', \{ p_hash: '\\\\x' \+ hashHex, p_client: client \}\)/);
  assert.match(sql, /create or replace function public\.redeem_login_code\(p_hash bytea, p_client text\)/);
  assert.ok(sql.includes('grant execute on function public.redeem_login_code(bytea, text) to service_role;'));
  assert.ok(sql.includes('revoke all on function public.redeem_login_code(bytea, text) from public, anon, authenticated;'));
  for (const fn of ['create_login_code()', 'my_login_code()', 'revoke_login_code()']) {
    assert.ok(sql.includes(`revoke all on function public.${fn} from public, anon;`), fn);
    assert.ok(sql.includes(`grant execute on function public.${fn} to authenticated;`), fn);
  }
  assert.ok(sql.includes('alter table public.login_codes enable row level security;'));
  assert.ok(sql.includes('revoke all on public.login_codes, public.login_code_failures from public, anon, authenticated;'));
  assert.equal((sql.match(/security definer set search_path to 'public'/g) || []).length, 4);
  assert.match(edge, /generateLink\(\{ type: 'magiclink', email \}\)/);
  assert.match(edge, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(read('offline', 'loginCode.js') + read('contexts', 'AuthContext.jsx') + read('pages', 'LoginPage.jsx'), /service_role|SERVICE_ROLE/, 'klíč service_role v prohlížeči nikdy není');
});

test('AuthContext: bez internetu zůstane přihlášený podle uložené relace, po připojení se obnoví, odhlášení offline relaci opravdu smaže', () => {
  const ctx = read('contexts', 'AuthContext.jsx');
  assert.match(ctx, /readStoredSession\(supabaseUrl\)/);
  assert.match(ctx, /navigator\.onLine === false\) \|\| isNetworkProblem\(err\)/);
  assert.match(ctx, /window\.addEventListener\('online', onOnline\)/);
  assert.match(ctx, /if \(session\?\.user \|\| event === 'SIGNED_OUT'\) setOffline\(false\);/);
  assert.match(ctx, /writeCachedProfile\(sessionUser\.id/);
  assert.match(ctx, /clearStoredSession\(supabaseUrl\);/);
  assert.match(ctx, /await runLogoutCleanups\(\);/);
  assert.match(ctx, /value=\{\{ user, role, loading, offline, login, loginWithCode, logout,/);
});

test('přihlašovací stránka umí kód, Nastavení ho umí vytvořit a zrušit, odhlášení všude ho zneplatní, pruh „Jsi offline“ je v appce', () => {
  const login = read('pages', 'LoginPage.jsx');
  assert.match(login, /code: 'Přihlášení kódem'/);
  assert.match(login, /await loginWithCode\(code\);/);
  assert.match(login, /data-testid="login-code-input"/);
  assert.match(login, /\{mode !== 'forgot' && mode !== 'code' && \(/, 'v režimu kód není pole pro heslo');
  const settings = read('components', 'SettingsModal.jsx');
  assert.match(settings, /const LoginCodeSection = \(\) => \{/);
  assert.match(settings, /<LoginCodeSection \/>/);
  assert.match(settings, /createLoginCode\(supabase\)/);
  assert.match(settings, /try \{ await revokeLoginCode\(supabase\); \} catch/);
  assert.match(settings, /Server ho už nikdy neukáže/);
  assert.match(read('App.jsx'), /<OfflineBar \/>/);
  const pkg = JSON.parse(fs.readFileSync(path.join(SRC, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['test:offlinelogin'], 'node --test src/tests/offlineLogin.test.mjs');
  assert.ok(pkg.scripts.test.includes('npm run test:offlinelogin'));
});
