/**
 * ASGARD CRM — Telephony Call Monitoring Popup
 * Premium call monitoring modal with live AI conversation tracking,
 * dispatcher mode, transfer controls, and Web Audio ringtone.
 *
 * SSE integration: app.js calls window.AsgardTelephonyPopup.showIncoming(data) etc.
 * AGI events:      app.js calls window.AsgardTelephonyPopup.handleAgiEvent(data)
 *
 * @version 2.0.0
 * @license Proprietary — ASGARD CRM
 */
window.AsgardTelephonyPopup = (function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /*  Helpers from AsgardUI                                              */
  /* ------------------------------------------------------------------ */
  var $ = (typeof AsgardUI !== 'undefined' && AsgardUI.$) || function (sel, ctx) {
    return (ctx || document).querySelector(sel);
  };
  var esc = (typeof AsgardUI !== 'undefined' && AsgardUI.esc) || function (s) {
    if (s == null) return '';
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(String(s)));
    return d.innerHTML;
  };
  var toast = (typeof AsgardUI !== 'undefined' && AsgardUI.toast) || function () {};

  function api(path, opts) {
    var token = localStorage.getItem('asgard_token');
    var headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
    var merged = Object.assign({ headers: headers }, opts || {});
    return fetch('/api/telephony' + path, merged).then(function (r) { return r.json(); });
  }

  /* ------------------------------------------------------------------ */
  /*  CSS — Injected <style> with design tokens                          */
  /* ------------------------------------------------------------------ */
  var STYLE_ID = 'asgard-telephony-popup-styles';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '/* ===== ASGARD Telephony Popup — Design Tokens ===== */',
      ':root {',
      '  --tp-bg0: #08090C;',
      '  --tp-bg1: #0D1117;',
      '  --tp-bg2: #151922;',
      '  --tp-bg3: #1C2130;',
      '  --tp-bg4: #222838;',
      '  --tp-t1: rgba(255,255,255,0.95);',
      '  --tp-t2: rgba(255,255,255,0.65);',
      '  --tp-t3: rgba(255,255,255,0.40);',
      '  --tp-brd: rgba(255,255,255,0.08);',
      '  --tp-gold: #D4A843;',
      '  --tp-gold-l: #E8C35A;',
      '  --tp-gold-bg: rgba(212,168,67,0.10);',
      '  --tp-blue: #1E4D8C;',
      '  --tp-blue-l: #4A90D9;',
      '  --tp-red: #C8293B;',
      '  --tp-ok: #2D8659;',
      '  --tp-ok-t: #4BC88A;',
      '}',

      /* ===== Container ===== */
      '#telephony-popup-container {',
      '  position: fixed; top: 16px; right: 16px; z-index: 10000;',
      '  pointer-events: none; font-family: "Inter","Segoe UI",system-ui,sans-serif;',
      '}',
      '#telephony-popup-container * { box-sizing: border-box; }',

      /* ===== Compact popup ===== */
      '.tp-popup {',
      '  pointer-events: auto;',
      '  width: 380px;',
      '  background: var(--tp-bg2);',
      '  border: 1px solid var(--tp-brd);',
      '  border-radius: 14px;',
      '  box-shadow: 0 8px 40px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04) inset;',
      '  backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);',
      '  transform: translateX(420px); opacity: 0;',
      '  transition: transform 0.4s cubic-bezier(0.22,1,0.36,1), opacity 0.35s ease;',
      '  overflow: hidden;',
      '}',
      '.tp-popup.tp-visible {',
      '  transform: translateX(0); opacity: 1;',
      '}',
      '.tp-popup.tp-hiding {',
      '  transform: translateX(420px); opacity: 0;',
      '}',

      /* Header */
      '.tp-header {',
      '  display: flex; align-items: center; gap: 10px;',
      '  padding: 14px 16px; border-bottom: 1px solid var(--tp-brd);',
      '}',
      '.tp-status-dot {',
      '  width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0;',
      '  background: var(--tp-ok-t);',
      '  box-shadow: 0 0 6px var(--tp-ok-t);',
      '  animation: tp-pulse 1.6s ease-in-out infinite;',
      '}',
      '.tp-status-dot.tp-st-ringing   { background: var(--tp-ok-t); box-shadow: 0 0 8px var(--tp-ok-t); }',
      '.tp-status-dot.tp-st-ai-talk   { background: var(--tp-blue-l); box-shadow: 0 0 8px var(--tp-blue-l); animation-name: tp-pulse-blue; }',
      '.tp-status-dot.tp-st-ai-listen { background: var(--tp-gold); box-shadow: 0 0 8px var(--tp-gold); animation-name: tp-pulse-gold; }',
      '.tp-status-dot.tp-st-transfer  { background: var(--tp-gold-l); box-shadow: 0 0 8px var(--tp-gold-l); animation-name: tp-pulse-gold; }',
      '.tp-status-dot.tp-st-connected { background: var(--tp-blue-l); box-shadow: 0 0 8px var(--tp-blue-l); animation: none; }',
      '.tp-status-dot.tp-st-ended     { background: var(--tp-t3); box-shadow: none; animation: none; }',
      '.tp-status-dot.tp-st-voicemail { background: var(--tp-red); box-shadow: 0 0 8px var(--tp-red); animation-name: tp-pulse-red; }',

      '@keyframes tp-pulse      { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(1.3)} }',
      '@keyframes tp-pulse-blue { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(1.3)} }',
      '@keyframes tp-pulse-gold { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(1.3)} }',
      '@keyframes tp-pulse-red  { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(1.3)} }',

      '.tp-header-info { flex: 1; min-width: 0; }',
      '.tp-caller-name {',
      '  font-size: 14px; font-weight: 600; color: var(--tp-t1);',
      '  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
      '}',
      '.tp-caller-name.tp-known { color: var(--tp-gold); }',
      '.tp-caller-phone {',
      '  font-size: 12px; color: var(--tp-t2); margin-top: 1px;',
      '  font-variant-numeric: tabular-nums;',
      '}',
      '.tp-timer {',
      '  font-size: 13px; font-weight: 600; color: var(--tp-t2);',
      '  font-variant-numeric: tabular-nums; white-space: nowrap;',
      '}',

      /* Status badge */
      '.tp-status-badge {',
      '  display: inline-flex; align-items: center; gap: 6px;',
      '  padding: 5px 12px; margin: 10px 16px 0;',
      '  border-radius: 8px; font-size: 12px; font-weight: 500;',
      '  background: var(--tp-bg3); color: var(--tp-t2);',
      '}',

      /* Action bar */
      '.tp-actions {',
      '  display: flex; gap: 8px; padding: 12px 16px;',
      '}',
      '.tp-btn {',
      '  flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;',
      '  padding: 9px 12px; border: none; border-radius: 8px; cursor: pointer;',
      '  font-size: 13px; font-weight: 500; font-family: inherit;',
      '  transition: background 0.2s, transform 0.1s, opacity 0.2s;',
      '  outline: none;',
      '}',
      '.tp-btn:active { transform: scale(0.97); }',
      '.tp-btn:disabled { opacity: 0.4; cursor: default; pointer-events: none; }',
      '.tp-btn-expand {',
      '  background: var(--tp-bg4); color: var(--tp-t1);',
      '}',
      '.tp-btn-expand:hover { background: #2a3148; }',
      '.tp-btn-close {',
      '  background: transparent; color: var(--tp-t3); flex: 0 0 auto; padding: 9px;',
      '}',
      '.tp-btn-close:hover { color: var(--tp-t1); }',

      /* ===== Expanded panel ===== */
      '.tp-expanded {',
      '  display: none; border-top: 1px solid var(--tp-brd);',
      '}',
      '.tp-popup.tp-is-expanded .tp-expanded { display: block; }',
      '.tp-popup.tp-is-expanded { width: 440px; }',

      /* Conversation log */
      '.tp-conversation {',
      '  height: 280px; overflow-y: auto; padding: 12px 16px;',
      '  scroll-behavior: smooth;',
      '}',
      '.tp-conversation::-webkit-scrollbar { width: 4px; }',
      '.tp-conversation::-webkit-scrollbar-track { background: transparent; }',
      '.tp-conversation::-webkit-scrollbar-thumb { background: var(--tp-brd); border-radius: 2px; }',

      '.tp-msg {',
      '  display: flex; flex-direction: column; margin-bottom: 10px;',
      '  animation: tp-msg-in 0.3s ease;',
      '}',
      '@keyframes tp-msg-in {',
      '  from { opacity: 0; transform: translateY(8px); }',
      '  to   { opacity: 1; transform: translateY(0); }',
      '}',
      '.tp-msg-ai   { align-items: flex-end; }',
      '.tp-msg-client { align-items: flex-start; }',
      '.tp-msg-system { align-items: center; }',

      '.tp-msg-bubble {',
      '  max-width: 85%; padding: 8px 12px; border-radius: 10px;',
      '  font-size: 13px; line-height: 1.45; word-break: break-word;',
      '}',
      '.tp-msg-ai .tp-msg-bubble {',
      '  background: var(--tp-blue); color: var(--tp-t1);',
      '  border-bottom-right-radius: 3px;',
      '}',
      '.tp-msg-client .tp-msg-bubble {',
      '  background: var(--tp-bg4); color: var(--tp-t1);',
      '  border-bottom-left-radius: 3px;',
      '}',
      '.tp-msg-system .tp-msg-bubble {',
      '  background: transparent; color: var(--tp-t3);',
      '  font-size: 11px; font-style: italic; padding: 4px 0;',
      '}',
      '.tp-msg-time {',
      '  font-size: 10px; color: var(--tp-t3); margin-top: 2px; padding: 0 2px;',
      '  font-variant-numeric: tabular-nums;',
      '}',

      /* Listening indicator */
      '.tp-listening-indicator {',
      '  display: flex; align-items: center; gap: 6px;',
      '  padding: 6px 16px; color: var(--tp-t3); font-size: 12px;',
      '}',
      '.tp-listening-dots { display: flex; gap: 3px; }',
      '.tp-listening-dots span {',
      '  width: 5px; height: 5px; border-radius: 50%;',
      '  background: var(--tp-gold); opacity: 0.4;',
      '  animation: tp-dot-bounce 1.2s ease-in-out infinite;',
      '}',
      '.tp-listening-dots span:nth-child(2) { animation-delay: 0.2s; }',
      '.tp-listening-dots span:nth-child(3) { animation-delay: 0.4s; }',
      '@keyframes tp-dot-bounce {',
      '  0%,60%,100% { opacity: 0.3; transform: translateY(0); }',
      '  30%          { opacity: 1;   transform: translateY(-4px); }',
      '}',

      /* Transfer section */
      '.tp-transfer {',
      '  padding: 12px 16px; border-top: 1px solid var(--tp-brd);',
      '}',
      '.tp-transfer-title {',
      '  font-size: 11px; font-weight: 600; color: var(--tp-t3);',
      '  text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;',
      '}',
      '.tp-transfer-row { display: flex; gap: 8px; }',
      '.tp-select-wrap {',
      '  flex: 1; position: relative;',
      '}',
      '.tp-select {',
      '  width: 100%; padding: 8px 30px 8px 10px;',
      '  background: var(--tp-bg3); color: var(--tp-t1);',
      '  border: 1px solid var(--tp-brd); border-radius: 8px;',
      '  font-size: 13px; font-family: inherit;',
      '  appearance: none; -webkit-appearance: none;',
      '  cursor: pointer; outline: none;',
      '  transition: border-color 0.2s;',
      '}',
      '.tp-select:focus { border-color: var(--tp-blue-l); }',
      '.tp-select-arrow {',
      '  position: absolute; right: 10px; top: 50%; transform: translateY(-50%);',
      '  pointer-events: none; color: var(--tp-t3);',
      '}',
      '.tp-btn-transfer {',
      '  background: var(--tp-blue); color: var(--tp-t1);',
      '  flex: 0 0 auto; padding: 8px 16px;',
      '}',
      '.tp-btn-transfer:hover { background: #25599e; }',
      '.tp-btn-takeover {',
      '  width: 100%; margin-top: 8px;',
      '  background: var(--tp-gold-bg); color: var(--tp-gold);',
      '  border: 1px solid rgba(212,168,67,0.2);',
      '}',
      '.tp-btn-takeover:hover { background: rgba(212,168,67,0.18); }',

      /* Summary */
      '.tp-summary {',
      '  padding: 12px 16px; border-top: 1px solid var(--tp-brd);',
      '  display: none;',
      '}',
      '.tp-summary.tp-show { display: block; }',
      '.tp-summary-title {',
      '  font-size: 11px; font-weight: 600; color: var(--tp-t3);',
      '  text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;',
      '}',
      '.tp-summary-text {',
      '  font-size: 13px; color: var(--tp-t2); line-height: 1.5;',
      '}',

      /* ===== Dispatcher toggle ===== */
      '#telephony-dispatcher-toggle {',
      '  position: fixed; bottom: 110px; left: 10px; z-index: 9999;',
      '  font-family: "Inter","Segoe UI",system-ui,sans-serif;',
      '}',
      '.tp-dispatcher-btn {',
      '  width: 44px; height: 44px; border-radius: 50%;',
      '  border: 2px solid var(--tp-brd);',
      '  background: var(--tp-bg2);',
      '  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);',
      '  cursor: pointer; display: flex; align-items: center; justify-content: center;',
      '  transition: border-color 0.3s, box-shadow 0.3s, transform 0.15s;',
      '  box-shadow: 0 4px 16px rgba(0,0,0,0.4);',
      '  outline: none;',
      '}',
      '.tp-dispatcher-btn:hover { transform: scale(1.07); }',
      '.tp-dispatcher-btn:active { transform: scale(0.95); }',
      '.tp-dispatcher-btn.tp-disp-active {',
      '  border-color: var(--tp-ok); box-shadow: 0 0 12px rgba(45,134,89,0.35);',
      '}',
      '.tp-dispatcher-btn svg {',
      '  width: 20px; height: 20px; color: var(--tp-t3); transition: color 0.3s;',
      '}',
      '.tp-dispatcher-btn.tp-disp-active svg { color: var(--tp-ok-t); }',

      /* Tooltip */
      '.tp-disp-tooltip {',
      '  position: absolute; bottom: 0; left: 52px;',
      '  min-width: 200px; padding: 10px 14px;',
      '  background: var(--tp-bg2); border: 1px solid var(--tp-brd);',
      '  border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,0.5);',
      '  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);',
      '  font-size: 12px; color: var(--tp-t2);',
      '  transform: translateY(8px); opacity: 0;',
      '  transition: transform 0.25s ease, opacity 0.2s ease;',
      '  pointer-events: none;',
      '}',
      '.tp-disp-tooltip.tp-tt-visible {',
      '  transform: translateY(0); opacity: 1; pointer-events: auto;',
      '}',
      '.tp-disp-tooltip-title {',
      '  font-weight: 600; color: var(--tp-t1); margin-bottom: 4px; font-size: 13px;',
      '}',
      '.tp-disp-tooltip-warn {',
      '  color: var(--tp-gold); margin-top: 6px; font-size: 11px;',
      '}',
      '.tp-disp-tooltip-toggle {',
      '  display: block; width: 100%; margin-top: 8px; padding: 7px;',
      '  background: var(--tp-bg4); color: var(--tp-t1);',
      '  border: 1px solid var(--tp-brd); border-radius: 6px;',
      '  font-size: 12px; font-family: inherit; cursor: pointer;',
      '  text-align: center; transition: background 0.2s;',
      '}',
      '.tp-disp-tooltip-toggle:hover { background: #2a3148; }',
      '.tp-disp-tooltip-toggle.tp-tt-on {',
      '  background: rgba(45,134,89,0.15); color: var(--tp-ok-t);',
      '  border-color: rgba(45,134,89,0.3);',
      '}',
      '.tp-disp-tooltip-toggle.tp-tt-off {',
      '  background: rgba(200,41,59,0.12); color: var(--tp-red);',
      '  border-color: rgba(200,41,59,0.25);',
      '}',

      ''
    ].join('\n');
    document.head.appendChild(style);
  }

  /* ------------------------------------------------------------------ */
  /*  Phone formatting                                                   */
  /* ------------------------------------------------------------------ */
  function formatPhone(raw) {
    if (!raw) return '';
    var d = String(raw).replace(/\D/g, '');
    if (d.length === 11 && (d[0] === '7' || d[0] === '8')) {
      return '+7 (' + d.substr(1, 3) + ') ' + d.substr(4, 3) + '-' + d.substr(7, 2) + '-' + d.substr(9, 2);
    }
    if (d.length === 10) {
      return '+7 (' + d.substr(0, 3) + ') ' + d.substr(3, 3) + '-' + d.substr(6, 2) + '-' + d.substr(8, 2);
    }
    return raw;
  }

  function timeStr() {
    var n = new Date();
    return ('0' + n.getHours()).slice(-2) + ':' + ('0' + n.getMinutes()).slice(-2) + ':' + ('0' + n.getSeconds()).slice(-2);
  }

  function durationStr(sec) {
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return ('0' + m).slice(-2) + ':' + ('0' + s).slice(-2);
  }

  /* ------------------------------------------------------------------ */
  /*  SVG icons (inline)                                                 */
  /* ------------------------------------------------------------------ */
  var ICONS = {
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>',
    headset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0118 0v6"/><path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3v5zM3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3v5z"/></svg>',
    expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',
    collapse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    transfer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 014-4h12"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    chevDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="6 9 12 15 18 9"/></svg>'
  };

  /* ------------------------------------------------------------------ */
  /*  State                                                              */
  /* ------------------------------------------------------------------ */
  var state = {
    visible: false,
    expanded: false,
    callId: null,
    callerNumber: '',
    callerName: '',
    clientName: '',
    calledNumber: '',
    status: 'ringing',       // ringing | ai-talk | ai-listen | transfer | connected | ended | voicemail
    statusText: '',
    timerStart: null,
    timerInterval: null,
    timerSec: 0,
    messages: [],            // { type: 'ai'|'client'|'system', text: '', time: '' }
    employees: [],
    dispatcherActive: false,
    dispatcherName: '',
    dispatcherLoading: false,
    autoHideTimer: null,
    summary: '',
    ringtoneActive: false
  };

  /* DOM refs */
  var dom = {};

  /* ------------------------------------------------------------------ */
  /*  Web Audio Ringtone                                                 */
  /* ------------------------------------------------------------------ */
  var audioCtx = null;
  var ringOsc1 = null;
  var ringOsc2 = null;
  var ringGain = null;
  var ringInterval = null;

  function ensureAudioCtx() {
    if (!audioCtx) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    return audioCtx;
  }

  function startRingtone() {
    if (state.ringtoneActive) return;
    var ctx = ensureAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();

    state.ringtoneActive = true;

    function playBurst() {
      if (!state.ringtoneActive) return;
      try {
        ringGain = ctx.createGain();
        ringGain.gain.setValueAtTime(0, ctx.currentTime);
        ringGain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.02);
        ringGain.gain.setValueAtTime(0.15, ctx.currentTime + 0.98);
        ringGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.0);
        ringGain.connect(ctx.destination);

        ringOsc1 = ctx.createOscillator();
        ringOsc1.type = 'sine';
        ringOsc1.frequency.setValueAtTime(440, ctx.currentTime);
        ringOsc1.connect(ringGain);
        ringOsc1.start(ctx.currentTime);
        ringOsc1.stop(ctx.currentTime + 1.0);

        ringOsc2 = ctx.createOscillator();
        ringOsc2.type = 'sine';
        ringOsc2.frequency.setValueAtTime(480, ctx.currentTime);
        ringOsc2.connect(ringGain);
        ringOsc2.start(ctx.currentTime);
        ringOsc2.stop(ctx.currentTime + 1.0);
      } catch (e) { /* audio policy block, ignore */ }
    }

    playBurst();
    ringInterval = setInterval(function () {
      if (!state.ringtoneActive) { clearInterval(ringInterval); return; }
      playBurst();
    }, 4000); // 1s on + 3s off = 4s cycle
  }

  function stopRingtone() {
    state.ringtoneActive = false;
    if (ringInterval) { clearInterval(ringInterval); ringInterval = null; }
    try { if (ringOsc1) ringOsc1.disconnect(); } catch (e) {}
    try { if (ringOsc2) ringOsc2.disconnect(); } catch (e) {}
    try { if (ringGain) ringGain.disconnect(); } catch (e) {}
    ringOsc1 = null; ringOsc2 = null; ringGain = null;
  }

  /* ------------------------------------------------------------------ */
  /*  Build DOM                                                          */
  /* ------------------------------------------------------------------ */
  function ensureContainer() {
    if (dom.container) return;
    injectStyles();

    /* Popup container */
    var c = document.getElementById('telephony-popup-container');
    if (!c) {
      c = document.createElement('div');
      c.id = 'telephony-popup-container';
      document.body.appendChild(c);
    }
    dom.container = c;
    c.innerHTML = '';

    /* Build popup */
    var popup = document.createElement('div');
    popup.className = 'tp-popup';
    dom.popup = popup;

    /* --- Header --- */
    var header = document.createElement('div');
    header.className = 'tp-header';

    dom.statusDot = document.createElement('div');
    dom.statusDot.className = 'tp-status-dot tp-st-ringing';

    var info = document.createElement('div');
    info.className = 'tp-header-info';
    dom.callerName = document.createElement('div');
    dom.callerName.className = 'tp-caller-name';
    dom.callerPhone = document.createElement('div');
    dom.callerPhone.className = 'tp-caller-phone';
    info.appendChild(dom.callerName);
    info.appendChild(dom.callerPhone);

    dom.timer = document.createElement('div');
    dom.timer.className = 'tp-timer';
    dom.timer.textContent = '00:00';

    header.appendChild(dom.statusDot);
    header.appendChild(info);
    header.appendChild(dom.timer);
    popup.appendChild(header);

    /* --- Status badge --- */
    dom.statusBadge = document.createElement('div');
    dom.statusBadge.className = 'tp-status-badge';
    popup.appendChild(dom.statusBadge);

    /* --- Actions --- */
    var actions = document.createElement('div');
    actions.className = 'tp-actions';

    dom.btnExpand = document.createElement('button');
    dom.btnExpand.className = 'tp-btn tp-btn-expand';
    dom.btnExpand.innerHTML = '<span style="width:16px;height:16px;display:inline-flex">' + ICONS.expand + '</span> \u041F\u043E\u0434\u0440\u043E\u0431\u043D\u0435\u0435';
    dom.btnExpand.onclick = toggleExpand;

    dom.btnClose = document.createElement('button');
    dom.btnClose.className = 'tp-btn tp-btn-close';
    dom.btnClose.innerHTML = '<span style="width:18px;height:18px;display:inline-flex">' + ICONS.close + '</span>';
    dom.btnClose.title = '\u0417\u0430\u043A\u0440\u044B\u0442\u044C';
    dom.btnClose.onclick = hide;

    actions.appendChild(dom.btnExpand);
    actions.appendChild(dom.btnClose);
    popup.appendChild(actions);

    /* --- Expanded panel --- */
    var expanded = document.createElement('div');
    expanded.className = 'tp-expanded';
    dom.expandedPanel = expanded;

    /* Conversation */
    dom.conversation = document.createElement('div');
    dom.conversation.className = 'tp-conversation';
    expanded.appendChild(dom.conversation);

    /* Listening indicator */
    dom.listeningIndicator = document.createElement('div');
    dom.listeningIndicator.className = 'tp-listening-indicator';
    dom.listeningIndicator.style.display = 'none';
    dom.listeningIndicator.innerHTML =
      '<div class="tp-listening-dots"><span></span><span></span><span></span></div>' +
      ' <span>\u041A\u043B\u0438\u0435\u043D\u0442 \u0433\u043E\u0432\u043E\u0440\u0438\u0442...</span>';
    expanded.appendChild(dom.listeningIndicator);

    /* Transfer */
    var transfer = document.createElement('div');
    transfer.className = 'tp-transfer';
    transfer.innerHTML =
      '<div class="tp-transfer-title">\u041F\u0435\u0440\u0435\u0432\u043E\u0434 \u0437\u0432\u043E\u043D\u043A\u0430</div>' +
      '<div class="tp-transfer-row">' +
        '<div class="tp-select-wrap">' +
          '<select class="tp-select" id="tp-employee-select">' +
            '<option value="">\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u0430...</option>' +
          '</select>' +
          '<span class="tp-select-arrow">' + ICONS.chevDown + '</span>' +
        '</div>' +
        '<button class="tp-btn tp-btn-transfer" id="tp-btn-do-transfer">' +
          '<span style="width:16px;height:16px;display:inline-flex">' + ICONS.transfer + '</span> \u041F\u0435\u0440\u0435\u0432\u0435\u0441\u0442\u0438' +
        '</button>' +
      '</div>' +
      '<button class="tp-btn tp-btn-takeover" id="tp-btn-takeover">' +
        '<span style="width:16px;height:16px;display:inline-flex">' + ICONS.headset + '</span> \u041F\u0440\u0438\u043D\u044F\u0442\u044C \u043D\u0430 \u0441\u0435\u0431\u044F' +
      '</button>';
    expanded.appendChild(transfer);

    /* Summary */
    dom.summaryBlock = document.createElement('div');
    dom.summaryBlock.className = 'tp-summary';
    dom.summaryBlock.innerHTML =
      '<div class="tp-summary-title">\u0418\u0442\u043E\u0433 \u0440\u0430\u0437\u0433\u043E\u0432\u043E\u0440\u0430</div>' +
      '<div class="tp-summary-text" id="tp-summary-text"></div>';
    expanded.appendChild(dom.summaryBlock);

    popup.appendChild(expanded);
    c.appendChild(popup);

    /* Cache additional refs */
    dom.selectEmployee = popup.querySelector('#tp-employee-select');
    dom.btnDoTransfer = popup.querySelector('#tp-btn-do-transfer');
    dom.btnTakeover = popup.querySelector('#tp-btn-takeover');
    dom.summaryText = popup.querySelector('#tp-summary-text');

    dom.btnDoTransfer.onclick = doTransfer;
    dom.btnTakeover.onclick = doTakeover;

    /* --- Dispatcher toggle --- */
    var dWrap = document.getElementById('telephony-dispatcher-toggle');
    if (!dWrap) {
      dWrap = document.createElement('div');
      dWrap.id = 'telephony-dispatcher-toggle';
      document.body.appendChild(dWrap);
    }
    dom.dispWrap = dWrap;
    dWrap.innerHTML = '';

    var dBtn = document.createElement('button');
    dBtn.className = 'tp-dispatcher-btn';
    dBtn.innerHTML = ICONS.headset;
    dBtn.title = '\u0414\u0438\u0441\u043F\u0435\u0442\u0447\u0435\u0440 \u0437\u0432\u043E\u043D\u043A\u043E\u0432';
    dom.dispBtn = dBtn;

    var tooltip = document.createElement('div');
    tooltip.className = 'tp-disp-tooltip';
    dom.dispTooltip = tooltip;
    tooltip.innerHTML =
      '<div class="tp-disp-tooltip-title">\u0414\u0438\u0441\u043F\u0435\u0442\u0447\u0435\u0440 \u0437\u0432\u043E\u043D\u043A\u043E\u0432</div>' +
      '<div id="tp-disp-status-text">\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430...</div>' +
      '<div class="tp-disp-tooltip-warn" id="tp-disp-warn" style="display:none"></div>' +
      '<button class="tp-disp-tooltip-toggle" id="tp-disp-toggle-btn">\u0412\u043A\u043B\u044E\u0447\u0438\u0442\u044C</button>';
    dom.dispStatusText = tooltip.querySelector('#tp-disp-status-text');
    dom.dispWarn = tooltip.querySelector('#tp-disp-warn');
    dom.dispToggleBtn = tooltip.querySelector('#tp-disp-toggle-btn');

    dWrap.appendChild(tooltip);
    dWrap.appendChild(dBtn);

    var tooltipVisible = false;
    dBtn.onclick = function () {
      tooltipVisible = !tooltipVisible;
      if (tooltipVisible) {
        tooltip.classList.add('tp-tt-visible');
        loadDispatcherStatus();
      } else {
        tooltip.classList.remove('tp-tt-visible');
      }
    };

    /* Close tooltip on outside click */
    document.addEventListener('click', function (e) {
      if (tooltipVisible && !dWrap.contains(e.target)) {
        tooltipVisible = false;
        tooltip.classList.remove('tp-tt-visible');
      }
    });

    dom.dispToggleBtn.onclick = toggleDispatcher;
  }

  /* ------------------------------------------------------------------ */
  /*  Render helpers                                                     */
  /* ------------------------------------------------------------------ */
  var STATUS_LABELS = {
    'ringing':    '\u0412\u0445\u043E\u0434\u044F\u0449\u0438\u0439 \u0437\u0432\u043E\u043D\u043E\u043A',
    'ai-talk':    'AI \u0433\u043E\u0432\u043E\u0440\u0438\u0442',
    'ai-listen':  'AI \u0441\u043B\u0443\u0448\u0430\u0435\u0442',
    'transfer':   '\u041F\u0435\u0440\u0435\u0432\u043E\u0434 \u0437\u0432\u043E\u043D\u043A\u0430',
    'connected':  '\u0421\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u043E',
    'ended':      '\u0417\u0432\u043E\u043D\u043E\u043A \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D',
    'voicemail':  '\u0413\u043E\u043B\u043E\u0441\u043E\u0432\u043E\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435'
  };

  function updateStatusUI() {
    var label = state.statusText || STATUS_LABELS[state.status] || state.status;

    /* Dot class */
    dom.statusDot.className = 'tp-status-dot tp-st-' + state.status;

    /* Badge */
    dom.statusBadge.innerHTML =
      '<span style="width:8px;height:8px;display:inline-block;border-radius:50%;background:currentColor;opacity:0.6"></span> ' +
      esc(label);
  }

  function renderCallerInfo() {
    var name = state.clientName || state.callerName || '';
    var known = !!state.clientName;
    dom.callerName.textContent = name || '\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u044B\u0439 \u0430\u0431\u043E\u043D\u0435\u043D\u0442';
    dom.callerName.className = 'tp-caller-name' + (known ? ' tp-known' : '');
    dom.callerPhone.textContent = formatPhone(state.callerNumber);
  }

  function addMessage(type, text) {
    // Дедупликация: не добавлять если последнее сообщение такое же
    if (state.messages.length > 0) {
      var last = state.messages[state.messages.length - 1];
      if (last.type === type && last.text === text) return;
    }
    var msg = { type: type, text: text, time: timeStr() };
    state.messages.push(msg);
    renderMessage(msg);
  }

  function renderMessage(msg) {
    if (!dom.conversation) return;
    var wrapper = document.createElement('div');
    var side = msg.type === 'ai' ? 'ai' : (msg.type === 'client' ? 'client' : 'system');
    wrapper.className = 'tp-msg tp-msg-' + side;

    var bubble = document.createElement('div');
    bubble.className = 'tp-msg-bubble';
    bubble.innerHTML = esc(msg.text);

    var time = document.createElement('div');
    time.className = 'tp-msg-time';
    time.textContent = msg.time;

    wrapper.appendChild(bubble);
    wrapper.appendChild(time);
    dom.conversation.appendChild(wrapper);

    /* Auto-scroll to bottom */
    requestAnimationFrame(function () {
      dom.conversation.scrollTop = dom.conversation.scrollHeight;
    });
  }

  function renderAllMessages() {
    if (!dom.conversation) return;
    dom.conversation.innerHTML = '';
    for (var i = 0; i < state.messages.length; i++) {
      renderMessage(state.messages[i]);
    }
  }

  function setListeningIndicator(show) {
    if (dom.listeningIndicator) {
      dom.listeningIndicator.style.display = show ? 'flex' : 'none';
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Timer                                                              */
  /* ------------------------------------------------------------------ */
  function startTimer() {
    stopTimer();
    state.timerStart = Date.now();
    state.timerSec = 0;
    dom.timer.textContent = '00:00';
    state.timerInterval = setInterval(function () {
      state.timerSec = Math.floor((Date.now() - state.timerStart) / 1000);
      dom.timer.textContent = durationStr(state.timerSec);
    }, 1000);
  }

  function stopTimer() {
    if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }
  }

  /* ------------------------------------------------------------------ */
  /*  Auto-hide                                                          */
  /* ------------------------------------------------------------------ */
  function resetAutoHide() {
    clearAutoHide();
    if (state.expanded) return; // don't auto-hide when expanded
    state.autoHideTimer = setTimeout(function () {
      if (state.visible && !state.expanded && state.status !== 'ringing') {
        hide();
      }
    }, 10000);
  }

  function clearAutoHide() {
    if (state.autoHideTimer) { clearTimeout(state.autoHideTimer); state.autoHideTimer = null; }
  }

  /* ------------------------------------------------------------------ */
  /*  Show / Hide / Toggle                                               */
  /* ------------------------------------------------------------------ */
  function show() {
    ensureContainer();
    state.visible = true;
    dom.popup.classList.remove('tp-hiding');
    /* Force reflow for animation */
    void dom.popup.offsetWidth;
    dom.popup.classList.add('tp-visible');
    resetAutoHide();
  }

  function hide() {
    if (!state.visible) return;
    clearAutoHide();
    stopRingtone();
    dom.popup.classList.remove('tp-visible');
    dom.popup.classList.add('tp-hiding');
    state.visible = false;
    state.expanded = false;
    dom.popup.classList.remove('tp-is-expanded');

    setTimeout(function () {
      dom.popup.classList.remove('tp-hiding');
    }, 450);
  }

  function toggleExpand() {
    state.expanded = !state.expanded;
    clearAutoHide();
    if (state.expanded) {
      dom.popup.classList.add('tp-is-expanded');
      dom.btnExpand.innerHTML = '<span style="width:16px;height:16px;display:inline-flex">' + ICONS.collapse + '</span> \u0421\u0432\u0435\u0440\u043D\u0443\u0442\u044C';
      loadEmployees();
      renderAllMessages();
    } else {
      dom.popup.classList.remove('tp-is-expanded');
      dom.btnExpand.innerHTML = '<span style="width:16px;height:16px;display:inline-flex">' + ICONS.expand + '</span> \u041F\u043E\u0434\u0440\u043E\u0431\u043D\u0435\u0435';
      resetAutoHide();
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Employee loading                                                   */
  /* ------------------------------------------------------------------ */
  var employeesLoaded = false;

  function loadEmployees() {
    if (employeesLoaded && state.employees.length > 0) return;
    api('/employees').then(function (data) {
      var list = data.employees || data.data || data || [];
      if (!Array.isArray(list)) list = [];
      state.employees = list;
      employeesLoaded = true;
      renderEmployeeSelect();
    }).catch(function () {
      /* silently fail */
    });
  }

  function renderEmployeeSelect() {
    if (!dom.selectEmployee) return;
    var html = '<option value="">\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u0430...</option>';
    for (var i = 0; i < state.employees.length; i++) {
      var e = state.employees[i];
      var name = esc(e.full_name || e.name || ('\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A #' + (e.id || i)));
      var phone = e.internal_phone || e.phone || '';
      html += '<option value="' + esc(e.id || '') + '" data-phone="' + esc(phone) + '">' +
        name + (phone ? ' (' + esc(phone) + ')' : '') +
        '</option>';
    }
    dom.selectEmployee.innerHTML = html;
  }

  /* ------------------------------------------------------------------ */
  /*  Transfer                                                           */
  /* ------------------------------------------------------------------ */
  function doTransfer() {
    var sel = dom.selectEmployee;
    if (!sel || !sel.value) {
      toast('\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u0430 \u0434\u043B\u044F \u043F\u0435\u0440\u0435\u0432\u043E\u0434\u0430', 'warn');
      return;
    }
    var opt = sel.options[sel.selectedIndex];
    var employeeId = sel.value;
    var employeeName = opt.textContent;
    var employeePhone = opt.getAttribute('data-phone') || '';

    dom.btnDoTransfer.disabled = true;
    dom.btnDoTransfer.textContent = '\u041F\u0435\u0440\u0435\u0432\u043E\u0434...';

    api('/call-control/transfer', {
      method: 'POST',
      body: JSON.stringify({
        call_id: state.callId,
        employee_id: employeeId,
        employee_phone: employeePhone
      })
    }).then(function (res) {
      if (res.ok || res.success) {
        addMessage('system', '\u041F\u0435\u0440\u0435\u0432\u043E\u0434 \u043D\u0430 ' + employeeName);
        setStatus('transfer', '\u041F\u0435\u0440\u0435\u0432\u043E\u0434 \u043D\u0430 ' + employeeName);
      } else {
        toast('\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0435\u0440\u0435\u0432\u043E\u0434\u0430: ' + (res.error || '\u043D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0430\u044F'), 'error');
      }
    }).catch(function (err) {
      toast('\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0435\u0440\u0435\u0432\u043E\u0434\u0430', 'error');
    }).finally(function () {
      dom.btnDoTransfer.disabled = false;
      dom.btnDoTransfer.innerHTML =
        '<span style="width:16px;height:16px;display:inline-flex">' + ICONS.transfer + '</span> \u041F\u0435\u0440\u0435\u0432\u0435\u0441\u0442\u0438';
    });
  }

  function doTakeover() {
    dom.btnTakeover.disabled = true;
    dom.btnTakeover.textContent = '\u041F\u0435\u0440\u0435\u0432\u043E\u0434...';

    api('/call-control/takeover', {
      method: 'POST',
      body: JSON.stringify({ call_id: state.callId })
    }).then(function (res) {
      if (res.ok || res.success) {
        addMessage('system', '\u0417\u0432\u043E\u043D\u043E\u043A \u043F\u0435\u0440\u0435\u0432\u0435\u0434\u0451\u043D \u043D\u0430 \u0432\u0430\u0441');
        setStatus('transfer', '\u041F\u0435\u0440\u0435\u0432\u043E\u0434 \u043D\u0430 \u0434\u0438\u0441\u043F\u0435\u0442\u0447\u0435\u0440\u0430');
      } else {
        toast('\u041E\u0448\u0438\u0431\u043A\u0430: ' + (res.error || ''), 'error');
      }
    }).catch(function () {
      toast('\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0435\u0440\u0435\u0432\u043E\u0434\u0430', 'error');
    }).finally(function () {
      dom.btnTakeover.disabled = false;
      dom.btnTakeover.innerHTML =
        '<span style="width:16px;height:16px;display:inline-flex">' + ICONS.headset + '</span> \u041F\u0440\u0438\u043D\u044F\u0442\u044C \u043D\u0430 \u0441\u0435\u0431\u044F';
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Dispatcher mode                                                    */
  /* ------------------------------------------------------------------ */
  function loadDispatcherStatus() {
    api('/call-control/settings').then(function (res) {
      var data = res.data || res;
      state.dispatcherActive = !!data.is_dispatcher;
      state.dispatcherName = data.dispatcher_name || '';
      renderDispatcherUI(data);
    }).catch(function () {
      dom.dispStatusText.textContent = '\u041E\u0448\u0438\u0431\u043A\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438';
    });
  }

  function renderDispatcherUI(data) {
    var isMe = state.dispatcherActive;
    var otherActive = !isMe && data && data.current_dispatcher_name;

    dom.dispBtn.className = 'tp-dispatcher-btn' + (isMe ? ' tp-disp-active' : '');

    if (isMe) {
      dom.dispStatusText.textContent = '\u0412\u044B \u2014 \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0439 \u0434\u0438\u0441\u043F\u0435\u0442\u0447\u0435\u0440';
      dom.dispToggleBtn.textContent = '\u0412\u044B\u043A\u043B\u044E\u0447\u0438\u0442\u044C';
      dom.dispToggleBtn.className = 'tp-disp-tooltip-toggle tp-tt-off';
      dom.dispWarn.style.display = 'none';
    } else if (otherActive) {
      dom.dispStatusText.textContent = '\u0414\u0438\u0441\u043F\u0435\u0442\u0447\u0435\u0440 \u043D\u0435 \u0430\u043A\u0442\u0438\u0432\u0435\u043D (\u0443 \u0432\u0430\u0441)';
      dom.dispWarn.style.display = 'block';
      dom.dispWarn.textContent = '\u26A0 \u0421\u0435\u0439\u0447\u0430\u0441 \u0434\u0438\u0441\u043F\u0435\u0442\u0447\u0435\u0440: ' + esc(data.current_dispatcher_name);
      dom.dispToggleBtn.textContent = '\u0412\u043A\u043B\u044E\u0447\u0438\u0442\u044C (\u043F\u0435\u0440\u0435\u0445\u0432\u0430\u0442\u0438\u0442\u044C)';
      dom.dispToggleBtn.className = 'tp-disp-tooltip-toggle tp-tt-on';
    } else {
      dom.dispStatusText.textContent = '\u0414\u0438\u0441\u043F\u0435\u0442\u0447\u0435\u0440 \u043D\u0435 \u0430\u043A\u0442\u0438\u0432\u0435\u043D';
      dom.dispWarn.style.display = 'none';
      dom.dispToggleBtn.textContent = '\u0412\u043A\u043B\u044E\u0447\u0438\u0442\u044C';
      dom.dispToggleBtn.className = 'tp-disp-tooltip-toggle tp-tt-on';
    }
  }

  function toggleDispatcher() {
    if (state.dispatcherLoading) return;
    state.dispatcherLoading = true;
    dom.dispToggleBtn.disabled = true;
    dom.dispToggleBtn.textContent = '\u041F\u043E\u0434\u043E\u0436\u0434\u0438\u0442\u0435...';

    var enable = !state.dispatcherActive;

    api('/call-control/toggle-dispatcher', {
      method: 'POST',
      body: JSON.stringify({ enable: enable })
    }).then(function (res) {
      var data = res.data || res;
      if (res.ok || res.success || data.is_dispatcher != null) {
        state.dispatcherActive = !!data.is_dispatcher;
        state.dispatcherName = data.dispatcher_name || '';
        toast(state.dispatcherActive ? '\u0420\u0435\u0436\u0438\u043C \u0434\u0438\u0441\u043F\u0435\u0442\u0447\u0435\u0440\u0430 \u0432\u043A\u043B\u044E\u0447\u0451\u043D' : '\u0420\u0435\u0436\u0438\u043C \u0434\u0438\u0441\u043F\u0435\u0442\u0447\u0435\u0440\u0430 \u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D', 'ok');
        renderDispatcherUI(data);
      } else {
        toast('\u041E\u0448\u0438\u0431\u043A\u0430: ' + (res.error || '\u043D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0435\u0440\u0435\u043A\u043B\u044E\u0447\u0438\u0442\u044C'), 'error');
        loadDispatcherStatus();
      }
    }).catch(function () {
      toast('\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u0435\u0442\u0438', 'error');
    }).finally(function () {
      state.dispatcherLoading = false;
      dom.dispToggleBtn.disabled = false;
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Status management                                                  */
  /* ------------------------------------------------------------------ */
  function setStatus(st, text) {
    state.status = st;
    state.statusText = text || '';
    updateStatusUI();

    if (st === 'ringing') {
      startRingtone();
    } else {
      stopRingtone();
    }

    if (st === 'ai-listen') {
      setListeningIndicator(true);
    } else {
      setListeningIndicator(false);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Reset state for a new call                                         */
  /* ------------------------------------------------------------------ */
  function resetState() {
    state.callId = null;
    state.callerNumber = '';
    state.callerName = '';
    state.clientName = '';
    state.calledNumber = '';
    state.status = 'ringing';
    state.statusText = '';
    state.timerSec = 0;
    state.messages = [];
    state.summary = '';
    stopTimer();
    stopRingtone();
    clearAutoHide();
    if (dom.conversation) dom.conversation.innerHTML = '';
    if (dom.summaryBlock) dom.summaryBlock.classList.remove('tp-show');
    if (dom.summaryText) dom.summaryText.textContent = '';
    setListeningIndicator(false);
  }

  /* ------------------------------------------------------------------ */
  /*  Public: showIncoming                                               */
  /* ------------------------------------------------------------------ */
  function showIncoming(data) {
    data = data || {};
    /* If already showing a call and it's the same caller, don't reset */
    var newCaller = (data.caller || data.caller_number || data.from || '').replace(/\D/g, '').slice(-10);
    var curCaller = state.callerNumber.replace(/\D/g, '').slice(-10);
    if (state.visible && state.status !== 'ended' && newCaller && curCaller && newCaller === curCaller) {
      /* Same call — just update info */
      if (data.client_name) { state.clientName = data.client_name; renderCallerInfo(); }
      return;
    }
    resetState();

    state.callId = data.call_id || data.id || data.uniqueid || null;
    state.callerNumber = data.caller || data.caller_number || data.from || '';
    state.callerName = data.caller_name || '';
    state.clientName = data.client_name || data.contact_name || '';
    state.calledNumber = data.called || data.called_number || data.to || '';

    ensureContainer();
    setStatus('ringing');
    renderCallerInfo();
    startTimer();
    show();

    /* Start ringtone */
    startRingtone();
  }

  /* ------------------------------------------------------------------ */
  /*  Public: showConnected                                              */
  /* ------------------------------------------------------------------ */
  function showConnected(data) {
    data = data || {};
    if (data.call_id) state.callId = data.call_id;
    if (data.client_name) state.clientName = data.client_name;
    if (data.caller_name) state.callerName = data.caller_name;

    setStatus('connected');
    renderCallerInfo();
    if (!state.visible) show();
  }

  /* ------------------------------------------------------------------ */
  /*  Public: handleAgiEvent (main SSE event handler)                    */
  /* ------------------------------------------------------------------ */
  function handleAgiEvent(data) {
    if (!data || !data.type) return;
    var type = data.type;

    ensureContainer();

    switch (type) {
      case 'call_start':
        /* New call arrived via AGI — enrich existing popup or create new */
        if (!state.visible || state.status === 'ended') {
          showIncoming({
            call_id: data.call_id || data.uniqueid,
            caller: data.caller || data.callerid,
            caller_name: data.caller_name || '',
            client_name: data.client_name || '',
            called: data.called || data.extension
          });
          addMessage('system', '\u0412\u0445\u043E\u0434\u044F\u0449\u0438\u0439 \u0437\u0432\u043E\u043D\u043E\u043A \u043E\u0442 ' + formatPhone(data.caller || data.callerid || ''));
        } else {
          /* Popup already visible (from Mango SSE) — just update client info if available */
          if (data.client_name && !state.clientName) {
            state.clientName = data.client_name;
            renderCallerInfo();
          }
        }
        break;

      case 'greeting':
        setStatus('ai-talk', 'AI \u043F\u0440\u0438\u0432\u0435\u0442\u0441\u0442\u0432\u0443\u0435\u0442');
        if (data.text) {
          addMessage('ai', data.text);
        }
        break;

      case 'listening':
        setStatus('ai-listen', 'AI \u0441\u043B\u0443\u0448\u0430\u0435\u0442 \u043A\u043B\u0438\u0435\u043D\u0442\u0430');
        setListeningIndicator(true);
        break;

      case 'client_speech':
        setListeningIndicator(false);
        if (data.text) {
          addMessage('client', data.text);
        }
        setStatus('ai-talk', 'AI \u043E\u0431\u0440\u0430\u0431\u0430\u0442\u044B\u0432\u0430\u0435\u0442');
        break;

      case 'ai_thinking':
        setStatus('ai-talk', 'AI \u0434\u0443\u043C\u0430\u0435\u0442...');
        break;

      case 'ai_response':
        setStatus('ai-talk', 'AI \u043E\u0442\u0432\u0435\u0447\u0430\u0435\u0442');
        if (data.text) {
          addMessage('ai', data.text);
        }
        /* If AI decided to route/transfer */
        if (data.action === 'transfer' && data.route_name) {
          addMessage('system', '\u0420\u0435\u0448\u0435\u043D\u0438\u0435: \u043F\u0435\u0440\u0435\u0432\u043E\u0434 \u043D\u0430 ' + (data.route_name || data.route_to || ''));
        }
        break;

      case 'transfer_announce':
        addMessage('ai', data.text || '\u0421\u0435\u0439\u0447\u0430\u0441 \u043F\u0435\u0440\u0435\u0432\u0435\u0434\u0443 \u0432\u0430\u0441 \u043D\u0430 ' + (data.name || '\u0441\u043F\u0435\u0446\u0438\u0430\u043B\u0438\u0441\u0442\u0430'));
        break;

      case 'transfer_start':
        setStatus('transfer', '\u041F\u0435\u0440\u0435\u0432\u043E\u0434 \u043D\u0430 ' + (data.name || ''));
        addMessage('system', '\u041F\u0435\u0440\u0435\u0432\u043E\u0434 \u043D\u0430 ' + (data.name || '') + (data.phone ? ' (' + formatPhone(data.phone) + ')' : ''));
        break;

      case 'transfer_success':
        setStatus('connected', '\u0421\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u043E \u0441 ' + (data.name || ''));
        addMessage('system', '\u0421\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u043E \u0441 ' + (data.name || ''));
        break;

      case 'transfer_failed':
        setStatus('ai-talk', '\u041F\u0435\u0440\u0435\u0432\u043E\u0434 \u043D\u0435 \u0443\u0434\u0430\u043B\u0441\u044F');
        addMessage('system', '\u041F\u0435\u0440\u0435\u0432\u043E\u0434 \u043D\u0430 ' + (data.name || '') + ' \u043D\u0435 \u0443\u0434\u0430\u043B\u0441\u044F (' + (data.status || '') + ')');
        break;

      case 'transfer_result':
        if (data.status === 'success' || data.status === 'ANSWER') {
          setStatus('connected', '\u0421\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u043E \u0441 ' + (data.name || ''));
          addMessage('system', '\u0421\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u043E \u0441 ' + (data.name || ''));
        } else {
          setStatus('ai-talk', '\u041F\u0435\u0440\u0435\u0432\u043E\u0434 \u043D\u0435 \u0443\u0434\u0430\u043B\u0441\u044F');
          addMessage('system', '\u041F\u0435\u0440\u0435\u0432\u043E\u0434 \u043D\u0430 ' + (data.name || '') + ' \u043D\u0435 \u0443\u0434\u0430\u043B\u0441\u044F (' + (data.status || '') + ')');
        }
        break;

      case 'after_hours':
        setStatus('ai-talk', '\u041D\u0435\u0440\u0430\u0431\u043E\u0447\u0435\u0435 \u0432\u0440\u0435\u043C\u044F');
        addMessage('system', '\u041D\u0435\u0440\u0430\u0431\u043E\u0447\u0435\u0435 \u0432\u0440\u0435\u043C\u044F \u2014 \u0437\u0430\u043F\u0438\u0441\u044C \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F');
        break;

      case 'voicemail_start':
        setStatus('voicemail', '\u0417\u0430\u043F\u0438\u0441\u044C \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u043E\u0433\u043E \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F');
        addMessage('system', '\u041A\u043B\u0438\u0435\u043D\u0442 \u0437\u0430\u043F\u0438\u0441\u044B\u0432\u0430\u0435\u0442 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u043E\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435');
        break;

      case 'call_end':
        setStatus('ended');
        stopTimer();
        stopRingtone();
        if (data.summary) {
          state.summary = data.summary;
          if (dom.summaryText) dom.summaryText.textContent = data.summary;
          if (dom.summaryBlock) dom.summaryBlock.classList.add('tp-show');
        }
        addMessage('system', '\u0417\u0432\u043E\u043D\u043E\u043A \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D' + (state.timerSec > 0 ? ' (' + durationStr(state.timerSec) + ')' : ''));

        /* Auto-hide after 15 seconds */
        clearAutoHide();
        state.autoHideTimer = setTimeout(function () {
          if (state.visible && state.status === 'ended' && !state.expanded) {
            hide();
          }
        }, 15000);
        break;

      default:
        /* Unknown event — log as system message for debugging */
        if (data.text) {
          addMessage('system', '[' + type + '] ' + data.text);
        }
        break;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Init — create the dispatcher button on load                        */
  /* ------------------------------------------------------------------ */
  /* Telephony-allowed roles */
  var TEL_ROLES = ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','PM','HEAD_PM','TO','HEAD_TO','BUH'];

  function getUserRole() {
    try {
      if (window.AsgardAuth && AsgardAuth.getAuth) {
        var auth = AsgardAuth.getAuth();
        if (auth && auth.user) return auth.user.role || '';
      }
      var token = localStorage.getItem('asgard_token');
      if (token) {
        var parts = token.split('.');
        if (parts.length === 3) {
          var payload = JSON.parse(atob(parts[1]));
          return payload.role || '';
        }
      }
    } catch (e) { /* ignore */ }
    return '';
  }

  function hasPhoneAccess() {
    var role = getUserRole();
    return TEL_ROLES.indexOf(role) !== -1;
  }

  function init() {
    if (!hasPhoneAccess()) {
      /* No telephony access — don't show dispatcher button */
      return;
    }
    ensureContainer();
    loadDispatcherStatus();
  }

  /* Auto-init when DOM is ready */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    /* Defer slightly to let the rest of the app initialize */
    setTimeout(init, 100);
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                         */
  /* ------------------------------------------------------------------ */
  return {
    showIncoming:    showIncoming,
    showConnected:   showConnected,
    hide:            hide,
    handleAgiEvent:  handleAgiEvent,
    formatPhone:     formatPhone
  };

})();
