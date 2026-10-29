// Postup her v zařízení: šifrovaná kopie, ze které se hra otevře bez internetu, a která drží změny, dokud se neodešlou na server.
// Záznam (store "meta", klíč gamesave:uživatel:hra) je celý zašifrovaný klíčem zařízení a svázaný s účtem a hrou, takže ho nejde upravit
// (změněná data se nerozšifrují) ani přenést k jinému účtu. Obsah: { map, rev, dirty, at }
//   map   - postup hry přesně tak, jak ho hra ukládá ({klíč: text})
//   rev   - revize na serveru, ze které kopie vychází (stejné číslo jako v db/game-saves.sql)
//   dirty - v kopii jsou změny, které server ještě nemá
//   at    - kdy se kopie naposledy změnila (čas, kterému se věří)
import { STORES } from './store.js';
import { aadFor, getDeviceKey, open as openSealed, seal, trustedNow } from './crypto.js';
import { cleanMap } from '../gameSave/catalog.js';

const PREFIX = 'gamesave:';
const storeKey = (userId, gameId) => `${PREFIX}${userId}:${gameId}`;

export function createGameSaves({ store, now = Date.now }) {
  // Zápisy do jedné hry po jednom, ať starší stav nepřepíše novější.
  const chains = new Map();
  const serial = (k, fn) => { const prev = chains.get(k) || Promise.resolve(); const run = prev.then(fn, fn); chains.set(k, run.catch(() => {})); return run; };

  // Uložená kopie nebo null (žádná, nebo poškozená/cizí: s takovou se zachází, jako by nebyla).
  async function get(userId, gameId) {
    const sealed = await store.get(STORES.meta, storeKey(userId, gameId));
    if (!sealed) return null;
    try {
      const key = await getDeviceKey(store);
      const rec = await openSealed(key, sealed, aadFor(userId, gameId, 'gamesave'));
      const rev = Number(rec?.rev);
      if (!Number.isInteger(rev) || rev < 0) return null;
      return { map: cleanMap(rec.map), rev, dirty: rec.dirty === true, at: Number(rec.at) || 0 };
    } catch {
      return null;
    }
  }

  const put = (userId, gameId, { map, rev, dirty }) => serial(storeKey(userId, gameId), async () => {
    const key = await getDeviceKey(store);
    const at = await trustedNow(store, now());
    const sealed = await seal(key, { map: cleanMap(map), rev, dirty: !!dirty, at }, aadFor(userId, gameId, 'gamesave'));
    await store.put(STORES.meta, storeKey(userId, gameId), sealed);
  });

  const remove = (userId, gameId) => serial(storeKey(userId, gameId), () => store.del(STORES.meta, storeKey(userId, gameId)));

  const gameIds = async (userId) => (await store.keys(STORES.meta)).filter((k) => k.startsWith(`${PREFIX}${userId}:`)).map((k) => k.slice(`${PREFIX}${userId}:`.length));

  // Hry, které mají v zařízení změny čekající na odeslání.
  async function dirtyGames(userId) {
    const out = [];
    for (const id of await gameIds(userId)) if ((await get(userId, id))?.dirty) out.push(id);
    return out;
  }

  const list = async (userId) => {
    const out = [];
    for (const id of await gameIds(userId)) { const rec = await get(userId, id); if (rec) out.push({ gameId: id, dirty: rec.dirty, at: rec.at }); }
    return out;
  };

  return { get, put, remove, list, dirtyGames };
}
