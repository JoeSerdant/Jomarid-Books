// Testy shortB (krátké knihy ve feedu): kontrola vstupu, dělení na stránky, přizpůsobené pořadí, volání serveru a shoda se SQL.
//   npm run test:shorts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHORT_LIMITS, PAGE_CHARS, countChars, validateShort, parseGenresInput, paginate } from '../shorts/shortsModel.js';
import { WEIGHTS, EXPLORE_EVERY, MAX_AUTHOR_RUN, makeRng, buildPreferences, nextSeriesPart, scoreCandidate, rankFeed, reasonLabel } from '../shorts/shortsRanking.js';
import { normalizeCandidate, normalizeShort, normalizeSignal, loadCandidates, loadShortsByIds, loadSignals, reportShort, saveShort, setShortHidden, deleteShort, loadMyShorts, shortErrorMessage } from '../shorts/shortsApi.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = fs.readFileSync(path.join(SRC, '..', 'db', 'shorts.sql'), 'utf8');
const NOW = Date.parse('2026-10-21T12:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();
const quiet = async (fn) => { const w = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = w; } };

/* ---------------------------------------------------------------- kontrola vstupu */
test('countChars počítá znaky jako databáze (emoji a znaky mimo základní rovinu za jeden)', () => {
  assert.equal(countChars('Žluťoučký kůň'), 13);
  assert.equal(countChars('😀😀'), 2);
  assert.equal(countChars('a'.repeat(6000)), 6000);
  assert.equal(countChars(null), 0);
  assert.equal(countChars(undefined), 0);
});

test('validateShort: název, text do 6 000 znaků, série jen s číslem dílu, žánry se čistí', () => {
  const good = validateShort({ title: '  Dům u lesa ', body: 'Text.', genres: ['  Horor ', 'horor', 'Thriller'], seriesName: ' Lesní kronika ', seriesPart: '2' });
  assert.ok(good.ok);
  assert.deepEqual(good.clean, { title: 'Dům u lesa', body: 'Text.', genres: ['Horor', 'Thriller'], seriesName: 'Lesní kronika', seriesPart: 2 });
  assert.match(validateShort({ title: ' ', body: 'x' }).errors.title, /název/i);
  assert.match(validateShort({ title: 'x'.repeat(121), body: 'x' }).errors.title, /120/);
  assert.ok(validateShort({ title: 'x'.repeat(120), body: 'x' }).ok);
  assert.match(validateShort({ title: 'x', body: '  \n ' }).errors.body, /text/i);
  assert.ok(validateShort({ title: 'x', body: 'a'.repeat(6000) }).ok, '6 000 znaků projde');
  assert.match(validateShort({ title: 'x', body: 'a'.repeat(6001) }).errors.body, /6001.*6000/, 'věta ukáže, kolik znaků je a kolik smí být');
  assert.ok(validateShort({ title: 'x', body: '😀'.repeat(6000) }).ok, 'emoji se počítají za jeden znak');
  for (const part of [null, '', 0, 1001, 1.5, 'abc']) assert.match(validateShort({ title: 'x', body: 'x', seriesName: 'S', seriesPart: part }).errors.series, /číslo dílu/, String(part));
  assert.match(validateShort({ title: 'x', body: 'x', seriesName: 's'.repeat(81), seriesPart: 1 }).errors.series, /80/);
  const noSeries = validateShort({ title: 'x', body: 'x', seriesName: '   ', seriesPart: 7 });
  assert.ok(noSeries.ok && noSeries.clean.seriesName === null && noSeries.clean.seriesPart === null, 'prázdný název série zruší i číslo dílu');
  assert.deepEqual(validateShort({ title: 'x', body: 'x', genres: 'ne pole' }).clean.genres, []);
  assert.equal(validateShort(undefined).ok, false);
});

test('parseGenresInput: žánry odděleny čárkami, vyčištěné', () => {
  assert.deepEqual(parseGenresInput(' Horor, horor ,Sci-fi,, '), ['Horor', 'Sci-fi']);
  assert.deepEqual(parseGenresInput(''), []);
  assert.deepEqual(parseGenresInput(null), []);
});

/* ---------------------------------------------------------------- stránky */
const words = (s) => s.split(/\s+/).filter(Boolean);

test('paginate: prázdný text nemá stránky, krátký text je jedna stránka', () => {
  assert.deepEqual(paginate(''), []);
  assert.deepEqual(paginate('  \n\n '), []);
  assert.deepEqual(paginate(null), []);
  assert.deepEqual(paginate('Krátký text.'), ['Krátký text.']);
  assert.deepEqual(paginate('Řádek 1\r\nŘádek 2'), ['Řádek 1\nŘádek 2'], 'konce řádků se sjednotí');
});

test('paginate: stránky nepřekročí limit a nic se neztratí ani nezdvojí (slova zůstanou v pořadí)', () => {
  const para = (n) => Array.from({ length: n }, (_, i) => `Věta číslo ${i + 1} je docela obyčejná a pokračuje dál.`).join(' ');
  const text = [para(3), para(20), 'Krátký odstavec.', para(8), 'Konec.'].join('\n\n');
  const pages = paginate(text);
  assert.ok(pages.length > 3);
  for (const p of pages) assert.ok(p.length > 0 && p.length <= PAGE_CHARS * 1.25, `stránka ${p.length} znaků`);
  assert.deepEqual(words(pages.join(' ')), words(text));
});

test('paginate: odstavce drží pohromadě a mezi odstavci je prázdný řádek, uvnitř dlouhého odstavce ne', () => {
  const pages = paginate('První odstavec.\n\nDruhý odstavec.\n\nTřetí odstavec.');
  assert.deepEqual(pages, ['První odstavec.\n\nDruhý odstavec.\n\nTřetí odstavec.']);
  const long = Array.from({ length: 40 }, (_, i) => `Věta ${i + 1} má pár slov.`).join(' ');
  const split = paginate(`${long}\n\nDalší odstavec.`, 300);
  assert.ok(split.length > 2);
  for (const p of split.slice(0, -1)) assert.doesNotMatch(p, /\n\n/, 'v rozděleném odstavci nevzniká prázdný řádek');
});

test('paginate: věta delší než stránka a text bez mezer se rozseknou, dvojznaky se nerozříznou', () => {
  const noSpaces = 'x'.repeat(2000);
  const pages = paginate(noSpaces, 700);
  assert.ok(pages.every((p) => p.length <= 700) && pages.join('') === noSpaces);
  const emoji = '😀'.repeat(900);
  const ep = paginate(emoji, 700);
  assert.ok(ep.length >= 2 && ep.every((p) => p.length <= 700) && ep.join('') === emoji, 'emoji se nerozdělí uprostřed');
  const poem = Array.from({ length: 60 }, (_, i) => `Verš číslo ${i + 1} bez tečky`).join('\n');
  const poemPages = paginate(poem, 400);
  assert.ok(poemPages.length > 2 && poemPages.every((p) => p.length <= 400));
  assert.deepEqual(words(poemPages.join(' ')), words(poem));
});

test('paginate: příliš krátká poslední stránka se připojí k předchozí, jinak zůstane', () => {
  const sentence = 'Tohle je věta o přibližně čtyřiceti znacích.';
  const body = (n) => Array.from({ length: n }, () => sentence).join(' ') + '\n\nKonec.';
  const pages = paginate(body(15), 700);
  assert.ok(pages[pages.length - 1].length >= 20 || pages.length === 1);
  assert.ok(!pages.some((p, i) => i === pages.length - 1 && p === 'Konec.'), 'jednoslovná poslední stránka nezůstane sama');
});

test('paginate: 6 000 znaků je zhruba 9 až 12 stránek (jako karusel)', () => {
  const body = Array.from({ length: 50 }, (_, i) => `Odstavec ${i + 1}. ${'Slovo '.repeat(20)}`.trim()).join('\n\n').slice(0, 6000);
  const pages = paginate(body);
  assert.ok(pages.length >= 8 && pages.length <= 12, `stránek: ${pages.length}`);
});

/* ---------------------------------------------------------------- pořadí */
const cand = (over = {}) => ({ id: 'x', authorId: 'a1', authorName: 'A', title: 'T', genres: [], seriesName: null, seriesPart: null, createdAt: daysAgo(1), chars: 3000, likes: 0, readers: 0, finishedBy: 0, myPagesSeen: 0, myFinished: false, myLiked: false, ...over });
const sig = (over = {}) => ({ shortId: 's', authorId: 'a1', genres: [], seriesName: null, seriesPart: null, pagesSeen: 3, pagesTotal: 3, finished: true, liked: false, dwellMs: 30000, updatedAt: daysAgo(1), ...over });
const score = (c, prefs) => scoreCandidate(c, prefs, { now: NOW, rng: () => 0 });
const prefsOf = (signals = [], books = []) => buildPreferences({ signals, books, now: NOW });

test('makeRng: stejný seed dává stejnou řadu čísel v rozmezí 0 až 1', () => {
  const a = makeRng(42); const b = makeRng(42); const c = makeRng(43);
  const sa = Array.from({ length: 5 }, a); const sb = Array.from({ length: 5 }, b); const sc = Array.from({ length: 5 }, c);
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  assert.ok(sa.every((x) => x >= 0 && x < 1));
});

test('buildPreferences: dočtené a olajkované shortB zvedají žánr a autora, přeskočené je shazují, stará data slábnou', () => {
  const p = prefsOf([
    sig({ shortId: '1', genres: ['Horor'], authorId: 'a1', finished: true, liked: true }),
    sig({ shortId: '2', genres: ['Romance'], authorId: 'a2', finished: false, pagesSeen: 1, dwellMs: 800 }),
  ]);
  assert.ok(p.hasSignals);
  assert.equal(p.genres.get('horor').weight, 1, 'nejsilnější žánr je 1');
  assert.ok(p.genres.get('romance').weight < 0, 'přeskočený žánr je záporný');
  assert.ok(p.authors.get('a1').weight > 0 && p.authors.get('a2').weight < 0);
  const old = prefsOf([sig({ genres: ['Horor'], updatedAt: daysAgo(300) }), sig({ shortId: '2', genres: ['Drama'], updatedAt: daysAgo(1) })]);
  assert.ok(old.genres.get('drama').weight > old.genres.get('horor').weight, 'dávný signál váží míň než čerstvý');
});

test('buildPreferences: knihy (přečtené, olajkované, rozečtené) přidávají žánry a autory; bez signálů je hasSignals false', () => {
  assert.equal(prefsOf().hasSignals, false);
  assert.equal(prefsOf([], [{ authorId: 'a9', genres: ['Fantasy'], isRead: false, liked: false, inProgress: false }]).hasSignals, false, 'nepřečtená nelajkovaná kniha nic neříká');
  const p = prefsOf([], [
    { authorId: 'a1', genres: ['Fantasy', 'Dobrodružství'], isRead: true, liked: true, inProgress: false },
    { authorId: 'a2', genres: ['Poezie'], isRead: false, liked: false, inProgress: true },
  ]);
  assert.ok(p.hasSignals);
  assert.ok(p.genres.get('fantasy').weight > p.genres.get('poezie').weight, 'přečtená a olajkovaná kniha váží víc než rozečtená');
  assert.ok(p.authors.get('a1').weight === 1);
});

test('buildPreferences: žánry se porovnávají bez ohledu na velikost písmen a diakritiku', () => {
  const p = prefsOf([sig({ genres: ['Sci-Fi', 'Dobrodružný'] })]);
  assert.ok(score(cand({ genres: ['sci-fi'] }), p).score > score(cand({ genres: ['drama'] }), p).score);
  assert.ok(score(cand({ genres: ['DOBRODRUZNY'] }), p).score > score(cand({ genres: ['drama'] }), p).score);
});

test('série: po dočtení dílu 1 je díl 2 nahoře; dočtený díl se nenabízí; dřívější díl se přidá s menší vahou', () => {
  const p = prefsOf([sig({ seriesName: 'Lesní kronika', seriesPart: 1 }), sig({ shortId: '2', seriesName: 'Lesní kronika', seriesPart: 2 })]);
  assert.equal(nextSeriesPart(p.series.get('lesni kronika')), 3);
  const next = score(cand({ seriesName: 'Lesní kronika', seriesPart: 3 }), p);
  assert.equal(next.reason, 'series');
  assert.ok(next.score > WEIGHTS.seriesNext - 1);
  assert.equal(score(cand({ seriesName: 'Lesní kronika', seriesPart: 2 }), p).score, -Infinity, 'dočtený díl se nenabízí');
  const p2 = prefsOf([sig({ seriesName: 'Lesní kronika', seriesPart: 3 })]);
  assert.ok(score(cand({ seriesName: 'Lesní kronika', seriesPart: 1 }), p2).score > score(cand({ seriesName: 'Cizí', seriesPart: 4, genres: [] }), p2).score - 1, 'dřívější díl se přidá');
  assert.equal(score(cand({ seriesName: 'Lesní kronika', seriesPart: 4 }), p2).reason, 'series');
  assert.equal(nextSeriesPart(undefined), null);
});

test('série: první díl neznámé série dostane malý bonus, střední díl neznámé série malý malus', () => {
  const p = prefsOf();
  const first = score(cand({ seriesName: 'Nová', seriesPart: 1 }), p).score;
  const plain = score(cand(), p).score;
  const mid = score(cand({ seriesName: 'Nová', seriesPart: 4 }), p).score;
  assert.ok(first > plain && mid < plain);
});

test('scoreCandidate: dočtený shortB je mimo, rozečtený se připomene, přeskočený klesne, čerstvější a oblíbenější je výš', () => {
  const p = prefsOf();
  assert.equal(score(cand({ myFinished: true }), p).score, -Infinity);
  assert.equal(score(cand({ myPagesSeen: 3 }), p).reason, 'resume');
  assert.ok(score(cand({ myPagesSeen: 1 }), p).score < score(cand(), p).score, 'viděná jen první stránka klesne');
  assert.ok(score(cand({ createdAt: daysAgo(1) }), p).score > score(cand({ createdAt: daysAgo(60) }), p).score);
  assert.ok(score(cand({ likes: 50 }), p).score > score(cand({ likes: 0 }), p).score);
  assert.ok(score(cand({ readers: 10, finishedBy: 9 }), p).score > score(cand({ readers: 10, finishedBy: 1 }), p).score, 'míra dočtení se bere od 5 čtenářů');
  assert.equal(score(cand({ readers: 4, finishedBy: 4 }), p).score, score(cand({ readers: 4, finishedBy: 0 }), p).score, 'u méně než 5 čtenářů se míra nepočítá');
});

test('scoreCandidate: náhoda přidá nejvýš váhu jitter a stejný rng dá stejné skóre', () => {
  const p = prefsOf();
  const lo = scoreCandidate(cand(), p, { now: NOW, rng: () => 0 }).score;
  const hi = scoreCandidate(cand(), p, { now: NOW, rng: () => 0.999999 }).score;
  assert.ok(hi - lo <= WEIGHTS.jitter && hi > lo);
});

test('rankFeed: oblíbený žánr je výš než cizí, dočtené nejsou, výsledek má důvod a stejný seed dá stejné pořadí', () => {
  const p = prefsOf([sig({ genres: ['Horor'], liked: true })]);
  const items = [
    cand({ id: 'h1', authorId: 'a1', genres: ['Horor'] }), cand({ id: 'd1', authorId: 'a2', genres: ['Drama'] }),
    cand({ id: 'h2', authorId: 'a3', genres: ['Horor'] }), cand({ id: 'done', authorId: 'a4', genres: ['Horor'], myFinished: true }),
  ];
  const feed = rankFeed(items, p, { now: NOW, seed: 7 });
  assert.equal(feed.length, 3, 'dočtený je pryč');
  assert.ok(!feed.some((f) => f.id === 'done'));
  assert.ok(feed.findIndex((f) => f.id === 'd1') > feed.findIndex((f) => f.id === 'h1'));
  assert.ok(feed.every((f) => typeof f.reason === 'string' && Number.isFinite(f.score)));
  assert.deepEqual(rankFeed(items, p, { now: NOW, seed: 7 }), feed);
  assert.deepEqual(rankFeed([], p, { now: NOW }), []);
  assert.deepEqual(rankFeed(undefined, p, { now: NOW }), []);
});

test('rankFeed: od jednoho autora nejvýš dva za sebou, dokud je z čeho vybrat', () => {
  const p = prefsOf([sig({ genres: ['Horor'], authorId: 'a1', liked: true })]);
  const items = [
    ...Array.from({ length: 6 }, (_, i) => cand({ id: `a1-${i}`, authorId: 'a1', genres: ['Horor'] })),
    ...Array.from({ length: 6 }, (_, i) => cand({ id: `b-${i}`, authorId: `b${i}`, genres: ['Drama'] })),
  ];
  const feed = rankFeed(items, p, { now: NOW, seed: 3 });
  const author = new Map(items.map((c) => [c.id, c.authorId]));
  let run = 0; let prev = null; let maxRun = 0;
  for (const f of feed.slice(0, 9)) { const a = author.get(f.id); run = a === prev ? run + 1 : 1; prev = a; maxRun = Math.max(maxRun, run); }
  assert.ok(maxRun <= MAX_AUTHOR_RUN, `nejdelší řada od jednoho autora: ${maxRun}`);
  assert.equal(feed.length, 12, 'nic se neztratí');
  const onlyOne = rankFeed(Array.from({ length: 5 }, (_, i) => cand({ id: `s${i}`, authorId: 'same' })), prefsOf(), { now: NOW });
  assert.equal(onlyOne.length, 5, 'když je jediný autor, feed ho pustí celého');
});

test('rankFeed: každé páté místo je průzkum (neviděný shortB z horší poloviny)', () => {
  const p = prefsOf([sig({ genres: ['Horor'], liked: true })]);
  const items = [
    ...Array.from({ length: 10 }, (_, i) => cand({ id: `h${i}`, authorId: `ah${i}`, genres: ['Horor'] })),
    ...Array.from({ length: 10 }, (_, i) => cand({ id: `d${i}`, authorId: `ad${i}`, genres: ['Drama'] })),
  ];
  const feed = rankFeed(items, p, { now: NOW, seed: 5 });
  const explore = feed.filter((f, i) => (i + 1) % EXPLORE_EVERY === 0);
  assert.ok(explore.length >= 3);
  assert.ok(explore.some((f) => f.reason === 'explore' && f.id.startsWith('d')), 'průzkum sáhne k jinému žánru');
  const seenOnly = items.map((c) => ({ ...c, myPagesSeen: 1 }));
  assert.ok(rankFeed(seenOnly, p, { now: NOW, seed: 5 }).every((f) => f.reason !== 'explore'), 'viděné shortB se jako průzkum nenabízejí');
});

test('rankFeed: bez signálů rozhoduje čerstvost a oblíbenost', () => {
  const feed = rankFeed([cand({ id: 'old', authorId: 'a', createdAt: daysAgo(90) }), cand({ id: 'new', authorId: 'b', createdAt: daysAgo(0) }), cand({ id: 'liked', authorId: 'c', createdAt: daysAgo(90), likes: 200 })], prefsOf(), { now: NOW, seed: 1 });
  assert.ok(feed.findIndex((f) => f.id === 'new') < feed.findIndex((f) => f.id === 'old'));
  assert.ok(feed.findIndex((f) => f.id === 'liked') < feed.findIndex((f) => f.id === 'old'));
});

test('reasonLabel: české popisky důvodů', () => {
  assert.equal(reasonLabel('series', { seriesName: 'Lesní kronika' }), 'Další díl: Lesní kronika');
  assert.equal(reasonLabel('series'), 'Další díl série');
  for (const r of ['resume', 'taste', 'author', 'explore', 'fresh', 'popular']) assert.ok(reasonLabel(r).length > 3, r);
  assert.equal(reasonLabel('skipped'), '');
  assert.equal(reasonLabel('finished'), '');
});

/* ---------------------------------------------------------------- server */
const fakeClient = (handlers) => ({ rpc: async (name, args) => { const h = handlers[name]; if (!h) return { data: null, error: { message: 'Could not find the function public.' + name + ' in the schema cache' } }; return h(args); } });

test('normalize*: špatné typy se srovnají, série bez názvu nemá díl, žánry se čistí', () => {
  const c = normalizeCandidate({ id: 'x', author_id: 'a', author_name: '', title: 5, genres: ['Horor', 'horor', 7], series_name: '  ', series_part: 3, created_at: '2026-01-01', likes: '4', readers: -1, finished_by: 'x', my_pages_seen: 2.9, my_finished: 'true', my_liked: true, chars: 100 });
  assert.deepEqual(c, { id: 'x', authorId: 'a', authorName: 'Neznámý', title: '', genres: ['Horor'], seriesName: null, seriesPart: null, createdAt: '2026-01-01', likes: 4, myPagesSeen: 2, myFinished: false, myLiked: true, chars: 100, readers: 0, finishedBy: 0 });
  const s = normalizeShort({ id: 'y', author_id: 'a', author_name: 'J. Pero', title: 'T', body: 'B', series_name: 'S', series_part: 2, is_hidden: true, readers: 5, finished: 2, likes: 1 });
  assert.equal(s.seriesName, 'S'); assert.equal(s.seriesPart, 2); assert.equal(s.isHidden, true); assert.equal(s.readers, 5); assert.equal(s.finished, 2); assert.equal(s.body, 'B');
  assert.equal(normalizeShort(null).id, '');
  const g = normalizeSignal({ short_id: 's', genres: null, pages_total: 0, dwell_ms: -5, finished: 1 });
  assert.deepEqual([g.genres, g.pagesTotal, g.dwellMs, g.finished], [[], 1, 0, false]);
});

test('loadCandidates / loadSignals / loadMyShorts: úspěch, chyba serveru i chybějící funkce vrací prázdné a nic nehodí', async () => {
  const ok = await loadCandidates(fakeClient({ shorts_candidates: async (a) => ({ data: [{ id: 'a', title: 'T', limit: a.p_limit }, { id: '' }, null], error: null }) }), 50);
  assert.equal(ok.items.length, 1); assert.equal(ok.unavailable, false);
  assert.deepEqual(await quiet(() => loadCandidates(fakeClient({}))), { items: [], unavailable: true }, 'SQL ještě neběží');
  assert.deepEqual(await quiet(() => loadCandidates(fakeClient({ shorts_candidates: async () => { throw new Error('síť'); } }))), { items: [], unavailable: true });
  assert.deepEqual(await quiet(() => loadSignals(fakeClient({}))), []);
  assert.equal((await loadSignals(fakeClient({ my_short_signals: async () => ({ data: [{ short_id: 's' }, { short_id: '' }], error: null }) }))).length, 1);
  assert.deepEqual(await quiet(() => loadMyShorts(fakeClient({}), true)), { items: [], unavailable: true });
  let sent;
  await loadMyShorts(fakeClient({ my_shorts: async (a) => { sent = a; return { data: [], error: null }; } }), true);
  assert.deepEqual(sent, { p_all: true });
});

test('loadShortsByIds: posílá po dávkách do 20 id, zahodí duplicity a prázdná id, jedna špatná dávka neshodí ostatní', async () => {
  const calls = [];
  const ids = Array.from({ length: 45 }, (_, i) => `id${i}`);
  const map = await loadShortsByIds(fakeClient({ shorts_get: async (a) => { calls.push(a.p_ids.length); return { data: a.p_ids.map((id) => ({ id, title: id })), error: null }; } }), [...ids, 'id0', '', null, 7]);
  assert.deepEqual(calls, [20, 20, 5]);
  assert.equal(map.size, 45);
  let n = 0;
  const partial = await quiet(() => loadShortsByIds(fakeClient({ shorts_get: async (a) => { n += 1; return n === 2 ? { data: null, error: { message: 'x' } } : { data: a.p_ids.map((id) => ({ id })), error: null }; } }), ids));
  assert.equal(partial.size, 25, 'druhá dávka selhala, první a třetí jsou');
  assert.equal((await loadShortsByIds(fakeClient({}), [])).size, 0);
});

test('reportShort: pošle srovnané hodnoty, lajk jen když je zadaný, chybu jen zaloguje', async () => {
  let sent;
  const client = fakeClient({ short_report: async (a) => { sent = a; return { data: { ok: true, finished: true, liked: false, newly_finished: true }, error: null }; } });
  const r = await reportShort(client, { shortId: 's1', pagesSeen: 3.7, pagesTotal: 0, dwellMs: -4, finished: true });
  assert.deepEqual(sent, { p_short_id: 's1', p_pages_seen: 3, p_pages_total: 1, p_dwell_ms: 0, p_finished: true, p_liked: null });
  assert.deepEqual(r, { ok: true, finished: true, liked: false, newlyFinished: true });
  await reportShort(client, { shortId: 's1', pagesSeen: 1, pagesTotal: 2, liked: true });
  assert.equal(sent.p_liked, true);
  await reportShort(client, { shortId: 's1', pagesSeen: 1, pagesTotal: 2, liked: false });
  assert.equal(sent.p_liked, false);
  assert.deepEqual(await quiet(() => reportShort(fakeClient({}), { shortId: 's', pagesSeen: 1, pagesTotal: 1 })), { ok: false, finished: false, liked: false, newlyFinished: false });
});

test('saveShort / setShortHidden / deleteShort: vrací id nebo českou větu místo chyby', async () => {
  let sent;
  const client = fakeClient({ short_save: async (a) => { sent = a; return { data: 'new-id', error: null }; }, short_set_hidden: async () => ({ data: null, error: null }), short_delete: async () => ({ data: null, error: { message: 'not_found' } }) });
  assert.deepEqual(await saveShort(client, { title: 'T', body: 'B', genres: ['Horor'], seriesName: 'S', seriesPart: 2 }), { id: 'new-id' });
  assert.deepEqual(sent, { p_id: null, p_title: 'T', p_body: 'B', p_genres: ['Horor'], p_series_name: 'S', p_series_part: 2, p_hidden: false });
  assert.deepEqual(await setShortHidden(client, 'x', true), { ok: true });
  assert.match((await deleteShort(client, 'x')).error, /neexistuje/);
  assert.match((await saveShort(fakeClient({ short_save: async () => ({ data: null, error: { message: 'forbidden' } }) }), { title: 'T', body: 'B' })).error, /nakladatel/);
  assert.match((await saveShort(fakeClient({}), { title: 'T', body: 'B' })).error, /nejsou v databázi/);
  assert.match((await saveShort(fakeClient({ short_save: async () => { throw new Error('divná chyba'); } }), { title: 'T', body: 'B' })).error, /nepodařilo uložit/);
  for (const code of ['not_authenticated', 'forbidden', 'invalid_title', 'invalid_body', 'body_too_long', 'invalid_series', 'not_found']) assert.ok(shortErrorMessage({ message: `ERROR: ${code}` }).length > 10, code);
});

/* ---------------------------------------------------------------- shoda se SQL */
test('meze v appce jsou stejné jako v db/shorts.sql', () => {
  assert.match(sql, new RegExp(`char_length\\(btrim\\(body\\)\\) between 1 and ${SHORT_LIMITS.body}\\)`));
  assert.match(sql, new RegExp(`char_length\\(btrim\\(title\\)\\) between 1 and ${SHORT_LIMITS.title}\\)`));
  assert.match(sql, new RegExp(`char_length\\(btrim\\(series_name\\)\\) between 1 and ${SHORT_LIMITS.series}\\)`));
  assert.match(sql, new RegExp(`series_part between 1 and ${SHORT_LIMITS.seriesPartMax}\\)`));
  assert.match(sql, new RegExp(`cardinality\\(genres\\) <= ${SHORT_LIMITS.genres}\\)`));
  assert.match(sql, new RegExp(`char_length\\(v_body\\) > ${SHORT_LIMITS.body} then raise exception 'body_too_long'`));
  assert.match(sql, new RegExp(`left\\(btrim\\(regexp_replace\\(coalesce\\(g, ''\\), '\\\\s\\+', ' ', 'g'\\)\\), ${SHORT_LIMITS.genreLength}\\)`));
  assert.match(sql, new RegExp(`cardinality\\(out\\) >= ${SHORT_LIMITS.genres}`));
  assert.equal(SHORT_LIMITS.body, 6000);
});

test('každé volání serveru z appky existuje v SQL a posílá jen parametry, které funkce má', async () => {
  const defs = new Map([...sql.matchAll(/create or replace function public\.(\w+)\(([^)]*)\)/g)].map((m) => [m[1], [...m[2].matchAll(/\b(p_\w+)\b/g)].map((x) => x[1])]));
  const seen = new Map();
  const spy = { rpc: async (name, args) => { seen.set(name, Object.keys(args || {})); return { data: null, error: null }; } };
  await loadCandidates(spy); await loadShortsByIds(spy, ['a']); await loadSignals(spy); await reportShort(spy, { shortId: 'a', pagesSeen: 1, pagesTotal: 1 });
  await saveShort(spy, { title: 'T', body: 'B' }); await setShortHidden(spy, 'a', true); await deleteShort(spy, 'a'); await loadMyShorts(spy);
  assert.equal(seen.size, 8);
  for (const [name, args] of seen) {
    assert.ok(defs.has(name), `SQL: funkce ${name}`);
    assert.deepEqual([...args].sort(), [...defs.get(name)].sort(), `${name}: parametry`);
  }
});

test('SQL: hlavní funkce jsou jen pro přihlášené, tabulky mají RLS a klienti k nim nesahají', () => {
  for (const fn of ['short_save(uuid, text, text, text[], text, int, boolean)', 'short_set_hidden(uuid, boolean)', 'short_delete(uuid)', 'my_shorts(boolean)', 'shorts_candidates(int)', 'shorts_get(uuid[])',
    'short_report(uuid, int, int, bigint, boolean, boolean)', 'my_short_signals()']) {
    assert.ok(sql.includes(`revoke all on function public.${fn} from public, anon;`), `revoke ${fn}`);
    assert.ok(sql.includes(`grant execute on function public.${fn} to authenticated;`), `grant ${fn}`);
  }
  for (const t of ['shorts', 'short_progress']) assert.ok(sql.includes(`alter table public.${t} enable row level security;`), t);
  assert.match(sql, /revoke all on public\.shorts, public\.short_progress from public, anon, authenticated;/);
  assert.equal((sql.match(/security definer set search_path to 'public'/g) || []).length, 11, 'všech 11 funkcí s právy vlastníka má pevné search_path');
});

/* ---------------------------------------------------------------- napojení do panelů */
test('Nakladatelský panel i správa mají záložku shortB, správce vidí všechny', () => {
  const pub = fs.readFileSync(path.join(SRC, 'pages', 'PublisherDashboard.jsx'), 'utf8');
  const admin = fs.readFileSync(path.join(SRC, 'pages', 'AdminDashboard.jsx'), 'utf8');
  const studio = fs.readFileSync(path.join(SRC, 'components', 'ShortsStudio.jsx'), 'utf8');
  assert.match(pub, /import ShortsStudio from '\.\.\/components\/ShortsStudio';/);
  assert.match(pub, /\{ id: 'shorts', label: 'shortB', icon: Feather \}/);
  assert.match(pub, /\{tab === 'shorts' && <ShortsStudio \/>\}/);
  assert.match(admin, /\{ id: 'shorts', label: 'shortB', icon: <Feather size=\{14\} \/> \}/);
  assert.match(admin, /\{activeTab === 'shorts' && <ShortsStudio all \/>\}/);
  assert.match(studio, /loadMyShorts\(supabase, all\)/);
  assert.match(studio, /validateShort\(/, 'formulář kontroluje vstup stejnou funkcí jako server');
  assert.match(studio, /window\.confirm\(/, 'smazání se potvrzuje');
});
