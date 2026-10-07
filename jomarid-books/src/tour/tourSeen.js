// Zapamatování, že uživatel prohlídku už viděl (a které verze).
//
// Ukládá se na dvě místa: do localStorage (hned a bez sítě) a do metadat účtu u Supabase Auth (user_metadata), takže
// se prohlídka po přihlášení na jiném zařízení neukazuje znovu. Metadata nejsou tajná a uživatel si je může přepsat,
// což nevadí - nejhorší následek je, že si prohlídku vypne nebo zobrazí znovu sám sobě. Žádná změna databáze není potřeba.

export const SEEN_META_KEY = 'tour_seen_version';
export const seenStorageKey = (userId) => `jomarid-tour-seen:${userId}`;

const toVersion = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };
const getStorage = (storage) => { try { return storage || globalThis.localStorage || null; } catch { return null; } };

/** Nejvyšší verze prohlídky, kterou uživatel viděl (0 = nikdy). */
export const readSeenVersion = (user, storage) => {
  if (!user) return 0;
  let local = 0;
  try { local = toVersion(getStorage(storage)?.getItem(seenStorageKey(user.id))); } catch { /* blokované úložiště */ }
  const meta = user.user_metadata && typeof user.user_metadata === 'object' ? toVersion(user.user_metadata[SEEN_META_KEY]) : 0;
  return Math.max(local, meta);
};

/**
 * Zapíše, že uživatel viděl danou verzi (nikdy nesníží už zapsanou vyšší: i ruční spuštění nebo chyba načtení
 * nastavení nesmí způsobit, že se prohlídka znovu ukáže). Nikdy nevyhodí chybu; co se nepovede, se příště zkusí znovu.
 */
export const markTourSeen = async ({ client, user, version, storage }) => {
  if (!user) return;
  const value = Math.max(readSeenVersion(user, storage), toVersion(version));
  if (value === 0) return;
  try { getStorage(storage)?.setItem(seenStorageKey(user.id), String(value)); } catch { /* blokované úložiště */ }
  // Metadata účtu se mění jen když je potřeba (každá změna vyvolá v appce událost přihlášení a znovunačtení dat).
  const inMeta = user.user_metadata && typeof user.user_metadata === 'object' ? toVersion(user.user_metadata[SEEN_META_KEY]) : 0;
  if (inMeta >= value) return;
  try { await client?.auth?.updateUser({ data: { [SEEN_META_KEY]: value } }); } catch { /* bez sítě - příště se zkusí znovu */ }
};
