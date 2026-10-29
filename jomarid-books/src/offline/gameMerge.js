// Sloučení postupu hry po návratu připojení. Hrálo-li se offline, v zařízení jsou změny (dirty), které server nezná. Podle serveru:
//   - server se od offline hraní nezměnil (stejná revize)  -> změny se prostě uloží
//   - hrálo se mezitím i jinde a postup se liší            -> vyhraje pokročilejší (gameProgress.js), druhý se uloží u serveru jako záloha
//                                                            (legacy_backup, jde ho obnovit ručně), takže se nic nenávratně neztratí
// Nepotřebuje nic nového v databázi: používá load_game_state, save_game_state a import_legacy_game_state z db/game-saves.sql
// (ta při už existujícím postupu ukládá předaná data jen jako zálohu).
import { loadGameState, importLegacyGameState, saveGameState } from '../gameSave/api.js';
import { compareProgress, sameMap } from './gameProgress.js';

const TRIES = 3;   // konflikt revize (někdo uložil mezi načtením a uložením): zkusí se znovu s čerstvým stavem

// Vrací { action, rev, map } kde action je:
//   'none'       - nebylo co odesílat
//   'pushed'     - změny z offline hraní jsou na serveru
//   'local_won'  - hrálo se i jinde, ale offline postup je pokročilejší: je na serveru, ten starší je záloha
//   'server_won' - hrálo se i jinde a postup na serveru je pokročilejší (nebo nerozhodno): kopie v zařízení ho převzala, offline postup je záloha
//   'same'       - rozdíl nebyl (stejná data)
// Chyba spojení se vyhazuje (kopie zůstane dirty a zkusí se to znovu).
export async function reconcileGameSave({ client, userId, gameId, gameSaves }) {
  const local = await gameSaves.get(userId, gameId);
  if (!local || !local.dirty) return { action: 'none', rev: local?.rev ?? 0, map: local?.map ?? null };

  for (let i = 0; i < TRIES; i += 1) {
    const server = await loadGameState(client, gameId);

    if (sameMap(server.data, local.map)) {
      await gameSaves.put(userId, gameId, { map: local.map, rev: server.rev, dirty: false });
      return { action: 'same', rev: server.rev, map: local.map };
    }

    // Server se od offline hraní nezměnil (nebo je prázdný): změny se prostě uloží.
    if (server.rev === local.rev || server.rev === 0) {
      const res = await saveGameState(client, gameId, local.map, server.rev);
      if (res.ok) {
        await gameSaves.put(userId, gameId, { map: local.map, rev: res.rev, dirty: false });
        return { action: 'pushed', rev: res.rev, map: local.map };
      }
      continue;
    }

    // Hrálo se i jinde: pokročilejší vyhrává.
    if (compareProgress(gameId, local.map, server.data) > 0) {
      await importLegacyGameState(client, gameId, server.data);   // starší postup ze serveru se uloží jako záloha (data na serveru se nemění)
      const res = await saveGameState(client, gameId, local.map, server.rev);
      if (res.ok) {
        await gameSaves.put(userId, gameId, { map: local.map, rev: res.rev, dirty: false });
        return { action: 'local_won', rev: res.rev, map: local.map };
      }
      continue;
    }
    await importLegacyGameState(client, gameId, local.map);       // offline postup se uloží jako záloha, server zůstává
    await gameSaves.put(userId, gameId, { map: server.data, rev: server.rev, dirty: false });
    return { action: 'server_won', rev: server.rev, map: server.data };
  }
  throw new Error('conflict_retry');   // pořád se mění pod rukama: příště (kopie zůstává dirty)
}

// Všechny hry s neodeslanými změnami (kromě těch, které má právě otevřené hra sama; ty si je slučují samy).
export async function reconcileAllGames({ client, userId, gameSaves, skip = new Set() }) {
  const results = {};
  for (const gameId of await gameSaves.dirtyGames(userId)) {
    if (skip.has(gameId)) continue;
    try { results[gameId] = await reconcileGameSave({ client, userId, gameId, gameSaves }); } catch (err) { results[gameId] = { action: 'failed', error: err }; }
  }
  return results;
}
