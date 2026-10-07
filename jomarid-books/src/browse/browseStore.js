// Zapamatování stavu procházení v úložišti prohlížeče. Úložiště může být nedostupné (anonymní okno, zakázaná data,
// plné), proto je každé čtení i zápis v try/catch a appka bez něj funguje, jen si nic nepamatuje.

import { normalizeViewMode } from './browseModel.js';
import { SORT_OPTIONS, STATUS_FILTERS, normalizeLibraryState, serializeLibraryState } from './libraryModel.js';
import { notifySettingsChanged } from '../settings/settingsEvents.js';

export const VIEW_KEY = 'jomarid.library.view'; // způsob zobrazení: trvalá volba čtenáře (localStorage)
export const SORT_PREF_KEY = 'jomarid.library.sort'; // výchozí řazení při otevření knihovny
export const STATUS_PREF_KEY = 'jomarid.library.status'; // výchozí filtr (Všechny / Moje knihy / Rozečtené / Dočtené)
export const REMEMBER_PREF_KEY = 'jomarid.library.remember'; // pamatovat si polohu a filtry po návratu ("0" = ne)
const STATE_KEY = 'jomarid.library.state'; // filtry a poloha: jen v rámci karty (sessionStorage)
export const RECENT_SEARCH_KEY = 'jomarid-search-recent'; // poslední hledané výrazy ve vyhledávacím okně (localStorage)

const local = () => { try { return window.localStorage; } catch { return null; } };
const session = () => { try { return window.sessionStorage; } catch { return null; } };

export const readViewMode = (storage = local()) => {
  try { return normalizeViewMode(storage?.getItem(VIEW_KEY)); } catch { return 'grid'; }
};

export const writeViewMode = (mode, storage = local()) => {
  try { storage?.setItem(VIEW_KEY, normalizeViewMode(mode)); } catch { /* úložiště nedostupné: volba platí jen do zavření stránky */ }
  notifySettingsChanged();
};

const SORT_KEYS = SORT_OPTIONS.map((o) => o.key);
const STATUS_KEYS = STATUS_FILTERS.map((f) => f.key);
const DEFAULT_PREFS = { view: 'grid', sort: SORT_KEYS[0], status: 'all', remember: true };

/** Výchozí chování knihovny (Nastavení -> Vzhled): pohled, řazení, filtr a zda si pamatovat polohu. Nesmysl = výchozí. */
export const readLibraryPrefs = (storage = local()) => {
  try {
    const get = (k) => storage?.getItem(k);
    const sort = get(SORT_PREF_KEY);
    const status = get(STATUS_PREF_KEY);
    return {
      view: readViewMode(storage),
      sort: SORT_KEYS.includes(sort) ? sort : DEFAULT_PREFS.sort,
      status: STATUS_KEYS.includes(status) ? status : DEFAULT_PREFS.status,
      remember: get(REMEMBER_PREF_KEY) !== '0',
    };
  } catch { return { ...DEFAULT_PREFS }; }
};

export const writeLibraryPref = (name, value, storage = local()) => {
  try {
    if (name === 'view') storage?.setItem(VIEW_KEY, normalizeViewMode(value));
    else if (name === 'sort' && SORT_KEYS.includes(value)) storage?.setItem(SORT_PREF_KEY, value);
    else if (name === 'status' && STATUS_KEYS.includes(value)) storage?.setItem(STATUS_PREF_KEY, value);
    else if (name === 'remember') storage?.setItem(REMEMBER_PREF_KEY, value ? '1' : '0');
  } catch { /* úložiště nedostupné: volba platí jen do zavření stránky */ }
  notifySettingsChanged();
};

/** Zapomene uložený stav knihovny (při odhlášení): hledaný text může být osobní a nemá zůstat v kartě. */
export const clearLibraryState = ({ storage = session() } = {}) => {
  try { storage?.removeItem(STATE_KEY); } catch { /* úložiště nedostupné: není co mazat */ }
};

/**
 * Zapomene všechno osobní, co si procházení pamatuje: stav knihovny (včetně hledaného textu) i poslední hledané
 * výrazy z vyhledávacího okna. Volá se po odhlášení, ať to další člověk na sdíleném počítači nevidí.
 */
export const clearPersonalBrowseState = ({ sessionStore = session(), localStore = local() } = {}) => {
  clearLibraryState({ storage: sessionStore });
  try { localStore?.removeItem(RECENT_SEARCH_KEY); } catch { /* úložiště nedostupné: není co mazat */ }
};

export const readLibraryState = (userId, { storage = session(), now = Date.now() } = {}) => {
  try {
    const raw = storage?.getItem(STATE_KEY);
    if (!raw) return null;
    let state = null;
    try { state = normalizeLibraryState(JSON.parse(raw), { userId, now }); } catch { state = null; }
    // Propadlý, cizí nebo rozbitý stav se rovnou smaže: nikomu už nepomůže a platnost by jinak hlídala jen čtení.
    if (!state && userId) clearLibraryState({ storage });
    return state;
  } catch { return null; }
};

export const writeLibraryState = (userId, state, { storage = session(), now = Date.now() } = {}) => {
  if (!userId) return;
  try { storage?.setItem(STATE_KEY, JSON.stringify(serializeLibraryState(userId, state, now))); } catch { /* viz výše */ }
};
