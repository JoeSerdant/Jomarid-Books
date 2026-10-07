// Testy prohlídky appky: node --test src/tests/tour.test.mjs   (nebo: npm run test:tour)
//
// Pokrývají čistou logiku: obsah a ověřování uložených dat, pravidla automatického spuštění, umístění karty
// a zapamatování "už viděl". Vykreslení a chování v prohlížeči se ověřuje zvlášť (E2E).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../tour/tourModel.js';
import * as L from '../tour/tourLayout.js';
import * as S from '../tour/tourSeen.js';

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
  const inside = (p, c, v, m = 12) => p.left >= m - 1 && p.top >= m - 1 && p.left + c.width <= v.width - m + 1 && p.top + c.height <= v.height - m + 1;

  test('bez prvku je karta uprostřed', () => {
    const p = L.computeCardPosition({ target: null, card, viewport: vp });
    assert.deepEqual([p.placement, p.left, p.top], ['center', 430, 300]);
  });
  test('pod prvkem, když je místo; vodorovně na jeho střed', () => {
    const p = L.computeCardPosition({ target: { top: 10, left: 500, width: 100, height: 40 }, card, viewport: vp });
    assert.equal(p.placement, 'below');
    assert.equal(p.top, 10 + 40 + 14);
    assert.equal(p.left, 500 + 50 - 170);
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
  test('telefon: dole, nebo nahoře, když je prvek dole', () => {
    const phone = { width: 375, height: 700 };
    const c = { width: 340, height: 220 };
    const high = L.computeCardPosition({ target: { top: 60, left: 20, width: 80, height: 40 }, card: c, viewport: phone });
    assert.equal(high.placement, 'dock-bottom');
    assert.equal(high.top, 700 - 220 - 12);
    const low = L.computeCardPosition({ target: { top: 600, left: 20, width: 80, height: 40 }, card: c, viewport: phone });
    assert.equal(low.placement, 'dock-top');
    assert.equal(low.top, 12);
  });
  test('karta větší než okno se zmenší na okno, nikdy nevyčnívá', () => {
    const p = L.computeCardPosition({ target: null, card: { width: 2000, height: 3000 }, viewport: { width: 300, height: 400 } });
    assert.deepEqual([p.left, p.top], [12, 12]);
  });
  test('náhodné prvky a okna: karta vždy zůstane v okně', () => {
    const r = rng(42);
    for (let i = 0; i < 3000; i++) {
      const v = { width: 280 + Math.floor(r() * 1400), height: 360 + Math.floor(r() * 900) };
      const c = { width: 200 + Math.floor(r() * 200), height: 100 + Math.floor(r() * 250) };
      const t = { top: Math.floor(r() * v.height), left: Math.floor(r() * v.width), width: 10 + Math.floor(r() * 500), height: 10 + Math.floor(r() * 500) };
      const p = L.computeCardPosition({ target: r() < 0.1 ? null : t, card: c, viewport: v });
      assert.ok(inside(p, { width: Math.min(c.width, v.width - 24), height: Math.min(c.height, v.height - 24) }, v), JSON.stringify({ v, c, t, p }));
    }
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
  test('markTourSeen nikdy nevyhodí chybu (chybná síť, blokované úložiště, chybějící klient, bez uživatele)', async () => {
    await assert.doesNotReject(S.markTourSeen({ client: { auth: { updateUser: async () => { throw new Error('síť'); } } }, user: user({}), version: 1, storage: makeStorage() }));
    await assert.doesNotReject(S.markTourSeen({ client: null, user: user({}), version: 1, storage: makeStorage({}, true) }));
    await assert.doesNotReject(S.markTourSeen({ client: {}, user: null, version: 1 }));
  });
});
