// Kouloví Kámoši - mini-hra zobrazená v iframe (srcDoc) ze Games.jsx.
//
// Hra je rozdělená do souborů ve složce koulovi/; tenhle soubor je poskládá do jednoho HTML dokumentu
// (Vite je načte jako text přes ?raw, takže tu není žádný extra build krok):
//
//   index.html - kostra dokumentu, most pro odměny (JOMARID-BRIDGE) a značky rozhraní
//   style.css  - vzhled
//   game.js    - hra (fyzika měkkých koulí, režimy, obchod, uložený postup)
import shell from './koulovi/index.html?raw';
import css from './koulovi/style.css?raw';
import game from './koulovi/game.js?raw';

// Funkce jako náhrada (ne řetězec), aby se v kódu nevykládaly speciální sekvence jako "$&".
export const KOULOVI_HTML = shell
  .replace('/*__CSS__*/', () => css)
  .replace('<!--__SCRIPTS__-->', () => `<script id="src-game">\n${game}\n</script>`);
