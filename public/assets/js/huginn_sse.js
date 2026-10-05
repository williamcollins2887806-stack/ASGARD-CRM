/**
 * Huginn SSE client — reconnect + catch-up by event id.
 * Does not own the CRM EventSource; wraps window._asgardSSE or creates one for /h.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'huginn_last_event_id';
  const handlers = new Map(); // event → Set<fn>
  let es = null;
  let pollTimer = null;
  let pingTimer = null;
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

  async function catchUp() {
    const token = tokenFn();
    if (!token) return;
    const since = getLastId();
    try {
      const res = await fetch('/api/chat-groups/events?since=' + since, {
        headers: { Authorization: 'Bearer ' + token }
      });
      if (!res.ok) return;
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
      // If live DOM missed a row, pull open thread from API (no full page reload).
      if (hadChatMsg && global.HuginnDock && typeof global.HuginnDock.refreshOpenChat === 'function') {
        try { await global.HuginnDock.refreshOpenChat(); } catch (_) {}
      }
    } catch (e) {
      console.warn('[huginn_sse] catchUp', e.message);
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

    source.addEventListener('error', () => {
      // EventSource reconnects; we catch-up on open
    });
    // native EventSource has no 'open' bubbling reliably — poll catch-up
    catchUp();
  }

  function ensureSource() {
    if (global._asgardSSE) {
      bindSource(global._asgardSSE);
      return;
    }
    const token = tokenFn();
    if (!token) return;
    if (es && es.readyState !== 2) return;
    const url = '/api/sse/stream?token=' + encodeURIComponent(token);
    const source = new EventSource(url);
    global._asgardSSE = source;
    bindSource(source);
  }

  function on(event, fn) {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event).add(fn);
    return () => handlers.get(event).delete(fn);
  }

  function start(opts) {
    if (opts && typeof opts.getToken === 'function') tokenFn = opts.getToken;
    ensureSource();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      ensureSource();
      catchUp();
    }, 15000);
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(async () => {
      const token = tokenFn();
      if (!token) return;
      try {
        await fetch('/api/chat-groups/presence/ping', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token }
        });
      } catch (_) {}
    }, 25000);
    catchUp();
  }

  function stop() {
    if (pollTimer) clearInterval(pollTimer);
    if (pingTimer) clearInterval(pingTimer);
    pollTimer = null;
    pingTimer = null;
  }

  global.HuginnSSE = { start, stop, on, catchUp, getLastId, ensureSource };
})(typeof window !== 'undefined' ? window : global);
