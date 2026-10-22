// Volání serveru pro shortB (db/shorts.sql). Klient (supabase) se předává zvenku, ať jde modul zkoušet bez prohlížeče.
// Čtení nikdy nevyhazuje chybu: dokud SQL v databázi neběží nebo když volání selže, vrací se prázdný výsledek s příznakem unavailable.
import { cleanGenres } from '../browse/libraryModel.js';
import { classifyError, FRIENDLY } from '../lib/friendlyError.js';

const int = (v, d = 0) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? n : d; };
const str = (v) => (typeof v === 'string' ? v : '');
const strOrNull = (v) => (typeof v === 'string' && v.trim() ? v : null);

// Řádek ze serveru na bezpečný tvar (camelCase, správné typy). Společné pole pro nabídku, text i moje shortB.
const base = (row) => ({
  id: str(row?.id),
  authorId: str(row?.author_id),
  authorName: str(row?.author_name) || 'Neznámý',
  title: str(row?.title),
  genres: cleanGenres(Array.isArray(row?.genres) ? row.genres : []),
  seriesName: strOrNull(row?.series_name),
  seriesPart: strOrNull(row?.series_name) ? int(row?.series_part, 1) : null,
  createdAt: str(row?.created_at),
  likes: Math.max(0, int(row?.likes)),
  myPagesSeen: Math.max(0, int(row?.my_pages_seen)),
  myFinished: row?.my_finished === true,
  myLiked: row?.my_liked === true,
});

/** Řádek z shorts_candidates(): nabídka bez textu. */
export const normalizeCandidate = (row) => ({
  ...base(row),
  chars: Math.max(0, int(row?.chars)),
  readers: Math.max(0, int(row?.readers)),
  finishedBy: Math.max(0, int(row?.finished_by)),
});

/** Řádek z shorts_get() nebo my_shorts(): včetně textu (u mých shortB i s počty a skrytím). */
export const normalizeShort = (row) => ({
  ...base(row),
  body: str(row?.body),
  isHidden: row?.is_hidden === true,
  updatedAt: str(row?.updated_at),
  readers: Math.max(0, int(row?.readers)),
  finished: Math.max(0, int(row?.finished)),
});

/** Řádek z my_short_signals(). */
export const normalizeSignal = (row) => ({
  shortId: str(row?.short_id),
  authorId: str(row?.author_id),
  genres: cleanGenres(Array.isArray(row?.genres) ? row.genres : []),
  seriesName: strOrNull(row?.series_name),
  seriesPart: strOrNull(row?.series_name) ? int(row?.series_part, 1) : null,
  pagesSeen: Math.max(0, int(row?.pages_seen)),
  pagesTotal: Math.max(1, int(row?.pages_total, 1)),
  finished: row?.finished === true,
  liked: row?.liked === true,
  dwellMs: Math.max(0, int(row?.dwell_ms)),
  updatedAt: str(row?.updated_at),
});

const rows = (data) => (Array.isArray(data) ? data : []);
const warn = (what, err) => console.warn(`${what}:`, err?.message || err);

/** Nabídka pro feed (až 300 nejnovějších viditelných shortB bez textu). */
export async function loadCandidates(client, limit = 150) {
  try {
    const { data, error } = await client.rpc('shorts_candidates', { p_limit: limit });
    if (error) throw error;
    return { items: rows(data).map(normalizeCandidate).filter((c) => c.id), unavailable: false };
  } catch (err) {
    warn('Nabídku shortB se nepodařilo načíst', err);
    return { items: [], unavailable: true };
  }
}

/** Texty vybraných shortB: Map(id -> shortB). Server bere nejvýš 20 id najednou, víc se posílá po dávkách. */
export async function loadShortsByIds(client, ids) {
  const out = new Map();
  const unique = [...new Set((ids || []).filter((id) => typeof id === 'string' && id))];
  for (let i = 0; i < unique.length; i += 20) {
    try {
      const { data, error } = await client.rpc('shorts_get', { p_ids: unique.slice(i, i + 20) });
      if (error) throw error;
      for (const row of rows(data)) { const s = normalizeShort(row); if (s.id) out.set(s.id, s); }
    } catch (err) {
      warn('Text shortB se nepodařilo načíst', err);
    }
  }
  return out;
}

/** Co čtenář v poslední době četl (podklad pro přizpůsobení). */
export async function loadSignals(client) {
  try {
    const { data, error } = await client.rpc('my_short_signals');
    if (error) throw error;
    return rows(data).map(normalizeSignal).filter((s) => s.shortId);
  } catch (err) {
    warn('Signály ze shortB se nepodařilo načíst', err);
    return [];
  }
}

/**
 * Nahlásí čtení jednoho shortB. liked: true/false nastaví lajk, undefined ho nechá. Vrací { ok, finished, liked, newlyFinished } nebo { ok: false }.
 * Hlášení se nesmí rozbít čtení: chyba se jen zaloguje.
 */
export async function reportShort(client, { shortId, pagesSeen, pagesTotal, dwellMs = 0, finished = false, liked }) {
  try {
    const { data, error } = await client.rpc('short_report', {
      p_short_id: shortId,
      p_pages_seen: Math.max(0, int(pagesSeen)),
      p_pages_total: Math.max(1, int(pagesTotal, 1)),
      p_dwell_ms: Math.max(0, int(dwellMs)),
      p_finished: finished === true,
      p_liked: typeof liked === 'boolean' ? liked : null,
    });
    if (error) throw error;
    return { ok: data?.ok === true, finished: data?.finished === true, liked: data?.liked === true, newlyFinished: data?.newly_finished === true };
  } catch (err) {
    warn('Čtení shortB se nepodařilo nahlásit', err);
    return { ok: false, finished: false, liked: false, newlyFinished: false };
  }
}

// ---- nakladatel ----

const ERROR_TEXT = {
  not_authenticated: 'Nejsi přihlášený.',
  forbidden: 'ShortB smí psát jen nakladatel nebo správce.',
  invalid_title: 'Doplň název (nejvýš 120 znaků).',
  invalid_body: 'Doplň text.',
  body_too_long: 'Text je delší než 6 000 znaků.',
  invalid_series: 'U série doplň číslo dílu a nepřeháněj délku názvu (nejvýš 80 znaků).',
  not_found: 'Tenhle shortB už neexistuje, nebo na něj nemáš oprávnění.',
};

/** Česká věta k chybě ze serveru (neznámá chyba dostane obecnou větu, aby se uživateli nezobrazil kód). */
export const shortErrorMessage = (err) => {
  const msg = String(err?.message || err || '');
  const code = Object.keys(ERROR_TEXT).find((k) => msg.includes(k));
  if (code) return ERROR_TEXT[code];
  if (/function .* does not exist|could not find the function|schema cache/i.test(msg)) return 'ShortB zatím nejsou v databázi nastavené.';
  const kind = classifyError(err);
  if (FRIENDLY[kind]) return FRIENDLY[kind];
  return 'ShortB se nepodařilo uložit. Zkus to znovu.';
};

/** Uloží nový (bez id) nebo upravený shortB. Vrací { id } nebo { error: česká věta }. Data už mají projít validateShort. */
export async function saveShort(client, { id = null, title, body, genres = [], seriesName = null, seriesPart = null, hidden = false }) {
  try {
    const { data, error } = await client.rpc('short_save', {
      p_id: id,
      p_title: title,
      p_body: body,
      p_genres: genres,
      p_series_name: seriesName,
      p_series_part: seriesPart,
      p_hidden: hidden === true,
    });
    if (error) throw error;
    return { id: str(data) };
  } catch (err) {
    return { error: shortErrorMessage(err) };
  }
}

export async function setShortHidden(client, id, hidden) {
  try {
    const { error } = await client.rpc('short_set_hidden', { p_id: id, p_hidden: hidden === true });
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    return { error: shortErrorMessage(err) };
  }
}

export async function deleteShort(client, id) {
  try {
    const { error } = await client.rpc('short_delete', { p_id: id });
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    return { error: shortErrorMessage(err) };
  }
}

/** Moje shortB (správce s all = true všechny): { items, unavailable }. */
export async function loadMyShorts(client, all = false) {
  try {
    const { data, error } = await client.rpc('my_shorts', { p_all: all === true });
    if (error) throw error;
    return { items: rows(data).map(normalizeShort).filter((s) => s.id), unavailable: false };
  } catch (err) {
    warn('Tvoje shortB se nepodařilo načíst', err);
    return { items: [], unavailable: true };
  }
}
