// Testy prohlídky appky: node --test src/tests/tour.test.mjs   (nebo: npm run test:tour)
//
// Pokrývají čistou logiku: obsah a ověřování uložených dat, pravidla automatického spuštění, umístění karty
// a zapamatování "už viděl". Vykreslení a chování v prohlížeči se ověřuje zvlášť (E2E).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../tour/tourModel.js';
import * as L from '../tour/tourLayout.js';
import * as S from '../tour/tourSeen.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DAY = 86400000;
const NOW = Date.parse('2026-10-07T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString();
const rng = (seed) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;

describe('výchozí obsah', () => {
  const tour = M.defaultTour();
  test('každá role má vlastní sadu kroků a všechny jsou platné', () => {
    for (const key of M.SET_KEYS) {
      const steps = tour.sets[key];
      assert.ok(steps.length >= 5, key);
      assert.equal(new Set(steps.map((x) => x.id)).size, steps.length, key + ': jedinečná id');
      for (const st of steps) {
        assert.ok(M.ANCHOR_KEYS.includes(st.anchor), `${key}/${st.id}: neznámý cíl ${st.anchor}`);
        assert.ok(st.title && st.title.length <= M.TOUR_LIMITS.title, `${key}/${st.id}: titulek`);
        assert.ok(st.text && st.text.length <= M.TOUR_LIMITS.text, `${key}/${st.id}: text`);
        assert.equal(st.enabled, true);
      }
      assert.equal(steps[0].anchor, 'none', key + ': začíná uvítáním');
      assert.equal(steps.at(-1).anchor, 'none', key + ': končí rozloučením');
    }
  });
  test('role vidí jen prvky menu, které mají', () => {
    const anchors = (key) => tour.sets[key].map((x) => x.anchor);
    assert.ok(!anchors('reader').includes('nav-studio') && !anchors('reader').includes('nav-admin'));
    assert.ok(anchors('publisher').includes('nav-studio') && !anchors('publisher').includes('nav-admin'));
    assert.ok(anchors('admin').includes('nav-admin') && !anchors('admin').includes('nav-studio'));
  });
  test('každý cíl s adresou má adresu začínající lomítkem a "at" je její začátek', () => {
    for (const [k, def] of Object.entries(M.ANCHORS)) {
      assert.ok(typeof def.label === 'string' && def.label.length > 0, k);
      if (def.route) { assert.ok(def.route.startsWith('/'), k); assert.ok(def.route.startsWith(def.at || def.route), k); }
    }
  });
  test('pořadí a cíle výchozích kroků (změna je záměrná, ne náhodná)', () => {
    const anchors = (key) => tour.sets[key].map((x) => x.anchor);
    assert.deepEqual(anchors('reader'), ['none', 'nav-library', 'library-search', 'nav-stats', 'nav-games', 'nav-coins', 'nav-search', 'nav-settings', 'settings-tabs', 'none']);
    assert.deepEqual(anchors('publisher'), ['none', 'nav-library', 'nav-studio', 'publisher-tabs', 'nav-stats', 'nav-coins', 'nav-settings', 'settings-checks', 'none']);
    assert.deepEqual(anchors('admin'), ['none', 'nav-library', 'library-search', 'nav-stats', 'nav-games', 'nav-coins', 'nav-search', 'nav-admin', 'nav-settings', 'settings-tabs', 'none']);
  });
  test('texty o mincích a knihovně odpovídají tomu, co appka opravdu dělá', () => {
    const text = (key, id) => tour.sets[key].find((x) => x.id === id).text;
    for (const key of ['reader', 'publisher']) {
      assert.ok(/odznak/.test(text(key, 'coins')) && /přihlášen/.test(text(key, 'coins')) && /hr/.test(text(key, 'coins')), key + ': zdroje mincí');
      assert.ok(!/čtením|sériemi/.test(text(key, 'coins')), key + ': za čtení mince nejsou');
      assert.ok(/Moje knihy/.test(text(key, 'library')), key + ': knihovna ukazuje celý katalog a filtr Moje knihy');
    }
    assert.ok(/prodej/.test(text('publisher', 'coins')));
    assert.ok(/daruješ/.test(text('publisher', 'studio-tabs')) && !/nastavíš autorské/.test(text('publisher', 'studio-tabs')));
  });
  test('každý cíl prohlídky má v komponentách odpovídající data-tour (a naopak)', () => {
    const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
    const files = [];
    const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) { if (!['tests', 'gameContent'].includes(e.name)) walk(f); } else if (/\.jsx$/.test(e.name)) files.push(f); } };
    walk(SRC);
    const source = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    for (const key of M.ANCHOR_KEYS.filter((k) => k !== 'none')) {
      const re = new RegExp(`data-tour=(?:"${key}"|\\{[^}]*'${key}'[^}]*\\})`);
      assert.ok(re.test(source), `${key}: v komponentách chybí data-tour`);
    }
    const literal = [...source.matchAll(/data-tour="([a-z-]+)"/g)].map((m) => m[1]);
    assert.ok(literal.length >= 8);
    for (const k of literal) assert.ok(M.ANCHOR_KEYS.includes(k), `data-tour="${k}" není v ANCHORS`);
  });
  test('defaultTour vrací novou kopii (úprava jedné nezmění další)', () => {
    const a = M.defaultTour(); a.sets.reader[0].title = 'změněno';
    assert.notEqual(M.defaultTour().sets.reader[0].title, 'změněno');
  });
});

describe('normalizeTour', () => {
  test('cokoli nesmyslného dá výchozí prohlídku', () => {
    for (const v of [null, undefined, 5, 'x', [], true, () => 1]) assert.deepEqual(M.normalizeTour(v), M.defaultTour(), String(v));
  });
  test('je idempotentní a přežije JSON', () => {
    const t = M.normalizeTour({ enabled: false, version: 3, autoDays: 30, sets: { reader: [{ title: 'A', text: 'B', anchor: 'nav-library' }] } });
    assert.deepEqual(M.normalizeTour(t), t);
    assert.deepEqual(M.normalizeTour(JSON.parse(JSON.stringify(t))), t);
  });
  test('zapnutí, verze a počet dní: číselné řetězce projdou, nesmysly se vrátí na výchozí', () => {
    assert.equal(M.normalizeTour({ enabled: false }).enabled, false);
    assert.equal(M.normalizeTour({ enabled: 0 }).enabled, true, 'jen přesné false vypíná');
    assert.equal(M.normalizeTour({ version: '5' }).version, 5);
    for (const v of [0, -1, 1.5, 'abc', '', null, 10000, NaN, {}]) assert.equal(M.normalizeTour({ version: v }).version, 1, String(v));
    assert.equal(M.normalizeTour({ autoDays: 0 }).autoDays, 0, '0 = jen ručně');
    assert.equal(M.normalizeTour({ autoDays: '45' }).autoDays, 45);
    for (const v of [-1, 2.5, 'x', '', null, 3651]) assert.equal(M.normalizeTour({ autoDays: v }).autoDays, 14, String(v));
  });
  test('chybějící sada se nahradí výchozí, záměrně prázdná zůstane prázdná', () => {
    const t = M.normalizeTour({ sets: { publisher: [] } });
    assert.deepEqual(t.sets.publisher, []);
    assert.deepEqual(t.sets.reader, M.defaultSteps('reader'));
    assert.deepEqual(M.normalizeTour({ sets: 'x' }).sets.reader, M.defaultSteps('reader'));
    assert.deepEqual(M.normalizeTour({ sets: { reader: 'x' } }).sets.reader, M.defaultSteps('reader'));
  });
  test('kroky: nesmyslné se zahodí, cíl se ověří, texty se ořežou a očistí', () => {
    const t = M.normalizeTour({ sets: { reader: [
      null, 5, 'x', [], {}, { title: '  ', text: '' },
      { title: ' Ahoj ', text: 'řádek1\r\nřádek2', anchor: 'nav-games', enabled: false },
      { title: 'x'.repeat(200), text: 'y'.repeat(900), anchor: 'neexistuje' },
      { title: 'Jen titulek', anchor: '__proto__' },
      { text: 'Jen text', anchor: 'constructor' },
    ] } }).sets.reader;
    assert.equal(t.length, 4);
    assert.deepEqual([t[0].title, t[0].text, t[0].anchor, t[0].enabled], ['Ahoj', 'řádek1\nřádek2', 'nav-games', false]);
    assert.equal(t[1].title.length, M.TOUR_LIMITS.title);
    assert.equal(t[1].text.length, M.TOUR_LIMITS.text);
    assert.equal(t[1].anchor, 'none');
    assert.equal(t[2].anchor, 'none');
    assert.equal(t[3].anchor, 'none');
  });
  test('HTML v textu zůstane obyčejným textem (vykresluje se jako text, ne jako HTML)', () => {
    const st = M.normalizeTour({ sets: { reader: [{ title: '<b>Tučně</b>', text: '<img src=x onerror=alert(1)>' }] } }).sets.reader[0];
    assert.equal(st.title, '<b>Tučně</b>');
    assert.equal(st.text, '<img src=x onerror=alert(1)>');
  });
  test('nejvýš MAX kroků v sadě a jedinečná id', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: 'stejne', title: 'K' + i }));
    const steps = M.normalizeTour({ sets: { reader: many } }).sets.reader;
    assert.equal(steps.length, M.TOUR_LIMITS.maxSteps);
    assert.equal(new Set(steps.map((x) => x.id)).size, steps.length);
    const noId = M.normalizeTour({ sets: { reader: [{ title: 'a' }, { title: 'b' }] } }).sets.reader;
    assert.deepEqual(noId.map((x) => x.id), ['reader-1', 'reader-2']);
  });
  test('hranice čísel: nejvyšší povolené hodnoty projdou', () => {
    assert.equal(M.normalizeTour({ version: 9999 }).version, 9999);
    assert.equal(M.normalizeTour({ autoDays: 3650 }).autoDays, 3650);
  });
  test('id kroku: ořez mezer a délky, nesmysl se nahradí vlastním', () => {
    const ids = M.normalizeTour({ sets: { reader: [
      { id: '  mezery  ', title: 'a' }, { id: 'x'.repeat(100), title: 'b' }, { id: 5, title: 'c' }, { id: '   ', title: 'd' }, { title: 'e' },
    ] } }).sets.reader.map((x) => x.id);
    assert.equal(ids[0], 'mezery');
    assert.equal(ids[1].length, 40);
    assert.deepEqual(ids.slice(2), ['reader-3', 'reader-4', 'reader-5']);
  });
  test('isValidAutoDays a isBlankStep', () => {
    for (const v of [0, 14, '14', ' 7 ', 3650]) assert.equal(M.isValidAutoDays(v), true, String(v));
    for (const v of ['', ' ', -1, '-5', 2.5, '2.5', 3651, '99999', 'abc', null, undefined, NaN, {}]) assert.equal(M.isValidAutoDays(v), false, String(v));
    assert.equal(M.isBlankStep({ title: '  ', text: '' }), true);
    assert.equal(M.isBlankStep({ title: 'a', text: '' }), false);
    assert.equal(M.isBlankStep({ text: 'x' }), false);
    assert.equal(M.isBlankStep(null), true);
  });
  test('normalizeDraft: kroky a počet dní zůstanou, jak je správce napsal; nesmysly se pořád zahodí', () => {
    const draft = M.normalizeDraft({ autoDays: '', version: 4, sets: { reader: [
      { id: 'a', title: '  Titulek s mezerou na konci ', text: '', anchor: 'nav-games' }, { id: 'b' }, { id: 'c', title: 'x'.repeat(200), anchor: 'neexistuje' }, null, 5,
    ] } });
    assert.equal(draft.autoDays, '');
    assert.equal(draft.version, 4);
    assert.equal(draft.sets.reader.length, 3, 'prázdný krok zůstane, null a číslo ne');
    assert.equal(draft.sets.reader[0].title, '  Titulek s mezerou na konci ');
    assert.deepEqual([draft.sets.reader[1].title, draft.sets.reader[1].text, draft.sets.reader[1].anchor], ['', '', 'none']);
    assert.equal(draft.sets.reader[2].title.length, M.TOUR_LIMITS.title);
    assert.equal(draft.sets.reader[2].anchor, 'none');
    assert.deepEqual(draft.sets.publisher, M.defaultSteps('publisher'), 'chybějící sada = výchozí');
    // z návrhu se při uložení stane platná prohlídka bez prázdného kroku
    assert.equal(M.normalizeTour(draft).sets.reader.length, 2);
    assert.equal(M.normalizeTour(draft).autoDays, 14);
  });
  test('normalizeDraft: cokoli nesmyslného dá výchozí návrh a nepřekročí limity', () => {
    for (const v of [null, 5, 'x', [], undefined]) assert.deepEqual(M.normalizeDraft(v), M.defaultTour(), String(v));
    const many = M.normalizeDraft({ sets: { reader: Array.from({ length: 40 }, (_, i) => ({ id: 'a', title: 't' + i })) } });
    assert.equal(many.sets.reader.length, M.TOUR_LIMITS.maxSteps);
    assert.equal(new Set(many.sets.reader.map((x) => x.id)).size, many.sets.reader.length);
  });
  test('activeSteps vynechá vypnuté kroky a řídí se rolí', () => {
    const t = M.normalizeTour({ sets: { reader: [{ title: 'A' }, { title: 'B', enabled: false }], publisher: [{ title: 'P' }], admin: [{ title: 'S' }] } });
    assert.deepEqual(M.activeSteps(t, 'uživatel').map((x) => x.title), ['A']);
    assert.deepEqual(M.activeSteps(t, 'nakladatel').map((x) => x.title), ['P']);
    assert.deepEqual(M.activeSteps(t, 'správce').map((x) => x.title), ['S']);
    assert.deepEqual(M.activeSteps(t, null).map((x) => x.title), ['A'], 'neznámá role = čtenář');
    assert.deepEqual(M.activeSteps(null, 'uživatel'), []);
  });
});

describe('automatické spuštění', () => {
  const tour = M.defaultTour();
  const base = { tour, role: 'uživatel', seenVersion: 0, createdAt: daysAgo(1), now: NOW, pathname: '/app' };
  const go = (over) => M.shouldAutoStart({ ...base, ...over });

  test('nový účet, který prohlídku neviděl, ji dostane', () => assert.equal(go({}), true));
  test('stará data a nikdy neviděl: samo se nespustí (dohledá si ji v Nastavení)', () => assert.equal(go({ createdAt: daysAgo(400) }), false));
  test('hranice stáří účtu', () => {
    assert.equal(go({ createdAt: daysAgo(14) }), true);
    assert.equal(go({ createdAt: daysAgo(15) }), false);
    assert.equal(go({ tour: { ...tour, autoDays: 0 } }), false, '0 dní = jen ručně');
    assert.equal(go({ tour: { ...tour, autoDays: 3650 }, createdAt: daysAgo(3000) }), true);
  });
  test('už viděl aktuální verzi: nespustí se; správce zvýšil verzi: spustí se i starému účtu', () => {
    assert.equal(go({ seenVersion: 1 }), false);
    assert.equal(go({ seenVersion: 2 }), false);
    assert.equal(go({ tour: { ...tour, version: 2 }, seenVersion: 1, createdAt: daysAgo(900) }), true);
    assert.equal(go({ tour: { ...tour, version: 2 }, seenVersion: 0, createdAt: daysAgo(900) }), false, 'starý účet, co nikdy neviděl, dál ne');
  });
  test('vypnutá prohlídka nebo prázdná sada role', () => {
    assert.equal(go({ tour: { ...tour, enabled: false } }), false);
    assert.equal(go({ tour: M.normalizeTour({ sets: { reader: [] } }) }), false);
    assert.equal(go({ tour: M.normalizeTour({ sets: { reader: [{ title: 'A', enabled: false }] } }) }), false);
    assert.equal(go({ role: 'nakladatel', tour: M.normalizeTour({ sets: { reader: [] } }) }), true, 'sada čtenáře se nakladatele netýká');
    assert.equal(go({ tour: null }), false);
  });
  test('bez známé role (profil se nenačetl) se prohlídka sama nespustí', () => {
    for (const role of [null, undefined, '']) assert.equal(go({ role }), false, String(role));
    assert.equal(go({ role: 'nakladatel' }), true);
  });
  test('0 dní = jen ručně i pro účet založený před okamžikem', () => {
    assert.equal(go({ tour: { ...tour, autoDays: 0 }, createdAt: new Date(NOW).toISOString() }), false);
    assert.equal(go({ tour: { ...tour, autoDays: 1 }, createdAt: new Date(NOW).toISOString() }), true);
  });
  test('chybějící nebo nesmyslné datum vzniku účtu = ne nový', () => {
    for (const createdAt of [undefined, null, '', 'nesmysl']) assert.equal(go({ createdAt }), false, String(createdAt));
    assert.equal(go({ createdAt: undefined, seenVersion: 1, tour: { ...tour, version: 2 } }), true);
  });
  test('jen na klidných stránkách', () => {
    for (const p of ['/', '/app', '/app/', '/stats', '/games', '/publisher', '/settings', '/settings/profile', '/autor/abc']) assert.equal(M.isAutoStartPath(p), true, p);
    for (const p of ['/read/1', '/games/chess', '/login', '/reset-password', '/admin', '/settingsx', '/apple', '', null, undefined, 5]) assert.equal(M.isAutoStartPath(p), false, String(p));
    assert.equal(go({ pathname: '/read/abc' }), false);
  });
  test('stáří účtu: budoucí datum = 0 dní, nesmysl = nekonečno', () => {
    assert.equal(M.accountAgeDays(daysAgo(-3), NOW), 0);
    assert.equal(M.accountAgeDays('x', NOW), Infinity);
    assert.ok(Math.abs(M.accountAgeDays(daysAgo(2), NOW) - 2) < 1e-9);
  });
});

describe('přechod na stránku kroku', () => {
  test('prvky menu a karta uprostřed nikam nepřecházejí', () => {
    for (const a of ['none', 'nav-library', 'nav-settings', 'nav-coins', 'neexistuje', undefined, null]) assert.equal(M.routeForAnchor(a, '/stats'), null, String(a));
  });
  test('prvek na konkrétní stránce: přejít jen když tam uživatel ještě není', () => {
    assert.equal(M.routeForAnchor('library-search', '/app'), null);
    assert.equal(M.routeForAnchor('library-search', '/app/'), null);
    assert.equal(M.routeForAnchor('library-search', '/stats'), '/app');
    assert.equal(M.routeForAnchor('settings-tabs', '/settings'), null);
    assert.equal(M.routeForAnchor('settings-tabs', '/settings/security'), null);
    assert.equal(M.routeForAnchor('settings-tabs', '/'), '/settings/appearance');
    assert.equal(M.routeForAnchor('settings-tabs', '/settingsx'), '/settings/appearance', 'ne jen shoda začátku řetězce');
    assert.equal(M.routeForAnchor('publisher-tabs', '/publisher'), null);
    assert.equal(M.routeForAnchor('publisher-tabs', '/app'), '/publisher');
  });
});

describe('umístění karty', () => {
  const vp = { width: 1200, height: 800 };
  const card = { width: 340, height: 200 };
  // Skutečná výška karty po omezení maxHeight a její obdélník v okně.
  const rectOf = (p, c, v) => ({ left: p.left, top: p.top, width: Math.min(c.width, v.width - 24), height: Math.min(c.height, p.maxHeight, v.height - 24) });
  const overlaps = (a, b) => !(a.left >= b.left + b.width || a.left + a.width <= b.left || a.top >= b.top + b.height || a.top + a.height <= b.top);
  const inside = (r, v, m = 12) => r.left >= m - 1 && r.top >= m - 1 && r.left + r.width <= v.width - m + 1 && r.top + r.height <= v.height - m + 1;

  test('bez prvku je karta uprostřed', () => {
    const p = L.computeCardPosition({ target: null, card, viewport: vp });
    assert.deepEqual([p.placement, p.left, p.top, p.maxHeight], ['center', 430, 300, 776]);
  });
  test('pod prvkem, když je místo; vodorovně na jeho střed', () => {
    const p = L.computeCardPosition({ target: { top: 10, left: 500, width: 100, height: 40 }, card, viewport: vp });
    assert.equal(p.placement, 'below');
    assert.equal(p.top, 10 + 40 + 14);
    assert.equal(p.left, 500 + 50 - 170);
    assert.equal(p.maxHeight, 800 - 12 - 64, 'výška karty smí být nejvýš volné místo pod prvkem');
  });
  test('nad prvkem, když dole není místo', () => {
    const p = L.computeCardPosition({ target: { top: 700, left: 500, width: 100, height: 40 }, card, viewport: vp });
    assert.equal(p.placement, 'above');
    assert.equal(p.top, 700 - 14 - 200);
  });
  test('vedle prvku, když nad ani pod není místo (vysoký prvek)', () => {
    const tall = { top: 20, left: 100, width: 200, height: 760 };
    const r = L.computeCardPosition({ target: tall, card, viewport: vp });
    assert.equal(r.placement, 'right');
    assert.equal(r.left, 100 + 200 + 14);
    assert.equal(r.top, 800 / 2 - 100, 'svisle na střed prvku');
    const l = L.computeCardPosition({ target: { ...tall, left: 900 }, card, viewport: vp });
    assert.equal(l.placement, 'left');
    assert.equal(l.left, 900 - 14 - 340);
  });
  test('přes celé okno: karta uprostřed přes prvek', () => {
    const p = L.computeCardPosition({ target: { top: 0, left: 0, width: 1200, height: 800 }, card, viewport: vp });
    assert.equal(p.placement, 'center-over');
  });
  test('u okraje se karta vodorovně posune dovnitř okna', () => {
    const p = L.computeCardPosition({ target: { top: 10, left: 1150, width: 40, height: 40 }, card, viewport: vp });
    assert.equal(p.left, 1200 - 340 - 12);
    const q = L.computeCardPosition({ target: { top: 10, left: 0, width: 40, height: 40 }, card, viewport: vp });
    assert.equal(q.left, 12);
  });
  test('telefon (užší než 640 px): dole, nebo nahoře, když je prvek dole', () => {
    const phone = { width: 375, height: 700 };
    const c = { width: 340, height: 220 };
    const high = L.computeCardPosition({ target: { top: 60, left: 20, width: 80, height: 40 }, card: c, viewport: phone });
    assert.equal(high.placement, 'dock-bottom');
    assert.equal(high.top, 700 - 220 - 12);
    const low = L.computeCardPosition({ target: { top: 600, left: 20, width: 80, height: 40 }, card: c, viewport: phone });
    assert.equal(low.placement, 'dock-top');
    assert.equal(low.top, 12);
  });
  test('hranice 640 px: od ní se karta řadí pod prvek, ne k okraji okna', () => {
    const t = { top: 60, left: 20, width: 80, height: 40 };
    assert.equal(L.computeCardPosition({ target: t, card, viewport: { width: 639, height: 700 } }).placement, 'dock-bottom');
    assert.equal(L.computeCardPosition({ target: t, card, viewport: { width: 640, height: 700 } }).placement, 'below');
  });
  test('nízké okno (telefon na šířku, zvětšení): karta se zmenší na volné místo, text se v ní posouvá', () => {
    const v = { width: 667, height: 375 };
    const c = { width: 360, height: 300 };
    const t = { top: 80, left: 30, width: 600, height: 50 }; // široký prvek pod lištou: vedle není kam
    const p = L.computeCardPosition({ target: t, card: c, viewport: v });
    assert.equal(p.placement, 'below');
    assert.equal(p.maxHeight, 375 - 12 - (130 + 14));
    assert.ok(p.maxHeight < c.height && p.maxHeight >= 140, 'zmenšená, ale použitelná');
    assert.ok(!overlaps(rectOf(p, c, v), t), 'nezakrývá prvek');
  });
  test('zmenšení bere větší z volných míst (nad prvkem, když je ho nahoře víc)', () => {
    const v = { width: 667, height: 375 };
    const c = { width: 360, height: 330 };
    const t = { top: 210, left: 30, width: 600, height: 50 };
    const p = L.computeCardPosition({ target: t, card: c, viewport: v });
    assert.equal(p.placement, 'above');
    assert.equal(p.maxHeight, 210 - 14 - 12);
  });
  test('když není ani 140 px volných, karta jde uprostřed přes prvek (zůstane celá čitelná)', () => {
    const v = { width: 667, height: 375 };
    const p = L.computeCardPosition({ target: { top: 20, left: 30, width: 600, height: 335 }, card: { width: 360, height: 300 }, viewport: v });
    assert.equal(p.placement, 'center-over');
    assert.equal(p.maxHeight, 375 - 24);
  });
  test('karta větší než okno se zmenší na okno, nikdy nevyčnívá', () => {
    const p = L.computeCardPosition({ target: null, card: { width: 2000, height: 3000 }, viewport: { width: 300, height: 400 } });
    assert.deepEqual([p.left, p.top, p.maxHeight], [12, 12, 376]);
  });
  test('náhodné prvky a okna: karta vždy v okně a (mimo center-over) nikdy nezakrývá prvek', () => {
    const r = rng(42);
    let shrunk = 0; let over = 0;
    for (let i = 0; i < 6000; i++) {
      const v = { width: 280 + Math.floor(r() * 1400), height: 300 + Math.floor(r() * 900) };
      const c = { width: 200 + Math.floor(r() * 200), height: 100 + Math.floor(r() * 400) };
      const t = { top: Math.floor(r() * v.height), left: Math.floor(r() * v.width), width: 10 + Math.floor(r() * 500), height: 10 + Math.floor(r() * 400) };
      const withTarget = r() >= 0.1;
      const p = L.computeCardPosition({ target: withTarget ? t : null, card: c, viewport: v });
      const rect = rectOf(p, c, v);
      const ctx = JSON.stringify({ v, c, t, p });
      assert.ok(inside(rect, v), 'mimo okno ' + ctx);
      assert.ok(p.maxHeight >= 0, ctx);
      if (withTarget && p.placement !== 'center-over') assert.ok(!overlaps(rect, t), 'zakrývá prvek ' + ctx);
      if (p.maxHeight < c.height && withTarget) shrunk++;
      if (p.placement === 'center-over') over++;
    }
    assert.ok(shrunk > 50 && over > 20, `test nepokrývá zmenšení (${shrunk}) a krajní případ (${over})`);
  });
  test('rámeček zvýraznění: okraj navíc, ořez na okno, mimo okno = žádný', () => {
    assert.deepEqual(L.computeSpotlight({ top: 100, left: 100, width: 50, height: 20 }, vp), { left: 94, top: 94, width: 62, height: 32 });
    assert.deepEqual(L.computeSpotlight({ top: 0, left: 0, width: 50, height: 20 }, vp), { left: 0, top: 0, width: 56, height: 26 });
    assert.deepEqual(L.computeSpotlight({ top: 790, left: 1190, width: 50, height: 50 }, vp), { left: 1184, top: 784, width: 16, height: 16 });
    assert.equal(L.computeSpotlight({ top: 900, left: 100, width: 50, height: 20 }, vp), null);
    assert.equal(L.computeSpotlight(null, vp), null);
  });
});

describe('zapamatování zhlédnutí', () => {
  const makeStorage = (init = {}, broken = false) => {
    const m = new Map(Object.entries(init));
    const guard = () => { if (broken) throw new Error('blokováno'); };
    return { getItem: (k) => { guard(); return m.has(k) ? m.get(k) : null; }, setItem: (k, v) => { guard(); m.set(k, String(v)); }, removeItem: (k) => { guard(); m.delete(k); }, _m: m };
  };
  const user = (meta) => ({ id: 'u1', user_metadata: meta });

  test('nic uloženo = 0', () => assert.equal(S.readSeenVersion(user({}), makeStorage()), 0));
  test('bere vyšší z úložiště a z metadat účtu', () => {
    assert.equal(S.readSeenVersion(user({}), makeStorage({ [S.seenStorageKey('u1')]: '2' })), 2);
    assert.equal(S.readSeenVersion(user({ [S.SEEN_META_KEY]: 3 }), makeStorage()), 3);
    assert.equal(S.readSeenVersion(user({ [S.SEEN_META_KEY]: 1 }), makeStorage({ [S.seenStorageKey('u1')]: '4' })), 4);
  });
  test('verze 1 (výchozí) se čte jako 1, ne jako 0', () => {
    assert.equal(S.readSeenVersion(user({}), makeStorage({ [S.seenStorageKey('u1')]: '1' })), 1);
    assert.equal(S.readSeenVersion(user({ [S.SEEN_META_KEY]: 1 }), makeStorage()), 1);
    assert.equal(S.readSeenVersion(user({ [S.SEEN_META_KEY]: '1' }), makeStorage()), 1);
  });
  test('z úložiště a z metadat platí vyšší, i když je v úložišti nižší, ale pravdivé číslo', () => {
    assert.equal(S.readSeenVersion(user({ [S.SEEN_META_KEY]: 3 }), makeStorage({ [S.seenStorageKey('u1')]: '1' })), 3);
    assert.equal(S.readSeenVersion(user({ [S.SEEN_META_KEY]: 1 }), makeStorage({ [S.seenStorageKey('u1')]: '3' })), 3);
  });
  test('každý uživatel má svůj záznam (jiný účet ve stejném prohlížeči prohlídku uvidí)', () => {
    const st = makeStorage({ [S.seenStorageKey('u1')]: '1' });
    assert.equal(S.readSeenVersion({ id: 'u2' }, st), 0);
  });
  test('nesmysly se berou jako 0', () => {
    for (const v of ['abc', '-1', '1.5', '', null, 'NaN']) assert.equal(S.readSeenVersion(user({}), makeStorage({ [S.seenStorageKey('u1')]: v })), 0, String(v));
    for (const m of [{ [S.SEEN_META_KEY]: 'x' }, { [S.SEEN_META_KEY]: -2 }, { [S.SEEN_META_KEY]: {} }, null, 'text', undefined]) assert.equal(S.readSeenVersion(user(m), makeStorage()), 0, JSON.stringify(m));
    assert.equal(S.readSeenVersion(null, makeStorage()), 0);
  });
  test('blokované úložiště nic neshodí', () => {
    assert.equal(S.readSeenVersion(user({ [S.SEEN_META_KEY]: 2 }), makeStorage({}, true)), 2);
  });
  test('markTourSeen zapíše do úložiště i do metadat účtu', async () => {
    const st = makeStorage(); const calls = [];
    await S.markTourSeen({ client: { auth: { updateUser: async (a) => { calls.push(a); return { error: null }; } } }, user: user({}), version: 3, storage: st });
    assert.equal(st._m.get(S.seenStorageKey('u1')), '3');
    assert.deepEqual(calls, [{ data: { [S.SEEN_META_KEY]: 3 } }]);
  });
  test('markTourSeen nikdy nesníží už zapsanou verzi (ruční spuštění, chyba načtení nastavení)', async () => {
    const st = makeStorage({ [S.seenStorageKey('u1')]: '3' }); const calls = [];
    const client = { auth: { updateUser: async (a) => { calls.push(a); } } };
    await S.markTourSeen({ client, user: user({}), version: 1, storage: st });
    assert.equal(st._m.get(S.seenStorageKey('u1')), '3');
    assert.deepEqual(calls, [{ data: { [S.SEEN_META_KEY]: 3 } }], 'do metadat jde nejvyšší známá verze');
  });
  test('markTourSeen nevolá síť, když metadata účtu už tu verzi mají', async () => {
    const calls = [];
    await S.markTourSeen({ client: { auth: { updateUser: async (a) => { calls.push(a); } } }, user: user({ [S.SEEN_META_KEY]: 2 }), version: 2, storage: makeStorage() });
    assert.deepEqual(calls, []);
  });
  test('markTourSeen s neplatnou verzí nic nezapíše', async () => {
    const st = makeStorage(); const calls = [];
    for (const version of [0, -1, 'x', null, undefined, 1.5]) await S.markTourSeen({ client: { auth: { updateUser: async (a) => { calls.push(a); } } }, user: user({}), version, storage: st });
    assert.equal(st._m.size, 0);
    assert.deepEqual(calls, []);
  });
  test('markTourSeen nikdy nevyhodí chybu (chybná síť, blokované úložiště, chybějící klient, bez uživatele)', async () => {
    await assert.doesNotReject(S.markTourSeen({ client: { auth: { updateUser: async () => { throw new Error('síť'); } } }, user: user({}), version: 1, storage: makeStorage() }));
    await assert.doesNotReject(S.markTourSeen({ client: null, user: user({}), version: 1, storage: makeStorage({}, true) }));
    await assert.doesNotReject(S.markTourSeen({ client: {}, user: null, version: 1 }));
  });
});
