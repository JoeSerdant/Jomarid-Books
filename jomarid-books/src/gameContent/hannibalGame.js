// Hannibal: Barca - taktická kampaň druhé punské války zobrazená v iframe (srcDoc) ze Games.jsx.
//
// Hra je jeden HTML dokument v hannibal/index.html (styl, kostra, most pro odměny JOMARID-BRIDGE a skript v jednom souboru).
// Vite ho načte jako text přes ?raw, takže tu není žádný extra build krok; mp.js je online souboj armád (multiplayer),
// který bez rozhraní window.jomaridMP z appky nedělá nic.
import html from './hannibal/index.html?raw';
import mp from './hannibal/mp.js?raw';

// Funkce jako náhrada (ne řetězec), aby se v kódu nevykládaly speciální sekvence jako "$&".
export const HANNIBAL_HTML = html.replace('<!--__MP__-->', () => `<script id="src-mp">\n${mp}\n</script>`);
