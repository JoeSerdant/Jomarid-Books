// Offline služby appky (jedna sada na celý běh): úložiště v zařízení, stažené knihy a fronta změn. Jen pro prohlížeč; logika je v souborech vedle a jde testovat bez něj.
import { supabase } from '../lib/supabase';
import { createIdbStore, createMemoryStore, idbSupported, STORES } from './store.js';
import { createOfflineBooks } from './books.js';
import { createOutbox } from './outbox.js';
import { cryptoSupported, resetClock } from './crypto.js';
import { REFRESH_EVERY_MS } from './model.js';
import { registerLogoutCleanup } from './session.js';

export const offlineSupported = () => idbSupported() && cryptoSupported();

// Bez IndexedDB (soukromé okno některých prohlížečů) se použije paměť: stažení pak platí jen do zavření karty a appka to neslibuje (offlineSupported je false).
export const offlineStore = idbSupported() ? createIdbStore() : createMemoryStore();
export const offlineBooks = createOfflineBooks({ store: offlineStore, client: supabase });
export const outbox = createOutbox({ store: offlineStore });

// Při odhlášení se smaže všechno, co je v zařízení: stažené knihy, klíč zařízení i fronta změn.
registerLogoutCleanup(() => offlineStore.wipe());

export const pendingChanges = (userId) => outbox.pending(userId).catch(() => 0);

// Odešle frontu a obnoví stažené knihy. Volá se po přihlášení, po návratu připojení a při návratu do appky.
let lastRefresh = 0;
export async function syncNow(user, { force = false } = {}) {
  if (!user || (typeof navigator !== 'undefined' && navigator.onLine === false)) return null;
  const flushed = await outbox.flush(supabase, user.id, {
    onRemap: (localId, row, kind, bookId) => offlineBooks.local.remap(user.id, bookId, localId, row, kind),
  }).catch(() => null);
  let refreshed = null;
  if (flushed && !flushed.stopped && (force || Date.now() - lastRefresh > REFRESH_EVERY_MS)) {
    refreshed = await offlineBooks.refreshAll(user).catch(() => null);
    lastRefresh = Date.now();
  } else if (flushed && !flushed.stopped) {
    await resetClock(offlineStore).catch(() => {});
  }
  return { flushed, refreshed };
}

// Před odhlášením: pokud jsou neodeslané změny, zkusí se odeslat; když to nejde (offline), čtenář musí potvrdit, že o ně přijde.
export async function confirmLogoutDiscard(user, ask = (text) => (typeof window !== 'undefined' ? window.confirm(text) : true)) {
  if (!user) return true;
  let n = await pendingChanges(user.id);
  if (n > 0) { await syncNow(user, { force: true }); n = await pendingChanges(user.id); }
  if (n === 0) return true;
  return ask(`Máš ${n} neodeslaných změn z čtení offline (pozice, záložky, zvýraznění). Když se odhlásíš teď, o ně přijdeš. Opravdu se odhlásit?`);
}

export { STORES };
