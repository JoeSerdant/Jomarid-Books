// Testy nastavení: node --test src/tests/settings.test.mjs   (nebo: npm run test:settings)
//
// Hotové motivy a akcenty (čitelnost), velikost a hustota rozhraní, výchozí chování knihovny a synchronizace nastavení s
// účtem (co se synchronizuje, kdo vyhrává, chybějící tabulka, výpadek). Vykreslení se ověřuje zvlášť v prohlížeči.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as T from '../theme.js';
import * as S from '../settings/settingsSync.js';
import * as store from '../browse/browseStore.js';
import { APP_VERSION, APP_VERSION_LABEL } from '../appInfo.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const makeStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
};
const setStorage = (s) => Object.defineProperty(globalThis, 'localStorage', { value: s, configurable: true, writable: true });
beforeEach(() => setStorage(makeStorage()));

describe('hotové motivy', () => {
  const KEYS = Object.keys(T.THEMES.saas).sort();
  test('každý motiv má stejných dvanáct proměnných a nabídku v Nastavení', () => {
    for (const [k, v] of Object.entries(T.THEMES)) {
      assert.deepEqual(Object.keys(v).sort(), KEYS, k);
      assert.ok(T.THEME_LABELS[k], `popisek ${k}`);
    }
    assert.deepEqual(Object.keys(T.THEMES).sort(), ['contrast', 'dark', 'emerald', 'ocean', 'saas', 'sepia']);
  });
  test('text a okraje jsou čitelné na všech plochách (pozadí, karta, sekundární)', () => {
    for (const [k, v] of Object.entries(T.THEMES)) {
      for (const surface of ['--bg-body', '--bg-card', '--bg-secondary']) {
        assert.ok(T.contrast(v['--text-body'], v[surface]) >= 7, `${k}: text na ${surface}`);
        assert.ok(T.contrast(v['--text-muted'], v[surface]) >= 4.5, `${k}: tlumený text na ${surface}`);
      }
      assert.ok(T.contrast(v['--text-primary'], v['--bg-primary']) >= 4.5, `${k}: text na zvýraznění`);
      assert.ok(T.contrast(v['--text-badge'], v['--bg-badge']) >= 4.5, `${k}: štítek`);
    }
  });
  test('vysoký kontrast: bílý text a okraje na černé, žlutý akcent', () => {
    const c = T.THEMES.contrast;
    assert.equal(c['--bg-body'], '#000000');
    assert.equal(c['--text-body'], '#ffffff');
    assert.equal(c['--border-color'], '#ffffff');
    assert.ok(T.contrast(c['--bg-primary'], c['--bg-body']) >= 10);
  });
  test('tmavé motivy jsou označené tmavě (barevné schéma prohlížeče)', () => {
    for (const k of Object.keys(T.THEMES)) assert.equal(T.isDarkTheme(k, T.THEMES[k]), T.isDarkColor(T.THEMES[k]['--bg-body']), k);
  });
  // nejlepší dosažitelný kontrast na ploše, když se jde směrem, kterým jde text na pozadí stránky
  const reachable = (bg, surface) => Math.min(4.5, T.contrast(T.isDarkColor(bg) ? '#ffffff' : '#000000', surface));
  test('odvozený (vlastní) motiv má tlumený text čitelný i na kartách a sekundárních plochách', () => {
    let seed = 5; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const hex = () => '#' + Array.from({ length: 3 }, () => Math.floor(rnd() * 256).toString(16).padStart(2, '0')).join('');
    for (let i = 0; i < 1500; i += 1) {
      const t = T.deriveTheme(hex(), hex());
      // u středně světlých barev nejde 4,5 : 1 dosáhnout ani černou či bílou: tam stačí nejlepší dosažitelný kontrast
      for (const surface of ['--bg-body', '--bg-card', '--bg-secondary']) assert.ok(T.contrast(t['--text-muted'], t[surface]) >= reachable(t['--bg-body'], t[surface]) - 0.06, `${JSON.stringify(t)} ${surface}`);
    }
    for (const c of [T.CUSTOM_DEFAULT, ...T.CUSTOM_PRESETS]) {
      const t = T.deriveTheme(c.bg, c.accent);
      assert.ok(T.contrast(t['--text-muted'], t['--bg-secondary']) >= 4.5, c.label || 'výchozí');
    }
  });
});

describe('poškozený klíč motivu', () => {
  test('zděděné názvy (constructor, __proto__, toString) a nesmysly dají výchozí světlý motiv', () => {
    for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty', '', null, undefined, 5, {}]) {
      assert.equal(T.resolveTheme(key), T.THEMES.saas, String(key));
      assert.doesNotThrow(() => T.withAccent(T.resolveTheme(key), 'rose'), String(key));
    }
    for (const key of Object.keys(T.THEMES)) assert.equal(T.resolveTheme(key), T.THEMES[key]);
  });
});

describe('akcentní barva', () => {
  test('akcent „podle motivu“ nic nemění; neznámý také ne', () => {
    for (const k of Object.keys(T.THEMES)) {
      assert.equal(T.withAccent(T.THEMES[k], 'default'), T.THEMES[k]);
      assert.equal(T.withAccent(T.THEMES[k], 'nesmysl'), T.THEMES[k]);
    }
  });
  test('každý akcent v každém motivu: zvýraznění je vidět a text na něm i štítky jsou čitelné', () => {
    for (const [tk, theme] of Object.entries(T.THEMES)) {
      for (const ak of Object.keys(T.ACCENTS)) {
        const v = T.withAccent(theme, ak);
        if (ak !== 'default') assert.ok(T.contrast(v['--bg-primary'], v['--bg-body']) >= T.ACCENT_MIN_CONTRAST - 1e-9, `${tk}/${ak}: zvýraznění na pozadí`); // vestavěné zvýraznění Dřeva a zeleně je už dnes splývavé
        assert.ok(T.contrast(v['--text-primary'], v['--bg-primary']) >= 4.5, `${tk}/${ak}: text na zvýraznění`);
        assert.ok(T.contrast(v['--text-badge'], v['--bg-badge']) >= 4.5, `${tk}/${ak}: štítek`);
        for (const k of Object.keys(theme)) if (!['--bg-primary', '--text-primary', '--bg-badge', '--text-badge'].includes(k)) assert.equal(v[k], theme[k], `${tk}/${ak}: ${k} se nemění`);
      }
    }
  });
  test('uložení a načtení; nesmysl a nedostupné úložiště = výchozí', () => {
    assert.equal(T.loadAccent(), 'default');
    T.saveAccent('rose'); assert.equal(T.loadAccent(), 'rose');
    T.saveAccent('nesmysl'); assert.equal(T.loadAccent(), 'default');
    setStorage({ getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } });
    assert.equal(T.loadAccent(), 'default');
    assert.doesNotThrow(() => T.saveAccent('blue'));
  });
});

describe('velikost a hustota rozhraní', () => {
  const root = () => { const props = {}; return { props, style: { setProperty: (k, v) => { props[k] = v; }, removeProperty: (k) => { delete props[k]; } } }; };
  test('výchozí je standardní velikost a hustota (nic se nenastavuje)', () => {
    assert.equal(T.loadUiScale(), 'm'); assert.equal(T.loadUiDensity(), 'normal');
    const r = root(); T.applyUiPrefs(r);
    assert.deepEqual(r.props, {});
  });
  test('velikost mění základní písmo stránky, hustota proměnnou --d', () => {
    T.saveUiScale('xl'); T.saveUiDensity('compact');
    const r = root(); T.applyUiPrefs(r);
    assert.equal(r.props['font-size'], '125%');
    assert.equal(r.props['--d'], '0.8');
    T.saveUiScale('s'); T.saveUiDensity('comfy');
    const r2 = root(); T.applyUiPrefs(r2);
    assert.equal(r2.props['font-size'], '90%');
    assert.equal(r2.props['--d'], '1.2');
    T.saveUiScale('m'); T.saveUiDensity('normal');
    const r3 = root(); T.applyUiPrefs(r3);
    assert.deepEqual(r3.props, {}, 'návrat na standard nechá styl čistý');
  });
  test('nesmysl v úložišti = standard; hodnoty jsou rozumné (čitelné i použitelné)', () => {
    setStorage(makeStorage({ 'jomarid-ui-scale': 'obrovské', 'jomarid-ui-density': '5' }));
    assert.equal(T.loadUiScale(), 'm'); assert.equal(T.loadUiDensity(), 'normal');
    for (const o of Object.values(T.UI_SCALES)) assert.ok(o.value >= 0.9 && o.value <= 1.25);
    for (const o of Object.values(T.UI_DENSITIES)) assert.ok(o.value >= 0.8 && o.value <= 1.2);
  });
});

describe('index.html před prvním vykreslením', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  const run = (store0) => {
    const props = {}; const style = { setProperty: (k, v) => { props[k] = v; } };
    const ctx = vm.createContext({ localStorage: makeStorage(store0), document: { documentElement: { style }, querySelector: () => ({ setAttribute() {} }) } });
    vm.runInContext(script, ctx);
    return { props, scheme: style.colorScheme };
  };
  test('barvy všech hotových motivů v index.html odpovídají theme.js', () => {
    for (const [k, v] of Object.entries(T.THEMES)) {
      const r = run({ 'jomarid-books-theme': k });
      assert.equal(r.props['--bg-body'], v['--bg-body'], `${k}: pozadí`);
      assert.equal(r.props['--text-body'], v['--text-body'], `${k}: text`);
      assert.equal(r.scheme, T.DARK_THEMES.includes(k) ? 'dark' : 'light', `${k}: schéma`);
    }
  });
  test('velikost a hustota se použijí hned; nesmysl a standard nic nenastaví', () => {
    const r = run({ 'jomarid-ui-scale': 'xl', 'jomarid-ui-density': 'comfy' });
    assert.equal(r.props['font-size'], '125%'); assert.equal(r.props['--d'], '1.2');
    const l = run({ 'jomarid-ui-scale': 'l' }); assert.equal(l.props['font-size'], '112.5%'); assert.equal(l.props['--d'], undefined);
    const none = run({ 'jomarid-ui-scale': 'm', 'jomarid-ui-density': 'normal' });
    assert.equal(none.props['font-size'], undefined); assert.equal(none.props['--d'], undefined);
    const bad = run({ 'jomarid-ui-scale': '__proto__', 'jomarid-ui-density': 'toString' });
    assert.equal(bad.props['font-size'], undefined); assert.equal(bad.props['--d'], undefined);
  });
  test('hodnoty velikosti a hustoty v index.html odpovídají theme.js', () => {
    for (const [k, o] of Object.entries(T.UI_SCALES)) if (k !== 'm') assert.equal(run({ 'jomarid-ui-scale': k }).props['font-size'], `${o.value * 100}%`, k);
    for (const [k, o] of Object.entries(T.UI_DENSITIES)) if (k !== 'normal') assert.equal(run({ 'jomarid-ui-density': k }).props['--d'], String(o.value), k);
  });
});

describe('výchozí chování knihovny', () => {
  test('výchozí hodnoty; nesmysl = výchozí', () => {
    const st = makeStorage();
    assert.deepEqual(store.readLibraryPrefs(st), { view: 'grid', sort: 'smart', status: 'all', remember: true });
    const bad = makeStorage({ [store.VIEW_KEY]: 'tabulka', [store.SORT_PREF_KEY]: 'nesmysl', [store.STATUS_PREF_KEY]: '__proto__', [store.REMEMBER_PREF_KEY]: 'x' });
    assert.deepEqual(store.readLibraryPrefs(bad), { view: 'grid', sort: 'smart', status: 'all', remember: true });
  });
  test('zápis a čtení každé volby; neplatné hodnoty se nezapíšou', () => {
    const st = makeStorage();
    store.writeLibraryPref('view', 'list', st); store.writeLibraryPref('sort', 'alpha', st); store.writeLibraryPref('status', 'reading', st); store.writeLibraryPref('remember', false, st);
    assert.deepEqual(store.readLibraryPrefs(st), { view: 'list', sort: 'alpha', status: 'reading', remember: false });
    store.writeLibraryPref('sort', 'nesmysl', st); store.writeLibraryPref('status', 'nesmysl', st); store.writeLibraryPref('neznama', 1, st);
    assert.deepEqual(store.readLibraryPrefs(st), { view: 'list', sort: 'alpha', status: 'reading', remember: false });
    store.writeLibraryPref('remember', true, st);
    assert.equal(store.readLibraryPrefs(st).remember, true);
  });
  test('nedostupné úložiště nic neshodí', () => {
    const broken = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
    assert.deepEqual(store.readLibraryPrefs(broken), { view: 'grid', sort: 'smart', status: 'all', remember: true });
    assert.doesNotThrow(() => store.writeLibraryPref('sort', 'alpha', broken));
  });
});

describe('synchronizace nastavení: snímek a použití', () => {
  test('sbírají se jen známé klíče s neprázdnou hodnotou', () => {
    const st = makeStorage({ 'jomarid-books-theme': 'dark', reader_font_size: '20', 'cizi-klic': 'x', 'jomarid-accent': '', jomarid_nic: 'x' });
    assert.deepEqual(S.collectSettings(st), { v: 1, items: { 'jomarid-books-theme': 'dark', reader_font_size: '20' } });
    assert.deepEqual(S.collectSettings(makeStorage()), { v: 1, items: {} });
  });
  test('synchronizuje se motiv, akcent, velikost, hustota, pohyb, všechna nastavení čtečky i knihovny', () => {
    for (const k of ['jomarid-books-theme', 'jomarid-books-theme-custom', 'jomarid-accent', 'jomarid-ui-scale', 'jomarid-ui-density', 'jomarid-motion', 'reader_font_size', 'reader_start_focus', 'jomarid.library.view', 'jomarid.library.sort', 'jomarid.library.status', 'jomarid.library.remember']) assert.ok(S.SYNC_KEYS.includes(k), k);
    for (const k of Object.values(T.READER_STORAGE)) assert.ok(S.SYNC_KEYS.includes(k), k);
    assert.ok(!S.SYNC_KEYS.includes('jomarid-books-theme-vars'), 'odvozená kopie pro index.html se nesynchronizuje');
    assert.ok(!S.SYNC_KEYS.some((k) => /state|seen|recent|sync/.test(k)), 'stav knihovny, prohlídka a poslední hledání jsou osobní a zůstávají v zařízení');
    assert.equal(new Set(S.SYNC_KEYS).size, S.SYNC_KEYS.length, 'žádný klíč dvakrát');
  });
  test('data z účtu jsou cizí vstup: neznámé klíče, divné typy, příliš dlouhé hodnoty a novější verze se zahodí', () => {
    assert.equal(S.sanitizeRemote(null), null);
    assert.equal(S.sanitizeRemote([]), null);
    assert.equal(S.sanitizeRemote({ v: 'x', items: {} }), null);
    assert.equal(S.sanitizeRemote({ v: 99, items: { 'jomarid-books-theme': 'dark' } }), null, 'novější verze');
    assert.equal(S.sanitizeRemote({ v: 1, items: [] }), null);
    const clean = S.sanitizeRemote({ v: 1, items: { 'jomarid-books-theme': 'dark', 'cizi': 'x', reader_font_size: 20, 'jomarid-accent': 'x'.repeat(5000), __proto__: { 'jomarid-motion': 'reduce' } } });
    assert.deepEqual(clean, { v: 1, items: { 'jomarid-books-theme': 'dark' } });
  });
  test('použití: zapíše známé klíče, chybějící vrátí na výchozí, cizí nechá být', () => {
    const st = makeStorage({ 'jomarid-books-theme': 'saas', reader_font_size: '24', 'jomarid-motion': 'reduce', cizi: 'x' });
    setStorage(st);
    assert.equal(S.applySettings({ v: 1, items: { 'jomarid-books-theme': 'ocean', 'jomarid-ui-scale': 'l' } }, st), true);
    assert.equal(st.getItem('jomarid-books-theme'), 'ocean');
    assert.equal(st.getItem('jomarid-ui-scale'), 'l');
    assert.equal(st.getItem('reader_font_size'), null, 'v účtu chybí = výchozí');
    assert.equal(st.getItem('jomarid-motion'), null);
    assert.equal(st.getItem('cizi'), 'x');
    assert.equal(S.applySettings({ nesmysl: 1 }, st), false);
    assert.equal(st.getItem('jomarid-books-theme'), 'ocean', 'neplatná data nic nezmění');
  });
  test('vlastní barvy z účtu se zapíšou i s kopií pro index.html; rozbité se zahodí', () => {
    const st = makeStorage(); setStorage(st);
    S.applySettings({ v: 1, items: { 'jomarid-books-theme': 'custom', 'jomarid-books-theme-custom': JSON.stringify({ bg: '#0b1020', accent: '#60a5fa' }) } }, st);
    assert.deepEqual(JSON.parse(st.getItem('jomarid-books-theme-custom')), { bg: '#0b1020', accent: '#60a5fa' });
    assert.deepEqual(JSON.parse(st.getItem('jomarid-books-theme-vars')).slice(0, 1), ['#0b1020']);
    S.applySettings({ v: 1, items: { 'jomarid-books-theme-custom': '{rozbité' } }, st);
    assert.equal(st.getItem('jomarid-books-theme-custom'), null);
    S.applySettings({ v: 1, items: { 'jomarid-books-theme-custom': JSON.stringify({ bg: 'zelená', accent: '#fff' }) } }, st);
    assert.equal(st.getItem('jomarid-books-theme-custom'), null, 'neplatná barva se nezapíše');
  });
  test('kdo vyhrává po přihlášení', () => {
    const local = { items: { 'jomarid-books-theme': 'dark' } };
    const none = { items: {} };
    const remote = { updated_at: 'T2', data: { v: 1, items: { 'jomarid-books-theme': 'ocean' } } };
    const emptyRemote = { updated_at: 'T2', data: { v: 1, items: {} } };
    const d = (o) => S.decideSync({ userId: 'u', ...o });
    assert.equal(d({ meta: null, remote: null, local }), 'push', 'účet nic nemá: první nahrání');
    assert.equal(d({ meta: null, remote: null, local: none }), 'none', 'nic nikde');
    assert.equal(d({ meta: null, remote, local }), 'pull', 'nové zařízení: účet vyhrává (i když má zařízení vlastní nastavení)');
    assert.equal(d({ meta: { userId: 'jiny', serverAt: 'T2', dirty: true }, remote, local }), 'pull', 'záznam jiného uživatele se nebere v úvahu');
    assert.equal(d({ meta: { userId: 'u', serverAt: 'T2', dirty: false }, remote, local }), 'none', 'už použité');
    assert.equal(d({ meta: { userId: 'u', serverAt: 'T1', dirty: false }, remote, local }), 'pull', 'změna z jiného zařízení');
    assert.equal(d({ meta: { userId: 'u', serverAt: 'T1', dirty: true }, remote, local }), 'push', 'neodeslané změny z tohoto zařízení vyhrávají');
    assert.equal(d({ meta: null, remote: emptyRemote, local }), 'push', 'prázdná nebo nepoužitelná data v účtu nepřepíšou nastavení v zařízení');
    assert.equal(d({ meta: null, remote: { updated_at: 'T', data: 'nesmysl' }, local }), 'push');
    assert.equal(d({ meta: { userId: 'u', serverAt: 'T1', dirty: true }, remote, local: none }), 'none');
  });
  test('chybějící tabulka se pozná, výpadek ne', () => {
    for (const e of [{ code: 'PGRST205' }, { code: '42P01' }, { status: 404 }, { message: 'Could not find the table public.user_settings in the schema cache' }, { message: 'relation "public.user_settings" does not exist' }]) assert.equal(S.isMissingTable(e), true, JSON.stringify(e));
    for (const e of [null, undefined, { status: 500, message: 'boom' }, { status: 0, message: 'Failed to fetch' }, { code: '42501', message: 'permission denied' }, { code: 'PGRST301' }]) assert.equal(S.isMissingTable(e), false, JSON.stringify(e));
  });
});

// Falešný klient s chováním tabulky user_settings (jeden řádek na uživatele, čas bere "server").
const makeClient = ({ rows = {}, fail = null } = {}) => {
  const calls = [];
  let clock = 1000;
  const from = (table) => {
    const q = { op: null, payload: null, uid: null };
    const exec = () => {
      calls.push({ table, op: q.op, uid: q.uid, payload: q.payload });
      const f = fail && fail(q.op, calls.length);
      if (f) return f;
      if (q.op === 'select') return { data: rows[q.uid] || null, error: null };
      clock += 1000;
      rows[q.payload.user_id] = { data: q.payload.data, updated_at: `T${clock}` };
      return { data: { updated_at: rows[q.payload.user_id].updated_at }, error: null };
    };
    const b = {
      select() { if (!q.op) q.op = 'select'; return b; },
      eq(_c, v) { q.uid = v; return b; },
      upsert(p) { q.op = 'upsert'; q.payload = p; return b; },
      maybeSingle() { return Promise.resolve().then(exec); },
      single() { return Promise.resolve().then(exec); },
    };
    return b;
  };
  return { from, calls, rows };
};
const makeTimers = () => { const jobs = []; return { jobs, setTimer: (fn) => { jobs.push(fn); return jobs.length; }, clearTimer: (id) => { jobs[id - 1] = null; }, run: async () => { for (const j of jobs.splice(0)) if (j) await j(); } }; };
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('synchronizace nastavení: řadič', () => {
  const setup = (opts = {}) => {
    const storage = makeStorage(opts.local || {}); setStorage(storage);
    const client = makeClient(opts.client || {});
    const timers = makeTimers();
    const sync = S.createSettingsSync({ client, storage, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
    return { storage, client, timers, sync };
  };

  test('první přihlášení bez řádku v účtu nahraje nastavení ze zařízení', async () => {
    const { client, sync, storage } = setup({ local: { 'jomarid-books-theme': 'dark' } });
    await sync.start('u1');
    assert.equal(client.calls.filter((c) => c.op === 'upsert').length, 1);
    assert.deepEqual(client.rows.u1.data, { v: 1, items: { 'jomarid-books-theme': 'dark' } });
    assert.equal(sync.status, 'synced');
    assert.deepEqual(JSON.parse(storage.getItem('jomarid-settings-sync')), { userId: 'u1', serverAt: client.rows.u1.updated_at, dirty: false });
  });

  test('nové zařízení: nastavení z účtu se použije a appka se o tom dozví', async () => {
    const { storage, sync } = setup({ local: { 'jomarid-motion': 'reduce' }, client: { rows: { u1: { updated_at: 'T5', data: { v: 1, items: { 'jomarid-books-theme': 'ocean', 'jomarid-ui-scale': 'l' } } } } } });
    let applied = 0;
    const onApplied = () => { applied += 1; };
    globalThis.window = { dispatchEvent: (e) => { if (e.type === 'jomarid-settings-applied') onApplied(); }, };
    try { await sync.start('u1'); } finally { delete globalThis.window; }
    assert.equal(storage.getItem('jomarid-books-theme'), 'ocean');
    assert.equal(storage.getItem('jomarid-ui-scale'), 'l');
    assert.equal(storage.getItem('jomarid-motion'), null);
    assert.equal(applied, 1);
    assert.equal(sync.status, 'synced');
  });

  test('použití nastavení z účtu se nevrací zpátky jako "změna" (žádná smyčka)', async () => {
    const { client, sync, timers } = setup({ client: { rows: { u1: { updated_at: 'T5', data: { v: 1, items: { 'jomarid-books-theme': 'custom', 'jomarid-books-theme-custom': JSON.stringify({ bg: '#0b1020', accent: '#60a5fa' }) } } } } } });
    // saveCustomColors při použití ohlásí změnu; řadič ji musí ignorovat
    globalThis.window = { dispatchEvent: (e) => { if (e.type === 'jomarid-settings-changed') sync.changed(); } };
    try { await sync.start('u1'); } finally { delete globalThis.window; }
    await timers.run(); await tick();
    assert.equal(client.calls.filter((c) => c.op === 'upsert').length, 0);
  });

  test('změna v zařízení se odešle až po prodlevě, a to jen jednou, i když se změní víckrát', async () => {
    const { client, sync, timers, storage } = setup({ client: { rows: { u1: { updated_at: 'T5', data: { v: 1, items: { 'jomarid-books-theme': 'dark' } } } } } });
    await sync.start('u1');
    storage.setItem('jomarid-books-theme', 'sepia'); sync.changed();
    storage.setItem('jomarid-ui-scale', 'xl'); sync.changed();
    storage.setItem('jomarid-accent', 'rose'); sync.changed();
    assert.equal(client.calls.filter((c) => c.op === 'upsert').length, 0, 'ještě se neodesílá');
    assert.equal(JSON.parse(storage.getItem('jomarid-settings-sync')).dirty, true);
    await timers.run(); await tick();
    const ups = client.calls.filter((c) => c.op === 'upsert');
    assert.equal(ups.length, 1);
    assert.deepEqual(ups[0].payload.data.items, { 'jomarid-books-theme': 'sepia', 'jomarid-ui-scale': 'xl', 'jomarid-accent': 'rose' });
    assert.equal(JSON.parse(storage.getItem('jomarid-settings-sync')).dirty, false);
  });

  test('změna za běhu odesílání se neztratí', async () => {
    const { client, sync, timers, storage } = setup({ client: { rows: { u1: { updated_at: 'T5', data: { v: 1, items: { 'jomarid-books-theme': 'dark' } } } } } });
    await sync.start('u1');
    storage.setItem('jomarid-accent', 'blue'); sync.changed();
    const pushing = sync.flush();
    storage.setItem('jomarid-accent', 'green'); sync.changed(); // za běhu odesílání
    await pushing; await tick();
    assert.equal(JSON.parse(storage.getItem('jomarid-settings-sync')).dirty, true, 'novější změna zůstává k odeslání');
    await timers.run(); await tick();
    assert.equal(client.rows.u1.data.items['jomarid-accent'], 'green');
    assert.equal(JSON.parse(storage.getItem('jomarid-settings-sync')).dirty, false);
  });

  test('chybějící tabulka: synchronizace se vypne, nic nespadne a nic se neodesílá', async () => {
    const { client, sync, timers, storage } = setup({ local: { 'jomarid-books-theme': 'dark' }, client: { fail: () => ({ data: null, error: { code: 'PGRST205', message: 'Could not find the table' }, status: 404 }) } });
    await sync.start('u1');
    assert.equal(sync.status, 'unavailable');
    storage.setItem('jomarid-accent', 'rose'); sync.changed();
    await timers.run(); await tick();
    assert.equal(client.calls.length, 1, 'po zjištění se už nic nevolá');
    assert.equal(storage.getItem('jomarid-books-theme'), 'dark', 'nastavení v zařízení zůstalo');
  });

  test('výpadek: stav "error", změna zůstává k odeslání a odešle se při dalším pokusu', async () => {
    let down = true;
    const { client, sync, timers, storage } = setup({ client: { rows: { u1: { updated_at: 'T5', data: { v: 1, items: { 'jomarid-books-theme': 'dark' } } } }, fail: (op) => (down && op === 'upsert' ? { data: null, error: { message: 'Failed to fetch' }, status: 0 } : null) } });
    await sync.start('u1');
    storage.setItem('jomarid-accent', 'rose'); sync.changed();
    await timers.run(); await tick();
    assert.equal(sync.status, 'error');
    assert.equal(JSON.parse(storage.getItem('jomarid-settings-sync')).dirty, true);
    down = false;
    await sync.flush();
    assert.equal(sync.status, 'synced');
    assert.equal(client.rows.u1.data.items['jomarid-accent'], 'rose');
  });

  test('výpadek při čtení po přihlášení: nastavení v zařízení zůstane, žádný pád', async () => {
    const { sync, storage } = setup({ local: { 'jomarid-books-theme': 'dark' }, client: { fail: () => ({ data: null, error: { message: 'boom' }, status: 500 }) } });
    await sync.start('u1');
    assert.equal(sync.status, 'error');
    assert.equal(storage.getItem('jomarid-books-theme'), 'dark');
  });

  test('odhlášení: čekající odeslání se zruší a změny se už neodesílají; přihlášení jiného uživatele nezaměňuje data', async () => {
    const { client, sync, timers, storage } = setup({ client: { rows: { u1: { updated_at: 'T5', data: { v: 1, items: { 'jomarid-books-theme': 'dark' } } } } } });
    await sync.start('u1');
    storage.setItem('jomarid-accent', 'rose'); sync.changed();
    sync.stop();
    await timers.run(); await tick();
    assert.equal(client.calls.filter((c) => c.op === 'upsert').length, 0);
    assert.equal(sync.status, 'off');
    sync.changed();
    assert.equal(JSON.parse(storage.getItem('jomarid-settings-sync')).userId, 'u1', 'bez přihlášeného uživatele se nic nezapisuje');
    // jiný uživatel na stejném zařízení: záznam o poslední synchronizaci patří u1, takže se bere nastavení účtu u2
    client.rows.u2 = { updated_at: 'T9', data: { v: 1, items: { 'jomarid-books-theme': 'sepia' } } };
    await sync.start('u2');
    assert.equal(storage.getItem('jomarid-books-theme'), 'sepia');
    assert.equal(client.rows.u1.data.items['jomarid-accent'], undefined, 'nastavení u1 se u2 nenahrálo ani nepřepsalo');
  });

  test('flush bez neodeslaných změn nic neposílá', async () => {
    const { client, sync } = setup({ client: { rows: { u1: { updated_at: 'T5', data: { v: 1, items: { 'jomarid-books-theme': 'dark' } } } } } });
    await sync.start('u1');
    const before = client.calls.length;
    await sync.flush();
    assert.equal(client.calls.length, before);
  });
});

describe('verze aplikace', () => {
  test('verze v appInfo.js odpovídá package.json a popisku', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.equal(APP_VERSION, pkg.version);
    assert.equal(APP_VERSION, '1.0.0');
    assert.equal(APP_VERSION_LABEL, 'Verze ' + APP_VERSION.split('.').slice(0, 2).join('.'));
  });
});
