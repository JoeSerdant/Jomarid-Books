/* Service worker Jomarid Books. Soubor sw.js vzniká při sestavení z téhle šablony (viz vite.config.js): verze a seznam
   souborů k předchozímu uložení se doplní podle sestavení. Zásady:
   - Zpracovává jen GET požadavky na vlastní adresu. Databáze (Supabase), písma a cizí skripty se nikdy neukládají ani
     nezdržují: data se vždy berou z internetu, aby čtenář neviděl zastaralý stav knihovny, mincí ani postupu.
   - Stránky (navigace): nejdřív síť (vždy nejnovější verze), a když není připojení nebo je moc pomalé, uložený obal appky.
   - Soubory v /assets/ mají v názvu otisk obsahu, takže se po stažení berou z úložiště (jsou neměnné).
   - Při nové verzi se staré úložiště smaže a nový service worker se ujme stránek hned. */

const VERSION = '__VERSION__';
const CACHE = 'jomarid-' + VERSION;
const PRECACHE = [] /* PRECACHE */; // seznam souborů doplní sestavení
const SHELL = '/';
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.add(new Request(SHELL, { cache: 'reload' })); // obal appky je nezbytný, bez něj se instalace nepovede
    await Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {}))); // ostatní jen když se podaří
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('jomarid-') && n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

const isHtml = (res) => /text\/html/i.test(res.headers.get('content-type') || '');

const networkFirstShell = async (request) => {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(SHELL);
  const fetching = fetch(request).then(async (res) => {
    // Obal se obnovuje při každé úspěšné návštěvě, ať je offline kopie co nejnovější (jen skutečná stránka, ne chyba).
    if (res.ok && isHtml(res)) { try { await cache.put(SHELL, res.clone()); } catch { /* plné úložiště: stránka se přesto zobrazí */ } }
    return res;
  });
  if (!cached) return fetching;
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS));
  try {
    const res = await Promise.race([fetching, timeout]);
    if (res) return res;
    fetching.catch(() => {}); // pomalá síť: ukáže se uložený obal, stahování dobíhá na pozadí
    return cached;
  } catch {
    return cached; // bez připojení
  }
};

const cacheFirst = async (request) => {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) { try { await cache.put(request, res.clone()); } catch { /* plné úložiště: soubor se přesto použije */ } }
  return res;
};

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Supabase, písma, cizí skripty: nikdy
  if (url.pathname === '/sw.js') return;
  if (request.mode === 'navigate') { event.respondWith(networkFirstShell(request)); return; }
  if (url.pathname.startsWith('/assets/')) { event.respondWith(cacheFirst(request)); return; }
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
