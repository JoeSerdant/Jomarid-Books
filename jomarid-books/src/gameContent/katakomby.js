// Katakomby (co-op karetní výprava pro dva, režim Jomarid Online Games) - dokument zobrazený v iframe (srcDoc) při online zápase.
//
// Hra je rozdělená do souborů ve složce katakomby/; tenhle soubor je poskládá do jednoho HTML dokumentu (Vite je načte jako text přes ?raw):
//
//   index.html - kostra dokumentu
//   style.css  - vzhled
//   core.js    - pravidla (karty, hrdinové, nepřátelé, průběh výpravy); čistá, náhoda ze semínka zápasu
//   game.js    - obrazovky, vstupy a napojení na online zápas (window.jomaridMP z appky, src/mp)
import shell from './katakomby/index.html?raw';
import css from './katakomby/style.css?raw';
import core from './katakomby/core.js?raw';
import game from './katakomby/game.js?raw';

// Funkce jako náhrada (ne řetězec), aby se v kódu nevykládaly speciální sekvence jako "$&".
export const KATAKOMBY_HTML = shell
  .replace('/*__CSS__*/', () => css)
  .replace('<!--__SCRIPTS__-->', () => `<script id="src-core">\n${core}\n</script>\n<script id="src-game">\n${game}\n</script>`);
