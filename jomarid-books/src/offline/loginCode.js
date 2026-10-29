// Přihlašovací kód: tvar, opis a volání serveru (db/login-code.sql, Edge Function db/auth/code-login.ts).
// Kód je 32 znaků 0-9 A-F, v zobrazení po čtyřech s pomlčkami. Klient ho posílá funkci code-login, ta vrátí jednorázový token a appka jím dokončí přihlášení.

export const CODE_LENGTH = 32;

// Z toho, co čtenář opsal nebo vložil (malá písmena, mezery, pomlčky navíc), udělá 32 znaků velkými písmeny; neplatný tvar vrací null.
export function normalizeCode(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw.replace(/[\s-]+/g, '').toUpperCase();
  return /^[0-9A-F]{32}$/.test(t) ? t : null;
}

// 3F9A-0C12-... (po čtyřech znacích)
export const formatCode = (raw) => (normalizeCode(raw) || '').replace(/(.{4})(?=.)/g, '$1-');

export const CODE_ERRORS = {
  invalid_input: 'Kód má 32 znaků (číslice a písmena A-F). Zkontroluj, jestli je celý.',
  invalid: 'Kód nesedí. Zkontroluj ho, nebo se přihlas heslem a v Nastavení si vygeneruj nový.',
  throttled: 'Moc pokusů. Zkus to za deset minut, nebo se přihlas heslem.',
  unavailable: 'Přihlášení kódem teď není dostupné. Přihlas se heslem.',
  offline: 'Bez internetu se kódem poprvé přihlásit nejde. Až budeš online, přihlásíš se a na tomto zařízení pak zůstaneš přihlášený i offline.',
  upstream: 'Přihlášení kódem se teď nepovedlo. Zkus to za chvíli, nebo se přihlas heslem.',
};

export class CodeLoginError extends Error {
  constructor(code, message) { super(message || CODE_ERRORS[code] || CODE_ERRORS.upstream); this.name = 'CodeLoginError'; this.code = code; }
}

// Přihlásí kódem: kód pošle funkci code-login, z odpovědi (token_hash) dokončí přihlášení v Supabase. Vrací data z verifyOtp (session, user).
// fetchImpl je tu kvůli testům.
export async function loginWithCode(client, { url, key }, rawCode, fetchImpl = (typeof fetch !== 'undefined' ? fetch : null)) {
  const code = normalizeCode(rawCode);
  if (!code) throw new CodeLoginError('invalid_input');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new CodeLoginError('offline');
  let res;
  try {
    res = await fetchImpl(`${url}/functions/v1/code-login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: key, authorization: `Bearer ${key}` },
      body: JSON.stringify({ code }),
    });
  } catch { throw new CodeLoginError('offline'); }
  let body = null;
  try { body = await res.json(); } catch { /* odpověď není JSON */ }
  if (!res.ok) {
    if (res.status === 404) throw new CodeLoginError('unavailable');
    const known = body && typeof body.error === 'string' && CODE_ERRORS[body.error] ? body.error : (res.status === 429 ? 'throttled' : res.status === 401 ? 'invalid' : res.status === 400 ? 'invalid_input' : 'upstream');
    throw new CodeLoginError(known);
  }
  const tokenHash = body && typeof body.token_hash === 'string' ? body.token_hash : '';
  if (!tokenHash) throw new CodeLoginError('upstream');
  const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
  if (error || !data?.session) throw new CodeLoginError('upstream');
  return data;
}

// Správa kódu v Nastavení (jen přihlášený čtenář)
export async function createLoginCode(client) {
  const { data, error } = await client.rpc('create_login_code');
  if (error) throw error;
  return typeof data === 'string' ? data : '';
}

export async function getLoginCodeInfo(client) {
  const { data, error } = await client.rpc('my_login_code');
  if (error) throw error;
  const d = data && typeof data === 'object' ? data : {};
  return { exists: d.exists === true, createdAt: d.created_at || null, lastUsedAt: d.last_used_at || null, useCount: Number(d.use_count) || 0 };
}

export async function revokeLoginCode(client) {
  const { data, error } = await client.rpc('revoke_login_code');
  if (error) throw error;
  return data === true;
}
