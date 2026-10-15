// Volání serveru pro obchůdek (db/shop.sql). Klient (supabase) se předává zvenku, ať jde modul zkoušet bez prohlížeče.
// Dokud SQL v databázi neběží (nebo když načtení selže), vrací loadMyCosmetics null: appka pak obchůdek vůbec neukáže a hry se nepřebarvují.
import { KIND_GAMEFX, KIND_TITLE, SHOP_ERRORS, getShopItem, titleLabel } from './catalog.js';

export const EMPTY_COSMETICS = Object.freeze({ owned: Object.freeze([]), equipped: Object.freeze({}) });

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Odpověď my_cosmetics() převede na bezpečný tvar: jen známé zboží, nasazené jen se správnou skupinou.
export function normalizeCosmetics(data) {
  if (!isObject(data)) return EMPTY_COSMETICS;
  const owned = Array.isArray(data.owned) ? [...new Set(data.owned.filter((id) => typeof id === 'string' && getShopItem(id)))] : [];
  const equipped = {};
  if (isObject(data.equipped)) {
    for (const kind of [KIND_TITLE, KIND_GAMEFX]) {
      const id = data.equipped[kind];
      const item = typeof id === 'string' ? getShopItem(id) : null;
      if (item && item.kind === kind) equipped[kind] = id;
    }
  }
  return { owned, equipped };
}

// Vlastní zboží a nasazené kusy, nebo null, když se je nepodařilo načíst (SQL neběží, výpadek).
export async function loadMyCosmetics(client) {
  try {
    const { data, error } = await client.rpc('my_cosmetics');
    if (error) throw error;
    return normalizeCosmetics(data);
  } catch (err) {
    console.warn('Obchůdek se nepodařilo načíst:', err?.message || err);
    return null;
  }
}

// Kód chyby z textu hlášky serveru ('insufficient_coins', ...); neznámá chyba je 'failed'. Kód musí stát v hlášce samostatně
// (ne jako část jiného slova, třeba "blocked" není "locked").
export function errorReason(err) {
  const msg = String(err?.message || err || '');
  return Object.keys(SHOP_ERRORS).find((code) => new RegExp(`(^|[^a-z_])${code}($|[^a-z_])`).test(msg)) || 'failed';
}

// Koupí zboží a rovnou ho nasadí. {ok: true, itemId, kind, newBalance} nebo {ok: false, reason}.
export async function buyCosmetic(client, itemId) {
  const item = getShopItem(itemId);
  if (!item) return { ok: false, reason: 'unknown_item' };
  try {
    const { data, error } = await client.rpc('buy_cosmetic', { p_item_id: itemId });
    if (error) throw error;
    if (!isObject(data) || data.ok !== true) return { ok: false, reason: 'failed' };
    const balance = Number(data.new_balance);
    return { ok: true, itemId, kind: item.kind, newBalance: Number.isFinite(balance) ? balance : null };
  } catch (err) {
    return { ok: false, reason: errorReason(err) };
  }
}

// Nasadí koupený kus, nebo (itemId = null) sundá nasazené v dané skupině. {ok: true} nebo {ok: false, reason}.
export async function equipCosmetic(client, kind, itemId) {
  try {
    const { data, error } = await client.rpc('equip_cosmetic', { p_kind: kind, p_item_id: itemId });
    if (error) throw error;
    return isObject(data) && data.ok === true ? { ok: true } : { ok: false, reason: 'failed' };
  } catch (err) {
    return { ok: false, reason: errorReason(err) };
  }
}

// Server bere nejvýš 1000 lidí najednou; větší žebříček se pošle po částech.
const TITLES_CHUNK = 500;

// Nasazené tituly vybraných lidí pro žebříček: Map(id čtenáře → text titulu). Bez SQL nebo při chybě prázdná mapa
// (u chyby jedné části se ztratí jen její tituly).
export async function loadEquippedTitles(client, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const titles = new Map();
  const chunks = [];
  for (let i = 0; i < ids.length; i += TITLES_CHUNK) chunks.push(ids.slice(i, i + TITLES_CHUNK));
  await Promise.all(chunks.map(async (chunk) => {
    try {
      const { data, error } = await client.rpc('equipped_titles', { p_user_ids: chunk });
      if (error) throw error;
      for (const row of Array.isArray(data) ? data : []) {
        const label = titleLabel(row?.item_id);
        if (row?.user_id && label) titles.set(row.user_id, label);
      }
    } catch (err) {
      console.warn('Tituly v žebříčku se nepodařilo načíst:', err?.message || err);
    }
  }));
  return titles;
}
