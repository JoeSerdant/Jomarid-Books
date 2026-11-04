// City Clicker - mini-hra zobrazená v iframe (srcDoc) ze Games.jsx.
// Celá hra je jeden HTML dokument ve složce cityClicker/ (Vite ho načte jako text přes ?raw, takže tu není žádný extra build krok).
import html from './cityClicker/index.html?raw';

export const CITY_CLICKER_HTML = html;
