// ASGARD CRM Service Worker
// Cache Busting + Push Notifications + Offline Support

const CACHE_NAME = 'asgard-crm-v1.0.0';

// ─────────────────────────────────────────────────────────────────────
// Install: precache critical shell assets
// ─────────────────────────────────────────────────────────────────────
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './assets/css/design-tokens.css',
  './assets/css/components.css',
  './assets/css/layout.css',
  './assets/css/app.css',
  './assets/img/logo.png',
  './assets/img/asgard_logo.png',
  './assets/img/asgard_emblem.png'
];

self.addEventListener('install', (event) => {
  console.log('[SW] Installing', CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => {
        console.log('[SW] Shell cached');
        // Don't skipWaiting automatically — let the update banner control it
      })
      .catch((err) => console.error('[SW] Install failed:', err))
  );
});

// ─────────────────────────────────────────────────────────────────────
// Activate: clean up old caches
// ─────────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating', CACHE_NAME);
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names
          .filter((name) => name.startsWith('asgard-crm-') && name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// ─────────────────────────────────────────────────────────────────────
// Fetch strategies:
//   HTML & API  → Network First (always try fresh, fallback to cache)
//   JS/CSS/img  → Stale While Revalidate (fast from cache, update in bg)
// ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests from same origin
  if (request.method !== 'GET') return;
  if (url.origin !== location.origin) return;

  // API requests — always network, no caching
  if (url.pathname.startsWith('/api/')) return;

  // HTML requests → Network First
  const acceptHeader = request.headers.get('accept') || '';
  if (acceptHeader.includes('text/html') || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Static assets (JS, CSS, images, fonts) → Stale While Revalidate
  event.respondWith(staleWhileRevalidate(request));
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Fallback: serve index.html for SPA navigation
    const fallback = await caches.match('./index.html');
    if (fallback) return fallback;
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  // Always try to fetch fresh version in background
  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  // Return cached immediately if available, otherwise wait for network
  if (cached) {
    // Fire and forget the background update
    fetchPromise;
    return cached;
  }

  const response = await fetchPromise;
  if (response) return response;

  return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
}

// ─────────────────────────────────────────────────────────────────────
// Messages from client
// ─────────────────────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  if (event.data === 'getVersion') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});

// ─────────────────────────────────────────────────────────────────────
// Push Notifications (Phase 2)
// ─────────────────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch (e) {
    payload = { title: 'АСГАРД CRM', body: event.data.text() };
  }

  const options = {
    body: payload.body || '',
    icon: payload.icon || './assets/img/icon-192.png',
    badge: './assets/img/icon-96.png',
    tag: payload.tag || 'asgard-notification',
    data: { url: payload.url || '/' },
    vibrate: [200, 100, 200],
    actions: payload.actions || []
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || 'АСГАРД CRM', options)
      .then(() => {
        // Update app badge if supported
        if (payload.badge_count !== undefined && 'setAppBadge' in navigator) {
          if (payload.badge_count > 0) {
            return navigator.setAppBadge(payload.badge_count);
          } else {
            return navigator.clearAppBadge();
          }
        }
      })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Try to focus existing window
        for (const client of clientList) {
          if (new URL(client.url).origin === location.origin) {
            client.focus();
            client.postMessage({ type: 'NOTIFICATION_CLICK', url: targetUrl });
            return;
          }
        }
        // No existing window — open new one
        return clients.openWindow(targetUrl);
      })
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  // Auto-resubscribe when subscription expires or keys rotate
  event.waitUntil(
    self.registration.pushManager.subscribe(event.oldSubscription.options)
      .then((newSub) => {
        // Notify server about the new subscription
        return fetch('/api/push/resubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            old_endpoint: event.oldSubscription?.endpoint,
            new_subscription: newSub.toJSON()
          })
        });
      })
      .catch((err) => console.error('[SW] Resubscribe failed:', err))
  );
});

console.log('[SW] Service Worker loaded:', CACHE_NAME);
