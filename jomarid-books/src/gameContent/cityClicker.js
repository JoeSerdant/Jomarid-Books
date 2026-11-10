// City Clicker - mini-hra zobrazená v iframe (srcDoc) ze Games.jsx.
// Celá hra je jeden HTML dokument ve složce cityClicker/ (Vite ho načte jako text přes ?raw, takže tu není žádný extra build krok);
// mp.js je online závod ve dvou (multiplayer), který bez rozhraní window.jomaridMP z appky nedělá nic.
import html from './cityClicker/index.html?raw';
import mp from './cityClicker/mp.js?raw';

// Funkce jako náhrada (ne řetězec), aby se v kódu nevykládaly speciální sekvence jako "$&".
export const CITY_CLICKER_HTML = html.replace('<!--__MP__-->', () => `<script id="src-mp">\n${mp}\n</script>`);
