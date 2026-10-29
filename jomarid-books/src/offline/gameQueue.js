// Herní odměny a rekordy bez internetu. Hra jen POŽÁDÁ o Coiny nebo ohlásí rekord; o skutečné odměně (a denním stropu) rozhoduje server.
// Když spojení není, žádost se uloží do fronty změn (outbox.js) a odešle se po připojení stejným voláním, jako by přišla hned.
import { isTransientError } from './model.js';

// Žádost o Coiny. { queued: true } (čeká na připojení) | { queued: false, data } (odpověď serveru) | { queued: false, error } (server žádost odmítl).
export async function requestCoins({ client, outbox, userId, gameId, amount, reason, offline = false }) {
  if (!offline) {
    try {
      const { data, error } = await client.rpc('award_game_coins', { p_game_id: gameId, p_amount: amount, p_reason: reason });
      if (!error) return { queued: false, data };
      if (!isTransientError(error)) return { queued: false, error };
    } catch (err) {
      if (!isTransientError(err)) return { queued: false, error: err };
    }
  }
  await outbox.enqueue({ userId, type: 'game_coin', gameId, amount, reason });
  return { queued: true };
}

// Rekord, který se nepodařilo odeslat kvůli spojení: do fronty (platí nejvyšší hodnota za statistiku).
export const queueRecord = (outbox, userId, rec) => outbox.enqueue({ userId, type: 'game_record', gameId: rec.game, stat: rec.stat, value: rec.value });
