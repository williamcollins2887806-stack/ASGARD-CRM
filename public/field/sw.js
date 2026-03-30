/**
 * ASGARD Field — Service Worker
 */
const SHELL_VERSION = '1.3.0';
const SHELL_CACHE = 'field-shell-' + SHELL_VERSION;
const DATA_CACHE = 'field-data-v1';

const SHELL_URLS = [
  '/field/',
  '/field/index.html',
  '/field/ds-field.js',
  '/field/core.js',
  '/field/components.js',
  '/field/app.js',
  '/field/pages/login.js',
  '/field/pages/home.js',
  '/field/pages/shift.js',
  '/field/pages/money.js',
  '/field/pages/logistics.js',
  '/field/pages/history.js',
  '/field/pages/profile.js',
  '/assets/img/asgard_emblem.png',
];

// Install — cache shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => {
      return cache.addAll(SHELL_URLS).catch(err => {
        console.log('[SW] Cache addAll failed (non-critical):', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key.startsWith('field-') && key !== SHELL_CACHE && key !== DATA_CACHE)
          .map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API calls — network first, fallback to cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then(resp => {
          if (resp.ok && event.request.method === 'GET') {
            const clone = resp.clone();
            caches.open(DATA_CACHE).then(cache => cache.put(event.request, clone));
          }
          return resp;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Shell assets — cache first
  if (url.pathname.startsWith('/field/') || url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        return cached || fetch(event.request).then(resp => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(SHELL_CACHE).then(cache => cache.put(event.request, clone));
          }
          return resp;
        });
      })
    );
    return;
  }
});
