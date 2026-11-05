// Jazyk appky: čeština (výchozí) a angličtina. Čistá logika bez Reactu, ať jde zkoušet v Node (src/tests/i18n.test.mjs).
//
// Klíčem překladu je původní české znění: t('Uložit') vrátí česky 'Uložit', anglicky text ze slovníku (src/i18n/en/*.js).
// Chybí-li v slovníku, zůstane česky, takže nepřeložené místo je vidět a nic nespadne. Kód tedy zůstává čitelný
// (nevymýšlejí se názvy klíčů) a kontrola úplnosti je v testu: každý literál v t(...) musí mít anglický záznam.
//
//   t('Máš {n} knih', { n })          dosazení parametrů {název}
//   t.p(n, 'kniha', 'knihy', 'knih')  tvary podle počtu: česky 1 / 2-4 / 5+, anglicky ze slovníku ['book', 'books'] pod klíčem 'kniha|knihy|knih'
//   tk('Knihovna')                    značka pro texty v konstantách na úrovni modulu: vrátí text beze změny a v testu ho
//                                     zapíše mezi známé klíče; přeložit se musí až při vykreslení: t(polozka.label)
//
// Komponenty používají jednu společnou funkci t. Při přepnutí jazyka se obsah appky vykreslí znovu od začátku (App.jsx, key={lang}),
// takže se nemusí hlídat žádné závislosti ani zapamatované hodnoty. t se proto nikdy nevolá na úrovni modulu (běžela by před
// načtením jazyka): tam patří tk.
import { plural } from '../lib/plural.js';
import { tk } from './mark.js';
import { notifySettingsChanged, SETTINGS_APPLIED } from '../settings/settingsEvents.js';

export const LANG_KEY = 'jomarid-lang';
export const LANGS = ['cs', 'en'];
export const DEFAULT_LANG = 'cs';
export const LOCALES = { cs: 'cs-CZ', en: 'en-GB' };

export const normalizeLang = (v) => (v === 'en' ? 'en' : DEFAULT_LANG);

let current = DEFAULT_LANG;
let dict = null; // anglický slovník { 'Česky': 'English', 'kniha|knihy|knih': ['book', 'books'] }
const listeners = new Set();

export const getLang = () => current;
export const getLocale = () => LOCALES[current];
export const isEnglish = () => current === 'en';
export const subscribe = (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const emit = () => { for (const fn of [...listeners]) { try { fn(); } catch { /* poslouchající nesmí shodit ostatní */ } } };

/** Dosadí {název} z parametrů; neznámé nebo prázdné zůstane jak je (viditelná chyba místo „undefined“). */
export const interpolate = (text, params) => {
  if (!params) return text;
  return String(text).replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(params, k) && params[k] !== undefined && params[k] !== null ? String(params[k]) : m));
};

const lookup = (lang, cs) => {
  if (lang !== 'en' || !dict) return cs;
  const v = Object.prototype.hasOwnProperty.call(dict, cs) ? dict[cs] : undefined;
  return typeof v === 'string' ? v : cs;
};

/** Překlad do zadaného jazyka (čistá funkce, vhodná pro testy). */
export const translateIn = (lang, cs, params) => interpolate(lookup(lang, cs), params);

/** Tvary podle počtu. Česky pravidlo 1 / 2-4 / 5 a víc; anglicky pole [jednotné, množné] pod klíčem 'one|few|many'. */
export const pluralIn = (lang, n, one, few, many, params) => {
  let text = plural(n, one, few, many);
  if (lang === 'en' && dict) {
    const v = Object.prototype.hasOwnProperty.call(dict, `${one}|${few}|${many}`) ? dict[`${one}|${few}|${many}`] : undefined;
    if (Array.isArray(v) && v.length === 2) text = Math.abs(Number(n) || 0) === 1 ? v[0] : v[1];
  }
  return interpolate(text, params);
};

export const t = (cs, params) => translateIn(current, cs, params);
t.p = (n, one, few, many, params) => pluralIn(current, n, one, few, many, params);
export { tk };

// ---- úložiště ----
const defaultStorage = () => { try { return globalThis.localStorage; } catch { return null; } };
export const readStoredLang = (storage = defaultStorage()) => { try { return normalizeLang(storage?.getItem(LANG_KEY)); } catch { return DEFAULT_LANG; } };
export const storeLang = (lang, storage = defaultStorage()) => { try { storage?.setItem(LANG_KEY, normalizeLang(lang)); return true; } catch { return false; } };

const applyDocumentLang = (lang) => { try { if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = lang; } catch { /* mimo prohlížeč */ } };

// ---- slovník ----
export const setDictionary = (d) => { dict = d && typeof d === 'object' ? d : null; };
export const hasDictionary = () => dict !== null;
let loading = null;
/** Stáhne anglický slovník (až při prvním použití angličtiny, ať ho čeští čtenáři nestahují). Vrací, zda je k dispozici. */
export const loadEnglish = () => {
  if (dict) return Promise.resolve(true);
  if (!loading) {
    loading = import('./en/index.js')
      .then((m) => { setDictionary(m.default); return true; })
      .catch(() => false)
      .finally(() => { loading = null; });
  }
  return loading;
};

/** Přepne jazyk bez ukládání (po úspěšném stažení slovníku). Vrací, zda se jazyk změnil. */
export const setLang = (lang) => {
  const next = normalizeLang(lang);
  if (next === 'en' && !dict) return false; // bez slovníku by se jen přepnul štítek a text zůstal česky
  if (next === current) { applyDocumentLang(current); return false; }
  current = next;
  applyDocumentLang(current);
  emit();
  return true;
};

/** Přepnutí z ovládacího prvku: stáhne slovník, přepne, uloží a ohlásí změnu nastavení (synchronizace s účtem). */
export const switchLang = async (lang, storage = defaultStorage()) => {
  const next = normalizeLang(lang);
  if (next === 'en' && !(await loadEnglish())) return false; // bez připojení se zůstane u češtiny
  setLang(next);
  storeLang(next, storage);
  notifySettingsChanged();
  return true;
};

/** Spuštění appky: načte uložený jazyk (a podle potřeby slovník) dřív, než se vykreslí první obrazovka. */
export const initLang = async (storage = defaultStorage()) => {
  const stored = readStoredLang(storage);
  if (stored === 'en') await loadEnglish();
  setLang(stored === 'en' && dict ? 'en' : DEFAULT_LANG);
  applyDocumentLang(current);
  // Nastavení stažené z účtu může jazyk změnit: přečte se znovu.
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener(SETTINGS_APPLIED, async () => {
      const s = readStoredLang(storage);
      if (s === 'en') await loadEnglish();
      setLang(s === 'en' && dict ? 'en' : DEFAULT_LANG);
    });
  }
  return current;
};

// ---- formátování podle jazyka ----
export const formatNumber = (n, options) => Number(n || 0).toLocaleString(getLocale(), options);
export const formatDate = (value, options) => new Date(value).toLocaleDateString(getLocale(), options);
export const formatDateTime = (value, options) => new Date(value).toLocaleString(getLocale(), options);

/** Pro testy: vrátí stav na výchozí (čeština, bez slovníku, bez posluchačů). */
export const resetForTests = () => { current = DEFAULT_LANG; dict = null; listeners.clear(); loading = null; };
