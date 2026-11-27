/**
 * SokeriSport service worker.
 * The app shell is kept in the cache; works in offline places like the pitch or the gym.
 */

const VERSION = 'sokerisport-v1.7.4';
const SHELL = [
  './',
  './index.html',
  './app.html',
  './science.html',
  './guide.html',
  './manifest.webmanifest',
  './assets/css/base.css',
  './assets/css/landing.css',
  './assets/css/app.css',
  './assets/js/engine.js',
  './assets/js/scenario.js',
  './assets/js/csv.js',
  './assets/js/version.js',
  './assets/js/chart.js',
  './assets/js/storage.js',
  './assets/js/stats.js',
  './assets/js/app.js',
  './assets/js/landing.js',
  './assets/js/docs.js',
  './assets/js/pwa.js',
  './assets/js/hypo.js',
  './assets/img/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      await Promise.allSettled(SHELL.map((url) => cache.add(url)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

/**
 * Cached page for a navigation. Static hosts serve the same page under two
 * names: GitHub Pages uses /app.html, Sites redirects /app.html → /app. Trying
 * both keeps every page reachable offline, not just the page that was opened.
 */
async function cachedPage(url) {
  const exact = await caches.match(url.pathname, { ignoreSearch: true });
  if (exact) return exact;

  const candidates = url.pathname.endsWith('/')
    ? [`${url.pathname}index.html`]
    : [`${url.pathname}.html`, `${url.pathname}/index.html`];
  for (const candidate of candidates) {
    const hit = await caches.match(candidate, { ignoreSearch: true });
    if (hit) return hit;
  }

  return caches.match('./index.html');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Page navigations: network first, then cache (offline fallback).
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          // Never cache an error page as if it were the route.
          if (fresh && fresh.ok) {
            const cache = await caches.open(VERSION);
            cache.put(request, fresh.clone());
          }
          return fresh;
        } catch {
          const cached = await cachedPage(url);
          if (cached) return cached;
          return new Response('Offline. SokeriSport could not be loaded.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        }
      })(),
    );
    return;
  }

  // Static assets: cache first.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) {
        // silent background update
        fetch(request)
          .then(async (res) => {
            if (res && res.ok) {
              const cache = await caches.open(VERSION);
              cache.put(request, res.clone());
            }
          })
          .catch(() => {});
        return cached;
      }
      try {
        const res = await fetch(request);
        if (res && res.ok) {
          const cache = await caches.open(VERSION);
          cache.put(request, res.clone());
        }
        return res;
      } catch {
        return new Response('', { status: 504 });
      }
    })(),
  );
});
