// Oznámení do zařízení (Web Push): čistá logika bez prohlížeče, jde testovat v Node (src/tests/push.test.mjs).
import { isIosDevice } from '../pwa/installModel.js';

export const VAPID_SETTINGS_KEY = 'push_vapid_public'; // site_settings: { key: "<veřejný klíč VAPID>" }

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
  enabled: 'Oznámení jsou v tomhle zařízení zapnutá.',
  denied: 'Oznámení jsou v prohlížeči zablokovaná. Povol je v nastavení webu (ikona vedle adresy) a zkus to znovu.',
  dismissed: 'Oznámení nejsou povolená. Zapneš je kdykoli později.',
  'not-configured': 'Oznámení do zařízení se zapnou po nastavení serveru (to dělá správce).',
  'no-sw': 'Appka se ještě nenačetla do offline režimu. Zkus to za chvíli, nebo stránku obnov.',
  error: 'Oznámení se nepodařilo zapnout. Zkus to znovu.',
}[status] || '');
