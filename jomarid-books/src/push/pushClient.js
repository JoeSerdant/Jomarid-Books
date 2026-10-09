// Oznámení do zařízení: zapnutí a vypnutí v tomhle prohlížeči a komunikace s databází. Závislosti (klient, navigator, window)
// se předávají zvenku, takže jde testovat v Node s falešnými objekty.
import { VAPID_SETTINGS_KEY, subscriptionRow, sameApplicationServerKey } from './pushModel.js';
import { isVapidPublicKey, urlBase64ToUint8Array } from './vapid.js';

const withTimeout = (promise, ms, fallback = null) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(fallback), ms))]);
const isMissingFunction = (e) => !!e && (e.code === 'PGRST202' || /could not find the function/i.test(String(e.message || '')));

/** Veřejný klíč VAPID uložený správcem. { key } (null, pokud server ještě není nastavený) nebo { error }. */
export const fetchVapidKey = async (client) => {
  const res = await client.from('site_settings').select('value').eq('key', VAPID_SETTINGS_KEY).maybeSingle();
  if (res.error) return { error: res.error };
  const key = res.data?.value?.key;
  return { key: isVapidPublicKey(key) ? key : null };
};

/** Registrace service workeru (ve vývojovém režimu žádný není, proto čekání jen krátce). */
export const getRegistration = (nav, ms = 4000) => (nav?.serviceWorker ? withTimeout(nav.serviceWorker.ready.catch(() => null), ms) : Promise.resolve(null));

/** Stav tohohle zařízení: { subscribed, permission }. */
export const deviceState = async ({ nav, win }) => {
  const reg = await getRegistration(nav, 2500);
  let sub = null;
  try { sub = reg ? await reg.pushManager.getSubscription() : null; } catch { /* nevadí */ }
  return { subscribed: !!sub, permission: win?.Notification?.permission ?? 'unsupported', hasRegistration: !!reg };
};

/** Zapne oznámení. status: enabled | denied | dismissed | not-configured | no-sw | error. */
export const enablePush = async ({ client, nav, win }) => {
  const vapid = await fetchVapidKey(client);
  if (vapid.error) return { status: 'error', error: vapid.error };
  if (!vapid.key) return { status: 'not-configured' };
  if (win.Notification.permission === 'denied') return { status: 'denied' };
  if (win.Notification.permission !== 'granted') {
    const answer = await win.Notification.requestPermission(); // musí běžet přímo z klepnutí uživatele
    if (answer !== 'granted') return { status: answer === 'denied' ? 'denied' : 'dismissed' };
  }
  const reg = await getRegistration(nav);
  if (!reg) return { status: 'no-sw' };
  const keyBytes = urlBase64ToUint8Array(vapid.key);
  try {
    let sub = await reg.pushManager.getSubscription();
    if (sub && !sameApplicationServerKey(sub, keyBytes)) { await sub.unsubscribe(); sub = null; } // správce vyměnil klíče
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes });
    const row = subscriptionRow(sub);
    if (!row) return { status: 'error' };
    const { error } = await client.rpc('register_push_subscription', { p_endpoint: row.endpoint, p_p256dh: row.p256dh, p_auth: row.auth, p_user_agent: nav.userAgent || null });
    if (error) {
      if (isMissingFunction(error)) return { status: 'not-configured' };
      try { await sub.unsubscribe(); } catch { /* nevadí */ }
      return { status: 'error', error };
    }
    return { status: 'enabled' };
  } catch (e) {
    return { status: 'error', error: e };
  }
};

/** Vypne oznámení v tomhle zařízení (smaže řádek v databázi i přihlášení v prohlížeči). Vrací true, když se něco odhlásilo. */
export const disablePush = async ({ client, nav }) => {
  const reg = await getRegistration(nav, 2500);
  let sub = null;
  try { sub = reg ? await reg.pushManager.getSubscription() : null; } catch { /* nevadí */ }
  if (!sub) return false;
  const endpoint = sub.endpoint;
  try { await client.rpc('unregister_push_subscription', { p_endpoint: endpoint }); } catch { /* řádek se vyčistí při dalším odeslání (410) */ }
  try { await sub.unsubscribe(); } catch { /* nevadí */ }
  return true;
};

/** Před odhlášením: zařízení nesmí dál dostávat oznámení odhlášeného účtu. Nikdy nezdrží odhlášení déle než pár vteřin. */
export const cleanupOnLogout = async ({ client, nav, win }) => {
  try { await withTimeout(disablePush({ client, nav, win }), 2500, false); } catch { /* odhlášení se nesmí zablokovat */ }
};

/** Pošle sobě zkušební oznámení (projde celou cestou: oznámení v databázi -> Edge Function -> zařízení). */
export const sendTestPush = async (client) => {
  const { error } = await client.rpc('send_test_push');
  if (!error) return { ok: true };
  if (isMissingFunction(error)) return { ok: false, reason: 'not-configured' };
  if (/too_many/.test(String(error.message || ''))) return { ok: false, reason: 'too-many' };
  return { ok: false, reason: 'error' };
};
