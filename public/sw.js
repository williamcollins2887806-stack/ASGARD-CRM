// ASGARD CRM Service Worker
// Shell caching + Push Notifications + Offline Support

const SHELL_VERSION = '8.9.4-mobile-v3';
const CACHE_NAME = `asgard-crm-shell-${SHELL_VERSION}`;

// Keep the shell asset list aligned with versioned URLs from index.html.
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json?v=8.9.0',
  './assets/css/design-tokens.css?v=8.9.0',
  './assets/css/components.css?v=8.9.0',
  './assets/css/layout.css?v=8.9.0',
  './assets/css/app.css?v=8.9.0-mobile-disable-20260312',
  './assets/css/responsive.css?v=8.9.0',
  './assets/js/ui.js?v=8.9.2-phase0',
  './assets/js/sla.js?v=8.9.2-phase0',
  './assets/js/funnel.js?v=8.9.2-phase0',
  './assets/js/diag.js?v=8.9.2-phase0',
  './assets/js/push-notifications.js?v=8.9.2-phase0',
  './assets/js/webauthn.js?v=8.9.2-phase0',
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
        console.log('[SW] Shell cached and waiting for activation');
      })
      .catch((err) => console.error('[SW] Install failed:', err))
  );
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating', CACHE_NAME);
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith('asgard-crm-shell-') && name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  const acceptHeader = request.headers.get('accept') || '';
  const isNavigation = request.mode === 'navigate';
  if (isNavigation || acceptHeader.includes('text/html') || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    const fallback = await caches.match('./index.html');
    if (fallback) return fallback;
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    fetchPromise.catch(() => null);
    return cached;
  }

  const response = await fetchPromise;
  if (response) return response;

  return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
}

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting' || (event.data && event.data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
    return;
  }
  if (event.data === 'getVersion' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: CACHE_NAME, shellVersion: SHELL_VERSION });
  }
});

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
        if (payload.badge_count !== undefined && 'setAppBadge' in navigator) {
          if (payload.badge_count > 0) {
            return navigator.setAppBadge(payload.badge_count);
          }
          return navigator.clearAppBadge();
        }
        return null;
      })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (new URL(client.url).origin === location.origin) {
            client.focus();
            client.postMessage({ type: 'NOTIFICATION_CLICK', url: targetUrl });
            return client;
          }
        }
        return clients.openWindow(targetUrl);
      })
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.registration.pushManager.subscribe(event.oldSubscription.options)
      .then((newSub) => fetch('/api/push/resubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          old_endpoint: event.oldSubscription?.endpoint,
          new_subscription: newSub.toJSON()
        })
      }))
      .catch((err) => console.error('[SW] Resubscribe failed:', err))
  );
});

console.log('[SW] Service Worker loaded:', CACHE_NAME);
