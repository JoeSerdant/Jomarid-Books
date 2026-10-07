// Zapamatování stavu procházení v úložišti prohlížeče. Úložiště může být nedostupné (anonymní okno, zakázaná data,
// plné), proto je každé čtení i zápis v try/catch a appka bez něj funguje, jen si nic nepamatuje.

import { normalizeViewMode } from './browseModel.js';
import { normalizeLibraryState, serializeLibraryState } from './libraryModel.js';

const VIEW_KEY = 'jomarid.library.view'; // způsob zobrazení: trvalá volba čtenáře (localStorage)
const STATE_KEY = 'jomarid.library.state'; // filtry a poloha: jen v rámci karty (sessionStorage)

const local = () => { try { return window.localStorage; } catch { return null; } };
const session = () => { try { return window.sessionStorage; } catch { return null; } };

export const readViewMode = (storage = local()) => {
  try { return normalizeViewMode(storage?.getItem(VIEW_KEY)); } catch { return 'grid'; }
};

export const writeViewMode = (mode, storage = local()) => {
  try { storage?.setItem(VIEW_KEY, normalizeViewMode(mode)); } catch { /* úložiště nedostupné: volba platí jen do zavření stránky */ }
};

export const readLibraryState = (userId, { storage = session(), now = Date.now() } = {}) => {
  try {
    const raw = storage?.getItem(STATE_KEY);
    return raw ? normalizeLibraryState(JSON.parse(raw), { userId, now }) : null;
  } catch { return null; }
};

export const writeLibraryState = (userId, state, { storage = session(), now = Date.now() } = {}) => {
  if (!userId) return;
  try { storage?.setItem(STATE_KEY, JSON.stringify(serializeLibraryState(userId, state, now))); } catch { /* viz výše */ }
};
