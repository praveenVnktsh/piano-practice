/* Piano Practice service worker: works offline once the app has been opened.
 *
 * Built by src/pwa/plugin.js into dist/sw.js, with `self.PRECACHE = {version, files}` prepended
 * (every built file: app shell, Verovio engine, piano samples, bundled songs, icons).
 * The dev server serves it at /sw.js with `self.PRECACHE = {version: 'dev', files: [], dev: true}`.
 *
 *   production  precache on install (versioned cache, old versions removed on activate);
 *               page loads: network first (3 s), then the cached shell;
 *               hashed assets, samples, icons, fonts: cache first;
 *               songs and catalogs: cached copy at once, refreshed in the background.
 *   dev         network first for everything, cache only as an offline fallback, so Vite's
 *               HMR keeps working; registered only behind a flag (src/pwa/sw-register.js).
 *
 * Never touched: non-GET requests, /__* dev endpoints (progress, teacher, songs, relay, backup),
 * Vite internals (/@vite, /@fs, /@id, ?import, ?t=, ?v=…, /node_modules/.vite), range requests.
 */
const P = self.PRECACHE || {version: 'dev', files: [], dev: true};
const CACHE = 'piano-practice-' + P.version;
const FONT_ORIGINS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // One by one so a single missing file doesn't fail the whole install.
    await Promise.all(['./', ...P.files].map(url => cache.add(new Request(url, {cache: 'reload'})).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('piano-practice-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'clear') event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('piano-practice-')).map(k => caches.delete(k)))));
});

function skip(request, url) {
  if (request.method !== 'GET' || request.headers.has('range')) return true;
  if (FONT_ORIGINS.includes(url.origin)) return false;
  if (url.origin !== self.location.origin) return true;
  const p = url.pathname;
  if (p.startsWith('/__') || p.startsWith('/@') || p.startsWith('/node_modules/.vite/') || p === '/sw.js') return true;
  if (/[?&](import|t|html-proxy|worker|url|raw)(=|&|$)/.test(url.search)) return true;
  return false;
}

async function put(request, response) {
  if (!response || !(response.ok || response.type === 'opaque')) return response;
  const copy = response.clone();
  caches.open(CACHE).then(c => c.put(request, copy)).catch(() => {});
  return response;
}

async function networkFirst(request, {timeout = 0, fallback} = {}) {
  const net = fetch(request).then(r => put(request, r));
  try {
    return timeout ? await Promise.race([net, new Promise((_, no) => setTimeout(() => no(new Error('slow')), timeout))]) : await net;
  } catch {
    const hit = await caches.match(request, {ignoreVary: true}) || (fallback && await caches.match(fallback));
    if (hit) return hit;
    return net; // still waiting on a slow network: better late than nothing
  }
}

async function cacheFirst(request) {
  const hit = await caches.match(request, {ignoreVary: true});
  return hit || put(request, await fetch(request));
}

async function staleWhileRevalidate(request, event) {
  const hit = await caches.match(request, {ignoreVary: true});
  const net = fetch(request).then(r => put(request, r)).catch(() => hit);
  if (hit) { event.waitUntil(net); return hit; }
  return net;
}

self.addEventListener('fetch', event => {
  const {request} = event;
  const url = new URL(request.url);
  if (skip(request, url)) return;
  if (P.dev) { event.respondWith(networkFirst(request, {fallback: request.mode === 'navigate' ? './' : null})); return; }
  if (request.mode === 'navigate') { event.respondWith(networkFirst(request, {timeout: 3000, fallback: './'})); return; }
  const p = url.pathname;
  if (FONT_ORIGINS.includes(url.origin) || p.startsWith('/assets/') || p.startsWith('/samples/') || p.startsWith('/icons/')) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (p.startsWith('/songs/') || p === '/manifest.webmanifest') { event.respondWith(staleWhileRevalidate(request, event)); return; }
  event.respondWith(networkFirst(request));
});
