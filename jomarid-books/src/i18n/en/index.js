// Anglický slovník: sloučené oblasti. Vytváří nástroj src/i18n/tools (npm run i18n:apply), ručně se neupravuje.
import chrome from './chrome.js';
import shell from './shell.js';

export const PARTS = {
  "chrome": chrome,
  "shell": shell,
};

export default Object.assign({}, ...Object.values(PARTS));
