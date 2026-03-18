// ASGARD CRM Service Worker
// Shell caching + Push Notifications + Offline Support + Background Sync
// Session 15: PWA + Push Actions + Badge + Offline

const SHELL_VERSION = '17.10.0';
const CACHE_NAME = `asgard-crm-shell-${SHELL_VERSION}`;
const API_CACHE_NAME = 'asgard-crm-api-v1';

// ═══════════════════════════════════════════════════════════════
// SHELL ASSETS — all files needed for offline shell
// ═══════════════════════════════════════════════════════════════
const SHELL_ASSETS = [
  // index.html НЕ кэшируем при установке — сервер отдаёт разный HTML для mobile/desktop
  // При навигации он кэшируется автоматически через networkFirstWithOffline
  './offline.html',
  './manifest.json?v=17.0.1',
  // ── CSS ──
  './assets/css/design-tokens.css?v=17.0.1',
  './assets/css/components.css?v=17.0.1',
  './assets/css/layout.css?v=17.0.1',
  './assets/css/app.css?v=17.0.1',
  './assets/css/responsive.css?v=17.0.1',
  './assets/css/mobile-shell.css?v=17.10.0',
  './assets/css/huginn.css?v=17.10.0',
  // ── Core JS ──
  './assets/js/ui.js?v=17.0.1',
  './assets/js/sla.js?v=17.0.1',
  './assets/js/funnel.js?v=17.0.1',
  './assets/js/diag.js?v=17.0.1',
  './assets/js/push-notifications.js?v=17.0.1',
  './assets/js/webauthn.js?v=17.0.1',
  // ── Images ──
  './assets/img/logo.png',
  './assets/img/asgard_logo.png',
  './assets/img/asgard_emblem.png',
  // ── Mobile v3: Core ──
  './assets/js/mobile_v3/approval.js?v=17.0.1',
  './assets/js/mobile_v3/auth.js?v=17.0.1',
  './assets/js/mobile_v3/components.js?v=17.0.1',
  './assets/js/mobile_v3/core.js?v=17.10.0',
  './assets/js/mobile_v3/ds.js?v=17.0.1',
  './assets/js/mobile_v3/test.js?v=17.0.1',
  './assets/js/mobile_v3/router.js?v=17.0.1',
  // ── Mobile v3: Pages (51 files) ──
  './assets/js/mobile_v3/pages/acts.js?v=17.0.1',
  './assets/js/mobile_v3/pages/alerts.js?v=17.0.1',
  './assets/js/mobile_v3/pages/all_estimates.js?v=17.0.1',
  './assets/js/mobile_v3/pages/all_works.js?v=17.0.1',
  './assets/js/mobile_v3/pages/approval_payment.js?v=17.0.1',
  './assets/js/mobile_v3/pages/approvals.js?v=17.0.1',
  './assets/js/mobile_v3/pages/backup.js?v=17.0.1',
  './assets/js/mobile_v3/pages/cash.js?v=17.0.1',
  './assets/js/mobile_v3/pages/cash_admin.js?v=17.0.1',
  './assets/js/mobile_v3/pages/contracts.js?v=17.0.1',
  './assets/js/mobile_v3/pages/correspondence.js?v=17.0.1',
  './assets/js/mobile_v3/pages/customers.js?v=17.0.1',
  './assets/js/mobile_v3/pages/dashboard.js?v=17.0.1',
  './assets/js/mobile_v3/pages/diag.js?v=17.0.1',
  './assets/js/mobile_v3/pages/finances.js?v=17.0.1',
  './assets/js/mobile_v3/pages/funnel.js?v=17.0.1',
  './assets/js/mobile_v3/pages/gantt.js?v=17.0.1',
  './assets/js/mobile_v3/pages/hr_requests.js?v=17.0.1',
  './assets/js/mobile_v3/pages/integrations.js?v=17.0.1',
  './assets/js/mobile_v3/pages/invoices.js?v=17.0.1',
  './assets/js/mobile_v3/pages/meetings.js?v=17.0.1',
  './assets/js/mobile_v3/pages/messenger.js?v=17.8.0',
  './assets/js/mobile_v3/pages/my_equipment.js?v=17.0.1',
  './assets/js/mobile_v3/pages/my_mail.js?v=17.0.1',
  './assets/js/mobile_v3/pages/office_expenses.js?v=17.0.1',
  './assets/js/mobile_v3/pages/pass_requests.js?v=17.0.1',
  './assets/js/mobile_v3/pages/payroll.js?v=17.0.1',
  './assets/js/mobile_v3/pages/permits.js?v=17.0.1',
  './assets/js/mobile_v3/pages/personnel.js?v=17.0.1',
  './assets/js/mobile_v3/pages/pm_calcs.js?v=17.0.1',
  './assets/js/mobile_v3/pages/pm_works.js?v=17.0.1',
  './assets/js/mobile_v3/pages/pre_tenders.js?v=17.0.1',
  './assets/js/mobile_v3/pages/proc_requests.js?v=17.0.1',
  './assets/js/mobile_v3/pages/profile.js?v=17.0.1',
  './assets/js/mobile_v3/pages/proxies.js?v=17.0.1',
  './assets/js/mobile_v3/pages/seals.js?v=17.0.1',
  './assets/js/mobile_v3/pages/settings.js?v=17.0.1',
  './assets/js/mobile_v3/pages/tasks.js?v=17.10.0',
  './assets/js/mobile_v3/pages/tasks_admin.js?v=17.10.0',
  './assets/js/mobile_v3/pages/telegram.js?v=17.0.1',
  './assets/js/mobile_v3/pages/tenders.js?v=17.0.1',
  './assets/js/mobile_v3/pages/tmc_requests.js?v=17.0.1',
  './assets/js/mobile_v3/pages/training.js?v=17.0.1',
  './assets/js/mobile_v3/pages/travel.js?v=17.0.1',
  './assets/js/mobile_v3/pages/warehouse.js?v=17.0.1',
  './assets/js/mobile_v3/pages/workers_schedule.js?v=17.0.1',
  // ── Mobile v3: Widgets (27 files) ──
  './assets/js/mobile_v3/widgets/approvals.js?v=17.0.1',
  './assets/js/mobile_v3/widgets/bank_summary.js?v=17.0.1',
  './assets/js/mobile_v3/widgets/birthdays.js?v=17.0.1',
  './assets/js/mobile_v3/widgets/calendar.js?v=17.0.1',
  './assets/js/mobile_v3/widgets/cash_balance.js?v=17.0.1',
  './assets/js/mobile_v3/widgets/equipment_alerts.js?v=17.0.1',
  './assets/js/mobile_v3/widgets/equipment_value.js?v=17.0.1',
  './assets/js/mobile_v3/widgets/gantt_mini.js?v=17.0.1',
  './assets/js/mobile_v3/widgets/kpi_summary.js?v=17.0.1',
  './assets/js/mobile_v3/widgets/money_summary.js?v=17.0.1',
  './assets/js/mobile_v3/widgets/my_cash_balance.js?v=17.0.1',
  './assets/js/mobile_v3/widgets/my_mail.js?v=17.0.1',
  './assets/js/mobile_v3/widgets/my_works.js?v=17.0.1',
  './assets/js/mobile_v3/widgets/notifications.js?v=17.0.1',
  './assets/js/mobile_v3/widgets/overdue_works.js?v=17.0.1',
  './assets/js/mobile_v3/widgets/payroll_pending.js?v=17.0.1',
  './assets/js/mobile_v3/widgets/permits_expiry.js?v=17.0.1',
  './assets/js/mobile_v3/widgets/platform_alerts.js?v=17.0.1',
  './assets/js/mobile_v3/widgets/pre_tenders.js?v=17.0.1',
  './assets/js/mobile_v3/widgets/quick_actions.js?v=17.0.1',
  './assets/js/mobile_v3/widgets/receipt_scanner.js?v=17.0.1',
  './assets/js/mobile_v3/widgets/team_workload.js?v=17.0.1',
  './assets/js/mobile_v3/widgets/telephony.js?v=17.0.1',
  './assets/js/mobile_v3/widgets/tender_dynamics.js?v=17.0.1',
  './assets/js/mobile_v3/widgets/tenders_funnel.js?v=17.0.1',
  './assets/js/mobile_v3/widgets/todo.js?v=17.0.1',
  './assets/js/mobile_v3/widgets/welcome.js?v=17.0.1'
];

// ═══════════════════════════════════════════════════════════════
// INSTALL — cache shell + offline page
// ═══════════════════════════════════════════════════════════════
self.addEventListener('install', (event) => {
  console.log('[SW] Installing', CACHE_NAME);
  self.skipWaiting(); // активируем новый SW сразу, не ждём закрытия вкладок
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        // Fetch with cache:'reload' to bypass browser HTTP cache
        var requests = SHELL_ASSETS.map(function(url) {
          return fetch(new Request(url, { cache: 'reload' }))
            .then(function(resp) {
              if (resp && resp.ok) return cache.put(url, resp);
            })
            .catch(function(err) { console.warn('[SW] Failed to cache:', url, err); });
        });
        return Promise.all(requests);
      })
      .then(() => console.log('[SW] Shell cached (bypass HTTP cache)'))
      .catch((err) => console.error('[SW] Install failed:', err))
  );
});

// ═══════════════════════════════════════════════════════════════
// ACTIVATE — clean old caches
// ═══════════════════════════════════════════════════════════════
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating', CACHE_NAME);
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => {
            if (name.startsWith('asgard-crm-shell-') && name !== CACHE_NAME) return true;
            if (name.startsWith('asgard-crm-api-') && name !== API_CACHE_NAME) return true;
            return false;
          })
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      ))
      .then(() => self.clients.claim())
  );
});

// ═══════════════════════════════════════════════════════════════
// FETCH — routing strategies
// ═══════════════════════════════════════════════════════════════
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== location.origin) return;

  // ── API routing ──
  if (url.pathname.startsWith('/api/')) {
    // POST approval actions → Network Only + queue for Background Sync
    if (request.method === 'POST' && url.pathname.match(/^\/api\/approval\//)) {
      event.respondWith(networkOnlyWithQueue(request, url));
      return;
    }
    if (request.method !== 'GET') return;

    // GET /api/push/* → Network Only (always fresh)
    if (url.pathname.startsWith('/api/push/')) {
      event.respondWith(networkOnly(request));
      return;
    }

    // Other GET API → Network First with API cache
    event.respondWith(networkFirstAPI(request));
    return;
  }

  // ── Static / HTML routing ──
  if (request.method !== 'GET') return;

  var acceptHeader = request.headers.get('accept') || '';
  var isNavigation = request.mode === 'navigate';

  if (isNavigation || acceptHeader.includes('text/html') || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(networkFirstWithOffline(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

// ── Network Only ──
async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch (err) {
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503, headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ── Network First for API (cache GET results) ──
async function networkFirstAPI(request) {
  try {
    var response = await fetch(request);
    if (response && response.ok) {
      var cache = await caches.open(API_CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    var cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'offline', cached: false }), {
      status: 503, headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ── Network First for HTML with offline.html fallback ──
async function networkFirstWithOffline(request) {
  try {
    var response = await fetch(request);
    if (response && response.ok) {
      var cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    var cached = await caches.match(request);
    if (cached) return cached;
    var shell = await caches.match('./index.html');
    if (shell) return shell;
    var offline = await caches.match('./offline.html');
    if (offline) return offline;
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

// ── Stale While Revalidate (for static assets) ──
async function staleWhileRevalidate(request) {
  var cache = await caches.open(CACHE_NAME);
  var cached = await cache.match(request);
  var fetchPromise = fetch(request)
    .then(function(response) {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(function() { return null; });

  if (cached) {
    fetchPromise.catch(function() {});
    return cached;
  }
  var response = await fetchPromise;
  if (response) return response;
  var offline = await caches.match('./offline.html');
  if (offline) return offline;
  return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
}

// ── Network Only with Background Sync queue ──
async function networkOnlyWithQueue(request, url) {
  try {
    return await fetch(request.clone());
  } catch (err) {
    try {
      var body = await request.clone().text();
      var headers = {};
      for (var pair of request.headers.entries()) {
        if (pair[0] === 'authorization' || pair[0] === 'content-type') headers[pair[0]] = pair[1];
      }
      await saveToOfflineQueue({
        url: url.pathname,
        method: request.method,
        headers: headers,
        body: body,
        timestamp: Date.now()
      });
      if (self.registration.sync) {
        await self.registration.sync.register('approval-queue');
      }
      var allClients = await clients.matchAll({ type: 'window' });
      for (var i = 0; i < allClients.length; i++) {
        allClients[i].postMessage({ type: 'ACTION_QUEUED', url: url.pathname });
      }
    } catch (queueErr) {
      console.error('[SW] Failed to queue action:', queueErr);
    }
    return new Response(JSON.stringify({ queued: true, message: 'Действие будет выполнено при восстановлении связи' }), {
      status: 202, headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// IndexedDB helpers for offline queue
// ═══════════════════════════════════════════════════════════════
function openOfflineDB() {
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open('asgard-offline-queue', 1);
    req.onupgradeneeded = function(e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains('actions')) {
        db.createObjectStore('actions', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = function() { resolve(req.result); };
    req.onerror = function() { reject(req.error); };
  });
}

async function saveToOfflineQueue(item) {
  var db = await openOfflineDB();
  return new Promise(function(resolve, reject) {
    var tx = db.transaction('actions', 'readwrite');
    tx.objectStore('actions').add(item);
    tx.oncomplete = function() { db.close(); resolve(); };
    tx.onerror = function() { db.close(); reject(tx.error); };
  });
}

async function getAllFromQueue() {
  var db = await openOfflineDB();
  return new Promise(function(resolve, reject) {
    var tx = db.transaction('actions', 'readonly');
    var req = tx.objectStore('actions').getAll();
    req.onsuccess = function() { db.close(); resolve(req.result); };
    req.onerror = function() { db.close(); reject(req.error); };
  });
}

async function deleteFromQueue(id) {
  var db = await openOfflineDB();
  return new Promise(function(resolve, reject) {
    var tx = db.transaction('actions', 'readwrite');
    tx.objectStore('actions').delete(id);
    tx.oncomplete = function() { db.close(); resolve(); };
    tx.onerror = function() { db.close(); reject(tx.error); };
  });
}

// ═══════════════════════════════════════════════════════════════
// BACKGROUND SYNC — process queued approval actions
// ═══════════════════════════════════════════════════════════════
self.addEventListener('sync', function(event) {
  if (event.tag === 'approval-queue') {
    event.waitUntil(processApprovalQueue());
  }
});

async function processApprovalQueue() {
  var items = await getAllFromQueue();
  var processed = 0;
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    try {
      var resp = await fetch(item.url, {
        method: item.method || 'POST',
        headers: item.headers || {},
        body: item.body || null
      });
      if (resp.ok || resp.status === 400 || resp.status === 403) {
        await deleteFromQueue(item.id);
        processed++;
      }
    } catch (e) {
      console.warn('[SW] Sync failed for item', item.id, e.message);
    }
  }
  if (processed > 0) {
    var allClients = await clients.matchAll({ type: 'window' });
    for (var j = 0; j < allClients.length; j++) {
      allClients[j].postMessage({ type: 'SYNC_COMPLETE', processed: processed });
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// MESSAGES (skipWaiting, getVersion)
// ═══════════════════════════════════════════════════════════════
self.addEventListener('message', function(event) {
  if (event.data === 'skipWaiting' || (event.data && event.data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
    return;
  }
  if (event.data === 'getVersion' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: CACHE_NAME, shellVersion: SHELL_VERSION });
  }
});

// ═══════════════════════════════════════════════════════════════
// PUSH — show notification with actions + badge
// ═══════════════════════════════════════════════════════════════
self.addEventListener('push', function(event) {
  if (!event.data) return;

  var payload;
  try {
    payload = event.data.json();
  } catch (e) {
    payload = { title: 'АСГАРД CRM', body: event.data.text() };
  }

  var options = {
    body: payload.body || '',
    icon: payload.icon || './assets/img/icon-192.png',
    badge: payload.badge || './assets/img/icon-96.png',
    tag: payload.tag || 'asgard-notification',
    data: payload.data || { url: payload.url || '/' },
    vibrate: [200, 100, 200],
    requireInteraction: !!(payload.actions && payload.actions.length),
    actions: (payload.actions || []).slice(0, 2)
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || 'АСГАРД CRM', options)
      .then(function() {
        var badgeCount = payload.badge_count !== undefined
          ? payload.badge_count
          : (payload.data && payload.data.badge_count);
        if (badgeCount !== undefined && 'setAppBadge' in navigator) {
          return badgeCount > 0
            ? navigator.setAppBadge(badgeCount)
            : navigator.clearAppBadge();
        }
        return null;
      })
  );
});

// ═══════════════════════════════════════════════════════════════
// NOTIFICATION CLICK — Variant B: open app with action params
// ═══════════════════════════════════════════════════════════════
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  var action = event.action;
  var data = event.notification.data || {};

  // Build target URL with action params
  var targetUrl = data.url || '/';
  if (action && data.entityType && data.entityId) {
    var sep = targetUrl.includes('?') ? '&' : '?';
    targetUrl += sep + 'action=' + encodeURIComponent(action)
      + '&type=' + encodeURIComponent(data.entityType)
      + '&id=' + encodeURIComponent(data.entityId);
    if (data.action_type) {
      targetUrl += '&action_type=' + encodeURIComponent(data.action_type);
    }
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(function(clientList) {
        for (var i = 0; i < clientList.length; i++) {
          if (new URL(clientList[i].url).origin === location.origin) {
            clientList[i].focus();
            clientList[i].postMessage({ type: 'NOTIFICATION_CLICK', url: targetUrl, action: action, data: data });
            return clientList[i];
          }
        }
        return clients.openWindow(targetUrl);
      })
  );
});

// ═══════════════════════════════════════════════════════════════
// PUSH SUBSCRIPTION CHANGE — auto-resubscribe
// ═══════════════════════════════════════════════════════════════
self.addEventListener('pushsubscriptionchange', function(event) {
  event.waitUntil(
    self.registration.pushManager.subscribe(event.oldSubscription.options)
      .then(function(newSub) {
        return fetch('/api/push/resubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            old_endpoint: event.oldSubscription ? event.oldSubscription.endpoint : null,
            new_subscription: newSub.toJSON()
          })
        });
      })
      .catch(function(err) { console.error('[SW] Resubscribe failed:', err); })
  );
});

console.log('[SW] Service Worker loaded:', CACHE_NAME);
