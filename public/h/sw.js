/* Huginn PWA SW — cache shell only, network-first for API */
const CACHE = 'huginn-h-v1';
const SHELL = ['/h/', '/h/app.js', '/h/manifest.webmanifest', '/assets/css/huginn_dock.css', '/assets/js/huginn_sse.js', '/assets/js/huginn_dock.js', '/assets/js/huginn_ting.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
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
  // Without a token here the CRM cannot authorise a re-subscribe; the client
  // re-creates the subscription on next app start instead.
  event.waitUntil(Promise.resolve());
});
