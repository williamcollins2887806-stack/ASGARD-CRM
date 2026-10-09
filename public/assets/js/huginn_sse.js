/**
 * Huginn SSE — reconnect + catch-up with offline/visibility backoff.
 * Ting must not depend on this stream for join.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'huginn_last_event_id';
  const handlers = new Map();
  let es = null;
  let pollTimer = null;
  let pingTimer = null;
  let failStreak = 0;
  let paused = false;
  let tokenFn = () => localStorage.getItem('asgard_token') || '';

  function getLastId() {
    const n = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
    return Number.isFinite(n) ? n : 0;
  }

  function setLastId(id) {
    const n = Number(id);
    if (!Number.isFinite(n) || n <= getLastId()) return;
    localStorage.setItem(STORAGE_KEY, String(n));
  }

  function emit(event, data) {
    if (data && data._eid) setLastId(data._eid);
    const set = handlers.get(event);
    if (!set) return;
    set.forEach((fn) => {
      try { fn(data); } catch (e) { console.error('[huginn_sse]', event, e); }
    });
    const any = handlers.get('*');
    if (any) any.forEach((fn) => { try { fn(event, data); } catch (_) {} });
  }

  function shouldSkipNetwork() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    return paused;
  }

  /** Ping (presence) should not run while the tab is hidden — last_seen_at then
   *  ages out honestly. The SSE socket itself must stay open: closing it on hide
   *  broke instant delivery (messages only arrived on return/F5). */
  function shouldSkipPing() {
    if (shouldSkipNetwork()) return true;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return true;
    return false;
  }

  function noteFail() {
    failStreak += 1;
    // Safety catch-up failed — the socket is the delivery channel; just retry
    // the catch-up on the next safety tick. No long backoff (it delayed nothing
    // critical, but skewed reconnect timing).
  }

  function noteOk() {
    failStreak = 0;
  }

  async function catchUp() {
    if (shouldSkipNetwork()) return;
    const token = tokenFn();
    if (!token) return;
    const since = getLastId();
    try {
      const res = await fetch('/api/chat-groups/events?since=' + since, {
        headers: { Authorization: 'Bearer ' + token }
      });
      if (!res.ok) {
        noteFail();
        return;
      }
      noteOk();
      const body = await res.json();
      const events = body.events || [];
      // Events already emit → HuginnDock.onLiveEvent → ingestMessage / patch.
      // Do NOT full-refresh open chat (was causing lag every poll).
      for (const ev of events) {
        setLastId(ev.id);
        const payload = Object.assign({}, ev.data || {}, {
          _eid: ev.id,
          chat_id: ev.chat_id != null ? ev.chat_id : (ev.data && ev.data.chat_id)
        });
        emit(ev.event, payload);
      }
    } catch (e) {
      noteFail();
      if (failStreak <= 2 || failStreak % 4 === 0) {
        console.warn('[huginn_sse] catchUp', e.message);
      }
    }
  }

  function closeSource() {
    try { if (es) { es.close(); es = null; } } catch (_) {}
    try { if (global._asgardSSE) { global._asgardSSE.close(); global._asgardSSE = null; } } catch (_) {}
  }

  function bindSource(source) {
    if (!source || source === es) return;
    es = source;
    const wire = (event) => {
      source.addEventListener(event, (e) => {
        let data = {};
        try { data = JSON.parse(e.data || '{}'); } catch (_) {}
        emit(event, data);
      });
    };
    ['chat:new_message', 'chat:read', 'chat:message_edited', 'chat:message_deleted',
      'chat:reaction', 'chat:typing', 'chat:transcript_ready', 'presence:online',
      'presence:offline', 'huginn:invite_accepted', 'connected',
      'chat:cleared', 'chat:deleted',
      'call:incoming', 'call:accepted', 'call:declined', 'call:ended'].forEach(wire);

    source.addEventListener('error', () => {
      // CLOSED (2) — recreate fast. CONNECTING (0) — the browser retries itself.
      if (source.readyState === 2) { if (es === source) es = null; scheduleReconnect(); return; }
      scheduleReconnect();
    });
    catchUp();
  }

  function ensureSource() {
    if (shouldSkipNetwork()) return;
    if (global._asgardSSE) {
      bindSource(global._asgardSSE);
      return;
    }
    const token = tokenFn();
    if (!token) return;
    if (es && es.readyState !== 2) return;
    try {
      const url = '/api/sse/stream?token=' + encodeURIComponent(token);
      const source = new EventSource(url);
      global._asgardSSE = source;
      bindSource(source);
    } catch (e) {
      scheduleReconnect();
    }
  }

  /** Fast socket reconnect (instant delivery) — a dropped EventSource must be
   *  restored in well under a second, not after a 15–120s backoff. */
  let reconnectTimer = null;
  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (shouldSkipNetwork()) return;
      if (es && es.readyState === 2) { es = null; }
      try { if (global._asgardSSE && global._asgardSSE.readyState === 2) global._asgardSSE = null; } catch (_) {}
      ensureSource();
      catchUp();
    }, 800);
  }

  /** Safety catch-up cadence: the socket is the primary channel, this only
   *  heals rare missed events. Not an instant-delivery transport. */
  const SAFETY_POLL_MS = 30000;
  function schedulePoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (shouldSkipNetwork()) return;
      ensureSource();
      catchUp();
    }, SAFETY_POLL_MS);
  }

  function on(event, fn) {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event).add(fn);
    return () => handlers.get(event).delete(fn);
  }

  function onVisibility() {
    if (document.visibilityState === 'visible' && navigator.onLine !== false) {
      paused = false;
      // Reconnect + immediate catch-up: if the socket dropped while hidden we
      // must not wait for a poll tick to deliver missed messages.
      ensureSource();
      catchUp();
    }
    // Hidden: keep the socket OPEN. Only the presence ping is skipped (see
    // shouldSkipPing) so `last_seen_at` still ages out honestly.
  }

  function onOnline() {
    paused = false;
    failStreak = 0;
    scheduleReconnect();
    schedulePoll();
    catchUp();
  }

  function onOffline() {
    paused = true;
    closeSource();
  }

  function start(opts) {
    if (opts && typeof opts.getToken === 'function') tokenFn = opts.getToken;
    paused = false;
    ensureSource();
    schedulePoll();
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(async () => {
      if (shouldSkipPing()) return;
      const token = tokenFn();
      if (!token) return;
      try {
        await fetch('/api/chat-groups/presence/ping', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token }
        });
      } catch (_) { noteFail(); }
    }, 25000);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    catchUp();
  }

  function stop() {
    if (pollTimer) clearInterval(pollTimer);
    if (pingTimer) clearInterval(pingTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    pollTimer = null;
    pingTimer = null;
    reconnectTimer = null;
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  }

  global.HuginnSSE = { start, stop, on, catchUp, getLastId, ensureSource };
})(typeof window !== 'undefined' ? window : global);
