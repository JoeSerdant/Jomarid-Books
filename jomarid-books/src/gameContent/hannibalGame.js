// Hannibal: Barca - taktická kampaň druhé punské války zobrazená v iframe (srcDoc) ze Games.jsx.
//
// Hra je jeden HTML dokument v hannibal/index.html (styl, kostra, most pro odměny JOMARID-BRIDGE a skript v jednom souboru).
// Vite ho načte jako text přes ?raw, takže tu není žádný extra build krok.
import html from './hannibal/index.html?raw';

export const HANNIBAL_HTML = html;
