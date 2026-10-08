// Instalace appky (PWA): čistá logika bez prohlížeče, jde testovat v Node (src/tests/pwa.test.mjs).

/** iPhone, iPad a iPod (i iPad, který se hlásí jako Mac): Safari tam nemá instalační okno, jen ruční "Přidat na plochu". */
export const isIosDevice = (nav = {}) => /iphone|ipad|ipod/i.test(nav.userAgent || '') || (nav.platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1);

/**
 * Stav instalace pro Nastavení: installed (appka už běží jako nainstalovaná), canPrompt (prohlížeč nabízí instalační
 * okno), ios (je třeba ruční postup přes Sdílet). Kdo appku už má, žádnou nabídku instalace nevidí.
 */
export const installState = ({ standalone = false, deferredPrompt = false, nav = {} } = {}) => ({
  installed: !!standalone,
  canPrompt: !standalone && !!deferredPrompt,
  ios: !standalone && isIosDevice(nav),
});

export const sameInstallState = (a, b) => !!a && !!b && a.installed === b.installed && a.canPrompt === b.canPrompt && a.ios === b.ios;
