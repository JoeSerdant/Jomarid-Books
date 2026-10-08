// Service worker (offline obal appky). Registruje se jen v produkční verzi a jen tam, kde to prohlížeč umí; selhání
// registrace appku nijak neovlivní.

const supported = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator;

export const registerServiceWorker = () => {
  if (!supported() || !import.meta.env.PROD) return;
  const register = () => navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('Service worker se nepodařilo zaregistrovat:', e?.message || e));
  if (document.readyState === 'complete') register(); else window.addEventListener('load', register, { once: true });
};

/** Splní se, až je offline kopie obalu appky připravená (service worker je aktivní); bez service workeru nikdy. */
export const whenOfflineReady = () => (supported() ? navigator.serviceWorker.ready.then(() => true, () => false) : Promise.resolve(false));

/**
 * Smaže offline kopii a odregistruje service worker; pak appka načte nejnovější verzi (pomoc, kdyby se zasekla stará).
 * Nejdřív ověří, že se nová kopie dá stáhnout: bez připojení by smazání jen odebralo funkční offline kopii a vedlo na
 * chybovou stránku prohlížeče. Vrací 'offline' (nic se nesmazalo) nebo 'reloading'.
 */
export const resetApp = async () => {
  const reachable = await fetch('/', { cache: 'no-store' }).then((r) => r.ok, () => false);
  if (!reachable) return 'offline';
  try {
    if (supported()) { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map((r) => r.unregister())); }
    if (typeof caches !== 'undefined') { const names = await caches.keys(); await Promise.all(names.filter((n) => n.startsWith('jomarid-')).map((n) => caches.delete(n))); }
  } catch { /* nevadí, stránka se i tak obnoví */ }
  window.location.reload();
  return 'reloading';
};
