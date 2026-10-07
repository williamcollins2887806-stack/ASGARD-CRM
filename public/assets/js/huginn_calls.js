/**
 * HuginnCall — 1:1 Telegram-like audio/video calls inside the Huginn dock.
 * Media rides the same self-hosted LiveKit that Ting already uses; signalling
 * goes through /api/chat-groups/calls/* (durable SSE + web-push ring).
 *
 * Public API: start(kind), onIncoming(call), accept(), decline(), hangup(),
 * getState(), on(event, fn), mount()/initFromUrl().
 */
(function (global) {
  'use strict';

  const LK_CDN = 'https://cdn.jsdelivr.net/npm/livekit-client@2/dist/livekit-client.umd.min.js';
  const listeners = new Map();

  let room = null;
  let call = null;          // { id, chat_id, caller_id, callee_id, kind, status }
  let peerName = '';
  let connecting = false;
  let micOn = true;
  let camOn = false;
  let timerId = null;
  let timerSec = 0;
  let ringTimeoutId = null;
  let overlayEl = null;
  const RING_TIMEOUT_MS = 45000;

  function token() {
    return localStorage.getItem('asgard_token') || '';
  }

  function myId() {
    try {
      const u = JSON.parse(localStorage.getItem('asgard_user') || '{}');
      return u.id || u.user_id || null;
    } catch (_) {
      return null;
    }
  }

  async function api(path, opts) {
    const o = opts || {};
    const res = await fetch('/api/chat-groups' + path, {
      method: o.method || 'GET',
      headers: Object.assign(
        { Authorization: 'Bearer ' + token() },
        o.body ? { 'Content-Type': 'application/json' } : {}
      ),
      body: o.body ? JSON.stringify(o.body) : undefined
    });
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      const err = new Error(data.error || ('HTTP ' + res.status));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function emit(type, detail) {
    const payload = Object.assign({ type: type }, detail || {});
    (listeners.get(type) || new Set()).forEach((fn) => {
      try { fn(payload); } catch (e) { console.error('[HuginnCall]', type, e); }
    });
    (listeners.get('*') || new Set()).forEach((fn) => {
      try { fn(payload); } catch (_) {}
    });
    try { document.dispatchEvent(new CustomEvent('huginn-call', { detail: payload })); } catch (_) {}
  }

  function on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event).delete(fn);
  }

  function isActive() {
    return !!call && ['ringing', 'active'].includes(call.status);
  }

  function getState() {
    return {
      active: isActive(),
      connecting: connecting,
      call: call,
      peerName: peerName,
      micOn: micOn,
      camOn: camOn,
      timerSec: timerSec
    };
  }

  function loadLk() {
    if (global.LivekitClient) return Promise.resolve(global.LivekitClient);
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-hg-call-lk]');
      if (existing) {
        existing.addEventListener('load', () => resolve(global.LivekitClient));
        existing.addEventListener('error', () => reject(new Error('LiveKit CDN')));
        return;
      }
      const s = document.createElement('script');
      s.src = LK_CDN;
      s.async = true;
      s.dataset.hgCallLk = '1';
      s.onload = () => resolve(global.LivekitClient);
      s.onerror = () => reject(new Error('Не удалось загрузить голосовой клиент'));
      document.head.appendChild(s);
    });
  }

  function startTimer() {
    stopTimer();
    timerSec = 0;
    timerId = setInterval(() => {
      timerSec += 1;
      const el = overlayEl && overlayEl.querySelector('[data-hg-call-timer]');
      if (el) el.textContent = fmtTime(timerSec);
      emit('tick', { timerSec: timerSec });
    }, 1000);
  }

  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  function fmtTime(sec) {
    const s = Math.max(0, Number(sec) || 0);
    const m = Math.floor(s / 60);
    return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  function ringtone(on) {
    try {
      if (!global.TingSound) return;
      if (on && global.TingSound.startRing) global.TingSound.startRing();
      else if (!on && global.TingSound.stopRing) global.TingSound.stopRing();
    } catch (_) {}
  }

  function phoneBusy() {
    try {
      return !!(global.AsgardPhone && global.AsgardPhone.getState && global.AsgardPhone.getState() !== 'offline');
    } catch (_) {
      return false;
    }
  }

  // ── Overlay UI ────────────────────────────────────────────────
  function dockRoot() {
    return document.getElementById('huginnDock');
  }

  function panelHost() {
    const r = dockRoot();
    return (r && r.querySelector('#hgPanel')) || r || document.body;
  }

  function ensureOverlay() {
    if (overlayEl && document.body.contains(overlayEl)) return overlayEl;
    const host = panelHost();
    const el = document.createElement('div');
    el.className = 'hg-call-sheet hg-call-sheet--out';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Звонок');
    host.appendChild(el);
    overlayEl = el;
    return el;
  }

  function removeOverlay() {
    if (overlayEl) {
      try { overlayEl.remove(); } catch (_) {}
    }
    overlayEl = null;
  }

  function renderOverlay(mode) {
    const el = ensureOverlay();
    el.className = 'hg-call-sheet hg-call-sheet--' + mode;
    const initials = String(peerName || '?').trim().split(/\s+/).map((w) => w.charAt(0)).slice(0, 2).join('').toUpperCase();
    const statusText = mode === 'incoming'
      ? 'Входящий ' + (call && call.kind === 'video' ? 'видеозвонок' : 'звонок')
      : mode === 'outgoing' ? 'Вызов…'
        : (mode === 'active' ? '<span data-hg-call-timer>00:00</span>' : '');
    const canAccept = mode === 'incoming';
    el.innerHTML = `
      <div class="hg-call-stage hg-call-stage--${mode}">
        <video class="hg-call-remote" data-hg-call-remote playsinline autoplay></video>
        <div class="hg-call-meta">
          <div class="hg-call-av" aria-hidden="true">${initials || '?'}</div>
          <div class="hg-call-name">${escapeHtml(peerName || 'Сотрудник')}</div>
          <div class="hg-call-status">${statusText}</div>
        </div>
      </div>
      <div class="hg-call-controls">
        ${canAccept ? `
          <button type="button" class="hg-call-btn is-accept" data-hg-call-act="accept" aria-label="Принять">${icon('phone')}</button>
          <button type="button" class="hg-call-btn is-danger" data-hg-call-act="decline" aria-label="Отклонить">${icon('phoneOff')}</button>
        ` : `
          <button type="button" class="hg-call-btn" data-hg-call-act="mic" aria-label="Микрофон">${icon(micOn ? 'mic' : 'micOff')}</button>
          <button type="button" class="hg-call-btn" data-hg-call-act="cam" aria-label="Камера">${icon(camOn ? 'video' : 'videoOff')}</button>
          <button type="button" class="hg-call-btn is-danger" data-hg-call-act="${mode === 'outgoing' ? 'cancel' : 'hangup'}" aria-label="Завершить">${icon('phoneOff')}</button>
        `}
      </div>`;
    el.querySelectorAll('[data-hg-call-act]').forEach((btn) => {
      btn.onclick = () => {
        const a = btn.getAttribute('data-hg-call-act');
        if (a === 'accept') accept();
        else if (a === 'decline') decline();
        else if (a === 'cancel') cancel();
        else if (a === 'hangup') hangup();
        else if (a === 'mic') toggleMic();
        else if (a === 'cam') toggleCam();
      };
    });
    if (mode === 'active') {
      const t = el.querySelector('[data-hg-call-timer]');
      if (t) t.textContent = fmtTime(timerSec);
    }
    return el;
  }

  function icon(name) {
    const pack = (global.HuginnIcons && global.HuginnIcons.ICO) || {};
    if (name === 'mic') return pack.mic || '🎤';
    if (name === 'micOff') return pack.micOff || '🔇';
    if (name === 'video') return pack.video || '🎥';
    if (name === 'videoOff') return pack.videoOff || pack.video || '📷';
    if (name === 'phone') return pack.phone || '📞';
    if (name === 'phoneOff') return pack.phoneOff || pack.phone || '📴';
    return '';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ── LiveKit plumbing ──────────────────────────────────────────
  async function connectLiveKit(wsUrl, lkToken) {
    const LK = await loadLk();
    if (!LK) throw new Error('Голосовой клиент недоступен');
    const next = new LK.Room({ adaptiveStream: true, dynacast: true });
    next.on(LK.RoomEvent.TrackSubscribed, (track) => {
      if (track && track.kind === 'video' && overlayEl) {
        const v = overlayEl.querySelector('[data-hg-call-remote]');
        if (v) { try { track.attach(v); } catch (_) {} }
      }
      // audio tracks attach themselves when room.remoteParticipants audio is enabled
      if (track && track.kind === 'audio') {
        try { track.attach(); } catch (_) {}
      }
    });
    next.on(LK.RoomEvent.ParticipantDisconnected, () => {
      if (call && call.status === 'active') {
        // peer left — end locally
        finishLocal('Собеседник отключился');
      }
    });
    await next.connect(wsUrl, lkToken);
    room = next;
    try {
      await next.localParticipant.setMicrophoneEnabled(micOn);
      await next.localParticipant.setCameraEnabled(camOn);
    } catch (_) {}
    connecting = false;
    emit('connected', { room: room });
    return next;
  }

  async function disconnectLiveKit() {
    if (!room) return;
    const r = room;
    room = null;
    try { await r.disconnect(); } catch (_) {}
  }

  async function toggleMic() {
    micOn = !micOn;
    try {
      if (room) await room.localParticipant.setMicrophoneEnabled(micOn);
    } catch (_) {}
    renderOverlay(call && call.status === 'active' ? 'active' : 'outgoing');
    emit('media', { micOn: micOn, camOn: camOn });
  }

  async function toggleCam() {
    camOn = !camOn;
    try {
      if (room) await room.localParticipant.setCameraEnabled(camOn);
    } catch (_) {}
    if (overlayEl) overlayEl.classList.toggle('is-video', camOn);
    renderOverlay(call && call.status === 'active' ? 'active' : 'outgoing');
    emit('media', { micOn: micOn, camOn: camOn });
  }

  function startRingTimeout() {
    stopRingTimeout();
    ringTimeoutId = setTimeout(() => {
      if (call && call.status === 'ringing') {
        // Nobody picked up — cancel so the row never stays 'ringing' and blocks calls.
        cancel();
        emit('missed', { reason: 'timeout' });
      }
    }, RING_TIMEOUT_MS);
  }

  function stopRingTimeout() {
    if (ringTimeoutId) clearTimeout(ringTimeoutId);
    ringTimeoutId = null;
  }

  function finishLocal(reason) {
    stopTimer();
    stopRingTimeout();
    ringtone(false);
    disconnectLiveKit();
    const had = call;
    call = null;
    removeOverlay();
    emit('ended', { call: had, reason: reason || 'ended' });
  }

  // ── Signalling actions ────────────────────────────────────────
  async function start(kind) {
    if (isActive()) return getState();
    if (phoneBusy()) {
      emit('busy', { reason: 'phone' });
      throw new Error('Трубка занята телефоном');
    }
    const dock = global.HuginnDock;
    const chatId = dock && dock.getChatId ? dock.getChatId() : null;
    if (!chatId) throw new Error('Откройте личный чат');

    kind = kind === 'video' ? 'video' : 'audio';
    camOn = kind === 'video';
    micOn = true;
    connecting = true;
    const data = await api('/calls', { method: 'POST', body: { chat_id: Number(chatId), kind: kind } });
    call = data.call;
    peerName = (data.call && data.call.peer_name) || peerName || 'Сотрудник';
    renderOverlay('outgoing');
    emit('outgoing', { call: call });
    startRingTimeout();

    // Anti-stub: no media token means no media. Never show a fake "calling" state.
    if (!data.token) {
      try { await api('/calls/' + call.id + '/end', { method: 'POST', body: {} }); } catch (_) {}
      finishLocal('no_media');
      throw new Error('Звонки недоступны: медиасервер не настроен');
    }

    try {
      await connectLiveKit(data.ws_url, data.token);
      if (call && call.status === 'ringing') {
        // caller waits for accept; keep outgoing UI until call:accepted arrives
      }
    } catch (e) {
      emit('error', { message: e.message });
      throw e;
    }
    return { call: call, room: data.room };
  }

  async function accept() {
    if (!call || call.status !== 'ringing') return;
    ringtone(false);
    const data = await api('/calls/' + call.id + '/answer', { method: 'POST', body: {} });
    call = data.call;
    camOn = call.kind === 'video';
    renderOverlay('active');
    startTimer();
    if (!data.token) {
      try { await api('/calls/' + call.id + '/end', { method: 'POST', body: {} }); } catch (_) {}
      finishLocal('no_media');
      emit('error', { message: 'Звонки недоступны: медиасервер не настроен' });
      return;
    }
    try {
      await connectLiveKit(data.ws_url, data.token);
    } catch (e) {
      emit('error', { message: e.message });
    }
    emit('active', { call: call });
  }

  async function decline() {
    if (!call) return;
    const id = call.id;
    ringtone(false);
    finishLocal('declined');
    try { await api('/calls/' + id + '/decline', { method: 'POST', body: {} }); } catch (_) {}
  }

  async function cancel() {
    if (!call) return;
    const id = call.id;
    finishLocal('canceled');
    try { await api('/calls/' + id + '/end', { method: 'POST', body: {} }); } catch (_) {}
  }

  async function hangup() {
    if (!call) return;
    const id = call.id;
    if (timerSec === 0 && call.status === 'ringing') return cancel();
    finishLocal('ended');
    try { await api('/calls/' + id + '/end', { method: 'POST', body: {} }); } catch (_) {}
  }

  // ── Incoming / live events ────────────────────────────────────
  function onIncoming(payload) {
    if (!payload || !payload.id) return;
    if (isActive()) {
      // busy → auto-decline politely
      api('/calls/' + payload.id + '/decline', { method: 'POST', body: {} }).catch(() => {});
      emit('busy', { reason: 'busy', call: payload });
      return;
    }
    call = {
      id: payload.id,
      chat_id: payload.chat_id,
      caller_id: payload.caller_id,
      callee_id: payload.callee_id,
      kind: payload.kind || 'audio',
      status: payload.status || 'ringing'
    };
    peerName = payload.from_name || payload.peer_name || 'Сотрудник';
    camOn = call.kind === 'video';
    micOn = false; // don't broadcast until accepted
    renderOverlay('incoming');
    ringtone(true);
    startRingTimeout();
    emit('incoming', { call: call });
  }

  function onAccepted(payload) {
    if (!call || !payload || Number(payload.id) !== Number(call.id)) return;
    call = Object.assign(call, payload);
    call.status = 'active';
    renderOverlay('active');
    stopRingTimeout();
    startTimer();
    emit('active', { call: call });
  }

  function onEnded(payload) {
    if (!call || !payload || Number(payload.id) !== Number(call.id)) return;
    finishLocal(payload.reason || 'ended');
  }

  const _sseOff = [];
  function attachSse() {
    if (!global.HuginnSSE || !global.HuginnSSE.on) return;
    _sseOff.splice(0).forEach((off) => { try { off(); } catch (_) {} });
    _sseOff.push(global.HuginnSSE.on('call:incoming', (p) => onIncoming(p && (p.detail || p))));
    _sseOff.push(global.HuginnSSE.on('call:accepted', (p) => onAccepted(p && (p.detail || p))));
    _sseOff.push(global.HuginnSSE.on('call:declined', (p) => onEnded(p && (p.detail || p))));
    _sseOff.push(global.HuginnSSE.on('call:ended', (p) => onEnded(p && (p.detail || p))));
  }

  /** Reconnect after reload / push deep-link (?call=<id>). */
  async function initFromUrl() {
    let wantId = null;
    let wantAction = null;
    try {
      const qs = new URLSearchParams(location.search || '');
      wantId = qs.get('call');
      wantAction = qs.get('call_action');
    } catch (_) {}
    if (!wantId && !call) return;
    try {
      const data = wantId
        ? await api('/calls/' + encodeURIComponent(wantId))
        : await api('/calls/active');
      const c = data.call || (data && data.call);
      if (!c) return;
      if (wantAction === 'decline') {
        if (c.status === 'ringing' && Number(c.callee_id) === Number(myId())) {
          try { await api('/calls/' + c.id + '/decline', { method: 'POST', body: {} }); } catch (_) {}
          cleanCallUrl();
        }
        return;
      }
      if (c.status === 'ringing' && Number(c.callee_id) === Number(myId())) {
        onIncoming(c);
        if (wantAction === 'accept') accept().catch(() => {});
      } else if (c.status === 'active') {
        call = c;
        camOn = c.kind === 'video';
        renderOverlay('active');
        const t = await api('/calls/' + c.id + '/token', { method: 'POST', body: {} });
        if (t.token && t.ws_url) await connectLiveKit(t.ws_url, t.token);
        startTimer();
      }
    } catch (_) {}
  }

  function cleanCallUrl() {
    try {
      const u = new URL(location.href);
      u.searchParams.delete('call');
      u.searchParams.delete('call_action');
      history.replaceState(null, '', u.pathname + (u.search ? u.search : '') + u.hash);
    } catch (_) {}
  }

  function mount() {
    if (_mounted) return;
    _mounted = true;
    attachSse();
    initFromUrl();
  }

  global.HuginnCall = {
    start: start,
    accept: accept,
    decline: decline,
    cancel: cancel,
    hangup: hangup,
    onIncoming: onIncoming,
    onAccepted: onAccepted,
    onEnded: onEnded,
    getState: getState,
    on: on,
    mount: mount,
    initFromUrl: initFromUrl,
    isActive: isActive
  };
})(window);
