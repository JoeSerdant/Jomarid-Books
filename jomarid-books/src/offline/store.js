// Úložiště offline dat v zařízení: IndexedDB (v prohlížeči) a jeho paměťová napodobenina (testy). Obě mají stejné rozhraní:
//   get(store, key), put(store, key, value), del(store, key), keys(store), all(store) -> [{ key, value }], clear(store), wipe()
// Hodnoty se ukládají přes strukturované klonování, takže drží i ArrayBuffer a CryptoKey (klíč zařízení, který nejde z JavaScriptu vyexportovat).
export const STORES = Object.freeze({ books: 'books', queue: 'queue', meta: 'meta' });
const NAMES = Object.values(STORES);
export const DB_NAME = 'jomarid-offline';

export const idbSupported = (idb = (typeof indexedDB !== 'undefined' ? indexedDB : null)) => !!idb;

export function createMemoryStore() {
  const data = new Map(NAMES.map((n) => [n, new Map()]));
  const table = (s) => { const t = data.get(s); if (!t) throw new Error(`Neznámé úložiště ${s}`); return t; };
  return {
    kind: 'memory',
    async get(s, k) { return table(s).get(k); },
    async put(s, k, v) { table(s).set(k, v); },
    async del(s, k) { table(s).delete(k); },
    async keys(s) { return [...table(s).keys()].sort(); },
    async all(s) { return [...table(s).entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, value]) => ({ key, value })); },
    async clear(s) { table(s).clear(); },
    async wipe() { for (const t of data.values()) t.clear(); },
  };
}

// IndexedDB: jedna databáze, tři úložiště (books, queue, meta), klíče zadává volající.
export function createIdbStore(idb = (typeof indexedDB !== 'undefined' ? indexedDB : null), name = DB_NAME) {
  let opening = null;
  const open = () => {
    if (!idb) return Promise.reject(new Error('IndexedDB není dostupná'));
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const req = idb.open(name, 1);
      req.onupgradeneeded = () => { const db = req.result; for (const n of NAMES) if (!db.objectStoreNames.contains(n)) db.createObjectStore(n); };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); opening = null; };   // jiná karta maže databázi (odhlášení)
        resolve(db);
      };
      req.onerror = () => { opening = null; reject(req.error || new Error('IndexedDB se nepodařilo otevřít')); };
      req.onblocked = () => { /* jiná karta drží starou verzi; čeká se */ };
    });
    return opening;
  };
  const run = async (s, mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(s, mode);
      let out;
      try { out = fn(tx.objectStore(s)); } catch (e) { reject(e); return; }
      tx.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transakce IndexedDB selhala'));
    });
  };
  return {
    kind: 'idb',
    get: (s, k) => run(s, 'readonly', (os) => os.get(k)),
    put: (s, k, v) => run(s, 'readwrite', (os) => { os.put(v, k); }),
    del: (s, k) => run(s, 'readwrite', (os) => { os.delete(k); }),
    keys: (s) => run(s, 'readonly', (os) => os.getAllKeys()).then((r) => r || []),
    all: async (s) => {
      const [keys, values] = await Promise.all([run(s, 'readonly', (os) => os.getAllKeys()), run(s, 'readonly', (os) => os.getAll())]);
      return (keys || []).map((key, i) => ({ key, value: values[i] }));
    },
    clear: (s) => run(s, 'readwrite', (os) => { os.clear(); }),
    // Odhlášení: smaže celou databázi (včetně klíče zařízení), takže po něm nejde otevřít nic z dřívějška.
    async wipe() {
      try { const db = await open(); db.close(); } catch { /* nešla otevřít: není co zavírat */ }
      opening = null;
      if (!idb) return;
      await new Promise((resolve) => { const req = idb.deleteDatabase(name); req.onsuccess = req.onerror = req.onblocked = () => resolve(); });
    },
  };
}
