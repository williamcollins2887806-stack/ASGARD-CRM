/* ASGARD Ting — shared helpers (CRM + guest). No mp3; mute: localStorage ting_sound_off=1 */
(function (global) {
  'use strict';

  function initials(name) {
    const base = String(name || '?').replace(/\([^)]*\)/g, ' ').replace(/[^\u0400-\u04FFa-zA-Z0-9\s.-]/g, ' ').trim();
    const parts = base.split(/\s+/).filter(Boolean).slice(0, 2);
    const out = parts.map((s) => {
      const m = s.match(/[\u0400-\u04FFa-zA-Z]/);
      return m ? m[0].toUpperCase() : '';
    }).join('');
    return out || '?';
  }

  function avatarTone(identity) {
    const s = String(identity || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h) % 6;
  }

  let audioCtx = null;
  function ac() {
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
  }

  function tone(freq, dur, type, gain) {
    try {
      if (global.localStorage && global.localStorage.getItem('ting_sound_off') === '1') return;
      const c = ac();
      if (!c) return;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.value = gain == null ? 0.045 : gain;
      o.connect(g);
      g.connect(c.destination);
      const t0 = c.currentTime;
      g.gain.setValueAtTime(g.gain.value, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    } catch (_) { /* ignore */ }
  }

  const TingSound = {
    play(kind) {
      if (kind === 'join') {
        tone(523.25, 0.09);
        setTimeout(() => tone(659.25, 0.12), 70);
      } else if (kind === 'mic') {
        tone(440, 0.06, 'triangle', 0.035);
      } else if (kind === 'end') {
        tone(392, 0.1, 'sine', 0.04);
        setTimeout(() => tone(293.66, 0.16, 'sine', 0.035), 90);
      }
    }
  };

  /** Dedupe chat messages by id or author+text+time bucket */
  function chatKey(m) {
    if (!m) return '';
    if (m.id != null) return 'id:' + m.id;
    const t = String(m.text || '').trim();
    const who = m.identity || m.user_id || m.display_name || m.author || '';
    const ts = m.created_at || m.ts || '';
    return who + '|' + t + '|' + ts;
  }

  function mergeChat(prev, incoming) {
    const out = Array.isArray(prev) ? prev.slice() : [];
    const seen = new Set(out.map(chatKey));
    (incoming || []).forEach((m) => {
      const k = chatKey(m);
      if (!k || seen.has(k)) return;
      seen.add(k);
      out.push(m);
    });
    return out;
  }

  global.TingCommon = { initials, avatarTone, TingSound, chatKey, mergeChat };
  global.TingSound = TingSound;
})(typeof window !== 'undefined' ? window : globalThis);
