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

  global.TingRoomCore = {
    trackIsLive: trackIsLive,
    pickVideoTrack: pickVideoTrack,
    publishData: publishData,
    showReactionBurst: showReactionBurst,
    parseDataPayload: parseDataPayload
  };
})(typeof window !== 'undefined' ? window : globalThis);
