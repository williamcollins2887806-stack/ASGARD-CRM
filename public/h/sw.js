/* Huginn PWA SW — network-first (fresh shell wins), cache as offline fallback */
const SHELL_VERSION = '20.28.166';
const CACHE = 'huginn-h-' + SHELL_VERSION;
const SHELL = [
  '/h/', '/h/app.js', '/h/manifest.webmanifest',
  '/assets/css/design-tokens.css', '/assets/css/huginn_dock.css',
  '/assets/js/huginn_icons.js', '/assets/js/huginn_sse.js',
  '/assets/js/huginn_dock.js', '/assets/js/huginn_calls.js'
];

self.addEventListener('install', (e) => {
  // One bad URL must not fail the whole install (addAll rejects atomically).
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', (e) => {
  // Drop every older huginn cache; a stale JS bundle here showed an old UI forever.
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k.indexOf('huginn-h-') === 0).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return;
  // Network-first: a redeploy must reach the phone without manual cache clear.
  // On network failure fall back to the cached copy (offline still works).
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res && res.ok && url.origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});

// ═══════════════════════════════════════════════════════════════
// PUSH — same payload contract as the root SW (Huginn chat + 1:1 calls)
// ═══════════════════════════════════════════════════════════════
self.addEventListener('push', function (event) {
  if (!event.data) return;
  var payload;
  try { payload = event.data.json(); } catch (e) { payload = { title: 'Хугинн', body: event.data.text() }; }

  var options = {
    body: payload.body || '',
    icon: payload.icon || '/assets/img/icon-192.png',
    badge: payload.badge || '/assets/img/icon-96.png',
    tag: payload.tag || 'huginn-notification',
    // Every message must alert (sound/vibration). With a shared tag the OS
    // silently replaces the previous notification, so renotify is required.
    renotify: true,
    silent: false,
    data: payload.data || {
      url: payload.url || '/h/',
      type: payload.type || null,
      call_id: payload.call_id || null,
      kind: payload.kind || null
    },
    vibrate: payload.tag && String(payload.tag).indexOf('call-') === 0
      ? [300, 120, 300, 120, 300]
      : [200, 100, 200],
    requireInteraction: payload.requireInteraction || !!(payload.actions && payload.actions.length),
    actions: (payload.actions || []).slice(0, 2)
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Хугинн', options).then(function () {
      var badgeCount = payload.badge_count;
      if (badgeCount !== undefined && 'setAppBadge' in navigator) {
        return badgeCount > 0 ? navigator.setAppBadge(badgeCount) : navigator.clearAppBadge();
      }
      return null;
    })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var action = event.action;
  var data = event.notification.data || {};

  // Huginn 1:1 call: accept / decline via the /h/ deep link.
  if (data && data.type === 'call' && data.call_id) {
    var callTarget = '/h/?call=' + encodeURIComponent(data.call_id)
      + (action ? ('&call_action=' + encodeURIComponent(action)) : '');
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
        for (var i = 0; i < list.length; i++) {
          if (new URL(list[i].url).origin === location.origin) {
            list[i].focus();
            list[i].postMessage({ type: 'NOTIFICATION_CLICK', url: callTarget, action: action, data: data });
            return list[i];
          }
        }
        return clients.openWindow(callTarget);
      })
    );
    return;
  }

  var targetUrl = data.url || '/h/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (new URL(list[i].url).origin === location.origin) {
          list[i].focus();
          list[i].postMessage({ type: 'NOTIFICATION_CLICK', url: targetUrl, action: action, data: data });
          return list[i];
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener('pushsubscriptionchange', function (event) {
  // Best-effort: notify open clients so they re-subscribe (they hold the token).
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      list.forEach(function (c) { try { c.postMessage({ type: 'PUSH_RESUBSCRIBE' }); } catch (_) {} });
    })
  );
});
