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
  var onDuty = false;
  var isLeader = false;
  var takeover = false;
  var credentials = null;
  var pcConfig = null;
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
  // JsSIP (эта сборка) НЕ умеет trickle ICE: перед отправкой INVITE он ждёт
  // iceGatheringState === "complete". Chrome/Chromium может держать сбор ~40с
  // даже когда ВСЕ нужные кандидаты собраны за ~1.2с (прямой замер в живом
  // Chrome 10.10.2026: host+srflx+relay есть за 1.2с, complete — через 40с).
  // Поэтому принудительно финализируем сбор через хук ready() из события
  // icecandidate. Это работает во всех браузерах (Chrome/Firefox/Safari):
  // ready() — это API JsSIP, а не поведение браузера.
  //
  // Значения подобраны по замеру: host ~5мс, srflx ~40-135мс, relay ~380-1200мс.
  // Целимся в «мгновенный» финиш сразу после ПЕРВОГО публичного кандидата
  // (srflx/relay), но с коротким дозреванием, чтобы не потерять остальные.
  var ICE_RELAY_GRACE_MS = 250;    // relay уже есть -> короткая пауза на дозревание
  var ICE_GATHER_GRACE_MS = 400;   // srflx есть (relay ещё нет) -> пауза, ждём relay
  var ICE_GATHER_QUIET_MS = 800;   // тишина после последнего кандидата
  var ICE_GATHER_MAX_MS = 1500;    // жёсткий потолок от первого кандидата
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
        if (!r.ok) {
          var err = new Error(body.error || body.message || 'HTTP ' + r.status);
          // Правка 5-клиент: пробрасываем via/reason, чтобы отличить
          // «звони из браузера» (409 via:'webrtc') от прочих ошибок.
          if (body.via) err.via = body.via;
          if (body.reason) err.reason = body.reason;
          err.status = r.status;
          throw err;
        }
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
      applyRemoteVolume();
    }
    return remoteAudio;
  }

  // Громкость входящего (0..3, где 1 = обычная). Значение хранится локально,
  // по умолчанию слегка усилено (1.6), т.к. WebRTC-приём на 8 кГц звучит тихо.
  // Гейн делаем через WebAudio GainNode — HTMLAudioElement.volume>1 не работает.
  var remoteVolume = parseFloat(localStorage.getItem('asgard_phone_volume') || '1.6');
  var remoteGain = null;
  var remoteSrc = null;
  var audioCtxRemote = null;

  function applyRemoteVolume() {
    if (remoteAudio) { try { remoteAudio.volume = 1.0; } catch (_) {} }
    if (remoteGain) { try { remoteGain.gain.value = remoteVolume; } catch (_) {} }
  }

  function wireRemoteGain(stream) {
    if (!stream) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtxRemote = audioCtxRemote || new Ctx();
      if (audioCtxRemote.state === 'suspended' && audioCtxRemote.resume) {
        audioCtxRemote.resume().catch(function () {});
      }
      if (remoteSrc) { try { remoteSrc.disconnect(); } catch (_) {} }
      remoteSrc = audioCtxRemote.createMediaStreamSource(stream);
      remoteGain = audioCtxRemote.createGain();
      remoteGain.gain.value = remoteVolume;
      remoteSrc.connect(remoteGain);
      // Усиленный звук — в колонки; сам <audio> остаётся беззвучным (volume=0),
      // чтобы не было двойного воспроизведения.
      remoteGain.connect(audioCtxRemote.destination);
      if (remoteAudio) { try { remoteAudio.volume = 0; } catch (_) {} }
    } catch (e) {
      // WebAudio недоступен — играем через элемент (усиление не применится).
      if (remoteAudio) { try { remoteAudio.volume = 1.0; } catch (_) {} }
    }
  }

  function attachSessionMedia(session) {
    var audio = ensureRemoteAudio();
    session.on('peerconnection', function (data) {
      var pc = data.peerconnection;
      pc.addEventListener('track', function (ev) {
        if (ev.streams && ev.streams[0]) { audio.srcObject = ev.streams[0]; wireRemoteGain(ev.streams[0]); }
      });
    });
    session.connection && session.connection.addEventListener('track', function (ev) {
      if (ev.streams && ev.streams[0]) { audio.srcObject = ev.streams[0]; wireRemoteGain(ev.streams[0]); }
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
    attachIceFastFinish(session);
    session.on('accepted', function () {
      setState(STATES.in_call, { number: sessionNumber(session), callMeta: callMeta });
      emit('connected', { number: sessionNumber(session) });
    });
    // Удалённый ответ 180/183: абонент дозванивается (гудки). На этой сборке
    // early-media не пробрасывается, но событие приходит -> UI показывает
    // «Гудки…», а гудок генерирует панель (WebAudio).
    session.on('progress', function () {
      emit('progress', { number: sessionNumber(session) });
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
      if (onDuty) setState(mode === 'mobile' ? STATES.on_line_mobile : STATES.on_line_browser);
      else setState(STATES.offline);
      emit('ended', {});
      maybeConsumePendingReload();
    });
    session.on('failed', function (data) {
      activeSession = null;
      // ПРАВКА 5c: если локальный исходящий упал из-за протухшего контакта
      // (Asterisk → SIP 404/480), JsSIP даёт cause NOT_FOUND/UNAVAILABLE.
      // Делаем ОДИН retry (ensureRegistered → повтор локально или серверный путь).
      // Whitelist ТОЧНЫЙ: BUSY/NO_ANSWER/REJECTED/CANCELED и пр. — НЕ ретраим.
      var cause = data && (data.cause || (data.message && data.message.cause));
      var retryable = /^(UNAVAILABLE|NOT_FOUND)$/i.test(String(cause || ''));
      if (retryable && pendingOutbound && !outboundRetried) {
        try { retryViaServer(pendingOutbound); } catch (_) {}
      }
      pendingOutbound = null;
      callMeta = {};
      if (onDuty) setState(mode === 'mobile' ? STATES.on_line_mobile : STATES.on_line_browser);
      else setState(STATES.offline);
      emit('failed', { cause: cause || null });
      maybeConsumePendingReload();
    });
  }

  /**
   * Принудительное завершение сбора ICE-кандидатов.
   *
   * Контекст (замер в живом Chrome 10.10.2026, asgard-crm.ru):
   *   no iceServers    -> gathering complete за 135мс (но нет srflx/relay -> тишина)
   *   stun:наш coturn  -> все кандидаты за ~100мс, complete ЧЕРЕЗ ~40с
   *   turn:udp наш     -> то же, complete ~40с
   *   turn:tcp наш     -> complete за 218мс (но браузер за NAT часто НЕ поднимает
   *                       TCP-кандидата -> риск тишины; поэтому TCP-only не годится)
   *
   * Итог: дело не в доступности сервера, а в том, что Chromium долго НЕ
   * объявляет gathering завершённым. JsSIP ждёт именно это событие, поэтому
   * INVITE уходил на «Позвонить» только через 40с.
   *
   * Решение: слушаем session.on('icecandidate') и сами зовём ready() (который
   * JsSIP передаёт вместе с каждым кандидатом), как только собрали достаточно
   * кандидатов. Работает во всех браузерах, т.к. ready() — это API JsSIP.
   */
  function attachIceFastFinish(session) {
    var done = false;
    var firstAt = 0;
    var quietTimer = null;
    var maxTimer = null;
    var finishTimer = null;
    function finish(reason) {
      if (done) return;
      done = true;
      if (quietTimer) clearTimeout(quietTimer);
      if (maxTimer) clearTimeout(maxTimer);
      if (finishTimer) clearTimeout(finishTimer);
      try {
        if (typeof session._iceFinish === 'function') session._iceFinish();
      } catch (e) {
        emit('error', { message: 'ICE fast-finish: ' + (e && e.message ? e.message : e) });
      }
      try { debugIce('finish: ' + reason); } catch (_) {}
    }
    function finishAfter(ms, reason) {
      if (done || finishTimer) return;
      finishTimer = setTimeout(function () { finish(reason); }, ms);
    }
    function armQuiet() {
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(function () { finish('quiet ' + ICE_GATHER_QUIET_MS + 'ms'); }, ICE_GATHER_QUIET_MS);
    }
    function armMax() {
      if (maxTimer) return;
      maxTimer = setTimeout(function () { finish('max ' + ICE_GATHER_MAX_MS + 'ms'); }, ICE_GATHER_MAX_MS);
    }
    session.on('icecandidate', function (data) {
      // ВАЖНО: JsSIP отдаёт ОДИН объект {candidate, ready}, а не два аргумента.
      if (!data) return;
      if (typeof data.ready === 'function') session._iceFinish = data.ready;
      var cand = data.candidate;
      if (!cand) { finish('end-of-candidates'); return; }
      if (!firstAt) { firstAt = Date.now(); armMax(); }
      var typ = cand.type || '';
      // Самый ранний безопасный момент: есть публичный кандидат (собеседник
      // сможет достучаться). relay — надёжнее всего, srflx — тоже публичный.
      if (typ === 'relay') {
        finishAfter(ICE_RELAY_GRACE_MS, 'relay + ' + ICE_RELAY_GRACE_MS + 'ms');
      } else if (typ === 'srflx') {
        finishAfter(ICE_GATHER_GRACE_MS, 'srflx + ' + ICE_GATHER_GRACE_MS + 'ms');
      }
      armQuiet();
      try { debugIce('cand: ' + typ); } catch (_) {}
    });
  }

  function debugIce(msg) {
    if (!window.ASGARD_PHONE_DEBUG) return;
    try { console.debug('[phone:ice] ' + msg); } catch (_) {}
  }

  function onIncomingSession(session) {
    if (!onDuty) {
      try { session.terminate({ status_code: 486, reason_phrase: 'Busy Here' }); } catch (_) {}
      return;
    }
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

  // Провижининг эндпоинта — ОДИН раз за жизнь страницы (не на каждую
  // регистрацию). Раньше provision звался при каждом ensureRegistered/register,
  // а серверный provision делал `pjsip reload` → сбрасывал контакты ВСЕМ
  // операторам (инцидент 16.10.2026).
  var _provisioned = false;
  // Идентичность текущего UA (uri+пароль) — чтобы не пересоздавать его зря.
  var _uaUri = null;
  var _uaPassword = null;
  function provisionOnce() {
    if (_provisioned) return;
    _provisioned = true;
    pbxApi('/softphone/provision', { method: 'POST', body: '{}' }).catch(function () {});
  }

  function startUA(creds) {
    if (!hasJsSIP()) {
      emit('warn', { message: 'JsSIP не загружен — только UI/API режим' });
      return;
    }
    // ПРАВКА C (16.10.2026): если UA уже поднят с ТЕМИ ЖЕ кредами — не трогаем
    // его. Раньше каждый startUA делал ua.stop() → UNREGISTER + закрытие WS,
    // и регистрация «мигала» (Unavailable) при каждой перерегистрации.
    var wsUri = wsUrlFromCreds(creds);
    var domUri = sipDomainFromWs(wsUri);
    var wantUri = 'sip:' + creds.sip_username + '@' + domUri;
    if (ua && _uaUri === wantUri && _uaPassword === (creds.sip_password || '')) {
      // Тот же эндпоинт/пароль — переиспользуем живой UA (при необходимости
      // JsSIP сам поддержит регистрацию refresh-ем).
      return;
    }
    if (ua) {
      try { ua.stop(); } catch (_) {}
      ua = null;
    }
    var ws = wsUri;
    var domain = domUri;
    var socket = new window.JsSIP.WebSocketInterface(ws);
    var uri = 'sip:' + creds.sip_username + '@' + domain;
    var configuration = {
      sockets: [socket],
      uri: uri,
      password: creds.sip_password || '',
      register: true,
      // Регистрация на 5 минут: JsSIP сам шлёт REGISTER-refresh до истечения
      // (инцидент 12.10.2026: с дефолтными 600с контакт отваливался в
      // «due to shutdown» → Unreachable → исходящий молча уходил на мобильный).
      register_expires: 300,
      session_timers: false,
    };
    // ICE-серверы: STUN + TURN (relay). TURN критичен, когда NAT не пробивается:
    // без него у браузера только приватные кандидаты и в звонке никого не слышно.
    var iceServers = (creds.ice_servers && creds.ice_servers.length)
      ? creds.ice_servers
      : [
        { urls: creds.stun || 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ];
    configuration.pcConfig = { iceServers: iceServers, iceCandidatePoolSize: 2 };
    // Запоминаем отдельно: JsSIP читает pcConfig из аргументов call()/answer(),
    // а не из конфигурации UA (см. комментарий в outbound()).
    pcConfig = configuration.pcConfig;
    ua = new window.JsSIP.UA(configuration);
    _uaUri = wantUri;
    _uaPassword = creds.sip_password || '';
    sipRegistered = false;
    _wsBroken = false;
    ua.on('connected', function () { emit('sip', { event: 'connected' }); });
    ua.on('disconnected', function () { sipRegistered = false; _wsBroken = true; emit('sip', { event: 'disconnected' }); });
    ua.on('registered', function () {
      sipRegistered = true;
      _wsBroken = false;
      emit('sip', { event: 'registered' });
      // SIP жив → отмечаем webrtc_registered, но ЛИНИЮ не занимаем:
      // «зарегистрирован для исходящих» != «на линии для входящих».
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

    // Вкладку могли свернуть/заморозить → JS не выполнялся, REGISTER-refresh не
    // ушёл, контакт в Asterisk протух. Возвращаемся — сразу перерегистрируемся,
    // не дожидаясь, пока оператор нажмёт «Позвонить» и уйдёт в мобильный callback
    // (инцидент 12.10.2026: «сначала звонит мой телефон, а не цель»).
    if (!document.__asgardVisHook) {
      document.__asgardVisHook = true;
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) return;
        if (!sipRegistered) {
          try { api.ensureRegistered().then(function () { api.waitRegistered(4000); }).catch(function () {}); } catch (_) {}
        }
      });
    }
  }

  var _lockRelease = null;
  var lockHeld = false;

  function holdLeaderLock() {
    if (lockHeld) return Promise.resolve(true);
    if (!navigator.locks || !navigator.locks.request) {
      isLeader = true;
      takeover = false;
      lockHeld = true;
      return Promise.resolve(true);
    }
    return navigator.locks.request(LOCK_NAME, { ifAvailable: true }, function (lock) {
      if (!lock) {
        isLeader = false;
        takeover = true;
        lockHeld = false;
        emit('takeover', {});
        return undefined;
      }
      isLeader = true;
      lockHeld = true;
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
      lockHeld = true;
      return true;
    });
  }

  function releaseLeader() {
    isLeader = false;
    takeover = false;
    lockHeld = false;
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

  // ── ПРАВКА 5+5c: retry исходящего при протухшем контакте ──
  // outboundRetried: не более ОДНОГО retry на звонок (защита от цикла).
  // pendingOutbound: номер текущего исходящего (для retry из session 'failed').
  var outboundRetried = false;
  var pendingOutbound = null;

  /** Поставить локальный исходящий вызов (ua.call) и вернуть промис-результат. */
  function placeLocalCall(digits) {
    if (!(ua && hasJsSIP() && sipRegistered)) return null;
    var domain = credentials ? sipDomainFromWs(wsUrlFromCreds(credentials)) : location.hostname;
    var session = ua.call('sip:' + digits + '@' + domain, {
      mediaConstraints: { audio: true, video: false },
      pcConfig: pcConfig,
    });
    if (session) bindSession(session);
    setState(STATES.ringing, { number: digits, outbound: true });
    return { ok: true, via: 'webrtc' };
  }

  /** Серверный путь исходящего. При 409 via:'webrtc' — повторить локально
   *  (сервер по AMI-факту сказал, что браузер доступен — правка 5). */
  function callViaServer(digits) {
    return pbxApi('/call/outbound', { method: 'POST', body: JSON.stringify({ number: digits }) })
      .then(function (r) {
        if (r && r.channel) callMeta.channel = r.channel;
        if (r && r.pbx_uid) callMeta.pbx_uid = r.pbx_uid;
        setState(STATES.ringing, { number: digits, outbound: true });
        return r;
      })
      .catch(function (e) {
        var msg = String((e && e.message) || '');
        var via = e && e.via;
        // 409 via:'webrtc' → сервер говорит: браузер доступен (AMI-факт).
        // Не показываем ошибку — повторяем звонок из браузера.
        if (via === 'webrtc' || /инициируется из браузера|webrtc/i.test(msg)) {
          var r = null;
          try { r = placeLocalCall(digits); } catch (_) {}
          if (r) return r;
          throw new Error('Браузер не на связи. Обновите страницу (F5) и повторите.');
        }
        throw e;
      });
  }

  /**
   * Retry протухшего локального звонка (5c): Asterisk вернул UNAVAILABLE/NOT_FOUND
   * (контакт протух) → поднимаем регистрацию и повторяем; если не поднялось за
   * 2с — идём серверным путём (там правка 5 решит по AMI-факту).
   * Вызывается ТОЛЬКО из session 'failed' при точном whitelist cause и один раз.
   */
  function retryViaServer(digits) {
    if (outboundRetried) return Promise.resolve(false);
    outboundRetried = true;
    return api.ensureRegistered()
      .then(function () { return api.waitRegistered(2000); })
      .then(function (ok) {
        if (ok && ua && hasJsSIP() && sipRegistered) {
          try { return !!placeLocalCall(digits); } catch (_) { /* ниже серверный путь */ }
        }
        return callViaServer(digits).then(function () { return true; });
      })
      .catch(function () { return false; });
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

    /**
     * Регистрация SIP без постановки на линию.
     * Сотрудник может звонить из браузера, но входящие к нему не идут.
     */
    register: function (receiveMode) {
      receiveMode = receiveMode === 'mobile' ? 'mobile' : 'browser';
      try { localStorage.setItem('asgard_phone_mode', receiveMode); } catch (_) {}
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
          return { ok: true, mode: receiveMode };
        })
        .catch(function (e) {
          releaseLeader();
          mode = null;
          throw e;
        });
    });
  },

    /**
     * Ленивая регистрация SIP «для исходящих» без занятия линии.
     * Нужна, чтобы любой сотрудник мог звонить ИЗ БРАУЗЕРА (медиа в браузере),
     * не вставая на линию и не перехватывая входящие у дежурного.
     *
     * Намеренно НЕ берёт leader-lock и не ставит on_line:
     *  - регистрация только для исходящих безопасна и в нескольких вкладках;
     *  - иначе вкладка, позвонившая один раз, «заперла» бы кнопку «На линии»
     *    в остальных вкладках того же браузера.
     */
    ensureRegistered: function () {
      if (sipRegistered && ua) return Promise.resolve({ ok: true, already: true });
      if (!mode) { try { mode = localStorage.getItem('asgard_phone_mode') || 'browser'; } catch (_) { mode = 'browser'; } }
      return pbxApi('/softphone/credentials')
        .then(function (creds) {
          credentials = creds;
          if (!creds.sip_password) {
            return pbxApi('/softphone/credentials?regenerate=1').then(function (c2) {
              credentials = c2;
              startUA(c2);
              provisionOnce();
              return { ok: true, mode: mode, outboundOnly: true };
            });
          }
          startUA(creds);
          provisionOnce();
          return { ok: true, mode: mode, outboundOnly: true };
        });
    },

    /** Ждём фактическую SIP-регистрацию (событие registered), макс ~4с. */
    waitRegistered: function (timeoutMs) {
      if (sipRegistered) return Promise.resolve(true);
      var deadline = Date.now() + (timeoutMs || 4000);
      return new Promise(function (resolve) {
        (function poll() {
          if (sipRegistered) return resolve(true);
          if (Date.now() > deadline) return resolve(false);
          setTimeout(poll, 150);
        })();
      });
    },

    /** Встать на линию (перехват): SIP + on_line=true у себя, у прежнего снимается. */
    goOnDuty: function (receiveMode) {
      receiveMode = receiveMode === 'mobile' ? 'mobile' : 'browser';
      // ПРАВКА D (16.10.2026): идемпотентность — если уже на линии в этом же
      // режиме с живой регистрацией, НЕ повторяем register()+claim-line.
      // Раньше каждый вызов пересоздавал UA (UNREGISTER) и дёргал claim-line,
      // что при нескольких сессиях рушило регистрацию по кругу.
      if (onDuty && mode === receiveMode && sipRegistered && ua) {
        return Promise.resolve({ ok: true, already: true, mode: receiveMode });
      }
      return api.register(receiveMode).then(function (r) {
        if (!r.ok) return r;
        return pbxApi('/operator/claim-line', {
          method: 'POST',
          body: JSON.stringify({ receive_mode: receiveMode }),
        }).then(function (claim) {
          onDuty = true;
          setState(receiveMode === 'mobile' ? STATES.on_line_mobile : STATES.on_line_browser);
          startHeartbeat();
          if (claim && claim.previousUserId) emit('line_taken_by_me', claim);
          return { ok: true, ...claim };
        }).catch(function (e) {
          stopHeartbeat();
          onDuty = false;
          setState(STATES.offline);
          throw e;
        });
      });
    },

    /** Совместимость: «на линии» = регистрация + постановка (кнопка в панели). */
    goOnline: function (receiveMode) {
      return api.goOnDuty(receiveMode);
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
          onDuty = false;
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
          // pcConfig и здесь: JsSIP читает его из аргументов answer(), не из UA.
          activeSession.answer({ mediaConstraints: { audio: true, video: false }, pcConfig: pcConfig });
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
      var uid = '';
      try {
        var a = JSON.parse(localStorage.getItem('asgard_user') || '{}');
        uid = (a && a.id) || (a && a.user && a.user.id) || '';
      } catch (_) {}
      return pbxApi('/call/hangup', { method: 'POST', body: JSON.stringify({
        channel: callMeta.channel,
        pbx_uid: callMeta.pbx_uid,
        call_id: callMeta.call_id,
        user_id: uid || undefined,
        direction: callMeta.direction,
      }) })
        .catch(function () {})
        .then(function () {
          setState(onDuty ? (mode === 'mobile' ? STATES.on_line_mobile : STATES.on_line_browser) : STATES.offline);
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

    transfer: function (kind, target, targetMode) {
      kind = kind === 'consult' ? 'consult' : 'blind';
      // Для WebRTC-звонка канала в Asterisk ещё нет (плечо переводит Asterisk по
      // pbx_uid). Передаём pbx_uid и call_id — сервер сам найдёт канал.
      // target_mode: 'webrtc' (СРМ) или 'mobile' (телефон) — выбор оператора.
      var body = { channel: callMeta.channel, pbx_uid: callMeta.pbx_uid, call_id: callMeta.call_id, target: target, mode: kind, target_mode: targetMode || undefined };
      if (kind === 'consult' && consultSession) {
        body.consult_channel = consultSession.id;
      }
      return pbxApi('/call/transfer', { method: 'POST', body: JSON.stringify(body) })
        .then(function (r) {
          emit('transfer', { kind: kind, target: target });
          return r;
        })
        .catch(function (e) {
          var msg = (e && e.message) || '';
          // GSM-путь: канала нет вовсе — переводим через транк (набор плеча).
          if (/channel required/i.test(msg)) {
            var digits = normalizePhone(target);
            return pbxApi('/call/outbound', {
              method: 'POST',
              body: JSON.stringify({ number: digits, transfer: 'gsm' }),
            }).then(function (r2) {
              emit('transfer', { kind: kind, target: target, via: 'gsm' });
              return r2;
            });
          }
          // 409 про WebRTC больше не означает «канала нет»: сервер сам находит
          // плечо по pbx_uid/sip_username. Если всё же пришёл — не дозваниваемся
          // серверным путём (иначе вызов ушёл бы на мобильный вместо перевода),
          // а показываем понятную причину.
          if (/webrtc/i.test(msg)) {
            throw new Error('Перевод не удался: не нашли плечо звонка в Asterisk. Проверьте, что вы на линии, и повторите.');
          }
          throw e;
        });
    },

    outbound: function (number) {
      var digits = normalizePhone(number);
      if (!digits) return Promise.reject(new Error('Некорректный номер'));
      callMeta = { number: digits, direction: 'outbound' };
      // ПРАВКА 5c (12.10.2026): сброс ограничителя retry в НАЧАЛЕ нового звонка —
      // иначе после первого retry повторные звонки в той же сессии не смогли бы
      // сделать fallback (флаг остался бы взведён от прошлого звонка).
      outboundRetried = false;
      pendingOutbound = digits;
      // Любой сотрудник звонит ИЗ БРАУЗЕРА: при отсутствии SIP-регистрации
      // поднимаем её лениво (без занятия линии) и ждём до ~4с.
      var prep = (sipRegistered && ua) ? Promise.resolve(true) : api
        .ensureRegistered()
        .then(function () { return api.waitRegistered(4000); })
        .catch(function () { return false; });
      return prep.then(function (ok) {
        if (ok && ua && hasJsSIP() && sipRegistered) {
          var domain = credentials ? sipDomainFromWs(wsUrlFromCreds(credentials)) : location.hostname;
          // ВАЖНО (корень тишины в звонках, 10.10.2026): JsSIP НЕ берёт pcConfig
          // из конфигурации UA — он читает его из аргументов call():
          //   u = R.cloneObject(n.pcConfig, { iceServers: [] })
          // Поэтому без явной передачи iceServers здесь сбор кандидатов идёт с
          // пустым списком STUN/TURN → в SDP только приватные host-кандидаты
          // (srflx=0, relay=0) → медиа-путь не строится и в трубке тишина.
          var session = ua.call('sip:' + digits + '@' + domain, {
            mediaConstraints: { audio: true, video: false },
            pcConfig: pcConfig,
          });
          if (session) bindSession(session);
          setState(STATES.ringing, { number: digits, outbound: true });
          return { ok: true, via: 'webrtc' };
        }
        // WebRTC недоступен — серверный путь (плечо на мобильный оператора → контакт).
        return callViaServer(digits);
      });
    },

    claimTab: function () {
      // Перехват линии: SIP-регистрация + снятие on_line у прежнего владельца
      // (не только между вкладками одного браузера).
      return api.goOffline().then(function () {
        return api.goOnDuty(mode || 'browser');
      });
    },

    playRemoteAudio: function () {
      var a = ensureRemoteAudio();
      if (a.srcObject) return a.play().catch(function (e) { emit('audio_blocked', { error: e.message }); });
      return Promise.resolve();
    },

    /** Громкость входящего звука (0..3). 1 = обычная, >1 — усиление. */
    setVolume: function (v) {
      var n = Number(v);
      if (!Number.isFinite(n)) return remoteVolume;
      remoteVolume = Math.max(0, Math.min(3, n));
      try { localStorage.setItem('asgard_phone_volume', String(remoteVolume)); } catch (_) {}
      applyRemoteVolume();
      if (remoteGain) { try { remoteGain.gain.value = remoteVolume; } catch (_) {} }
      // Если WebAudio не поднялся (например, запрет политики) — применим к элементу.
      if (remoteAudio && !remoteGain) { try { remoteAudio.volume = Math.min(1, remoteVolume); } catch (_) {} }
      emit('volume', { volume: remoteVolume });
      return remoteVolume;
    },
    getVolume: function () { return remoteVolume; },

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
