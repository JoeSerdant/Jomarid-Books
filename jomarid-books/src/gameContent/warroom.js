// Warroom: Frontlines - mini-hra zobrazená v iframe (srcDoc) ze Games.jsx.
// Celá hra je jeden HTML dokument ve složce warroom/ (Vite ho načte jako text přes ?raw, takže tu není žádný extra build krok).
import html from './warroom/index.html?raw';

export const WARROOM_HTML = html;
