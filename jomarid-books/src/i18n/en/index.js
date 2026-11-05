// Anglický slovník: sloučené oblasti. Vytváří nástroj src/i18n/tools (npm run i18n:apply), ručně se neupravuje.
import shell from './shell.js';

export const PARTS = {
  "shell": shell,
};

export default Object.assign({}, ...Object.values(PARTS));
