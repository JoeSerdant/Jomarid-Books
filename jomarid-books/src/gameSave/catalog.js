// Uložený postup her u účtu (db/game-saves.sql): které hry se ukládají, jaké meze server hlídá a jaké klíče hry dřív používaly v localStorage.
// Hry samy se nemění: pořád volají localStorage.getItem/setItem/removeItem. Appka jim ten localStorage při spuštění nahradí pamětí
// (shim.js) a změny posílá na server (sync.js).

// Stejné meze jako db/game-saves.sql (game_save_check); test src/tests/gameSave.test.mjs hlídá, že si odpovídají.
export const GAME_SAVE_LIMITS = Object.freeze({ maxKeys: 40, maxKeyLength: 100, maxBytes: 2000000 });

// Klíče, které hry dřív zapisovaly do localStorage prohlížeče. Slouží jen k jednorázovému přenosu starého postupu na server
// (sync.js) a ke kontrole, že hry žádný klíč navíc nepoužívají.
export const LEGACY_KEYS = Object.freeze({
  rocket: ['space_shooter_v2_9'],
  warroom: ['warroom_frontlines_save_v1', 'warroom_muted', 'warroom_tutorial_done'],
  cityclicker: ['cityClickerSaveV1'],
  polygonarena: ['polygon-arena-v1'],
  chess: ['chessLeague.save.v1', 'chessLeague.game.v1'],
  koulovikamosi: ['koulovi-kamosi-v1'],
  hannibal: ['hannibal_save_v1', 'hannibal_endless_best'],
});

export const SAVE_GAME_IDS = Object.freeze(Object.keys(LEGACY_KEYS));

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Má postup tvar, který server přijme (počet klíčů, délka klíče, hodnoty jen text)? Vrací null, nebo 'invalid_data'.
// Velikost (maxBytes) tu nehlídá záměrně: počítá ji server podle zápisu jsonb a když je postup moc velký, vrátí too_large.
export function saveProblem(map) {
  if (!isObject(map)) return 'invalid_data';
  const entries = Object.entries(map);
  if (entries.length > GAME_SAVE_LIMITS.maxKeys) return 'invalid_data';
  for (const [k, v] of entries) {
    if (typeof v !== 'string' || k.length < 1 || k.length > GAME_SAVE_LIMITS.maxKeyLength) return 'invalid_data';
  }
  return null;
}

// Z odpovědi serveru nechá jen dvojice text: text.
export function cleanMap(data) {
  const out = {};
  if (!isObject(data)) return out;
  for (const [k, v] of Object.entries(data)) if (typeof v === 'string') out[k] = v;
  return out;
}
