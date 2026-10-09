// Testy oznámení do zařízení: node --test src/tests/push.test.mjs   (nebo: npm run test:push)
// Logika bez prohlížeče: podpora a stavy, klíče VAPID, zapnutí/vypnutí s falešným klientem, obsluha push v service workeru
// (izolovaný skript) a Edge Function (db/push/send-push.ts) s falešnými závislostmi. Doručení na skutečné zařízení se ověřuje ručně.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pushSupport, permissionState, subscriptionRow, sameApplicationServerKey, enableMessage, VAPID_SETTINGS_KEY } from '../push/pushModel.js';
import { generateVapidKeys, isVapidPublicKey, isVapidPrivateKey, urlBase64ToUint8Array } from '../push/vapid.js';
import { fetchVapidKey, enablePush, disablePush, cleanupOnLogout, sendTestPush, deviceState } from '../push/pushClient.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const IPHONE = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1' };
const FULL_WIN = { PushManager: function PushManager() {}, Notification: { permission: 'default' } };
const SW_NAV = { serviceWorker: {}, userAgent: 'x' };

describe('podpora a stavy', () => {
  test('podporováno, když jsou service worker, PushManager i Notification', () => {
    assert.deepEqual(pushSupport({ win: FULL_WIN, nav: SW_NAV }), { supported: true, reason: 'ok' });
  });
  test('iPhone mimo nainstalovanou appku: nutno přidat na plochu; v ní (s PushManager) funguje', () => {
    assert.deepEqual(pushSupport({ win: {}, nav: { ...IPHONE, serviceWorker: {} }, standalone: false }), { supported: false, reason: 'ios-needs-install' });
    assert.equal(pushSupport({ win: FULL_WIN, nav: { ...IPHONE, serviceWorker: {} }, standalone: true }).supported, true);
  });
  test('starý prohlížeč nebo iPhone s příliš starým systémem: nepodporováno', () => {
    assert.deepEqual(pushSupport({ win: {}, nav: { userAgent: 'x' } }), { supported: false, reason: 'unsupported' });
    assert.deepEqual(pushSupport({ win: {}, nav: { ...IPHONE, serviceWorker: {} }, standalone: true }), { supported: false, reason: 'unsupported' });
    assert.equal(pushSupport().supported, false);
  });
  test('stav povolení', () => {
    assert.equal(permissionState({ Notification: { permission: 'granted' } }), 'granted');
    assert.equal(permissionState({}), 'unsupported');
    assert.equal(permissionState({ Notification: {} }), 'unsupported');
  });
  test('řádek z přihlášení: potřebuje https adresu a oba klíče', () => {
    const good = { toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'P', auth: 'A' } }) };
    assert.deepEqual(subscriptionRow(good), { endpoint: 'https://push.example/abc', p256dh: 'P', auth: 'A' });
    for (const bad of [null, {}, { toJSON: () => ({ endpoint: 'http://x', keys: { p256dh: 'P', auth: 'A' } }) }, { toJSON: () => ({ endpoint: 'https://x', keys: { p256dh: 'P' } }) }, { toJSON: () => { throw new Error('x'); } }]) assert.equal(subscriptionRow(bad), null);
  });
  test('stejný klíč serveru: nezná-li ho prohlížeč, nechá se být; jiný klíč se pozná', () => {
    assert.ok(sameApplicationServerKey({}, Uint8Array.of(1, 2)));
    assert.ok(sameApplicationServerKey({ options: { applicationServerKey: Uint8Array.of(1, 2).buffer } }, Uint8Array.of(1, 2)));
    assert.ok(!sameApplicationServerKey({ options: { applicationServerKey: Uint8Array.of(1, 3).buffer } }, Uint8Array.of(1, 2)));
    assert.ok(!sameApplicationServerKey({ options: { applicationServerKey: Uint8Array.of(1).buffer } }, Uint8Array.of(1, 2)));
  });
  test('texty pro každý výsledek zapnutí', () => {
    for (const s of ['enabled', 'denied', 'dismissed', 'not-configured', 'no-sw', 'error']) assert.ok(enableMessage(s).length > 5, s);
    assert.equal(enableMessage('nic'), '');
  });
});

describe('klíče VAPID', () => {
  test('vygenerovaný pár má správnou délku a soukromý klíč odpovídá veřejnému', async () => {
    const k = await generateVapidKeys();
    assert.ok(isVapidPublicKey(k.publicKey), k.publicKey);
    assert.ok(isVapidPrivateKey(k.privateKey), k.privateKey);
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(k.privateKey, 'base64url'));
    assert.equal(ecdh.getPublicKey().toString('base64url'), k.publicKey);
    assert.equal(urlBase64ToUint8Array(k.publicKey).length, 65);
    assert.equal(urlBase64ToUint8Array(k.publicKey)[0], 4); // nekomprimovaný bod
  });
  test('každé vygenerování je jiné; neumí-li prohlížeč WebCrypto, srozumitelná chyba', async () => {
    const a = await generateVapidKeys(); const b = await generateVapidKeys();
    assert.notEqual(a.privateKey, b.privateKey);
    await assert.rejects(() => generateVapidKeys({}), /WebCrypto/);
  });
  test('kontrola tvaru klíčů', () => {
    for (const bad of [null, '', 'abc', 'A'.repeat(86), 'A'.repeat(88), `${'A'.repeat(86)}+`]) assert.ok(!isVapidPublicKey(bad), String(bad));
    assert.ok(!isVapidPrivateKey('A'.repeat(44)));
  });
});

// ---- falešný klient a prohlížeč ----
const KEY = 'B' + 'A'.repeat(86);
const makeEnv = ({ vapid = KEY, permission = 'default', answer = 'granted', existing = null, rpcError = null, siteError = null, noSw = false } = {}) => {
  const log = { rpc: [], subscribeArgs: null, unsubscribed: 0, requested: 0 };
  const sub = (endpoint = 'https://push.example/ep1') => ({
    endpoint, toJSON: () => ({ endpoint, keys: { p256dh: 'P'.repeat(30), auth: 'A'.repeat(12) } }),
    unsubscribe: async () => { log.unsubscribed++; current = null; return true; }, options: existing?.options,
  });
  let current = existing ? { ...sub(existing.endpoint), options: existing.options } : null;
  const reg = { pushManager: { getSubscription: async () => current, subscribe: async (o) => { log.subscribeArgs = o; current = sub(); return current; } } };
  const win = { Notification: { permission, requestPermission: async () => { log.requested++; win.Notification.permission = answer; return answer; } } };
  const nav = { userAgent: 'TestUA', serviceWorker: noSw ? undefined : { ready: Promise.resolve(reg) } };
  const client = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => (siteError ? { data: null, error: siteError } : { data: vapid ? { value: { key: vapid } } : null, error: null }) }) }) }),
    rpc: async (name, args) => { log.rpc.push([name, args]); return { error: rpcError }; },
  };
  return { log, win, nav, client };
};

describe('klient: zapnutí a vypnutí', () => {
  test('klíč serveru: platný, chybějící, poškozený i chyba čtení', async () => {
    assert.deepEqual(await fetchVapidKey(makeEnv().client), { key: KEY });
    assert.deepEqual(await fetchVapidKey(makeEnv({ vapid: null }).client), { key: null });
    assert.deepEqual(await fetchVapidKey(makeEnv({ vapid: 'krátký' }).client), { key: null });
    assert.ok((await fetchVapidKey(makeEnv({ siteError: { message: 'x' } }).client)).error);
    assert.equal(VAPID_SETTINGS_KEY, 'push_vapid_public');
  });
  test('zapnutí: zeptá se na povolení, přihlásí zařízení s klíčem serveru a uloží ho do databáze', async () => {
    const { log, win, nav, client } = makeEnv();
    assert.deepEqual(await enablePush({ client, nav, win }), { status: 'enabled' });
    assert.equal(log.requested, 1);
    assert.equal(log.subscribeArgs.userVisibleOnly, true);
    assert.deepEqual(Array.from(log.subscribeArgs.applicationServerKey), Array.from(urlBase64ToUint8Array(KEY)));
    assert.equal(log.rpc[0][0], 'register_push_subscription');
    assert.deepEqual(log.rpc[0][1], { p_endpoint: 'https://push.example/ep1', p_p256dh: 'P'.repeat(30), p_auth: 'A'.repeat(12), p_user_agent: 'TestUA' });
  });
  test('už povolené: na povolení se neptá', async () => {
    const { log, win, nav, client } = makeEnv({ permission: 'granted' });
    assert.equal((await enablePush({ client, nav, win })).status, 'enabled');
    assert.equal(log.requested, 0);
  });
  test('nenastavený server, zablokované povolení, odmítnuté povolení, chybějící service worker', async () => {
    let e = makeEnv({ vapid: null }); assert.equal((await enablePush(e)).status, 'not-configured'); assert.equal(e.log.requested, 0);
    e = makeEnv({ permission: 'denied' }); assert.equal((await enablePush(e)).status, 'denied'); assert.equal(e.log.requested, 0);
    e = makeEnv({ answer: 'denied' }); assert.equal((await enablePush(e)).status, 'denied');
    e = makeEnv({ answer: 'default' }); assert.equal((await enablePush(e)).status, 'dismissed');
    e = makeEnv({ permission: 'granted', noSw: true }); assert.equal((await enablePush(e)).status, 'no-sw');
  });
  test('chyba databáze: zařízení se odhlásí (nezůstane přihlášené bez řádku); chybějící funkce = server není nastavený', async () => {
    let e = makeEnv({ permission: 'granted', rpcError: { message: 'boom' } });
    assert.equal((await enablePush(e)).status, 'error'); assert.equal(e.log.unsubscribed, 1);
    e = makeEnv({ permission: 'granted', rpcError: { code: 'PGRST202', message: 'x' } });
    assert.equal((await enablePush(e)).status, 'not-configured');
  });
  test('správce vyměnil klíče: staré přihlášení se zahodí a vytvoří nové', async () => {
    const e = makeEnv({ permission: 'granted', existing: { endpoint: 'https://push.example/old', options: { applicationServerKey: Uint8Array.of(9, 9, 9).buffer } } });
    assert.equal((await enablePush(e)).status, 'enabled');
    assert.equal(e.log.unsubscribed, 1);
    assert.ok(e.log.subscribeArgs);
  });
  test('vypnutí smaže řádek v databázi i přihlášení; bez přihlášení nic', async () => {
    const e = makeEnv({ permission: 'granted', existing: { endpoint: 'https://push.example/ep9' } });
    assert.equal(await disablePush(e), true);
    assert.deepEqual(e.log.rpc[0], ['unregister_push_subscription', { p_endpoint: 'https://push.example/ep9' }]);
    assert.equal(e.log.unsubscribed, 1);
    assert.equal(await disablePush(makeEnv()), false);
  });
  test('stav zařízení', async () => {
    assert.deepEqual(await deviceState(makeEnv({ permission: 'granted', existing: { endpoint: 'https://x/e' } })), { subscribed: true, permission: 'granted', hasRegistration: true });
    assert.deepEqual(await deviceState(makeEnv()), { subscribed: false, permission: 'default', hasRegistration: true });
  });
  test('před odhlášením se zařízení odhlásí; chyba ani zaseknutá databáze odhlášení nezablokují', async () => {
    const e = makeEnv({ permission: 'granted', existing: { endpoint: 'https://push.example/ep2' } });
    await cleanupOnLogout(e);
    assert.equal(e.log.rpc[0][0], 'unregister_push_subscription');
    const hang = makeEnv({ permission: 'granted', existing: { endpoint: 'https://push.example/ep3' } });
    hang.client.rpc = () => new Promise(() => {});
    const t0 = Date.now();
    await cleanupOnLogout(hang);
    assert.ok(Date.now() - t0 < 4000, 'odhlášení se zdrželo');
    const broken = makeEnv(); broken.nav.serviceWorker.ready = Promise.reject(new Error('x'));
    await assert.doesNotReject(() => cleanupOnLogout(broken));
  });
  test('zkušební oznámení: výsledky', async () => {
    assert.deepEqual(await sendTestPush(makeEnv().client), { ok: true });
    assert.deepEqual(await sendTestPush(makeEnv({ rpcError: { message: 'too_many' } }).client), { ok: false, reason: 'too-many' });
    assert.deepEqual(await sendTestPush(makeEnv({ rpcError: { code: 'PGRST202', message: 'x' } }).client), { ok: false, reason: 'not-configured' });
    assert.deepEqual(await sendTestPush(makeEnv({ rpcError: { message: 'jiná' } }).client), { ok: false, reason: 'error' });
  });
});

// ---- service worker ----
const TEMPLATE = read('src/pwa/sw.template.js');
const ORIGIN = 'https://app.test';
const makeSw = ({ windows = [] } = {}) => {
  const listeners = {}; const shown = []; const opened = []; const closed = [];
  const source = TEMPLATE.replace("'__VERSION__'", '"t"').replace('[] /* REQUIRED */', '[]').replace('[] /* OPTIONAL */', '[]');
  const self = {
    location: { origin: ORIGIN }, addEventListener: (t, fn) => { listeners[t] = fn; },
    registration: { showNotification: async (title, options) => { shown.push({ title, options }); } },
    clients: { matchAll: async () => windows, openWindow: async (u) => { opened.push(u); }, claim: async () => {} },
    skipWaiting: async () => {},
  };
  vm.runInNewContext(source, { self, caches: {}, fetch: async () => {}, Request, Response, URL, Promise, setTimeout, console });
  const push = async (data, { raw } = {}) => {
    const ps = [];
    const event = { data: raw === undefined && data === undefined ? null : { json: () => (raw !== undefined ? JSON.parse(raw) : data) }, waitUntil: (p) => ps.push(p) };
    listeners.push(event); await Promise.all(ps);
  };
  const click = async (url) => {
    const ps = [];
    listeners.notificationclick({ notification: { close: () => closed.push(1), data: url === undefined ? undefined : { url } }, waitUntil: (p) => ps.push(p) });
    await Promise.all(ps);
  };
  return { shown, opened, closed, push, click };
};

describe('service worker: oznámení', () => {
  test('push ukáže oznámení s textem, ikonou, značkou a cílem', async () => {
    const w = makeSw();
    await w.push({ title: 'Kniha skrytá', body: 'Správce skryl tvou knihu.', url: '/settings/notifications', tag: 'n-1' });
    assert.equal(w.shown.length, 1);
    assert.equal(w.shown[0].title, 'Kniha skrytá');
    assert.deepEqual(JSON.parse(JSON.stringify(w.shown[0].options)), { body: 'Správce skryl tvou knihu.', icon: '/icon-192.png', badge: '/icon-192.png', data: { url: '/settings/notifications' }, tag: 'n-1' });
  });
  test('iPhone vyžaduje oznámení u každého pushe: prázdná i nečitelná zpráva ukáže obecné oznámení', async () => {
    let w = makeSw(); await w.push(undefined);
    assert.equal(w.shown.length, 1); assert.equal(w.shown[0].title, 'Jomarid Books'); assert.match(w.shown[0].options.body, /oznámení/i);
    w = makeSw(); await w.push(undefined, { raw: '{nesmysl' });
    assert.equal(w.shown.length, 1);
  });
  test('cizí adresa, jiný protokol i protokolově relativní adresa se změní na úvodní stránku; texty se zkrátí', async () => {
    for (const bad of ['https://evil.example/x', '//evil.example', 'javascript:alert(1)', 'settings', 5, null, '/a b']) {
      const w = makeSw(); await w.push({ title: 'T', url: bad });
      assert.equal(w.shown[0].options.data.url, '/', String(bad));
    }
    const w = makeSw(); await w.push({ title: 'x'.repeat(500), body: 'y'.repeat(500), tag: 'z'.repeat(500) });
    assert.equal(w.shown[0].title.length, 120); assert.equal(w.shown[0].options.body.length, 200); assert.equal(w.shown[0].options.tag.length, 80);
  });
  test('klepnutí zavře oznámení a otevře appku na cíli', async () => {
    const w = makeSw();
    await w.click('/settings/notifications');
    assert.equal(w.closed.length, 1); assert.deepEqual(w.opened, ['/settings/notifications']);
  });
  test('klepnutí s otevřenou appkou jen přenese okno do popředí a přejde na cíl; cizí okno se ignoruje', async () => {
    const calls = [];
    const win = { url: `${ORIGIN}/`, focus: async () => calls.push('focus'), navigate: async (u) => calls.push(`navigate ${u}`) };
    const w = makeSw({ windows: [{ url: 'https://jina.example/', focus: async () => calls.push('CIZI') }, win] });
    await w.click('/admin');
    assert.deepEqual(calls, ['focus', 'navigate /admin']); assert.deepEqual(w.opened, []);
    const same = makeSw({ windows: [{ url: `${ORIGIN}/admin`, focus: async () => calls.push('f2'), navigate: async () => calls.push('N2') }] });
    calls.length = 0; await same.click('/admin');
    assert.deepEqual(calls, ['f2']); // už je tam
    const onlyForeign = makeSw({ windows: [{ url: 'https://jina.example/', focus: async () => calls.push('CIZI') }] });
    await onlyForeign.click('/x'); assert.deepEqual(onlyForeign.opened, ['/x']);
  });
  test('klepnutí bez cíle nebo s nebezpečným cílem otevře úvodní stránku', async () => {
    let w = makeSw(); await w.click(undefined); assert.deepEqual(w.opened, ['/']);
    w = makeSw(); await w.click('https://evil.example'); assert.deepEqual(w.opened, ['/']);
  });
});

// ---- Edge Function ----
let EDGE = null;
try { EDGE = await import('../../db/push/send-push.ts'); } catch { /* starší Node bez podpory TypeScriptu: testy se přeskočí */ }
const UID = '11111111-1111-1111-1111-111111111111';
const req = (body, { method = 'POST', secret = 's3', raw } = {}) => new Request('https://f.test/send-push', { method, headers: { 'x-push-secret': secret ?? '', 'content-type': 'application/json' }, body: method === 'GET' ? undefined : (raw ?? JSON.stringify(body)) });
const deps = (over = {}) => {
  const calls = { sent: [], listed: [], deleted: [] };
  return { calls, deps: {
    secret: 's3',
    sendWebPush: async (sub, payload) => { calls.sent.push([sub, JSON.parse(payload)]); },
    listSubscriptions: async (a, u) => { calls.listed.push([a, u]); return [{ id: 'a', endpoint: 'https://e/1', p256dh: 'P', auth: 'A' }, { id: 'b', endpoint: 'https://e/2', p256dh: 'P', auth: 'A' }]; },
    deleteSubscriptions: async (ids) => { calls.deleted.push(ids); },
    ...over,
  } };
};

describe('Edge Function send-push', { skip: !EDGE && 'Node bez podpory TypeScriptu' }, () => {
  test('jen POST se správným heslem', async () => {
    const { deps: d } = deps();
    assert.equal((await EDGE.handle(req(null, { method: 'GET' }), d)).status, 405);
    assert.equal((await EDGE.handle(req({}, { secret: 'spatne' }), d)).status, 401);
    assert.equal((await EDGE.handle(req({}, { secret: null }), d)).status, 401);
    assert.equal((await EDGE.handle(req({ audience: 'user', user_id: UID }), { ...d, secret: '' })).status, 401); // nenastavené heslo funkce nikoho nepustí
  });
  test('nečitelné tělo a špatný příjemce', async () => {
    const { deps: d } = deps();
    assert.equal((await EDGE.handle(req(null, { raw: '{x' }), d)).status, 400);
    for (const b of [{}, { audience: 'nikdo' }, { audience: 'user' }, { audience: 'user', user_id: 'není-uuid' }]) assert.equal((await EDGE.handle(req(b), d)).status, 400, JSON.stringify(b));
  });
  test('pošle všem zařízením uživatele zprávu s titulkem, textem a bezpečným cílem', async () => {
    const { deps: d, calls } = deps();
    const res = await EDGE.handle(req({ audience: 'user', user_id: UID, title: 'Ahoj', body: 'Text', url: '/settings/notifications', tag: 'n-1' }), d);
    assert.deepEqual(await res.json(), { sent: 2, removed: 0, failed: 0, total: 2 });
    assert.deepEqual(calls.listed, [['user', UID]]);
    assert.deepEqual(calls.sent[0], [{ endpoint: 'https://e/1', keys: { p256dh: 'P', auth: 'A' } }, { title: 'Ahoj', body: 'Text', url: '/settings/notifications', tag: 'n-1' }]);
  });
  test('správcům nepotřebuje konkrétního uživatele', async () => {
    const { deps: d, calls } = deps();
    assert.equal((await EDGE.handle(req({ audience: 'admins', title: 'Žádost' }), d)).status, 200);
    assert.deepEqual(calls.listed, [['admins', null]]);
  });
  test('cizí adresa v cíli se změní na úvodní stránku, texty se zkrátí, bez titulku je název appky', async () => {
    const { deps: d, calls } = deps();
    await EDGE.handle(req({ audience: 'user', user_id: UID, url: 'https://evil.example', body: 'y'.repeat(900) }), d);
    assert.equal(calls.sent[0][1].url, '/'); assert.equal(calls.sent[0][1].title, 'Jomarid Books'); assert.equal(calls.sent[0][1].body.length, 200);
    for (const bad of ['//evil.example', 'javascript:x', '/a b']) { calls.sent.length = 0; await EDGE.handle(req({ audience: 'user', user_id: UID, url: bad }), d); assert.equal(calls.sent[0][1].url, '/', bad); }
  });
  test('zařízení, která push odmítla jako smazaná (404, 410), se z databáze odstraní; ostatní chyby se jen spočítají', async () => {
    const { deps: d, calls } = deps({ sendWebPush: async (sub) => { if (sub.endpoint.endsWith('/1')) { const e = new Error('gone'); e.statusCode = 410; throw e; } throw new Error('síť'); } });
    const res = await (await EDGE.handle(req({ audience: 'user', user_id: UID }), d)).json();
    assert.deepEqual(res, { sent: 0, removed: 1, failed: 1, total: 2 });
    assert.deepEqual(calls.deleted, [['a']]);
  });
  test('chyba mazání ani prázdný seznam zařízení funkci neshodí', async () => {
    const { deps: d } = deps({ sendWebPush: async () => { const e = new Error('x'); e.statusCode = 404; throw e; }, deleteSubscriptions: async () => { throw new Error('db'); } });
    assert.equal((await EDGE.handle(req({ audience: 'user', user_id: UID }), d)).status, 200);
    const none = deps({ listSubscriptions: async () => [] });
    assert.deepEqual(await (await EDGE.handle(req({ audience: 'user', user_id: UID }), none.deps)).json(), { sent: 0, removed: 0, failed: 0, total: 0 });
  });
});

// ---- SQL a návod ----
describe('SQL a návod pro server', () => {
  const sql = read('db/push-notifications.sql');
  test('tabulky jsou chráněné: zařízení jen čtení vlastních řádků, soukromé nastavení bez přístupu', () => {
    assert.match(sql, /alter table public\.push_subscriptions enable row level security/);
    assert.match(sql, /revoke all on public\.push_subscriptions from anon, authenticated/);
    assert.match(sql, /grant select on public\.push_subscriptions to authenticated/);
    assert.match(sql, /alter table public\.push_settings enable row level security/);
    assert.match(sql, /revoke all on public\.push_settings from anon, authenticated/);
    assert.ok(!/grant (insert|update|delete)[^;]*push_subscriptions/i.test(sql), 'zápis jen přes funkce');
  });
  test('funkce a spouštěče: oznámení čtenáře i správce, zkušební oznámení, odeslání nikdy nerozbije zápis', () => {
    for (const re of [/register_push_subscription/, /unregister_push_subscription/, /trg_push_user_notification/, /trg_push_admin_notification/, /send_test_push/, /net\.http_post/, /exception when others then\s+null/]) assert.match(sql, re);
    assert.match(sql, /after insert on public\.user_notifications/);
    assert.match(sql, /after insert on public\.admin_notifications/);
    assert.match(sql, /revoke execute on function public\.push_dispatch[^;]*from public, anon, authenticated/);
    assert.match(sql, /alter table public\.push_test_log enable row level security/);
    assert.match(sql, /if not found then raise exception 'too_many'/);
    assert.ok(!/insert into public\.user_notifications/.test(sql), 'zkouška nesmí zapisovat do schránky oznámení (může mít omezení na druhy)');
  });
  test('v souboru nejsou žádná tajemství ani pevná adresa projektu; složka se nejmenuje supabase/', () => {
    assert.ok(!/sb_secret|service_role|BEGIN PRIVATE KEY|vapid_private/i.test(sql));
    assert.ok(!/https:\/\/[a-z0-9]+\.supabase\.co/.test(sql));
    assert.ok(fs.existsSync(path.join(ROOT, 'db', 'push', 'send-push.ts')));
    assert.ok(!fs.existsSync(path.join(ROOT, 'supabase')));
  });
  test('návod popisuje všechny kroky včetně vypnutí Verify JWT a tajných hodnot', () => {
    const readme = read('db/push/README.md');
    for (const re of [/push-notifications\.sql/, /Vygenerovat klíče/, /VAPID_PRIVATE_KEY/, /PUSH_WEBHOOK_SECRET/, /Verify JWT/, /send-push/, /iPhon/]) assert.match(readme, re);
  });
});
