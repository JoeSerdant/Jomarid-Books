// Pořadí shortB ve feedu přizpůsobené čtenáři. Čistá logika bez Reactu a bez sítě, jde testovat v Node (src/tests/shorts.test.mjs).
//
// Vstup: nabídka ze serveru (shorts_candidates) a to, co o čtenáři víme: jaké shortB dočetl, olajkoval nebo přeskočil (my_short_signals)
// a jaké knihy čte (žánry a autoři přečtených, olajkovaných a rozečtených knih; série zatím mají jen shortB). Výstup: pořadí s důvodem,
// proč je shortB zrovna tady. Rozhoduje jednoduché skórování, žádná umělá inteligence: součet vah níž, trocha náhody a pravidla pro rozmanitost.
import { foldText } from '../browse/browseModel.js';

// Váhy jsou na jednom místě, ať se dají ladit. Skóre = součet příspěvků.
export const WEIGHTS = Object.freeze({
  genre: 3,            // oblíbený žánr (-1 až 1, průměr dvou nejlepších žánrů shortB)
  author: 1.5,         // oblíbený autor (-1 až 1)
  seriesNext: 4,       // další díl série, kterou čtenář čte
  seriesStart: 0.4,    // první díl série, kterou ještě nezná
  seriesCatchUp: 0.5,  // dřívější díl série, kterou čte (doplnit)
  seriesSkip: -0.8,    // střední díl série, kterou nezačal (bez dřívějších dílů)
  resume: 1.5,         // rozečtený shortB (viděl aspoň dvě stránky)
  skipped: -1,         // už ho viděl, ale nechal ho být hned po první stránce
  fresh: 1.5,          // čerstvost: polovina po 14 dnech
  popular: 0.3,        // log(1 + lajky)
  completion: 0.8,     // podíl dočtení u ostatních (až od 5 čtenářů)
  jitter: 0.8,         // náhoda, ať feed nebývá pořád stejný
});

const HALF_LIFE_SIGNAL_DAYS = 30;
const HALF_LIFE_FRESH_DAYS = 14;
const DAY = 86400000;
// Každé páté místo je průzkum: shortB z druhé poloviny pořadí, který čtenář ještě neviděl (jinak by feed uvízl v bublině).
export const EXPLORE_EVERY = 5;
// Víc než tolik shortB od jednoho autora za sebou feed nepustí, dokud je z čeho vybrat.
export const MAX_AUTHOR_RUN = 2;

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const decay = (ageDays, halfLife) => 0.5 ** (Math.max(0, ageDays) / halfLife);

// Malý deterministický generátor (mulberry32): stejný seed = stejné pořadí, takže feed jde testovat i obnovit.
export function makeRng(seed) {
  let a = (Number.isFinite(Number(seed)) ? Number(seed) : 1) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const bump = (map, key, w, extra) => {
  if (!key) return;
  const cur = map.get(key) || { weight: 0 };
  cur.weight += w;
  if (extra) extra(cur);
  map.set(key, cur);
};

/**
 * Z toho, co čtenář dělal, sestaví chuť: váhy žánrů, autorů a sérií (nové a oblíbené váží víc, po 30 dnech se váha půlí).
 * signals: řádky z my_short_signals (po normalizaci), books: [{ authorId, genres, isRead, liked, inProgress }] z knihovny.
 * Váhy žánrů a autorů jsou na konci vydělené největší absolutní hodnotou, takže leží v rozmezí -1 až 1.
 */
export function buildPreferences({ signals = [], books = [], now = Date.now() } = {}) {
  const genres = new Map();
  const authors = new Map();
  const series = new Map();
  let used = 0;

  for (const s of signals) {
    const ageDays = (now - (Date.parse(s.updatedAt) || now)) / DAY;
    const seen = num(s.pagesSeen);
    const skipped = !s.finished && seen <= 1 && num(s.dwellMs) < 2500;
    let w = 0;
    if (s.finished) w += 1;
    else if (seen >= 2) w += 0.3;
    if (s.liked) w += 2;
    if (skipped) w -= 0.6;
    w += Math.min(num(s.dwellMs) / 60000, 1) * 0.3;
    w *= decay(ageDays, HALF_LIFE_SIGNAL_DAYS);
    if (w === 0) continue;
    used += 1;
    for (const g of s.genres || []) bump(genres, foldText(g), w);
    bump(authors, s.authorId, w);
    if (s.seriesName) {
      bump(series, foldText(s.seriesName), w, (e) => {
        e.finished = e.finished || new Set();
        e.seen = e.seen || new Set();
        if (s.finished) e.finished.add(num(s.seriesPart));
        if (seen >= 1) e.seen.add(num(s.seriesPart));
      });
    }
  }

  // Knihy: dlouhodobá chuť. Přečtená a olajkovaná kniha váží víc než rozečtená.
  for (const b of books) {
    const w = (b.isRead ? 0.8 : 0) + (b.liked ? 0.8 : 0) + (b.inProgress && !b.isRead ? 0.4 : 0);
    if (w === 0) continue;
    used += 1;
    for (const g of b.genres || []) bump(genres, foldText(g), w);
    bump(authors, b.authorId, w);
  }

  const normalize = (map) => {
    let max = 0;
    for (const v of map.values()) max = Math.max(max, Math.abs(v.weight));
    if (max > 0) for (const v of map.values()) v.weight /= max;
  };
  normalize(genres);
  normalize(authors);
  return { genres, authors, series, hasSignals: used > 0 };
}

// Další díl série: první nedočtený díl po nejvyšším dočteném (série se čtou popořadě).
export function nextSeriesPart(pref) {
  if (!pref?.finished || pref.finished.size === 0) return null;
  return Math.max(...pref.finished) + 1;
}

/** Skóre jednoho shortB a důvod, proč je tady. Dočtený shortB se nenabízí (skóre -Infinity). */
export function scoreCandidate(c, prefs, { now = Date.now(), rng = Math.random } = {}) {
  if (c.myFinished) return { score: -Infinity, reason: 'finished' };

  let score = 0;
  let reason = 'fresh';
  let best = 0;
  const give = (value, why) => { score += value; if (value > best) { best = value; reason = why; } };

  // žánry: průměr dvou nejlepších (jeden trefený žánr nestačí, ale dva shodné ještě pomůžou)
  const gw = (c.genres || []).map((g) => prefs.genres.get(foldText(g))?.weight ?? 0).sort((a, b) => b - a).slice(0, 2);
  if (gw.length) give(WEIGHTS.genre * (gw.reduce((a, b) => a + b, 0) / gw.length), 'taste');
  give(WEIGHTS.author * (prefs.authors.get(c.authorId)?.weight ?? 0), 'author');

  if (c.seriesName) {
    const pref = prefs.series.get(foldText(c.seriesName));
    const part = num(c.seriesPart, 1);
    if (pref) {
      const next = nextSeriesPart(pref);
      if (pref.finished?.has(part)) return { score: -Infinity, reason: 'finished' };
      if (next === part) give(WEIGHTS.seriesNext, 'series');
      else if (next !== null && part < next) give(WEIGHTS.seriesCatchUp, 'series');
      else if (part > 1 && next === null) give(WEIGHTS.seriesSkip, 'taste');
    } else if (part === 1) {
      give(WEIGHTS.seriesStart, 'taste');
    } else if (part > 1) {
      give(WEIGHTS.seriesSkip, 'taste');
    }
  }

  if (c.myPagesSeen >= 2) give(WEIGHTS.resume, 'resume');
  else if (c.myPagesSeen === 1) give(WEIGHTS.skipped, 'skipped');

  const ageDays = (now - (Date.parse(c.createdAt) || now)) / DAY;
  give(WEIGHTS.fresh * decay(ageDays, HALF_LIFE_FRESH_DAYS), 'fresh');
  give(WEIGHTS.popular * Math.log1p(Math.max(0, num(c.likes))), 'popular');
  if (num(c.readers) >= 5) give(WEIGHTS.completion * (num(c.finishedBy) / num(c.readers)), 'popular');
  score += WEIGHTS.jitter * rng();
  return { score, reason };
}

/**
 * Seřadí nabídku do feedu: nejvyšší skóre první, od jednoho autora nejvýš MAX_AUTHOR_RUN za sebou a každé páté místo průzkum.
 * Vrací [{ id, score, reason }]; dočtené shortB v něm nejsou. Stejný seed dá stejné pořadí.
 */
export function rankFeed(candidates, prefs, { now = Date.now(), seed = 1 } = {}) {
  const rng = makeRng(seed);
  const scored = [];
  for (const c of candidates || []) {
    const { score, reason } = scoreCandidate(c, prefs, { now, rng });
    if (score === -Infinity) continue;
    scored.push({ id: c.id, authorId: c.authorId, score, reason, unseen: !(c.myPagesSeen > 0) });
  }
  scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));

  const lowerHalf = new Set(scored.slice(Math.floor(scored.length / 2)).map((s) => s.id));
  const pool = [...scored];
  const out = [];
  const take = (idx, forced) => {
    const [item] = pool.splice(idx, 1);
    out.push({ id: item.id, score: item.score, reason: forced || item.reason });
  };
  const authorOf = new Map(scored.map((s) => [s.id, s.authorId]));
  const tailRun = (authorId) => {
    let n = 0;
    for (let i = out.length - 1; i >= 0 && authorOf.get(out[i].id) === authorId; i -= 1) n += 1;
    return n;
  };

  while (pool.length) {
    const position = out.length + 1;
    if (position % EXPLORE_EVERY === 0) {
      const options = pool.map((p, i) => [p, i]).filter(([p]) => p.unseen && lowerHalf.has(p.id) && tailRun(p.authorId) < MAX_AUTHOR_RUN);
      if (options.length) { take(options[Math.floor(rng() * options.length)][1], 'explore'); continue; }
    }
    const idx = pool.findIndex((p) => tailRun(p.authorId) < MAX_AUTHOR_RUN);
    take(idx === -1 ? 0 : idx);
  }
  return out;
}

/** Krátký český popisek důvodu pro kartu ve feedu (prázdný, když není co říct). */
export const reasonLabel = (reason, c) => {
  switch (reason) {
    case 'series': return c?.seriesName ? `Další díl: ${c.seriesName}` : 'Další díl série';
    case 'resume': return 'Rozečtené';
    case 'taste': return 'Podle toho, co čteš';
    case 'author': return 'Od autora, kterého čteš';
    case 'explore': return 'Něco nového';
    case 'fresh': return 'Čerstvé';
    case 'popular': return 'Oblíbené';
    default: return '';
  }
};
