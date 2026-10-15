// Starý postup her v localStorage prohlížeče (před přesunem na server): čtení pro jednorázový přenos a smazání po úspěšném přenosu.
// Sahá na skutečný localStorage appky (ne na ten, který hra dostane od shim.js); chyby úložiště (zakázané, plné) se tiše přeskočí.
import { LEGACY_KEYS } from './catalog.js';

const defaultStorage = () => { try { return window.localStorage; } catch { return null; } };

// {klíč: text} pro klíče dané hry, které v prohlížeči jsou.
export function readLegacyStorage(gameId, storage = defaultStorage()) {
  const found = {};
  if (!storage) return found;
  for (const key of LEGACY_KEYS[gameId] || []) {
    try {
      const value = storage.getItem(key);
      if (typeof value === 'string') found[key] = value;
    } catch { /* úložiště nemusí být dostupné */ }
  }
  return found;
}

export function clearLegacyStorage(gameId, keys, storage = defaultStorage()) {
  if (!storage) return;
  const allowed = new Set(LEGACY_KEYS[gameId] || []);
  for (const key of keys) {
    if (!allowed.has(key)) continue;
    try { storage.removeItem(key); } catch { /* nevadí */ }
  }
}
