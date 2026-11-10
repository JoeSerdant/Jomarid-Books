// Volání serveru pro online hru (db/multiplayer.sql). Klient se předává zvenku, ať jde modul zkoušet bez prohlížeče.
// Každé volání vrací { data } nebo { error: { code, message, transient } }: code je krátký kód ze serveru (not_your_turn...), transient značí
// výpadek spojení (zkusit znovu), unavailable značí, že multiplayer v databázi není (funkce neexistuje).
import { isTransientError } from '../offline/model.js';

export function normalizeError(err) {
  const message = String((err && err.message) || err || '');
  const raw = err && (err.code ?? err.status);
  const status = Number(err && (err.status ?? err.statusCode));
  // Funkce v databázi není (SQL se nespustilo): PostgREST odpoví 404 / PGRST202 nebo hlásí, že funkce neexistuje.
  const missing = /could not find the function|schema cache|does not exist/i.test(message);
  if (String(raw) === 'PGRST202' || status === 404 || missing) return { code: 'unavailable', message, transient: false };
  if (/^[a-z_]+$/.test(message)) return { code: message, message, transient: false };
  if (String(raw) === '42501' || status === 401 || status === 403) return { code: 'not_authenticated', message, transient: false };
  return { code: isTransientError(err) ? 'network' : 'error', message, transient: isTransientError(err) };
}

export function createMpApi(client) {
  const call = async (name, args) => {
    try {
      const { data, error } = await client.rpc(name, args);
      if (error) return { error: normalizeError(error) };
      return { data };
    } catch (err) {
      return { error: normalizeError(err) };
    }
  };
  return {
    ping: () => call('mp_ping'),
    find: (game, mode, params) => call('mp_find', { p_game: game, p_mode: mode, p_params: params || {} }),
    cancel: () => call('mp_cancel'),
    active: () => call('mp_active'),
    queueCount: (game, mode) => call('mp_queue_count', { p_game: game, p_mode: mode }),
    stats: () => call('mp_stats'),
    roomCreate: (game, mode, params) => call('mp_room_create', { p_game: game, p_mode: mode, p_params: params || {} }),
    roomJoin: (code) => call('mp_room_join', { p_code: code }),
    state: (match, since) => call('mp_state', { p_match: match, p_since: since || 0 }),
    move: (match, seq, payload, endTurn) => call('mp_move', { p_match: match, p_seq: seq, p_payload: payload, p_end_turn: endTurn !== false }),
    progress: (match, value) => call('mp_progress', { p_match: match, p_value: value }),
    report: (match, outcome, reason) => call('mp_report', { p_match: match, p_outcome: outcome, p_reason: reason || null }),
    resign: (match) => call('mp_resign', { p_match: match }),
    abort: (match) => call('mp_abort', { p_match: match }),
    arenaClaim: (seconds, score) => call('mp_arena_claim', { p_seconds: Math.max(0, Math.floor(seconds)), p_score: Math.max(0, Math.floor(score || 0)) }),
  };
}
