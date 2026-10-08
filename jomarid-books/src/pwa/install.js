// Instalace appky (PWA) v prohlížeči: zachytí instalační okno prohlížeče (beforeinstallprompt), sleduje, zda appka běží
// jako nainstalovaná, a nabízí to Nastavení. Registruje se co nejdřív po startu, protože prohlížeč událost pošle jen jednou.
import { useSyncExternalStore } from 'react';
import { installState, sameInstallState } from './installModel.js';

let deferred = null;
let snapshot = installState();
const listeners = new Set();

const isStandalone = () => {
  try { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; } catch { return false; }
};
const recompute = () => {
  const next = installState({ standalone: isStandalone(), deferredPrompt: !!deferred, nav: window.navigator });
  if (!sameInstallState(snapshot, next)) { snapshot = next; listeners.forEach((l) => l()); }
};

let started = false;
export const initInstall = () => {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; recompute(); });
  window.addEventListener('appinstalled', () => { deferred = null; recompute(); });
  try { window.matchMedia('(display-mode: standalone)').addEventListener('change', recompute); } catch { /* starší prohlížeč */ }
  recompute();
};

/** Ukáže instalační okno prohlížeče. Vrací 'accepted' | 'dismissed' | 'unavailable'. */
export const promptInstall = async () => {
  const e = deferred;
  if (!e) return 'unavailable';
  deferred = null; // okno jde použít jen jednou
  recompute();
  try {
    await e.prompt();
    const choice = await e.userChoice;
    return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch { return 'dismissed'; }
};

export const useInstallState = () => useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => snapshot, () => snapshot);
