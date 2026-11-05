// Oznámení do zařízení (Web Push): čistá logika bez prohlížeče, jde testovat v Node (src/tests/push.test.mjs).
import { isIosDevice } from '../pwa/installModel.js';
import { t } from '../i18n/core.js';
import { tk } from '../i18n/mark.js';

export const VAPID_SETTINGS_KEY = 'push_vapid_public'; // site_settings: { key: "<veřejný klíč VAPID>" }
// Zkušební oznámení se odešle až za tolik vteřin: stihneš appku zavřít, přepnout se jinam nebo zamknout telefon a oznámení opravdu uvidíš.
export const TEST_PUSH_DELAY_SECONDS = 10;
// Trvalá nápověda vedle tlačítka zkušebního oznámení: co zkontrolovat, když nepřišlo.
export const TEST_PUSH_HELP = tk('Nepřišlo? Zkontroluj, že jsou povolená oznámení pro prohlížeč nebo appku a že není zapnuté Nerušit. Na iPhonu musí být appka přidaná na plochu. Pomůže i oznámení tady vypnout a znovu zapnout.');

/**
 * Jde v tomhle prohlížeči zapnout oznámení? reason: 'ok' | 'ios-needs-install' (iPhone a iPad je umí jen v appce přidané na
 * plochu) | 'unsupported'.
 */
export const pushSupport = ({ win = {}, nav = {}, standalone = false } = {}) => {
  if (nav.serviceWorker && 'PushManager' in win && 'Notification' in win) return { supported: true, reason: 'ok' };
  if (isIosDevice(nav) && !standalone) return { supported: false, reason: 'ios-needs-install' };
  return { supported: false, reason: 'unsupported' };
};

/** 'granted' | 'denied' | 'default' | 'unsupported' */
export const permissionState = (win = {}) => (win.Notification && typeof win.Notification.permission === 'string' ? win.Notification.permission : 'unsupported');

/** Řádek pro databázi z PushSubscription; null, když chybí adresa nebo klíče. */
export const subscriptionRow = (sub) => {
  let j;
  try { j = typeof sub?.toJSON === 'function' ? sub.toJSON() : sub; } catch { return null; }
  const endpoint = j?.endpoint;
  const p256dh = j?.keys?.p256dh;
  const auth = j?.keys?.auth;
  if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || typeof p256dh !== 'string' || typeof auth !== 'string' || !p256dh || !auth) return null;
  return { endpoint, p256dh, auth };
};

/** Stejný veřejný klíč jako ten, se kterým je zařízení přihlášené? (po změně klíčů je potřeba přihlásit znovu) */
export const sameApplicationServerKey = (sub, keyBytes) => {
  const have = sub?.options?.applicationServerKey;
  if (!have) return true; // prohlížeč klíč neprozradí: nechá se být
  const a = new Uint8Array(have);
  if (a.length !== keyBytes.length) return false;
  return a.every((v, i) => v === keyBytes[i]);
};

/** Text pro uživatele podle výsledku zapnutí. */
export const enableMessage = (status) => ({
  enabled: t('Oznámení jsou v tomhle zařízení zapnutá.'),
  denied: t('Oznámení jsou zablokovaná. Povol je v nastavení webu (ikona vedle adresy) nebo v nastavení zařízení u prohlížeče či appky Jomarid Books a zkus to znovu.'),
  dismissed: t('Oznámení nejsou povolená. Zapneš je kdykoli později.'),
  'not-configured': t('Oznámení do zařízení teď nejsou k dispozici. Zkus to později.'),
  'no-sw': t('Appka se ještě nenačetla do offline režimu. Zkus to za chvíli, nebo stránku obnov.'),
  error: t('Oznámení se nepodařilo zapnout. Zkus to znovu.'),
}[status] || '');

/** Druhy motivačních oznámení (shodují se s db/push-notifications.sql a db/push/send-push.ts): pro ukázky v Admin → Upozornění. */
export const PUSH_KINDS = [
  { kind: 'streak_risk', label: tk('Série v ohrožení') },
  { kind: 'streak_milestone', label: tk('Milník série') },
  { kind: 'praise', label: 'Pochvala' },
  { kind: 'comeback', label: tk('Návrat po pauze') },
  { kind: 'continue_book', label: tk('Rozečtená kniha') },
  { kind: 'goal_progress', label: tk('Měsíční cíl') },
  { kind: 'coins_to_spend', label: 'Mince na knihu' },
  { kind: 'gentle_nudge', label: tk('Popostrčení') },
  { kind: 'new_book', label: tk('Nová kniha') },
];
