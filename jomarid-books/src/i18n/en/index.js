// Anglický slovník: sloučené oblasti. Vytváří nástroj src/i18n/tools (npm run i18n:apply), ručně se neupravuje.
import admin from './admin.js';
import badges from './badges.js';
import chrome from './chrome.js';
import games from './games.js';
import library from './library.js';
import shell from './shell.js';

export const PARTS = {
  "admin": admin,
  "badges": badges,
  "chrome": chrome,
  "games": games,
  "library": library,
  "shell": shell,
};

export default Object.assign({}, ...Object.values(PARTS));
