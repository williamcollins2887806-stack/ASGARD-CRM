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
  let backoffMs = 15000;
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
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return true;
    return paused;
  }

  function noteFail() {
    failStreak += 1;
    backoffMs = Math.min(120000, Math.round(15000 * Math.pow(1.6, Math.min(failStreak, 6))));
    schedulePoll();
  }

  function noteOk() {
    failStreak = 0;
    backoffMs = 15000;
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
      let hadChatMsg = false;
      for (const ev of events) {
        setLastId(ev.id);
        const payload = Object.assign({}, ev.data || {}, {
          _eid: ev.id,
          chat_id: ev.chat_id != null ? ev.chat_id : (ev.data && ev.data.chat_id)
        });
        emit(ev.event, payload);
        if (ev.event === 'chat:new_message') hadChatMsg = true;
      }
      if (hadChatMsg && global.HuginnDock && typeof global.HuginnDock.refreshOpenChat === 'function') {
        try { await global.HuginnDock.refreshOpenChat(); } catch (_) {}
      }
    } catch (e) {
      noteFail();
      if (failStreak <= 2 || failStreak % 4 === 0) {
        console.warn('[huginn_sse] catchUp', e.message, 'backoff=' + backoffMs + 'ms');
      }
    }
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
      'presence:offline', 'huginn:invite_accepted', 'connected'].forEach(wire);

    source.addEventListener('error', () => { noteFail(); });
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
      noteFail();
    }
  }

  function schedulePoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (shouldSkipNetwork()) return;
      ensureSource();
      catchUp();
    }, backoffMs);
  }

  function on(event, fn) {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event).add(fn);
    return () => handlers.get(event).delete(fn);
  }

  function onVisibility() {
    if (document.visibilityState === 'visible' && navigator.onLine !== false) {
      paused = false;
      catchUp();
    }
  }

  function onOnline() {
    paused = false;
    failStreak = 0;
    backoffMs = 15000;
    schedulePoll();
    catchUp();
  }

  function onOffline() {
    paused = true;
  }

  function start(opts) {
    if (opts && typeof opts.getToken === 'function') tokenFn = opts.getToken;
    paused = false;
    ensureSource();
    schedulePoll();
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(async () => {
      if (shouldSkipNetwork()) return;
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
    pollTimer = null;
    pingTimer = null;
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  }

  global.HuginnSSE = { start, stop, on, catchUp, getLastId, ensureSource };
})(typeof window !== 'undefined' ? window : global);
