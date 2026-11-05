// React vrstva překladů. Jazyk je jeden společný stav (core.js). Při přepnutí se obsah appky vykreslí znovu (App.jsx, key={lang}),
// takže běžná komponenta jen volá t(...). Hook useLang je pro to, co potřebuje znát aktuální jazyk (přepínače, App).
import { createElement, Fragment, useSyncExternalStore } from 'react';
import { DEFAULT_LANG, getLang, subscribe, switchLang, t as translate } from './core.js';

const serverLang = () => DEFAULT_LANG;

/** Jako t, jen parametry smí být i prvky Reactu: tx('Klepni na {tlacitko} v liště.', { tlacitko: <b>Sdílet</b> }). Vrací pole, které se vloží přímo do JSX. */
export const tx = (cs, params = {}) => translate(cs).split(/(\{\w+\})/g).map((part, i) => {
  const m = /^\{(\w+)\}$/.exec(part);
  return createElement(Fragment, { key: i }, m && Object.prototype.hasOwnProperty.call(params, m[1]) ? params[m[1]] : part);
});

/** Aktuální jazyk a funkce na jeho přepnutí (stáhne slovník, uloží volbu a ohlásí změnu nastavení). */
export const useLang = () => {
  const lang = useSyncExternalStore(subscribe, getLang, serverLang);
  return { lang, setLang: switchLang };
};
