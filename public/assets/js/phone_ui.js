/**
 * ASGARD CRM — PBX softphone UI (header + cards)
 */
(function () {
  'use strict';

  var TEL_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'BUH'];
  var esc = function (s) {
    if (s == null) return '';
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(String(s)));
    return d.innerHTML;
  };
  var toast = function (title, msg, type) {
    if (window.AsgardUI && AsgardUI.toast) AsgardUI.toast(title, msg || '', type || 'ok');
  };

  var dom = {};
  var timerId = null;
  var timerStart = 0;
  var noteTimer = null;
  var noteKey = 'asgard_phone_note';
  var dockMini = false;
  var incomingPulseTimer = null;
  var transferMode = 'blind';
  var soundEnabled = localStorage.getItem('tel:sound') !== '0';
  var audioCtx = null;
  // Гибрид с Huginn-рейлом: пока док доступен, звонок живёт в его панели (#hgPanel),
  // .ph-card / .ph-bar остаются запасным UI для узких экранов и /h/ без дока.
  var uiMode = 'idle'; // idle | incoming | incall
  var lastIncoming = null;
  var lastCallDetail = null;
  var callStartedAt = 0;
  var panelEl = null;
  var autoOpened = null;
  var missedUnack = 0;
  var railStatus = 'offline';
  var badgeTimer = null;
  var SVG = function (paths) {
    return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  };
  var SVG_DOCK = function (paths) {
    return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.45" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  };
  var SVG_FILL = function (paths) {
    return '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">' + paths + '</svg>';
  };
  var ICON = {
    mic: SVG_FILL('<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7z"/>'),
    micOff: SVG_FILL('<path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3-.06 0-.11.02-.17.02l3.15 3.15zM4.41 2.86 3 4.27l6 6V11c0 1.66 1.34 3 3 3 .23 0 .44-.03.65-.08l1.66 1.66c-.7.33-1.48.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21l1.41-1.41L4.41 2.86z"/>'),
    hold: SVG_FILL('<rect x="5" y="3" width="5" height="18" rx="1.5"/><rect x="14" y="3" width="5" height="18" rx="1.5"/>'),
    keypad: SVG_FILL('<circle cx="5" cy="5" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="12" cy="19" r="2"/><circle cx="19" cy="19" r="2"/>'),
    transfer: SVG_FILL('<path d="M8 4v3H3v3h5v3l5-4.5L8 4zm8 16v-3h5v-3h-5v-3l-5 4.5L16 20z"/>'),
    hangup: SVG_FILL('<path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1C10.61 21 3 13.39 3 4c0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>'),
    browser: SVG_FILL('<path d="M3 4h18a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-7v2h3v2H8v-2h3v-2H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 2v8h16V6H4z"/>'),
    mobile: SVG_FILL('<path d="M8 1h8a2 2 0 0 1 2 2v18a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2zm4 19a1.25 1.25 0 1 0 0-2.5A1.25 1.25 0 0 0 12 20z"/>'),
    micCheck: SVG_FILL('<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7z"/>'),
    dial: SVG_FILL('<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 5v4.2l2.6 1.5-.9 1.55L11 12.4V7h2z"/>'),
    offline: SVG_FILL('<path d="M12 2a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-3 0v-7A1.5 1.5 0 0 1 12 2zm6.36 4.64a1.25 1.25 0 0 1 0 1.77 7.5 7.5 0 1 1-10.72 0 1.25 1.25 0 1 1 1.77-1.77 5 5 0 1 0 7.18 0 1.25 1.25 0 0 1 1.77 0z"/>'),
    note: SVG_FILL('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm0 2.5L17.5 8H14V4.5zM8 13h8v1.8H8V13zm0 3.7h6V18.5H8V16.7z"/>'),
    chevronDown: SVG_FILL('<path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z"/>'),
    chevronUp: SVG_FILL('<path d="M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z"/>'),
  };

  function playTone(kind) {
    if (!soundEnabled || document.body.classList.contains('is-gallery')) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      var o = audioCtx.createOscillator();
      var g = audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination);
      var now = audioCtx.currentTime;
      if (kind === 'ring') { o.frequency.value = 440; g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.04, now + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.35); }
      else if (kind === 'ok') { o.frequency.value = 660; g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.05, now + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22); }
      else { o.frequency.value = 220; g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.04, now + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.28); }
      o.type = 'sine';
      o.start(now); o.stop(now + 0.4);
    } catch (_) {}
  }

  function menuItem(action, ico, title, sub, danger) {
    return (
      '<button type="button" class="ph-menu-item' + (danger ? ' ph-menu-item--danger' : '') + '" data-action="' + action + '">' +
        '<span class="ph-menu-item__ico">' + ico + '</span>' +
        '<span class="ph-menu-item__body">' +
          '<span class="ph-menu-item__title">' + title + '</span>' +
          (sub ? '<span class="ph-menu-item__sub">' + sub + '</span>' : '') +
        '</span>' +
      '</button>'
    );
  }

  function initialsFrom(name, phone) {
    var s = String(name || '').trim();
    if (s) {
      var parts = s.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
      return s.slice(0, 2).toUpperCase();
    }
    var d = String(phone || '').replace(/\D/g, '');
    return d.slice(-2) || '•';
  }

  function dockBtn(id, ico, label, extraClass) {
    return (
      '<div class="ph-dock-item">' +
        '<button type="button" class="ph-iconbtn' + (extraClass ? ' ' + extraClass : '') + '" id="' + id + '" title="' + label + '" aria-label="' + label + '" data-tooltip="' + label + '">' + ico + '</button>' +
        '<span>' + label + '</span>' +
      '</div>'
    );
  }

  function userRole() {
    try {
      var a = window.AsgardAuth && AsgardAuth.getAuth && AsgardAuth.getAuth();
      if (a && a.user) return a.user.role || '';
    } catch (_) {}
    return '';
  }

  function fmtPhone(p) {
    var d = String(p || '').replace(/\D/g, '');
    if (d.length === 11 && d.charAt(0) === '7') {
      return '+7 (' + d.substr(1, 3) + ') ' + d.substr(4, 3) + '-' + d.substr(7, 2) + '-' + d.substr(9, 2);
    }
    return p || '—';
  }

  function fmtTimer(ms) {
    var s = Math.floor(ms / 1000);
    var m = Math.floor(s / 60);
    s = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function ensureShell() {
    if (dom.root) return;
    var slot = document.getElementById('asgardPhoneSlot');
    if (!slot) {
      var badges = document.querySelector('.topbar .badges');
      if (badges) {
        slot = document.createElement('span');
        slot.id = 'asgardPhoneSlot';
        badges.insertBefore(slot, badges.firstChild);
      }
    }
    if (slot && !dom.btn) {
      dom.btn = document.createElement('button');
      dom.btn.type = 'button';
      dom.btn.className = 'ph-btn ph-btn--offline';
      dom.btn.id = 'asgardPhoneBtn';
      dom.btn.title = 'Телефон PBX';
      dom.btn.innerHTML = '<span class="ph-btn-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg></span><span class="ph-btn-label">Телефон</span><span class="ph-btn-dot"></span>';
      dom.btn.addEventListener('click', toggleMenu);
      slot.appendChild(dom.btn);
    }

    dom.menu = document.getElementById('asgardPhoneMenu');
    if (!dom.menu) {
      dom.menu = document.createElement('div');
      dom.menu.id = 'asgardPhoneMenu';
      dom.menu.className = 'ph-menu';
      dom.menu.style.display = 'none';
      document.body.appendChild(dom.menu);
    }

    dom.incoming = document.getElementById('asgardPhoneIncoming');
    if (!dom.incoming) {
      dom.incoming = document.createElement('div');
      dom.incoming.id = 'asgardPhoneIncoming';
      dom.incoming.className = 'ph-card ph-card--incoming';
      dom.incoming.style.display = 'none';
      document.body.appendChild(dom.incoming);
    }

    dom.incall = document.getElementById('asgardPhoneIncall');
    if (!dom.incall) {
      dom.incall = document.createElement('div');
      dom.incall.id = 'asgardPhoneIncall';
      dom.incall.className = 'ph-bar';
      dom.incall.style.display = 'none';
      document.body.appendChild(dom.incall);
    }

    dom.takeover = document.getElementById('asgardPhoneTakeover');
    if (!dom.takeover) {
      dom.takeover = document.createElement('div');
      dom.takeover.id = 'asgardPhoneTakeover';
      dom.takeover.className = 'ph-takeover';
      dom.takeover.style.display = 'none';
      dom.takeover.innerHTML = '<div class="ph-takeover-inner"><p>Телефон активен в другой вкладке</p><button type="button" class="btn sm primary" id="phClaimTab">Перехватить</button></div>';
      document.body.appendChild(dom.takeover);
      dom.takeover.querySelector('#phClaimTab').addEventListener('click', function () {
        if (window.AsgardPhone) AsgardPhone.claimTab().catch(function (e) { toast('Телефон', e.message, 'err'); });
      });
    }

    dom.audioBanner = document.getElementById('asgardPhoneAudioBanner');
    if (!dom.audioBanner) {
      dom.audioBanner = document.createElement('div');
      dom.audioBanner.id = 'asgardPhoneAudioBanner';
      dom.audioBanner.className = 'ph-audio-banner';
      dom.audioBanner.style.display = 'none';
      dom.audioBanner.innerHTML = '<span>Звук звонка заблокирован браузером</span><button type="button" class="btn sm ghost" id="phUnblockAudio">Включить</button>';
      document.body.appendChild(dom.audioBanner);
      dom.audioBanner.querySelector('#phUnblockAudio').addEventListener('click', function () {
        if (window.AsgardPhone) AsgardPhone.playRemoteAudio().then(function () { dom.audioBanner.style.display = 'none'; });
      });
    }

    document.addEventListener('click', function (e) {
      if (!dom.menu || dom.menu.style.display === 'none') return;
      if (dom.menu.contains(e.target) || (dom.btn && dom.btn.contains(e.target))) return;
      dom.menu.style.display = 'none';
    });
  }

  function setBtnState(st) {
    railStatus = st || 'offline';
    syncRail();
    if (!dom.btn) return;
    dom.btn.className = 'ph-btn ph-btn--' + (st || 'offline');
    var dot = dom.btn.querySelector('.ph-btn-dot');
    if (dot) dot.className = 'ph-btn-dot ph-dot--' + (st || 'offline');
  }

  function dock() {
    var D = window.HuginnDock;
    if (!D || typeof D.isUsable !== 'function' || !D.isUsable()) return null;
    return D;
  }

  function panelShown() {
    var D = dock();
    return !!(D && panelEl && document.body.contains(panelEl) && D.isPanelOpen('phone'));
  }

  function syncRail() {
    var D = window.HuginnDock;
    if (!D || typeof D.setPhoneRail !== 'function') return;
    D.setPhoneRail({ visible: true, status: railStatus, badge: missedUnack });
  }

  /** Шапочная кнопка «Телефон» дублирует рейл — прячем, пока док доступен. */
  function syncHeaderBtn() {
    if (!dom.btn) return;
    var hide = !!dock();
    dom.btn.style.display = hide ? 'none' : '';
    if (hide && dom.menu) dom.menu.style.display = 'none';
  }

  function refreshBadge() {
    if (document.hidden) return Promise.resolve();
    return fetch('/api/telephony/missed?scope=mine&acknowledged=false&limit=6', {
      headers: { Authorization: 'Bearer ' + (localStorage.getItem('asgard_token') || '') },
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
      if (!data) return null;
      missedUnack = Number(data.unacknowledged) || 0;
      syncRail();
      return data;
    }).catch(function () { return null; });
  }

  function renderOfflineMenu() {
    dom.menu.innerHTML =
      '<div class="ph-menu-head">Телефон PBX</div>' +
      menuItem('online-browser', ICON.browser, 'На линии', 'Звонки в браузере') +
      menuItem('online-mobile', ICON.mobile, 'На линии', 'Переадресация на мобильный') +
      menuItem('mic', ICON.micCheck, 'Проверить микрофон', 'Доступ к устройству');
    bindMenuActions();
  }

  function renderOnlineMenu() {
    dom.menu.innerHTML =
      '<div class="ph-menu-head">На линии</div>' +
      menuItem('dial', ICON.dial, 'Набрать номер', 'Исходящий звонок') +
      menuItem('offline', ICON.offline, 'Сойти с линии', 'Статус offline', true);
    bindMenuActions();
  }

  function bindMenuActions() {
    dom.menu.querySelectorAll('[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        dom.menu.style.display = 'none';
        runPhoneAction(btn.getAttribute('data-action'));
      });
    });
  }

  function runPhoneAction(act) {
    var P = window.AsgardPhone;
    if (!P) return;
    if (act === 'online-browser') {
      P.checkMic().then(function (m) {
        if (!m.ok) toast('Микрофон', m.error || 'нет доступа', 'warn');
        return P.goOnline('browser');
      }).then(function (r) {
        if (r && r.reason === 'takeover') showTakeover(true);
        else syncUi(P.getState());
      }).catch(function (e) { toast('Телефон', e.message, 'err'); });
    } else if (act === 'online-mobile') {
      P.goOnline('mobile').then(function (r) {
        if (r && r.reason === 'takeover') showTakeover(true);
        else syncUi(P.getState());
      }).catch(function (e) { toast('Телефон', e.message, 'err'); });
    } else if (act === 'offline') {
      P.goOffline().then(function () { syncUi(P.getState()); });
    } else if (act === 'mic') {
      P.checkMic().then(function (m) {
        toast('Микрофон', m.ok ? 'Доступ есть' : (m.error || 'ошибка'), m.ok ? 'ok' : 'err');
      });
    } else if (act === 'dial') {
      openDialPad('');
    }
  }

  function toggleMenu() {
    ensureShell();
    var P = window.AsgardPhone;
    if (!P) return;
    var D = dock();
    if (D) { dom.menu.style.display = 'none'; D.openTab('phone'); return; }
    var st = P.getState();
    if (dom.menu.style.display === 'block') {
      dom.menu.style.display = 'none';
      return;
    }
    if (st === 'offline') renderOfflineMenu();
    else renderOnlineMenu();
    var rect = dom.btn.getBoundingClientRect();
    dom.menu.style.display = 'block';
    dom.menu.style.top = rect.bottom + 8 + 'px';
    dom.menu.style.right = Math.max(8, window.innerWidth - rect.right) + 'px';
  }

  function showTakeover(on) {
    ensureShell();
    dom.takeover.style.display = on ? 'flex' : 'none';
  }

  function tickCallTimer() {
    var txt = fmtTimer(Date.now() - (timerStart || Date.now()));
    document.querySelectorAll('.ph-js-timer').forEach(function (el) { el.textContent = txt; });
  }

  function startCallTimer() {
    if (!timerStart) timerStart = Date.now();
    tickCallTimer();
    if (timerId) return;
    timerId = setInterval(tickCallTimer, 1000);
  }

  function stopCallTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
    timerStart = 0;
  }

  function incomingView(detail) {
    var num = detail.number || '';
    var lookup = (detail.callMeta && detail.callMeta.lookup) || detail.lookup || {};
    var sub = fmtPhone(num);
    if (lookup.company) sub += ' · ' + lookup.company;
    return {
      title: lookup.name || lookup.client_name || fmtPhone(num),
      sub: sub,
      ini: initialsFrom(lookup.name || lookup.client_name, num),
    };
  }

  function renderIncoming(detail) {
    ensureShell();
    lastIncoming = detail || {};
    uiMode = 'incoming';
    setBtnState('ring');
    playTone('ring');
    var D = dock();
    if (D) {
      if (!D.isPanelOpen('phone')) {
        if (!autoOpened) autoOpened = { prevTab: D.getTab(), wasCollapsed: D.isCollapsed() };
        D.openTab('phone');
      } else {
        paintPanel();
      }
      if (panelShown()) { hideIncomingCard(); return; }
    }
    showIncomingCard(lastIncoming);
  }

  function showIncomingCard(detail) {
    ensureShell();
    var v = incomingView(detail);
    var title = v.title;
    var sub = v.sub;
    var ini = v.ini;
    dom.incoming.className = 'ph-card ph-card--incoming';
    dom.incoming.innerHTML =
      '<div class="ph-card-inner">' +
        '<div class="ph-card-top">' +
          '<div class="ph-avatar" aria-hidden="true">' + esc(ini) + '</div>' +
          '<div class="ph-card-meta">' +
            '<div class="ph-card-title">Входящий звонок</div>' +
            '<div class="ph-card-name">' + esc(title) + '</div>' +
            '<div class="ph-card-sub">' + esc(sub) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="ph-card-actions">' +
          '<button type="button" class="ph-act ph-act--answer" id="phAnswer" data-tooltip="Ответить (Space)">Ответить</button>' +
          '<button type="button" class="ph-act ph-act--hangup" id="phDecline" data-tooltip="Сбросить (Esc)">Сбросить</button>' +
        '</div>' +
      '</div>';
    dom.incoming.style.display = 'block';
    clearTimeout(incomingPulseTimer);
    incomingPulseTimer = setTimeout(function () {
      if (dom.incoming && dom.incoming.style.display === 'block') {
        dom.incoming.classList.add('ph-card--incoming-pulse');
      }
    }, 8000);
    dom.incoming.querySelector('#phAnswer').onclick = function () {
      AsgardPhone.answer().catch(function (e) { toast('Телефон', e.message, 'err'); });
    };
    dom.incoming.querySelector('#phDecline').onclick = function () {
      AsgardPhone.hangup();
    };
  }

  function hideIncomingCard() {
    clearTimeout(incomingPulseTimer);
    if (dom.incoming) {
      dom.incoming.classList.remove('ph-card--incoming-pulse');
      dom.incoming.style.display = 'none';
    }
  }

  function hideIncoming() {
    hideIncomingCard();
    lastIncoming = null;
    if (uiMode === 'incoming') uiMode = 'idle';
  }

  function renderIncall(detail) {
    ensureShell();
    hideIncoming();
    uiMode = 'incall';
    if (detail && detail.number) lastCallDetail = detail;
    else if (!lastCallDetail) lastCallDetail = detail || {};
    setBtnState('incall');
    startCallTimer();
    if (dock() && panelShown()) {
      hideIncallBar();
      paintPanel();
      return;
    }
    showIncallBar(lastCallDetail);
  }

  function openPhoneInDock() {
    var D = dock();
    if (D) D.openTab('phone');
  }

  /** Пилюля разговора. При живом доке — всегда mini (таймер + сброс), клик возвращает в панель. */
  function showIncallBar(detail) {
    var hybrid = !!dock();
    var mini = hybrid || dockMini;
    var meta = (window.AsgardPhone && AsgardPhone.getCallMeta()) || {};
    var num = detail.number || meta.number || '';
    var note = localStorage.getItem(noteKey + ':' + num) || '';
    var isMuted = window.AsgardPhone && AsgardPhone.isMuted && AsgardPhone.isMuted();
    var isHeld = window.AsgardPhone && AsgardPhone.getState() === 'held';
    var noteOpen = !!String(note || '').trim() && !mini;
    var miniLabel = hybrid ? 'Открыть в панели' : (dockMini ? 'Развернуть' : 'Свернуть');
    dom.incall.className = 'ph-bar' + (isHeld ? ' ph-bar--hold' : '') + (noteOpen ? ' is-note-open' : '') + (mini ? ' ph-bar--mini' : '');
    dom.incall.innerHTML =
      '<div class="ph-bar-actions">' +
        '<div class="ph-bar-meta">' +
          '<span class="ph-bar-timer ph-js-timer" id="phIncallTimer">00:00</span>' +
          '<span class="ph-bar-num">' + esc(fmtPhone(num)) + '</span>' +
        '</div>' +
        dockBtn('phMute', isMuted ? ICON.micOff : ICON.mic, isMuted ? 'Вкл. мик' : 'Микрофон', isMuted ? 'ph-iconbtn--active' : '') +
        dockBtn('phHold', ICON.hold, isHeld ? 'Снять' : 'Удерж.', isHeld ? 'ph-iconbtn--active' : '') +
        dockBtn('phKeypad', ICON.keypad, 'Клавиши', '') +
        dockBtn('phTransfer', ICON.transfer, 'Перевод', '') +
        dockBtn('phNoteToggle', ICON.note, 'Заметка', noteOpen ? 'ph-iconbtn--active' : '') +
        '<div class="ph-dock-item ph-dock-item--keep ph-dock-item--mini-toggle">' +
          '<button type="button" class="ph-iconbtn ph-iconbtn--mini" id="phDockMini" title="' + miniLabel + '" aria-label="' + miniLabel + '" data-tooltip="' + miniLabel + '">' + (mini ? ICON.chevronUp : ICON.chevronDown) + '</button>' +
        '</div>' +
        dockBtn('phHangup', ICON.hangup, 'Сброс', 'ph-iconbtn--danger') +
      '</div>' +
      '<textarea class="ph-note" id="phNote" placeholder="Заметка…" rows="1">' + esc(note) + '</textarea>';
    dom.incall.style.display = 'flex';
    tickCallTimer();

    var miniBtn = dom.incall.querySelector('#phDockMini');
    if (miniBtn) {
      miniBtn.onclick = function (e) {
        e.stopPropagation();
        if (hybrid) { openPhoneInDock(); return; }
        dockMini = !dockMini;
        showIncallBar(detail);
      };
    }
    if (mini) {
      dom.incall.onclick = function (e) {
        if (e.target && (e.target.id === 'phHangup' || e.target.closest('#phHangup'))) return;
        if (e.target && (e.target.id === 'phDockMini' || e.target.closest('#phDockMini'))) return;
        if (hybrid) { openPhoneInDock(); return; }
        dockMini = false;
        showIncallBar(detail);
      };
    } else {
      dom.incall.onclick = null;
    }

    dom.incall.querySelector('#phHangup').onclick = function () { playTone('end'); AsgardPhone.hangup(); };
    dom.incall.querySelector('#phHold').onclick = function () {
      var held = AsgardPhone.getState() === 'held';
      var holdBtn = dom.incall.querySelector('#phHold');
      AsgardPhone.hold(!held).then(function () {
        if (holdBtn) holdBtn.classList.toggle('ph-iconbtn--active', !held);
        dom.incall.classList.toggle('ph-bar--hold', !held);
        var lab = holdBtn && holdBtn.parentElement && holdBtn.parentElement.querySelector('span');
        if (lab) lab.textContent = !held ? 'Снять' : 'Удерж.';
      }).catch(function (e) { toast('Телефон', e.message, 'err'); });
    };
    dom.incall.querySelector('#phKeypad').onclick = function () { openDialPad(num); };
    dom.incall.querySelector('#phTransfer').onclick = openTransferModal;
    dom.incall.querySelector('#phMute').onclick = function () {
      var next = !(AsgardPhone.isMuted && AsgardPhone.isMuted());
      var muteBtn = dom.incall.querySelector('#phMute');
      AsgardPhone.setMuted(next).then(function () {
        if (muteBtn) {
          muteBtn.classList.toggle('ph-iconbtn--active', next);
          muteBtn.innerHTML = next ? ICON.micOff : ICON.mic;
          var lab = muteBtn.parentElement && muteBtn.parentElement.querySelector('span');
          if (lab) lab.textContent = next ? 'Вкл. мик' : 'Микрофон';
        }
      }).catch(function (e) { toast('Телефон', e.message, 'err'); });
    };
    var noteEl = dom.incall.querySelector('#phNote');
    var noteToggle = dom.incall.querySelector('#phNoteToggle');
    if (noteToggle) {
      noteToggle.onclick = function () {
        var open = dom.incall.classList.toggle('is-note-open');
        noteToggle.classList.toggle('ph-iconbtn--active', open);
        if (open && noteEl) {
          noteEl.focus();
        }
      };
    }
    noteEl.addEventListener('input', function () {
      clearTimeout(noteTimer);
      noteTimer = setTimeout(function () {
        localStorage.setItem(noteKey + ':' + num, noteEl.value);
      }, 400);
    });
  }

  function hideIncallBar() {
    if (dom.incall) dom.incall.style.display = 'none';
  }

  function hideIncall() {
    stopCallTimer();
    hideIncallBar();
    lastCallDetail = null;
    if (uiMode === 'incall') uiMode = 'idle';
  }

  // ── Панель «Телефон» в Huginn-доке ─────────────────────────────────────────

  var _apiGetFailToast = Object.create(null);
  function apiGet(url) {
    return fetch(url, {
      headers: { Authorization: 'Bearer ' + (localStorage.getItem('asgard_token') || '') },
    }).then(function (r) {
      if (r.ok) return r.json();
      if (!_apiGetFailToast[url]) {
        _apiGetFailToast[url] = true;
        toast('Телефон', 'Не удалось загрузить ' + url.replace(/^\/api\/telephony\/?/, '') + ' (' + r.status + ')', 'warn');
      }
      return null;
    }).catch(function () {
      if (!_apiGetFailToast[url]) {
        _apiGetFailToast[url] = true;
        toast('Телефон', 'Сеть: ' + url.replace(/^\/api\/telephony\/?/, ''), 'warn');
      }
      return null;
    });
  }

  var panelData = { missed: null, recent: null, loadedAt: 0, loading: false, opStatus: null, transferStatus: null };

  function loadPanelData(force) {
    if (panelData.loading) return;
    if (!force && panelData.loadedAt && Date.now() - panelData.loadedAt < 30000) return;
    panelData.loading = true;
    Promise.all([
      refreshBadge(),
      apiGet('/api/telephony/me/summary'),
      apiGet('/api/telephony/pbx/operator/status'),
    ]).then(function (res) {
      panelData.missed = (res[0] && res[0].items) || [];
      panelData.recent = (res[1] && res[1].recent) || [];
      panelData.opStatus = res[2] || panelData.opStatus;
      panelData.loadedAt = Date.now();
    }).finally(function () {
      panelData.loading = false;
      if (panelShown() && currentPanelView() === 'idle') paintPanel();
    });
  }

  function currentPanelView() {
    if (uiMode === 'incoming') return 'incoming';
    if (uiMode === 'incall') return 'incall';
    var P = window.AsgardPhone;
    if (P && P.getState() === 'ringing') {
      var meta = P.getCallMeta() || {};
      if (meta.direction === 'outbound') return 'dialing';
    }
    return 'idle';
  }

  function savePanelNote() {
    if (!panelEl) return;
    var n = panelEl.querySelector('#phDpNote');
    if (!n) return;
    clearTimeout(noteTimer);
    localStorage.setItem(noteKey + ':' + (n.getAttribute('data-num') || ''), n.value);
  }

  function panelHead(title, sub) {
    var close = (window.HuginnIcons && HuginnIcons.ICO && HuginnIcons.ICO.close) || '×';
    return '<div class="hg-panel-head">' +
      '<h2>' + esc(title) + (sub ? ' <span class="ph-dp-headsub">' + esc(sub) + '</span>' : '') + '</h2>' +
      '<button type="button" class="hg-icon-btn" data-ph-dp="collapse" title="Свернуть" aria-label="Свернуть">' + close + '</button>' +
    '</div>';
  }

  function callRowHtml(it, kind, online) {
    var missed = kind === 'missed';
    var num = missed ? it.from_number : (it.direction === 'outbound' ? it.to_number : it.from_number);
    var name = it.client_name || fmtPhone(num || '');
    var dirCls = missed || it.call_type === 'missed' ? 'is-missed' : (it.direction === 'outbound' ? 'is-out' : 'is-in');
    var meta = fmtWhen(it.created_at);
    if (!missed && it.duration_seconds) meta += ' · ' + fmtTimer(it.duration_seconds * 1000);
    if (it.client_name && num) meta = fmtPhone(num) + ' · ' + meta;
    return '<div class="ph-dp-row ' + dirCls + '" data-ph-open="' + (missed ? 'missed' : 'log') + '" data-id="' + esc(it.id) + '">' +
      '<span class="ph-dp-row-dot" aria-hidden="true"></span>' +
      '<div class="ph-dp-row-main">' +
        '<div class="ph-dp-row-name">' + esc(name) + '</div>' +
        '<div class="ph-dp-row-meta">' + esc(meta) + '</div>' +
      '</div>' +
      (online && num ? '<button type="button" class="ph-dp-row-call" data-ph-call="' + esc(num) + '" title="Перезвонить" aria-label="Перезвонить">' + ICON.hangup + '</button>' : '') +
    '</div>';
  }

  function fmtWhen(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    var hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) return hm;
    var y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'вчера ' + hm;
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ' ' + hm;
  }

  function lineBannersHtml(opSt) {
    opSt = opSt || panelData.opStatus || {};
    var banners = [];
    if (opSt.on_line) {
      banners.push('<div class="ph-dp-hint">Пока вы на линии, автоблокировка PIN отключена. Ctrl+Shift+L — отойти и заблокировать.</div>');
      var noSip = !opSt.webrtc_registered && !opSt.has_sip;
      var noMob = !opSt.has_mobile && !opSt.mobile_phone;
      if (noSip && noMob) {
        banners.push('<div class="ph-dp-banner ph-dp-banner--err">Вас не дозвонятся: нет SIP и нет мобильного.</div>');
      } else if (noSip && opSt.receive_mode !== 'mobile') {
        banners.push('<div class="ph-dp-banner ph-dp-banner--warn">SIP не зарегистрирован — входящие пойдут на мобильный (если указан).</div>');
      }
      if (typeof opSt.minutes_to_work_end === 'number' && opSt.minutes_to_work_end >= 0 && opSt.minutes_to_work_end <= 5 && opSt.work_hours_active) {
        banners.push('<div class="ph-dp-banner ph-dp-banner--warn">Рабочий день заканчивается — с линии снимут в конце смены' +
          (opSt.duty_until ? ' (дежурный до ' + esc(opSt.duty_until) + ')' : '') + '.</div>');
      }
      if (!opSt.work_hours_active) {
        banners.push('<div class="ph-dp-banner ph-dp-banner--warn">Вне рабочих часов. Дежурный остаётся до ' + esc(opSt.duty_until || '—') + '.</div>');
      }
      if (opSt.online_count === 1) {
        banners.push('<div class="ph-dp-hint">Сейчас на линии только вы — входящие пойдут вам.</div>');
      }
    }
    if (panelData.transferStatus) {
      var ts = panelData.transferStatus;
      var label = ({ trying: 'Перевод…', answered: 'Перевод: ответил', noanswer: 'Перевод: не ответил', returned: 'Перевод: возврат', failed: 'Перевод не удался' })[ts.status] || ('Перевод: ' + ts.status);
      banners.push('<div class="ph-dp-banner">' + esc(label) + '</div>');
    }
    return banners.join('');
  }

  function idlePanelHtml() {
    var P = window.AsgardPhone;
    var st = P ? P.getState() : 'offline';
    var online = st !== 'offline';
    var mode = P && P.getMode ? P.getMode() : '';
    var line = online
      ? '<div class="ph-dp-line is-on">' +
          '<span class="ph-dp-line-dot" aria-hidden="true"></span>' +
          '<div class="ph-dp-line-txt"><b>На линии</b><span>' + (mode === 'mobile' ? 'звонки идут на мобильный' : 'звонки в браузере') + '</span></div>' +
          '<button type="button" class="ph-dp-btn ph-dp-btn--ghost" data-ph-act="offline">Сойти с линии</button>' +
        '</div>'
      : '<div class="ph-dp-line">' +
          '<div class="ph-dp-line-txt"><b>Не на линии</b><span>Выберите, куда принимать звонки</span></div>' +
          '<div class="ph-dp-line-btns">' +
            '<button type="button" class="ph-dp-btn ph-dp-btn--primary" data-ph-act="online-browser">В браузере</button>' +
            '<button type="button" class="ph-dp-btn" data-ph-act="online-mobile">На мобильный</button>' +
          '</div>' +
          '<button type="button" class="ph-dp-link" data-ph-act="mic">Проверить микрофон</button>' +
        '</div>';
    var dial =
      '<form class="ph-dp-dial" data-ph-dp="dial">' +
        '<input type="tel" class="ph-dp-input" id="phDpDial" placeholder="+7…" autocomplete="off"' + (online ? '' : ' disabled') + '>' +
        '<button type="submit" class="ph-dp-btn ph-dp-btn--primary"' + (online ? '' : ' disabled') + '>Позвонить</button>' +
      '</form>' +
      (online ? '' : '<div class="ph-dp-hint">Чтобы позвонить, встаньте на линию.</div>');
    var loading = panelData.missed === null;
    var missed = panelData.missed || [];
    var recent = panelData.recent || [];
    var missedHtml = loading ? '<div class="ph-dp-empty">Загрузка…</div>'
      : (missed.length ? missed.map(function (it) { return callRowHtml(it, 'missed', online); }).join('')
        : '<div class="ph-dp-empty">Непрочитанных пропущенных нет</div>');
    var recentHtml = loading ? '<div class="ph-dp-empty">Загрузка…</div>'
      : (recent.length ? recent.map(function (it) { return callRowHtml(it, 'log', online); }).join('')
        : '<div class="ph-dp-empty">Сегодня звонков не было</div>');
    return panelHead('Телефон') +
      '<div class="ph-dp">' +
        line + lineBannersHtml() + dial +
        '<div class="ph-dp-sec">' +
          '<div class="ph-dp-sec-head"><span>Мои пропущенные' + (missedUnack ? ' <b class="ph-dp-count">' + missedUnack + '</b>' : '') + '</span>' +
            '<a href="#/telephony?tab=missed" class="ph-dp-link">Все</a></div>' +
          missedHtml +
        '</div>' +
        '<div class="ph-dp-sec">' +
          '<div class="ph-dp-sec-head"><span>Последние</span><a href="#/telephony" class="ph-dp-link">Журнал</a></div>' +
          recentHtml +
        '</div>' +
      '</div>';
  }

  function incomingPanelHtml() {
    var v = incomingView(lastIncoming || {});
    return panelHead('Входящий звонок') +
      '<div class="ph-dp ph-dp--call">' +
        '<div class="ph-dp-who">' +
          '<div class="ph-dp-avatar is-ring" aria-hidden="true">' + esc(v.ini) + '</div>' +
          '<div class="ph-dp-who-name">' + esc(v.title) + '</div>' +
          '<div class="ph-dp-who-sub">' + esc(v.sub) + '</div>' +
        '</div>' +
        '<div class="ph-dp-callacts">' +
          '<button type="button" class="ph-act ph-act--answer" data-ph-dp="answer" title="Ответить (Space)">Ответить</button>' +
          '<button type="button" class="ph-act ph-act--hangup" data-ph-dp="hangup" title="Сбросить (Esc)">Сбросить</button>' +
        '</div>' +
        '<div class="ph-dp-hint">Space — ответить, Esc — сбросить</div>' +
      '</div>';
  }

  function dialingPanelHtml() {
    var P = window.AsgardPhone;
    var meta = (P && P.getCallMeta()) || {};
    var num = meta.number || '';
    var lookup = meta.lookup || {};
    var title = lookup.name || lookup.client_name || fmtPhone(num);
    return panelHead('Исходящий звонок') +
      '<div class="ph-dp ph-dp--call">' +
        '<div class="ph-dp-who">' +
          '<div class="ph-dp-avatar is-ring" aria-hidden="true">' + esc(initialsFrom(lookup.name || lookup.client_name, num)) + '</div>' +
          '<div class="ph-dp-who-name">' + esc(title) + '</div>' +
          '<div class="ph-dp-who-sub">Вызов…</div>' +
        '</div>' +
        '<div class="ph-dp-callacts">' +
          '<button type="button" class="ph-act ph-act--hangup" data-ph-dp="hangup">Отменить</button>' +
        '</div>' +
      '</div>';
  }

  function incallPanelHtml() {
    var P = window.AsgardPhone;
    var meta = (P && P.getCallMeta()) || {};
    var detail = lastCallDetail || {};
    var num = detail.number || meta.number || '';
    var lookup = meta.lookup || detail.lookup || {};
    var title = lookup.name || lookup.client_name || fmtPhone(num);
    var sub = fmtPhone(num);
    if (lookup.company) sub += ' · ' + lookup.company;
    var isMuted = !!(P && P.isMuted && P.isMuted());
    var isHeld = !!(P && P.getState() === 'held');
    var note = localStorage.getItem(noteKey + ':' + num) || '';
    function ctl(act, icon, label, active, danger) {
      return '<button type="button" class="ph-dp-ctl' + (active ? ' is-active' : '') + (danger ? ' is-danger' : '') + '" data-ph-dp="' + act + '">' +
        icon + '<span>' + esc(label) + '</span></button>';
    }
    return panelHead('Разговор', isHeld ? 'на удержании' : '') +
      '<div class="ph-dp ph-dp--call">' +
        '<div class="ph-dp-who">' +
          '<div class="ph-dp-avatar' + (isHeld ? ' is-held' : ' is-live') + '" aria-hidden="true">' + esc(initialsFrom(lookup.name || lookup.client_name, num)) + '</div>' +
          '<div class="ph-dp-who-name">' + esc(title) + '</div>' +
          '<div class="ph-dp-who-sub">' + esc(sub) + '</div>' +
          '<div class="ph-dp-timer ph-js-timer">' + fmtTimer(Date.now() - (timerStart || Date.now())) + '</div>' +
        '</div>' +
        '<div class="ph-dp-ctls">' +
          ctl('mute', isMuted ? ICON.micOff : ICON.mic, isMuted ? 'Вкл. мик' : 'Микрофон', isMuted) +
          ctl('hold', ICON.hold, isHeld ? 'Снять' : 'Удержание', isHeld) +
          ctl('keypad', ICON.keypad, 'Клавиши', false) +
          ctl('transfer', ICON.transfer, 'Перевод', false) +
        '</div>' +
        '<button type="button" class="ph-act ph-act--hangup ph-dp-hangup" data-ph-dp="hangup" title="Завершить (Esc)">Завершить</button>' +
        '<label class="ph-dp-notelbl">Заметка к звонку' +
          '<textarea class="ph-dp-note" id="phDpNote" data-num="' + esc(num) + '" rows="4" placeholder="Что обсудили…">' + esc(note) + '</textarea>' +
        '</label>' +
        '<div class="ph-dp-hint">M — микрофон, H — удержание, Esc — завершить</div>' +
      '</div>';
  }

  function paintPanel() {
    if (!panelEl || !document.body.contains(panelEl)) return;
    savePanelNote();
    var view = currentPanelView();
    var html = view === 'incoming' ? incomingPanelHtml()
      : view === 'incall' ? incallPanelHtml()
      : view === 'dialing' ? dialingPanelHtml()
      : idlePanelHtml();
    panelEl.innerHTML = html;
    panelEl.setAttribute('data-ph-view', view);
    if (view === 'idle') loadPanelData(false);
    if (view === 'incall') {
      tickCallTimer();
      var noteEl = panelEl.querySelector('#phDpNote');
      if (noteEl) {
        noteEl.addEventListener('input', function () {
          clearTimeout(noteTimer);
          noteTimer = setTimeout(function () {
            localStorage.setItem(noteKey + ':' + (noteEl.getAttribute('data-num') || ''), noteEl.value);
          }, 400);
        });
      }
    }
  }

  function onPanelClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var P = window.AsgardPhone;
    var actBtn = t.closest('[data-ph-act]');
    if (actBtn) { runPhoneAction(actBtn.getAttribute('data-ph-act')); return; }
    var callBtn = t.closest('[data-ph-call]');
    if (callBtn) {
      e.stopPropagation();
      if (P) P.outbound(callBtn.getAttribute('data-ph-call')).catch(function (err) { toast('Телефон', err.message, 'err'); });
      return;
    }
    var row = t.closest('[data-ph-open]');
    if (row) {
      var id = row.getAttribute('data-id');
      location.hash = '#/telephony?tab=' + row.getAttribute('data-ph-open') + (id ? '&id=' + encodeURIComponent(id) : '');
      return;
    }
    var b = t.closest('[data-ph-dp]');
    if (!b || !P) return;
    var a = b.getAttribute('data-ph-dp');
    if (a === 'collapse') {
      if (window.HuginnDock && HuginnDock.collapse) HuginnDock.collapse();
    } else if (a === 'answer') {
      P.answer().catch(function (err) { toast('Телефон', err.message, 'err'); });
    } else if (a === 'hangup') {
      playTone('end');
      P.hangup();
    } else if (a === 'mute') {
      var next = !(P.isMuted && P.isMuted());
      P.setMuted(next).then(paintPanel).catch(function (err) { toast('Телефон', err.message, 'err'); });
    } else if (a === 'hold') {
      P.hold(P.getState() !== 'held').then(paintPanel).catch(function (err) { toast('Телефон', err.message, 'err'); });
    } else if (a === 'keypad') {
      var d = lastCallDetail || {};
      openDialPad(d.number || (P.getCallMeta() || {}).number || '');
    } else if (a === 'transfer') {
      openTransferModal();
    }
  }

  function onPanelSubmit(e) {
    var f = e.target;
    if (!f || f.getAttribute('data-ph-dp') !== 'dial') return;
    e.preventDefault();
    var inp = f.querySelector('#phDpDial');
    var n = inp ? String(inp.value || '').trim() : '';
    if (!n || !window.AsgardPhone) return;
    AsgardPhone.outbound(n).catch(function (err) { toast('Телефон', err.message, 'err'); });
  }

  /** Вызывается HuginnDock.renderPanel при активном табе phone.
   *  Док может быть свёрнут / рейл скрыт — тогда панель не видна (panelShown=false),
   *  и прятать fallback (.ph-card/.ph-bar) нельзя: пользователь останется без UI звонка. */
  function renderPanel(el) {
    if (!el) return;
    if (panelEl !== el) {
      panelEl = el;
      if (!el.__phDpBound) {
        el.__phDpBound = true;
        var mine = function () {
          return !!el.getAttribute('data-ph-view') && !!window.HuginnDock && HuginnDock.getTab() === 'phone';
        };
        el.addEventListener('click', function (e) { if (mine()) onPanelClick(e); });
        el.addEventListener('submit', function (e) { if (mine()) onPanelSubmit(e); });
      }
    }
    if (panelShown()) {
      hideIncomingCard();
      hideIncallBar();
      paintPanel();
      return;
    }
    paintPanel();
    if (uiMode === 'incall') showIncallBar(lastCallDetail || {});
    else if (uiMode === 'incoming') showIncomingCard(lastIncoming || {});
  }

  /** Док перерисовал/свернул панель: перекладываем звонок между панелью и запасным UI. */
  function onDockLayout() {
    syncHeaderBtn();
    if (panelEl && !panelShown()) {
      savePanelNote();
      if (panelEl.getAttribute('data-ph-view') && !(window.HuginnDock && HuginnDock.getTab && HuginnDock.getTab() === 'phone')) {
        panelEl.removeAttribute('data-ph-view');
      }
    }
    if (panelShown()) {
      hideIncomingCard();
      hideIncallBar();
      paintPanel();
      return;
    }
    if (uiMode === 'incall') showIncallBar(lastCallDetail || {});
    else if (uiMode === 'incoming') showIncomingCard(lastIncoming || {});
  }

  function restoreAfterCall() {
    var D = dock();
    var prev = autoOpened;
    autoOpened = null;
    if (!D || !prev) return;
    if (D.getTab() !== 'phone') return;
    if (prev.prevTab && prev.prevTab !== 'phone') D.openTab(prev.prevTab);
    if (prev.wasCollapsed) D.collapse();
  }

  function openDialPad(prefill) {
    if (!window.AsgardUI || !AsgardUI.showModal) return;
    var html =
      '<label class="ph-dial-label">Номер<input type="tel" class="inp" id="phDialNum" value="' + esc(prefill || '') + '" placeholder="+7…"></label>' +
      '<div class="ph-dial-grid" id="phDialGrid"></div>' +
      '<button type="button" class="btn primary ph-dial-call" id="phDialCall">Позвонить</button>';
    var overlay = AsgardUI.showModal({ title: 'Набор номера', html: html, wide: false });
    var modalEl = overlay.querySelector('.cr-m');
    if (modalEl) modalEl.classList.add('ph-modal');
    var body = overlay.querySelector('#modalBody') || overlay;
    var grid = body.querySelector('#phDialGrid');
    if (grid) {
      '123456789*0#'.split('').forEach(function (k) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'ph-dial-key';
        b.textContent = k;
        b.onclick = function () {
          var inp = body.querySelector('#phDialNum');
          if (inp) inp.value += k;
        };
        grid.appendChild(b);
      });
    }
    var callBtn = body.querySelector('#phDialCall');
    if (callBtn) {
      callBtn.onclick = function () {
        var n = (body.querySelector('#phDialNum') || {}).value;
        AsgardPhone.outbound(n).then(function () {
          AsgardUI.closeModal && AsgardUI.closeModal();
        }).catch(function (e) { toast('Телефон', e.message, 'err'); });
      };
    }
  }

  function openTransferModal() {
    if (!window.AsgardUI || !AsgardUI.showModal) return;
    transferMode = 'blind';
    var html =
      '<input type="search" class="inp" id="phTrSearch" placeholder="Поиск сотрудника…">' +
      '<div class="ph-tr-list" id="phTrList">Загрузка…</div>' +
      '<div class="ph-seg" role="group" aria-label="Режим перевода">' +
        '<button type="button" class="ph-seg__btn is-active" data-mode="blind">Слепой</button>' +
        '<button type="button" class="ph-seg__btn" data-mode="consult">Консультативный</button>' +
      '</div>' +
      '<input type="hidden" name="phTrMode" id="phTrMode" value="blind">';
    var overlay = AsgardUI.showModal({ title: 'Перевод звонка', html: html });
    var modalEl = overlay.querySelector('.cr-m');
    if (modalEl) modalEl.classList.add('ph-modal');
    var body = overlay.querySelector('#modalBody') || overlay;
    var listEl = body.querySelector('#phTrList');
    var staff = [];
    body.querySelectorAll('.ph-seg__btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        body.querySelectorAll('.ph-seg__btn').forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        transferMode = btn.getAttribute('data-mode') || 'blind';
        var hid = body.querySelector('#phTrMode');
        if (hid) hid.value = transferMode;
      });
    });
    Promise.all([
      fetch('/api/telephony/employees', { headers: { Authorization: 'Bearer ' + (localStorage.getItem('asgard_token') || '') } }).then(function (r) { return r.json(); }),
      fetch('/api/telephony/pbx/transfer/staff', { headers: { Authorization: 'Bearer ' + (localStorage.getItem('asgard_token') || '') } })
        .then(function (r) { return r.ok ? r.json() : { staff: [] }; })
        .catch(function () { return { staff: [] }; }),
    ]).then(function (parts) {
      var emps = (parts[0] && parts[0].employees) || [];
      var online = {};
      ((parts[1] && parts[1].staff) || []).forEach(function (s) { online[s.user_id] = s; });
      staff = emps.map(function (e) {
        var st = online[e.id] || {};
        return {
          id: e.id,
          name: e.name || e.full_name,
          phone: st.sip_username || e.phone || e.internal_phone || st.mobile_phone,
          on_line: st.on_line,
          mode: st.receive_mode,
        };
      });
      paintStaff('');
    }).catch(function () {
      if (listEl) listEl.textContent = 'Не удалось загрузить список';
    });

    function paintStaff(q) {
      q = (q || '').toLowerCase();
      var rows = staff.filter(function (s) { return !q || (s.name || '').toLowerCase().indexOf(q) >= 0; });
      if (!listEl) return;
      if (!rows.length) {
        listEl.innerHTML = '<div class="ph-tr-empty">Никого не найдено</div>';
        return;
      }
      listEl.innerHTML = rows.map(function (s) {
        var ini = initialsFrom(s.name, s.phone);
        var on = !!s.on_line;
        return '<button type="button" class="ph-tr-row" data-id="' + s.id + '" data-phone="' + esc(s.phone || '') + '">' +
          '<span class="ph-tr-ava" aria-hidden="true">' + esc(ini) +
            '<span class="ph-tr-dot ' + (on ? 'ph-tr-dot--on' : 'ph-tr-dot--off') + '" title="' + (on ? 'на линии' : 'не в сети') + '"></span>' +
          '</span>' +
          '<span class="ph-tr-name">' + esc(s.name) + '</span>' +
        '</button>';
      }).join('');
      listEl.querySelectorAll('.ph-tr-row').forEach(function (row) {
        row.addEventListener('click', function () {
          var mode = transferMode || 'blind';
          var tid = row.getAttribute('data-id') || row.getAttribute('data-phone');
          panelData.transferStatus = { status: 'trying', target: tid };
          AsgardPhone.transfer(mode, tid).then(function () {
            playTone('ok');
            toast('Перевод', 'Перевод…', 'ok');
            AsgardUI.closeModal && AsgardUI.closeModal();
            if (panelShown()) paintPanel();
          }).catch(function (e) {
            panelData.transferStatus = { status: 'failed', target: tid };
            toast('Перевод', e.message, 'err');
            if (panelShown()) paintPanel();
          });
        });
      });
    }

    var search = body.querySelector('#phTrSearch');
    if (search) search.addEventListener('input', function () { paintStaff(search.value); });
  }

  function syncUi(st) {
    ensureShell();
    if (st === 'offline') {
      setBtnState('offline');
      hideIncoming();
      hideIncall();
      showTakeover(false);
    } else if (st === 'on_line_browser' || st === 'on_line_mobile') {
      setBtnState('online');
      hideIncoming();
      hideIncall();
    } else if (st === 'ringing') {
      setBtnState('ring');
    } else if (st === 'in_call' || st === 'held') {
      setBtnState('incall');
    }
    syncHeaderBtn();
    if (panelShown()) paintPanel();
  }

  function onPhoneEvent(ev) {
    var d = ev.detail || {};
    var type = d.type;
    var P = window.AsgardPhone;
    if (!P) return;
    if (type === 'takeover') showTakeover(true);
    if (type === 'leader') showTakeover(false);
    if (type === 'state' || type === 'ready') syncUi(P.getState());
    if (type === 'incoming') renderIncoming(d);
    if (type === 'lookup' && uiMode === 'incoming' && panelShown()) paintPanel();
    if (type === 'mute' && uiMode === 'incall' && panelShown()) paintPanel();
    if (type === 'connected' || (type === 'state' && P.getState() === 'in_call')) renderIncall(d);
    if (type === 'ended' || type === 'failed' || type === 'hangup') {
      hideIncoming();
      hideIncall();
      restoreAfterCall();
      panelData.loadedAt = 0;
      syncUi(P.getState());
      if (!panelShown()) refreshBadge();
      if (AsgardPhone.consumePendingReload && AsgardPhone.consumePendingReload()) {
        setTimeout(function () { location.reload(); }, 450);
      }
    }
    if (type === 'transfer' || type === 'transfer_status') {
      panelData.transferStatus = {
        status: (d.status || (d.detail && d.detail.status) || 'trying'),
        target: d.target,
      };
      toast('Перевод', ({
        trying: 'Перевод…',
        answered: 'Абонент ответил',
        noanswer: 'Не ответил — возврат',
        returned: 'Звонок вернулся',
        failed: 'Перевод не удался',
      })[panelData.transferStatus.status] || panelData.transferStatus.status, 'info');
      if (panelShown()) paintPanel();
    }
    if (type === 'audio_blocked') dom.audioBanner.style.display = 'flex';
  }

  function bindTelLinks() {
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href^="tel:"]');
      if (!a) return;
      if (!window.AsgardPhone || AsgardPhone.getState() === 'offline') return;
      e.preventDefault();
      var num = a.getAttribute('href').replace(/^tel:/i, '');
      AsgardPhone.outbound(num).catch(function (err) { toast('Телефон', err.message, 'err'); });
    }, true);
  }

  function tryInitAfterLayout() {
    var hadBtn = !!dom.btn;
    ensureShell();
    if (!window.AsgardPhone) return;
    // Без шапочной кнопки (нет #asgardPhoneSlot) — не звать syncUi:
    // ensureShell всё равно создаёт .ph-card/.ph-bar → MutationObserver → цикл
    // syncUi → paintPanel → mutation → … (страница зависает).
    if (!dom.btn) {
      syncRail();
      syncHeaderBtn();
      return;
    }
    // Не гонять полный syncUi на каждый MutationObserver-тик:
    // иначе paint incoming → DOM mutation → syncUi(offline) → hideIncoming.
    // Также не затирать видимый incall/ring кнопкой «ringing» из ядра.
    if (!hadBtn) {
      syncUi(AsgardPhone.getState());
      return;
    }
    syncHeaderBtn();
    if (uiMode === 'incall') setBtnState('incall');
    else if (uiMode === 'incoming') setBtnState('ring');
    else setBtnState(mapPhoneBtnState(AsgardPhone.getState()));
  }

  function mapPhoneBtnState(st) {
    if (st === 'on_line_browser' || st === 'on_line_mobile') return 'online';
    if (st === 'ringing') return 'ring';
    if (st === 'in_call' || st === 'held') return 'incall';
    return 'offline';
  }

  function isTypingTarget(el) {
    if (!el) return false;
    var tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
  }

  function ensureHotkeyHint() {
    var hint = document.getElementById('phHotkeyHint');
    if (hint) return hint;
    hint = document.createElement('div');
    hint.id = 'phHotkeyHint';
    hint.className = 'ph-hotkey-hint';
    hint.innerHTML =
      '<div><kbd>Space</kbd> ответить</div>' +
      '<div><kbd>Esc</kbd> сброс</div>' +
      '<div><kbd>M</kbd> микрофон</div>' +
      '<div><kbd>H</kbd> удержание</div>' +
      '<div><kbd>?</kbd> эта подсказка</div>';
    document.body.appendChild(hint);
    return hint;
  }

  var hotkeysBound = false;
  function bindHotkeys() {
    if (hotkeysBound) return;
    hotkeysBound = true;
    document.addEventListener('keydown', function (e) {
      if (isTypingTarget(e.target)) return;
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        ensureHotkeyHint().classList.toggle('is-open');
        return;
      }
      if (!window.AsgardPhone) return;
      var incomingOpen = uiMode === 'incoming';
      var incallOpen = uiMode === 'incall';
      if (e.key === 'Escape') {
        var hint = document.getElementById('phHotkeyHint');
        if (hint && hint.classList.contains('is-open')) { hint.classList.remove('is-open'); return; }
        if (incomingOpen) { e.preventDefault(); AsgardPhone.hangup(); return; }
        if (incallOpen) { e.preventDefault(); playTone('end'); AsgardPhone.hangup(); return; }
      }
      if (e.code === 'Space' && incomingOpen) {
        e.preventDefault();
        AsgardPhone.answer().catch(function (err) { toast('Телефон', err.message, 'err'); });
        return;
      }
      if (!incallOpen) return;
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        var next = !(AsgardPhone.isMuted && AsgardPhone.isMuted());
        AsgardPhone.setMuted(next).catch(function (err) { toast('Телефон', err.message, 'err'); });
      } else if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        var held = AsgardPhone.getState() === 'held';
        AsgardPhone.hold(!held).catch(function (err) { toast('Телефон', err.message, 'err'); });
      }
    });
  }

  var phoneUiReady = false;
  function ensurePhoneUiBound() {
    if (TEL_ROLES.indexOf(userRole()) === -1) return false;
    if (!phoneUiReady) {
      phoneUiReady = true;
      document.addEventListener('asgard-phone', onPhoneEvent);
      bindTelLinks();
      document.addEventListener('asgard-phone', function (ev) {
        if (ev.detail && ev.detail.type === 'audio_blocked') sessionStorage.setItem('asgard_phone_audio_blocked', '1');
      });
      document.addEventListener('huginn-dock', onDockLayout);
      var resizeT = null;
      window.addEventListener('resize', function () {
        clearTimeout(resizeT);
        resizeT = setTimeout(onDockLayout, 200);
      });
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) refreshBadge();
      });
      refreshBadge();
      badgeTimer = setInterval(refreshBadge, 120000);
    }
    bindHotkeys();
    tryInitAfterLayout();
    if (sessionStorage.getItem('asgard_phone_audio_blocked')) {
      dom.audioBanner && (dom.audioBanner.style.display = 'flex');
    }
    return true;
  }

  function init() {
    ensurePhoneUiBound();
    var obs = new MutationObserver(function () {
      if (document.getElementById('asgardPhoneSlot') || document.querySelector('.topbar .badges') || window.AsgardAuth) {
        ensurePhoneUiBound();
      }
    });
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });
  }

  window.AsgardPhoneUI = {
    init: init,
    fmtPhone: fmtPhone,
    openDialPad: openDialPad,
    openHotkeyHelp: function () { ensureHotkeyHint().classList.add('is-open'); },
    renderPanel: renderPanel,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
