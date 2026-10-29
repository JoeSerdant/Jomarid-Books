// Volání serveru pro herní rekordy a odznaky (db/game-records.sql). Klient (supabase) se předává zvenku, ať jde modul zkoušet bez prohlížeče.
// Dokud SQL v databázi neběží (nebo když volání selže), vrací se prázdný postup a nic se nerozbije: úroveň čtenáře pak vychází bez herního XP.
import { getBadge, getStat, normalizeRecord, sumGameBadgeXp } from './catalog.js';
import { isTransientError } from '../offline/model.js';

export const EMPTY_PROGRESS = Object.freeze({ records: Object.freeze({}), unlocked: Object.freeze([]), xp: 0 });

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Odpověď my_game_progress() převede na bezpečný tvar: jen známé hry a statistiky, celá čísla, jen známé odznaky.
export function normalizeProgress(data) {
  if (!isObject(data)) return EMPTY_PROGRESS;
  const records = {};
  if (isObject(data.records)) {
    for (const [game, stats] of Object.entries(data.records)) {
      if (!isObject(stats)) continue;
      for (const [key, raw] of Object.entries(stats)) {
        if (!getStat(game, key)) continue;
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) continue;
        (records[game] = records[game] || {})[key] = Math.floor(n);
      }
    }
  }
  const unlocked = Array.isArray(data.unlocked) ? [...new Set(data.unlocked.filter((id) => typeof id === 'string' && getBadge(id)))] : [];
  // XP bere appka ze serveru (stejné číslo jako v žebříčku); kdyby chybělo, spočítá se z odemčených odznaků.
  const serverXp = Number(data.xp);
  const xp = Number.isFinite(serverXp) && serverXp >= 0 ? Math.floor(serverXp) : sumGameBadgeXp(unlocked);
  return { records, unlocked, xp };
}

export async function loadGameProgress(client) {
  try {
    const { data, error } = await client.rpc('my_game_progress');
    if (error) throw error;
    return normalizeProgress(data);
  } catch (err) {
    console.warn('Herní postup se nepodařilo načíst:', err?.message || err);
    return EMPTY_PROGRESS;
  }
}

// XP z herních odznaků všech, kdo smějí být v žebříčku: Map(id účtu -> XP).
export async function loadGameXpTotals(client) {
  const out = new Map();
  try {
    const { data, error } = await client.rpc('game_xp_totals');
    if (error) throw error;
    for (const row of Array.isArray(data) ? data : []) {
      const xp = Math.floor(Number(row?.xp));
      if (row?.user_id && Number.isFinite(xp) && xp > 0) out.set(row.user_id, xp);
    }
  } catch (err) {
    console.warn('XP z herních odznaků se nepodařilo načíst:', err?.message || err);
  }
  return out;
}

// Nejlepší hráči jedné statistiky: [{ userId, name, value }] (prázdné jméno je „Anonym“).
export async function loadGameLeaderboard(client, gameId, statKey, limit = 5) {
  if (!getStat(gameId, statKey)) return [];
  try {
    const { data, error } = await client.rpc('game_leaderboard', { p_game_id: gameId, p_stat_key: statKey, p_limit: limit });
    if (error) throw error;
    return (Array.isArray(data) ? data : []).map((r) => ({ userId: r.user_id, name: (typeof r.username === 'string' && r.username.trim()) || 'Anonym', value: Math.floor(Number(r.value)) || 0 }));
  } catch (err) {
    console.warn('Žebříček hry se nepodařilo načíst:', err?.message || err);
    return [];
  }
}

// Zapíše rekord z hry. Vrací { improved, unlocked: [odznak...], xp } nebo null (neplatné hlášení, server nepřijal, chyba).
// Při výpadku spojení se zavolá onTransient(rekord) (appka ho uloží do fronty a odešle po připojení) a výsledek je { queued: true, ... }.
export async function reportGameRecord(client, gameId, statKey, value, { onTransient } = {}) {
  const rec = normalizeRecord(gameId, statKey, value);
  if (!rec) return null;
  try {
    const { data, error } = await client.rpc('report_game_record', { p_game_id: rec.game, p_stat_key: rec.stat, p_value: rec.value });
    if (error) throw error;
    if (!isObject(data) || data.ok !== true) return null;
    const unlocked = (Array.isArray(data.unlocked) ? data.unlocked : []).map(getBadge).filter(Boolean);
    return { improved: data.improved === true, unlocked, xp: Math.max(0, Math.floor(Number(data.xp)) || 0) };
  } catch (err) {
    if (onTransient && isTransientError(err)) { onTransient(rec); return { queued: true, improved: false, unlocked: [], xp: 0 }; }
    console.warn('Rekord se nepodařilo zapsat:', err?.message || err);
    return null;
  }
}
