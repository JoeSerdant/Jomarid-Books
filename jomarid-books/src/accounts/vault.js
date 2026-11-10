// Trezor účtů na tomto zařízení: relace všech účtů, které se tu přihlásily a nebyly odhlášeny (přepínač účtů bez odhlášení).
// Čistá logika bez Reactu a bez Supabase: úložiště se předává zvenku, ať jde zkoušet v Node (src/tests/accounts.test.mjs).
//
// Co se ukládá: u každého účtu jeho id, e-mail, jméno a role (jen pro zobrazení v seznamu) a relace (přístupový a obnovovací token), kterou
// Supabase pro přepnutí potřebuje. Aktivní účet má relaci i ve vlastním úložišti Supabase; trezor ji drží taky, ať se po přepnutí dá vrátit.
// Stejné riziko jako dosud: tokeny jsou v localStorage tohoto prohlížeče, na server z nich nic neodchází jinak než při přihlášení.

export const VAULT_KEY = 'jomarid-accounts-v1';
export const MAX_ACCOUNTS = 8;

const safeStorage = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };

const text = (v, max) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

export const emptyVault = () => ({ v: 1, active: null, accounts: [] });

// Z cokoli načteného (poškozené úložiště, ručně upravený text) udělá platný trezor; co neplatí, zahodí.
export function sanitizeVault(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== 1 || !Array.isArray(raw.accounts)) return emptyVault();
  const seen = new Set();
  const accounts = [];
  for (const a of raw.accounts) {
    if (!a || typeof a !== 'object') continue;
    const id = text(a.id, 64);
    const access = text(a.session?.access_token, 8192);
    const refresh = text(a.session?.refresh_token, 1024);
    if (!id || !access || !refresh || seen.has(id)) continue;
    seen.add(id);
    accounts.push({
      id,
      email: text(a.email, 320),
      username: text(a.username, 80),
      role: text(a.role, 40),
      session: { access_token: access, refresh_token: refresh, expires_at: num(a.session?.expires_at) },
      addedAt: num(a.addedAt),
      usedAt: num(a.usedAt),
    });
    if (accounts.length >= MAX_ACCOUNTS) break;
  }
  const active = accounts.some((a) => a.id === raw.active) ? raw.active : null;
  return { v: 1, active, accounts };
}

export function readVault(storage = safeStorage()) {
  if (!storage) return emptyVault();
  try {
    const raw = storage.getItem(VAULT_KEY);
    return raw ? sanitizeVault(JSON.parse(raw)) : emptyVault();
  } catch { return emptyVault(); }
}

// Vrací, jestli se zápis povedl (plné úložiště nebo zakázané úložiště: appka dál funguje, jen se účty nepamatují).
export function writeVault(vault, storage = safeStorage()) {
  if (!storage) return false;
  try {
    if (!vault.accounts.length) storage.removeItem(VAULT_KEY);
    else storage.setItem(VAULT_KEY, JSON.stringify(sanitizeVault(vault)));
    return true;
  } catch { return false; }
}

export const getAccount = (vault, id) => vault.accounts.find((a) => a.id === id) || null;

// Seznam pro zobrazení: aktivní účet první, ostatní od naposledy použitého.
export function listAccounts(vault) {
  return [...vault.accounts].sort((a, b) => (a.id === vault.active ? -1 : b.id === vault.active ? 1 : b.usedAt - a.usedAt));
}

// Přidá účet z relace Supabase, nebo obnoví jeho tokeny. Čistá funkce: vrací nový trezor a co se stalo.
//   makeActive: relace patří právě přihlášenému účtu (událost z hlavního klienta), nebo je to jen uložený další účet
//   evict: když je trezor plný, vyhodí se nejdéle nepoužitý neaktivní účet (automatické zapamatování); jinak se nový účet odmítne (full)
export function upsertSession(vault, session, { now = Date.now(), makeActive = false, evict = false, profile } = {}) {
  const user = session?.user;
  const id = text(user?.id, 64);
  const access = text(session?.access_token, 8192);
  const refresh = text(session?.refresh_token, 1024);
  if (!id || !access || !refresh) return { vault, changed: false, added: false, full: false };
  let accounts = vault.accounts.map((a) => ({ ...a, session: { ...a.session } }));
  const at = accounts.findIndex((a) => a.id === id);
  let added = false;
  if (at < 0) {
    if (accounts.length >= MAX_ACCOUNTS) {
      if (!evict) return { vault, changed: false, added: false, full: true };
      const victims = accounts.filter((a) => a.id !== vault.active && a.id !== id).sort((a, b) => a.usedAt - b.usedAt);
      if (!victims.length) return { vault, changed: false, added: false, full: true };
      accounts = accounts.filter((a) => a.id !== victims[0].id);
    }
    accounts.push({ id, email: '', username: '', role: '', session: { access_token: access, refresh_token: refresh, expires_at: 0 }, addedAt: now, usedAt: makeActive ? now : 0 });
    added = true;
  }
  const entry = accounts.find((a) => a.id === id);
  entry.session = { access_token: access, refresh_token: refresh, expires_at: num(session.expires_at) };
  if (text(user.email, 320)) entry.email = user.email;
  if (profile && typeof profile === 'object') {
    if (text(profile.username, 80)) entry.username = profile.username;
    if (text(profile.role, 40)) entry.role = profile.role;
  }
  if (makeActive) { entry.usedAt = now; }
  return { vault: { v: 1, active: makeActive ? id : vault.active, accounts }, changed: true, added, full: false };
}

// Jméno a role účtu (z profilu), ať seznam ukáže „kdo to je“, i když je účet právě neaktivní.
export function setProfile(vault, id, profile) {
  const entry = getAccount(vault, id);
  if (!entry) return vault;
  const username = text(profile?.username, 80) || entry.username;
  const role = text(profile?.role, 40) || entry.role;
  if (username === entry.username && role === entry.role) return vault;
  return { ...vault, accounts: vault.accounts.map((a) => (a.id === id ? { ...a, username, role } : a)) };
}

export function removeAccount(vault, id) {
  const accounts = vault.accounts.filter((a) => a.id !== id);
  if (accounts.length === vault.accounts.length) return vault;
  return { v: 1, active: vault.active === id ? null : vault.active, accounts };
}

export function setActive(vault, id, now = Date.now()) {
  if (!getAccount(vault, id)) return vault;
  return { ...vault, active: id, accounts: vault.accounts.map((a) => (a.id === id ? { ...a, usedAt: now } : a)) };
}

// Který účet nabídnout po odhlášení toho aktivního: naposledy použitý z ostatních.
export function nextAccount(vault, exceptId) {
  return [...vault.accounts].filter((a) => a.id !== exceptId).sort((a, b) => b.usedAt - a.usedAt)[0] || null;
}

// Zkratka z e-mailu nebo jména pro kolečko s písmenem.
export function accountInitial(a) {
  const s = (a?.username || a?.email || '?').trim();
  return (s.charAt(0) || '?').toLocaleUpperCase();
}
