// Testy Živého režimu: node --test src/tests/lively.test.mjs   (nebo: npm run test:lively)
//
// Hlídají hlavně:
//  - nastavení: ve výchozím stavu vypnuto, ukládá se, nastavuje atribut na <html>, synchronizuje se s účtem, poškozené úložiště nic nerozbije,
//  - postupné objevování karet (reveal.js): co se hýbe a co ne, pořadí a zpoždění, vnořené prvky, úklid po dohrání, pojistky, když něco selže,
//  - že čtečka, hry a krátké knihy zůstávají klidné a ozdoby po stranách nezasahují do širokých stránek (správa, nakladatel),
//  - počítání čísel, naklánění karet, kruh po kliknutí a přepnutí motivu přes View Transition,
//  - CSS: každá animace má klíčové snímky, čekající prvky se skryjí a po dohrání nezůstane žádná transformace (jinak by se pohnuly prvky
//    s position: fixed), omezený pohyb a tisk nic neskrývají, vypnutý režim nic nemění.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as T from '../theme.js';
import * as S from '../settings/settingsSync.js';
import { livelyScope, scrollProgress } from '../lively/scope.js';
import { SIDE_ITEMS, ICON_NAMES, ANIMATIONS, particles, PARTICLE_COUNT } from '../lively/items.js';
import { REVEAL_STEP, REVEAL_MAX_STEPS, NESTED_BASE, TILT_MAX, staggerDelay, easeOutExpo, countAt, countDuration, tiltFor } from '../lively/motion.js';
import { CARD_SELECTOR, GROW_SELECTOR, REVEAL_SELECTOR, SKIP_SELECTOR, ANIMATIONS as REVEAL_ANIMATIONS, createReveal, isCandidate } from '../lively/reveal.js';
import { TILT_SELECTOR, installTilt } from '../lively/tilt.js';
import { MAX_RIPPLES, rippleAt, rippleTarget, installClickRipple } from '../lively/ripple.js';
import { supportsViewTransition, trackPointerOrigin, withViewTransition } from '../lively/viewTransition.js';
import { prefersReducedMotion } from '../lively/reduced.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const css = read('src', 'lively.css');

const makeStorage = (init = {}, broken = false) => {
  const m = new Map(Object.entries(init));
  const guard = () => { if (broken) throw new Error('úložiště není dostupné'); };
  return { getItem: (k) => { guard(); return m.has(k) ? m.get(k) : null; }, setItem: (k, v) => { guard(); m.set(k, String(v)); }, removeItem: (k) => { guard(); m.delete(k); } };
};
const setStorage = (s) => Object.defineProperty(globalThis, 'localStorage', { value: s, configurable: true, writable: true });
const setDocument = (d) => Object.defineProperty(globalThis, 'document', { value: d, configurable: true, writable: true });
beforeEach(() => { setStorage(makeStorage()); setDocument({ documentElement: { dataset: {} } }); });

describe('nastavení Živého režimu', () => {
  test('ve výchozím stavu je vypnutý (je to experiment, ne pro každého)', () => {
    assert.equal(T.loadLively(), false);
    assert.equal(T.applyLively(), false);
    assert.equal(document.documentElement.dataset.lively, '0');
  });
  test('uložení zapne atribut na <html> a vypnutí ho vrátí; hodnota přežije načtení', () => {
    T.saveLively(true);
    assert.equal(localStorage.getItem(T.LIVELY_KEY), '1');
    assert.equal(document.documentElement.dataset.lively, '1');
    assert.equal(T.loadLively(), true);
    T.saveLively(false);
    assert.equal(document.documentElement.dataset.lively, '0');
    assert.equal(T.loadLively(), false);
  });
  test('cizí nebo poškozená hodnota znamená vypnuto', () => {
    for (const v of ['true', 'yes', '2', '', ' 1']) { setStorage(makeStorage({ [T.LIVELY_KEY]: v })); assert.equal(T.loadLively(), false, JSON.stringify(v)); }
  });
  test('zablokované úložiště nic nerozbije', () => {
    setStorage(makeStorage({}, true));
    assert.equal(T.loadLively(), false);
    assert.doesNotThrow(() => T.saveLively(true));
    assert.equal(document.documentElement.dataset.lively, '0', 'bez úložiště se nic nezapne naslepo');
  });
  test('synchronizuje se s účtem: klíč je v katalogu, stažené nastavení ho zapne i vrátí na výchozí', () => {
    assert.ok(S.SYNC_KEYS.includes(T.LIVELY_KEY));
    assert.deepEqual(S.collectSettings(makeStorage({ [T.LIVELY_KEY]: '1' })).items, { 'jomarid-lively': '1' });
    const st = makeStorage();
    S.applySettings({ v: 1, items: { [T.LIVELY_KEY]: '1' } }, st);
    assert.equal(st.getItem(T.LIVELY_KEY), '1');
    S.applySettings({ v: 1, items: { 'jomarid-accent': 'rose' } }, st);
    assert.equal(st.getItem(T.LIVELY_KEY), null, 'chybí-li v účtu, vrátí se výchozí (vypnuto)');
  });
  test('v Nastavení je přepínač a App režim předává a po stažení z účtu čte znovu', () => {
    const modal = read('src', 'components', 'SettingsModal.jsx');
    assert.match(modal, /Živý režim/);
    assert.match(modal, /changeLively/);
    const app = read('src', 'App.jsx');
    assert.match(app, /changeLively/);
    assert.match(app, /<LivelyScenery enabled=\{lively\}/);
    assert.match(app, /setLively\(loadLively\(\)\);\s*applyLively\(\);/, 'po stažení nastavení z účtu se režim přečte znovu');
    assert.match(read('src', 'index.jsx'), /import '\.\/lively\.css'/);
  });
});

describe('index.html: Živý režim před prvním vykreslením', () => {
  const script = read('index.html').match(/<script>([\s\S]*?)<\/script>/)?.[1];
  const run = (store, broken = false) => {
    const attrs = {};
    const ctx = vm.createContext({
      localStorage: makeStorage(store, broken),
      document: { documentElement: { style: { setProperty() {} }, setAttribute: (k, v) => { attrs[k] = v; } }, querySelector: () => ({ setAttribute() {} }) },
    });
    vm.runInContext(script, ctx);
    return attrs;
  };
  test('zapnutý režim se nastaví hned, vypnutý ani poškozená hodnota nic nenastaví', () => {
    assert.equal(run({ 'jomarid-lively': '1' })['data-lively'], '1');
    assert.equal(run({})['data-lively'], undefined);
    assert.equal(run({ 'jomarid-lively': '0' })['data-lively'], undefined);
    assert.equal(run({ 'jomarid-lively': 'ano' })['data-lively'], undefined);
  });
  test('zablokované úložiště skript nerozbije', () => assert.doesNotThrow(() => run({}, true)));
});

describe('kde se co kreslí', () => {
  test('čtečka, hra a krátké knihy zůstávají klidné', () => {
    for (const p of ['/read/abc', '/read/', '/read', '/games/rocket', '/games/chess/', '/shorts', '/shorts/']) {
      assert.deepEqual(livelyScope(p), { ambient: false, motion: false, sides: false }, p);
    }
  });
  test('rozcestník her a běžné stránky dostanou všechno', () => {
    for (const p of ['/', '/app', '/games', '/games/', '/stats', '/badges/games', '/settings/vzhled', '/login', '/autor/12']) {
      assert.deepEqual(livelyScope(p), { ambient: true, motion: true, sides: true }, p);
    }
  });
  test('správa a nakladatelský panel mají široký obsah: pozadí a pohyb ano, ozdoby po stranách ne', () => {
    for (const p of ['/admin', '/admin/', '/publisher']) assert.deepEqual(livelyScope(p), { ambient: true, motion: true, sides: false }, p);
  });
  test('podobné názvy nespadají do klidných stránek (např. /readme, /gamesx)', () => {
    for (const p of ['/readme', '/gamesx', '/shortsfoo', '/administrace']) assert.equal(livelyScope(p).ambient, true, p);
  });
  test('nesmyslný vstup se chová jako úvodní stránka', () => {
    for (const p of [undefined, null, '', 5, {}]) assert.deepEqual(livelyScope(p), livelyScope('/'));
  });
});

describe('pruh průběhu stránky', () => {
  test('podíl 0 až 1, ořezaný; krátká stránka a nesmysly dají 0', () => {
    assert.equal(scrollProgress(0, 2000, 1000), 0);
    assert.equal(scrollProgress(500, 2000, 1000), 0.5);
    assert.equal(scrollProgress(1000, 2000, 1000), 1);
    assert.equal(scrollProgress(1400, 2000, 1000), 1, 'přetažení za konec (gumový posun na mobilu)');
    assert.equal(scrollProgress(-40, 2000, 1000), 0, 'přetažení před začátek');
    assert.equal(scrollProgress(0, 800, 1000), 0);
    assert.equal(scrollProgress(0, 1000, 1000), 0);
    for (const bad of [NaN, undefined, 'x', Infinity]) assert.equal(scrollProgress(bad, 2000, 1000), 0, String(bad));
  });
});

describe('jemné ozdoby (pozadí a ikonky po stranách)', () => {
  test('každá ikona z dat je naimportovaná a zapsaná v mapě ikon komponenty', () => {
    const src = read('src', 'lively', 'LivelyScenery.jsx');
    const imported = src.match(/import \{([^}]*)\} from 'lucide-react'/)[1].split(',').map((s) => s.trim());
    const mapped = src.match(/const ICONS = \{([^}]*)\}/)[1].split(',').map((s) => s.trim());
    for (const name of ICON_NAMES) { assert.ok(imported.includes(name), `import ${name}`); assert.ok(mapped.includes(name), `mapa ${name}`); }
    for (const name of mapped) assert.ok(ICON_NAMES.includes(name), `nepoužitá ikona ${name}`);
  });
  test('každá ikona z dat opravdu existuje v lucide-react', () => {
    for (const name of ICON_NAMES) {
      const file = name.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase();
      assert.ok(fs.existsSync(path.join(ROOT, 'node_modules', 'lucide-react', 'dist', 'esm', 'icons', `${file}.js`)), name);
    }
  });
  test('každá animace ikon má pravidlo i klíčové snímky v lively.css', () => {
    for (const a of ANIMATIONS) {
      assert.ok(css.includes(`.lv-${a} {`), `třída lv-${a}`);
      assert.ok(css.includes(`@keyframes lv${a[0].toUpperCase()}${a.slice(1)} `), `klíčové snímky ${a}`);
    }
    for (const it of Object.values(SIDE_ITEMS).flat()) assert.ok(ANIMATIONS.includes(it.anim), `${it.icon}: ${it.anim}`);
  });
  test('ikonky po stranách: oba pruhy, uvnitř pruhu, pod horní lištou, od sebe', () => {
    assert.ok(SIDE_ITEMS.left.length >= 6 && SIDE_ITEMS.right.length >= 6);
    for (const [side, items] of Object.entries(SIDE_ITEMS)) {
      for (const it of items) {
        assert.ok(it.x >= 15 && it.x <= 85 && it.y >= 12 && it.y <= 92, `${side} ${it.icon} je uvnitř pruhu`);
        assert.ok(it.size >= 24 && it.size <= 48, `${side} ${it.icon} velikost`);
        assert.ok(it.par >= 0.001 && it.par <= 0.004, `${side} ${it.icon} rychlost houpání při posouvání`);
      }
      const ys = items.map((it) => it.y).sort((a, b) => a - b);
      for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= 8, `${side}: ikonky jsou od sebe`);
    }
  });
  test('tečky: pevné rozmístění (žádná náhoda při vykreslení), uvnitř okna, různé rychlosti', () => {
    const a = particles(); const b = particles();
    assert.deepEqual(a, b);
    assert.equal(a.length, PARTICLE_COUNT);
    for (const p of a) assert.ok(p.x >= 1 && p.x <= 98 && p.size >= 3 && p.size <= 6 && p.dur >= 16 && p.dur <= 28 && p.del <= 0);
    assert.ok(new Set(a.map((p) => p.x)).size >= PARTICLE_COUNT - 1, 'různé vodorovné polohy');
    assert.ok(new Set(a.map((p) => p.dur)).size > 4, 'různé rychlosti');
  });
  test('zmizely postavičky, tvorové a konfety z minulé verze (rozhraní se hýbe, ne ozdoby)', () => {
    for (const f of [['src', 'lively', 'Scenes.jsx'], ['src', 'lively', 'sparkles.js']]) assert.equal(fs.existsSync(path.join(ROOT, ...f)), false, f.join('/'));
    for (const word of ['lv-roam', 'lv-scene', 'lv-spot', 'owl-', 'rocket-wrap']) assert.ok(!css.includes(word), word);
  });
});

describe('motion.js: časování a čísla', () => {
  test('zpoždění roste po krocích a od devátého prvku už ne (stovka karet nečeká několik vteřin)', () => {
    assert.equal(staggerDelay(0), 0);
    assert.ok(Math.abs(staggerDelay(3) - 3 * REVEAL_STEP) < 1e-9);
    assert.ok(Math.abs(staggerDelay(REVEAL_MAX_STEPS) - REVEAL_MAX_STEPS * REVEAL_STEP) < 1e-9);
    assert.equal(staggerDelay(500), staggerDelay(REVEAL_MAX_STEPS));
    assert.ok(Math.abs(staggerDelay(2, 0.5) - (0.5 + 2 * REVEAL_STEP)) < 1e-9, 'zpoždění celé dávky se přičte');
    for (const bad of [-5, NaN, undefined, 'x']) assert.equal(staggerDelay(bad), 0, String(bad));
    assert.ok(staggerDelay(REVEAL_MAX_STEPS) < 1, 'celé objevení trvá pod vteřinu zpoždění');
  });
  test('easeOutExpo: 0 na začátku, 1 na konci, rychlý rozjezd, rostoucí, ořezaný', () => {
    assert.equal(easeOutExpo(0) < 0.001, true);
    assert.equal(easeOutExpo(1), 1);
    assert.ok(easeOutExpo(0.3) > 0.8, 'za třetinu času je hotovo z větší části');
    let prev = -1;
    for (let t = 0; t <= 1; t += 0.05) { const v = easeOutExpo(t); assert.ok(v >= prev); prev = v; }
    assert.equal(easeOutExpo(5), 1); assert.ok(easeOutExpo(-3) < 0.001); assert.ok(easeOutExpo(NaN) < 0.001);
  });
  test('countAt: celá čísla, na konci přesně cíl, funguje i dolů a z nuly', () => {
    assert.equal(countAt(0, 100, 0) < 2, true);
    assert.equal(countAt(0, 100, 1), 100);
    assert.equal(countAt(0, 100, 2), 100, 'přes konec zůstane cíl');
    assert.equal(countAt(100, 0, 1), 0);
    assert.equal(countAt(40, 40, 0.5), 40);
    for (let t = 0; t <= 1; t += 0.1) assert.ok(Number.isInteger(countAt(0, 997, t)), `celé číslo v ${t}`);
    const mid = countAt(100, 0, 0.1); assert.ok(mid < 100 && mid > 0, 'klesá');
    assert.equal(countAt(0, NaN, 0.5), 0);
  });
  test('countDuration: malé změny rychle, velké déle, vždy mezi 0,6 a 1,4 s', () => {
    assert.ok(countDuration(0, 3) < countDuration(0, 5000));
    for (const [a, b] of [[0, 0], [0, 1], [0, 50], [0, 100000], [900, 0], [NaN, 5]]) { const d = countDuration(a, b); assert.ok(d >= 600 && d <= 1400, `${a}→${b}: ${d}`); }
  });
  test('tiltFor: střed karty bez náklonu, rohy do opačných stran, ořez a nesmysly', () => {
    const rect = { width: 200, height: 300 };
    assert.deepEqual(tiltFor(100, 150, rect), { rx: 0, ry: 0, mx: 50, my: 50 });
    const tl = tiltFor(0, 0, rect); assert.equal(tl.rx, TILT_MAX); assert.equal(tl.ry, -TILT_MAX);
    const br = tiltFor(200, 300, rect); assert.equal(br.rx, -TILT_MAX); assert.equal(br.ry, TILT_MAX);
    assert.deepEqual(tiltFor(999, -999, rect), tiltFor(200, 0, rect), 'mimo kartu se ořízne');
    assert.ok(TILT_MAX <= 10, 'náklon je jemný');
    for (const bad of [null, {}, { width: 0, height: 10 }, { width: -1, height: -1 }]) assert.deepEqual(tiltFor(5, 5, bad), { rx: 0, ry: 0, mx: 50, my: 50 });
    assert.deepEqual(tiltFor(NaN, undefined, rect), tiltFor(0, 0, rect));
  });
});

// ---- atrapa DOM pro reveal.js: jen to, co orchestrátor používá ----
class FakeEl {
  constructor(name, { card = false, grow = false, skip = false, absolute = false, rect = {}, parent = null } = {}) {
    Object.assign(this, { name, nodeType: 1, flags: { card, grow, skip }, absolute, attrs: {}, props: {}, kids: [], isConnected: true });
    this.rect = { top: 0, left: 0, width: 300, height: 120, bottom: (rect.top || 0) + (rect.height || 120), ...rect };
    if (rect.top !== undefined && rect.bottom === undefined) this.rect.bottom = rect.top + this.rect.height;
    this.parentElement = parent;
    if (parent) parent.kids.push(this);
    this.classList = { contains: (c) => c === 'absolute' && this.absolute };
    this.style = { setProperty: (k, v) => { this.props[k] = v; }, removeProperty: (k) => { delete this.props[k]; } };
  }
  matches(sel) { if (sel === GROW_SELECTOR) return this.flags.grow; if (sel === CARD_SELECTOR) return this.flags.card; if (sel === REVEAL_SELECTOR) return this.flags.card || this.flags.grow; return false; }
  closest(sel) { for (let e = this; e; e = e.parentElement) { if (sel === SKIP_SELECTOR ? e.flags.skip : sel === CARD_SELECTOR ? e.flags.card : false) return e; } return null; }
  querySelectorAll(sel) { const out = []; const walk = (e) => { for (const k of e.kids) { if (k.matches(sel)) out.push(k); walk(k); } }; walk(this); return out; }
  hasAttribute(k) { return k in this.attrs; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  getBoundingClientRect() { return this.rect; }
  get lv() { return this.attrs['data-lv']; }
}
const setup = ({ withMain = true, io = true, mo = true } = {}) => {
  const main = new FakeEl('main');
  const timers = []; let timerId = 0;
  const listeners = {};
  const doc = { querySelector: (s) => (withMain && s === 'main' ? main : null), addEventListener: (t, fn) => { listeners[t] = fn; }, removeEventListener: (t) => { delete listeners[t]; } };
  const observed = new Set(); const ios = []; const mos = [];
  class IO { constructor(cb, opts) { this.cb = cb; this.opts = opts; this.disconnected = false; ios.push(this); } observe(e) { observed.add(e); } unobserve(e) { observed.delete(e); } disconnect() { this.disconnected = true; } }
  class MO { constructor(cb) { this.cb = cb; this.disconnected = false; mos.push(this); } observe(target, opts) { this.target = target; this.opts = opts; } disconnect() { this.disconnected = true; } }
  const reveal = createReveal({ doc, win: { innerHeight: 800 }, IO: io ? IO : undefined, MO: mo ? MO : undefined, setTimer: (fn, ms) => { timers.push({ id: ++timerId, fn, ms }); return timerId; }, clearTimer: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); } });
  const hit = (...els) => ios[0].cb(els.map((target) => ({ target, isIntersecting: true })));
  const added = (...nodes) => mos[0].cb([{ addedNodes: nodes }]);
  const end = (el, animationName = 'lvIn') => listeners.animationend && listeners.animationend({ target: el, animationName });
  return { main, doc, reveal, observed, ios, mos, timers, listeners, hit, added, end };
};
const card = (parent, top, extra = {}) => new FakeEl(`card@${top}`, { card: true, parent, rect: { top, height: 120 }, ...extra });

describe('reveal.js: výběr prvků', () => {
  test('selektory: karty, sekce, články a rámečkové rámečky; ukazatele; přeskakují se okna, přilepené a lišty', () => {
    for (const part of ['section', 'article', '.border', '.rounded-xl', '.rounded-2xl', '.rounded-3xl']) assert.ok(CARD_SELECTOR.includes(part), part);
    assert.ok(CARD_SELECTOR.startsWith('main '), 'jen obsah stránky, ne lišta ani okna mimo main');
    assert.ok(!/button|input|select|textarea/.test(CARD_SELECTOR), 'tlačítka a políčka se nehýbou');
    assert.equal(GROW_SELECTOR, 'main [data-lv-grow]');
    assert.equal(REVEAL_SELECTOR, `${CARD_SELECTOR}, ${GROW_SELECTOR}`);
    for (const part of ['[role="dialog"]', '.fixed', '.sticky', 'nav', '[data-lv-skip]']) assert.ok(SKIP_SELECTOR.includes(part), part);
  });
  test('isCandidate: velká karta ano; malá, přeskočená, absolutní, už označená a cizí prvky ne; ukazatel vždy', () => {
    const main = new FakeEl('main');
    assert.equal(isCandidate(card(main, 0)), true);
    assert.equal(isCandidate(card(main, 0, { rect: { top: 0, width: 100, height: 120 } })), false, 'úzká');
    assert.equal(isCandidate(card(main, 0, { rect: { top: 0, width: 300, height: 30 } })), false, 'nízká');
    assert.equal(isCandidate(card(main, 0, { absolute: true })), false, 'absolutně položená ozdoba');
    const dialog = new FakeEl('dialog', { skip: true, parent: main });
    assert.equal(isCandidate(card(dialog, 0)), false, 'uvnitř okna nebo přilepeného prvku');
    const marked = card(main, 0); marked.setAttribute('data-lv', 'wait');
    assert.equal(isCandidate(marked), false, 'už označená');
    assert.equal(isCandidate(new FakeEl('div', { parent: main })), false, 'obyčejný prvek');
    assert.equal(isCandidate(new FakeEl('bar', { grow: true, parent: main, rect: { top: 0, width: 10, height: 6 } })), true, 'ukazatel je malý, ale hýbe se');
    assert.equal(isCandidate(null), false); assert.equal(isCandidate({ nodeType: 3 }), false);
  });
});

describe('reveal.js: objevování', () => {
  test('bez IntersectionObserveru, MutationObserveru nebo main se nic neděje a nic se neskryje', () => {
    for (const opts of [{ io: false }, { mo: false }, { withMain: false }]) {
      const t = setup(opts); const c = card(t.main, 0);
      assert.equal(t.reveal.start(), false);
      assert.equal(c.lv, undefined, JSON.stringify(opts));
    }
  });
  test('start: velké karty se hned skryjí (wait) a sledují se; malé a v oknech ne', () => {
    const t = setup(); const a = card(t.main, 0); const b = card(t.main, 200); const tiny = card(t.main, 400, { rect: { top: 400, width: 50, height: 20 } });
    const dlg = new FakeEl('dlg', { skip: true, parent: t.main }); const inDlg = card(dlg, 600);
    assert.equal(t.reveal.start(), true);
    assert.deepEqual([a.lv, b.lv, tiny.lv, inDlg.lv], ['wait', 'wait', undefined, undefined]);
    assert.ok(t.observed.has(a) && t.observed.has(b) && !t.observed.has(tiny));
    assert.equal(t.ios[0].opts.threshold, 0, 'vysoký prvek se objeví, jakmile do okna zasáhne');
    assert.deepEqual(t.mos[0].opts, { childList: true, subtree: true });
    assert.equal(t.reveal.start(), true, 'druhé spuštění nic nezdvojí'); assert.equal(t.ios.length, 1);
  });
  test('objeví se v pořadí na stránce (shora dolů, zleva doprava) a se zpožděním po krocích, i když přijdou zamíchané', () => {
    const t = setup(); const c = [card(t.main, 300), card(t.main, 0), card(t.main, 150), card(t.main, 150, { rect: { top: 150, left: 400, height: 120 } })];
    t.reveal.start(); t.hit(...c);
    const order = [...c].sort((x, y) => x.props['--lv-d'].localeCompare(y.props['--lv-d'])).map((e) => e.name);
    assert.deepEqual(order, ['card@0', 'card@150', 'card@150', 'card@300']);
    assert.deepEqual(c.map((e) => e.lv), ['in', 'in', 'in', 'in']);
    assert.equal(c[1].props['--lv-d'], '0.00s'); assert.equal(c[2].props['--lv-d'], '0.06s'); assert.equal(c[3].props['--lv-d'], '0.12s'); assert.equal(c[0].props['--lv-d'], '0.18s');
    assert.equal(t.observed.size, 0, 'objevené se už nesledují');
  });
  test('víc než devět prvků naráz: zpoždění se zastaví na stropu', () => {
    const t = setup(); const c = Array.from({ length: 14 }, (_, i) => card(t.main, i * 150));
    t.reveal.start(); t.hit(...c);
    assert.equal(c[13].props['--lv-d'], `${(REVEAL_MAX_STEPS * REVEAL_STEP).toFixed(2)}s`);
    assert.equal(c[9].props['--lv-d'], c[13].props['--lv-d']);
  });
  test('vnořený prvek (řádek, ukazatel) čeká zaparkovaný, dokud se neobjeví karta, a začne chvíli po ní', () => {
    const t = setup(); const outer = card(t.main, 0); const row1 = card(outer, 10, { rect: { top: 10, height: 50 } }); const bar = new FakeEl('bar', { grow: true, parent: outer, rect: { top: 80, width: 80, height: 8 } });
    t.reveal.start();
    assert.deepEqual([outer.lv, row1.lv, bar.lv], ['wait', 'parked', 'parked']);
    assert.ok(!t.observed.has(row1) && !t.observed.has(bar), 'zaparkované se nesledují');
    t.hit(outer);
    assert.deepEqual([outer.lv, row1.lv, bar.lv], ['in', 'wait', 'wait']);
    assert.ok(t.observed.has(row1) && t.observed.has(bar), 'po objevení karty se začnou sledovat');
    t.hit(row1, bar);
    assert.ok(parseFloat(row1.props['--lv-d']) >= NESTED_BASE - 1e-9, `řádek začne po kartě (${row1.props['--lv-d']})`);
    assert.ok(parseFloat(bar.props['--lv-d']) > parseFloat(row1.props['--lv-d']) - 1e-9);
  });
  test('prvek přidaný později (načtená data, přepnutá záložka) se skryje ještě v témže okamžiku a objeví se normálně', () => {
    const t = setup(); t.reveal.start();
    const late = card(t.main, 0); const lateRow = card(late, 5, { rect: { top: 5, height: 50 } });
    t.added(late);
    assert.deepEqual([late.lv, lateRow.lv], ['wait', 'parked'], 'skryté synchronicky, před prvním vykreslením');
    t.hit(late); assert.equal(late.lv, 'in');
    t.end(late); assert.equal(late.lv, undefined);
    t.hit(lateRow); assert.equal(lateRow.lv, 'in');
  });
  test('řádek přidaný do už objevené a dohrané karty se objeví sám (přepnutí záložky žebříčku)', () => {
    const t = setup(); const outer = card(t.main, 0); t.reveal.start(); t.hit(outer); t.end(outer);
    const row = card(outer, 10, { rect: { top: 10, height: 50 } });
    t.added(row);
    assert.equal(row.lv, 'wait'); assert.ok(t.observed.has(row));
    t.hit(row); assert.equal(row.lv, 'in');
  });
  test('po dohrání animace se atribut i zpoždění odeberou: prvek je zase úplně obyčejný a znovu se nehýbe', () => {
    const t = setup(); const c = card(t.main, 0); t.reveal.start(); t.hit(c);
    assert.equal(c.lv, 'in');
    t.end(c, 'jinaAnimace'); assert.equal(c.lv, 'in', 'cizí animace prvek neuvolní');
    t.end(new FakeEl('x'), 'lvIn'); assert.equal(c.lv, 'in', 'animationend jiného prvku také ne');
    t.end(c, 'lvIn');
    assert.equal(c.lv, undefined); assert.equal(c.props['--lv-d'], undefined);
    t.added(c); assert.equal(c.lv, undefined, 'přesunutý už jednou objevený prvek se znovu nehýbe');
    assert.deepEqual(REVEAL_ANIMATIONS, ['lvIn', 'lvGrow']);
  });
  test('pojistka: kdyby animationend nedorazil, prvek se uvolní sám po uplynutí animace', () => {
    const t = setup(); const c = card(t.main, 0); t.reveal.start(); t.hit(c);
    const timer = t.timers.find((x) => x.ms > 1000 && x.ms !== 1500);
    assert.ok(timer && timer.ms >= 2000 && timer.ms < 5000, `časovač ${timer && timer.ms}`);
    timer.fn();
    assert.equal(c.lv, undefined);
  });
  test('pojistka: když IntersectionObserver nic nehlásí, po chvíli se objeví vše, co je v okně; mimo okno ne; odpojené se zahodí', () => {
    const t = setup(); const inView = card(t.main, 100); const below = card(t.main, 5000); const gone = card(t.main, 200);
    t.reveal.start(); gone.isConnected = false;
    const sweep = t.timers.find((x) => x.ms === 1500); assert.ok(sweep, 'kontrola je naplánovaná');
    sweep.fn();
    assert.equal(inView.lv, 'in'); assert.equal(below.lv, 'wait'); assert.equal(gone.lv, 'wait', 'odpojený se nesvítí, jen se zapomene');
    assert.deepEqual(t.reveal.counts(), { wait: 1, parked: 0, in: 1 });
  });
  test('stop: všechno se vrátí do původního stavu, pozorovatelé se odpojí, druhé volání nic nerozbije', () => {
    const t = setup(); const a = card(t.main, 0); const inner = card(a, 10, { rect: { top: 10, height: 50 } }); const b = card(t.main, 200);
    t.reveal.start(); t.hit(b);
    t.reveal.stop();
    assert.deepEqual([a.lv, inner.lv, b.lv], [undefined, undefined, undefined]);
    assert.equal(b.props['--lv-d'], undefined);
    assert.ok(t.ios[0].disconnected && t.mos[0].disconnected);
    assert.equal(t.listeners.animationend, undefined, 'posluchač je pryč');
    assert.equal(t.timers.length, 0, 'žádný zapomenutý časovač');
    assert.doesNotThrow(() => t.reveal.stop());
    assert.deepEqual(t.reveal.counts(), { wait: 0, parked: 0, in: 0 });
  });
});

describe('tilt.js: naklánění karet', () => {
  const fakeWin = (hover = true) => ({ matchMedia: (q) => ({ matches: hover && q === '(hover: hover) and (pointer: fine)' }) });
  const card = () => { const props = {}; return { props, style: { setProperty: (k, v) => { props[k] = v; }, removeProperty: (k) => { delete props[k]; } }, getBoundingClientRect: () => ({ left: 100, top: 100, width: 200, height: 300 }), closest(sel) { return sel === TILT_SELECTOR ? this : null; } }; };
  const mkDoc = (lively = '1', reduce = '0') => { const l = {}; return { l, documentElement: { dataset: { lively, reduceMotion: reduce } }, addEventListener: (t, fn) => { l[t] = fn; }, removeEventListener: (t) => { delete l[t]; } }; };
  // requestAnimationFrame jako ve skutečnosti: funkce se spustí později (flush), ne uvnitř volání
  const run = (extra) => { const doc = mkDoc(...(extra || [])); const queue = []; const off = installTilt({ doc, win: fakeWin(), raf: (fn) => { queue.push(fn); return queue.length; }, cancel: () => { queue.length = 0; } }); const flush = () => { while (queue.length) queue.shift()(); }; return { doc, off, flush }; };
  test('karta knihy se nakloní za kurzorem a po odjetí se vrátí; jiná karta ho převezme', () => {
    const { doc, flush } = run(); const c1 = card(); const c2 = card();
    doc.l.pointermove({ pointerType: 'mouse', target: c1, clientX: 280, clientY: 120 }); flush();
    assert.deepEqual(c1.props, { '--rx': `${tiltFor(180, 20, { width: 200, height: 300 }).rx}deg`, '--ry': `${tiltFor(180, 20, { width: 200, height: 300 }).ry}deg`, '--mx': '90%', '--my': '7%' });
    doc.l.pointermove({ pointerType: 'mouse', target: c2, clientX: 200, clientY: 250 }); flush();
    assert.deepEqual(c1.props, {}, 'předchozí karta se uklidí');
    assert.ok('--rx' in c2.props);
    doc.l.pointermove({ pointerType: 'mouse', target: { closest: () => null }, clientX: 1, clientY: 1 });
    assert.deepEqual(c2.props, {}, 'mimo kartu se uklidí');
  });
  test('na dotyku, bez Živého režimu a při omezeném pohybu se nic neděje (a rozjetý náklon se uklidí)', () => {
    let { doc } = run(); let c = card();
    doc.l.pointermove({ pointerType: 'touch', target: c, clientX: 150, clientY: 150 });
    assert.deepEqual(c.props, {});
    ({ doc } = run(['0'])); c = card(); doc.l.pointermove({ pointerType: 'mouse', target: c, clientX: 150, clientY: 150 }); assert.deepEqual(c.props, {}, 'režim vypnutý');
    ({ doc } = run(['1', '1'])); c = card(); doc.l.pointermove({ pointerType: 'mouse', target: c, clientX: 150, clientY: 150 }); assert.deepEqual(c.props, {}, 'omezený pohyb');
  });
  test('bez myši (telefon) se posluchač vůbec nezapne; vypnutí posluchače karty uklidí', () => {
    const doc = mkDoc(); installTilt({ doc, win: fakeWin(false) });
    assert.deepEqual(Object.keys(doc.l), []);
    const { doc: d2, off, flush: f2 } = run(); const c = card(); d2.l.pointermove({ pointerType: 'pen', target: c, clientX: 150, clientY: 150 }); f2();
    assert.ok('--rx' in c.props, 'pero se počítá jako ukazatel');
    off(); assert.deepEqual(c.props, {}); assert.deepEqual(Object.keys(d2.l), []);
    assert.equal(typeof installTilt({ doc: null }), 'function');
  });
  test('selektor karty odpovídá kartě v knihovně', () => {
    assert.equal(TILT_SELECTOR, '[data-testid="library-card"]');
    assert.ok(read('src', 'browse', 'LibraryBrowser.jsx').includes('data-testid="library-card"'));
  });
});

// ---- kruh po kliknutí ----
const fakeEl = (hasAnimate = true) => {
  const el = { style: {}, attrs: {}, removed: false, animations: [], setAttribute(k, v) { this.attrs[k] = v; }, remove() { this.removed = true; } };
  if (hasAnimate) el.animate = (frames, opts) => { let done; const finished = new Promise((r) => { done = r; }); el.animations.push({ frames, opts, finish: done }); return { finished }; };
  return el;
};
const fakeDoc = ({ lively = '1', reduce = '0', hasAnimate = true } = {}) => {
  const listeners = {}; const created = [];
  return { created, listeners, documentElement: { dataset: { lively, reduceMotion: reduce } }, body: { children: [], appendChild(e) { this.children.push(e); } }, createElement: () => { const e = fakeEl(hasAnimate); created.push(e); return e; }, addEventListener(t, fn, o) { listeners[t] = { fn, o }; }, removeEventListener(t) { delete listeners[t]; } };
};
const target = (props = {}) => ({ closest: () => ({ disabled: false, getAttribute: () => null, ...props }) });
const flush = () => new Promise((r) => setImmediate(r));

describe('ripple.js: kruh po kliknutí', () => {
  test('cílem je tlačítko, odkaz, přepínač i přepínač voleb, ne vypnutý prvek ani holý text', () => {
    assert.ok(rippleTarget(target()));
    assert.equal(rippleTarget(target({ disabled: true })), null);
    assert.equal(rippleTarget(target({ getAttribute: (k) => (k === 'aria-disabled' ? 'true' : null) })), null);
    assert.equal(rippleTarget({ closest: () => null }), null); assert.equal(rippleTarget(null), null); assert.equal(rippleTarget({}), null);
    const sel = fs.readFileSync(path.join(ROOT, 'src', 'lively', 'ripple.js'), 'utf8').match(/const INTERACTIVE = '([^']*)'/)[1];
    for (const part of ['button', 'a[href]', '[role="radio"]', '[role="switch"]']) assert.ok(sel.includes(part), part);
  });
  test('kruh se vykreslí na místě kliknutí, rozšíří se a zmizí a po dohrání se uklidí', async () => {
    const doc = fakeDoc(); const live = { n: 0 };
    assert.equal(rippleAt(100, 200, { doc, live }), 1);
    const el = doc.created[0];
    assert.equal(el.style.left, '100px'); assert.equal(el.style.top, '200px'); assert.equal(el.style.pointerEvents, 'none'); assert.equal(el.style.borderRadius, '50%');
    assert.equal(el.attrs['aria-hidden'], 'true');
    const f = el.animations[0].frames; assert.ok(f[0].opacity > 0.5 && f.at(-1).opacity === 0, 'zmizí'); assert.match(f.at(-1).transform, /scale\(([3-9]|\d{2})/, 'rozšíří se');
    el.animations[0].finish(); await flush();
    assert.equal(el.removed, true); assert.equal(live.n, 0);
  });
  test('strop současných kruhů: rychlé klikání stránku nezahltí', () => {
    const doc = fakeDoc(); const live = { n: 0 };
    for (let i = 0; i < 20; i++) rippleAt(10, 10, { doc, live });
    assert.equal(doc.created.length, MAX_RIPPLES); assert.equal(live.n, MAX_RIPPLES);
  });
  test('prohlížeč bez Web Animations API a nesmyslné souřadnice: nic se nevykreslí a nic nespadne', () => {
    const doc = fakeDoc({ hasAnimate: false });
    assert.equal(rippleAt(1, 1, { doc }), 0); assert.equal(doc.body.children.length, 0);
    const ok = fakeDoc();
    assert.equal(rippleAt(NaN, 5, { doc: ok }), 0); assert.equal(rippleAt(5, undefined, { doc: ok }), 0); assert.equal(rippleAt(5, 5, { doc: null }), 0);
  });
  test('posluchač: kliknutí na tlačítko spustí kruh, vypnutí posluchače ho odebere; jinak nic', () => {
    const doc = fakeDoc();
    const off = installClickRipple({ doc, getScope: () => ({ motion: true }) });
    assert.equal(doc.listeners.pointerdown.o.passive, true, 'nezdržuje posouvání na dotykových zařízeních');
    doc.listeners.pointerdown.fn({ button: 0, clientX: 50, clientY: 60, target: target() });
    assert.equal(doc.created.length, 1);
    off(); assert.equal(doc.listeners.pointerdown, undefined);
    const click = (d, e = {}, scope = { motion: true }) => { installClickRipple({ doc: d, getScope: () => scope }); d.listeners.pointerdown.fn({ button: 0, clientX: 1, clientY: 1, target: target(), ...e }); return d.created.length; };
    assert.equal(click(fakeDoc({ lively: '0' })), 0, 'režim vypnutý');
    assert.equal(click(fakeDoc({ reduce: '1' })), 0, 'omezený pohyb');
    assert.equal(click(fakeDoc(), {}, { motion: false }), 0, 'čtečka a hry');
    assert.equal(click(fakeDoc(), { button: 2 }), 0, 'pravé tlačítko');
    assert.equal(click(fakeDoc(), { target: { closest: () => null } }), 0, 'klik mimo ovladací prvek');
    assert.equal(click(fakeDoc(), { target: target({ disabled: true }) }), 0, 'vypnuté tlačítko');
    assert.equal(click(fakeDoc()), 1, 'kontrola: za normálních podmínek funguje');
    assert.equal(typeof installClickRipple({ doc: null }), 'function');
  });
});

describe('reduced.js: omezený pohyb už při prvním vykreslení', () => {
  test('atribut na <html> rozhoduje; když chybí (první vykreslení), vyhodnotí se nastavení hned a atribut se nastaví', () => {
    assert.equal(prefersReducedMotion({ documentElement: { dataset: { reduceMotion: '1' } } }), true);
    assert.equal(prefersReducedMotion({ documentElement: { dataset: { reduceMotion: '0' } } }), false);
    setStorage(makeStorage({ [T.MOTION_KEY]: 'reduce' }));
    assert.equal(prefersReducedMotion(), true, 'uživatel zvolil Omezit, atribut ještě není');
    assert.equal(document.documentElement.dataset.reduceMotion, '1');
    setDocument({ documentElement: { dataset: {} } }); setStorage(makeStorage({ [T.MOTION_KEY]: 'full' }));
    assert.equal(prefersReducedMotion(), false, 'Plné');
    setDocument({ documentElement: { dataset: {} } }); setStorage(makeStorage());
    assert.equal(prefersReducedMotion(), false, 'výchozí (podle zařízení, tady bez omezení)');
    assert.equal(prefersReducedMotion(null), false, 'bez dokumentu nespadne');
  });
});

describe('viewTransition.js: kruhový přechod při změně motivu', () => {
  const doc = (extra = {}) => ({ documentElement: { dataset: { reduceMotion: '0' }, style: { props: {}, setProperty(k, v) { this.props[k] = v; } } }, addEventListener(t, fn, o) { this.l = { t, fn, o }; }, removeEventListener() { this.l = null; }, ...extra });
  test('s podporou prohlížeče se změna provede uvnitř přechodu a přes flush (v Reactu flushSync)', () => {
    let ran = 0; let flushed = 0; let cb;
    const d = doc({ startViewTransition: (fn) => { cb = fn; } });
    assert.equal(withViewTransition(() => { ran += 1; }, { doc: d, flush: (fn) => { flushed += 1; fn(); } }), true);
    assert.equal(ran, 0, 'změna se provede až uvnitř přechodu (prohlížeč nejdřív pořídí starý snímek)');
    cb(); assert.deepEqual([ran, flushed], [1, 1]);
  });
  test('bez podpory, s vypnutým režimem nebo omezeným pohybem se změna provede hned a normálně', () => {
    for (const [d, enabled] of [[doc(), true], [doc({ startViewTransition: () => {} }), false], [{ ...doc({ startViewTransition: () => {} }), documentElement: { dataset: { reduceMotion: '1' }, style: {} } }, true], [null, true]]) {
      let ran = 0;
      assert.equal(withViewTransition(() => { ran += 1; }, { doc: d, enabled }), false);
      assert.equal(ran, 1);
    }
    assert.equal(supportsViewTransition(doc({ startViewTransition: () => {} })), true); assert.equal(supportsViewTransition(doc()), false); assert.equal(supportsViewTransition(null), false);
  });
  test('když přechod selže, změna se přesto provede (motiv se nikdy nezasekne)', () => {
    let ran = 0;
    assert.equal(withViewTransition(() => { ran += 1; }, { doc: doc({ startViewTransition: () => { throw new Error('nejde'); } }) }), false);
    assert.equal(ran, 1);
  });
  test('kruh vyroste z místa posledního kliknutí (--vt-x a --vt-y), nesmyslné souřadnice se ignorují', () => {
    const d = doc(); const off = trackPointerOrigin(d);
    d.l.fn({ clientX: 120.6, clientY: 80.2 });
    assert.deepEqual(d.documentElement.style.props, { '--vt-x': '121px', '--vt-y': '80px' });
    d.l.fn({ clientX: NaN, clientY: 3 }); assert.equal(d.documentElement.style.props['--vt-y'], '80px');
    off(); assert.equal(d.l, null); assert.equal(typeof trackPointerOrigin(null), 'function');
  });
  test('App: změna motivu i akcentu jde přes přechod a barvy se mění v layout effectu (před snímkem)', () => {
    const app = read('src', 'App.jsx');
    assert.match(app, /changeTheme: \(t\) => withViewTransition\(/);
    assert.match(app, /changeAccent: \(a\) => withViewTransition\(/);
    assert.match(app, /flush: flushSync/);
    assert.match(app, /useLayoutEffect\(\(\) => \{\s*const base = resolveTheme\(currentTheme\)/);
    assert.match(app, /<LivelyMotion enabled=\{lively\} \/>/);
  });
});

describe('zapojení do stránek', () => {
  const stats = read('src', 'pages', 'UserStats.jsx');
  test('Statistiky: čísla se dotáčejí, ukazatele se plní, řádky žebříčku se při přepnutí záložky znovu objeví', () => {
    for (const v of ['stats.jomaridCoins', 'stats.level', 'stats.xp', 'stats.streak', 'stats.monthlyRead', 'stats.totalRead']) assert.match(stats, new RegExp(`<CountUp value=\\{${v.replace('.', '\\.')}\\} />`), v);
    assert.match(stats, /<CountUp value=\{row\[activeTab\]\} format=\{\(n\) => n\.toLocaleString\(\)\}/);
    assert.equal((stats.match(/data-lv-grow/g) || []).length, 2, 'ukazatel úrovně a měsíčního cíle');
    assert.match(stats, /key=\{`\$\{activeTab\}-\$\{index\}`\}/);
  });
  test('Odznaky: ukazatel splnění se plní', () => assert.match(read('src', 'components', 'BadgesSection.jsx'), /data-lv-grow className="h-full rounded-full/));
  test('CountUp: mimo Živý režim, při omezeném pohybu a u nečísla ukáže hodnotu rovnou; v režimu počítá z poslední zobrazené hodnoty', () => {
    const src = read('src', 'lively', 'CountUp.jsx');
    assert.match(src, /const lively = !!\(ctx && ctx\.lively\)/);
    assert.match(src, /const animated = lively && Number\.isFinite\(target\) && !prefersReducedMotion\(\)/);
    assert.match(src, /if \(!animated\) \{[^}]*el\.textContent = format\(value\)/);
    assert.match(src, /const from = shown\.current == null \? 0 : shown\.current/);
    assert.match(src, /clearTimeout\(timer\); cancelAnimationFrame\(raf\)/, 'úklid při změně a odpojení');
    assert.match(src, /useLayoutEffect/, 'text je správně ještě před prvním vykreslením');
  });
  test('LivelyMotion: objevování se spouští v layout effectu (před vykreslením) a jen mimo klidné stránky; naklánění taky', () => {
    const src = read('src', 'lively', 'LivelyMotion.jsx');
    assert.match(src, /useLayoutEffect\(\(\) => \{\s*if \(!on \|\| prefersReducedMotion\(\)\) return undefined;\s*const reveal = createReveal\(\);/);
    assert.match(src, /const on = enabled && scope\.motion;/);
    assert.match(src, /if \(on\) off\.push\(installTilt\(\)\)/);
    assert.match(src, /installClickRipple\(\{ getScope: \(\) => scopeRef\.current \}\)/);
  });
});

describe('lively.css', () => {
  const keyframes = new Set([...css.matchAll(/@keyframes (lv\w+)/g)].map((m) => m[1]));
  const used = new Set([...css.matchAll(/animation(?:-name)?:([^;}]*)[;}]/g)].flatMap((m) => [...m[1].matchAll(/\b(lv[A-Z]\w*)/g)].map((x) => x[1])));
  const line = (start) => css.split('\n').find((l) => l.startsWith(start));
  test('každá použitá animace má klíčové snímky a každé klíčové snímky se používají', () => {
    assert.ok(keyframes.size >= 18, `klíčových snímků je dost (${keyframes.size})`);
    for (const name of used) assert.ok(keyframes.has(name), `chybí @keyframes ${name}`);
    for (const name of keyframes) assert.ok(used.has(name), `nepoužité @keyframes ${name}`);
    for (const name of REVEAL_ANIMATIONS) assert.ok(keyframes.has(name), `${name} z reveal.js`);
  });
  test('čekající prvky se skryjí (průhledné a posunuté), objevující se jedou přes lvIn se zpožděním --lv-d; přechody se po dobu čekání vypínají', () => {
    assert.match(line('html[data-lively="1"] [data-lv="wait"]'), /\[data-lv="parked"\] \{ opacity: 0; transform: translateY\(30px\) scale\(0\.97\); transition: none !important; \}/);
    assert.match(line('html[data-lively="1"] [data-lv="in"]'), /animation: lvIn 0\.75s cubic-bezier\([^)]*\) var\(--lv-d, 0s\) backwards; transition: none !important;/);
    assert.match(line('@keyframes lvIn'), /to \{ opacity: 1; transform: none; \}/);
  });
  test('ukazatele: čekají s nulovou šířkou zleva, plní se přes lvGrow a bez posunu; pravidla jsou až za obecnými (přebijí je)', () => {
    assert.match(line('html[data-lively="1"] [data-lv-grow][data-lv="wait"]'), /opacity: 1; transform: scaleX\(0\); transform-origin: left center;/);
    assert.match(line('html[data-lively="1"] [data-lv-grow][data-lv="in"]'), /animation: lvGrow [\d.]+s [^;]*var\(--lv-d, 0s\) backwards/);
    assert.match(line('@keyframes lvGrow'), /to \{ transform: none; \}/);
    assert.ok(css.indexOf('[data-lv-grow][data-lv="wait"]') > css.indexOf('[data-lv="wait"], html'), 'pravidla ukazatelů jsou za obecnými');
  });
  test('žádná animace objevování nezanechá transformaci (jinak by prvky s position: fixed uvnitř přestaly sedět): končí transform: none a jen výplň „backwards“', () => {
    for (const name of ['lvIn', 'lvGrow']) assert.match(line(`@keyframes ${name}`), /to \{[^}]*transform: none/, name);
    for (const l of css.split('\n').filter((x) => /\[data-lv="in"\]/.test(x))) assert.match(l, /backwards/, 'bez výplně po konci');
    const fade = line('@keyframes lvFadeIn'); assert.ok(!/transform|translate|scale/.test(fade), 'rozsvícení celé stránky mění jen průhlednost');
    assert.match(css, /html\[data-lively="1"\] main > \* \{ animation: lvFadeIn/);
  });
  test('karty knih mají transformaci jen při najetí myší (v klidu žádnou) a jen v prohlížečích s myší', () => {
    const rest = css.split('\n').filter((l) => /^html\[data-lively="1"\] \[data-testid="library-card"\] \{/.test(l));
    assert.ok(rest.length >= 1);
    for (const l of rest) assert.ok(!/(^|[;{ ])transform:/.test(l), 'v klidu bez transform');
    const hover = css.match(/@media \(hover: hover\) and \(pointer: fine\) \{([\s\S]*?)\n\}/);
    assert.ok(hover, 'hover jen s myší');
    assert.match(hover[1], /library-card"\]:hover \{[^}]*transform: perspective\(900px\) rotateX\(var\(--rx, 0deg\)\) rotateY\(var\(--ry, 0deg\)\)/);
    assert.match(hover[1], /library-card"\]::after \{[^}]*radial-gradient\(circle at var\(--mx, 50%\) var\(--my, 50%\)/);
  });
  test('okna: pozadí se rozsvítí, okno vyskočí (boční panel vyjede zprava), prohlídka appky se nechává; používají se individuální translate a scale', () => {
    assert.match(line('html[data-lively="1"] .fixed.inset-0.backdrop-blur-sm'), /animation: lvFadeIn/);
    assert.match(line('html[data-lively="1"] [role="dialog"]:not([data-testid="tour-card"])'), /animation: lvModal [\d.]+s [^;]*backwards/);
    assert.match(line('html[data-lively="1"] .justify-end > [role="dialog"]'), /animation-name: lvDrawer/);
    for (const name of ['lvModal', 'lvDrawer']) { const k = line(`@keyframes ${name}`); assert.ok(/translate:/.test(k) && !/transform:/.test(k), `${name} nepřepisuje vlastní transform okna`); }
  });
  test('přepnutí motivu: nový vzhled se rozlije kruhem z --vt-x a --vt-y a stará strana se nehýbe', () => {
    assert.match(css, /::view-transition-old\(root\), html\[data-lively="1"\]::view-transition-new\(root\) \{ animation: none; mix-blend-mode: normal; \}/);
    assert.match(css, /::view-transition-new\(root\) \{ animation: lvThemeReveal/);
    assert.match(line('@keyframes lvThemeReveal'), /circle\(0 at var\(--vt-x, 50%\) var\(--vt-y, 50%\)\).*circle\(150vmax at var\(--vt-x, 50%\) var\(--vt-y, 50%\)\)/);
  });
  test('tlačítka: každá vlastnost má vlastní průběh (barvy nesmějí přestřelit), lesk u barevných, přepínač se pružně přelévá', () => {
    const t = css.match(/button:is\(\.rounded-lg, \.rounded-xl, \.rounded-full\):not\(:disabled\) \{\s*transition: ([^;]*);/)[1];
    assert.match(t, /translate [\d.]+s cubic-bezier\(0\.34, 1\.56/); assert.match(t, /background-color [\d.]+s ease/); assert.match(t, /color [\d.]+s ease/);
    assert.ok(!/background-color [\d.]+s cubic-bezier\(0\.34, 1\.56/.test(t), 'barva nepřestřeluje');
    assert.match(css, /\[style\*="background-color: var\(--bg-primary\)"\]:hover:not\(:disabled\) \{ background-position: -60% 0; \}/);
    assert.match(css, /\[role="switch"\] > span \{ transition: transform [\d.]+s cubic-bezier\(0\.34, 1\.56/);
  });
  test('horní lišta: podtržení a poskok ikony, jen u odkazů s data-tour', () => {
    assert.match(css, /nav a\[data-tour\]::after \{[^}]*transform: scaleX\(0\)/);
    assert.match(css, /nav a\[data-tour\]:hover::after \{ transform: scaleX\(1\); \}/);
    assert.match(css, /nav a\[data-tour\]:hover svg \{ transform: translateY\(-2px\) scale\(1\.18\); \}/);
  });
  test('zmrzlý řádek žebříčku: přechod se vlní, vločka se třpytí', () => {
    assert.match(css, /\[data-frozen="true"\] \{ background-size: 220% 100%; animation: lvIce/);
    assert.match(css, /\[data-testid="lb-frozen"\] \{ animation: lvSnow/);
    assert.ok(read('src', 'pages', 'UserStats.jsx').includes('data-testid="lb-frozen"') && read('src', 'pages', 'UserStats.jsx').includes("data-frozen={frozenRow ? 'true' : undefined}"));
  });
  test('Omezit pohyb a tisk: nic se neskrývá ani nehýbe, i kdyby atribut data-lv zůstal; vynucené barvy Windows a tisk ozdoby skryjí', () => {
    assert.match(css, /html\[data-reduce-motion="1"\] \[data-lv\] \{ opacity: 1 !important; transform: none !important; animation: none !important; \}/);
    assert.match(css, /@media print \{ \[data-lv\] \{ opacity: 1 !important; transform: none !important; animation: none !important; \} \}/);
    assert.match(css, /@media \(forced-colors: active\), print \{[^}]*display: none/);
    assert.match(css, /html\[data-reduce-motion="1"\] :is\(\.lv-dot, \.lv-shoot\) \{ display: none; \}/);
  });
  test('ozdoby jsou jen dekorace: nikdy nezachytí klik a mají vlastní vrstvy; ikonky po stranách jen tam, kde je místo', () => {
    for (const sel of ['.lv-bg', '.lv-sides', '.lv-progress']) {
      const m = css.match(new RegExp(`${sel.replace('.', '\\.')} \\{([^}]*)\\}`));
      assert.ok(m, sel); assert.match(m[1], /pointer-events: none/, sel); assert.match(m[1], /position: fixed/, sel);
    }
    assert.match(css, /\.lv-bg \{[^}]*z-index: -1/, 'pozadí je pod obsahem');
    assert.match(css, /@media \(min-width: 1280px\) \{ \.lv-sides \{ display: block; \} \}/);
    assert.match(css, /width: calc\(\(100% - 72rem\) \/ 2\)/);
    assert.equal(read('src', 'pages', 'HomePage.jsx').includes('max-w-6xl'), true, 'obsah stránek je opravdu max-w-6xl (72rem)');
  });
  test('každé pravidlo pro prvky stránky je za data-lively="1" (vypnutý režim nic nemění)', () => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => /^\s*html\b/.test(l) && !/^\s*html\[data-reduce-motion/.test(l));
    assert.ok(rules.length > 25);
    for (const l of rules) assert.match(l.trim(), /^html\[data-lively="1"\]/, l.slice(0, 80));
  });
});
