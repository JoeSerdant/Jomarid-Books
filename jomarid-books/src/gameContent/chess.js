// Chess League - mini-hra zobrazená v iframe (srcDoc) ze Games.jsx.
//
// Dřív tu byl celý hotový dokument v jediném řetězci. Teď je hra rozdělená do čitelných souborů ve
// složce chess/ a tenhle soubor je jen poskládá do jednoho HTML dokumentu (Vite je načte jako text
// přes ?raw, takže tu není žádný extra build krok):
//
//   index.html  - kostra dokumentu + most pro odměny (JOMARID-BRIDGE)
//   style.css   - vzhled
//   rules.js    - šachová pravidla pro rozhraní (legální tahy, mat/pat, SAN)
//   search.js   - rychlý engine pro boty a rozbor (běží i jako Web Worker, proto je celý v jednom souboru)
//   book.js     - kniha zahájení a české názvy zahájení
//   league.js   - Elo, XP, ligy, výzvy, uložený postup
//   bots.js     - soupeři: síla, osobnost, hlášky, tempo, vzdávání, remízy
//   session.js  - řadič jedné partie (hodiny, tah bota, nápověda, uložení)
//   ui.js       - React rozhraní
//
// Pořadí skriptů je důležité: pozdější soubory používají globální konstanty z dřívějších.
import shell from './chess/index.html?raw';
import css from './chess/style.css?raw';
import rules from './chess/rules.js?raw';
import search from './chess/search.js?raw';
import book from './chess/book.js?raw';
import league from './chess/league.js?raw';
import bots from './chess/bots.js?raw';
import session from './chess/session.js?raw';
import ui from './chess/ui.js?raw';

const SCRIPTS = [
  ['rules', rules],
  ['search', search], // id "src-search": z jeho textu si UI vyrobí Web Worker
  ['book', book],
  ['league', league],
  ['bots', bots],
  ['session', session],
  ['ui', ui],
]
  .map(([id, code]) => `<script id="src-${id}">\n${code}\n</script>`)
  .join('\n');

// Funkce jako náhrada (ne řetězec), aby se v kódu nevykládaly speciální sekvence jako "$&".
export const CHESS_HTML = shell
  .replace('/*__CSS__*/', () => css)
  .replace('<!--__SCRIPTS__-->', () => SCRIPTS);
