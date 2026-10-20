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
  let _listenersBound = false;
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

  // ── D-309: смерть токена не должна превращаться в вечный цикл ─────────────
  // Симптом 16.10.2026: с одного офисного IP ушло 52 391 ответ 401 за сутки
  // (35 014 /api/chat-groups/events + 17 172 /api/sse/stream). Токен протух,
  // а клиент каждые 800 мс переоткрывал поток: EventSource на 401 уходит в
  // CLOSED, `scheduleReconnect()` поднимает его заново, `catchUp()` на 401
  // делал только `noteFail()`. Токен из localStorage никто не удалял.
  // Лечение: 401 = окончательный отказ. Гасим поток, чистим токен, зовём
  // logout один раз; дальше — экспоненциальный backoff до 60 с.
  let authDead = false;
  let authRetryStreak = 0;

  function backoffMs() {
    // 800 мс → 1.6 → 3.2 → 6.4 → 12.8 → 25.6 → 60 (потолок)
    const base = 800 * Math.pow(2, Math.max(0, authRetryStreak - 1));
    return Math.min(60000, base);
  }

  function onAuthDead(reason) {
    if (authDead) return;
    authDead = true;
    paused = true;
    try { localStorage.removeItem('asgard_token'); } catch (_) {}
    try { localStorage.removeItem('huginn_last_event_id'); } catch (_) {}
    closeSource();
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    console.warn('[huginn_sse] сессия истекла (' + (reason || '401') + ') — поток остановлен');
    emit('auth:expired', { reason: reason || '401' });
    // Один раз зовём штатный logout, чтобы UI ушёл на форму входа.
    try {
      if (global.AsgardAuth && typeof global.AsgardAuth.logout === 'function') {
        global.AsgardAuth.logout();
      }
    } catch (_) {}
  }

  /**
   * D-309 (исправлено 20.10, регресс входа): смерть сессии — ТОЛЬКО 401.
   *
   * 403 означает «сессия жива, но действие запрещено»: нет прав, нужен PIN,
   * требуется смена пароля. Первая версия считала смертью и 403 и звала
   * logout() — токен стирался за секунду ДО ввода PIN, и вход был невозможен:
   *   login 200 → chat-groups/events 403 (нужен PIN) → sse видит 403
   *   → logout() → verify-pin 401 «Требуется авторизация».
   */
  function inspectAuth(res) {
    if (res && res.status === 401) {
      onAuthDead('HTTP 401');
      return true;
    }
    return false;
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
        // D-309: 401/403 — сессия мертва, ретраить бессмысленно.
        if (inspectAuth(res)) return;
        authRetryStreak += 1;
        noteFail();
        return;
      }
      authRetryStreak = 0;
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
      // Соединение дёрнулось (сервер закрыт, сеть, истёк токен). Подписчиков
      // уведомляем, но перед реконнектом отличаем «токен мёртв» от «сеть легла».
      emit('error', {});
      if (authDead) return;
      // CLOSED (2) — recreate fast. CONNECTING (0) — the browser retries itself.
      if (source.readyState === 2) { if (es === source) es = null; scheduleReconnect(); return; }
      scheduleReconnect();
    });
    catchUp();
  }

  function ensureSource() {
    if (authDead) return;
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
   *  restored in well under a second, not after a 15–120s backoff.
   *  D-309: после первой же ошибки включается экспоненциальный backoff, чтобы
   *  смерть токена не давала 400k запросов в сутки. */
  let reconnectTimer = null;
  function scheduleReconnect() {
    if (reconnectTimer) return;
    if (authDead) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (shouldSkipNetwork()) return;
      if (es && es.readyState === 2) { es = null; }
      try { if (global._asgardSSE && global._asgardSSE.readyState === 2) global._asgardSSE = null; } catch (_) {}
      ensureSource();
      catchUp();
    }, weakNetwork() ? 800 : backoffMs());
  }

  /** Пока соединений не рвали — держим быстрый реконнект (800 мс). Если уже
   *  были отказы — растём экспоненциально. */
  function weakNetwork() {
    return authRetryStreak === 0 && failStreak === 0;
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
    // Новая сессия — снимаем блокировку, поставленную прошлым 401.
    authDead = false;
    authRetryStreak = 0;
    failStreak = 0;
    paused = false;
    // D-309: start() зовётся при КАЖДОМ входе (auth.js). Глобальные слушатели
    // добавлялись повторно, а stop() при этом не звался — 5 входов без F5
    // давали 5 подписок на visibilitychange/online/offline и 5×catchUp
    // на каждый возврат во вкладку. Сначала снимаем старые.
    if (_listenersBound) {
      try { document.removeEventListener('visibilitychange', onVisibility); } catch (_) {}
      try { window.removeEventListener('online', onOnline); } catch (_) {}
      try { window.removeEventListener('offline', onOffline); } catch (_) {}
      _listenersBound = false;
    }
    ensureSource();
    schedulePoll();
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(async () => {
      if (shouldSkipPing()) return;
      const token = tokenFn();
      if (!token) return;
      try {
        const pr = await fetch('/api/chat-groups/presence/ping', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token }
        });
        // D-309: пинг — такая же точка обнаружения мёртвого токена.
        inspectAuth(pr);
      } catch (_) { noteFail(); }
    }, 25000);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    _listenersBound = true;
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
    _listenersBound = false;
  }

  global.HuginnSSE = {
    start, stop, on, catchUp, getLastId, ensureSource,
    // для тестов D-309: сколько раз мы уже отступили и мертва ли сессия
    _state: () => ({ authDead, authRetryStreak, failStreak }),
  };
})(typeof window !== 'undefined' ? window : global);
