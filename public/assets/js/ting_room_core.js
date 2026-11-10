/* ASGARD Ting — shared room helpers (CRM + guest). */
(function (global) {
  'use strict';

  function mediaTrackLive(track) {
    if (!track) return false;
    try {
      var mst = track.mediaStreamTrack;
      if (mst && mst.readyState === 'live') return true;
    } catch (_) { /* */ }
    return false;
  }

  /**
   * Для UI: muted-камера = нет трека → аватар, не пустой <video> (broken-media).
   * mediaTrackLive — только когда isMuted !== true (краткие SFU-гонки без mute).
   */
  function trackIsLive(pub) {
    if (!pub || !pub.track) return null;
    try {
      if (pub.isMuted === true || pub.track.isMuted === true) return null;
      if (mediaTrackLive(pub.track)) return pub.track;
    } catch (_) { /* */ }
    return pub.track;
  }

  function pickVideoTrack(participant) {
    if (!participant || !participant.videoTrackPublications) return null;
    var pubs = Array.from(participant.videoTrackPublications.values());
    var screen = pubs.find(function (x) {
      return trackIsLive(x) && /screen/i.test(String(x.source || ''));
    });
    if (screen) return trackIsLive(screen);
    var cam = pubs.find(function (x) { return trackIsLive(x); });
    return cam ? trackIsLive(cam) : null;
  }

  function encodeData(obj) {
    return new TextEncoder().encode(JSON.stringify(Object.assign({ ts: Date.now() }, obj || {})));
  }

  async function publishData(room, payload, opts) {
    if (!room || !room.localParticipant || typeof room.localParticipant.publishData !== 'function') return;
    var bytes = encodeData(payload);
    await room.localParticipant.publishData(bytes, opts || { reliable: true });
  }

  function showReactionBurst(layerEl, emoji) {
    if (!layerEl || !emoji) return;
    var el = document.createElement('div');
    el.className = 'ting-react-burst';
    el.textContent = emoji;
    el.style.left = (20 + Math.random() * 60) + '%';
    layerEl.appendChild(el);
    setTimeout(function () { try { el.remove(); } catch (_) { /* */ } }, 2200);
  }

  function parseDataPayload(payload) {
    try {
      return JSON.parse(new TextDecoder().decode(payload));
    } catch (_) {
      return null;
    }
  }

  /* ── Скрытие видео при плохой связи ───────────────────────────────────────
     Прячем видео ТОЛЬКО у конкретного участника с плохим каналом, а не у всех:
       • ушёл в 'poor'/'lost' → его видео скрыто, плитка остаётся с аватаром;
       • вернулся в 'good'/'excellent' → видео возвращается подпиской.
     Своё видео не трогаем никогда: оно локальное и канал не тратит.
     Баннер показывается по факту наличия хотя бы одного скрытого участника. */
  var LOW_SPEED_DOWN_MS = 1200;      // подтверждаем ухудшение, чтобы не мигало
  var LOW_SPEED_UP_MS = 1800;        // подтверждаем восстановление
  var LOW_SPEED_RESTORED_MS = 2200;  // сколько висит зелёная плашка

  var lowSpeedState = {
    hiddenIds: {},        // identity -> true, у кого скрыто видео
    pendingDown: {},      // identity -> timer
    pendingUp: {},        // identity -> timer
    restoredTimer: null,
    localIdFn: null,
    banner: null
  };

  function lowSpeedBannerHost() {
    return document.querySelector('.ting-stage-wrap')
      || document.querySelector('.ttv-stage-wrap')
      || document.querySelector('.ting-room-main')
      || document.body;
  }

  function ensureLowSpeedBanner() {
    if (lowSpeedState.banner && lowSpeedState.banner.isConnected) return lowSpeedState.banner;
    var host = lowSpeedBannerHost();
    if (!host) return null;
    var el = document.createElement('div');
    el.className = 'ting-net-banner';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML =
      '<span class="ting-net-icon" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M2 8.8a15 15 0 0 1 20 0"/><path d="M5 12.5a10 10 0 0 1 14 0"/>' +
        '<path d="M8.5 16.2a5 5 0 0 1 7 0"/><circle cx="12" cy="20" r="1" fill="currentColor"/>' +
        '</svg>' +
      '</span>' +
      '<span class="ting-net-text"></span>' +
      '<span class="ting-net-bar" aria-hidden="true"><i></i></span>';
    host.appendChild(el);
    lowSpeedState.banner = el;
    return el;
  }

  function hiddenCount() {
    var n = 0;
    for (var k in lowSpeedState.hiddenIds) {
      if (Object.prototype.hasOwnProperty.call(lowSpeedState.hiddenIds, k)) n += 1;
    }
    return n;
  }

  function setLowSpeedText(kind, count) {
    var el = ensureLowSpeedBanner();
    if (!el) return;
    var txt = el.querySelector('.ting-net-text');
    if (txt) {
      if (kind === 'restored') {
        txt.textContent = count > 0
          ? 'Видео восстановилось не у всех — ждём остальных'
          : 'Связь восстановилась — видео возвращается';
      } else if (selfSlow && count <= 1) {
        txt.textContent = 'Ваш интернет слабый — ваше видео скрыто, звук идёт. Вернётся автоматически';
      } else if (selfSlow) {
        txt.textContent = 'Слабый интернет: ваше видео и видео ' + (count - 1)
          + ' участн. скрыто, звук остаётся. Вернётся автоматически';
      } else if (count === 1) {
        txt.textContent = 'У участника низкая скорость — его видео скрыто, звук остаётся. Вернётся автоматически';
      } else {
        txt.textContent = 'Низкая скорость у ' + count + ' участников — их видео скрыто, звук остаётся. Вернётся автоматически';
      }
    }
    el.classList.toggle('is-restored', kind === 'restored');
  }

  function tileNoteText(isTv) {
    return isTv ? 'видео скрыто · медленная связь' : 'видео скрыто · низкая скорость';
  }

  /** Применить скрытие к конкретной плитке (id) или снять его. */
  function applyHiddenToTile(tile, hide) {
    if (!tile) return;
    var isTv = tile.classList.contains('ttv-tile');
    var noteCls = isTv ? 'ttv-tile-netnote' : 'ting-tile-netnote';
    tile.classList.toggle('is-video-hidden', !!hide);
    var note = tile.querySelector('.' + noteCls);
    if (hide) {
      if (!note) {
        note = document.createElement('span');
        note.className = noteCls;
        note.textContent = tileNoteText(isTv);
        tile.appendChild(note);
      }
    } else if (note) {
      try { note.remove(); } catch (_) { /* */ }
    }
  }

  /** Перерисовать скрытие по всем плиткам: только по списку hiddenIds. */
  function paintHiddenTiles() {
    /* Плитки живут в разных контейнерах (CRM/гость/ТВ) — берём по классу.
       Своё видео тоже скрывается, если плохой МОЙ канал: решение
       пользователя «скрывать и своё» — иначе я занимаю канал картинкой,
       которую остальные всё равно не получат. */
    var tiles = document.querySelectorAll('.ting-tile, .ttv-tile');
    Array.prototype.forEach.call(tiles, function (tile) {
      var id = tile.getAttribute('data-id');
      if (!id || id === '__overflow') return;
      applyHiddenToTile(tile, !!lowSpeedState.hiddenIds[id]);
    });
  }

  function syncLowSpeedBanner(kind) {
    var n = hiddenCount();
    if (n > 0) {
      clearTimeout(lowSpeedState.restoredTimer);
      setLowSpeedText('hidden', n);
      var el = ensureLowSpeedBanner();
      if (el) el.classList.add('is-visible');
      return;
    }
    var node = lowSpeedState.banner;
    if (!node) return;
    setLowSpeedText(kind === 'restored' ? 'restored' : 'hidden', 0);
    node.classList.add('is-visible');
    if (kind === 'restored') {
      clearTimeout(lowSpeedState.restoredTimer);
      lowSpeedState.restoredTimer = setTimeout(function () {
        try { node.classList.remove('is-visible'); } catch (_) { /* */ }
      }, LOW_SPEED_RESTORED_MS);
    }
  }

  function hideFor(id) {
    if (!id) return;
    lowSpeedState.hiddenIds[id] = true;
    paintHiddenTiles();
    syncLowSpeedBanner('hidden');
  }

  function showFor(id) {
    if (!id) return;
    delete lowSpeedState.hiddenIds[id];
    paintHiddenTiles();
    syncLowSpeedBanner('restored');
  }

  /**
   * Качество связи КОНКРЕТНОГО участника.
   * q: 'excellent' | 'good' | 'poor' | 'lost' | 'unknown'
   * id: identity участника (пусто → это своё соединение)
   *
   * Ключевая логика:
   *   poor/lost  → скрываем видео ИМЕННО ЭТОГО участника (включая себя);
   *   good/excel → возвращаем его видео.
   * Своё скрываем по решению пользователя: если мой канал не тянет, я всё
   * равно занимаю его картинкой, которую другие не получат — честнее показать
   * аватар и оставить чистый звук.
   */
  function noteConnectionQuality(q, id) {
    var quality = String(q || '').replace(/^ConnectionQuality\./, '').toLowerCase();
    var localId = null;
    try { localId = lowSpeedState.localIdFn ? lowSpeedState.localIdFn() : null; } catch (_) { /* */ }
    /* Пустой id — сигнал «это я»: адресуем на свою плитку, если она известна. */
    var target = id || localId;
    if (!target) return;
    var isSelf = !!(localId && target === localId);
    var bad = (quality === 'poor' || quality === 'lost');
    var goodQ = (quality === 'excellent' || quality === 'good');
    var key = target;

    if (bad) {
      clearTimeout(lowSpeedState.pendingUp[key]);
      delete lowSpeedState.pendingUp[key];
      if (lowSpeedState.hiddenIds[key] || lowSpeedState.pendingDown[key]) return;
      lowSpeedState.pendingDown[key] = setTimeout(function () {
        delete lowSpeedState.pendingDown[key];
        if (isSelf) selfSlow = true;
        hideFor(key);
      }, LOW_SPEED_DOWN_MS);
      return;
    }
    if (goodQ) {
      clearTimeout(lowSpeedState.pendingDown[key]);
      delete lowSpeedState.pendingDown[key];
      if (!lowSpeedState.hiddenIds[key] || lowSpeedState.pendingUp[key]) return;
      lowSpeedState.pendingUp[key] = setTimeout(function () {
        delete lowSpeedState.pendingUp[key];
        if (isSelf) selfSlow = false;
        showFor(key);
      }, LOW_SPEED_UP_MS);
    }
  }

  /* «Мой канал плохой»: своё видео скрыто — баннер объясняет почему. */
  var selfSlow = false;

  function resetLowSpeed() {
    for (var k in lowSpeedState.pendingDown) clearTimeout(lowSpeedState.pendingDown[k]);
    for (var u in lowSpeedState.pendingUp) clearTimeout(lowSpeedState.pendingUp[u]);
    lowSpeedState.pendingDown = {};
    lowSpeedState.pendingUp = {};
    lowSpeedState.hiddenIds = {};
    selfSlow = false;
    clearTimeout(lowSpeedState.restoredTimer);
    lowSpeedState.restoredTimer = null;
    document.body.classList.remove('ting-low-bandwidth');
    paintHiddenTiles();
    var el = lowSpeedState.banner;
    if (el) { try { el.classList.remove('is-visible', 'is-self'); } catch (_) { /* */ } }
  }

  global.TingRoomCore = {
    trackIsLive: trackIsLive,
    pickVideoTrack: pickVideoTrack,
    publishData: publishData,
    showReactionBurst: showReactionBurst,
    parseDataPayload: parseDataPayload,
    lowSpeed: {
      note: noteConnectionQuality,
      reset: resetLowSpeed,
      isActive: function () { return hiddenCount() > 0; },
      hiddenCount: hiddenCount,
      hiddenIds: function () { return Object.keys(lowSpeedState.hiddenIds); },
      setLocalIdFn: function (fn) { lowSpeedState.localIdFn = fn; },
      refreshTiles: paintHiddenTiles
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
