/**
 * Vanilla desktop client error reporter → POST /api/client-errors
 * Подключается из index.html до app.js. Не репортит 401/403 и ChunkLoadError.
 */
(function () {
  'use strict';
  if (window.__asgardClientErrorsInstalled) return;
  window.__asgardClientErrorsInstalled = true;

  var ENDPOINT = '/api/client-errors';
  var SOURCE = 'vanilla';

  function isChunkLoadError(msg) {
    return /ChunkLoadError|Loading chunk [\d]+ failed|Failed to fetch dynamically imported module/i.test(String(msg || ''));
  }

  function pickToken() {
    try {
      return localStorage.getItem('asgard_token') || localStorage.getItem('field_token') || null;
    } catch (e) {
      return null;
    }
  }

  function report(kind, message, stack, extra) {
    try {
      if (isChunkLoadError(message) || isChunkLoadError(stack)) return;
      var body = {
        source: SOURCE,
        kind: kind || 'js',
        message: String(message || 'client error').slice(0, 500),
        stack: stack ? String(stack).slice(0, 2000) : undefined,
        url: String(window.location.href || '').slice(0, 300),
        ua: String(navigator.userAgent || '').slice(0, 300),
      };
      if (extra && extra.endpoint) body.endpoint = String(extra.endpoint).slice(0, 300);
      if (extra && typeof extra.status === 'number') {
        if (extra.status === 401 || extra.status === 403) return;
        body.status = extra.status;
      }
      var json = JSON.stringify(body);
      var token = pickToken();
      if (navigator.sendBeacon && !token) {
        var blob = new Blob([json], { type: 'application/json' });
        if (navigator.sendBeacon(ENDPOINT, blob)) return;
      }
      fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
        },
        body: json,
        keepalive: true,
      }).catch(function () {});
    } catch (e) { /* never throw */ }
  }

  window.ASGARD_REPORT_CLIENT_ERROR = report;

  window.addEventListener('error', function (event) {
    try {
      var err = event && event.error;
      report('js', (err && err.message) || (event && event.message) || 'window.error', err && err.stack);
    } catch (e) { /* noop */ }
  });

  window.addEventListener('unhandledrejection', function (event) {
    try {
      var reason = event && event.reason;
      var message = reason instanceof Error
        ? reason.message
        : (typeof reason === 'string' ? reason : 'unhandledrejection');
      var stack = reason instanceof Error ? reason.stack : undefined;
      report('rejection', message, stack);
    } catch (e) { /* noop */ }
  });
})();
