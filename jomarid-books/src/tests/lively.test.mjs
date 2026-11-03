// Testy Živého režimu: node --test src/tests/lively.test.mjs   (nebo: npm run test:lively)
//
// Hlídají hlavně:
//  - nastavení: ve výchozím stavu vypnuto, ukládá se, nastavuje atribut na <html>, synchronizuje se s účtem, poškozené úložiště nic nerozbije,
//  - že čtečka, hry a krátké knihy zůstávají klidné a ozdoby po stranách nezasahují do širokých stránek (správa, nakladatel),
//  - jiskřičky po kliknutí: jen u zapnutého režimu, bez omezení pohybu, jen na ovladatelných prvcích, se stropem počtu a úklidem,
//  - ozdoby: ikony, animace a stránky v CSS existují (překlep by znamenal neviditelnou nebo nepohyblivou ozdobu),
//  - že pravidla v lively.css nedělají z prvků, které obsahují position: fixed, blok s vlastním souřadným systémem.
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
import { sparkleSpecs, sparkleTarget, burstAt, installClickSparkles, SPARKLE_COUNT, MAX_LIVE_SPARKLES } from '../lively/sparkles.js';

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
      assert.deepEqual(livelyScope(p), { ambient: false, sparkles: false, sides: false }, p);
    }
  });
  test('rozcestník her a běžné stránky dostanou všechno', () => {
    for (const p of ['/', '/app', '/games', '/games/', '/stats', '/badges/games', '/settings/vzhled', '/login', '/autor/12']) {
      assert.deepEqual(livelyScope(p), { ambient: true, sparkles: true, sides: true }, p);
    }
  });
  test('správa a nakladatelský panel mají široký obsah: pozadí a jiskřičky ano, ozdoby po stranách ne', () => {
    for (const p of ['/admin', '/admin/', '/publisher']) assert.deepEqual(livelyScope(p), { ambient: true, sparkles: true, sides: false }, p);
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

describe('ozdoby', () => {
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
  test('každá animace má pravidlo i klíčové snímky v lively.css', () => {
    for (const a of ANIMATIONS) {
      assert.ok(css.includes(`.lv-${a} {`), `třída lv-${a}`);
      assert.ok(css.includes(`@keyframes lv${a[0].toUpperCase()}${a.slice(1)} `), `klíčové snímky ${a}`);
    }
    for (const it of Object.values(SIDE_ITEMS).flat()) assert.ok(ANIMATIONS.includes(it.anim), `${it.icon}: ${it.anim}`);
  });
  test('ozdoby po stranách: oba pruhy, rozumné rozměry, uvnitř pruhu, nic se nepřekrývá', () => {
    assert.ok(SIDE_ITEMS.left.length >= 6 && SIDE_ITEMS.right.length >= 6);
    for (const [side, items] of Object.entries(SIDE_ITEMS)) {
      for (const it of items) {
        assert.ok(it.x >= 15 && it.x <= 85 && it.y >= 12 && it.y <= 92, `${side} ${it.icon} je uvnitř pruhu`);
        assert.ok(it.size >= 24 && it.size <= 48, `${side} ${it.icon} velikost`);
        assert.ok(it.par >= 0.001 && it.par <= 0.004, `${side} ${it.icon} rychlost houpání při posouvání`);
        assert.ok(it.dur >= 3 && it.dur <= 14 && it.del <= 0, `${side} ${it.icon} doba a záporné zpoždění`);
      }
      const ys = items.map((it) => it.y).sort((a, b) => a - b);
      for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= 8, `${side}: ozdoby jsou od sebe`);
    }
  });
  test('tečky: pevné rozmístění (žádná náhoda), uvnitř okna, každá se pohybuje jinak', () => {
    const a = particles(); const b = particles();
    assert.deepEqual(a, b);
    assert.equal(a.length, PARTICLE_COUNT);
    for (const p of a) { assert.ok(p.x >= 1 && p.x <= 98 && p.size >= 3 && p.size <= 6 && p.dur >= 16 && p.dur <= 28 && p.del <= 0); }
    assert.ok(new Set(a.map((p) => p.x)).size >= PARTICLE_COUNT - 1, 'různé vodorovné polohy');
    assert.ok(new Set(a.map((p) => p.dur)).size > 4, 'různé rychlosti');
  });
});

describe('lively.css', () => {
  test('ozdoby jsou jen dekorace: nikdy nezachytí klik a mají vlastní vrstvy', () => {
    for (const sel of ['.lv-bg', '.lv-sides', '.lv-progress']) {
      const m = css.match(new RegExp(`${sel.replace('.', '\\.')} \\{([^}]*)\\}`));
      assert.ok(m, sel);
      assert.match(m[1], /pointer-events: none/, sel);
      assert.match(m[1], /position: fixed/, sel);
    }
    assert.match(css, /\.lv-bg \{[^}]*z-index: -1/, 'pozadí je pod obsahem');
  });
  test('Omezit pohyb: tečky a padající hvězda zmizí, vynucené barvy a tisk ozdoby skryjí', () => {
    assert.match(css, /html\[data-reduce-motion="1"\] \.lv-dot/);
    assert.match(css, /@media \(forced-colors: active\), print \{[^}]*display: none/);
  });
  test('postranní ozdoby jen tam, kde je vedle obsahu místo (od 1280 px), a pruh má šířku podle obsahu max-w-6xl', () => {
    assert.match(css, /@media \(min-width: 1280px\) \{ \.lv-sides \{ display: block; \} \}/);
    assert.match(css, /width: calc\(\(100% - 72rem\) \/ 2\)/);
    assert.equal(read('src', 'pages', 'HomePage.jsx').includes('max-w-6xl'), true, 'obsah stránek je opravdu max-w-6xl (72rem)');
  });
  test('rozsvícení stránky mění jen průhlednost (transform by přesunul prvky s position: fixed)', () => {
    const line = css.split('\n').find((l) => l.startsWith('@keyframes lvFadeIn'));
    assert.ok(line, 'klíčové snímky existují');
    assert.match(line, /opacity/);
    assert.ok(!/transform|translate|scale/.test(line));
    assert.match(css, /html\[data-lively="1"\] main > \* \{ animation: lvFadeIn/, 'a opravdu se používají na obsahu stránky');
  });
  test('každé pravidlo pro prvky stránky je za data-lively="1" (vypnutý režim nic nemění)', () => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => /^html\b/.test(l.trim()) && !/^html\[data-reduce-motion/.test(l.trim()));
    assert.ok(rules.length > 5);
    for (const l of rules) assert.match(l, /^html\[data-lively="1"\]/, l.slice(0, 80));
  });
});

// ---- jiskřičky ----
const fakeEl = (hasAnimate = true) => {
  const el = { style: {}, attrs: {}, removed: false, animations: [], setAttribute(k, v) { this.attrs[k] = v; }, remove() { this.removed = true; } };
  if (hasAnimate) el.animate = (frames, opts) => { let done; const finished = new Promise((r) => { done = r; }); el.animations.push({ frames, opts, finish: done }); return { finished }; };
  return el;
};
const fakeDoc = ({ lively = '1', reduce = '0', hasAnimate = true } = {}) => {
  const listeners = {}; const created = [];
  return {
    created, listeners,
    documentElement: { dataset: { lively, reduceMotion: reduce } },
    body: { children: [], appendChild(e) { this.children.push(e); } },
    createElement: () => { const e = fakeEl(hasAnimate); created.push(e); return e; },
    addEventListener(t, fn, o) { listeners[t] = { fn, o }; },
    removeEventListener(t) { delete listeners[t]; },
  };
};
const target = (props = {}) => ({ closest: () => ({ disabled: false, getAttribute: () => null, ...props }) });
const flush = () => new Promise((r) => setImmediate(r));

describe('jiskřičky po kliknutí', () => {
  test('směry: správný počet, opakovatelné, v rozumném dosahu a opravdu do všech stran', () => {
    const a = sparkleSpecs(SPARKLE_COUNT, 5); const b = sparkleSpecs(SPARKLE_COUNT, 5);
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, sparkleSpecs(SPARKLE_COUNT, 6), 'jiné semínko = jiný výbuch');
    assert.equal(a.length, SPARKLE_COUNT);
    for (const s of a) {
      assert.ok(Math.hypot(s.dx, s.dy) >= 15 && Math.hypot(s.dx, s.dy) <= 50, 'dosah');
      assert.ok(s.size >= 4 && s.size <= 8 && s.ms >= 480 && s.ms <= 700);
    }
    assert.ok(a.some((s) => s.dx > 0) && a.some((s) => s.dx < 0) && a.some((s) => s.dy > 0) && a.some((s) => s.dy < 0));
    for (let seed = 1; seed < 60; seed++) for (const s of sparkleSpecs(SPARKLE_COUNT, seed * 7919 + 13)) assert.ok(Number.isFinite(s.dx) && Number.isFinite(s.dy));
  });
  test('cílem je tlačítko/odkaz/přepínač, ne vypnutý prvek ani holý text', () => {
    assert.ok(sparkleTarget(target()));
    assert.equal(sparkleTarget(target({ disabled: true })), null);
    assert.equal(sparkleTarget(target({ getAttribute: (k) => (k === 'aria-disabled' ? 'true' : null) })), null);
    assert.equal(sparkleTarget({ closest: () => null }), null);
    assert.equal(sparkleTarget(null), null);
    assert.equal(sparkleTarget({}), null);
  });
  test('výbuch vytvoří jiskřičky, nastaví je na pozici kliknutí a po dohrání je uklidí', async () => {
    const doc = fakeDoc(); const live = { n: 0 };
    assert.equal(burstAt(100, 200, { doc, seed: 3, live }), SPARKLE_COUNT);
    assert.equal(live.n, SPARKLE_COUNT);
    assert.equal(doc.body.children.length, SPARKLE_COUNT);
    for (const el of doc.created) {
      assert.equal(el.style.left, '100px'); assert.equal(el.style.top, '200px');
      assert.equal(el.style.pointerEvents, 'none');
      assert.equal(el.attrs['aria-hidden'], 'true');
      assert.equal(el.animations.length, 1);
      assert.equal(el.animations[0].frames[1].opacity, 0, 'jiskra na konci zmizí');
    }
    doc.created.forEach((el) => el.animations[0].finish());
    await flush();
    assert.ok(doc.created.every((el) => el.removed), 'všechny jiskřičky se uklidí');
    assert.equal(live.n, 0);
  });
  test('strop současných jiskřiček: rychlé klikání stránku nezahltí', () => {
    const doc = fakeDoc(); const live = { n: 0 };
    for (let i = 0; i < 20; i++) burstAt(10, 10, { doc, seed: i + 1, live });
    assert.ok(live.n <= MAX_LIVE_SPARKLES);
    assert.equal(doc.created.length, MAX_LIVE_SPARKLES);
  });
  test('prohlížeč bez Web Animations API a nesmyslné souřadnice: nic se nevykreslí a nic nespadne', () => {
    const doc = fakeDoc({ hasAnimate: false });
    assert.equal(burstAt(1, 1, { doc }), 0);
    assert.equal(doc.body.children.length, 0, 'bez animace se nic nepřidá do stránky');
    const ok = fakeDoc();
    assert.equal(burstAt(NaN, 5, { doc: ok }), 0);
    assert.equal(burstAt(5, undefined, { doc: ok }), 0);
    assert.equal(burstAt(5, 5, { doc: null }), 0);
  });
  test('posluchač: kliknutí na tlačítko spustí výbuch, vypnutí posluchače ho odebere', () => {
    const doc = fakeDoc();
    const off = installClickSparkles({ doc, getScope: () => ({ sparkles: true }) });
    assert.ok(doc.listeners.pointerdown, 'poslouchá pointerdown');
    assert.equal(doc.listeners.pointerdown.o.passive, true, 'nezdržuje posouvání na dotykových zařízeních');
    doc.listeners.pointerdown.fn({ button: 0, clientX: 50, clientY: 60, target: target() });
    assert.equal(doc.created.length, SPARKLE_COUNT);
    off();
    assert.equal(doc.listeners.pointerdown, undefined);
  });
  test('posluchač: nic se nestane při vypnutém režimu, omezeném pohybu, klidné stránce, pravém tlačítku ani u textu', () => {
    const click = (doc, e = {}, scope = { sparkles: true }) => {
      installClickSparkles({ doc, getScope: () => scope });
      doc.listeners.pointerdown.fn({ button: 0, clientX: 1, clientY: 1, target: target(), ...e });
      return doc.created.length;
    };
    assert.equal(click(fakeDoc({ lively: '0' })), 0, 'režim vypnutý');
    assert.equal(click(fakeDoc({ reduce: '1' })), 0, 'omezený pohyb');
    assert.equal(click(fakeDoc(), {}, { sparkles: false }), 0, 'čtečka a hry');
    assert.equal(click(fakeDoc(), { button: 2 }), 0, 'pravé tlačítko');
    assert.equal(click(fakeDoc(), { target: { closest: () => null } }), 0, 'klik mimo ovladací prvek');
    assert.equal(click(fakeDoc(), { target: target({ disabled: true }) }), 0, 'vypnuté tlačítko');
    assert.equal(click(fakeDoc()), SPARKLE_COUNT, 'kontrola: za normálních podmínek funguje');
  });
  test('každé kliknutí má jiné semínko (výbuchy nejsou stejné razítko)', () => {
    const doc = fakeDoc();
    installClickSparkles({ doc });
    doc.listeners.pointerdown.fn({ button: 0, clientX: 1, clientY: 1, target: target() });
    doc.listeners.pointerdown.fn({ button: 0, clientX: 1, clientY: 1, target: target() });
    const first = doc.created.slice(0, SPARKLE_COUNT).map((e) => JSON.stringify(e.animations[0].frames[1]));
    const second = doc.created.slice(SPARKLE_COUNT).map((e) => JSON.stringify(e.animations[0].frames[1]));
    assert.notDeepEqual(first, second);
  });
  test('bez dokumentu (mimo prohlížeč) se nic nezapne', () => {
    assert.equal(typeof installClickSparkles({ doc: null }), 'function');
  });
});
