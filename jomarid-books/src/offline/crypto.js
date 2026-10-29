// Šifrování stažených knih: AES-GCM přes WebCrypto. Klíč vzniká v zařízení (nikdy neopouští prohlížeč) a ukládá se jako CryptoKey, který z JavaScriptu nejde
// vyexportovat, takže uložená data nejdou otevřít mimo appku ani zkopírovat do jiné. Každé zašifrované pole je navíc svázané s účtem, knihou a druhem dat
// (AAD): záznam přenesený k jinému čtenáři nebo na jinou knihu se nerozšifruje a změněná data prozradí chybu. Rozšifrovat to dokáže jen appka, a to je záměr:
// není to ochrana před čtenářem, který si text chce přečíst v nástrojích prohlížeče, ale před kopírováním souboru, cizí appkou a omylem.
import { STORES } from './store.js';

const KEY_RECORD = 'deviceKey';
export class OfflineCryptoError extends Error { constructor(message) { super(message); this.name = 'OfflineCryptoError'; } }

const subtle = () => {
  const s = typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle;
  if (!s) throw new OfflineCryptoError('Šifrování není v tomhle prohlížeči dostupné.');
  return s;
};
const enc = new TextEncoder();
const dec = new TextDecoder();

export const cryptoSupported = () => !!(typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle);

// Klíč zařízení: při prvním použití se vytvoří a uloží.
export async function getDeviceKey(store) {
  const have = await store.get(STORES.meta, KEY_RECORD);
  if (have) return have;
  const key = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await store.put(STORES.meta, KEY_RECORD, key);
  return key;
}

export const aadFor = (userId, bookId, kind) => `${userId}|${bookId}|${kind}`;

// Zašifruje libovolnou hodnotu, kterou jde zapsat jako JSON. Vrací { v, iv, data } (Uint8Array a ArrayBuffer, jdou uložit do IndexedDB).
export async function seal(key, value, aad) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const data = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, enc.encode(JSON.stringify(value)));
  return { v: 1, iv, data };
}

export async function open(key, sealed, aad) {
  if (!sealed || sealed.v !== 1 || !sealed.iv || !sealed.data) throw new OfflineCryptoError('Stažená data jsou poškozená.');
  try {
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: sealed.iv, additionalData: enc.encode(aad) }, key, sealed.data);
    return JSON.parse(dec.decode(plain));
  } catch (e) {
    if (e instanceof OfflineCryptoError) throw e;
    throw new OfflineCryptoError('Stažená data se nepodařilo otevřít (jiný účet, jiné zařízení, nebo jsou poškozená).');
  }
}

// Hodiny, kterým se dá věřit: nejvyšší čas, který appka kdy viděla. Přetočení hodin zpět proto nevrátí platnost vypršené licence.
export async function trustedNow(store, now = Date.now()) {
  const seen = Number(await store.get(STORES.meta, 'clock')) || 0;
  const t = Math.max(seen, now);
  if (t !== seen) await store.put(STORES.meta, 'clock', t);
  return t;
}

// Po úspěšném připojení k serveru se čas srovná na skutečný (zařízení s chybně nastavenými hodinami v budoucnosti by jinak zůstalo zamčené).
export async function resetClock(store, now = Date.now()) { await store.put(STORES.meta, 'clock', now); return now; }
