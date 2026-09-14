// SCM Admin service worker.
//
// Keeps the app itself on this computer, so the panel opens even when the
// connection is weak or gone and only data has to travel:
//
//   /assets/*   Hashed file names never change once built — served from the
//               cache, fetched only the first time.
//   pages       Asked of the network first so a new deploy is picked up, but
//               a weak signal gets the cached page after a few seconds.
//
// Firebase traffic is left alone: Firestore keeps its own offline copy.

const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `scm-admin-${VERSION}`;
const PAGE = '/index.html';
const SLOW_NETWORK_MS = 3500;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(PAGE))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Each deploy has its own cache; the last one's files are cleared away.
      for (const key of await caches.keys()) {
        if (key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

// The page lists the files it loaded before this worker was running.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'cache-assets' || !Array.isArray(event.data.urls)) return;
  const assets = event.data.urls.filter((url) => {
    const parsed = new URL(url, self.location.origin);
    return parsed.origin === self.location.origin && parsed.pathname.startsWith('/assets/');
  });
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(assets.map((url) => cache.match(url).then((hit) => hit || cache.add(url).catch(() => {})))),
    ),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request));
  } else if (request.mode === 'navigate') {
    event.respondWith(page(request));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function page(request) {
  const cache = await caches.open(CACHE);
  const network = fetch(request).then((response) => {
    if (response.ok) cache.put(PAGE, response.clone());
    return response;
  });
  const cached = await cache.match(PAGE);
  if (!cached) return network;
  // The network copy is still saved for next time when the cached one wins.
  return Promise.race([
    network.catch(() => cached),
    new Promise((resolve) => setTimeout(() => resolve(cached), SLOW_NETWORK_MS)),
  ]);
}
