// Hry offline: soubory her se stahují až při prvním spuštění, takže bez internetu by šla jen hra, kterou sis už otevřel. „Připravit hry offline“
// stáhne všechny dopředu (service worker je uloží). Po nové verzi appky mají soubory nové názvy, takže se stažení samo zopakuje na pozadí.
const KEY = 'jomarid-games-offline';

// Otisk verze appky: adresa vstupního skriptu (mění se s každým sestavením).
export const buildId = (doc = (typeof document !== 'undefined' ? document : null)) => {
  try { return doc?.querySelector('script[type="module"][src*="/assets/"]')?.getAttribute('src') || 'dev'; } catch { return 'dev'; }
};

const read = (storage) => { try { const v = JSON.parse(storage.getItem(KEY) || 'null'); return v && typeof v === 'object' ? v : null; } catch { return null; } };
const defaultStorage = () => { try { return window.localStorage; } catch { return null; } };

// { at, build, total, failed } poslední přípravy, nebo null.
export const preparedGames = (storage = defaultStorage()) => (storage ? read(storage) : null);

// loadGames(onProgress) -> { total, failed }; výsledek se zapamatuje jen když se stáhlo všechno.
export async function prepareGames(loadGames, { onProgress, storage = defaultStorage(), build = buildId(), now = Date.now } = {}) {
  const res = await loadGames(onProgress);
  const ok = res.failed.length === 0;
  if (ok && storage) { try { storage.setItem(KEY, JSON.stringify({ at: now(), build, total: res.total })); } catch { /* nevadí */ } }
  return { ...res, ok };
}

// Bylo už jednou připraveno a od té doby vyšla nová verze? Pak se příprava zopakuje (jen online).
export const needsRefresh = (storage = defaultStorage(), build = buildId()) => {
  const prev = storage ? read(storage) : null;
  return !!prev && prev.build !== build;
};

export const clearPrepared = (storage = defaultStorage()) => { try { storage?.removeItem(KEY); } catch { /* nevadí */ } };
