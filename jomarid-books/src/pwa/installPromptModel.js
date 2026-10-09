// Kdy nabídnout instalaci appky na úvodní stránce: čistá logika bez prohlížeče (testy: src/tests/pwa.test.mjs).
// Okno se ukáže jen tomu, kdo appku nemá a kdo ji může nainstalovat (prohlížeč nabízí instalační okno, nebo je to iPhone
// či iPad s ručním postupem). Po „Teď ne“ se chvíli neukazuje, po opakovaném odmítnutí ještě déle.

export const INSTALL_DISMISS_KEY = 'jomarid-install-prompt';
const DAY = 24 * 60 * 60 * 1000;
export const FIRST_PAUSE_DAYS = 7;
export const LATER_PAUSE_DAYS = 30;

const defaultStorage = () => { try { return globalThis.localStorage; } catch { return null; } };

/** Uložené odmítnutí: { count, at } (počet odmítnutí a čas posledního); poškozená hodnota se bere jako žádné. */
export const readDismissals = (storage = defaultStorage()) => {
  try {
    const o = JSON.parse(storage?.getItem(INSTALL_DISMISS_KEY));
    const count = Number(o?.count);
    const at = Number(o?.at);
    if (o && Number.isFinite(count) && count > 0 && Number.isFinite(at) && at > 0) return { count: Math.floor(count), at };
  } catch { /* nečitelné úložiště nebo hodnota */ }
  return { count: 0, at: 0 };
};

export const recordDismissal = (storage = defaultStorage(), now = Date.now()) => {
  const prev = readDismissals(storage);
  try { storage?.setItem(INSTALL_DISMISS_KEY, JSON.stringify({ count: prev.count + 1, at: now })); } catch { /* nevadí */ }
};

/** Dokdy se po odmítnutí nenabízí: po prvním 7 dní, po dalších 30. Bez odmítnutí hned. */
export const nextOfferAt = ({ count, at }) => (count <= 0 ? 0 : at + (count === 1 ? FIRST_PAUSE_DAYS : LATER_PAUSE_DAYS) * DAY);

/** Má se teď ukázat vyskakovací okno? state je výsledek installState(); trvalá zmínka na stránce se řídí jen stavem instalace. */
export const shouldShowInstallPopup = ({ state, dismissals, now = Date.now() }) =>
  !!state && !state.installed && (state.canPrompt || state.ios) && now >= nextOfferAt(dismissals || { count: 0, at: 0 });
