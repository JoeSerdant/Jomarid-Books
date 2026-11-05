// Anglické slovníky her (každý se stáhne až při otevření hry v angličtině). Soubory vytváří nástroj src/i18n/tools/gamestrings.mjs.
const LOADERS = {
  koulovikamosi: () => import('./koulovikamosi.js'),
  chess: () => import('./chess.js'),
  cityclicker: () => import('./cityclicker.js'),
  polygonarena: () => import('./polygonarena.js'),
  hannibal: () => import('./hannibal.js'),
  warroom: () => import('./warroom.js'),
  rocket: () => import('./rocket.js'),
};

export const GAME_IDS = Object.keys(LOADERS);

/** Slovník hry { 'Česky': 'English' }. Když se nepodaří stáhnout (bez připojení), hra zůstane česky a nic nespadne. */
export const loadGameDictionary = async (gameId) => {
  try {
    const load = LOADERS[gameId];
    return load ? (await load()).default || {} : {};
  } catch {
    return {};
  }
};
