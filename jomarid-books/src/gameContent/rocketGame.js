// Jomarid Rocket Game - mini-hra zobrazená v iframe (srcDoc) ze Games.jsx.
//
// Hra je jeden HTML dokument v rocket/index.html (styl, kostra, most pro odměny JOMARID-BRIDGE a skript v jednom souboru).
// Vite ho načte jako text přes ?raw, takže tu není žádný extra build krok.
import html from './rocket/index.html?raw';

export const ROCKET_GAME_HTML = html;
