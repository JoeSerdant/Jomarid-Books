// Oznámení do zařízení: zapnutí a vypnutí v tomhle prohlížeči a komunikace s databází. Závislosti (klient, navigator, window)
// se předávají zvenku, takže jde testovat v Node s falešnými objekty.
import { VAPID_SETTINGS_KEY, subscriptionRow, sameApplicationServerKey } from './pushModel.js';
import { isVapidPublicKey, urlBase64ToUint8Array } from './vapid.js';

// Oznámení v zařízení jsou „přání zařízení“, ne jen přihlášení v prohlížeči: to se ztrácí (Obnovit aplikaci odregistruje service worker a s ním odpadne i přihlášení,
// prohlížeč ho může zahodit sám, správce vymění klíče) a navíc patří jednomu účtu. Proto si zařízení pamatuje, že oznámení chce (příznak v localStorage, nastaví ho
// zapnutí v Nastavení), a keepPushAlive při každém spuštění appky přihlášení obnoví a přiřadí k účtu, který právě používáš. Vypnout jde jen výslovně v Nastavení.
export const PUSH_WANTED_KEY = 'jomarid-push-wanted';
export const isPushWanted = (win) => { try { return win?.localStorage?.getItem(PUSH_WANTED_KEY) === '1'; } catch { return false; } };
const setWanted = (win, on) => { try { if (on) win?.localStorage?.setItem(PUSH_WANTED_KEY, '1'); else win?.localStorage?.removeItem(PUSH_WANTED_KEY); } catch { /* nevadí */ } };

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

/**
 * Stav tohohle zařízení: { subscribed, stale, permission, hasRegistration }.
 * Se znalostí klíče serveru (vapidKey) a klienta se ověří, že přihlášení v prohlížeči sedí na aktuální klíč a že má řádek v databázi
 * (po výměně klíčů nebo smazání zařízení z databáze je `stale` a Nastavení nabídne zapnutí znovu, místo aby tvrdilo, že oznámení fungují).
 */
export const deviceState = async ({ nav, win, client, vapidKey }) => {
  const reg = await getRegistration(nav, 2500);
  let sub = null;
  try { sub = reg ? await reg.pushManager.getSubscription() : null; } catch { /* nevadí */ }
  let healthy = !!sub;
  if (sub && vapidKey && isVapidPublicKey(vapidKey) && !sameApplicationServerKey(sub, urlBase64ToUint8Array(vapidKey))) healthy = false;
  if (healthy && client) {
    try {
      const res = await withTimeout(client.from('push_subscriptions').select('endpoint').eq('endpoint', sub.endpoint).maybeSingle(), 3000, null);
      if (res && !res.error && !res.data) healthy = false; // v databázi řádek není (smazán, vytlačen limitem zařízení)
    } catch { /* nejde ověřit: věříme prohlížeči */ }
  }
  return { subscribed: healthy, stale: !!sub && !healthy, permission: win?.Notification?.permission ?? 'unsupported', hasRegistration: !!reg };
};

/**
 * Zapne oznámení. status: enabled | denied | dismissed | not-configured | no-sw | error.
 * Volá se přímo z klepnutí: dotaz na povolení musí přijít dřív než jakékoli čekání na síť, jinak Safari (i v appce na iPhonu) okno
 * nezobrazí. Proto klíč serveru předává volající, který ho načetl už při otevření stránky (vapidKey); sám se načítá jen jako záloha.
 */
export const enablePush = async ({ client, nav, win, vapidKey = null }) => {
  if (win.Notification.permission === 'denied') return { status: 'denied' };
  let key = isVapidPublicKey(vapidKey) ? vapidKey : null;
  if (!key) { // záloha: bez předaného klíče se načte tady (dotaz na povolení pak nemusí být z klepnutí)
    const fetched = await fetchVapidKey(client);
    if (fetched.error) return { status: 'error', error: fetched.error };
    if (!fetched.key) return { status: 'not-configured' };
    key = fetched.key;
  }
  if (win.Notification.permission !== 'granted') {
    const answer = await win.Notification.requestPermission();
    if (answer !== 'granted') return { status: answer === 'denied' ? 'denied' : 'dismissed' };
  }
  const res = await register({ client, nav, key });
  if (res.status === 'enabled') setWanted(win, true);
  return res;
};

const register = async ({ client, nav, key }) => {
  const reg = await getRegistration(nav);
  if (!reg) return { status: 'no-sw' };
  const keyBytes = urlBase64ToUint8Array(key);
  try {
    let sub = await reg.pushManager.getSubscription();
    if (sub && !sameApplicationServerKey(sub, keyBytes)) { await sub.unsubscribe(); sub = null; } // správce vyměnil klíče
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes });
    const row = subscriptionRow(sub);
    if (!row) return { status: 'error' };
    const { error } = await client.rpc('register_push_subscription', { p_endpoint: row.endpoint, p_p256dh: row.p256dh, p_auth: row.auth, p_user_agent: nav.userAgent || null });
    if (error) {
      try { await sub.unsubscribe(); } catch { /* nevadí */ } // nezůstane přihlášení bez řádku v databázi
      return isMissingFunction(error) ? { status: 'not-configured' } : { status: 'error', error };
    }
    return { status: 'enabled' };
  } catch (e) {
    return { status: 'error', error: e };
  }
};

/** Výslovné vypnutí oznámení v tomhle zařízení (Nastavení): smaže řádek v databázi, přihlášení v prohlížeči i přání zařízení. Vrací true, když se něco odhlásilo. */
export const disablePush = async ({ client, nav, win }) => {
  setWanted(win, false);
  const reg = await getRegistration(nav, 2500);
  let sub = null;
  try { sub = reg ? await reg.pushManager.getSubscription() : null; } catch { /* nevadí */ }
  if (!sub) return false;
  const endpoint = sub.endpoint;
  // Odhlášení v prohlížeči i řádek v databázi se spouští zároveň: i kdyby databáze visela, zařízení přestane oznámení dostávat hned
  // (řádek se pak vyčistí při dalším odeslání, kdy push služba vrátí 404/410).
  const fromBrowser = (async () => { try { await sub.unsubscribe(); } catch { /* nevadí */ } })();
  const fromDatabase = (async () => { try { await client.rpc('unregister_push_subscription', { p_endpoint: endpoint }); } catch { /* vyčistí se při dalším odeslání */ } })();
  await Promise.all([fromBrowser, fromDatabase]);
  return true;
};

let keeping = null;   // rozběhnuté udržování oznámení (keepPushAlive)

/**
 * Odpojí zařízení od účtu: smaže jen řádek v databázi, takže odhlášený účet na něj dál nic neposílá. Přihlášení v prohlížeči a přání zařízení zůstávají,
 * ať se oznámení po dalším přihlášení (nebo přepnutí na jiný účet) samo obnoví (keepPushAlive). Vrací true, když se řádek mazal.
 */
export const detachPush = async ({ client, nav }) => {
  const reg = await getRegistration(nav, 2500);
  let sub = null;
  try { sub = reg ? await reg.pushManager.getSubscription() : null; } catch { /* nevadí */ }
  if (!sub) return false;
  try { await client.rpc('unregister_push_subscription', { p_endpoint: sub.endpoint }); } catch { /* vyčistí se při dalším odeslání (push služba vrátí 404/410) */ }
  return true;
};

/** Před odhlášením účtu: zařízení nesmí dál dostávat oznámení odhlášeného účtu (jen se odpojí, oznámení nezmizí). Nikdy nezdrží odhlášení déle než pár vteřin. */
export const cleanupOnLogout = async ({ client, nav }) => {
  // Rozběhnuté udržování oznámení se nejdřív dokončí, ať neotevře zařízení pro odhlášený účet znovu hned po odpojení.
  try { await withTimeout((async () => { await keeping; return detachPush({ client, nav }); })(), 2500, false); } catch { /* odhlášení se nesmí zablokovat */ }
};

/** Zařízení má přihlášení k oznámením: zapamatuje si, že je chce (volá se před Obnovit aplikaci, které přihlášení v prohlížeči zahodí). */
export const rememberPush = async ({ nav, win }) => {
  try {
    const reg = await getRegistration(nav, 2500);
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) setWanted(win, true);
    return !!sub;
  } catch { return false; }
};

const keep = async ({ client, nav, win, userId }) => {
  try {
    if (!win?.Notification || win.Notification.permission !== 'granted') return { status: 'off' };   // povolení nikdy nevynucujeme: ptá se jen Nastavení
    const reg = await getRegistration(nav, 4000);
    if (!reg) return { status: 'no-sw' };
    let sub = null;
    try { sub = await reg.pushManager.getSubscription(); } catch { /* nevadí */ }
    if (!sub && !isPushWanted(win)) return { status: 'not-wanted' };   // tohle zařízení oznámení nikdy nezapnulo
    const fetched = await fetchVapidKey(client);
    if (fetched.error) return { status: 'error', error: fetched.error };
    if (!fetched.key) return { status: 'not-configured' };
    const keyBytes = urlBase64ToUint8Array(fetched.key);
    if (sub && !sameApplicationServerKey(sub, keyBytes)) { try { await sub.unsubscribe(); } catch { /* nevadí */ } sub = null; }   // správce vyměnil klíče
    const fresh = !sub;
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes });   // povolení už je, okno se nezobrazí
    const row = subscriptionRow(sub);
    if (!row) return { status: 'error' };
    setWanted(win, true);
    if (!fresh) {
      // Je zařízení v databázi zapsané pod tímhle účtem? (po přepnutí účtu, odhlášení nebo smazání zařízení z databáze není)
      const res = await withTimeout(client.from('push_subscriptions').select('endpoint, user_id').eq('endpoint', sub.endpoint).maybeSingle(), 3000, null);
      if (res && !res.error && res.data && (!userId || !res.data.user_id || res.data.user_id === userId)) return { status: 'ok' };
    }
    const { error } = await client.rpc('register_push_subscription', { p_endpoint: row.endpoint, p_p256dh: row.p256dh, p_auth: row.auth, p_user_agent: nav.userAgent || null });
    if (error) return isMissingFunction(error) ? { status: 'not-configured' } : { status: 'error', error };   // přihlášení zůstává, příště se to zkusí znovu
    return { status: fresh ? 'resubscribed' : 'rebound' };
  } catch (e) {
    return { status: 'error', error: e };
  }
};

/**
 * Udrží oznámení zapnutá: když zařízení oznámení chce (zapnulo je v Nastavení) a povolení platí, doplní, co se ztratilo: přihlášení v prohlížeči
 * (po Obnovit aplikaci, po výměně klíčů serveru) a řádek v databázi pod účtem, který appku právě používá (po přepnutí účtu nebo odhlášení).
 * Nikdy nevyvolá okno s dotazem na povolení. Souběžná volání se slučují. Vrací { status }: ok | rebound | resubscribed | off | not-wanted | no-sw | not-configured | error.
 */
export const keepPushAlive = (env) => {
  if (!keeping) keeping = keep(env).finally(() => { keeping = null; });
  return keeping;
};

/** Pošle sobě zkušební oznámení (projde celou cestou: databáze -> Edge Function -> zařízení).
 *  S druhem (jen správce) pošle ukázku konkrétního motivačního oznámení s ukázkovými daty.
 *  delay = za kolik vteřin se oznámení odešle (0-30), ať stihneš appku zavřít a oznámení uvidíš. */
export const sendTestPush = async (client, kind, { delay = 0 } = {}) => {
  const args = {};
  if (kind) args.p_kind = kind;
  if (delay > 0) args.p_delay = Math.min(30, Math.round(delay));
  const { error } = Object.keys(args).length ? await client.rpc('send_test_push', args) : await client.rpc('send_test_push');
  if (!error) return { ok: true };
  if (isMissingFunction(error)) return { ok: false, reason: 'not-configured' };
  const msg = String(error.message || '');
  if (/too_many/.test(msg)) return { ok: false, reason: 'too-many' };
  if (/forbidden/.test(msg)) return { ok: false, reason: 'forbidden' };
  return { ok: false, reason: 'error' };
};

/** Motivační oznámení (série, rozečtená kniha, cíl, novinky...) jsou po účtech; bez uloženého nastavení platí „zapnuto“. */
export const getPushPrefs = async (client) => {
  const { data, error } = await client.rpc('get_push_prefs');
  if (error) return { ok: false, reason: isMissingFunction(error) ? 'not-configured' : 'error', engage: true };
  return { ok: true, engage: data?.engage !== false };
};
export const setPushPrefs = async (client, engage) => {
  const { error } = await client.rpc('set_push_prefs', { p_engage: !!engage });
  return error ? { ok: false, reason: isMissingFunction(error) ? 'not-configured' : 'error' } : { ok: true };
};
