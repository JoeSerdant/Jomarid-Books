// Testy PWA: node --test src/tests/pwa.test.mjs   (nebo: npm run test:pwa)
//
// Manifest a ikony, odkazy v index.html, logika instalace a samotný service worker (spouští se v izolovaném prostředí s
// falešnou Cache API a sítí). Skutečná instalace a offline provoz v prohlížeči se ověřují zvlášť (E2E).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { installState, isIosDevice, sameInstallState } from '../pwa/installModel.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const manifest = JSON.parse(read('public/manifest.webmanifest'));
const html = read('index.html');

const pngSize = (file) => {
  const b = fs.readFileSync(path.join(ROOT, 'public', file));
  assert.equal(b.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${file}: podpis PNG`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

describe('manifest a ikony', () => {
  test('povinné položky pro instalaci', () => {
    assert.ok(manifest.name && manifest.short_name);
    assert.ok(manifest.short_name.length <= 12, 'krátký název se vejde pod ikonu');
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.lang, 'cs');
    assert.equal(manifest.scope, '/');
    assert.ok(manifest.start_url.startsWith('/'), 'start_url je v rozsahu appky');
    assert.equal(manifest.id, '/');
    assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
    assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
    assert.notEqual(manifest.prefer_related_applications, true);
  });
  test('ikony: 192 a 512 pro "any", 512 pro "maskable", soubory existují a mají deklarovanou velikost', () => {
    const byPurpose = (p) => manifest.icons.filter((i) => (i.purpose || 'any').split(' ').includes(p) && i.type === 'image/png');
    assert.ok(byPurpose('any').some((i) => i.sizes === '192x192'));
    assert.ok(byPurpose('any').some((i) => i.sizes === '512x512'));
    assert.ok(byPurpose('maskable').some((i) => i.sizes === '512x512'));
    for (const i of manifest.icons.filter((x) => x.type === 'image/png')) {
      const [w, h] = i.sizes.split('x').map(Number);
      assert.deepEqual(pngSize(i.src.replace(/^\//, '')), [w, h], i.src);
    }
    for (const i of manifest.icons) assert.ok(fs.existsSync(path.join(ROOT, 'public', i.src.replace(/^\//, ''))), i.src);
  });
  test('ikona "maskable" nemá průhledné rohy (systém ji ořízne sám)', () => {
    const svg = read('public/icon-maskable.svg');
    assert.ok(!/\brx=/.test(svg), 'bez zaoblení v SVG');
    assert.match(read('public/icon.svg'), /rx="\d+"/);
  });
  test('zkratky vedou na stránky appky a mají ikonu', () => {
    assert.ok(manifest.shortcuts.length >= 3);
    for (const s of manifest.shortcuts) {
      assert.ok(s.name && s.url.startsWith('/'), s.name);
      assert.ok(['/app', '/stats', '/games'].some((p) => s.url.startsWith(p)), s.url);
      assert.ok(s.icons?.length, s.name);
    }
  });
  test('favicon.ico je platný ICO s obrázkem 32 x 32', () => {
    const b = fs.readFileSync(path.join(ROOT, 'public/favicon.ico'));
    assert.equal(b.readUInt16LE(0), 0); assert.equal(b.readUInt16LE(2), 1); assert.equal(b.readUInt16LE(4), 1);
    assert.equal(b[6], 32); assert.equal(b[7], 32);
    const size = b.readUInt32LE(14); const offset = b.readUInt32LE(18);
    assert.equal(offset + size, b.length);
    assert.equal(b.subarray(offset, offset + 8).toString('hex'), '89504e470d0a1a0a');
  });
});

describe('index.html a hlavičky', () => {
  test('odkazy na manifest a ikony a údaje pro iOS', () => {
    assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/);
    assert.match(html, /<link rel="icon" href="\/icon\.svg" type="image\/svg\+xml">/);
    assert.match(html, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png">/);
    assert.match(html, /name="apple-mobile-web-app-capable"/);
    assert.match(html, /name="theme-color"/);
    assert.match(html, /name="description"/);
    assert.deepEqual(pngSize('apple-touch-icon.png'), [180, 180]);
  });
  test('vercel.json: service worker se neukládá do mezipaměti a SPA přesměrování zůstává', () => {
    const v = JSON.parse(read('vercel.json'));
    const sw = v.headers.find((h) => h.source === '/sw.js');
    assert.ok(sw.headers.some((h) => h.key === 'Cache-Control' && /max-age=0/.test(h.value) && /must-revalidate/.test(h.value)));
    assert.ok(v.rewrites.some((r) => r.destination === '/index.html'));
  });
});

describe('stav instalace', () => {
  const IPHONE = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1', platform: 'iPhone', maxTouchPoints: 5 };
  const IPAD_AS_MAC = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 };
  const MAC = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 0 };
  const ANDROID = { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36', platform: 'Linux armv81', maxTouchPoints: 5 };
  test('iOS se pozná (včetně iPadu, který se hlásí jako Mac), Mac a Android ne', () => {
    assert.equal(isIosDevice(IPHONE), true);
    assert.equal(isIosDevice(IPAD_AS_MAC), true);
    assert.equal(isIosDevice(MAC), false);
    assert.equal(isIosDevice(ANDROID), false);
    assert.equal(isIosDevice({}), false);
    assert.equal(isIosDevice(), false);
  });
  test('co Nastavení nabídne', () => {
    assert.deepEqual(installState({ deferredPrompt: true, nav: ANDROID }), { installed: false, canPrompt: true, ios: false });
    assert.deepEqual(installState({ nav: IPHONE }), { installed: false, canPrompt: false, ios: true });
    assert.deepEqual(installState({ nav: MAC }), { installed: false, canPrompt: false, ios: false }, 'bez instalačního okna jen obecná rada');
    assert.deepEqual(installState({ standalone: true, deferredPrompt: true, nav: IPHONE }), { installed: true, canPrompt: false, ios: false }, 'kdo appku už má, nabídku instalace nevidí');
    assert.deepEqual(installState(), { installed: false, canPrompt: false, ios: false });
  });
  test('porovnání stavů', () => {
    assert.equal(sameInstallState(installState(), installState()), true);
    assert.equal(sameInstallState(installState(), installState({ standalone: true })), false);
    assert.equal(sameInstallState(null, installState()), false);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Service worker v izolovaném prostředí
const TEMPLATE = read('src/pwa/sw.template.js');
const ORIGIN = 'https://app.test';
const HTML = (body = 'shell') => new Response(`<!doctype html>${body}`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });

// Ve skutečném service workeru se relativní adresy řeší vůči jeho umístění; Node to neumí, tak se to tu napodobí.
class SwRequest extends Request {
  constructor(input, init) { super(typeof input === 'string' ? new URL(input, ORIGIN) : input, init); }
}

const makeWorker = ({ required = ['/assets/index-abc.js'], optional = ['/icon-192.png'], version = 'v1', net, preset = {}, putFails = false } = {}) => {
  const source = TEMPLATE.replace("'__VERSION__'", JSON.stringify(version)).replace('[] /* REQUIRED */', JSON.stringify(required)).replace('[] /* OPTIONAL */', JSON.stringify(optional));
  const listeners = {};
  const stores = new Map(Object.entries(preset).map(([n, entries]) => [n, new Map(Object.entries(entries))]));
  const timers = [];
  const log = { fetched: [], skipped: false, claimed: false };
  const key = (r) => new URL(typeof r === 'string' ? r : r.url, ORIGIN).href;
  const fetchFn = async (req) => { log.fetched.push(key(req)); return net(typeof req === 'string' ? new Request(new URL(req, ORIGIN)) : req); };
  const cacheOf = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      match: async (r) => { const hit = m.get(key(r)); return hit ? hit.clone() : undefined; },
      put: async (r, res) => { if (putFails) throw new Error('quota'); m.set(key(r), res.clone()); },
      add: async (r) => { const res = await fetchFn(r); if (!res.ok) throw new Error('bad status'); m.set(key(r), res.clone()); },
    };
  };
  const caches = { open: async (n) => cacheOf(n), keys: async () => [...stores.keys()], delete: async (n) => stores.delete(n) };
  const self = { location: { origin: ORIGIN }, addEventListener: (t, fn) => { listeners[t] = fn; }, skipWaiting: async () => { log.skipped = true; }, clients: { claim: async () => { log.claimed = true; } } };
  vm.runInNewContext(source, { self, caches, fetch: fetchFn, Request: SwRequest, Response, URL, Promise, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, console });
  const lifecycle = async (type) => { const ps = []; listeners[type]({ waitUntil: (p) => ps.push(p) }); await Promise.all(ps); };
  const fetchEvent = (url, { method = 'GET', mode = 'cors' } = {}) => {
    const request = new Request(url, { method });
    Object.defineProperty(request, 'mode', { value: mode });
    let responded = null;
    listeners.fetch({ request, respondWith: (p) => { responded = Promise.resolve(p); } });
    return responded;
  };
  return { listeners, stores, timers, log, lifecycle, fetchEvent, name: `jomarid-${version}`, key };
};
const online = (map = {}) => async (req) => { const f = map[new URL(req.url).pathname]; if (f instanceof Error) throw f; return f ? f() : new Response('ok', { status: 200, headers: { 'content-type': 'application/javascript' } }); };
const offline = () => async () => { throw new TypeError('Failed to fetch'); };

describe('service worker: šablona', () => {
  test('šablona má právě po jednom místě pro verzi a seznam souborů (plugin je doplňuje)', () => {
    assert.equal(TEMPLATE.split("'__VERSION__'").length - 1, 1);
    assert.equal(TEMPLATE.split('[] /* REQUIRED */').length - 1, 1);
    assert.equal(TEMPLATE.split('[] /* OPTIONAL */').length - 1, 1);
    assert.equal(TEMPLATE.replace("'__VERSION__'", '"x"').includes('__VERSION__'), false, 'po doplnění nezůstane verze k doplnění');
  });
  test('doplněná šablona je platný skript', () => {
    assert.doesNotThrow(() => makeWorker({ net: online() }));
  });
});

describe('service worker: instalace a aktivace', () => {
  test('instalace uloží obal appky a soubory ze seznamu a hned se ujme práce', async () => {
    const w = makeWorker({ net: online({ '/': () => HTML() }) });
    await w.lifecycle('install');
    const cached = [...w.stores.get(w.name).keys()];
    assert.ok(cached.includes(`${ORIGIN}/`), 'obal appky');
    assert.ok(cached.includes(`${ORIGIN}/assets/index-abc.js`) && cached.includes(`${ORIGIN}/icon-192.png`));
    assert.equal(w.log.skipped, true);
  });
  test('selže-li stažení obalu nebo skriptu ke startu, instalace se nepovede (offline kopie by nefungovala); selže-li ikona, projde', async () => {
    const noShell = makeWorker({ net: online({ '/': () => new Response('nope', { status: 500 }) }) });
    await assert.rejects(() => noShell.lifecycle('install'));
    const noScript = makeWorker({ net: online({ '/': () => HTML(), '/assets/index-abc.js': () => new Response('x', { status: 503 }) }) });
    await assert.rejects(() => noScript.lifecycle('install'));
    const dropped = makeWorker({ net: online({ '/': () => HTML(), '/assets/index-abc.js': new Error('spojení se přerušilo') }) });
    await assert.rejects(() => dropped.lifecycle('install'), /spojení/);
    const oneMissing = makeWorker({ net: online({ '/': () => HTML(), '/icon-192.png': () => new Response('x', { status: 404 }) }) });
    await oneMissing.lifecycle('install');
    assert.ok(!oneMissing.stores.get(oneMissing.name).has(`${ORIGIN}/icon-192.png`));
    assert.ok(oneMissing.stores.get(oneMissing.name).has(`${ORIGIN}/assets/index-abc.js`));
    assert.equal(oneMissing.log.skipped, true, 'a service worker se přesto aktivuje');
  });
  test('aktivace smaže úložiště starých verzí, cizí nechá být, a převezme stránky', async () => {
    const w = makeWorker({ version: 'v2', net: online(), preset: { 'jomarid-v1': { a: new Response('x') }, 'jomarid-v2': {}, 'cizi-appka': {} } });
    await w.lifecycle('activate');
    assert.deepEqual([...w.stores.keys()].sort(), ['cizi-appka', 'jomarid-v2']);
    assert.equal(w.log.claimed, true);
  });
});

describe('service worker: co zpracovává a co ne', () => {
  const ignored = async (w, url, opts) => { const r = w.fetchEvent(url, opts); assert.equal(r, null, `${opts?.method || 'GET'} ${url} se nezpracovává`); assert.deepEqual(w.log.fetched, []); };
  test('nikdy nesahá na databázi, písma, cizí adresy, zápisy a samotný service worker', async () => {
    const w = makeWorker({ net: online() });
    await ignored(w, 'https://xyz.supabase.co/rest/v1/books?select=*');
    await ignored(w, 'https://xyz.supabase.co/auth/v1/token', { method: 'POST' });
    await ignored(w, 'https://fonts.googleapis.com/css2?family=Inter');
    await ignored(w, `${ORIGIN}/api/neco`, { method: 'POST' });
    await ignored(w, `${ORIGIN}/sw.js`);
    await ignored(w, `${ORIGIN}/icon.svg`);
    await ignored(w, `${ORIGIN}/manifest.webmanifest`);
  });
  test('cizí adresa se nezpracovává ani tehdy, když vypadá jako soubor appky nebo je to navigace', async () => {
    const w = makeWorker({ net: online() });
    await ignored(w, 'https://cdn.example.com/assets/knihovna-1.js');
    await ignored(w, 'https://jina-appka.example.com/', { mode: 'navigate' });
  });
  test('zápisy (odeslání formuláře, nahrání) se nezpracovávají ani na vlastní adrese stránek a souborů', async () => {
    const w = makeWorker({ net: online() });
    await ignored(w, `${ORIGIN}/`, { method: 'POST', mode: 'navigate' });
    await ignored(w, `${ORIGIN}/assets/index-abc.js`, { method: 'POST' });
    await ignored(w, `${ORIGIN}/app`, { method: 'PUT' });
  });
});

describe('service worker: stránky (navigace)', () => {
  const NAV = { mode: 'navigate' };
  test('online: vrací nejnovější stránku ze sítě a obnoví uložený obal', async () => {
    const w = makeWorker({ net: online({ '/knihovna': () => HTML('nova') }), preset: { 'jomarid-v1': { [`${ORIGIN}/`]: HTML('stara') } } });
    const res = await w.fetchEvent(`${ORIGIN}/knihovna`, NAV);
    assert.match(await res.text(), /nova/);
    const shell = await w.stores.get('jomarid-v1').get(`${ORIGIN}/`).text();
    assert.match(shell, /nova/, 'obal se aktualizoval');
  });
  test('bez připojení: uložený obal appky, ať je adresa jakákoli', async () => {
    const w = makeWorker({ net: offline(), preset: { 'jomarid-v1': { [`${ORIGIN}/`]: HTML('obal') } } });
    for (const p of ['/', '/app', '/read/123', '/settings/app']) assert.match(await (await w.fetchEvent(`${ORIGIN}${p}`, NAV)).text(), /obal/, p);
  });
  test('pomalá síť: po vypršení limitu se ukáže uložený obal a stahování dobíhá na pozadí', async () => {
    let finish;
    const slow = () => new Promise((resolve) => { finish = () => resolve(HTML('pozdni')); });
    const w = makeWorker({ net: slow, preset: { 'jomarid-v1': { [`${ORIGIN}/`]: HTML('obal') } } });
    const pending = w.fetchEvent(`${ORIGIN}/app`, NAV);
    await new Promise((r) => setTimeout(r, 5)); // ať se zaregistruje časovač
    const t = w.timers.find((x) => x.ms === 4000);
    assert.ok(t, 'časovač 4 s');
    t.fn();
    assert.match(await (await pending).text(), /obal/);
    finish(); // pozdní odpověď nic nerozbije
    await new Promise((r) => setTimeout(r, 5));
  });
  test('bez uloženého obalu a bez připojení se chyba předá prohlížeči (ukáže svou offline stránku)', async () => {
    const w = makeWorker({ net: offline() });
    await assert.rejects(() => w.fetchEvent(`${ORIGIN}/`, NAV), /Failed to fetch/);
  });
  test('chybová odpověď serveru se do obalu neuloží', async () => {
    const w = makeWorker({ net: online({ '/app': () => new Response('chyba', { status: 502, headers: { 'content-type': 'text/html' } }) }), preset: { 'jomarid-v1': { [`${ORIGIN}/`]: HTML('obal') } } });
    const res = await w.fetchEvent(`${ORIGIN}/app`, NAV);
    assert.equal(res.status, 502);
    assert.match(await w.stores.get('jomarid-v1').get(`${ORIGIN}/`).text(), /obal/);
  });
  test('úspěšná odpověď, která není stránka (stažený soubor), uložený obal nepřepíše', async () => {
    const w = makeWorker({ net: online({ '/export': () => new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf' } }) }), preset: { 'jomarid-v1': { [`${ORIGIN}/`]: HTML('obal') } } });
    assert.equal((await w.fetchEvent(`${ORIGIN}/export`, NAV)).status, 200);
    assert.match(await w.stores.get('jomarid-v1').get(`${ORIGIN}/`).text(), /obal/);
  });
  test('plné úložiště nezabrání zobrazení stránky', async () => {
    const w = makeWorker({ net: online({ '/': () => HTML('ok') }), putFails: true });
    assert.match(await (await w.fetchEvent(`${ORIGIN}/`, NAV)).text(), /ok/);
  });
});

describe('service worker: skripty z /assets/', () => {
  test('po prvním stažení se berou z úložiště (soubor má v názvu otisk obsahu)', async () => {
    const w = makeWorker({ net: online() });
    await (await w.fetchEvent(`${ORIGIN}/assets/chess-1a2b.js`)).text();
    await (await w.fetchEvent(`${ORIGIN}/assets/chess-1a2b.js`)).text();
    assert.equal(w.log.fetched.filter((u) => u.endsWith('chess-1a2b.js')).length, 1, 'ze sítě jen jednou');
  });
  test('chybějící soubor (404) se neukládá a plné úložiště nevadí', async () => {
    const w = makeWorker({ net: online({ '/assets/stary-1.js': () => new Response('nenalezeno', { status: 404 }) }) });
    assert.equal((await w.fetchEvent(`${ORIGIN}/assets/stary-1.js`)).status, 404);
    assert.equal(w.stores.get('jomarid-v1')?.has(`${ORIGIN}/assets/stary-1.js`) ?? false, false);
    const full = makeWorker({ net: online(), putFails: true });
    assert.equal((await full.fetchEvent(`${ORIGIN}/assets/x-1.js`)).status, 200);
  });
  test('zpráva SKIP_WAITING přeskočí čekání', () => {
    const w = makeWorker({ net: online() });
    w.listeners.message({ data: 'SKIP_WAITING' });
    assert.equal(w.log.skipped, true);
  });
});

describe('sestavení: co se vkládá do offline úložiště', () => {
  const config = read('vite.config.js');
  test('stylesheet patří k povinným souborům (start appky), písma k volitelným (stahují se jen při použití)', () => {
    assert.match(config, /required = \[\.\.\.\[\.\.\.startup\]\.sort\(\), \.\.\.styles\]/);
    assert.match(config, /optional = \[\.\.\.fonts, \.\.\.publicFiles\]/);
    assert.match(config, /\.css\$/);
    assert.match(config, /\.woff2\?\$/);
  });
  test('kreslený styl a jeho písmo jsou v src, takže je sestavení opravdu vyrobí', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'src', 'sketchy.css')));
    assert.ok(fs.existsSync(path.join(ROOT, 'src', 'fonts', 'patrick-hand-latin.woff2')) && fs.existsSync(path.join(ROOT, 'src', 'fonts', 'patrick-hand-latin-ext.woff2')));
    assert.match(read('src/index.jsx'), /import '\.\/sketchy\.css'/);
  });
});

describe('nabídka instalace na úvodní stránce', () => {
  let M;
  const DAY = 24 * 60 * 60 * 1000;
  const mem = (init = {}, broken = false) => { const m = new Map(Object.entries(init)); const g = () => { if (broken) throw new Error('x'); }; return { getItem: (k) => { g(); return m.has(k) ? m.get(k) : null; }, setItem: (k, v) => { g(); m.set(k, String(v)); } }; };
  const CAN = { installed: false, canPrompt: true, ios: false };
  const IOS = { installed: false, canPrompt: false, ios: true };
  const NONE = { installed: false, canPrompt: false, ios: false };

  test('model se načte', async () => { M = await import('../pwa/installPromptModel.js'); assert.ok(M.shouldShowInstallPopup); });
  test('ukáže se tomu, kdo appku nemá a může ji nainstalovat (okno prohlížeče i iPhone)', () => {
    assert.equal(M.shouldShowInstallPopup({ state: CAN, dismissals: { count: 0, at: 0 }, now: 1000 }), true);
    assert.equal(M.shouldShowInstallPopup({ state: IOS, dismissals: { count: 0, at: 0 }, now: 1000 }), true);
  });
  test('neukáže se, když appka už běží nainstalovaná nebo když ji prohlížeč nemůže nainstalovat', () => {
    assert.equal(M.shouldShowInstallPopup({ state: { installed: true, canPrompt: false, ios: false }, dismissals: { count: 0, at: 0 } }), false);
    assert.equal(M.shouldShowInstallPopup({ state: NONE, dismissals: { count: 0, at: 0 } }), false);
    assert.equal(M.shouldShowInstallPopup({ state: null, dismissals: { count: 0, at: 0 } }), false);
  });
  test('po prvním „Teď ne“ 7 dní pauza, po dalších 30', () => {
    const t0 = 1_000_000;
    assert.equal(M.shouldShowInstallPopup({ state: CAN, dismissals: { count: 1, at: t0 }, now: t0 + 6 * DAY }), false);
    assert.equal(M.shouldShowInstallPopup({ state: CAN, dismissals: { count: 1, at: t0 }, now: t0 + 7 * DAY }), true);
    assert.equal(M.shouldShowInstallPopup({ state: CAN, dismissals: { count: 2, at: t0 }, now: t0 + 29 * DAY }), false);
    assert.equal(M.shouldShowInstallPopup({ state: CAN, dismissals: { count: 2, at: t0 }, now: t0 + 30 * DAY }), true);
  });
  test('odmítnutí se ukládá a čte; poškozená hodnota a nedostupné úložiště nic nerozbijí', () => {
    const s = mem();
    assert.deepEqual(M.readDismissals(s), { count: 0, at: 0 });
    M.recordDismissal(s, 5000); M.recordDismissal(s, 9000);
    assert.deepEqual(M.readDismissals(s), { count: 2, at: 9000 });
    for (const bad of ['{', 'null', '5', '{"count":"x","at":1}', '{"count":-1,"at":1}', '{"count":1}', '[]']) assert.deepEqual(M.readDismissals(mem({ [M.INSTALL_DISMISS_KEY]: bad })), { count: 0, at: 0 }, bad);
    const broken = mem({}, true);
    assert.doesNotThrow(() => M.recordDismissal(broken, 1));
    assert.deepEqual(M.readDismissals(broken), { count: 0, at: 0 });
    assert.deepEqual(M.readDismissals(null), { count: 0, at: 0 });
  });
});
