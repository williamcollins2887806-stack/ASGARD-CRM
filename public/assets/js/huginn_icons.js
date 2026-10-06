/**
 * Huginn Lucide icon subset (MIT) — stroke 1.75, viewBox 0 0 24 24.
 * Vendored paths inspired by Lucide 0.460.x (https://lucide.dev).
 * Usage: HuginnIcons.svg('send') or HuginnIcons.ICO.send
 */
(function (global) {
  'use strict';

  const SW = '1.75';
  /* width/height attrs required: flex items otherwise collapse SVG to 0px (emoji/mic invisible) */
  const ATTR = `xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${SW}" stroke-linecap="round" stroke-linejoin="round"`;

  const PATHS = {
    reply: '<polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 00-4-4H4"/>',
    smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',
    /* TG in-capsule theme glyph (crescent) */
    moon: '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>',
    /* TG in-field sticker (folded note) */
    'sticker-note': '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><circle cx="10" cy="13" r="1"/><circle cx="14" cy="13" r="1"/><path d="M9 17c.6 1 1.7 1.5 3 1.5s2.4-.5 3-1.5"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>',
    forward: '<polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 014-4h12"/>',
    paperclip: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>',
    /* R184: restore prior mic (R183 base-bar → +0.03) */
    mic: '<path d="M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/>',
    send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    'chevron-down': '<polyline points="6 9 12 15 18 9"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
    file: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    play: '<polygon points="5 3 19 12 5 21 5 3"/>',
    'user-plus': '<path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>',
    sparkles: '<path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z"/>',
    phone: '<path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.37 1.9.72 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0122 16.92z"/>',
    video: '<path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    'message-circle': '<path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/>',
    'message-square': '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>',
    users: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>',
    circle: '<circle cx="12" cy="12" r="10"/>',
    'video-message': '<circle cx="12" cy="12" r="9"/><polygon points="10 9 16 12 10 15 10 9"/>',
    'arrow-up': '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>',
    'more-horizontal': '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>',
    contact: '<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    'plus': '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    'chevron-left': '<polyline points="15 18 9 12 15 6"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>',
    inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/>',
    /* R66: TG pin — diagonal push-pin (head bar + body + tip); slash glyph FAIL */
    pin: '<g transform="rotate(45 12 12)"><line x1="8" y1="3" x2="16" y2="3"/><path d="M9.5 3.5v5.4c0 .4-.15.78-.42 1.08L7.5 11.6A1.2 1.2 0 007 12.5V13h10v-.5a1.2 1.2 0 00-.5-.9l-1.58-1.62a1.6 1.6 0 01-.42-1.08V3.5"/><line x1="12" y1="13" x2="12" y2="20.5"/></g>',
    /* R93: TG pin-banner — thin diagonal pushpin + short list ticks */
    pinList: '<g transform="rotate(-40 9 12)" fill="none"><path d="M9 4v6.2l1.6 1.1V13H6.4v-1.7L8 10.2V4"/><line x1="6.5" y1="4" x2="11.5" y2="4"/><line x1="9" y1="13" x2="9" y2="19"/></g><line x1="14" y1="8" x2="20" y2="8"/><line x1="14" y1="11.5" x2="19" y2="11.5"/><line x1="14" y1="15" x2="20" y2="15"/>',
    /* TG chats tab: overlapping bubbles */
    'messages-square': '<path d="M14 9a2 2 0 012 2v6a2 2 0 01-2 2H6l-3 3V11a2 2 0 012-2h9z"/><path d="M18 2H9a2 2 0 00-2 2v1h7a3 3 0 013 3v7h1a2 2 0 002-2V4a2 2 0 00-2-2z"/>',
    bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/>',
    'volume-x': '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>',
    /* TG mute next to title */
    'bell-off': '<path d="M13.73 21a2 2 0 01-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0118 8"/><path d="M6.26 6.26A5.86 5.86 0 006 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 00-12 0"/><line x1="1" y1="1" x2="23" y2="23"/>',
    'chevron-right': '<polyline points="9 18 15 12 9 6"/>',
    square: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    'check-check': '<path d="M18 6L7 17l-5-5"/><path d="M22 10l-7.5 7.5L13 16"/>',
    pause: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
    bell: '<path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'
  };

  function svg(name, cls) {
    const body = PATHS[name];
    if (!body) return '';
    const c = cls ? ` class="${cls}"` : '';
    return `<svg ${ATTR}${c} aria-hidden="true">${body}</svg>`;
  }

  const ICO = {};
  Object.keys(PATHS).forEach((k) => { ICO[k] = svg(k); });

  // aliases used by dock
  ICO.attach = ICO.paperclip;
  ICO.sticker = ICO['sticker-note'] || ICO.smile;
  /* R73: TG chrome-only in-capsule = sticker-note (peel face); moon kept as alias */
  ICO.emoji = ICO['sticker-note'] || ICO.smile;
  ICO.invite = ICO['user-plus'];
  ICO.ai = ICO.sparkles;
  ICO.back = ICO['chevron-left'];
  ICO.close = ICO.x;
  ICO.compose = ICO.pen;
  ICO.empty = ICO['message-circle'];
  ICO.scrollDown = ICO['chevron-down'];
  ICO.sendUp = ICO['arrow-up'];
  ICO.more = ICO['more-horizontal'];
  ICO.circleMsg = ICO['video-message'];
  ICO.calls = ICO.phone;
  /* REF S36 — overlapping double bubbles on Чаты tab */
  ICO.chats = ICO['messages-square'] || ICO['message-circle'];
  ICO.contacts = ICO.contact || ICO.users;
  ICO.mute = ICO['bell-off'] || ICO['volume-x'];
  ICO.chevronRight = ICO['chevron-right'];
  ICO.stop = ICO.square;
  ICO.bell = ICO.bell;
  ICO.lock = ICO.lock;
  ICO.globe = ICO.globe;
  ICO.info = ICO.info;
  ICO.profile = ICO.contact;
  ICO.bookmark = ICO.bookmark || ICO.pin;

  global.HuginnIcons = { svg, ICO, PATHS, LUCIDE_VERSION: '0.460.x' };
})(typeof window !== 'undefined' ? window : global);
