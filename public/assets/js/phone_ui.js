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
  var ICON = {
    mic: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
    micOff: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
    hold: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>',
    keypad: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="5" cy="5" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="5" r="1.5" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none"/></svg>',
    transfer: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
    hangup: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11z"/></svg>',
  };

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
    if (!dom.btn) return;
    dom.btn.className = 'ph-btn ph-btn--' + (st || 'offline');
    var dot = dom.btn.querySelector('.ph-btn-dot');
    if (dot) dot.className = 'ph-btn-dot ph-dot--' + (st || 'offline');
  }

  function renderOfflineMenu() {
    dom.menu.innerHTML =
      '<div class="ph-menu-head">Телефон PBX</div>' +
      '<button type="button" class="ph-menu-item" data-action="online-browser">На линии (браузер)</button>' +
      '<button type="button" class="ph-menu-item" data-action="online-mobile">На линии (мобильный)</button>' +
      '<button type="button" class="ph-menu-item" data-action="mic">Проверить микрофон</button>';
    bindMenuActions();
  }

  function renderOnlineMenu() {
    dom.menu.innerHTML =
      '<div class="ph-menu-head">На линии</div>' +
      '<button type="button" class="ph-menu-item" data-action="dial">Набрать номер</button>' +
      '<button type="button" class="ph-menu-item ph-menu-item--danger" data-action="offline">Сойти с линии</button>';
    bindMenuActions();
  }

  function bindMenuActions() {
    dom.menu.querySelectorAll('[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var act = btn.getAttribute('data-action');
        dom.menu.style.display = 'none';
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
      });
    });
  }

  function toggleMenu() {
    ensureShell();
    var P = window.AsgardPhone;
    if (!P) return;
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

  function startCallTimer() {
    stopCallTimer();
    timerStart = Date.now();
    timerId = setInterval(function () {
      var el = document.getElementById('phIncallTimer');
      if (el) el.textContent = fmtTimer(Date.now() - timerStart);
    }, 1000);
  }

  function stopCallTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  function renderIncoming(detail) {
    ensureShell();
    setBtnState('ring');
    var num = detail.number || '';
    var lookup = (detail.callMeta && detail.callMeta.lookup) || detail.lookup || {};
    var title = lookup.name || lookup.client_name || fmtPhone(num);
    var sub = fmtPhone(num);
    if (lookup.company) sub += ' · ' + lookup.company;
    dom.incoming.innerHTML =
      '<div class="ph-card-inner">' +
        '<div class="ph-card-title">Входящий звонок</div>' +
        '<div class="ph-card-name">' + esc(title) + '</div>' +
        '<div class="ph-card-sub">' + esc(sub) + '</div>' +
        '<div class="ph-card-actions">' +
          '<button type="button" class="ph-act ph-act--answer" id="phAnswer">Ответить</button>' +
          '<button type="button" class="ph-act ph-act--hangup" id="phDecline">Сбросить</button>' +
        '</div>' +
      '</div>';
    dom.incoming.style.display = 'block';
    dom.incoming.querySelector('#phAnswer').onclick = function () {
      AsgardPhone.answer().catch(function (e) { toast('Телефон', e.message, 'err'); });
    };
    dom.incoming.querySelector('#phDecline').onclick = function () {
      AsgardPhone.hangup();
    };
  }

  function hideIncoming() {
    if (dom.incoming) dom.incoming.style.display = 'none';
  }

  function renderIncall(detail) {
    ensureShell();
    hideIncoming();
    setBtnState('incall');
    var meta = (window.AsgardPhone && AsgardPhone.getCallMeta()) || {};
    var num = detail.number || meta.number || '';
    var note = localStorage.getItem(noteKey + ':' + num) || '';
    var isMuted = window.AsgardPhone && AsgardPhone.isMuted && AsgardPhone.isMuted();
    var isHeld = window.AsgardPhone && AsgardPhone.getState() === 'held';
    dom.incall.innerHTML =
      '<div class="ph-bar-left">' +
        '<span class="ph-bar-timer" id="phIncallTimer">00:00</span>' +
        '<span class="ph-bar-num">' + esc(fmtPhone(num)) + '</span>' +
      '</div>' +
      '<div class="ph-bar-actions">' +
        '<button type="button" class="ph-iconbtn' + (isMuted ? ' ph-iconbtn--active' : '') + '" id="phMute" title="Микрофон" aria-label="Микрофон">' + (isMuted ? ICON.micOff : ICON.mic) + '</button>' +
        '<button type="button" class="ph-iconbtn' + (isHeld ? ' ph-iconbtn--active' : '') + '" id="phHold" title="Удержание" aria-label="Удержание">' + ICON.hold + '</button>' +
        '<button type="button" class="ph-iconbtn" id="phKeypad" title="Клавиши" aria-label="Клавиши">' + ICON.keypad + '</button>' +
        '<button type="button" class="ph-iconbtn" id="phTransfer" title="Перевод" aria-label="Перевод">' + ICON.transfer + '</button>' +
        '<button type="button" class="ph-iconbtn ph-iconbtn--danger" id="phHangup" title="Завершить" aria-label="Завершить">' + ICON.hangup + '</button>' +
      '</div>' +
      '<textarea class="ph-note" id="phNote" placeholder="Заметка по звонку…" rows="1">' + esc(note) + '</textarea>';
    dom.incall.style.display = 'flex';
    startCallTimer();

    dom.incall.querySelector('#phHangup').onclick = function () { AsgardPhone.hangup(); };
    dom.incall.querySelector('#phHold').onclick = function () {
      var held = AsgardPhone.getState() === 'held';
      var holdBtn = dom.incall.querySelector('#phHold');
      AsgardPhone.hold(!held).then(function () {
        if (holdBtn) holdBtn.classList.toggle('ph-iconbtn--active', !held);
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
        }
      }).catch(function (e) { toast('Телефон', e.message, 'err'); });
    };
    var noteEl = dom.incall.querySelector('#phNote');
    noteEl.addEventListener('input', function () {
      clearTimeout(noteTimer);
      noteTimer = setTimeout(function () {
        localStorage.setItem(noteKey + ':' + num, noteEl.value);
      }, 400);
    });
  }

  function hideIncall() {
    stopCallTimer();
    if (dom.incall) dom.incall.style.display = 'none';
  }

  function openDialPad(prefill) {
    if (!window.AsgardUI || !AsgardUI.showModal) return;
    var html =
      '<label class="ph-dial-label">Номер<input type="tel" class="inp" id="phDialNum" value="' + esc(prefill || '') + '" placeholder="+7…"></label>' +
      '<div class="ph-dial-grid" id="phDialGrid"></div>' +
      '<button type="button" class="btn primary ph-dial-call" id="phDialCall">Позвонить</button>';
    var overlay = AsgardUI.showModal({ title: 'Набор номера', html: html, wide: false });
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
    var html =
      '<input type="search" class="inp" id="phTrSearch" placeholder="Поиск сотрудника…">' +
      '<div class="ph-tr-list" id="phTrList">Загрузка…</div>' +
      '<div class="ph-tr-mode">' +
        '<label><input type="radio" name="phTrMode" value="blind" checked> Слепой</label>' +
        '<label><input type="radio" name="phTrMode" value="consult"> Консультативный</label>' +
      '</div>';
    var overlay = AsgardUI.showModal({ title: 'Перевод звонка', html: html });
    var body = overlay.querySelector('#modalBody') || overlay;
    var listEl = body.querySelector('#phTrList');
    var staff = [];
    Promise.all([
      fetch('/api/telephony/employees', { headers: { Authorization: 'Bearer ' + (localStorage.getItem('asgard_token') || '') } }).then(function (r) { return r.json(); }),
      fetch('/api/telephony/pbx/reports/staff', { headers: { Authorization: 'Bearer ' + (localStorage.getItem('asgard_token') || '') } }).catch(function () { return { staff: [] }; }).then(function (r) { return r.json ? r : { staff: [] }; }),
    ]).then(function (parts) {
      var emps = (parts[0] && parts[0].employees) || [];
      var online = {};
      ((parts[1] && parts[1].staff) || []).forEach(function (s) { online[s.user_id] = s; });
      staff = emps.map(function (e) {
        var st = online[e.id] || {};
        return { id: e.id, name: e.name || e.full_name, phone: e.phone || e.internal_phone, on_line: st.on_line, mode: st.receive_mode };
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
        var badge = s.on_line ? '<span class="ph-tr-online">на линии</span>' : '<span class="ph-tr-offline">не в сети</span>';
        return '<button type="button" class="ph-tr-row" data-id="' + s.id + '" data-phone="' + esc(s.phone || '') + '">' +
          '<span>' + esc(s.name) + '</span>' + badge +
        '</button>';
      }).join('');
      listEl.querySelectorAll('.ph-tr-row').forEach(function (row) {
        row.addEventListener('click', function () {
          var modeEl = body.querySelector('input[name="phTrMode"]:checked');
          var mode = modeEl ? modeEl.value : 'blind';
          var target = row.getAttribute('data-phone') || row.getAttribute('data-id');
          AsgardPhone.transfer(mode, target).then(function () {
            toast('Перевод', 'Запрос отправлен', 'ok');
            AsgardUI.closeModal && AsgardUI.closeModal();
          }).catch(function (e) { toast('Перевод', e.message, 'err'); });
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
    if (type === 'connected' || (type === 'state' && P.getState() === 'in_call')) renderIncall(d);
    if (type === 'ended' || type === 'failed' || type === 'hangup') {
      hideIncoming();
      hideIncall();
      syncUi(P.getState());
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
    // Не гонять полный syncUi на каждый MutationObserver-тик:
    // иначе paint incoming → DOM mutation → syncUi(offline) → hideIncoming.
    // Также не затирать видимый incall/ring кнопкой «ringing» из ядра.
    if (!hadBtn) {
      syncUi(AsgardPhone.getState());
      return;
    }
    if (dom.incall && dom.incall.style.display === 'flex') setBtnState('incall');
    else if (dom.incoming && dom.incoming.style.display === 'block') setBtnState('ring');
    else setBtnState(mapPhoneBtnState(AsgardPhone.getState()));
  }

  function mapPhoneBtnState(st) {
    if (st === 'on_line_browser' || st === 'on_line_mobile') return 'online';
    if (st === 'ringing') return 'ring';
    if (st === 'in_call' || st === 'held') return 'incall';
    return 'offline';
  }

  function init() {
    if (TEL_ROLES.indexOf(userRole()) === -1) return;
    document.addEventListener('asgard-phone', onPhoneEvent);
    bindTelLinks();
    tryInitAfterLayout();
    var obs = new MutationObserver(function () {
      if (document.getElementById('asgardPhoneSlot') || document.querySelector('.topbar .badges')) {
        tryInitAfterLayout();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    if (sessionStorage.getItem('asgard_phone_audio_blocked')) {
      dom.audioBanner && (dom.audioBanner.style.display = 'flex');
    }
    document.addEventListener('asgard-phone', function (ev) {
      if (ev.detail && ev.detail.type === 'audio_blocked') sessionStorage.setItem('asgard_phone_audio_blocked', '1');
    });
  }

  window.AsgardPhoneUI = { init: init, fmtPhone: fmtPhone, openDialPad: openDialPad };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
