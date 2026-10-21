// shortB (krátké knihy do 6 000 znaků): meze, kontrola vstupu při psaní a dělení textu na stránky karty. Čistá logika bez Reactu a bez sítě,
// jde testovat v Node (src/tests/shorts.test.mjs). Stejné meze hlídá i db/shorts.sql, test je porovnává.
import { cleanGenres, GENRE_MAX_LENGTH, GENRES_PER_BOOK } from '../browse/libraryModel.js';

export const SHORT_LIMITS = Object.freeze({
  body: 6000,
  title: 120,
  series: 80,
  seriesPartMax: 1000,
  genres: GENRES_PER_BOOK,
  genreLength: GENRE_MAX_LENGTH,
});

// Kolik znaků má jedna stránka karty ve feedu (6 000 znaků je zhruba 9 stránek). Čte se do strany, po poslední stránce se jde dolů na další shortB.
export const PAGE_CHARS = 700;

/** Počet znaků jako v databázi (char_length): emoji a znaky mimo základní rovinu se počítají za jeden. */
export const countChars = (text) => {
  let n = 0;
  // eslint-disable-next-line no-unused-vars
  for (const _ of String(text ?? '')) n += 1;
  return n;
};

/**
 * Zkontroluje a vyčistí shortB před uložením. Vrací { ok, errors, clean }: errors má klíče title, body, series (česká věta),
 * clean je to, co se pošle serveru (název bez okrajových mezer, vyčištěné žánry, série jen s číslem dílu).
 */
export function validateShort(input) {
  const errors = {};
  const title = String(input?.title ?? '').trim();
  const body = String(input?.body ?? '');
  const seriesName = String(input?.seriesName ?? '').trim();
  const rawPart = input?.seriesPart;
  const part = rawPart === '' || rawPart == null ? null : Number(rawPart);

  if (!title) errors.title = 'Doplň název.';
  else if (countChars(title) > SHORT_LIMITS.title) errors.title = `Název může mít nejvýš ${SHORT_LIMITS.title} znaků.`;

  const bodyChars = countChars(body);
  if (!body.trim()) errors.body = 'Doplň text.';
  else if (bodyChars > SHORT_LIMITS.body) errors.body = `Text má ${bodyChars} znaků, může jich mít nejvýš ${SHORT_LIMITS.body}.`;

  let series = null;
  let seriesPart = null;
  if (seriesName) {
    if (countChars(seriesName) > SHORT_LIMITS.series) errors.series = `Název série může mít nejvýš ${SHORT_LIMITS.series} znaků.`;
    else if (part === null || !Number.isInteger(part) || part < 1 || part > SHORT_LIMITS.seriesPartMax) errors.series = `U série doplň číslo dílu (1 až ${SHORT_LIMITS.seriesPartMax}).`;
    else { series = seriesName; seriesPart = part; }
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    clean: { title, body, genres: cleanGenres(Array.isArray(input?.genres) ? input.genres : []), seriesName: series, seriesPart },
  };
}

/** Žánry zapsané jako text oddělený čárkami (jak je píšou nakladatelé u knih) na seznam. */
export const parseGenresInput = (text) => cleanGenres(String(text ?? '').split(','));

// ---- dělení na stránky ----

// Věty (nebo zbytek bez tečky). Bez „lookbehind“ v regulárním výrazu, ten by ve starších prohlížečích rozbil načtení celého modulu.
const SENTENCE = /[^.!?…]*[.!?…]+["»”')\]]*\s*|[^.!?…]+$/g;

// Rozseká text bez mezer na kousky nejvýš limit znaků: nejraději na konci řádku nebo mezeře, jinak natvrdo (nikdy uprostřed dvojznaku).
function hardCut(text, limit) {
  const out = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = Math.max(rest.lastIndexOf('\n', limit), rest.lastIndexOf(' ', limit));
    if (cut < limit * 0.4) {
      cut = limit;
      const c = rest.charCodeAt(cut - 1);
      if (c >= 0xd800 && c <= 0xdbff) cut -= 1;
    }
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

// Odstavec nejvýš limit znaků zůstane celý; delší se rozdělí po větách (a věta delší než limit natvrdo).
function splitBlock(block, limit) {
  if (block.length <= limit) return [{ t: block, sep: '\n\n' }];
  const sentences = (block.match(SENTENCE) || [block]).flatMap((s) => (s.trim().length > limit ? hardCut(s.trim(), limit) : [s.trim()])).filter(Boolean);
  const chunks = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && cur.length + 1 + s.length > limit) { chunks.push(cur); cur = s; } else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) chunks.push(cur);
  // první kus začíná nový odstavec, další pokračují v témže (mezera, ne prázdný řádek)
  return chunks.map((t, i) => ({ t, sep: i === 0 ? '\n\n' : ' ' }));
}

const render = (pieces) => pieces.map((p, i) => (i === 0 ? p.t : p.sep + p.t)).join('');

/**
 * Rozdělí text na stránky nejvýš maxChars znaků (UTF-16): odstavce drží pohromadě, delší se dělí po větách, nejdelší natvrdo.
 * Prázdný text nemá žádnou stránku. Příliš krátká poslední stránka se připojí k předchozí (smí ji natáhnout o čtvrtinu).
 */
export function paginate(body, maxChars = PAGE_CHARS) {
  const text = String(body ?? '').replace(/\r\n?/g, '\n').trim();
  if (!text) return [];
  const limit = Math.max(50, Math.floor(maxChars));
  const pieces = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean).flatMap((b) => splitBlock(b, limit));

  const pages = [];
  let cur = [];
  for (const p of pieces) {
    if (cur.length && render([...cur, p]).length > limit) { pages.push(cur); cur = [p]; } else cur.push(p);
  }
  if (cur.length) pages.push(cur);

  if (pages.length > 1) {
    const last = render(pages[pages.length - 1]);
    const merged = [...pages[pages.length - 2], ...pages[pages.length - 1]];
    if (last.length < limit * 0.3 && render(merged).length <= limit * 1.25) pages.splice(pages.length - 2, 2, merged);
  }
  return pages.map(render);
}
