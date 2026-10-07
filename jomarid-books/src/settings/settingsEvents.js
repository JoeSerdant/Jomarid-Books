// Události kolem nastavení. Zapisující funkce (motiv, čtečka, knihovna ...) ohlásí změnu, synchronizace s účtem ji
// zachytí a uloží; po stažení nastavení z účtu se ohlásí, že se použilo nové, a appka si je znovu přečte.
export const SETTINGS_CHANGED = 'jomarid-settings-changed';
export const SETTINGS_APPLIED = 'jomarid-settings-applied';

const emit = (name) => { try { window.dispatchEvent(new Event(name)); } catch { /* mimo prohlížeč */ } };
export const notifySettingsChanged = () => emit(SETTINGS_CHANGED);
export const notifySettingsApplied = () => emit(SETTINGS_APPLIED);
