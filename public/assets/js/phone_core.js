/**
 * ASGARD CRM — PBX softphone core (vanilla, single-tab via Web Locks)
 * Exposes window.AsgardPhone
 */
(function () {
  'use strict';

  var STATES = {
    offline: 'offline',
    on_line_browser: 'on_line_browser',
    on_line_mobile: 'on_line_mobile',
    ringing: 'ringing',
    in_call: 'in_call',
    held: 'held',
  };

  var LOCK_NAME = 'asgard-pbx-softphone';
  var BC_NAME = 'asgard-phone-tab';
  var TEL_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'BUH'];

  var state = STATES.offline;
  var mode = null;
  var isLeader = false;
  var takeover = false;
  var credentials = null;
  var ua = null;
  var activeSession = null;
  var consultSession = null;
  var remoteAudio = null;
  var localStream = null;
  var callMeta = {};
  var _pendingReload = false;
  var micMuted = false;
  var _hbTimer = null;
  var HEARTBEAT_MS = 45000;
  var sipRegistered = false;
  var _wsBroken = false;

  var bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(BC_NAME) : null;

  function isOnLineState(st) {
    st = st || state;
    return st === STATES.on_line_browser || st === STATES.on_line_mobile ||
      st === STATES.ringing || st === STATES.in_call || st === STATES.held;
  }

  function sendHeartbeat() {
    if (!isOnLineState()) return;
    pbxApi('/operator/heartbeat', { method: 'POST', body: '{}' }).catch(function () {});
  }

  function startHeartbeat() {
    stopHeartbeat();
    sendHeartbeat();
    _hbTimer = setInterval(sendHeartbeat, HEARTBEAT_MS);
  }

  function stopHeartbeat() {
    if (_hbTimer) {
      clearInterval(_hbTimer);
      _hbTimer = null;
    }
  }

  function beaconGoOffline() {
    try {
      var t = token();
      var url = '/api/telephony/pbx/operator/status';
      var body = JSON.stringify({ on_line: false });
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: 'application/json' });
        // sendBeacon can't set Authorization — use keepalive fetch
      }
      if (typeof fetch === 'function') {
        fetch(url, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
          body: body,
          keepalive: true,
        }).catch(function () {});
      }
    } catch (_) {}
  }

  function onPageHide() {
    if (isOnLineState()) beaconGoOffline();
  }

  function onBeforeUnload(e) {
    if (state === STATES.ringing || state === STATES.in_call || state === STATES.held) {
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
    if (isOnLineState()) beaconGoOffline();
  }

  function onVisibilityHeartbeat() {
    if (document.visibilityState === 'visible' && isOnLineState()) sendHeartbeat();
  }

  function maybeConsumePendingReload() {
    if (!_pendingReload) return;
    if (state === STATES.ringing || state === STATES.in_call || state === STATES.held) return;
    _pendingReload = false;
    setTimeout(function () { location.reload(); }, 450);
  }

  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('beforeunload', onBeforeUnload);
  document.addEventListener('visibilitychange', onVisibilityHeartbeat);

  function token() {
    return localStorage.getItem('asgard_token') || '';
  }

  function pbxApi(path, opts) {
    opts = opts || {};
    var headers = { Authorization: 'Bearer ' + token() };
    if (opts.body) headers['Content-Type'] = 'application/json';
    return fetch('/api/telephony/pbx' + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body || undefined,
    }).then(function (r) {
      return r.text().then(function (text) {
        var body = {};
        try { body = text ? JSON.parse(text) : {}; } catch (_) { body = { raw: text }; }
        if (!r.ok) throw new Error(body.error || body.message || 'HTTP ' + r.status);
        return body;
      });
    });
  }

  function emit(type, detail) {
    detail = detail || {};
    detail.state = state;
    detail.mode = mode;
    detail.isLeader = isLeader;
    detail.takeover = takeover;
    try {
      document.dispatchEvent(new CustomEvent('asgard-phone', { detail: Object.assign({ type: type }, detail) }));
    } catch (_) {}
    if (bc && isLeader) {
      try { bc.postMessage({ type: type, detail: detail, from: 'leader' }); } catch (_) {}
    }
  }

  function setState(next, extra) {
    if (state === next) return;
    state = next;
    emit('state', extra || {});
  }

  function wsUrlFromCreds(creds) {
    var raw = creds.ws_url || '/pbx/ws';
    if (/^wss?:\/\//i.test(raw)) return raw;
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    if (raw.charAt(0) !== '/') raw = '/' + raw;
    return proto + '//' + location.host + raw;
  }

  function sipDomainFromWs(ws) {
    try {
      var u = new URL(ws);
      return u.hostname;
    } catch (_) {
      return location.hostname;
    }
  }

  function hasJsSIP() {
    return typeof window.JsSIP !== 'undefined' && window.JsSIP && window.JsSIP.UA;
  }

  function ensureRemoteAudio() {
    if (!remoteAudio) {
      remoteAudio = document.createElement('audio');
      remoteAudio.id = 'asgard-phone-remote-audio';
      remoteAudio.autoplay = true;
      remoteAudio.playsInline = true;
      remoteAudio.style.display = 'none';
      document.body.appendChild(remoteAudio);
    }
    return remoteAudio;
  }

  function attachSessionMedia(session) {
    var audio = ensureRemoteAudio();
    session.on('peerconnection', function (data) {
      var pc = data.peerconnection;
      pc.addEventListener('track', function (ev) {
        if (ev.streams && ev.streams[0]) audio.srcObject = ev.streams[0];
      });
    });
    session.connection && session.connection.addEventListener('track', function (ev) {
      if (ev.streams && ev.streams[0]) audio.srcObject = ev.streams[0];
    });
  }

  function normalizePhone(num) {
    return String(num || '').replace(/\D/g, '');
  }

  function sessionNumber(session) {
    if (!session) return '';
    var ri = session.remote_identity;
    if (ri && ri.uri) return ri.uri.user || String(ri.uri).replace(/^sip:/i, '').split('@')[0];
    return callMeta.number || '';
  }

  function bindSession(session) {
    activeSession = session;
    attachSessionMedia(session);
    session.on('accepted', function () {
      setState(STATES.in_call, { number: sessionNumber(session), callMeta: callMeta });
      emit('connected', { number: sessionNumber(session) });
    });
    session.on('hold', function () {
      setState(STATES.held, { number: sessionNumber(session) });
    });
    session.on('unhold', function () {
      setState(STATES.in_call, { number: sessionNumber(session) });
    });
    session.on('ended', function () {
      activeSession = null;
      micMuted = false;
      callMeta = {};
      if (mode) setState(mode === 'mobile' ? STATES.on_line_mobile : STATES.on_line_browser);
      else setState(STATES.offline);
      emit('ended', {});
      maybeConsumePendingReload();
    });
    session.on('failed', function () {
      activeSession = null;
      callMeta = {};
      if (mode) setState(mode === 'mobile' ? STATES.on_line_mobile : STATES.on_line_browser);
      else setState(STATES.offline);
      emit('failed', {});
      maybeConsumePendingReload();
    });
  }

  function onIncomingSession(session) {
    if (activeSession && activeSession !== session) {
      try { session.terminate({ status_code: 486, reason_phrase: 'Busy Here' }); } catch (_) {}
      return;
    }
    bindSession(session);
    var num = sessionNumber(session);
    callMeta = { number: num, direction: 'inbound', sessionId: session.id };
    setState(STATES.ringing, { number: num, callMeta: callMeta });
    emit('incoming', { number: num, callMeta: callMeta });
    lookupCaller(num).then(function (info) {
      callMeta.lookup = info;
      emit('lookup', { number: num, lookup: info });
    }).catch(function () {});
  }

  function lookupCaller(phone) {
    var digits = normalizePhone(phone);
    if (!digits) return Promise.resolve(null);
    return fetch('/api/telephony/pbx/lookup/' + encodeURIComponent(digits), {
      headers: { Authorization: 'Bearer ' + token() },
    }).then(function (r) { return r.ok ? r.json() : null; });
  }

  function startUA(creds) {
    if (!hasJsSIP()) {
      emit('warn', { message: 'JsSIP не загружен — только UI/API режим' });
      return;
    }
    if (ua) {
      try { ua.stop(); } catch (_) {}
      ua = null;
    }
    var ws = wsUrlFromCreds(creds);
    var domain = sipDomainFromWs(ws);
    var socket = new window.JsSIP.WebSocketInterface(ws);
    var uri = 'sip:' + creds.sip_username + '@' + domain;
    var configuration = {
      sockets: [socket],
      uri: uri,
      password: creds.sip_password || '',
      register: true,
      session_timers: false,
    };
    if (creds.stun) {
      configuration.pcConfig = { iceServers: [{ urls: creds.stun }] };
    }
    ua = new window.JsSIP.UA(configuration);
    sipRegistered = false;
    _wsBroken = false;
    ua.on('connected', function () { emit('sip', { event: 'connected' }); });
    ua.on('disconnected', function () { sipRegistered = false; _wsBroken = true; emit('sip', { event: 'disconnected' }); });
    ua.on('registered', function () {
      sipRegistered = true;
      _wsBroken = false;
      emit('sip', { event: 'registered' });
      pbxApi('/operator/status', { method: 'POST', body: JSON.stringify({ on_line: true, receive_mode: mode === 'mobile' ? 'mobile' : 'browser' }) }).catch(function () {});
      pbxApi('/operator/webrtc', { method: 'POST', body: JSON.stringify({ registered: true }) }).catch(function () {});
    });
    ua.on('unregistered', function () {
      sipRegistered = false;
      emit('sip', { event: 'unregistered' });
      pbxApi('/operator/webrtc', { method: 'POST', body: JSON.stringify({ registered: false }) }).catch(function () {});
    });
    ua.on('registrationFailed', function (e) {
      sipRegistered = false;
      emit('error', { message: 'SIP регистрация: ' + (e && e.cause ? e.cause : 'failed') });
    });
    ua.on('newRTCSession', function (data) {
      var session = data.session;
      if (data.originator === 'remote') onIncomingSession(session);
      else {
        bindSession(session);
        callMeta = { number: sessionNumber(session), direction: 'outbound', sessionId: session.id };
        setState(STATES.ringing, { number: callMeta.number, outbound: true });
      }
    });
    ua.start();
  }

  var _lockRelease = null;

  function holdLeaderLock() {
    if (!navigator.locks || !navigator.locks.request) {
      isLeader = true;
      takeover = false;
      return Promise.resolve(true);
    }
    return navigator.locks.request(LOCK_NAME, { ifAvailable: true }, function (lock) {
      if (!lock) {
        isLeader = false;
        takeover = true;
        emit('takeover', {});
        return undefined;
      }
      isLeader = true;
      takeover = false;
      emit('leader', {});
      navigator.locks.request(LOCK_NAME, function () {
        return new Promise(function (resolve) {
          _lockRelease = resolve;
        });
      });
      return undefined;
    }).then(function () { return isLeader; }).catch(function () {
      isLeader = true;
      return true;
    });
  }

  function releaseLeader() {
    isLeader = false;
    takeover = false;
    if (_lockRelease) {
      try { _lockRelease(); } catch (_) {}
      _lockRelease = null;
    }
  }

  if (bc) {
    bc.onmessage = function (ev) {
      var msg = ev.data || {};
      if (msg.from === 'leader' && !isLeader) {
        takeover = true;
        emit('takeover', msg.detail || {});
      }
      if (msg.type === 'request-leader' && isLeader) {
        bc.postMessage({ type: 'leader-busy' });
      }
    };
  }

  var api = {
    STATES: STATES,
    getState: function () { return state; },
    getMode: function () { return mode; },
    isLeader: function () { return isLeader; },
    isTakeover: function () { return takeover; },
    isInCallOrRinging: function () {
      return state === STATES.ringing || state === STATES.in_call || state === STATES.held;
    },
    isOnLine: function () { return isOnLineState(); },
    shouldDeferShellReload: function () {
      return api.isInCallOrRinging() ||
        state === STATES.on_line_browser ||
        state === STATES.on_line_mobile;
    },
    markPendingReload: function () { _pendingReload = true; emit('reload_deferred', {}); },
    consumePendingReload: function () {
      var v = _pendingReload;
      _pendingReload = false;
      return v;
    },
    getCallMeta: function () { return Object.assign({}, callMeta); },

    /** Apply SSE/AGI ring metadata (channel, pbx_uid) before answer/transfer. */
    applyIncoming: function (meta) {
      meta = meta || {};
      callMeta = Object.assign({}, callMeta, {
        number: meta.number || meta.from || meta.from_number || callMeta.number,
        direction: 'inbound',
        channel: meta.channel || callMeta.channel || null,
        pbx_uid: meta.pbx_uid || (meta.call_id ? String(meta.call_id).replace(/^pbx_/, '') : callMeta.pbx_uid) || null,
        call_id: meta.call_id || callMeta.call_id || null,
        history_id: meta.history_id || callMeta.history_id || null,
        lookup: meta.lookup || callMeta.lookup || {},
      });
      setState(STATES.ringing, { number: callMeta.number, callMeta: callMeta });
      emit('incoming', { number: callMeta.number, callMeta: callMeta });
      return callMeta;
    },

    checkMic: function () {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return Promise.resolve({ ok: false, error: 'getUserMedia недоступен' });
      }
      return navigator.mediaDevices.getUserMedia({ audio: true })
        .then(function (stream) {
          localStream = stream;
          stream.getTracks().forEach(function (t) { t.stop(); });
          localStream = null;
          return { ok: true };
        })
        .catch(function (e) {
          return { ok: false, error: e.message || String(e) };
        });
    },

    goOnline: function (receiveMode) {
      receiveMode = receiveMode === 'mobile' ? 'mobile' : 'browser';
      try { localStorage.setItem('asgard_phone_mode', receiveMode); } catch (_) {}
      if (!TEL_ROLES.length) { /* role check on server */ }
      return holdLeaderLock().then(function (got) {
        if (!got) return { ok: false, reason: 'takeover' };
        mode = receiveMode;
        return pbxApi('/softphone/credentials')
          .then(function (creds) {
            credentials = creds;
            if (!creds.sip_password) {
              return pbxApi('/softphone/credentials?regenerate=1').then(function (c2) {
                credentials = c2;
                startUA(c2);
              });
            }
            startUA(creds);
            setState(receiveMode === 'mobile' ? STATES.on_line_mobile : STATES.on_line_browser);
            pbxApi('/operator/status', {
              method: 'POST',
              body: JSON.stringify({ on_line: true, receive_mode: receiveMode }),
            }).catch(function () {});
            startHeartbeat();
            return { ok: true };
          })
          .catch(function (e) {
            releaseLeader();
            mode = null;
            stopHeartbeat();
            setState(STATES.offline);
            throw e;
          });
      });
    },

    goOffline: function () {
      stopHeartbeat();
      return pbxApi('/operator/status', { method: 'POST', body: JSON.stringify({ on_line: false }) })
        .catch(function () {})
        .then(function () {
          if (activeSession) {
            try { activeSession.terminate(); } catch (_) {}
            activeSession = null;
          }
          if (ua) {
            try { ua.stop(); } catch (_) {}
            ua = null;
          }
          mode = null;
          credentials = null;
          setState(STATES.offline);
          releaseLeader();
          emit('offline', {});
          maybeConsumePendingReload();
          return { ok: true };
        });
    },

    answer: function () {
      if (!activeSession && !callMeta.channel && !callMeta.pbx_uid) {
        emit('error', { message: 'Телефон не зарегистрирован / нет активного звонка' });
        return Promise.reject(new Error('Телефон не зарегистрирован / нет активного звонка'));
      }
      if (activeSession) {
        try {
          activeSession.answer({ mediaConstraints: { audio: true, video: false } });
        } catch (e) {
          return Promise.reject(e);
        }
      }
      return pbxApi('/call/answer', {
        method: 'POST',
        body: JSON.stringify({
          channel: callMeta.channel,
          pbx_uid: callMeta.pbx_uid,
          call_id: callMeta.call_id,
        }),
      }).then(function () {
        setState(STATES.in_call);
        return { ok: true };
      });
    },

    hangup: function () {
      if (activeSession) {
        try { activeSession.terminate(); } catch (_) {}
      }
      return pbxApi('/call/hangup', { method: 'POST', body: JSON.stringify({ channel: callMeta.channel, pbx_uid: callMeta.pbx_uid, call_id: callMeta.call_id }) })
        .catch(function () {})
        .then(function () {
          setState(mode ? (mode === 'mobile' ? STATES.on_line_mobile : STATES.on_line_browser) : STATES.offline);
          callMeta = {};
          emit('hangup', {});
          maybeConsumePendingReload();
          return { ok: true };
        });
    },

    transferStatus: function (status, extra) {
      emit('transfer_status', Object.assign({ status: status || 'unknown' }, extra || {}));
    },

    setMuted: function (on) {
      micMuted = on !== false;
      if (localStream) {
        localStream.getAudioTracks().forEach(function (t) {
          t.enabled = !micMuted;
        });
      }
      if (activeSession) {
        try {
          if (micMuted && activeSession.mute) activeSession.mute({ audio: true });
          else if (!micMuted && activeSession.unmute) activeSession.unmute({ audio: true });
        } catch (_) {}
      }
      emit('mute', { muted: micMuted });
      return Promise.resolve({ ok: true, muted: micMuted });
    },

    isMuted: function () {
      return micMuted;
    },

    hold: function (holdOn) {
      var wantHold = holdOn !== false;
      if (activeSession && activeSession.isReady && activeSession.isReady()) {
        try {
          if (wantHold && activeSession.hold) activeSession.hold();
          else if (!wantHold && activeSession.unhold) activeSession.unhold();
        } catch (_) {}
      }
      return pbxApi('/call/hold', {
        method: 'POST',
        body: JSON.stringify({ channel: callMeta.channel, hold: wantHold }),
      }).then(function () {
        setState(wantHold ? STATES.held : STATES.in_call);
        return { ok: true, hold: wantHold };
      });
    },

    transfer: function (kind, target) {
      kind = kind === 'consult' ? 'consult' : 'blind';
      var body = { channel: callMeta.channel, pbx_uid: callMeta.pbx_uid, call_id: callMeta.call_id, target: target, mode: kind };
      if (kind === 'consult' && consultSession) {
        body.consult_channel = consultSession.id;
      }
      return pbxApi('/call/transfer', { method: 'POST', body: JSON.stringify(body) })
        .then(function (r) {
          emit('transfer', { kind: kind, target: target });
          return r;
        })
        .catch(function (e) {
          // GSM-режим (звонок на мобильный через транк): канала в Asterisk нет —
          // просим сервер перевести вызов через транк.
          if (e && /channel required/i.test(e.message || '')) {
            var digits = normalizePhone(target);
            return pbxApi('/call/outbound', {
              method: 'POST',
              body: JSON.stringify({ number: digits, transfer: 'gsm' }),
            }).then(function (r2) {
              emit('transfer', { kind: kind, target: target, via: 'gsm' });
              return r2;
            });
          }
          throw e;
        });
    },

    outbound: function (number) {
      var digits = normalizePhone(number);
      if (!digits) return Promise.reject(new Error('Некорректный номер'));
      callMeta = { number: digits, direction: 'outbound' };
      // WebRTC зарегистрирован → звоним из браузера напрямую (медиа в браузере).
      if (ua && hasJsSIP() && sipRegistered) {
        var domain = credentials ? sipDomainFromWs(wsUrlFromCreds(credentials)) : location.hostname;
        var session = ua.call('sip:' + digits + '@' + domain, { mediaConstraints: { audio: true, video: false } });
        if (session) bindSession(session);
        setState(STATES.ringing, { number: digits, outbound: true });
        return Promise.resolve({ ok: true, via: 'webrtc' });
      }
      // Иначе — серверный GSM-путь (оператор без WebRTC получает плечо на мобильный).
      return pbxApi('/call/outbound', { method: 'POST', body: JSON.stringify({ number: digits }) }).then(function (r) {
        setState(STATES.ringing, { number: digits, outbound: true });
        return r;
      });
    },

    claimTab: function () {
      if (bc) bc.postMessage({ type: 'request-leader' });
      return api.goOffline().then(function () {
        return api.goOnline(mode || 'browser');
      });
    },

    playRemoteAudio: function () {
      var a = ensureRemoteAudio();
      if (a.srcObject) return a.play().catch(function (e) { emit('audio_blocked', { error: e.message }); });
      return Promise.resolve();
    },

    getSipRegistered: function () { return sipRegistered; },
  };

  window.AsgardPhone = api;
  emit('ready', {});

  // Клик-ту-колл (CRM) открывает этот URL после приёма вызова на телефоне оператора.
  try {
    if (/[?&]call=1/.test(location.search)) {
      var savedMode = localStorage.getItem('asgard_phone_mode');
      if (!isOnLineState() && savedMode) {
        var cleanUrl = location.pathname + location.hash;
        try { history.replaceState(null, '', cleanUrl); } catch (_) {}
        setTimeout(function () {
          api.goOnline(savedMode === 'mobile' ? 'mobile' : 'browser').catch(function () {});
        }, 600);
      }
    }
  } catch (_) {}
})();
