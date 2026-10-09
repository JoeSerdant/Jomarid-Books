// Testy oznámení do zařízení: node --test src/tests/push.test.mjs   (nebo: npm run test:push)
// Logika bez prohlížeče: podpora a stavy, klíče VAPID, zapnutí/vypnutí s falešným klientem, obsluha push v service workeru
// (izolovaný skript) a Edge Function (db/push/send-push.ts) s falešnými závislostmi. Doručení na skutečné zařízení se ověřuje ručně.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pushSupport, permissionState, subscriptionRow, sameApplicationServerKey, enableMessage, VAPID_SETTINGS_KEY, PUSH_KINDS, TEST_PUSH_DELAY_SECONDS } from '../push/pushModel.js';
import { generateVapidKeys, isVapidPublicKey, isVapidPrivateKey, urlBase64ToUint8Array } from '../push/vapid.js';
import { fetchVapidKey, enablePush, disablePush, cleanupOnLogout, sendTestPush, deviceState, getPushPrefs, setPushPrefs } from '../push/pushClient.js';

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
    assert.equal(e.log.unsubscribed, 1, 'ani při chybějící funkci nezůstane přihlášení bez řádku');
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
    assert.deepEqual(await deviceState(makeEnv({ permission: 'granted', existing: { endpoint: 'https://x/e' } })), { subscribed: true, stale: false, permission: 'granted', hasRegistration: true });
    assert.deepEqual(await deviceState(makeEnv()), { subscribed: false, stale: false, permission: 'default', hasRegistration: true });
  });
  test('stav zařízení: přihlášení po výměně klíčů nebo bez řádku v databázi se nepovažuje za zapnuté', async () => {
    const rowClient = (data, error = null) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error }) }) }) }) });
    const oldKey = { applicationServerKey: Uint8Array.of(9, 9, 9).buffer };
    const e1 = makeEnv({ permission: 'granted', existing: { endpoint: 'https://x/e', options: oldKey } });
    assert.deepEqual(await deviceState({ ...e1, client: rowClient({ endpoint: 'https://x/e' }), vapidKey: KEY }), { subscribed: false, stale: true, permission: 'granted', hasRegistration: true });
    const e2 = makeEnv({ permission: 'granted', existing: { endpoint: 'https://x/e' } });
    assert.equal((await deviceState({ ...e2, client: rowClient(null), vapidKey: KEY })).stale, true, 'řádek chybí');
    assert.equal((await deviceState({ ...e2, client: rowClient({ endpoint: 'https://x/e' }), vapidKey: KEY })).subscribed, true, 'řádek je a klíč sedí');
    assert.equal((await deviceState({ ...e2, client: rowClient(null, { message: 'síť' }), vapidKey: KEY })).subscribed, true, 'nejde ověřit: věří se prohlížeči');
    const hang = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => new Promise(() => {}) }) }) }) };
    assert.equal((await deviceState({ ...e2, client: hang, vapidKey: KEY })).subscribed, true, 'zaseknutá databáze nezablokuje stránku');
    assert.equal((await deviceState({ ...makeEnv(), client: rowClient(null), vapidKey: KEY })).stale, false, 'bez přihlášení v prohlížeči není co opravovat');
  });
  test('zapnutí z klepnutí: s předaným klíčem se na povolení ptá hned, před jakýmkoli čekáním na databázi', async () => {
    const order = [];
    const e = makeEnv();
    const baseFrom = e.client.from;
    e.client.from = (...a) => { order.push('klíč ze serveru'); return baseFrom(...a); };
    const ask = e.win.Notification.requestPermission;
    e.win.Notification.requestPermission = async () => { order.push('povolení'); return ask(); };
    assert.equal((await enablePush({ ...e, vapidKey: KEY })).status, 'enabled');
    assert.deepEqual(order, ['povolení'], 'dotaz na povolení nesmí čekat na síť');
    // bez předaného klíče (záloha) se klíč načte; neplatný předaný klíč se zahodí
    const f = makeEnv(); assert.equal((await enablePush({ ...f, vapidKey: 'krátký' })).status, 'enabled');
    const n = makeEnv({ vapid: null }); assert.equal((await enablePush({ ...n, vapidKey: null })).status, 'not-configured');
  });
  test('vypnutí: přihlášení v prohlížeči se odhlásí hned, i když databáze visí (po odhlášení z účtu nic nechodí)', async () => {
    const e = makeEnv({ permission: 'granted', existing: { endpoint: 'https://push.example/ep4' } });
    e.client.rpc = () => new Promise(() => {});
    const done = disablePush(e);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(e.log.unsubscribed, 1, 'odhlášení v prohlížeči čekalo na databázi');
    done.catch(() => {});
    const out = makeEnv({ permission: 'granted', existing: { endpoint: 'https://push.example/ep5' } });
    out.client.rpc = () => new Promise(() => {});
    await cleanupOnLogout(out);
    assert.equal(out.log.unsubscribed, 1);
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
  test('ukázka druhu oznámení (správce): posílá druh; zákaz pro nesprávce a chyby se rozliší', async () => {
    const e = makeEnv();
    assert.deepEqual(await sendTestPush(e.client, 'streak_risk'), { ok: true });
    assert.deepEqual(e.log.rpc, [['send_test_push', { p_kind: 'streak_risk' }]]);
    assert.deepEqual(await sendTestPush(makeEnv({ rpcError: { message: 'forbidden' } }).client, 'comeback'), { ok: false, reason: 'forbidden' });
    assert.deepEqual(await sendTestPush(makeEnv({ rpcError: { message: 'too_many' } }).client, 'comeback'), { ok: false, reason: 'too-many' });
    const plain = makeEnv(); await sendTestPush(plain.client);
    assert.deepEqual(plain.log.rpc, [['send_test_push', undefined]], 'bez druhu se volá jako dřív');
  });
  test('zkušební oznámení se zpožděním: předá se jen kladné zpoždění a nejvýš 30 vteřin', async () => {
    const e = makeEnv();
    await sendTestPush(e.client, undefined, { delay: TEST_PUSH_DELAY_SECONDS });
    await sendTestPush(e.client, 'praise', { delay: 10 });
    await sendTestPush(e.client, 'praise', { delay: 999 });
    await sendTestPush(e.client, 'praise', { delay: -5 });
    await sendTestPush(e.client, undefined, { delay: 0 });
    assert.deepEqual(e.log.rpc, [
      ['send_test_push', { p_delay: 10 }], ['send_test_push', { p_kind: 'praise', p_delay: 10 }], ['send_test_push', { p_kind: 'praise', p_delay: 30 }],
      ['send_test_push', { p_kind: 'praise' }], ['send_test_push', undefined],
    ]);
    assert.equal(TEST_PUSH_DELAY_SECONDS, 10);
  });
  test('připomínky a novinky: čtení (bez řádku platí zapnuto, chyba nic nevypne) a uložení', async () => {
    const mk = (data, error = null) => ({ rpc: async (name, args) => ({ data: name === 'get_push_prefs' ? data : null, error, args }) });
    assert.deepEqual(await getPushPrefs(mk({ engage: true })), { ok: true, engage: true });
    assert.deepEqual(await getPushPrefs(mk({ engage: false })), { ok: true, engage: false });
    assert.deepEqual(await getPushPrefs(mk(null)), { ok: true, engage: true });
    assert.deepEqual(await getPushPrefs(mk(null, { message: 'boom' })), { ok: false, reason: 'error', engage: true });
    assert.deepEqual(await getPushPrefs(mk(null, { code: 'PGRST202', message: 'x' })), { ok: false, reason: 'not-configured', engage: true });
    const e = makeEnv();
    assert.deepEqual(await setPushPrefs(e.client, false), { ok: true });
    assert.deepEqual(e.log.rpc, [['set_push_prefs', { p_engage: false }]]);
    assert.deepEqual(await setPushPrefs(makeEnv({ rpcError: { message: 'boom' } }).client, true), { ok: false, reason: 'error' });
    assert.deepEqual(await setPushPrefs(makeEnv({ rpcError: { code: 'PGRST202', message: 'x' } }).client, true), { ok: false, reason: 'not-configured' });
  });
  test('seznam druhů ve Správě odpovídá druhům v Edge Function i v SQL', () => {
    const sql = read('db/push-notifications.sql'); const edge = read('db/push/send-push.ts');
    assert.equal(PUSH_KINDS.length, 9);
    for (const { kind, label } of PUSH_KINDS) {
      assert.ok(label.length > 3, kind);
      assert.ok(new RegExp(`when '${kind}' then`).test(sql), `SQL ukázka: ${kind}`);
      assert.ok(new RegExp(`case '${kind}'`).test(edge), `Edge compose: ${kind}`);
    }
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

  test('platný JSON „null“, číslo nebo text místo objektu: ukáže se obecné oznámení, ne chyba', async () => {
    for (const raw of ['null', '5', '"text"', 'true', '[]']) {
      const sw = makeSw(); await sw.push(undefined, { raw });
      assert.equal(sw.shown.length, 1, raw); assert.equal(sw.shown[0].title, 'Jomarid Books', raw); assert.equal(sw.shown[0].options.body, 'Máš nové oznámení.', raw);
    }
  });
  test('cíl se zpětným lomítkem nebo řídicím znakem se změní na úvodní stránku (i při klepnutí)', async () => {
    const sw = makeSw();
    for (const bad of ['/\\evil.example', '/a\\b', '/a\u0000b', '/\t/evil.example']) {
      await sw.push({ title: 'x', url: bad });
      assert.equal(sw.shown.at(-1).options.data.url, '/', JSON.stringify(bad));
      await sw.click(bad); assert.equal(sw.opened.at(-1), '/', JSON.stringify(bad));
    }
    await sw.push({ title: 'x', url: '/app?x=1' }); assert.equal(sw.shown.at(-1).options.data.url, '/app?x=1');
  });
});

// ---- Edge Function ----
let EDGE = null;
try { EDGE = await import('../../db/push/send-push.ts'); } catch (e) {
  // Přeskočí se jen starší Node bez podpory TypeScriptu. Chyba v samotném souboru (syntaxe, import) musí test shodit, ne ho tiše vynechat.
  if (!['ERR_UNKNOWN_FILE_EXTENSION', 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX'].includes(e?.code)) throw e;
}
const UID = '11111111-1111-1111-1111-111111111111';
const req = (body, { method = 'POST', secret = 's3', raw } = {}) => new Request('https://f.test/send-push', { method, headers: { 'x-push-secret': secret ?? '', 'content-type': 'application/json' }, body: method === 'GET' ? undefined : (raw ?? JSON.stringify(body)) });
const deps = (over = {}) => {
  const calls = { sent: [], listed: [], deleted: [] };
  return { calls, deps: {
    secret: 's3',
    sendWebPush: async (sub, payload) => { calls.sent.push([sub, JSON.parse(payload)]); },
    listSubscriptions: async (a, u) => { calls.listed.push([a, u]); return [{ id: 'a', endpoint: 'https://fcm.googleapis.com/fcm/send/1', p256dh: 'P', auth: 'A' }, { id: 'b', endpoint: 'https://fcm.googleapis.com/fcm/send/2', p256dh: 'P', auth: 'A' }]; },
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
    assert.deepEqual(calls.sent[0], [{ endpoint: 'https://fcm.googleapis.com/fcm/send/1', keys: { p256dh: 'P', auth: 'A' } }, { title: 'Ahoj', body: 'Text', url: '/settings/notifications', tag: 'n-1' }]);
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
  test('motivační oznámení: druh + data se změní na hotový text a cíl v appce, hlavička i značka zůstanou', async () => {
    const { deps: d, calls } = deps({ rnd: () => 0 });
    const res = await EDGE.handle(req({ audience: 'user', user_id: UID, kind: 'streak_risk', data: { streak: 5 }, tag: 'e-2026-10-09', url: '/', title: '', body: '' }), d);
    assert.equal(res.status, 200);
    const p = calls.sent[0][1];
    assert.match(p.title, /5 dní v řadě/); assert.match(p.body, /kapitola/); assert.equal(p.url, '/app'); assert.equal(p.tag, 'e-2026-10-09');
  });
  test('milník série vede na statistiky, neznámý druh se odmítne, bez druhu platí hotový text', async () => {
    const { deps: d, calls } = deps({ rnd: () => 0 });
    await EDGE.handle(req({ audience: 'user', user_id: UID, kind: 'streak_milestone', data: { streak: 7 } }), d);
    assert.equal(calls.sent[0][1].url, '/stats'); assert.match(calls.sent[0][1].title, /Týden/);
    const bad = await EDGE.handle(req({ audience: 'user', user_id: UID, kind: 'nesmysl', title: 'x' }), d);
    assert.equal(bad.status, 400); assert.deepEqual(await bad.json(), { error: 'bad_kind' });
    calls.sent.length = 0;
    await EDGE.handle(req({ audience: 'user', user_id: UID, title: 'Ahoj', body: 'B', kind: '' }), d);
    assert.equal(calls.sent[0][1].title, 'Ahoj');
  });
  test('příjemce „všichni“ a vynechání autora už neexistují: novinky jdou jednotlivě přes plánovač a respektují hodiny i vypnutí', async () => {
    const { deps: d, calls } = deps({ rnd: () => 0 });
    const res = await EDGE.handle(req({ audience: 'all', kind: 'new_book', data: { title: 'T', author: 'A' } }), d);
    assert.equal(res.status, 400); assert.deepEqual(await res.json(), { error: 'bad_audience' });
    assert.equal(calls.listed.length, 0);
    // novinka jednomu čtenáři přes druh new_book
    await EDGE.handle(req({ audience: 'user', user_id: UID, kind: 'new_book', data: { title: 'Ladící', author: 'Autorka' }, url: 'https://evil.example' }), d);
    assert.match(calls.sent[0][1].body, /Ladící/); assert.equal(calls.sent[0][1].url, '/app');
  });
  test('jemné popostrčení: v pondělí, v pátek a o víkendu i podle denní doby přibývají vlastní varianty (pražský čas)', async () => {
    const titles = async (iso) => {
      const out = new Set();
      for (let i = 0; i < 60; i += 1) {
        const { deps: d, calls } = deps({ rnd: () => i / 60, now: () => new Date(iso) });
        await EDGE.handle(req({ audience: 'user', user_id: UID, kind: 'gentle_nudge' }), d);
        out.add(calls.sent[0][1].title);
      }
      return out;
    };
    const mon = await titles('2026-10-12T10:00:00Z'); const fri = await titles('2026-10-09T10:00:00Z'); const sat = await titles('2026-10-10T10:00:00Z'); const wed = await titles('2026-10-07T10:00:00Z');
    assert.ok(mon.has('Pondělí zvládneš s dobrým příběhem') && !wed.has('Pondělí zvládneš s dobrým příběhem'));
    assert.ok(fri.has('Pátek! Čas na knihu 📚') && !wed.has('Pátek! Čas na knihu 📚'));
    assert.ok(sat.has('Víkend voní papírem 📖') && !wed.has('Víkend voní papírem 📖'));
    // 22:30 UTC v neděli je v Praze už pondělí 00:30 (jiný den i denní doba)
    const late = await titles('2026-10-11T22:30:00Z');
    assert.ok(late.has('Pondělí zvládneš s dobrým příběhem'));
  });
  test('denní doba: ráno, přes den a večer mají své varianty (pražský čas, i v zimním čase)', async () => {
    const titles = async (iso, kind = 'gentle_nudge', data) => {
      const out = new Set();
      for (let i = 0; i < 60; i += 1) {
        const { deps: d, calls } = deps({ rnd: () => i / 60, now: () => new Date(iso) });
        await EDGE.handle(req({ audience: 'user', user_id: UID, kind, data }), d);
        out.add(calls.sent[0][1].title);
      }
      return out;
    };
    const morning = await titles('2026-10-07T07:30:00Z'); // 9:30 v Praze (letní čas)
    const noon = await titles('2026-10-07T11:30:00Z');    // 13:30
    const evening = await titles('2026-10-07T17:30:00Z'); // 19:30
    assert.ok(morning.has('Dobré ráno! ☀️') && !noon.has('Dobré ráno! ☀️') && !evening.has('Dobré ráno! ☀️'));
    assert.ok(noon.has('Polední pauza s knihou 🥪') && !morning.has('Polední pauza s knihou 🥪'));
    assert.ok(evening.has('Klidný večer s knihou 🌙') && !noon.has('Klidný večer s knihou 🌙'));
    const winterMorning = await titles('2026-12-09T08:30:00Z'); // 9:30 v Praze (zimní čas, UTC+1)
    assert.ok(winterMorning.has('Dobré ráno! ☀️'));
    const lateStreak = await titles('2026-10-07T19:30:00Z', 'streak_risk', { streak: 5 }); // 21:30
    assert.ok(lateStreak.has('Ještě to stihneš! 🌟'));
    const praiseEvening = await titles('2026-10-07T18:30:00Z', 'praise', { streak: 3 });
    assert.ok(praiseEvening.has('Dobrá práce, teď si odpočiň 🌙') && !(await titles('2026-10-07T10:30:00Z', 'praise', { streak: 3 })).has('Dobrá práce, teď si odpočiň 🌙'));
  });
  test('zpoždění zkušebního oznámení: funkce počká po ověření hesla a před odesláním, nejvýš 30 vteřin; neplatné hodnoty = bez čekání', async () => {
    const waited = [];
    const { deps: d, calls } = deps({ sleep: async (ms) => { waited.push([ms, calls.sent.length]); } });
    await EDGE.handle(req({ audience: 'user', user_id: UID, title: 'x', delay_seconds: 10 }), d);
    assert.deepEqual(waited, [[10000, 0]], 'čeká před odesláním');
    waited.length = 0;
    await EDGE.handle(req({ audience: 'user', user_id: UID, title: 'x', delay_seconds: 999 }), d);
    assert.equal(waited[0][0], 30000);
    for (const bad of [undefined, 0, -3, 'abc', null, NaN]) { waited.length = 0; await EDGE.handle(req({ audience: 'user', user_id: UID, title: 'x', delay_seconds: bad }), d); assert.equal(waited.length, 0, String(bad)); }
    waited.length = 0;
    assert.equal((await EDGE.handle(req({ audience: 'user', user_id: UID, delay_seconds: 10 }, { secret: 'spatne' }), d)).status, 401);
    assert.equal((await EDGE.handle(req({ audience: 'nikdo', delay_seconds: 10 }), d)).status, 400);
    assert.equal(waited.length, 0, 'bez hesla ani se špatným příjemcem se nečeká');
  });
  test('adresa zařízení musí vést na push službu prohlížeče: cizí adresy se nikdy nevolají, jen se smažou', async () => {
    const ok = ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/Q', 'https://wns2-par02p.notify.windows.com/w/?token=x', 'https://android.googleapis.com/gcm/send/x', 'https://FCM.GOOGLEAPIS.COM:443/fcm/send/x'];
    const bad = ['https://evil.example/fcm.googleapis.com/', 'https://fcm.googleapis.com.evil.example/x', 'https://evilfcm.googleapis.com.evil.example/x', 'https://fcm.googleapis.com@evil.example/x', 'https://evil.example#.fcm.googleapis.com/', 'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://127.0.0.1/x', 'https://localhost/x', 'https://169.254.169.254/latest/meta-data', 'https://fcm.googleapis.com', '', null, 5, 'https://fcm.googleapis.com/' + 'x'.repeat(2000)];
    for (const u of ok) assert.equal(EDGE.isPushServiceUrl(u), true, u);
    for (const u of bad) assert.equal(EDGE.isPushServiceUrl(u), false, String(u).slice(0, 60));
    const subs = [...ok.slice(0, 2).map((endpoint, i) => ({ id: `g${i}`, endpoint, p256dh: 'P', auth: 'A' })), ...bad.slice(0, 3).map((endpoint, i) => ({ id: `b${i}`, endpoint, p256dh: 'P', auth: 'A' }))];
    const { deps: d, calls } = deps({ listSubscriptions: async () => subs });
    const res = await (await EDGE.handle(req({ audience: 'user', user_id: UID, title: 'x' }), d)).json();
    assert.deepEqual(res, { sent: 2, removed: 3, failed: 0, total: 5 });
    assert.deepEqual(calls.sent.map(([sub]) => sub.endpoint), ok.slice(0, 2));
    assert.deepEqual(calls.deleted, [['b0', 'b1', 'b2']]);
  });
  test('cíl s lomítkem a zpětným lomítkem, řídicími znaky nebo mezerou se změní na úvodní stránku', async () => {
    const { deps: d, calls } = deps();
    for (const bad of ['/\\evil.example', '/a\\b', '/a\u0000b', '/a\nb', '/a\u007fb', '/\\/evil.example', '///evil']) {
      calls.sent.length = 0; await EDGE.handle(req({ audience: 'user', user_id: UID, url: bad }), d);
      assert.equal(calls.sent[0][1].url, '/', JSON.stringify(bad));
    }
    await EDGE.handle(req({ audience: 'user', user_id: UID, url: '/settings/notifications?x=1#a' }), d);
    assert.equal(calls.sent.at(-1)[1].url, '/settings/notifications?x=1#a');
  });
  test('chyba čtení zařízení z databáze není „úspěch s nulou“: odpověď 500 a záznam v logu', async () => {
    const logged = []; const orig = console.error; console.error = (...a) => logged.push(a);
    try {
      const { deps: d } = deps({ listSubscriptions: async () => { throw new Error('db spadla'); } });
      const res = await EDGE.handle(req({ audience: 'user', user_id: UID }), d);
      assert.equal(res.status, 500); assert.deepEqual(await res.json(), { error: 'db_error' });
      assert.equal(logged.length, 1);
    } finally { console.error = orig; }
  });
  test('selhalo mazání mrtvých zařízení: nepočítají se jako odstraněná a chyba se zaloguje', async () => {
    const logged = []; const orig = console.error; console.error = (...a) => logged.push(a);
    try {
      const { deps: d } = deps({ sendWebPush: async () => { const e = new Error('gone'); e.statusCode = 410; throw e; }, deleteSubscriptions: async () => { throw new Error('db'); } });
      const res = await (await EDGE.handle(req({ audience: 'user', user_id: UID }), d)).json();
      assert.deepEqual(res, { sent: 0, removed: 0, failed: 0, total: 2 });
      assert.equal(logged.length, 1);
    } finally { console.error = orig; }
  });
});

describe('texty oznámení (compose)', { skip: !EDGE && 'Node bez podpory TypeScriptu' }, () => {
  const SAMPLES = {
    streak_risk: [{ streak: 1 }, { streak: 2 }, { streak: 3 }, { streak: 6 }, { streak: 7 }, { streak: 29 }, { streak: 30 }, { streak: 400 }],
    streak_milestone: [3, 7, 14, 30, 50, 100, 200, 365, 12].map((streak) => ({ streak })),
    praise: [0, 1, 2, 5, 40].map((streak) => ({ streak })),
    comeback: [3, 7, 14, 30, 90].map((days) => ({ days })),
    continue_book: [{ title: 'Krátká', percent: 3 }, { title: 'Y'.repeat(500), percent: 97 }, { title: '  Více   mezer  ', percent: 50 }],
    goal_progress: [{ goal: 4, done: 0, remaining: 4 }, { goal: 4, done: 1, remaining: 3 }, { goal: 4, done: 2, remaining: 2 }, { goal: 4, done: 3, remaining: 1 }, { goal: 1, done: 0, remaining: 1 }, { goal: 30, done: 14, remaining: 16 }],
    coins_to_spend: [{ coins: 1 }, { coins: 3 }, { coins: 250 }],
    gentle_nudge: [{}],
    new_book: [{ title: 'Ladící kniha', author: 'Autorka' }, { title: 'T'.repeat(500), author: 'A'.repeat(500) }, { title: 'Bez autora', author: '' }],
  };
  // každou variantu jednou projdeme přes rnd 0..1, pro každý den v týdnu
  const all = () => {
    const out = [];
    for (const kind of EDGE.MESSAGE_KINDS) for (const data of SAMPLES[kind]) for (let wd = 0; wd < 7; wd += 3) for (const hour of [8, 14, 19, 21]) for (let i = 0; i < 24; i += 1) out.push([kind, data, EDGE.compose(kind, data, () => i / 24, wd, hour)]);
    return out;
  };
  test('všech 9 druhů má vzorky a umí složit text', () => {
    assert.deepEqual([...EDGE.MESSAGE_KINDS].sort(), Object.keys(SAMPLES).sort());
    for (const [kind, , m] of all()) assert.ok(m, kind);
  });
  test('žádná varianta nepřekročí limity, nemá prázdný text ani „undefined/NaN“ a jde na cestu v appce', () => {
    for (const [kind, data, m] of all()) {
      const where = `${kind} ${JSON.stringify(data).slice(0, 60)}`;
      assert.ok(m.title.length > 3 && m.title.length <= 80, `titulek: ${where}: ${m.title.length}`);
      assert.ok(m.body.length > 10 && m.body.length <= 200, `text: ${where}: ${m.body.length}`);
      assert.ok(!/undefined|NaN|null|\[object|\$\{/.test(m.title + m.body), where);
      assert.match(m.url, /^\/(app|stats)$/, where);
    }
  });
  test('bez rodových tvarů a s tykáním: žádné „jsi/jste/bys/byste“ (kromě „jsi legenda“ a „jsi na…“), žádné „(a)“ a „/a“', () => {
    for (const [kind, , m] of all()) {
      const t = `${m.title} ${m.body}`;
      assert.ok(!/(^|\s)(jsi|jste|bys|byste)(\s|$)(?!(legenda|na)(\s|$))/i.test(t.replace(/(jsi|jste) (legenda|na) /gi, 'X ')), `${kind}: ${t}`); // „jsi legenda“ a „jsi na…“ jsou bez rodu
      assert.ok(!/\((a|la|á)\)|\/(a|la)\b/.test(t), `${kind}: ${t}`);
      assert.ok(!/(^|\s)(Vy|Vás|Vám|Vaše|Vaši|Váš)\b/.test(t), `vykání: ${kind}: ${t}`);
    }
  });
  test('povzbudivý tón: žádné strašení, výčitky ani ztráty', () => {
    for (const [kind, , m] of all()) {
      const t = `${m.title} ${m.body}`;
      assert.ok(!/škoda|bohužel|zklam|lenost|lenoch|zahoď|zahodit|zahodí|zmizí|zmizel|ztrat|ztrác|přijdeš o|přijdete o|selž|selhá|vzdej|vzdáš|hrozí|ohrožen|pozor|výčitk|opozd|nestihne/i.test(t), `${kind}: ${t}`);
    }
  });
  test('je z čeho vybírat: aspoň 90 různých titulků a každý druh má několik variant (milníky aspoň po dvou)', () => {
    const byKind = new Map();
    for (const [kind, , m] of all()) { if (!byKind.has(kind)) byKind.set(kind, new Set()); byKind.get(kind).add(m.title); }
    let total = 0;
    for (const [kind, set] of byKind) { total += set.size; assert.ok(set.size >= 3, `${kind}: ${set.size}`); }
    assert.ok(total >= 90, `celkem ${total}`);
    for (const n of [3, 7, 14, 30, 50, 100]) assert.ok(new Set([0, 0.99].map((r) => EDGE.compose('streak_milestone', { streak: n }, () => r).title)).size === 2, `milník ${n}`);
  });
  test('série v ohrožení je přizpůsobená délce a správně skloňuje „den/dny/dní“', () => {
    const first = (n) => EDGE.compose('streak_risk', { streak: n }, () => 0);
    assert.match(first(1).body, /1 den\b/); assert.match(first(2).body, /2 dny\b/);
    assert.match(first(5).title, /5 dní/); assert.match(first(11).body + first(11).title, /11 dní/);
    assert.notEqual(first(1).title, first(40).title);
  });
  test('správné skloňování knih a mincí', () => {
    const body = (kind, data, r = 0) => { const m = EDGE.compose(kind, data, () => r); return `${m.title} | ${m.body}`; };
    assert.match(body('goal_progress', { goal: 5, done: 2, remaining: 3 }), /3 knihy/);
    assert.match(body('goal_progress', { goal: 8, done: 2, remaining: 6 }), /6 knih/);
    assert.match(body('goal_progress', { goal: 5, done: 3, remaining: 2 }), /2 knihy/);
    assert.match(body('coins_to_spend', { coins: 1 }), /1 minci/); assert.match(body('coins_to_spend', { coins: 3 }), /3 mince/); assert.match(body('coins_to_spend', { coins: 250 }), /250 mincí/);
    assert.match(body('coins_to_spend', { coins: 1 }, 0.3), /Na účtu je 1 mince/);
  });
  test('název knihy se zkrátí a v textu je v českých uvozovkách; chybná nebo cizí data text nerozbijí', () => {
    const m = EDGE.compose('continue_book', { title: 'Z'.repeat(300), percent: 41 }, () => 0);
    assert.ok(m.title.includes('…') && m.title.length <= 80);
    assert.match(m.body, /41 %/);
    for (const junk of [null, undefined, 5, 'text', [], { streak: 'abc' }, { streak: -4 }, { streak: 1e12 }, { streak: {} }]) {
      for (const kind of EDGE.MESSAGE_KINDS) {
        const x = EDGE.compose(kind, junk, () => 0.5);
        assert.ok(x && x.title && x.body && !/NaN|undefined/.test(x.title + x.body), `${kind} ${JSON.stringify(junk)}`);
      }
    }
    assert.equal(EDGE.compose('nesmysl', {}), null); assert.equal(EDGE.compose(undefined, {}), null);
  });
  test('rnd mimo rozsah variantu nerozbije (0, 1, záporné, nekonečno)', () => {
    for (const r of [0, 1, -1, 5, Infinity, NaN]) assert.ok(EDGE.compose('gentle_nudge', {}, () => r), String(r));
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
  test('adresa zařízení smí vést jen na push službu: SQL i Edge Function mají stejný seznam', () => {
    assert.match(sql, /create or replace function public\.push_endpoint_ok/);
    assert.match(sql, /if not public\.push_endpoint_ok\(p_endpoint\) then raise exception 'bad_endpoint'/);
    assert.match(sql, /delete from public\.push_subscriptions where not public\.push_endpoint_ok\(endpoint\)/, 'dřív uložené cizí adresy se smažou');
    const hosts = (txt) => (txt.match(/\(([a-z\\.|]+googleapis[a-z\\.|]+)\)/i)?.[1] || '').split('|').sort();
    assert.ok(hosts(sql).length === 5, 'seznam v SQL');
    assert.deepEqual(hosts(sql), hosts(read('db/push/send-push.ts')));
  });
  test('motivační oznámení: plánovač, výběr, odhlášení, soukromé tabulky, hodiny a limit jednoho denně', () => {
    for (const re of [/push_engagement_tick/, /push_engage_pick/, /cron\.schedule\('push-engagement'/, /Europe\/Prague/, /h < cfg\.engage_from or h > cfg\.engage_to/, /engage_gap_minutes/, /engage_max_per_day/, /get_push_prefs/, /set_push_prefs/, /trg_push_new_book/, /push_new_books/, /pg_try_advisory_xact_lock\(hashtext\('push_engagement_tick'\)\)/]) assert.match(sql, re);
    assert.ok(!/unique \(user_id, day\)/i.test(sql.replace(/--[^\n]*/g, '')) || /drop constraint if exists push_engage_log_user_id_day_key/.test(sql), 'denní limit jedna na čtenáře už neplatí');
    assert.match(sql, /drop constraint if exists push_engage_log_user_id_day_key/, 'starší instalace dostane více oznámení denně');
    assert.match(sql, /alter table public\.push_prefs enable row level security/);
    assert.match(sql, /alter table public\.push_engage_log enable row level security/);
    assert.match(sql, /revoke execute on function public\.push_engagement_tick[^;]*from public, anon, authenticated/);
    assert.match(sql, /revoke execute on function public\.push_engage_pick[^;]*from public, anon, authenticated/);
    assert.match(sql, /coalesce\(pf\.engage, true\)/, 'kdo si připomínky vypnul, nedostane je');
    assert.ok(!/insert into public\.user_notifications/.test(sql));
    assert.match(sql, /alter table public\.push_new_books enable row level security/);
    assert.ok(!/push_dispatch\('all'/.test(sql), 'novinky se neposílají hromadně a hned');
  });
  test('v souboru nejsou žádná tajemství ani pevná adresa projektu; složka se nejmenuje supabase/', () => {
    assert.ok(!/sb_secret|service_role|BEGIN PRIVATE KEY|vapid_private/i.test(sql));
    assert.ok(!/https:\/\/[a-z0-9]+\.supabase\.co/.test(sql));
    assert.ok(fs.existsSync(path.join(ROOT, 'db', 'push', 'send-push.ts')));
    assert.ok(!fs.existsSync(path.join(ROOT, 'supabase')));
  });
  test('návod popisuje všechny kroky včetně vypnutí Verify JWT a tajných hodnot', () => {
    const readme = read('db/push/README.md');
    for (const re of [/push-notifications\.sql/, /Vygenerovat klíče/, /VAPID_PRIVATE_KEY/, /PUSH_WEBHOOK_SECRET/, /Verify JWT/, /send-push/, /iPhon/, /pg_cron/, /push_engagement_tick/, /Připomínky a novinky/, /engage_gap_minutes/, /engage_max_per_day/, /bez denního stropu/]) assert.match(readme, re);
  });
});

// ---- SQL na skutečném PostgreSQL ----
// db/tests/run.sh spustí db/push-notifications.sql na dočasném lokálním PostgreSQL proti zjednodušenému schématu Supabase a zkontroluje výběr
// oznámení, plánovač (okno hodin, odstup, strop, střídání, souběh), spouštěče, oprávnění a RLS. Bez PostgreSQL (kód 77) se přeskočí.
const sqlRun = (() => { try { return spawnSync('bash', [path.join(ROOT, 'db', 'tests', 'run.sh')], { encoding: 'utf8', timeout: 240000 }); } catch { return null; } })();
// Přeskočí se jen když PostgreSQL (kód 77) nebo bash chybí; timeout nebo jiná chyba spuštění test shodí, ať zaseknutá SQL změna neprojde.
const sqlUnavailable = !sqlRun || sqlRun.error?.code === 'ENOENT' || sqlRun.status === 77;
describe('SQL na skutečném PostgreSQL (db/tests/run.sh)', { skip: sqlUnavailable && 'PostgreSQL není k dispozici' }, () => {
  test('všechny SQL kontroly prošly (výběr, plánovač, souběh, oprávnění)', () => {
    assert.ifError(sqlRun.error);
    assert.equal(sqlRun.status, 0, `${sqlRun.stdout}\n${sqlRun.stderr}`);
    const n = Number((sqlRun.stdout.match(/SQL testy: (\d+) kontrol prošlo/) || [])[1]);
    assert.ok(n >= 90, `kontrol: ${n}`);
  });
});
