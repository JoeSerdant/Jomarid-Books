// Katakomby, sólo výprava (offline režim Jomarid Online Games) - dokument zobrazený v iframe (srcDoc) po tlačítku Hrát offline v menu hry.
// Převzato z původní hry (bez režimů pro dva hráče na jednom zařízení a bez vlastních balíčků). Postup se ukládá k účtu pod hrou onlinegames
// (klíče katak_best a katak_meta v localStorage, který appka nahradí svým úložištěm), o Jomarid Coiny hra jen žádá přes most v index.html.
//
//   index.html - kostra dokumentu a most pro Coiny (jomaridReward)
//   style.css  - vzhled
//   game.js    - celá hra
import shell from './katakombySolo/index.html?raw';
import css from './katakombySolo/style.css?raw';
import game from './katakombySolo/game.js?raw';

// Funkce jako náhrada (ne řetězec), aby se v kódu nevykládaly speciální sekvence jako "$&".
export const KATAKOMBY_SOLO_HTML = shell
  .replace('/*__CSS__*/', () => css)
  .replace('<!--__SCRIPTS__-->', () => `<script id="src-game">\n${game}\n</script>`);
