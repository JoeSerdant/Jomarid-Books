// Přihlášení, které přežije offline. Supabase si relaci (přístupový a obnovovací token, uživatele) drží v localStorage, ale po vypršení přístupového
// tokenu (hodina) se ji bez internetu nepodaří obnovit a getSession() vrátí prázdno. Appka by pak čtenáře odhlásila jen proto, že je v metru.
// Tady se uložená relace přečte přímo: čtenář zůstane přihlášený na zařízení, dokud se sám neodhlásí, a po připojení Supabase relaci obnoví sám.
// Offline relace nic neověřuje a nic na serveru nedovoluje: služby se serverem po připojení dál běží pod skutečnou relací.

// Název klíče, pod kterým Supabase ukládá relaci: sb-<první část adresy projektu>-auth-token
export const sessionKeyFor = (supabaseUrl) => {
  try { return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`; } catch { return null; }
};

const PROFILE_PREFIX = 'jomarid-offline-profile:';

const safeStorage = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };

// Uživatel z uložené relace, nebo null (žádná, poškozená, bez obnovovacího tokenu = nejde se k ní vrátit).
export function readStoredSession(supabaseUrl, storage = safeStorage()) {
  const key = sessionKeyFor(supabaseUrl);
  if (!key || !storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const s = JSON.parse(raw);
    const u = s && typeof s === 'object' ? s.user : null;
    if (!u || typeof u.id !== 'string' || !u.id || typeof s.refresh_token !== 'string' || !s.refresh_token) return null;
    return { user: u };
  } catch { return null; }
}

// Odhlášení bez internetu: signOut() ze Supabase při selhání sítě relaci nesmaže, takže se smaže ručně.
export function clearStoredSession(supabaseUrl, storage = safeStorage()) {
  const key = sessionKeyFor(supabaseUrl);
  if (!key || !storage) return;
  try { storage.removeItem(key); } catch { /* bez úložiště není co mazat */ }
}

// Naposledy známý profil (role, jméno): offline ho appka nemá odkud vzít. Platí jen pro stejný účet.
export function readCachedProfile(userId, storage = safeStorage()) {
  if (!storage || !userId) return null;
  try {
    const p = JSON.parse(storage.getItem(PROFILE_PREFIX + userId) || 'null');
    if (!p || typeof p !== 'object') return null;
    return { role: typeof p.role === 'string' ? p.role : null, username: typeof p.username === 'string' ? p.username : '' };
  } catch { return null; }
}

export function writeCachedProfile(userId, profile, storage = safeStorage()) {
  if (!storage || !userId) return;
  try { storage.setItem(PROFILE_PREFIX + userId, JSON.stringify({ role: profile?.role ?? null, username: profile?.username ?? '' })); } catch { /* plné úložiště: profil se příště načte ze serveru */ }
}

export function clearCachedProfiles(storage = safeStorage()) {
  if (!storage) return;
  try {
    for (let i = storage.length - 1; i >= 0; i -= 1) {
      const k = storage.key(i);
      if (k && k.startsWith(PROFILE_PREFIX)) storage.removeItem(k);
    }
  } catch { /* nic */ }
}

// Selhalo to kvůli síti (a ne proto, že by relace byla neplatná)?
export const isNetworkProblem = (err) => {
  if (!err) return false;
  const name = String(err.name || '');
  const msg = String(err.message || '').toLowerCase();
  return name === 'AuthRetryableFetchError' || name === 'TypeError' || err.status === 0
    || /failed to fetch|networkerror|network request failed|load failed|fetch failed|offline/.test(msg);
};

// Úklid při odhlášení: další části offline režimu (stažené knihy, fronta změn) sem přidají svůj úklid, ať po odhlášení na zařízení nezůstane nic osobního.
const cleanups = new Set();
export function registerLogoutCleanup(fn) { cleanups.add(fn); return () => cleanups.delete(fn); }
export async function runLogoutCleanups() {
  for (const fn of [...cleanups]) { try { await fn(); } catch (e) { console.error('Úklid při odhlášení selhal:', e); } }
}
