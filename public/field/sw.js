/**
 * ASGARD Field — Service Worker v2.0.0
 * Shell caching + Background Sync + Push Notifications
 */
const SHELL_VERSION = '2.1.0';
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
  '/field/pages/crew.js',
  '/field/pages/report.js',
  '/field/pages/incidents.js',
  '/field/pages/photos.js',
  '/field/pages/funds.js',
  '/field/pages/packing.js',
  '/assets/img/logo.png',
];

// ═══════════════════════════════════════════════════════════════
// INSTALL — cache shell
// ═══════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════
// ACTIVATE — clean old caches
// ═══════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════
// FETCH — cache first for shell, network first for API
// ═══════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════
// BACKGROUND SYNC — retry failed checkins and photos
// ═══════════════════════════════════════════════════════════════
self.addEventListener('sync', (event) => {
  if (event.tag === 'field-checkin-sync') {
    event.waitUntil(syncCheckins());
  }
  if (event.tag === 'field-photo-sync') {
    event.waitUntil(syncPhotos());
  }
  if (event.tag === 'field-report-sync') {
    event.waitUntil(syncReports());
  }
});

async function openFieldDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('field-offline-db', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('pending_checkins')) db.createObjectStore('pending_checkins', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('pending_photos')) db.createObjectStore('pending_photos', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('pending_reports')) db.createObjectStore('pending_reports', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('cached_project')) db.createObjectStore('cached_project', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAll(storeName) {
  const db = await openFieldDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deleteItem(storeName, key) {
  const db = await openFieldDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function syncCheckins() {
  try {
    const items = await getAll('pending_checkins');
    for (const item of items) {
      try {
        const resp = await fetch('/api/field' + item.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + item.token,
          },
          body: JSON.stringify(item.body),
        });
        if (resp.ok || resp.status === 409) {
          await deleteItem('pending_checkins', item.id);
        }
      } catch (_) {
        // Will retry on next sync
      }
    }
    // Notify clients
    const clients = await self.clients.matchAll();
    clients.forEach(c => c.postMessage({ type: 'sync-complete', store: 'checkins' }));
  } catch (err) {
    console.error('[SW] syncCheckins error:', err);
  }
}

async function syncPhotos() {
  try {
    const items = await getAll('pending_photos');
    for (const item of items) {
      try {
        const formData = new FormData();
        formData.append('file', item.blob, item.filename);
        if (item.work_id) formData.append('work_id', item.work_id);
        if (item.photo_type) formData.append('photo_type', item.photo_type);
        if (item.caption) formData.append('caption', item.caption);

        const resp = await fetch('/api/field/photos/upload', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + item.token },
          body: formData,
        });
        if (resp.ok) {
          await deleteItem('pending_photos', item.id);
        }
      } catch (_) {}
    }
    const clients = await self.clients.matchAll();
    clients.forEach(c => c.postMessage({ type: 'sync-complete', store: 'photos' }));
  } catch (err) {
    console.error('[SW] syncPhotos error:', err);
  }
}

async function syncReports() {
  try {
    const items = await getAll('pending_reports');
    for (const item of items) {
      try {
        const resp = await fetch('/api/field/reports', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + item.token,
          },
          body: JSON.stringify(item.body),
        });
        if (resp.ok || resp.status === 409) {
          await deleteItem('pending_reports', item.id);
        }
      } catch (_) {}
    }
    const clients = await self.clients.matchAll();
    clients.forEach(c => c.postMessage({ type: 'sync-complete', store: 'reports' }));
  } catch (err) {
    console.error('[SW] syncReports error:', err);
  }
}

// ═══════════════════════════════════════════════════════════════
// PUSH NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════
self.addEventListener('push', (event) => {
  let data = { title: 'ASGARD Field', body: 'Новое уведомление' };
  try {
    data = event.data.json();
  } catch (_) {
    data.body = event.data ? event.data.text() : data.body;
  }

  const options = {
    body: data.body || data.message || '',
    icon: '/assets/img/logo.png',
    badge: '/assets/img/icon-192.png',
    vibrate: [100, 50, 100],
    tag: data.tag || 'field-notification',
    data: { url: data.url || '/field/home' },
    actions: data.actions || [],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'ASGARD Field', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/field/home';

  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      // Focus existing window if open
      for (const client of clients) {
        if (client.url.includes('/field/') && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Open new window
      return self.clients.openWindow(url);
    })
  );
});

// ═══════════════════════════════════════════════════════════════
// MESSAGE — version check
// ═══════════════════════════════════════════════════════════════
self.addEventListener('message', (event) => {
  if (event.data === 'GET_VERSION') {
    event.ports[0].postMessage({ version: SHELL_VERSION });
  }
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
