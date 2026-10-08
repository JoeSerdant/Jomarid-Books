// Testy motivů a vlastních barev: node --test src/tests/theme.test.mjs   (nebo: npm run test:theme)
//
// Hlídají hlavně to, co se dřív rozbilo nebo co se snadno rozbije znovu:
//  - psaní hex kódu znak po znaku (zkratka #abc se nesmí rozbalit uprostřed psaní),
//  - čitelnost: text na pozadí i na zvýraznění má vždy kontrast aspoň 4,5:1 (u libovolné dvojice barev),
//  - první přepnutí na „Vlastní“ vychází z barev, které uživatel právě vidí (a náhled dlaždice to ukazuje),
//  - skript v index.html, který nastavuje barvu pozadí před prvním vykreslením, se nenechá zmást poškozeným úložištěm.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as T from '../theme.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EPS = 1e-9;

// Jednoduché úložiště místo localStorage (Node ho nemá) - ukládá do Map, volitelně hází chyby (soukromý režim).
const makeStorage = (init = {}, broken = false) => {
  const m = new Map(Object.entries(init));
  const guard = () => { if (broken) throw new Error('úložiště není dostupné'); };
  return {
    getItem: (k) => { guard(); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { guard(); m.set(k, String(v)); },
    removeItem: (k) => { guard(); m.delete(k); },
  };
};
const setStorage = (storage) => Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
beforeEach(() => setStorage(makeStorage()));

// Opakovatelná „náhoda“, ať je případný pád vždycky stejný.
const rng = (seed) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const randomHex = (rnd) => '#' + [0, 1, 2].map(() => Math.floor(rnd() * 256).toString(16).padStart(2, '0')).join('');
const randomPairs = (n, seed = 12345) => { const r = rng(seed); return Array.from({ length: n }, () => [randomHex(r), randomHex(r)]); };

describe('zápis hex kódu', () => {
  test('normalizeHex: zkratka, velká písmena, mezery, bez #', () => {
    assert.equal(T.normalizeHex('#ABC'), '#aabbcc');
    assert.equal(T.normalizeHex('abc'), '#aabbcc');
    assert.equal(T.normalizeHex('  #1E2F3A '), '#1e2f3a');
  });
  test('normalizeHex: neplatné vstupy vrací null', () => {
    for (const v of ['', '#', '#12', '#12345', '#1234567', '#ggg', 'zzzzzz', null, undefined, 123, {}]) assert.equal(T.normalizeHex(v), null, String(v));
  });
  test('completeHex bere jen úplný 6místný kód', () => {
    assert.equal(T.completeHex('#1e2f3a'), '#1e2f3a');
    assert.equal(T.completeHex('1E2F3A'), '#1e2f3a');
    assert.equal(T.completeHex(' #abcdef '), '#abcdef');
    for (const v of ['#1e2', '1e2', '#1e2f3', '#abcdefa', 'zzzzzz', '', null, 5]) assert.equal(T.completeHex(v), null, String(v));
  });
  test('psaní znak po znaku: až poslední znak kód potvrdí (dřív #1e2 skočilo na #11ee22 a zbytek se zahodil)', () => {
    const r = rng(7);
    for (let i = 0; i < 200; i++) {
      const code = randomHex(r);
      for (const typed of [code, code.slice(1)]) {
        for (let len = 1; len < typed.length; len++) assert.equal(T.completeHex(typed.slice(0, len)), null, `${typed.slice(0, len)} z ${typed}`);
        assert.equal(T.completeHex(typed), code, typed);
      }
    }
  });
});

describe('odvozený motiv', () => {
  const KEYS = Object.keys(T.THEMES.saas).sort();
  const check = (name, v) => {
    assert.deepEqual(Object.keys(v).sort(), KEYS, name + ': sada proměnných');
    const atLeast = (fg, bg, min) => assert.ok(T.contrast(v[fg], v[bg]) >= min - EPS, `${name}: ${fg} na ${bg} má jen ${T.contrast(v[fg], v[bg]).toFixed(2)}:1`);
    atLeast('--text-body', '--bg-body', 4.5);
    atLeast('--text-muted', '--bg-body', 4.5);
    atLeast('--text-secondary', '--bg-secondary', 4.5);
    atLeast('--text-badge', '--bg-badge', 4.5);
    atLeast('--text-primary', '--bg-primary', 4.5);
    // Text na zvýraznění nikdy nesmí být horší než bílý (ten byl dřív natvrdo a na světlých zvýrazněních nebyl čitelný).
    assert.ok(T.contrast(v['--text-primary'], v['--bg-primary']) >= T.contrast('#ffffff', v['--bg-primary']) - EPS, name + ': text-primary horší než bílá');
  };

  test('hotové kombinace (Půlnoc, Oceán, Grafit ...) jsou čitelné', () => {
    assert.ok(T.CUSTOM_PRESETS.length >= 6);
    for (const p of T.CUSTOM_PRESETS) check(p.label, T.deriveTheme(p.bg, p.accent));
  });
  test('vestavěné motivy mají text-primary čitelný na zvýraznění', () => {
    for (const [k, v] of Object.entries(T.THEMES)) assert.ok(T.contrast(v['--text-primary'], v['--bg-primary']) >= 4.5, k);
  });
  test('libovolná dvojice barev (5000 náhodných + krajní případy) dá čitelný motiv', () => {
    const edges = ['#000000', '#ffffff', '#767676', '#777777', '#7f7f7f', '#808080'];
    const pairs = randomPairs(5000);
    for (const a of edges) for (const b of edges) pairs.push([a, b]);
    for (const [bg, accent] of pairs) check(`${bg}/${accent}`, T.deriveTheme(bg, accent));
  });
  test('neplatné barvy spadnou na výchozí', () => {
    assert.deepEqual(T.deriveTheme('x', null), T.deriveTheme(T.CUSTOM_DEFAULT.bg, T.CUSTOM_DEFAULT.accent));
  });
  test('zkratka a velká písmena dají stejný motiv jako úplný kód', () => {
    assert.deepEqual(T.deriveTheme('#ABC', '#F80'), T.deriveTheme('#aabbcc', '#ff8800'));
  });
});

describe('zvýraznění viditelné na pozadí', () => {
  test('readableAccent vždy dosáhne minimálního kontrastu', () => {
    const edges = [['#000000', '#000000'], ['#ffffff', '#ffffff'], ['#777777', '#777777'], ['#18181b', '#1a1a1d']];
    for (const [bg, accent] of [...randomPairs(3000, 99), ...edges]) {
      const fixed = T.readableAccent(accent, bg);
      assert.ok(T.contrast(fixed, bg) >= T.ACCENT_MIN_CONTRAST - EPS, `${accent} na ${bg} → ${fixed}`);
      assert.match(fixed, /^#[0-9a-f]{6}$/);
    }
  });
  test('už dost viditelné zvýraznění nechá beze změny', () => {
    for (const p of T.CUSTOM_PRESETS) assert.equal(T.readableAccent(p.accent, p.bg), T.normalizeHex(p.accent), p.label);
  });
  test('skoro stejná barva jako pozadí se posune (ne na úplně jinou)', () => {
    const fixed = T.readableAccent('#1e2a3b', '#1e293b');
    assert.notEqual(fixed, '#1e2a3b');
    assert.ok(T.luminance(fixed) > T.luminance('#1e293b'), 'na tmavém pozadí se zesvětlí');
    const light = T.readableAccent('#f5f0e0', '#f5efe0');
    assert.ok(T.luminance(light) < T.luminance('#f5efe0'), 'na světlém pozadí ztmavne');
  });
});

describe('uložení vlastních barev', () => {
  test('nic uloženo → výchozí a hasSavedCustomColors je false', () => {
    assert.equal(T.hasSavedCustomColors(), false);
    assert.deepEqual(T.loadCustomColors(), T.CUSTOM_DEFAULT);
  });
  test('uložení a načtení; uložená kopie pro index.html má tvar [pozadí, text, režim]', () => {
    T.saveCustomColors({ bg: '#F5EFE0', accent: '#B45309' });
    assert.equal(T.hasSavedCustomColors(), true);
    assert.deepEqual(T.loadCustomColors(), { bg: '#f5efe0', accent: '#b45309' });
    const vars = JSON.parse(localStorage.getItem(T.CUSTOM_VARS_STORAGE));
    assert.equal(vars.length, 3);
    assert.match(vars[0], /^#[0-9a-f]{6}$/);
    assert.match(vars[1], /^#[0-9a-f]{6}$/);
    assert.equal(vars[2], 'light');
    T.saveCustomColors({ bg: '#0b1020', accent: '#60a5fa' });
    assert.equal(JSON.parse(localStorage.getItem(T.CUSTOM_VARS_STORAGE))[2], 'dark');
  });
  test('poškozené úložiště nikdy nespadne, použije se výchozí', () => {
    for (const bad of ['{', 'null', '5', '"abc"', '[]', '{"bg":5,"accent":{}}']) {
      setStorage(makeStorage({ [T.CUSTOM_THEME_STORAGE]: bad }));
      assert.deepEqual(T.loadCustomColors(), T.CUSTOM_DEFAULT, bad);
    }
    setStorage(makeStorage({ [T.CUSTOM_THEME_STORAGE]: '{"bg":"#102030"}' }));
    assert.deepEqual(T.loadCustomColors(), { bg: '#102030', accent: T.CUSTOM_DEFAULT.accent }, 'platná polovina se zachová');
  });
  test('nedostupné úložiště (soukromý režim) nic neshodí', () => {
    setStorage(makeStorage({}, true));
    assert.equal(T.hasSavedCustomColors(), false);
    assert.deepEqual(T.loadCustomColors(), T.CUSTOM_DEFAULT);
    assert.doesNotThrow(() => T.saveCustomColors({ bg: '#102030', accent: '#abcdef' }));
  });
});

describe('první přepnutí na „Vlastní“', () => {
  test('vychází z barev právě používaného motivu', () => {
    for (const key of ['saas', 'dark', 'emerald']) {
      const seed = T.colorsFromTheme(key);
      assert.equal(seed.bg, T.THEMES[key]['--bg-body'], key);
      assert.ok(T.contrast(seed.accent, seed.bg) >= T.ACCENT_MIN_CONTRAST - EPS, key + ': zvýraznění na pozadí vidět');
    }
  });
  test('zvýraznění, které už je vidět, se nemění; příliš splývavé (Dřevo a zeleň) se jen mírně dorovná', () => {
    assert.equal(T.colorsFromTheme('saas').accent, T.THEMES.saas['--bg-primary']);
    assert.equal(T.colorsFromTheme('dark').accent, T.THEMES.dark['--bg-primary']);
    assert.notEqual(T.colorsFromTheme('emerald').accent, T.THEMES.emerald['--bg-primary']);
  });
  test('neznámý klíč spadne na světlý motiv', () => {
    assert.deepEqual(T.colorsFromTheme('neexistuje'), T.colorsFromTheme('saas'));
  });
  test('seedCustomColors: poprvé uloží barvy právě používaného motivu a „Vlastní“ je pak zobrazí', () => {
    const got = T.seedCustomColors('dark');
    assert.equal(got.bg, T.THEMES.dark['--bg-body']);
    assert.equal(got.accent, T.THEMES.dark['--bg-primary']);
    assert.equal(T.hasSavedCustomColors(), true);
    assert.equal(T.resolveTheme(T.CUSTOM_THEME_KEY)['--bg-body'], T.THEMES.dark['--bg-body']);
    assert.equal(T.resolveTheme(T.CUSTOM_THEME_KEY)['--bg-primary'], T.THEMES.dark['--bg-primary']);
  });
  test('seedCustomColors: už uložené (i upravené) vlastní barvy nikdy nepřepíše', () => {
    T.saveCustomColors({ bg: '#fff1f2', accent: '#e11d48' });
    assert.deepEqual(T.seedCustomColors('saas'), { bg: '#fff1f2', accent: '#e11d48' });
    assert.deepEqual(T.seedCustomColors('emerald'), { bg: '#fff1f2', accent: '#e11d48' });
    assert.deepEqual(T.loadCustomColors(), { bg: '#fff1f2', accent: '#e11d48' });
  });
  test('seedCustomColors: poškozená uložená hodnota se nebere jako uložená (použije se seed)', () => {
    for (const bad of ['null', '', '{}', '{', '"abc"', '{"bg":"zzz","accent":5}', '{"bg":"#102030"}']) {
      setStorage(makeStorage({ [T.CUSTOM_THEME_STORAGE]: bad }));
      assert.equal(T.hasSavedCustomColors(), false, bad);
      assert.equal(T.seedCustomColors('dark').bg, T.THEMES.dark['--bg-body'], bad);
    }
  });
  test('customColorsPreview: náhled dlaždice „Vlastní“ odpovídá výsledku kliknutí', () => {
    const saved = T.loadCustomColors(); // nic uloženo → výchozí
    for (const key of ['saas', 'dark', 'emerald']) {
      const preview = T.customColorsPreview(key, saved);
      assert.deepEqual(preview, T.colorsFromTheme(key), key + ': náhled = seed');
      assert.deepEqual(T.seedCustomColors(key), preview, key + ': kliknutí dá totéž co náhled');
      setStorage(makeStorage()); // další motiv zkoušíme znovu od prázdného úložiště
    }
  });
  test('customColorsPreview: uložené barvy a aktivní „Vlastní“ se nepřepisují seedem', () => {
    T.saveCustomColors({ bg: '#fff1f2', accent: '#e11d48' });
    const saved = T.loadCustomColors();
    assert.deepEqual(T.customColorsPreview('dark', saved), saved);
    setStorage(makeStorage());
    assert.deepEqual(T.customColorsPreview(T.CUSTOM_THEME_KEY, T.CUSTOM_DEFAULT), T.CUSTOM_DEFAULT, 'právě aktivní „Vlastní“ ukazuje svoje barvy');
  });
});

describe('index.html: motiv před prvním vykreslením', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];

  // Spustí skript s úložištěm a zachytí, co nastavil na <html> a v meta theme-color.
  const run = (store) => {
    const props = {}; const meta = {}; const attrs = {}; const style = { setProperty: (k, v) => { props[k] = v; } };
    const ctx = vm.createContext({
      localStorage: makeStorage(store),
      document: { documentElement: { style, setAttribute: (k, v) => { attrs[k] = v; } }, querySelector: () => ({ setAttribute: (k, v) => { meta[k] = v; } }) },
    });
    vm.runInContext(script, ctx);
    return { props, meta, attrs, scheme: style.colorScheme };
  };
  const SAAS = '#f8fafc';

  test('skript v index.html existuje', () => assert.ok(script && script.includes('jomarid-books-theme-vars')));
  test('vestavěné motivy a výchozí světlý', () => {
    assert.equal(run({}).props['--bg-body'], SAAS);
    assert.equal(run({ 'jomarid-books-theme': 'dark' }).props['--bg-body'], '#020617');
    const emerald = run({ 'jomarid-books-theme': 'emerald' });
    assert.equal(emerald.props['--bg-body'], '#2d1a10');
    assert.equal(emerald.scheme, 'dark');
    assert.equal(emerald.meta.content, '#2d1a10');
  });
  test('hodnoty z index.html odpovídají motivům v theme.js', () => {
    for (const k of ['saas', 'dark', 'emerald']) {
      const r = run({ 'jomarid-books-theme': k });
      assert.equal(r.props['--bg-body'], T.THEMES[k]['--bg-body'], k);
      assert.equal(r.props['--text-body'], T.THEMES[k]['--text-body'], k);
      assert.equal(r.scheme, T.isDarkTheme(k) ? 'dark' : 'light', k);
    }
  });
  test('vlastní motiv uložený přes saveCustomColors se přijme', () => {
    for (const [bg, accent, mode] of [['#0b1020', '#60a5fa', 'dark'], ['#fff1f2', '#e11d48', 'light']]) {
      setStorage(makeStorage());
      T.saveCustomColors({ bg, accent });
      const stored = { 'jomarid-books-theme': 'custom', 'jomarid-books-theme-vars': localStorage.getItem(T.CUSTOM_VARS_STORAGE) };
      const r = run(stored);
      assert.equal(r.props['--bg-body'], bg);
      assert.equal(r.props['--text-body'], T.deriveTheme(bg, accent)['--text-body']);
      assert.equal(r.scheme, mode);
    }
  });
  test('„Experimentální vlastní“ bere vlastní barvy a zapne kreslený styl už před vykreslením', () => {
    T.saveCustomColors({ bg: '#fff1e6', accent: '#e11d48' });
    const r = run({ 'jomarid-books-theme': 'experimental', 'jomarid-books-theme-vars': localStorage.getItem(T.CUSTOM_VARS_STORAGE) });
    assert.equal(r.props['--bg-body'], '#fff1e6');
    assert.equal(r.attrs['data-style'], 'sketchy');
    assert.equal(r.scheme, 'light');
    // ostatní motivy styl nezapínají
    for (const key of ['saas', 'dark', 'custom', 'neexistuje']) assert.equal(run({ 'jomarid-books-theme': key }).attrs['data-style'], undefined, key);
  });
  test('poškozené nebo cizí hodnoty se zahodí a vezme se světlý motiv (nic nespadne)', () => {
    const bad = ['{', 'null', '5', '"abc"', '[]', '{}', '{"0":"#fff","1":"#000","2":"dark"}', '["#zzzzzz","#000000","dark"]', '["#000000","#ffffff","blue"]',
      '[["#000000"],"#ffffff","dark"]', '["#000000","#ffffff","dark","x"]', '["red","blue","dark"]', '["#00000","#ffffff","dark"]',
      '["#000000","red","dark"]', '["#000000","#12345","dark"]', '["#000000",5,"dark"]', '["#000000",null,"dark"]', '["#000000",["#ffffff"],"dark"]'];
    for (const vars of bad) {
      const r = run({ 'jomarid-books-theme': 'custom', 'jomarid-books-theme-vars': vars });
      assert.equal(r.props['--bg-body'], SAAS, vars);
      assert.equal(r.scheme, 'light', vars);
    }
  });
  test('divný klíč motivu (constructor, __proto__) nic nerozbije', () => {
    for (const key of ['constructor', '__proto__', 'toString', 'neexistuje', '']) assert.equal(run({ 'jomarid-books-theme': key }).props['--bg-body'], SAAS, key);
  });
  test('nedostupné úložiště skript neshodí', () => {
    const ctx = vm.createContext({ localStorage: makeStorage({}, true), document: { documentElement: { style: { setProperty() {} } }, querySelector: () => ({ setAttribute() {} }) } });
    assert.doesNotThrow(() => vm.runInContext(script, ctx));
  });
});

describe('„Experimentální vlastní“ motiv', () => {
  test('klíč, název a sdílené barvy s motivem „Vlastní“', () => {
    assert.equal(T.EXPERIMENTAL_THEME_KEY, 'experimental');
    assert.equal(T.THEME_LABELS.experimental, 'Experimentální vlastní');
    assert.ok(T.usesCustomColors('custom') && T.usesCustomColors('experimental'));
    for (const k of ['saas', 'dark', 'emerald', 'sepia', 'ocean', 'contrast', 'neexistuje', undefined, null]) assert.ok(!T.usesCustomColors(k), String(k));
    T.saveCustomColors({ bg: '#1a1033', accent: '#a855f7' });
    assert.deepEqual(T.resolveTheme('experimental'), T.resolveTheme('custom'));
    assert.equal(T.resolveTheme('experimental')['--bg-primary'], '#a855f7');
  });
  test('tmavé a světlé pozadí se pozná i u experimentálního motivu', () => {
    T.saveCustomColors({ bg: '#1a1033', accent: '#a855f7' });
    assert.ok(T.isDarkTheme('experimental', T.resolveTheme('experimental')));
    T.saveCustomColors({ bg: '#fff1e6', accent: '#e11d48' });
    assert.ok(!T.isDarkTheme('experimental', T.resolveTheme('experimental')));
  });
  test('čitelnost zůstává zaručená: text na pozadí i zvýraznění má kontrast aspoň 4,5', () => {
    for (const [bg, accent] of [['#fff1e6', '#e11d48'], ['#1a1033', '#a855f7'], ['#808080', '#808080'], ['#ffff00', '#00ffff']]) {
      T.saveCustomColors({ bg, accent });
      const v = T.resolveTheme('experimental');
      assert.ok(T.contrast(v['--text-body'], v['--bg-body']) >= 4.5, `${bg} text/pozadí`);
      assert.ok(T.contrast(v['--text-primary'], v['--bg-primary']) >= 4.5, `${accent} text/zvýraznění`);
    }
  });
  test('styl se zapíná a vypíná atributem na <html>', () => {
    const attrs = {};
    const root = { setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } };
    T.applyThemeStyle('experimental', root);
    assert.equal(attrs['data-style'], 'sketchy');
    T.applyThemeStyle('custom', root);
    assert.equal(attrs['data-style'], undefined);
    assert.equal(T.themeStyle('saas'), null);
  });
  test('náhled dlaždice: experimentální motiv se chová jako „Vlastní“ (první barvy podle právě používaného motivu)', () => {
    const fromDark = T.colorsFromTheme('dark');
    assert.deepEqual(T.customColorsPreview('dark', T.loadCustomColors()), fromDark);
    T.saveCustomColors({ bg: '#fff1e6', accent: '#e11d48' });
    assert.deepEqual(T.customColorsPreview('experimental', T.loadCustomColors()), T.loadCustomColors());
  });
  test('písmo knihy se kresleným stylem nemění: třída reader-font je u textu čtečky vždy', () => {
    for (const fam of Object.keys(T.FONT_FAMILIES)) assert.ok(T.readerTypography({ ...T.READER_DEFAULTS, fontFamily: fam }).className.split(' ').includes('reader-font'), fam);
  });
  test('pravidla v sketchy.css: písmo nepřebíjí text čtečky a karty se netransformují', () => {
    const css = fs.readFileSync(path.join(ROOT, 'src', 'sketchy.css'), 'utf8');
    assert.match(css, /\.font-sans:not\(\.reader-font\)/);
    assert.ok(!/(^|[;{\s])transform\s*:/m.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'transform vytvoří blok pro position: fixed (celá obrazovka editoru)');
    assert.match(css, /size-adjust/);
  });
});
