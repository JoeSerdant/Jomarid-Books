// Nastavení vázané na účet. Všechno, co si čtenář v appce nastavil (motiv, velikost, čtečka, výchozí chování knihovny),
// je dál uložené hned v zařízení (localStorage, aby se použilo bez bliknutí), a navíc se kopíruje do tabulky
// user_settings (jeden řádek na účet). Po přihlášení se nastavení z účtu stáhne, a když je novější než v zařízení,
// použije se. Chybějící tabulka nebo výpadek nic nerozbije: nastavení pak platí jen v zařízení.
//
// Čistá logika je tady a jde testovat v Node (src/tests/settings.test.mjs); React je jen v SettingsSyncRunner.jsx.

import {
  ACCENT_KEY, CUSTOM_THEME_STORAGE, MOTION_KEY, READER_STORAGE, THEME_KEY, UI_DENSITY_KEY, UI_SCALE_KEY,
  completeHex, saveCustomColors,
} from '../theme.js';
import { REMEMBER_PREF_KEY, SORT_PREF_KEY, STATUS_PREF_KEY, VIEW_KEY } from '../browse/browseStore.js';
import { notifySettingsApplied } from './settingsEvents.js';

const SEARCH_PREFS_KEY = 'jomarid-search-prefs'; // filtry vyhledávacího okna (stejný klíč jako v SearchModal.jsx)
const META_KEY = 'jomarid-settings-sync'; // {userId, serverAt, dirty}: co z účtu se naposledy použilo a zda je co odeslat
export const SETTINGS_TABLE = 'user_settings';
export const SETTINGS_VERSION = 1;
const MAX_VALUE_LENGTH = 2000;

/** Klíče localStorage, které se synchronizují. Odvozené kopie (barvy motivu pro index.html) se po stažení dopočítají. */
export const SYNC_KEYS = [
  THEME_KEY, CUSTOM_THEME_STORAGE, ACCENT_KEY, UI_SCALE_KEY, UI_DENSITY_KEY, MOTION_KEY,
  ...Object.values(READER_STORAGE),
  VIEW_KEY, SORT_PREF_KEY, STATUS_PREF_KEY, REMEMBER_PREF_KEY, SEARCH_PREFS_KEY,
];

const defaultStorage = () => { try { return globalThis.localStorage; } catch { return null; } };
const validValue = (v) => typeof v === 'string' && v !== '' && v.length <= MAX_VALUE_LENGTH;

/** Snímek aktuálního nastavení ze zařízení: jen známé klíče s neprázdnou hodnotou (chybějící klíč = výchozí). */
export const collectSettings = (storage = defaultStorage()) => {
  const items = {};
  for (const key of SYNC_KEYS) {
    try {
      const v = storage?.getItem(key);
      if (validValue(v)) items[key] = v;
    } catch { /* nečitelný klíč se přeskočí */ }
  }
  return { v: SETTINGS_VERSION, items };
};

/** Nastavení z účtu je cizí vstup: bere se jen známé klíče s textovou hodnotou rozumné délky; jinak null. */
export const sanitizeRemote = (data) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (typeof data.v !== 'number' || data.v > SETTINGS_VERSION) return null; // novější verze, které tahle appka nerozumí
  if (!data.items || typeof data.items !== 'object' || Array.isArray(data.items)) return null;
  const items = {};
  for (const key of SYNC_KEYS) if (Object.prototype.hasOwnProperty.call(data.items, key) && validValue(data.items[key])) items[key] = data.items[key];
  return { v: data.v, items };
};

/** Zapíše nastavení z účtu do zařízení (klíče, které v něm chybí, se vrátí na výchozí). Vrací, zda se něco použilo. */
export const applySettings = (data, storage = defaultStorage()) => {
  const clean = sanitizeRemote(data);
  if (!clean || !storage) return false;
  for (const key of SYNC_KEYS) {
    try {
      if (key === CUSTOM_THEME_STORAGE) continue; // vlastní barvy se zapisují níž, i s kopií pro index.html
      if (key in clean.items) storage.setItem(key, clean.items[key]); else storage.removeItem(key);
    } catch { /* plné nebo zablokované úložiště */ }
  }
  let custom = null;
  try { custom = JSON.parse(clean.items[CUSTOM_THEME_STORAGE]); } catch { /* chybí nebo je rozbité */ }
  if (custom && completeHex(custom.bg) && completeHex(custom.accent)) saveCustomColors({ bg: custom.bg, accent: custom.accent });
  else { try { storage.removeItem(CUSTOM_THEME_STORAGE); } catch { /* nevadí */ } }
  return true;
};

/**
 * Co po přihlášení udělat: 'pull' (použít nastavení z účtu), 'push' (poslat do účtu to z zařízení) nebo 'none'.
 * meta je záznam o poslední synchronizaci v tomhle zařízení, remote řádek z účtu nebo null.
 */
export const decideSync = ({ meta, userId, remote, local }) => {
  const hasLocal = Object.keys(local?.items || {}).length > 0;
  const remoteUsable = !!remote && Object.keys(sanitizeRemote(remote.data)?.items || {}).length > 0;
  const mine = !!meta && meta.userId === userId;
  if (mine && meta.dirty) return hasLocal ? 'push' : 'none'; // neodeslané změny z tohoto zařízení vyhrávají
  if (!remoteUsable) return hasLocal ? 'push' : 'none'; // účet zatím nic nemá: první nahrání ze zařízení
  if (mine && meta.serverAt === remote.updated_at) return 'none'; // už je použité
  return 'pull'; // nové zařízení nebo změna z jiného zařízení
};

/** Chybějící tabulka (backend ještě není nachystaný) není porucha: synchronizace se jen vypne. */
export const isMissingTable = (error) => {
  if (!error) return false;
  const code = String(error.code || '');
  return code === 'PGRST205' || code === '42P01' || Number(error.status) === 404 || /could not find the table|relation .* does not exist/i.test(String(error.message || ''));
};

const readMeta = (storage) => { try { const m = JSON.parse(storage?.getItem(META_KEY)); return m && typeof m === 'object' ? m : null; } catch { return null; } };
const writeMeta = (storage, meta) => { try { storage?.setItem(META_KEY, JSON.stringify(meta)); } catch { /* nevadí */ } };
export const clearSyncMeta = (storage = defaultStorage()) => { try { storage?.removeItem(META_KEY); } catch { /* nevadí */ } };

/**
 * Řadič synchronizace. status: 'off' (nepřihlášený) | 'syncing' | 'synced' | 'unavailable' (chybí tabulka) | 'error'.
 * Změny ze zařízení se odesílají s prodlevou (debounceMs), ať se při tahání posuvníku neposílá každé políčko zvlášť.
 */
export const createSettingsSync = ({
  client, storage = defaultStorage(), debounceMs = 1500, setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) => {
  let userId = null;
  let timer = null;
  let applying = false;
  let disabled = false;
  let version = 0; // počítadlo místních změn (poznat, že se něco změnilo za běhu odesílání)
  let status = 'off';
  const listeners = new Set();
  const setStatus = (s) => { if (s !== status) { status = s; listeners.forEach((l) => l()); } };

  const fail = (error) => {
    if (isMissingTable(error)) { disabled = true; setStatus('unavailable'); } else setStatus('error');
  };

  const push = async () => {
    const uid = userId;
    if (!uid || disabled) return;
    cancelTimer();
    setStatus('syncing');
    const sent = version;
    let res;
    try {
      res = await client.from(SETTINGS_TABLE).upsert({ user_id: uid, data: collectSettings(storage) }, { onConflict: 'user_id' }).select('updated_at').single();
    } catch (e) { res = { error: e }; }
    if (uid !== userId) return; // mezitím se přihlásil někdo jiný
    if (res.error) { fail(res.error); return; }
    const changedMeanwhile = version !== sent;
    writeMeta(storage, { userId: uid, serverAt: res.data?.updated_at ?? null, dirty: changedMeanwhile });
    if (changedMeanwhile) schedule(); else setStatus('synced');
  };

  function cancelTimer() { if (timer !== null) { clearTimer(timer); timer = null; } }
  function schedule() { cancelTimer(); timer = setTimer(() => { timer = null; push(); }, debounceMs); }

  return {
    get status() { return status; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /** Po přihlášení: stáhnout, rozhodnout kdo je novější, použít nebo nahrát. */
    async start(uid) {
      userId = uid; disabled = false; applying = false; cancelTimer();
      if (!uid) { setStatus('off'); return; }
      setStatus('syncing');
      let res;
      try { res = await client.from(SETTINGS_TABLE).select('data, updated_at').eq('user_id', uid).maybeSingle(); } catch (e) { res = { error: e }; }
      if (uid !== userId) return;
      if (res.error) { fail(res.error); return; }
      const remote = res.data || null;
      const action = decideSync({ meta: readMeta(storage), userId: uid, remote, local: collectSettings(storage) });
      if (action === 'pull') {
        applying = true;
        try { applySettings(remote.data, storage); } finally { applying = false; }
        writeMeta(storage, { userId: uid, serverAt: remote.updated_at, dirty: false });
        notifySettingsApplied();
        setStatus('synced');
      } else if (action === 'push') {
        await push();
      } else {
        writeMeta(storage, { userId: uid, serverAt: remote?.updated_at ?? null, dirty: false });
        setStatus('synced');
      }
    },

    /** Po odhlášení: čeká se na dalšího uživatele, nastavení v zařízení zůstává. */
    stop() { userId = null; cancelTimer(); setStatus('off'); },

    /** Zapisující funkce ohlásila změnu nastavení v zařízení. */
    changed() {
      if (applying || !userId || disabled) return;
      version += 1;
      const m = readMeta(storage);
      writeMeta(storage, { userId, serverAt: m && m.userId === userId ? m.serverAt : null, dirty: true });
      schedule();
    },

    /** Odeslat hned (skrytí karty, obnovení připojení), pokud je co odesílat. */
    async flush() {
      const m = readMeta(storage);
      if (userId && !disabled && m && m.userId === userId && m.dirty) await push();
    },
  };
};
