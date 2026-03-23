/**
 * ASGARD CRM — Telephony Call Monitoring Popup
 * iPhone Messages / Telegram style chat UI, Norse/Viking atmosphere
 *
 * Public API: window.AsgardTelephonyPopup
 *   .showIncoming(data)   — incoming call
 *   .showConnected(data)  — call connected
 *   .showEnded(data)      — call ended
 *   .handleAgiEvent(data) — AGI SSE event
 *   .handleMangoEvent(data) — Mango webhook event
 *
 * @version 3.0.0
 * @license Proprietary — ASGARD CRM
 */
window.AsgardTelephonyPopup = (function () {
  'use strict';

  /* ── Helpers ── */
  var esc = function (s) {
    if (s == null) return '';
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(String(s)));
    return d.innerHTML;
  };
  var toast = (typeof AsgardUI !== 'undefined' && AsgardUI.toast) || function () {};

  function api(path, opts) {
    var token = localStorage.getItem('asgard_token');
    var headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
    return fetch('/api/telephony' + path, Object.assign({ headers: headers }, opts || {}))
      .then(function (r) { return r.json(); });
  }

  /* ════════════════════════════════════════════════════════════════════
     CSS
     ════════════════════════════════════════════════════════════════════ */
  var STYLE_ID = 'asgard-telephony-popup-styles';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = [

      /* ── Root container ── */
      '#tp-root {',
      '  position: fixed; bottom: 24px; right: 24px; z-index: 99999;',
      '  font-family: -apple-system,"Inter","Segoe UI",system-ui,sans-serif;',
      '  pointer-events: none;',
      '}',
      '#tp-root * { box-sizing: border-box; }',

      /* ── Popup ── */
      '.tp-popup {',
      '  pointer-events: auto;',
      '  width: 340px;',
      '  background: #0a0a0f;',
      '  border-radius: 40px;',
      '  border: 1.5px solid rgba(255,255,255,0.10);',
      '  box-shadow: 0 0 0 6px rgba(0,0,0,0.40), 0 24px 80px rgba(0,0,0,0.70), 0 0 40px rgba(80,100,200,0.06) inset;',
      '  overflow: hidden;',
      '  transform: translateY(120px) scale(0.92); opacity: 0;',
      '  transition: transform 350ms cubic-bezier(0.34,1.56,0.64,1), opacity 300ms ease, width 300ms ease;',
      '}',
      '.tp-popup.tp-visible { transform: translateY(0) scale(1); opacity: 1; }',
      '.tp-popup.tp-hiding  { transform: translateY(120px) scale(0.92); opacity: 0;',
      '  transition: transform 250ms ease-in, opacity 200ms ease-in; }',
      '.tp-popup.tp-expanded { width: 360px; }',

      /* ── Notch ── */
      '.tp-notch {',
      '  display: flex; justify-content: center; align-items: center;',
      '  padding: 10px 0 4px; gap: 8px;',
      '}',
      '.tp-notch-pill { width: 86px; height: 4px; background: rgba(255,255,255,0.12); border-radius: 2px; }',
      '.tp-notch-cam  { width: 10px; height: 10px; background: #111;',
      '  border: 1.5px solid rgba(255,255,255,0.10); border-radius: 50%; }',

      /* ── Header ── */
      '.tp-header {',
      '  display: flex; align-items: center; gap: 12px;',
      '  padding: 6px 16px 10px;',
      '}',
      '.tp-avatar {',
      '  width: 52px; height: 52px; border-radius: 50%; flex-shrink: 0;',
      '  background: linear-gradient(135deg,#1e2a4a,#0f1830);',
      '  border: 2px solid rgba(100,140,255,0.30);',
      '  display: flex; align-items: center; justify-content: center;',
      '  font-size: 22px; position: relative; transition: width 0.3s, height 0.3s, font-size 0.3s;',
      '}',
      '.tp-avatar.tp-av-sm { width: 36px; height: 36px; font-size: 15px; }',
      '.tp-avatar-ring {',
      '  position: absolute; inset: -5px; border-radius: 50%;',
      '  border: 2px solid rgba(74,200,138,0.40);',
      '  animation: tp-ring-pulse 1.5s ease-in-out infinite;',
      '}',
      '.tp-av-sm .tp-avatar-ring { display: none; }',
      '@keyframes tp-ring-pulse {',
      '  0%,100% { transform: scale(1); opacity: 0.8; }',
      '  50%      { transform: scale(1.12); opacity: 0.25; }',
      '}',
      '.tp-header-text { flex: 1; min-width: 0; }',
      '.tp-caller-name {',
      '  font-size: 15px; font-weight: 700; color: #fff;',
      '  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
      '}',
      '.tp-caller-name.tp-known { color: #d4a843; }',
      '.tp-caller-sub {',
      '  font-size: 11px; color: rgba(255,255,255,0.45); margin-top: 2px;',
      '  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
      '}',
      '.tp-timer {',
      '  font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.45);',
      '  font-variant-numeric: tabular-nums; flex-shrink: 0;',
      '}',

      /* ── Status row ── */
      '.tp-status-row {',
      '  display: flex; align-items: center; gap: 6px;',
      '  padding: 0 16px 10px;',
      '}',
      '.tp-sdot {',
      '  width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;',
      '}',
      '.tp-sdot.st-ringing   { background:#4ac88a; box-shadow:0 0 6px #4ac88a; animation: tp-spulse 1.5s ease-in-out infinite; }',
      '.tp-sdot.st-ai-talk   { background:#4a90d9; box-shadow:0 0 6px #4a90d9; animation: tp-spulse 1.5s ease-in-out infinite; }',
      '.tp-sdot.st-ai-listen { background:#d4a843; box-shadow:0 0 6px #d4a843; animation: tp-spulse 1.5s ease-in-out infinite; }',
      '.tp-sdot.st-transfer  { background:#c9a84c; box-shadow:0 0 8px #c9a84c; animation: tp-spulse 1.0s ease-in-out infinite; }',
      '.tp-sdot.st-connected { background:#4a90d9; box-shadow:0 0 6px #4a90d9; animation: none; }',
      '.tp-sdot.st-ended     { background:rgba(255,255,255,0.20); box-shadow:none; animation: none; }',
      '.tp-sdot.st-voicemail { background:#c8293b; box-shadow:0 0 6px #c8293b; animation: tp-spulse 1.5s ease-in-out infinite; }',
      '@keyframes tp-spulse {',
      '  0%,100% { opacity:1; transform:scale(1);   }',
      '  50%      { opacity:.35; transform:scale(1.5); }',
      '}',
      '.tp-status-label { font-size:11px; color:rgba(255,255,255,0.40); letter-spacing:0.2px; }',

      /* ── Divider ── */
      '.tp-divider { height:1px; background:rgba(255,255,255,0.06); margin:0 16px; }',

      /* ── Chat area ── */
      '.tp-chat {',
      '  display: none; height: 310px;',
      '  overflow-y: auto; padding: 12px 10px 8px;',
      '  scroll-behavior: smooth;',
      '}',
      '.tp-popup.tp-expanded .tp-chat { display: block; }',
      '.tp-chat::-webkit-scrollbar { width: 3px; }',
      '.tp-chat::-webkit-scrollbar-track { background: transparent; }',
      '.tp-chat::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.10); border-radius:2px; }',

      /* ── Bubble rows ── */
      '.tp-brow { display:flex; margin-bottom:6px; gap:7px; }',
      '.tp-brow.tp-ai     { align-items:flex-start; justify-content:flex-start; }',
      '.tp-brow.tp-client { align-items:flex-start; justify-content:flex-end; }',
      '.tp-brow.tp-system { justify-content:center; margin:2px 0 6px; }',

      '.tp-bav {',
      '  width:24px; height:24px; border-radius:50%; flex-shrink:0;',
      '  background:linear-gradient(135deg,#1e2a5a,#0a1025);',
      '  border:1px solid rgba(100,140,255,0.25);',
      '  display:flex; align-items:center; justify-content:center;',
      '  font-size:12px; margin-top:2px; user-select:none;',
      '}',

      '.tp-bcol { display:flex; flex-direction:column; max-width:76%; }',
      '.tp-ai     .tp-bcol { align-items:flex-start; }',
      '.tp-client .tp-bcol { align-items:flex-end; }',

      '.tp-bubble {',
      '  padding:8px 11px; font-size:13px; line-height:1.45;',
      '  word-break:break-word; max-width:100%;',
      '}',
      '.tp-ai .tp-bubble {',
      '  background:linear-gradient(145deg,#1a1f35,#0f1525);',
      '  border:1px solid rgba(100,140,255,0.28);',
      '  border-radius:4px 16px 16px 16px;',
      '  color:rgba(255,255,255,0.92);',
      '  animation: tp-slide-l 200ms ease;',
      '}',
      '.tp-client .tp-bubble {',
      '  background:linear-gradient(145deg,#1a3a1a,#0f250f);',
      '  border:1px solid rgba(100,200,100,0.28);',
      '  border-radius:16px 4px 16px 16px;',
      '  color:rgba(255,255,255,0.92);',
      '  animation: tp-slide-r 200ms ease;',
      '}',
      '.tp-system .tp-bubble {',
      '  background:transparent; border:none;',
      '  color:rgba(255,255,255,0.28); font-size:11px;',
      '  font-style:italic; padding:2px 8px;',
      '}',
      '@keyframes tp-slide-l { from{transform:translateX(-14px);opacity:0} to{transform:translateX(0);opacity:1} }',
      '@keyframes tp-slide-r { from{transform:translateX(14px);opacity:0}  to{transform:translateX(0);opacity:1} }',

      '.tp-bmeta {',
      '  font-size:10px; color:rgba(255,255,255,0.28);',
      '  margin-top:3px; padding:0 2px;',
      '}',
      '.tp-ai     .tp-bmeta { text-align:left; }',
      '.tp-client .tp-bmeta { text-align:right; }',

      /* ── Typing indicator ── */
      '.tp-typing {',
      '  display:none; padding:0 10px 8px; gap:7px; align-items:flex-start;',
      '}',
      '.tp-typing.tp-show { display:flex; }',
      '.tp-typing-bub {',
      '  padding:9px 13px;',
      '  background:linear-gradient(145deg,#1a1f35,#0f1525);',
      '  border:1px solid rgba(100,140,255,0.28);',
      '  border-radius:4px 16px 16px 16px;',
      '  display:flex; gap:4px; align-items:center;',
      '}',
      '.tp-typing-bub span {',
      '  width:6px; height:6px; border-radius:50%;',
      '  background:rgba(100,140,255,0.55);',
      '  animation: tp-dot 1.2s ease-in-out infinite;',
      '}',
      '.tp-typing-bub span:nth-child(2) { animation-delay:0.15s; }',
      '.tp-typing-bub span:nth-child(3) { animation-delay:0.30s; }',
      '@keyframes tp-dot {',
      '  0%,60%,100% { transform:translateY(0); opacity:0.35; }',
      '  30%          { transform:translateY(-5px); opacity:1; }',
      '}',

      /* ── Mimir analysis block ── */
      '.tp-mimir {',
      '  display:none; margin:0 12px 8px;',
      '  padding:10px 12px;',
      '  background:rgba(201,168,76,0.06);',
      '  border:1px solid rgba(201,168,76,0.30);',
      '  border-radius:12px;',
      '  animation: tp-slide-l 250ms ease;',
      '}',
      '.tp-mimir.tp-show { display:block; }',
      '.tp-mimir-hd {',
      '  font-size:11px; font-weight:600; color:#c9a84c;',
      '  margin-bottom:5px; display:flex; align-items:center; gap:5px;',
      '}',
      '.tp-mimir-txt {',
      '  font-size:12px; color:rgba(255,255,255,0.70);',
      '  line-height:1.45; margin-bottom:8px; white-space:pre-line;',
      '}',
      '.tp-mimir-acts { display:flex; gap:6px; }',
      '.tp-mimir-btn {',
      '  flex:1; padding:5px 8px; border-radius:8px; border:none;',
      '  font-size:11px; font-weight:600; font-family:inherit;',
      '  cursor:pointer; transition:opacity 0.2s;',
      '}',
      '.tp-mimir-btn:hover { opacity:0.80; }',
      '.tp-mb-yes { background:rgba(45,134,89,0.25); color:#4ac88a; border:1px solid rgba(74,200,138,0.30); }',
      '.tp-mb-no  { background:rgba(200,41,59,0.15);  color:#e06070; border:1px solid rgba(200,41,59,0.25); }',

      /* ── Ended bar ── */
      '.tp-ended-bar {',
      '  display:none; padding:7px 16px;',
      '  text-align:center; font-size:11px; color:rgba(255,255,255,0.35);',
      '  background:rgba(255,255,255,0.03);',
      '}',
      '.tp-ended-bar.tp-show { display:block; }',

      /* ── Actions ── */
      '.tp-actions {',
      '  display:flex; gap:6px; padding:8px 12px 14px;',
      '}',
      '.tp-btn {',
      '  flex:1; padding:9px 8px; border:none; border-radius:12px;',
      '  font-size:12px; font-weight:600; font-family:inherit; cursor:pointer;',
      '  display:flex; align-items:center; justify-content:center; gap:5px;',
      '  transition:background 0.2s, transform 0.1s; outline:none; position:relative;',
      '}',
      '.tp-btn:active { transform:scale(0.96); }',
      '.tp-btn:disabled { opacity:0.40; cursor:default; pointer-events:none; }',
      '.tp-btn-transfer { background:#1e3a6e; color:rgba(255,255,255,0.90); }',
      '.tp-btn-transfer:hover { background:#25499e; }',
      '.tp-btn-answer   { background:#1a5c2a; color:rgba(255,255,255,0.90); }',
      '.tp-btn-answer:hover   { background:#22742f; }',
      '.tp-btn-close    { flex:0 0 auto; width:38px; padding:9px;',
      '  background:#1a1a2e; color:rgba(255,255,255,0.45); }',
      '.tp-btn-close:hover    { background:#252540; color:rgba(255,255,255,0.90); }',

      /* ── Transfer dropdown ── */
      '.tp-td {',
      '  position:absolute; bottom:calc(100% + 6px); left:0; right:0;',
      '  background:#111320; border:1px solid rgba(255,255,255,0.10);',
      '  border-radius:12px; box-shadow:0 8px 30px rgba(0,0,0,0.60);',
      '  max-height:220px; overflow-y:auto; z-index:10;',
      '  animation: tp-dd-in 150ms ease;',
      '}',
      '.tp-td::-webkit-scrollbar { width:3px; }',
      '.tp-td::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.10); border-radius:2px; }',
      '@keyframes tp-dd-in { from{transform:translateY(8px);opacity:0} to{transform:translateY(0);opacity:1} }',
      '.tp-td-item {',
      '  padding:9px 12px; font-size:12px; color:rgba(255,255,255,0.80);',
      '  cursor:pointer; border-bottom:1px solid rgba(255,255,255,0.04);',
      '  transition:background 0.15s; display:flex; align-items:center; gap:7px;',
      '}',
      '.tp-td-item:last-child { border-bottom:none; }',
      '.tp-td-item:hover { background:rgba(255,255,255,0.07); }',
      '.tp-td-nm { font-weight:500; }',
      '.tp-td-ph { font-size:11px; color:rgba(255,255,255,0.32); }',
      '.tp-td-empty { padding:14px; text-align:center; font-size:12px;',
      '  color:rgba(255,255,255,0.30); font-style:italic; }',

      /* ════════════════════════════════════════════════
         Dispatcher toggle (bottom-left)
         ════════════════════════════════════════════════ */
      '#telephony-dispatcher-toggle {',
      '  position:fixed; bottom:110px; left:10px; z-index:9999;',
      '  font-family:-apple-system,"Inter","Segoe UI",system-ui,sans-serif;',
      '}',
      '.tp-dispatcher-btn {',
      '  width:44px; height:44px; border-radius:50%;',
      '  border:2px solid rgba(255,255,255,0.08);',
      '  background:#0d1117;',
      '  backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px);',
      '  cursor:pointer; display:flex; align-items:center; justify-content:center;',
      '  transition:border-color 0.3s, box-shadow 0.3s, transform 0.15s;',
      '  box-shadow:0 4px 16px rgba(0,0,0,0.40); outline:none;',
      '}',
      '.tp-dispatcher-btn:hover  { transform:scale(1.07); }',
      '.tp-dispatcher-btn:active { transform:scale(0.95); }',
      '.tp-dispatcher-btn.tp-disp-active { border-color:#2d8659; box-shadow:0 0 12px rgba(45,134,89,0.35); }',
      '.tp-dispatcher-btn svg { width:20px; height:20px; color:rgba(255,255,255,0.30); transition:color 0.3s; }',
      '.tp-dispatcher-btn.tp-disp-active svg { color:#4bc88a; }',
      '.tp-disp-tooltip {',
      '  position:absolute; bottom:0; left:52px; min-width:200px;',
      '  padding:10px 14px;',
      '  background:#0d1117; border:1px solid rgba(255,255,255,0.08);',
      '  border-radius:10px; box-shadow:0 8px 30px rgba(0,0,0,0.50);',
      '  backdrop-filter:blur(20px); -webkit-backdrop-filter:blur(20px);',
      '  font-size:12px; color:rgba(255,255,255,0.65);',
      '  transform:translateY(8px); opacity:0;',
      '  transition:transform 0.25s ease, opacity 0.2s ease;',
      '  pointer-events:none;',
      '}',
      '.tp-disp-tooltip.tp-tt-visible { transform:translateY(0); opacity:1; pointer-events:auto; }',
      '.tp-disp-tooltip-title { font-weight:600; color:#fff; margin-bottom:4px; font-size:13px; }',
      '.tp-disp-tooltip-warn  { color:#d4a843; margin-top:6px; font-size:11px; }',
      '.tp-disp-tooltip-toggle {',
      '  display:block; width:100%; margin-top:8px; padding:7px;',
      '  background:rgba(255,255,255,0.05); color:#fff;',
      '  border:1px solid rgba(255,255,255,0.08); border-radius:6px;',
      '  font-size:12px; font-family:inherit; cursor:pointer;',
      '  text-align:center; transition:background 0.2s;',
      '}',
      '.tp-disp-tooltip-toggle:hover { background:rgba(255,255,255,0.10); }',
      '.tp-disp-tooltip-toggle.tp-tt-on  { background:rgba(45,134,89,0.15); color:#4bc88a; border-color:rgba(45,134,89,0.30); }',
      '.tp-disp-tooltip-toggle.tp-tt-off { background:rgba(200,41,59,0.12); color:#e06070; border-color:rgba(200,41,59,0.25); }',

      ''
    ].join('\n');
    document.head.appendChild(el);
  }

  /* ════════════════════════════════════════════════════════════════════
     Utilities
     ════════════════════════════════════════════════════════════════════ */
  function formatPhone(raw) {
    if (!raw) return '';
    var d = String(raw).replace(/\D/g, '');
    if (d.length === 11 && (d[0] === '7' || d[0] === '8')) {
      return '+7 (' + d.substr(1,3) + ') ' + d.substr(4,3) + '-' + d.substr(7,2) + '-' + d.substr(9,2);
    }
    if (d.length === 10) {
      return '+7 (' + d.substr(0,3) + ') ' + d.substr(3,3) + '-' + d.substr(6,2) + '-' + d.substr(8,2);
    }
    return raw;
  }

  function timeHM() {
    var n = new Date();
    return ('0'+n.getHours()).slice(-2) + ':' + ('0'+n.getMinutes()).slice(-2);
  }

  function durationStr(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return ('0'+m).slice(-2) + ':' + ('0'+s).slice(-2);
  }

  function initials(name) {
    if (!name) return '?';
    var p = name.trim().split(/\s+/);
    return p.length >= 2 ? (p[0][0] + p[1][0]).toUpperCase() : name[0].toUpperCase();
  }

  /* ════════════════════════════════════════════════════════════════════
     SVG icons
     ════════════════════════════════════════════════════════════════════ */
  var ICONS = {
    headset:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0118 0v6"/><path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3v5zM3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3v5z"/></svg>',
    close:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    transfer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 014-4h12"/></svg>',
    phone:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>',
    chevDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><polyline points="6 9 12 15 18 9"/></svg>'
  };

  function iconEl(name, size) {
    var s = size || 14;
    var w = document.createElement('span');
    w.style.cssText = 'width:' + s + 'px;height:' + s + 'px;display:inline-flex;flex-shrink:0';
    w.innerHTML = ICONS[name] || '';
    return w;
  }

  /* ════════════════════════════════════════════════════════════════════
     State
     ════════════════════════════════════════════════════════════════════ */
  var state = {
    visible: false,
    expanded: false,
    callId: null,
    callerNumber: '',
    callerName: '',
    clientName: '',
    calledNumber: '',
    status: 'ringing',
    statusText: '',
    timerStart: null,
    timerInterval: null,
    timerSec: 0,
    messages: [],
    employees: [],
    employeesLoaded: false,
    transferOpen: false,
    dispatcherActive: false,
    dispatcherName: '',
    dispatcherLoading: false,
    autoHideTimer: null,
    mimirShown: false,
    mimirTimer: null,
    lastIntent: '',
    summary: '',
    ringtoneActive: false,
    userScrolled: false
  };

  var dom = {};

  /* ════════════════════════════════════════════════════════════════════
     Web Audio Ringtone — Viking Nordic 440+550 Hz
     ring-ring…pause…ring-ring pattern
     ════════════════════════════════════════════════════════════════════ */
  var _audioCtx = null;
  var _ringGain = null;
  var _ringInterval = null;

  function ensureAudioCtx() {
    if (!_audioCtx) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) _audioCtx = new Ctx();
    }
    return _audioCtx;
  }

  function _playNordicBurst(ctx, gain) {
    var t = ctx.currentTime;
    var vol = state.timerSec > 5 ? 0.05 : 0.15;

    gain.gain.cancelScheduledValues(t);
    // burst 1: 0.0 → 0.5s
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.02);
    gain.gain.setValueAtTime(vol, t + 0.50);
    gain.gain.linearRampToValueAtTime(0, t + 0.52);
    // gap: 0.52 → 0.67s
    // burst 2: 0.67 → 1.19s
    gain.gain.setValueAtTime(0, t + 0.67);
    gain.gain.linearRampToValueAtTime(vol, t + 0.69);
    gain.gain.setValueAtTime(vol, t + 1.19);
    gain.gain.linearRampToValueAtTime(0, t + 1.21);

    function osc(freq, start, end) {
      var o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq;
      o.connect(gain);
      o.start(start);
      o.stop(end);
    }
    osc(440, t, t + 1.25);
    osc(550, t, t + 1.25);
  }

  function startRingtone() {
    if (state.ringtoneActive) return;
    var ctx = ensureAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    state.ringtoneActive = true;

    try {
      _ringGain = ctx.createGain();
      _ringGain.connect(ctx.destination);
      _playNordicBurst(ctx, _ringGain);
    } catch (e) {}

    _ringInterval = setInterval(function () {
      if (!state.ringtoneActive) { clearInterval(_ringInterval); return; }
      try {
        _ringGain = ctx.createGain();
        _ringGain.connect(ctx.destination);
        _playNordicBurst(ctx, _ringGain);
      } catch (e) {}
    }, 4000);
  }

  function stopRingtone() {
    state.ringtoneActive = false;
    if (_ringInterval) { clearInterval(_ringInterval); _ringInterval = null; }
    try { if (_ringGain) _ringGain.disconnect(); } catch (e) {}
    _ringGain = null;
  }

  /* ════════════════════════════════════════════════════════════════════
     Build DOM
     ════════════════════════════════════════════════════════════════════ */
  function ensureContainer() {
    if (dom.root) return;
    injectStyles();

    /* Root */
    var root = document.getElementById('tp-root');
    if (!root) { root = document.createElement('div'); root.id = 'tp-root'; document.body.appendChild(root); }
    dom.root = root;
    root.innerHTML = '';

    /* Popup */
    var popup = document.createElement('div');
    popup.className = 'tp-popup';
    dom.popup = popup;

    /* Notch */
    var notch = document.createElement('div');
    notch.className = 'tp-notch';
    notch.innerHTML =
      '<div class="tp-notch-pill"></div>' +
      '<div class="tp-notch-cam"></div>' +
      '<div class="tp-notch-pill"></div>';
    popup.appendChild(notch);

    /* Header */
    var header = document.createElement('div');
    header.className = 'tp-header';

    dom.avatar = document.createElement('div');
    dom.avatar.className = 'tp-avatar';
    dom.avatar.innerHTML = '📞<div class="tp-avatar-ring"></div>';
    header.appendChild(dom.avatar);

    var htxt = document.createElement('div');
    htxt.className = 'tp-header-text';
    dom.callerName = document.createElement('div');
    dom.callerName.className = 'tp-caller-name';
    dom.callerSub = document.createElement('div');
    dom.callerSub.className = 'tp-caller-sub';
    dom.callerSub.textContent = 'Входящий звонок · Асгард Сервис';
    htxt.appendChild(dom.callerName);
    htxt.appendChild(dom.callerSub);
    header.appendChild(htxt);

    dom.timer = document.createElement('div');
    dom.timer.className = 'tp-timer';
    dom.timer.textContent = '00:00';
    header.appendChild(dom.timer);
    popup.appendChild(header);

    /* Status row */
    var srow = document.createElement('div');
    srow.className = 'tp-status-row';
    dom.sdot = document.createElement('div');
    dom.sdot.className = 'tp-sdot st-ringing';
    dom.statusLabel = document.createElement('span');
    dom.statusLabel.className = 'tp-status-label';
    dom.statusLabel.textContent = 'Фрейя принимает звонок';
    srow.appendChild(dom.sdot);
    srow.appendChild(dom.statusLabel);
    popup.appendChild(srow);

    /* Divider */
    var div1 = document.createElement('div');
    div1.className = 'tp-divider';
    popup.appendChild(div1);

    /* Chat */
    dom.chat = document.createElement('div');
    dom.chat.className = 'tp-chat';
    dom.chat.addEventListener('scroll', function () {
      state.userScrolled = dom.chat.scrollTop < dom.chat.scrollHeight - dom.chat.clientHeight - 60;
    });
    popup.appendChild(dom.chat);

    /* Typing indicator */
    dom.typing = document.createElement('div');
    dom.typing.className = 'tp-typing';
    dom.typing.innerHTML =
      '<div class="tp-bav">ᚠ</div>' +
      '<div class="tp-typing-bub"><span></span><span></span><span></span></div>';
    popup.appendChild(dom.typing);

    /* Mimir analysis */
    dom.mimirBlock = document.createElement('div');
    dom.mimirBlock.className = 'tp-mimir';
    dom.mimirBlock.innerHTML =
      '<div class="tp-mimir-hd">⚡ Mimir · Анализ звонка</div>' +
      '<div class="tp-mimir-txt" id="tp-mimir-txt"></div>' +
      '<div class="tp-mimir-acts">' +
        '<button class="tp-mimir-btn tp-mb-yes" id="tp-mimir-yes">✓ Взять трубку</button>' +
        '<button class="tp-mimir-btn tp-mb-no"  id="tp-mimir-no">✗ Не брать</button>' +
      '</div>';
    popup.appendChild(dom.mimirBlock);

    /* Ended bar */
    dom.endedBar = document.createElement('div');
    dom.endedBar.className = 'tp-ended-bar';
    popup.appendChild(dom.endedBar);

    /* Divider */
    var div2 = document.createElement('div');
    div2.className = 'tp-divider';
    popup.appendChild(div2);

    /* Actions */
    var actions = document.createElement('div');
    actions.className = 'tp-actions';

    /* Transfer button + dropdown */
    var trWrap = document.createElement('div');
    trWrap.style.cssText = 'flex:1;position:relative;';
    dom.btnTransfer = document.createElement('button');
    dom.btnTransfer.className = 'tp-btn tp-btn-transfer';
    dom.btnTransfer.appendChild(iconEl('transfer'));
    dom.btnTransfer.appendChild(document.createTextNode(' Перевести '));
    dom.btnTransfer.appendChild(iconEl('chevDown', 11));
    dom.btnTransfer.onclick = _toggleTransfer;

    dom.transferDropdown = document.createElement('div');
    dom.transferDropdown.className = 'tp-td';
    dom.transferDropdown.style.display = 'none';
    dom.transferDropdown.innerHTML = '<div class="tp-td-empty">Загрузка...</div>';

    trWrap.appendChild(dom.transferDropdown);
    trWrap.appendChild(dom.btnTransfer);
    actions.appendChild(trWrap);

    /* Answer button */
    dom.btnAnswer = document.createElement('button');
    dom.btnAnswer.className = 'tp-btn tp-btn-answer';
    dom.btnAnswer.appendChild(iconEl('phone'));
    dom.btnAnswer.appendChild(document.createTextNode(' Взять'));
    dom.btnAnswer.onclick = doAnswer;
    actions.appendChild(dom.btnAnswer);

    /* Close button */
    dom.btnClose = document.createElement('button');
    dom.btnClose.className = 'tp-btn tp-btn-close';
    dom.btnClose.appendChild(iconEl('close'));
    dom.btnClose.title = 'Закрыть';
    dom.btnClose.onclick = hide;
    actions.appendChild(dom.btnClose);

    popup.appendChild(actions);
    root.appendChild(popup);

    /* Cache DOM refs */
    dom.mimirTxt = popup.querySelector('#tp-mimir-txt');
    popup.querySelector('#tp-mimir-yes').onclick = function () { doAnswer(); dom.mimirBlock.classList.remove('tp-show'); };
    popup.querySelector('#tp-mimir-no').onclick  = function () { dom.mimirBlock.classList.remove('tp-show'); };

    /* Close transfer dropdown on outside click */
    document.addEventListener('click', function (e) {
      if (state.transferOpen && !dom.transferDropdown.contains(e.target) && e.target !== dom.btnTransfer && !dom.btnTransfer.contains(e.target)) {
        _closeTransfer();
      }
    });

    /* Dispatcher toggle */
    _buildDispatcher();
  }

  /* ════════════════════════════════════════════════════════════════════
     Transfer dropdown
     ════════════════════════════════════════════════════════════════════ */
  function _toggleTransfer() {
    state.transferOpen ? _closeTransfer() : _openTransfer();
  }

  function _openTransfer() {
    state.transferOpen = true;
    dom.transferDropdown.style.display = 'block';
    loadEmployees();
  }

  function _closeTransfer() {
    state.transferOpen = false;
    dom.transferDropdown.style.display = 'none';
  }

  function loadEmployees() {
    if (state.employeesLoaded && state.employees.length > 0) { _renderTransferDropdown(); return; }
    api('/employees').then(function (data) {
      var list = data.employees || data.data || data || [];
      state.employees = Array.isArray(list) ? list : [];
      state.employeesLoaded = true;
      _renderTransferDropdown();
    }).catch(function () {
      if (dom.transferDropdown) dom.transferDropdown.innerHTML = '<div class="tp-td-empty">Ошибка загрузки</div>';
    });
  }

  function _renderTransferDropdown() {
    if (!dom.transferDropdown) return;
    if (!state.employees.length) {
      dom.transferDropdown.innerHTML = '<div class="tp-td-empty">Нет сотрудников</div>';
      return;
    }
    var frag = document.createDocumentFragment();
    for (var i = 0; i < state.employees.length; i++) {
      var e = state.employees[i];
      var name  = e.full_name || e.name || ('Сотрудник #' + (e.id || i));
      var phone = e.internal_phone || e.phone || '';
      var item  = document.createElement('div');
      item.className = 'tp-td-item';
      item.innerHTML =
        '<span>👤</span>' +
        '<div><div class="tp-td-nm">' + esc(name) + '</div>' +
          (phone ? '<div class="tp-td-ph">' + esc(phone) + '</div>' : '') +
        '</div>';
      (function (empId, empName, empPhone) {
        item.onclick = function () {
          doTransfer(empId, empName, empPhone);
          _closeTransfer();
        };
      })(e.id || '', name, phone);
      frag.appendChild(item);
    }
    dom.transferDropdown.innerHTML = '';
    dom.transferDropdown.appendChild(frag);
  }

  /* ════════════════════════════════════════════════════════════════════
     Transfer & answer
     ════════════════════════════════════════════════════════════════════ */
  function doTransfer(employeeId, employeeName, employeePhone) {
    dom.btnTransfer.disabled = true;
    dom.btnTransfer.textContent = 'Перевод...';

    api('/call-control/transfer', {
      method: 'POST',
      body: JSON.stringify({ call_id: state.callId, employee_id: employeeId, employee_phone: employeePhone })
    }).then(function (res) {
      if (res.ok || res.success) {
        addMessage('system', 'Перевод на ' + employeeName);
        setStatus('transfer', 'Перевод на ' + employeeName);
      } else {
        toast('Ошибка перевода: ' + (res.error || 'неизвестная'), 'error');
      }
    }).catch(function () {
      toast('Ошибка перевода', 'error');
    }).finally(function () {
      dom.btnTransfer.disabled = false;
      dom.btnTransfer.innerHTML = '';
      dom.btnTransfer.appendChild(iconEl('transfer'));
      dom.btnTransfer.appendChild(document.createTextNode(' Перевести '));
      dom.btnTransfer.appendChild(iconEl('chevDown', 11));
    });
  }

  function doAnswer() {
    api('/call-control/answer', { method: 'POST', body: JSON.stringify({ call_id: state.callId }) }).catch(function () {});
    hide();
  }

  /* ════════════════════════════════════════════════════════════════════
     Mimir analysis (client-side, no AI call)
     ════════════════════════════════════════════════════════════════════ */
  function _buildMimir() {
    var clientMsgs = state.messages.filter(function (m) { return m.type === 'client'; });
    var aiMsgs     = state.messages.filter(function (m) { return m.type === 'ai'; });
    if (!clientMsgs.length || !aiMsgs.length) return;

    var intent  = state.lastIntent || '';
    var snippet = clientMsgs[0].text.slice(0, 65) + (clientMsgs[0].text.length > 65 ? '…' : '');
    var rec;

    if (intent === 'spam' || intent === 'sales') {
      rec = 'Похоже на спам. Можно не брать.';
    } else if (intent === 'tender' || intent === 'consultation' || intent === 'new_client') {
      rec = 'Целевой звонок. Рекомендую принять.';
    } else if (intent === 'after_hours') {
      rec = 'Нерабочее время — Фрейя записывает.';
    } else {
      rec = 'Неопределённый запрос.';
    }

    if (dom.mimirTxt) dom.mimirTxt.textContent = snippet + '\n' + rec;
    dom.mimirBlock.classList.add('tp-show');
    state.mimirShown = true;
  }

  function _scheduleMimir() {
    if (state.mimirTimer || state.mimirShown) return;
    state.mimirTimer = setTimeout(function () {
      _buildMimir();
    }, 9000);
  }

  /* ════════════════════════════════════════════════════════════════════
     Status UI
     ════════════════════════════════════════════════════════════════════ */
  var STATUS_LABELS = {
    'ringing':    'Фрейя принимает звонок',
    'ai-talk':    'Фрейя отвечает',
    'ai-listen':  'Клиент говорит',
    'transfer':   'Перевод звонка...',
    'connected':  'Соединено',
    'ended':      'Звонок завершён',
    'voicemail':  'Голосовое сообщение'
  };

  function updateStatusUI() {
    dom.sdot.className = 'tp-sdot st-' + state.status;
    dom.statusLabel.textContent = state.statusText || STATUS_LABELS[state.status] || state.status;
  }

  function renderCallerInfo() {
    var name  = state.clientName || state.callerName || '';
    var known = !!state.clientName;
    dom.callerName.textContent  = name || formatPhone(state.callerNumber) || 'Неизвестный';
    dom.callerName.className    = 'tp-caller-name' + (known ? ' tp-known' : '');
    dom.callerSub.textContent   = (state.clientName && state.callerNumber)
      ? formatPhone(state.callerNumber)
      : 'Входящий звонок · Асгард Сервис';

    var av = name ? initials(name) : '📞';
    dom.avatar.innerHTML = esc(av) + '<div class="tp-avatar-ring"></div>';
  }

  /* ════════════════════════════════════════════════════════════════════
     Chat messages
     ════════════════════════════════════════════════════════════════════ */
  function scrollToBottom() {
    if (!state.userScrolled && dom.chat) {
      requestAnimationFrame(function () { dom.chat.scrollTop = dom.chat.scrollHeight; });
    }
  }

  function addMessage(type, text, intent) {
    if (state.messages.length > 0) {
      var last = state.messages[state.messages.length - 1];
      if (last.type === type && last.text === text) return;
    }
    var msg = { type: type, text: text, time: timeHM(), intent: intent || '' };
    state.messages.push(msg);
    if (intent) state.lastIntent = intent;
    _renderMsg(msg);
    _hideTyping();
    if (!state.expanded && (type === 'ai' || type === 'client')) _expand();
    if (type === 'client' && !state.mimirShown) _scheduleMimir();
  }

  function _renderMsg(msg) {
    if (!dom.chat) return;
    var row = document.createElement('div');

    if (msg.type === 'system') {
      row.className = 'tp-brow tp-system';
      var bub = document.createElement('div');
      bub.className = 'tp-bubble';
      bub.textContent = msg.text;
      row.appendChild(bub);
    } else {
      row.className = 'tp-brow tp-' + msg.type;
      var senderLabel = msg.type === 'ai'
        ? 'Фрейя'
        : (state.clientName || formatPhone(state.callerNumber) || 'Клиент');

      if (msg.type === 'ai') {
        var bav = document.createElement('div');
        bav.className = 'tp-bav';
        bav.textContent = 'ᚠ';
        row.appendChild(bav);
      }
      var col = document.createElement('div');
      col.className = 'tp-bcol';
      var bub = document.createElement('div');
      bub.className = 'tp-bubble';
      bub.textContent = msg.text;
      var meta = document.createElement('div');
      meta.className = 'tp-bmeta';
      meta.textContent = senderLabel + (msg.time ? ' · ' + msg.time : '');
      col.appendChild(bub);
      col.appendChild(meta);
      row.appendChild(col);
    }

    dom.chat.appendChild(row);
    scrollToBottom();
  }

  function _renderAllMsgs() {
    if (!dom.chat) return;
    dom.chat.innerHTML = '';
    state.userScrolled = false;
    for (var i = 0; i < state.messages.length; i++) _renderMsg(state.messages[i]);
  }

  /* ════════════════════════════════════════════════════════════════════
     Typing indicator
     ════════════════════════════════════════════════════════════════════ */
  function _showTyping() {
    if (dom.typing) { dom.typing.classList.add('tp-show'); scrollToBottom(); }
  }

  function _hideTyping() {
    if (dom.typing) dom.typing.classList.remove('tp-show');
  }

  /* ════════════════════════════════════════════════════════════════════
     Expand popup (compact → full chat)
     ════════════════════════════════════════════════════════════════════ */
  function _expand() {
    state.expanded = true;
    state.userScrolled = false;
    dom.popup.classList.add('tp-expanded');
    dom.avatar.classList.add('tp-av-sm');
    _renderAllMsgs();
  }

  /* ════════════════════════════════════════════════════════════════════
     Timer
     ════════════════════════════════════════════════════════════════════ */
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

  /* ════════════════════════════════════════════════════════════════════
     Auto-hide
     ════════════════════════════════════════════════════════════════════ */
  function _clearAutoHide() {
    if (state.autoHideTimer) { clearTimeout(state.autoHideTimer); state.autoHideTimer = null; }
  }

  /* ════════════════════════════════════════════════════════════════════
     Show / Hide
     ════════════════════════════════════════════════════════════════════ */
  function show() {
    ensureContainer();
    state.visible = true;
    dom.popup.classList.remove('tp-hiding');
    void dom.popup.offsetWidth; /* force reflow for animation */
    dom.popup.classList.add('tp-visible');
  }

  function hide() {
    if (!state.visible) return;
    _clearAutoHide();
    stopRingtone();
    dom.popup.classList.remove('tp-visible');
    dom.popup.classList.add('tp-hiding');
    state.visible = false;
    setTimeout(function () {
      if (dom.popup) dom.popup.classList.remove('tp-hiding');
    }, 350);
  }

  /* ════════════════════════════════════════════════════════════════════
     Status management
     ════════════════════════════════════════════════════════════════════ */
  function setStatus(st, text) {
    state.status = st;
    state.statusText = text || '';
    updateStatusUI();
    if (st === 'ringing') startRingtone(); else stopRingtone();
  }

  /* ════════════════════════════════════════════════════════════════════
     Reset state for new call
     ════════════════════════════════════════════════════════════════════ */
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
    state.expanded = false;
    state.mimirShown = false;
    state.lastIntent = '';
    state.userScrolled = false;
    if (state.mimirTimer) { clearTimeout(state.mimirTimer); state.mimirTimer = null; }
    stopTimer();
    stopRingtone();
    _clearAutoHide();
    if (dom.chat) dom.chat.innerHTML = '';
    if (dom.popup) dom.popup.classList.remove('tp-expanded');
    if (dom.mimirBlock) dom.mimirBlock.classList.remove('tp-show');
    if (dom.endedBar)   dom.endedBar.classList.remove('tp-show');
    _hideTyping();
    if (dom.avatar) {
      dom.avatar.className = 'tp-avatar';
      dom.avatar.innerHTML = '📞<div class="tp-avatar-ring"></div>';
    }
  }

  /* ════════════════════════════════════════════════════════════════════
     PUBLIC: showIncoming
     ════════════════════════════════════════════════════════════════════ */
  function showIncoming(data) {
    data = data || {};
    var newCaller = (data.caller || data.caller_number || data.from || '').replace(/\D/g,'').slice(-10);
    var curCaller = state.callerNumber.replace(/\D/g,'').slice(-10);
    if (state.visible && state.status !== 'ended' && newCaller && curCaller && newCaller === curCaller) {
      if (data.client_name) { state.clientName = data.client_name; renderCallerInfo(); }
      return;
    }
    resetState();
    state.callId       = data.call_id || data.id || data.uniqueid || null;
    state.callerNumber = data.caller || data.caller_number || data.from || '';
    state.callerName   = data.caller_name || '';
    state.clientName   = data.client_name || data.contact_name || '';
    state.calledNumber = data.called || data.called_number || data.to || '';
    ensureContainer();
    setStatus('ringing');
    renderCallerInfo();
    startTimer();
    show();
    startRingtone();
  }

  /* ════════════════════════════════════════════════════════════════════
     PUBLIC: showConnected
     ════════════════════════════════════════════════════════════════════ */
  function showConnected(data) {
    data = data || {};
    if (data.call_id)    state.callId    = data.call_id;
    if (data.client_name) state.clientName = data.client_name;
    if (data.caller_name) state.callerName = data.caller_name;
    setStatus('connected');
    renderCallerInfo();
    if (!state.visible) show();
  }

  /* ════════════════════════════════════════════════════════════════════
     PUBLIC: showEnded
     ════════════════════════════════════════════════════════════════════ */
  function showEnded(data) {
    handleAgiEvent(Object.assign({ type: 'call_end' }, data || {}));
  }

  /* ════════════════════════════════════════════════════════════════════
     PUBLIC: handleMangoEvent
     ════════════════════════════════════════════════════════════════════ */
  function handleMangoEvent(data) {
    if (!data) return;
    var type = data.type || data.event_type || '';
    switch (type) {
      case 'call_start': case 'CALL_START': case 'ringing':
        showIncoming({ call_id: data.call_id || data.uid, caller: data.from || data.caller || data.caller_number, caller_name: data.caller_name || '', client_name: data.client_name || '' });
        break;
      case 'connected': case 'CONNECTED': case 'answered':
        showConnected(data);
        break;
      case 'ended': case 'ENDED': case 'call_end': case 'CALL_END':
        handleAgiEvent({ type: 'call_end', summary: data.summary || '' });
        break;
      default:
        if (data.type) handleAgiEvent(data);
    }
  }

  /* ════════════════════════════════════════════════════════════════════
     PUBLIC: handleAgiEvent
     ════════════════════════════════════════════════════════════════════ */
  function handleAgiEvent(data) {
    if (!data || !data.type) return;
    ensureContainer();

    switch (data.type) {

      case 'call_start':
        if (!state.visible || state.status === 'ended') {
          showIncoming({
            call_id:     data.call_id || data.uniqueid,
            caller:      data.caller || data.callerid,
            caller_name: data.caller_name || '',
            client_name: data.client_name || '',
            called:      data.called || data.extension
          });
          addMessage('system', 'Входящий звонок от ' + formatPhone(data.caller || data.callerid || ''));
        } else {
          if (data.client_name && !state.clientName) { state.clientName = data.client_name; renderCallerInfo(); }
        }
        break;

      case 'greeting':
        setStatus('ai-talk', 'Фрейя приветствует');
        if (data.text) addMessage('ai', data.text);
        break;

      case 'listening':
        setStatus('ai-listen', 'Клиент говорит');
        break;

      case 'client_speech':
        _hideTyping();
        if (data.text) addMessage('client', data.text);
        setStatus('ai-talk', 'Фрейя обрабатывает');
        _showTyping(); /* AI is thinking — show dots */
        break;

      case 'ai_thinking':
        setStatus('ai-talk', 'Фрейя думает...');
        _showTyping();
        break;

      case 'ai_response':
        setStatus('ai-talk', 'Фрейя отвечает');
        if (data.intent) state.lastIntent = data.intent;
        if (data.text) addMessage('ai', data.text, data.intent);
        if (data.action === 'transfer' && data.route_name) {
          addMessage('system', 'Решение: перевод на ' + (data.route_name || data.route_to || ''));
        }
        break;

      case 'transfer_announce':
        addMessage('ai', data.text || ('Сейчас переведу вас на ' + (data.name || 'специалиста')));
        break;

      case 'transfer_start':
        setStatus('transfer', 'Перевод на ' + (data.name || ''));
        addMessage('system', 'Перевод на ' + (data.name || '') + (data.phone ? ' (' + formatPhone(data.phone) + ')' : ''));
        break;

      case 'transfer_success':
        setStatus('connected', 'Соединено с ' + (data.name || ''));
        addMessage('system', 'Соединено с ' + (data.name || ''));
        break;

      case 'transfer_failed':
        setStatus('ai-talk', 'Перевод не удался');
        addMessage('system', 'Перевод на ' + (data.name || '') + ' не удался (' + (data.status || '') + ')');
        break;

      case 'transfer_result':
        if (data.status === 'success' || data.status === 'ANSWER') {
          setStatus('connected', 'Соединено с ' + (data.name || ''));
          addMessage('system', 'Соединено с ' + (data.name || ''));
        } else {
          setStatus('ai-talk', 'Перевод не удался');
          addMessage('system', 'Перевод на ' + (data.name || '') + ' не удался (' + (data.status || '') + ')');
        }
        break;

      case 'after_hours':
        state.lastIntent = 'after_hours';
        setStatus('ai-talk', 'Нерабочее время');
        addMessage('system', 'Нерабочее время — запись сообщения');
        break;

      case 'voicemail_start':
        setStatus('voicemail', 'Запись голосового сообщения');
        addMessage('system', 'Клиент записывает голосовое сообщение');
        break;

      case 'call_end':
        setStatus('ended');
        stopTimer();
        stopRingtone();
        if (state.mimirTimer) { clearTimeout(state.mimirTimer); state.mimirTimer = null; }
        dom.mimirBlock.classList.remove('tp-show');
        _hideTyping();
        var endTxt = 'Звонок завершён' + (state.timerSec > 0 ? ' · ' + durationStr(state.timerSec) : '');
        addMessage('system', endTxt);
        dom.endedBar.textContent = endTxt;
        dom.endedBar.classList.add('tp-show');
        if (data.summary) { state.summary = data.summary; addMessage('system', '📋 ' + data.summary); }
        _clearAutoHide();
        state.autoHideTimer = setTimeout(function () {
          if (state.visible && state.status === 'ended') hide();
        }, 8000);
        break;

      default:
        if (data.text) addMessage('system', '[' + data.type + '] ' + data.text);
        break;
    }
  }

  /* ════════════════════════════════════════════════════════════════════
     Dispatcher toggle (bottom-left, unchanged logic)
     ════════════════════════════════════════════════════════════════════ */
  function _buildDispatcher() {
    var dWrap = document.getElementById('telephony-dispatcher-toggle');
    if (!dWrap) { dWrap = document.createElement('div'); dWrap.id = 'telephony-dispatcher-toggle'; document.body.appendChild(dWrap); }
    dom.dispWrap = dWrap;
    dWrap.innerHTML = '';

    var dBtn = document.createElement('button');
    dBtn.className = 'tp-dispatcher-btn';
    dBtn.innerHTML = ICONS.headset;
    dBtn.title = 'Диспетчер звонков';
    dom.dispBtn = dBtn;

    var tooltip = document.createElement('div');
    tooltip.className = 'tp-disp-tooltip';
    tooltip.innerHTML =
      '<div class="tp-disp-tooltip-title">Диспетчер звонков</div>' +
      '<div id="tp-disp-status-text">Загрузка...</div>' +
      '<div class="tp-disp-tooltip-warn" id="tp-disp-warn" style="display:none"></div>' +
      '<button class="tp-disp-tooltip-toggle" id="tp-disp-toggle-btn">Включить</button>';
    dom.dispTooltip    = tooltip;
    dom.dispStatusText = tooltip.querySelector('#tp-disp-status-text');
    dom.dispWarn       = tooltip.querySelector('#tp-disp-warn');
    dom.dispToggleBtn  = tooltip.querySelector('#tp-disp-toggle-btn');

    dWrap.appendChild(tooltip);
    dWrap.appendChild(dBtn);

    var ttVisible = false;
    dBtn.onclick = function () {
      ttVisible = !ttVisible;
      if (ttVisible) { tooltip.classList.add('tp-tt-visible'); loadDispatcherStatus(); }
      else tooltip.classList.remove('tp-tt-visible');
    };
    document.addEventListener('click', function (e) {
      if (ttVisible && !dWrap.contains(e.target)) { ttVisible = false; tooltip.classList.remove('tp-tt-visible'); }
    });
    dom.dispToggleBtn.onclick = toggleDispatcher;
  }

  function loadDispatcherStatus() {
    api('/call-control/settings').then(function (res) {
      var data = res.data || res;
      state.dispatcherActive = !!data.is_dispatcher;
      state.dispatcherName   = data.dispatcher_name || '';
      _renderDispatcherUI(data);
    }).catch(function () {
      if (dom.dispStatusText) dom.dispStatusText.textContent = 'Ошибка загрузки';
    });
  }

  function _renderDispatcherUI(data) {
    var isMe = state.dispatcherActive;
    var otherActive = !isMe && data && data.current_dispatcher_name;
    dom.dispBtn.className = 'tp-dispatcher-btn' + (isMe ? ' tp-disp-active' : '');
    if (isMe) {
      dom.dispStatusText.textContent = 'Вы — активный диспетчер';
      dom.dispToggleBtn.textContent  = 'Выключить';
      dom.dispToggleBtn.className    = 'tp-disp-tooltip-toggle tp-tt-off';
      dom.dispWarn.style.display     = 'none';
    } else if (otherActive) {
      dom.dispStatusText.textContent = 'Диспетчер не активен (у вас)';
      dom.dispWarn.style.display     = 'block';
      dom.dispWarn.textContent       = '⚠ Сейчас диспетчер: ' + esc(data.current_dispatcher_name);
      dom.dispToggleBtn.textContent  = 'Включить (перехватить)';
      dom.dispToggleBtn.className    = 'tp-disp-tooltip-toggle tp-tt-on';
    } else {
      dom.dispStatusText.textContent = 'Диспетчер не активен';
      dom.dispWarn.style.display     = 'none';
      dom.dispToggleBtn.textContent  = 'Включить';
      dom.dispToggleBtn.className    = 'tp-disp-tooltip-toggle tp-tt-on';
    }
  }

  function toggleDispatcher() {
    if (state.dispatcherLoading) return;
    state.dispatcherLoading = true;
    dom.dispToggleBtn.disabled    = true;
    dom.dispToggleBtn.textContent = 'Подождите...';
    var enable = !state.dispatcherActive;
    api('/call-control/toggle-dispatcher', { method: 'POST', body: JSON.stringify({ enable: enable }) })
      .then(function (res) {
        var data = res.data || res;
        if (res.ok || res.success || data.is_dispatcher != null) {
          state.dispatcherActive = !!data.is_dispatcher;
          state.dispatcherName   = data.dispatcher_name || '';
          toast(state.dispatcherActive ? 'Режим диспетчера включён' : 'Режим диспетчера выключен', 'ok');
          _renderDispatcherUI(data);
        } else {
          toast('Ошибка: ' + (res.error || 'не удалось переключить'), 'error');
          loadDispatcherStatus();
        }
      }).catch(function () {
        toast('Ошибка сети', 'error');
      }).finally(function () {
        state.dispatcherLoading    = false;
        dom.dispToggleBtn.disabled = false;
      });
  }

  /* ════════════════════════════════════════════════════════════════════
     Role check & init
     ════════════════════════════════════════════════════════════════════ */
  var TEL_ROLES = ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','PM','HEAD_PM','TO','HEAD_TO','BUH'];

  function _getUserRole() {
    try {
      if (window.AsgardAuth && AsgardAuth.getAuth) {
        var auth = AsgardAuth.getAuth();
        if (auth && auth.user) return auth.user.role || '';
      }
      var token = localStorage.getItem('asgard_token');
      if (token) {
        var p = token.split('.');
        if (p.length === 3) return JSON.parse(atob(p[1])).role || '';
      }
    } catch (e) {}
    return '';
  }

  function init() {
    if (TEL_ROLES.indexOf(_getUserRole()) === -1) return;
    ensureContainer();
    loadDispatcherStatus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 100);
  }

  /* ════════════════════════════════════════════════════════════════════
     Public API
     ════════════════════════════════════════════════════════════════════ */
  return {
    showIncoming:     showIncoming,
    showConnected:    showConnected,
    showEnded:        showEnded,
    hide:             hide,
    handleAgiEvent:   handleAgiEvent,
    handleMangoEvent: handleMangoEvent,
    formatPhone:      formatPhone
  };

})();
