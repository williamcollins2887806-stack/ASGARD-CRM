/* ASGARD Ting — единый медиа-профиль (D-192).
 *
 * Зачем: конфиг публикации был скопирован в три файла (CRM, гость, ТВ) и
 * разошёлся. На ТВ стоял правильный профиль (потолок 720p, три слоя), а в CRM
 * и у гостя — пять слоёв с верхним 4K. SDK берёт ровно три rid (q/h/f), поэтому
 * промежуточные 720p/1080p просто выбрасывались, и на обычном канале зритель
 * получал 360p. Это и была жалоба «картинка как 140-360p».
 *
 * Теперь профиль один на все поверхности. Меняем здесь — меняется везде.
 *
 * Правила, которые нельзя переиграть обратно:
 *   1. Слоёв РОВНО три (q/h/f). Больше SDK не публикует — лишние пресеты
 *      только путают: кажется, что «есть 4K», а его нет.
 *   2. Верхний слой — не выше 720p для звонка. 4K-битрейт (8 Мбит/с вверх)
 *      душит Wi-Fi и роняет собственный приём (подтверждено логами LiveKit).
 *   3. H264 — только после проверки RTCRtpSender.getCapabilities: SDK проверяет
 *      поддержку лишь для av1/vp9, для h264 проверки нет, и на устройстве без
 *      H264-энкодера публикация деградирует молча.
 *   4. backupCodec: false — иначе SDK публикует H264 И VP8 одновременно,
 *      удваивая исходящий битрейт.
 *   5. degradationPreference — в publish-опциях, НЕ внутри videoEncoding
 *      (там только maxBitrate/maxFramerate/priority, значение игнорируется).
 */
(function (global) {
  'use strict';

  /**
   * Умеет ли браузер кодировать H264.
   * SDK этого не проверяет — проверяем сами.
   */
  function h264Supported() {
    try {
      if (typeof RTCRtpSender === 'undefined' || !RTCRtpSender.getCapabilities) return false;
      var caps = RTCRtpSender.getCapabilities('video');
      if (!caps || !caps.codecs) return false;
      for (var i = 0; i < caps.codecs.length; i += 1) {
        if (/video\/h264/i.test(String((caps.codecs[i] && caps.codecs[i].mimeType) || ''))) return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  /**
   * Слои simulcast: ровно три, по возрастанию.
   * SDK берёт p[0], p[1] и основной слой (videoEncoding) — то есть третий rid
   * формируется из верхнего пресета. Поэтому «верхний» здесь и есть потолок
   * качества, который увидит зритель на хорошем канале.
   *
   * @param {object} LK  window.LivekitClient
   * @param {object} [opts]
   * @param {number} [opts.maxHeight=720] потолок по высоте: 360 | 540 | 720
   * @returns {{ layers: Array, videoEncoding: object|undefined }}
   */
  function buildPublishProfile(LK, opts) {
    var maxHeight = (opts && opts.maxHeight) || 720;
    var layers = [];
    var presets = LK && LK.VideoPresets;
    if (!presets) return { layers: layers, videoEncoding: undefined };

    /* Нижние слои — фиксированные: 180p и 360p дают адаптацию на слабом канале. */
    if (presets.h180) layers.push(presets.h180);
    if (presets.h360) layers.push(presets.h360);

    /* Верхний слой — по потолку. h720 по умолчанию; h540 для узких экранов. */
    var top = null;
    if (maxHeight >= 720 && presets.h720) top = presets.h720;
    else if (maxHeight >= 540 && presets.h540) top = presets.h540;
    else if (maxHeight >= 360 && presets.h360) top = presets.h360;
    if (!top) top = presets.h360 || null;
    if (top) layers.push(top);

    return {
      layers: layers,
      videoEncoding: top && top.encoding ? top.encoding : undefined
    };
  }

  /**
   * Готовый объект publishDefaults для new Room({ publishDefaults }).
   * @param {object} LK
   * @param {object} [opts] { maxHeight }
   */
  function buildPublishDefaults(LK, opts) {
    var profile = buildPublishProfile(LK, opts);
    /* simulcast по умолчанию включён (CRM и гость на нём). ТВ отключает:
       телевизор отдаёт один поток, три энкодера на кадр его душат, а зрителям
       всё равно уходит верхний слой. */
    var simulcast = !(opts && opts.simulcast === false);
    var defaults = {
      simulcast: simulcast,
      videoSimulcastLayers: simulcast ? profile.layers : [],
      /* D-416: плавность вместо разрешения, как у Телемоста.
         `maintain-resolution` при просадке канала режет кадры — картинка
         «залипает» (низкий fps при формально высоком разрешении). `balanced`
         разрешает SDK снизить разрешение, сохранив частоту кадров: движение
         остаётся плавным, а глаз замечает это меньше, чем рывки. */
      degradationPreference: 'balanced',
      /* Строкой: LK.VideoCodec в рантайме 2.9.1 не экспортируется. */
      videoCodec: h264Supported() ? 'h264' : 'vp8',
      backupCodec: false
    };
    if (profile.videoEncoding) defaults.videoEncoding = profile.videoEncoding;
    return defaults;
  }

  /**
   * Задержка воспроизведения. Это НЕ опция Room — только метод трека,
   * и единицы СЕКУНДЫ (0.15 = 150 мс). Меньше буфер — быстрее реакция.
   */
  function attachPlayoutDelay(track, sec) {
    try {
      if (!track || track.kind !== 'video') return false;
      if (typeof track.setPlayoutDelay !== 'function') return false;
      track.setPlayoutDelay(typeof sec === 'number' ? sec : 0.15);
      return true;
    } catch (_) {
      /* Браузер без playoutDelayHint — SDK пишет warn, звонок не страдает. */
      return false;
    }
  }

  /**
   * Снимок метрик из RTCPeerConnection.getStats().
   * Возвращает нормализованный объект для отправки в thing_client_metrics.
   * Читаем ОБА pc: outbound-метрики (энкодер) есть только у publisher,
   * inbound (потери/фризы) — у subscriber.
   */
  var lastPacketsLost = null;
  /* D-402: реальный исходящий битрейт считаем по дельте bytesSent — targetBitrate
     это ЦЕЛЬ энкодера, а не то, что реально ушло в сеть. Именно из-за этого
     в телеметрии стояли красивые цифры при плохой картинке (и наоборот). */
  var lastBytesSent = null;
  var lastBytesTs = 0;

  async function collectStats(pubPc, subPc) {
    var out = {
      width: null, height: null, fps: null, bitrateKbps: null,
      packetsLost: null, jitterMs: null, freezeCount: null,
      rttMs: null, icePair: null, limiter: null, codec: null,
      ts: new Date().toISOString()
    };
    var num = function (v) { return typeof v === 'number' && isFinite(v); };

    async function read(pc, isPub) {
      if (!pc || typeof pc.getStats !== 'function') return null;
      try {
        return await pc.getStats();
      } catch (_) {
        return null;
      }
    }

    var pubReport = await read(pubPc, true);
    var subReport = await read(subPc, false);

    if (pubReport) {
      /* D-402: при simulcast у publisher НЕСКОЛЬКО outbound-rtp (по одному на
         слой: h180/h360/h720). Старый код перезаписывал поля на каждой итерации,
         поэтому в телеметрию попадал ПОСЛЕДНИЙ — самый низкий — слой:
         в таблице стояло 320x180 и 121 кбит/с при нормальном канале, и выводы
         о качестве делались по нижнему слою. Берём слой с максимальным
         битрейтом: он и есть то, что видит зритель на хорошей связи. */
      var bestOut = null;
      var bestBw = -1;
      pubReport.forEach(function (s) {
        if (s.type === 'outbound-rtp' && s.kind === 'video') {
          var bw = num(s.targetBitrate) ? s.targetBitrate : 0;
          if (bw > bestBw) { bestBw = bw; bestOut = s; }
        }
      });
      if (bestOut) {
        if (bestOut.qualityLimitationReason) out.limiter = String(bestOut.qualityLimitationReason);
        if (num(bestOut.frameWidth)) out.width = bestOut.frameWidth;
        if (num(bestOut.frameHeight)) out.height = bestOut.frameHeight;
        if (num(bestOut.framesPerSecond)) out.fps = Math.round(bestOut.framesPerSecond);
        /* Реальный битрейт по байтам: дельта bytesSent / дельта времени.
           targetBitrate оставляем как запасной вариант (первый сэмпл). */
        var nowTs = Date.now();
        if (num(bestOut.bytesSent)) {
          if (lastBytesSent != null && lastBytesTs && nowTs > lastBytesTs) {
            var dBytes = bestOut.bytesSent - lastBytesSent;
            var dSec = (nowTs - lastBytesTs) / 1000;
            if (dBytes > 0 && dSec > 0.5) out.bitrateKbps = Math.round((dBytes * 8) / dSec / 1000);
          }
          lastBytesSent = bestOut.bytesSent;
          lastBytesTs = nowTs;
        }
        if (out.bitrateKbps == null && num(bestOut.targetBitrate)) {
          out.bitrateKbps = Math.round(bestOut.targetBitrate / 1000);
        }
      }
      pubReport.forEach(function (s) {
        if (s.type === 'candidate-pair' && (s.selected || s.nominated || s.state === 'succeeded')) {
          if (num(s.currentRoundTripTime)) out.rttMs = Math.round(s.currentRoundTripTime * 1000);
          var loc = pubReport.get && pubReport.get(s.localCandidateId);
          if (loc && !out.icePair) {
            out.icePair = String(loc.candidateType || '?') + '/' + String(loc.protocol || '?');
          }
        }
      });
    }

    if (subReport) {
      subReport.forEach(function (s) {
        if (s.type === 'inbound-rtp' && s.kind === 'video') {
          /* packetsLost в WebRTC — НАКОПИТЕЛЬНЫЙ счётчик. Раньше он уходил
             как есть, и в каждой строке стояло одно и то же число (915 у
             user_1), из-за чего метрика выглядела грозно, но ничего не
             показывала. Шлём дельту между сэмплами: именно она говорит,
             теряем ли пакеты СЕЙЧАС. */
          if (num(s.packetsLost)) {
            var prevLost = lastPacketsLost;
            lastPacketsLost = s.packetsLost;
            out.packetsLost = prevLost == null ? null : Math.max(0, s.packetsLost - prevLost);
          }
          if (num(s.jitter)) out.jitterMs = Math.round(s.jitter * 1000);
          if (num(s.freezeCount)) out.freezeCount = s.freezeCount;
          if (out.width == null && num(s.frameWidth)) out.width = s.frameWidth;
          if (out.height == null && num(s.frameHeight)) out.height = s.frameHeight;
          if (out.fps == null && num(s.framesPerSecond)) out.fps = Math.round(s.framesPerSecond);
          var codec = s.codecId && subReport.get && subReport.get(s.codecId);
          if (codec && codec.mimeType) {
            var m = /video\/([a-z0-9]+)/i.exec(String(codec.mimeType));
            if (m) out.codec = m[1].toLowerCase();
          }
        }
        if (s.type === 'candidate-pair' && (s.selected || s.nominated || s.state === 'succeeded')) {
          if (out.rttMs == null && num(s.currentRoundTripTime)) {
            out.rttMs = Math.round(s.currentRoundTripTime * 1000);
          }
          if (!out.icePair) {
            var locSub = subReport.get && subReport.get(s.localCandidateId);
            if (locSub) out.icePair = String(locSub.candidateType || '?') + '/' + String(locSub.protocol || '?');
          }
        }
      });
    }

    return out;
  }

  /**
   * Достать publisher/subscriber PC из внутренностей SDK.
   * Публичного API нет; путь стабилен в 2.x, при смене — просто вернёт null,
   * и телеметрия молча выключится (звонок не пострадает).
   */
  function peerConnections(room) {
    try {
      var engine = room && (room.engine || (room.room && room.room.engine));
      var pcm = engine && engine.pcManager;
      var pub = pcm && pcm.publisher && (pcm.publisher._pc || pcm.publisher.pc);
      var sub = pcm && pcm.subscriber && (pcm.subscriber._pc || pcm.subscriber.pc);
      return { pub: pub || null, sub: sub || null };
    } catch (_) {
      return { pub: null, sub: null };
    }
  }

  global.TingMediaProfile = {
    h264Supported: h264Supported,
    buildPublishProfile: buildPublishProfile,
    buildPublishDefaults: buildPublishDefaults,
    attachPlayoutDelay: attachPlayoutDelay,
    collectStats: collectStats,
    peerConnections: peerConnections
  };
})(typeof window !== 'undefined' ? window : globalThis);
