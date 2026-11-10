// Warroom: Frontlines - mini-hra zobrazená v iframe (srcDoc) ze Games.jsx.
// Celá hra je jeden HTML dokument ve složce warroom/ (Vite ho načte jako text přes ?raw, takže tu není žádný extra build krok);
// mp.js je online souboj velitelů (multiplayer), který bez rozhraní window.jomaridMP z appky nedělá nic.
import html from './warroom/index.html?raw';
import mp from './warroom/mp.js?raw';

// Funkce jako náhrada (ne řetězec), aby se v kódu nevykládaly speciální sekvence jako "$&".
export const WARROOM_HTML = html.replace('<!--__MP__-->', () => `<script id="src-mp">\n${mp}\n</script>`);
