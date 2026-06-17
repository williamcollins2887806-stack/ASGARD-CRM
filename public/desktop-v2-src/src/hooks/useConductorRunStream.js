/**
 * useConductorRunStream — singleton per-runId SSE для War Room Conductor'а.
 *
 * Backend endpoint: GET /api/mimir/conductor/events?run_id=<id>&since_event_id=<n>
 * (а не /api/sse/stream — поэтому отдельный канал, НЕ через useGlobalSSE).
 *
 * Архитектура:
 *   • Singleton per (runId, token) через window.__asgardConductorStreams[runId].
 *     Re-mounts хука для того же runId переиспользуют активное соединение.
 *   • Auto-reconnect 3с после error, продолжение с lastEventId (no-gap reasoning).
 *   • При logout (closeGlobalSSE → closeAllConductorStreams) закрываются ВСЕ
 *     активные run-streams.
 *   • События приходят как named-events 'message' (default), 'complete', 'error'.
 *     Хук вызывает соответствующие handlers; handler сам решает что делать.
 *
 * Использование:
 *   const stop = openConductorRunStream(runId, sinceEventId, {
 *     onMessage(event), onComplete({status}), onError()
 *   });
 *   // stop() при unmount компонента
 */

if (typeof window !== 'undefined' && !window.__asgardConductorStreams) {
  window.__asgardConductorStreams = {};
}

function readToken() {
  try { return localStorage.getItem('asgard_token') || ''; } catch { return ''; }
}

export function openConductorRunStream(runId, sinceEventId, handlers = {}) {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') return () => {};
  if (!runId) return () => {};

  // Если уже есть активный stream для этого runId — добавляем нового слушателя.
  let entry = window.__asgardConductorStreams[runId];
  if (entry && entry.es) {
    entry.subscribers.push(handlers);
    return () => unsubscribe(runId, handlers);
  }

  entry = {
    es: null,
    subscribers: [handlers],
    lastEventId: Number(sinceEventId) || 0,
    stopped: false,
    reconnectTimer: null,
  };
  window.__asgardConductorStreams[runId] = entry;

  const connect = () => {
    if (entry.stopped) return;
    const token = readToken();
    if (!token) return;
    const url = `/api/mimir/conductor/events?run_id=${encodeURIComponent(runId)}&since_event_id=${entry.lastEventId}&token=${encodeURIComponent(token)}`;
    let es;
    try { es = new EventSource(url); } catch { return; }
    entry.es = es;

    es.onmessage = (ev) => {
      let event;
      try { event = JSON.parse(ev.data); } catch { return; }
      if (event?.id) entry.lastEventId = Number(event.id);
      entry.subscribers.forEach((h) => {
        try { h.onMessage && h.onMessage(event); } catch { /* noop */ }
      });
    };

    es.addEventListener('complete', (ev) => {
      let data = {};
      try { data = JSON.parse(ev.data); } catch { /* noop */ }
      entry.subscribers.forEach((h) => {
        try { h.onComplete && h.onComplete(data); } catch { /* noop */ }
      });
      try { es.close(); } catch { /* noop */ }
      entry.es = null;
      // run закончился — больше не реконнектим
      entry.stopped = true;
    });

    es.onerror = () => {
      try { es.close(); } catch { /* noop */ }
      entry.es = null;
      entry.subscribers.forEach((h) => {
        try { h.onError && h.onError(); } catch { /* noop */ }
      });
      if (entry.stopped) return;
      if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
      entry.reconnectTimer = setTimeout(() => {
        entry.reconnectTimer = null;
        connect();
      }, 3000);
    };
  };

  connect();
  return () => unsubscribe(runId, handlers);
}

function unsubscribe(runId, handlers) {
  const entry = window.__asgardConductorStreams && window.__asgardConductorStreams[runId];
  if (!entry) return;
  entry.subscribers = entry.subscribers.filter((h) => h !== handlers);
  if (entry.subscribers.length === 0) {
    closeConductorRunStream(runId);
  }
}

export function closeConductorRunStream(runId) {
  if (typeof window === 'undefined') return;
  const entry = window.__asgardConductorStreams && window.__asgardConductorStreams[runId];
  if (!entry) return;
  entry.stopped = true;
  if (entry.reconnectTimer) { clearTimeout(entry.reconnectTimer); entry.reconnectTimer = null; }
  if (entry.es) { try { entry.es.close(); } catch { /* noop */ } entry.es = null; }
  delete window.__asgardConductorStreams[runId];
}

export function closeAllConductorStreams() {
  if (typeof window === 'undefined' || !window.__asgardConductorStreams) return;
  Object.keys(window.__asgardConductorStreams).forEach(closeConductorRunStream);
}
