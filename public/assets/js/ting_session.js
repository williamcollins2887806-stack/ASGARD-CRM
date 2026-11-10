/**
 * TingSession — singleton LiveKit session for hub + Huginn rail panel + PiP.
 * Unmounting #/ting must NOT disconnect while session is active.
 */
(function (global) {
  'use strict';

  /* D14: та же версия, что страницы (было @2 → дрейф API). D24: локальный ассет. */
  const LK_CDN = '/assets/vendor/livekit-client.umd.min.js';
  const listeners = new Map();
  let room = null;
  let meta = null; // { slug, title, identity, role, startedAt }
  let connecting = false;
  let connectSeq = 0;
  let micOn = true;
  let camOn = true;
  let camDesired = true;
  let tingMicWasOn = true;
  let phoneForcedMute = false;
  let timerId = null;
  let timerSec = 0;
  let videoPaused = false;
  let activeSpeakerId = null;
  let lastToken = null;
  let spkTimer = null;

  function emit(type, detail) {
    const payload = Object.assign({ type: type }, detail || {});
    (listeners.get(type) || new Set()).forEach((fn) => {
      try { fn(payload); } catch (e) { console.error('[TingSession]', type, e); }
    });
    (listeners.get('*') || new Set()).forEach((fn) => {
      try { fn(payload); } catch (_) {}
    });
    try {
      document.dispatchEvent(new CustomEvent('ting-session', { detail: payload }));
    } catch (_) {}
  }

  function on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event).delete(fn);
  }

  function isActive() {
    return !!(room && room.state !== undefined && room.state !== 0) || connecting;
  }

  function getState() {
    return {
      active: isActive(),
      connecting: connecting,
      room: room,
      meta: meta,
      micOn: micOn,
      camOn: camOn,
      camDesired: camDesired,
      timerSec: timerSec,
      videoPaused: videoPaused,
      phoneForcedMute: phoneForcedMute,
      activeSpeakerId: activeSpeakerId
    };
  }

  function storeToken(tok) {
    if (tok) lastToken = tok;
  }

  function getLastToken() {
    return lastToken;
  }

  function syncCamFlag(on) {
    camOn = !!on;
    camDesired = !!on;
    emit('media', { micOn: micOn && !phoneForcedMute, camOn: camOn });
  }

  function loadLk() {
    if (global.LivekitClient) return Promise.resolve(global.LivekitClient);
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-ting-lk]');
      if (existing) {
        existing.addEventListener('load', () => resolve(global.LivekitClient));
        existing.addEventListener('error', () => reject(new Error('LiveKit CDN')));
        return;
      }
      const s = document.createElement('script');
      s.src = LK_CDN;
      s.async = true;
      s.dataset.tingLk = '1';
      s.onload = () => resolve(global.LivekitClient);
      s.onerror = () => reject(new Error('Не удалось загрузить видео-клиент'));
      document.head.appendChild(s);
    });
  }

  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  function startTimer() {
    stopTimer();
    timerSec = 0;
    timerId = setInterval(() => {
      timerSec += 1;
      emit('tick', { timerSec: timerSec });
    }, 1000);
  }

  function syncChrome() {
    const live = isActive() && !connecting;
    document.body.classList.toggle('ting-live', live && !(location.hash || '').startsWith('#/ting'));
    if (!(location.hash || '').startsWith('#/ting')) {
      document.body.classList.remove('ting-incall');
    }
  }

  function wireRoomEvents(lkRoom) {
    if (!lkRoom || lkRoom.__tingWired) return;
    lkRoom.__tingWired = true;
    const bump = () => emit('media', { micOn: micOn && !phoneForcedMute, camOn: camOn && !videoPaused });
    try {
      const LK = global.LivekitClient;
      const Ev = LK && LK.RoomEvent;
      if (!Ev) {
        lkRoom.on && lkRoom.on('trackSubscribed', bump);
        lkRoom.on && lkRoom.on('participantConnected', bump);
        lkRoom.on && lkRoom.on('participantDisconnected', bump);
        return;
      }
      lkRoom.on(Ev.TrackSubscribed, bump);
      lkRoom.on(Ev.TrackUnsubscribed, bump);
      lkRoom.on(Ev.TrackMuted, bump);
      lkRoom.on(Ev.TrackUnmuted, bump);
      lkRoom.on(Ev.ParticipantConnected, bump);
      lkRoom.on(Ev.ParticipantDisconnected, bump);
      if (Ev.LocalTrackPublished) lkRoom.on(Ev.LocalTrackPublished, bump);
      if (Ev.LocalTrackUnpublished) lkRoom.on(Ev.LocalTrackUnpublished, bump);

      if (Ev.ActiveSpeakersChanged) {
        lkRoom.on(Ev.ActiveSpeakersChanged, (speakers) => {
          const next = (speakers && speakers[0] && speakers[0].identity) || null;
          if (spkTimer) clearTimeout(spkTimer);
          spkTimer = setTimeout(() => {
            if (activeSpeakerId === next) return;
            activeSpeakerId = next;
            emit('speaker', { identity: next });
          }, activeSpeakerId ? 900 : 400);
        });
      }

      if (Ev.Reconnecting) {
        lkRoom.on(Ev.Reconnecting, () => emit('reconnecting', {}));
      }
      if (Ev.Reconnected) {
        lkRoom.on(Ev.Reconnected, () => emit('reconnected', {}));
      }
      lkRoom.on(Ev.Disconnected, () => {
        if (room !== lkRoom) return;
        room = null;
        stopTimer();
        if (spkTimer) { clearTimeout(spkTimer); spkTimer = null; }
        syncChrome();
        document.body.classList.remove('ting-live');
        emit('left', { reason: 'disconnected' });
      });
    } catch (_) { /* */ }
  }

  function adoptRoom(lkRoom, info) {
    if (room && room !== lkRoom) {
      try { room.disconnect(); } catch (_) { /* */ }
      room = null;
    }
    room = lkRoom;
    meta = Object.assign({ startedAt: Date.now() }, info || {});
    connecting = false;
    try {
      if (room && room.localParticipant) {
        camOn = room.localParticipant.isCameraEnabled === true;
        camDesired = camOn;
        micOn = room.localParticipant.isMicrophoneEnabled !== false;
      }
    } catch (_) { /* */ }
    wireRoomEvents(lkRoom);
    if (!timerId) startTimer();
    syncChrome();
    emit('connected', { meta: meta });
  }

  async function connect(opts) {
    opts = opts || {};
    if (connecting) return getState();
    if (room && meta && meta.slug === opts.slug) return getState();

    const phone = global.AsgardPhone;
    const pst = phone && typeof phone.getState === 'function' ? String(phone.getState()) : '';
    const phoneBusy = ['ringing', 'in_call', 'held'].indexOf(pst) >= 0;
    if (phoneBusy && opts.listenOnly !== true) {
      const err = new Error('Сначала завершите телефонный разговор');
      err.code = 'PBX_BUSY';
      emit('error', { error: err });
      throw err;
    }

    connecting = true;
    const seq = ++connectSeq;
    emit('connecting', { slug: opts.slug });
    try {
      const LK = await loadLk();
      if (seq !== connectSeq) return getState();
      if (room) {
        try { await room.disconnect(); } catch (_) {}
        room = null;
      }
      const narrow = typeof window !== 'undefined' && window.innerWidth <= 820;
      const roomOpts = { dynacast: true, adaptiveStream: narrow ? { pixelDensity: 2 } : false };
      try {
        if (LK.VideoPresets) {
          const layers = [];
          if (LK.VideoPresets.h180) layers.push(LK.VideoPresets.h180);
          if (LK.VideoPresets.h360) layers.push(LK.VideoPresets.h360);
          roomOpts.publishDefaults = {
            simulcast: true,
            videoSimulcastLayers: layers,
            videoEncoding: (LK.VideoPresets.h720 && LK.VideoPresets.h720.encoding) || undefined
          };
        }
      } catch (_) { /* */ }
      if (opts.token) storeToken({ token: opts.token, url: opts.url, expires_at: opts.expires_at });
      const next = new LK.Room(roomOpts);
      await next.connect(opts.url, opts.token);
      if (seq !== connectSeq) {
        try { await next.disconnect(); } catch (_) {}
        return getState();
      }
      room = next;
      meta = {
        slug: opts.slug,
        title: opts.title || (opts.room && opts.room.title) || opts.slug,
        identity: opts.identity,
        role: opts.role || null,
        displayName: opts.displayName || opts.display_name || null,
        jobTitle: opts.jobTitle || opts.job_title || null,
        startedAt: Date.now()
      };
      micOn = opts.listenOnly ? false : opts.micOn !== false;
      camOn = opts.listenOnly ? false : opts.camOn !== false;
      camDesired = camOn;
      tingMicWasOn = micOn;
      try {
        await next.localParticipant.setMicrophoneEnabled(micOn);
        /* T-SESS-01: тот же publish-путь, что CRM page (AsgardTing.enableLocalCamera). */
        if (camOn) {
          const pub = global.AsgardTing && typeof global.AsgardTing.enableLocalCamera === 'function'
            ? global.AsgardTing.enableLocalCamera
            : null;
          if (pub) {
            await pub(next);
            camOn = next.localParticipant.isCameraEnabled === true;
          } else {
            await next.localParticipant.setCameraEnabled(true);
            camOn = next.localParticipant.isCameraEnabled === true;
          }
        } else {
          await next.localParticipant.setCameraEnabled(false);
          camOn = false;
        }
      } catch (_) {
        try { camOn = next.localParticipant.isCameraEnabled === true; } catch (__) { /* */ }
      }
      connecting = false;
      wireRoomEvents(next);
      startTimer();
      syncChrome();
      emit('connected', { meta: meta });
      return getState();
    } catch (e) {
      connecting = false;
      emit('error', { error: e });
      throw e;
    }
  }

  async function leave() {
    connectSeq += 1;
    connecting = false;
    stopTimer();
    if (spkTimer) { clearTimeout(spkTimer); spkTimer = null; }
    const r = room;
    room = null;
    meta = null;
    phoneForcedMute = false;
    videoPaused = false;
    activeSpeakerId = null;
    syncChrome();
    document.body.classList.remove('ting-live');
    if (r) {
      try { await r.disconnect(); } catch (_) {}
    }
    emit('left', {});
  }

  async function setMicEnabled(on) {
    micOn = !!on;
    if (!phoneForcedMute) tingMicWasOn = micOn;
    if (room && room.localParticipant) {
      try { await room.localParticipant.setMicrophoneEnabled(micOn && !phoneForcedMute); } catch (_) {}
    }
    emit('media', { micOn: micOn && !phoneForcedMute, camOn: camOn });
  }

  async function setCamEnabled(on) {
    camDesired = !!on;
    if (room && room.localParticipant) {
      const target = !!on;
      try {
        if (target) {
          const pub = global.AsgardTing && typeof global.AsgardTing.enableLocalCamera === 'function'
            ? global.AsgardTing.enableLocalCamera
            : null;
          if (pub) await pub(room);
          else await room.localParticipant.setCameraEnabled(true);
        } else {
          await room.localParticipant.setCameraEnabled(false);
        }
        camOn = room.localParticipant.isCameraEnabled === true;
      } catch (_) {
        camOn = room.localParticipant.isCameraEnabled === true;
      }
      emit('media', { micOn: micOn && !phoneForcedMute, camOn: camOn });
      return;
    }
    camOn = !!on;
    emit('media', { micOn: micOn && !phoneForcedMute, camOn: camOn });
  }

  /**
   * Visibility: не глушим локальную камеру (как Телемост).
   * Remote video — только setEnabled, без detach (иначе PiP/stage чернеют).
   */
  /**
   * Visibility: НИЧЕГО не выключаем — как Телемост.
   * Раньше здесь дергали pub.setEnabled(false) на всех видео-подписках, а это
   * реально ОТПИСЫВАЕТ трек и детачит элемент. На возврате во вкладку часть
   * публикаций не переподписывалась → «чёрные плитки до выхода-входа».
   * Камеру и микрофон тоже не трогаем: локальные треки браузер сам придержит.
   */
  async function pauseRemoteVideo(pause) {
    videoPaused = !!pause;
    emit('visibility', { videoPaused: videoPaused });
  }

  function onPhoneEvent(ev) {
    const d = ev && ev.detail;
    if (!d || !isActive()) return;
    const t = d.type;
    const st = d.state || (global.AsgardPhone && AsgardPhone.getState && AsgardPhone.getState());
    const busy = t === 'incoming' || t === 'ringing' || st === 'ringing' || st === 'in_call' || st === 'held'
      || (t === 'state' && (st === 'ringing' || st === 'in_call' || st === 'held'));
    const free = t === 'ended' || t === 'hangup' || t === 'failed'
      || (t === 'state' && st && st !== 'ringing' && st !== 'in_call' && st !== 'held');
    if (busy) {
      if (!phoneForcedMute) {
        tingMicWasOn = micOn;
        phoneForcedMute = true;
        if (room && room.localParticipant) {
          room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
        }
        emit('phone-busy', { banner: 'Трубка занята телефоном' });
      }
      if (global.HuginnDock && typeof global.HuginnDock.openTab === 'function') {
        try { global.HuginnDock.openTab('phone'); } catch (_) {}
      }
    } else if (free) {
      if (phoneForcedMute) {
        phoneForcedMute = false;
        if (tingMicWasOn && room && room.localParticipant) {
          room.localParticipant.setMicrophoneEnabled(true).catch(() => {});
          micOn = true;
        }
        emit('phone-free', {});
      }
    }
  }

  function onVisibility() {
    if (!isActive()) return;
    pauseRemoteVideo(document.visibilityState === 'hidden');
  }

  document.addEventListener('asgard-phone', onPhoneEvent);
  document.addEventListener('visibilitychange', onVisibility);

  global.TingSession = {
    loadLk: loadLk,
    connect: connect,
    leave: leave,
    adoptRoom: adoptRoom,
    isActive: isActive,
    getState: getState,
    getRoom: () => room,
    getMeta: () => meta,
    on: on,
    setMicEnabled: setMicEnabled,
    setCamEnabled: setCamEnabled,
    syncCamFlag: syncCamFlag,
    storeToken: storeToken,
    getLastToken: getLastToken,
    pauseRemoteVideo: pauseRemoteVideo,
    syncChrome: syncChrome,
    /** @deprecated use leave */
    disconnect: leave
  };
})(typeof window !== 'undefined' ? window : global);
