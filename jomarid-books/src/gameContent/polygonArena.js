// Polygon aréna - mini-hra zobrazená v iframe (srcDoc) ze Games.jsx.
//
// Dřív tu byl celý hotový dokument v jediném řetězci. Teď je hra rozdělená do čitelných souborů ve
// složce polygonArena/ a tenhle soubor je jen poskládá do jednoho HTML dokumentu (Vite je načte jako
// text přes ?raw, takže tu není žádný extra build krok):
//
//   index.html     - kostra dokumentu, most pro odměny (JOMARID-BRIDGE) a značky rozhraní
//   style.css      - vzhled
//   core.js        - pomocné funkce, uložený postup, motiv, konstanty, obtížnosti
//   classes.js     - třídy tanků 0.-3. stupně a strom vývoje
//   tier4.js       - ručně navržený 4. stupeň a pomocné úpravy tříd
//   tankgen.js     - generátor: doplní strom vývoje o další, navzájem odlišné třídy
//   ascension.js   - 5. stupeň (Vzestup), bossové, seznamy tříd
//   data.js        - výhody, bonusy, zkušenosti, tvary
//   state.js       - stav hry, výpočet statistik, výběr tříd
//   fx.js          - zvuk a efekty
//   tanks.js       - vytváření tvarů a tanků, osobnosti botů
//   sim.js         - simulace: střelba, pohyb, střely, kolize, smrt
//   ai.js          - AI botů a ovládání hráče
//   world.js       - hlavní krok, zóny, bonusy, bossové, události, zápas
//   modes.js       - herní režimy (Klasika, Týmy, Přežití, Král kopce, Poslední přeživší, Hon na bossy, Zlatá horečka, Cvičiště)
//   input.js       - vstupy
//   draw.js        - kreslení tanků, tvarů, střel a bonusů
//   render.js      - vykreslování scény, mini mapa
//   ui.js          - rozhraní, stavy hry, hlavní smyčka
//   collection.js  - sbírka a nastavení
//   main.js        - start
//
// Skripty jsou obyčejné (ne moduly) a sdílejí globální rozsah, takže pozdější soubory používají
// konstanty a funkce z dřívějších. Pořadí níže je proto důležité.
import shell from './polygonArena/index.html?raw';
import css from './polygonArena/style.css?raw';
import core from './polygonArena/core.js?raw';
import classes from './polygonArena/classes.js?raw';
import tier4 from './polygonArena/tier4.js?raw';
import tankgen from './polygonArena/tankgen.js?raw';
import ascension from './polygonArena/ascension.js?raw';
import data from './polygonArena/data.js?raw';
import state from './polygonArena/state.js?raw';
import fx from './polygonArena/fx.js?raw';
import tanks from './polygonArena/tanks.js?raw';
import sim from './polygonArena/sim.js?raw';
import ai from './polygonArena/ai.js?raw';
import world from './polygonArena/world.js?raw';
import modes from './polygonArena/modes.js?raw';
import input from './polygonArena/input.js?raw';
import draw from './polygonArena/draw.js?raw';
import render from './polygonArena/render.js?raw';
import ui from './polygonArena/ui.js?raw';
import collection from './polygonArena/collection.js?raw';
import main from './polygonArena/main.js?raw';

const SCRIPTS = [
  ['core', core],
  ['classes', classes],
  ['tier4', tier4],
  ['tankgen', tankgen],
  ['ascension', ascension],
  ['data', data],
  ['state', state],
  ['fx', fx],
  ['tanks', tanks],
  ['sim', sim],
  ['ai', ai],
  ['world', world],
  ['modes', modes],
  ['input', input],
  ['draw', draw],
  ['render', render],
  ['ui', ui],
  ['collection', collection],
  ['main', main],
]
  .map(([id, code]) => `<script id="src-${id}">\n${code}\n</script>`)
  .join('\n');

// Funkce jako náhrada (ne řetězec), aby se v kódu nevykládaly speciální sekvence jako "$&".
export const POLYGON_ARENA_HTML = shell
  .replace('/*__CSS__*/', () => css)
  .replace('<!--__SCRIPTS__-->', () => SCRIPTS);
