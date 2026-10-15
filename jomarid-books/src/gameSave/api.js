// Volání serveru pro uložený postup her (db/game-saves.sql). Klient (supabase) se předává zvenku, ať jde modul zkoušet bez prohlížeče.
// Chyby se tady nepolykají: kdo postup načítá, musí vědět, že se nepovedlo (hra se pak nespustí, ať se nepřepíše uložený postup prázdným).
import { cleanMap } from './catalog.js';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Odpověď {rev, data} nebo {imported, rev, data}: revize je celé číslo od 0, data jsou jen dvojice text: text. Cokoli jiného je chyba.
export function normalizeState(raw) {
  if (!isObject(raw)) throw new Error('invalid_response');
  const rev = Number(raw.rev);
  if (!Number.isInteger(rev) || rev < 0) throw new Error('invalid_response');
  return { rev, data: cleanMap(raw.data) };
}

export async function loadGameState(client, gameId) {
  const { data, error } = await client.rpc('load_game_state', { p_game_id: gameId });
  if (error) throw error;
  return normalizeState(data);
}

// Starý postup z prohlížeče: server rozhodne, jestli se stane uloženým postupem (imported), nebo zůstane ten na serveru.
export async function importLegacyGameState(client, gameId, map) {
  const { data, error } = await client.rpc('import_legacy_game_state', { p_game_id: gameId, p_data: map });
  if (error) throw error;
  return { imported: isObject(data) && data.imported === true, ...normalizeState(data) };
}

// Uloží celý postup. {ok: true, rev} | {ok: false, reason: 'conflict', rev}; při chybě spojení nebo serveru vyhodí.
export async function saveGameState(client, gameId, map, baseRev) {
  const { data, error } = await client.rpc('save_game_state', { p_game_id: gameId, p_data: map, p_base_rev: baseRev });
  if (error) throw error;
  if (!isObject(data)) throw new Error('invalid_response');
  const rev = Number(data.rev);
  if (data.ok === true && Number.isInteger(rev)) return { ok: true, rev };
  if (data.ok === false && data.reason === 'conflict') return { ok: false, reason: 'conflict', rev: Number.isInteger(rev) ? rev : null };
  throw new Error('invalid_response');
}

// Uložení při odchodu ze stránky: obyčejný požadavek by prohlížeč při zavírání zrušil, proto fetch s keepalive (smí mít nejvýš
// 64 kB; větší postup se pošle bez něj a prohlížeč ho může dokončit, nebo ne). Vrací Promise, ale volající na výsledek nečeká.
export function saveGameStateKeepalive({ url, apiKey, token, gameId, map, baseRev, fetchImpl = (typeof fetch === 'function' ? fetch : null) }) {
  if (!fetchImpl || !token) return Promise.resolve(false);
  const body = JSON.stringify({ p_game_id: gameId, p_data: map, p_base_rev: baseRev });
  return fetchImpl(`${url}/rest/v1/rpc/save_game_state`, {
    method: 'POST',
    keepalive: body.length < 60000,
    headers: { apikey: apiKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body,
  }).then((res) => res.ok, () => false);
}

// Všechny uložené postupy pro export dat účtu: {hra: {rev, updated_at, data}}.
export async function loadAllGameSaves(client) {
  const { data, error } = await client.rpc('my_game_saves');
  if (error) throw error;
  return isObject(data) ? data : {};
}
