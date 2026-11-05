// Anglický slovník: sloučené oblasti. Vytváří nástroj src/i18n/tools (npm run i18n:apply), ručně se neupravuje.
import badges from './badges.js';
import chrome from './chrome.js';
import games from './games.js';
import shell from './shell.js';

export const PARTS = {
  "badges": badges,
  "chrome": chrome,
  "games": games,
  "shell": shell,
};

export default Object.assign({}, ...Object.values(PARTS));
