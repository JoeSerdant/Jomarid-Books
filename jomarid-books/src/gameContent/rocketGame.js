// Jomarid Rocket Game - mini-hra zobrazená v iframe (srcDoc) ze Games.jsx.
//
// Hra je jeden HTML dokument v rocket/index.html (styl, kostra, most pro odměny JOMARID-BRIDGE a skript v jednom souboru).
// Vite ho načte jako text přes ?raw, takže tu není žádný extra build krok; mp.js je online hra pro dva (spolupráce a souboj raket),
// který bez rozhraní window.jomaridMP z appky nedělá nic. net.js je společný základ sdíleného světa (shared/net.js): ve spolupráci počítá bojiště hostitel.
import html from './rocket/index.html?raw';
import mp from './rocket/mp.js?raw';
import net from './shared/net.js?raw';

// Funkce jako náhrada (ne řetězec), aby se v kódu nevykládaly speciální sekvence jako "$&".
export const ROCKET_GAME_HTML = html.replace('<!--__MP__-->', () => `<script id="src-net">\n${net}\n</script>\n<script id="src-mp">\n${mp}\n</script>`);
