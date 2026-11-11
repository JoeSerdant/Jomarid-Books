// Chaos Aréna (co-op akční aréna pro dva, režim Jomarid Online Games) - dokument zobrazený v iframe (srcDoc) při online zápase.
//
// Hra je rozdělená do souborů ve složce chaosArena/; tenhle soubor je poskládá do jednoho HTML dokumentu (Vite je načte jako text přes ?raw):
//
//   index.html - kostra dokumentu (plátno, výběr třídy, dotykové ovládání)
//   style.css  - vzhled
//   sim.js     - simulace hry (vlny, nepřátelé, třídy, střely); počítá ji jen hostitel zápasu
//   render.js  - vykreslení na plátno
//   mp.js      - online zápas: výběr třídy, síť (hostitel počítá svět, host dostává obraz a posílá vstupy), ovládání, konec a hlášení výsledku
// Před mp.js se vkládá společný základ pro sdílený svět (shared/net.js).
import shell from './chaosArena/index.html?raw';
import css from './chaosArena/style.css?raw';
import net from './shared/net.js?raw';
import sim from './chaosArena/sim.js?raw';
import render from './chaosArena/render.js?raw';
import mp from './chaosArena/mp.js?raw';

// Funkce jako náhrada (ne řetězec), aby se v kódu nevykládaly speciální sekvence jako "$&".
export const CHAOS_ARENA_HTML = shell
  .replace('/*__CSS__*/', () => css)
  .replace('<!--__SCRIPTS__-->', () => `<script id="src-net">\n${net}\n</script>\n<script id="src-sim">\n${sim}\n</script>\n<script id="src-render">\n${render}\n</script>\n<script id="src-mp">\n${mp}\n</script>`);
