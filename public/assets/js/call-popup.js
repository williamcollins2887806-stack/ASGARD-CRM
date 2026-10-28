/**
 * ASGARD CRM — окно входящего звонка поверх всех приложений (Windows PWA).
 *
 * ЗАДАЧА (28.10.2026): оператор работает через установленное PWA на Windows и
 * часто находится в другом окне/приложении. Обычный тост внутри страницы он не
 * видит — вкладка не активна. Нужно окно, которое видно ВСЕГДА.
 *
 * ПОЧЕМУ Document Picture-in-Picture:
 *   • это единственное веб-окно, которое ОС держит поверх остальных, — как
 *     всегда-сверху. Web Push-уведомление тоже всплывает, но его можно пропустить
 *     (Windows «тихие часы», режим «Не беспокоить»), а PiP-окно живёт постоянно
 *     и закрывается только когда звонок завершён;
 *   • работает в установленном PWA Chromium/Edge на Windows и macOS;
 *   • не требует разрешений — вызывается по действию пользователя (кнопка
 *     «Включить окно поверх всех»), после чего окно можно ОТКРЫВАТЬ повторно
 *     автоматически: разрешение документа сохраняется на сессию вкладки.
 *
 * ПОВЕДЕНИЕ:
 *   1) Пока оператор на линии — держим окно ВСЕГДА открытым (свёрнуто в
 *      маленькую плашку «На линии», чтобы не мешать). Так разрешение не теряется
 *      и при входящем окно просто разворачивается в полноценный баннер.
 *   2) Входящий/разговор — окно увеличивается, показывает номер, имя и кнопки
 *      «Ответить» / «Отклонить».
 *   3) Открыть окно может только пользователь — поэтому при первом включении
 *      линия вызывает запрос один раз; дальше всё автоматически.
 *
 * ФОЛБЭК: если Document PiP недоступен (Firefox, старый Chromium), остаётся
 * обычное Push-уведомление + тост внутри страницы.
 */
window.AsgardCallPopup = (function () {
  'use strict';

  var win = null;
  var launched = false;      // пользователь уже разрешил окно в этой сессии
  var wantOpen = false;      // окно должно быть открыто (мы на линии / идёт звонок)
  var current = null;        // { number, name, state: 'ringing'|'incall' }
  var hb = null;             // удержание окна (переоткрытие после закрытия ОС)

  function isSupported() {
    return !!window.documentPictureInPicture;
  }

  /** Was the user gesture granted already (окно открывалось в этой сессии)? */
  function isArmed() { return launched && isSupported(); }

  function ensureWindow() {
    if (!isSupported()) return null;
    if (win && !win.closed) return win;
    try {
      win = window.documentPictureInPicture.window;
    } catch (_) { win = null; }
    if (win && !win.closed) return win;
    return null;
  }

  /** Открыть окно. ВЫЗЫВАТЬ ТОЛЬКО ИЗ ОБРАБОТЧИКА КЛИКА. */
  function open() {
    if (!isSupported()) return Promise.resolve({ ok: false, reason: 'unsupported' });
    if (ensureWindow()) { launched = true; render(); return Promise.resolve({ ok: true, already: true }); }
    return window.documentPictureInPicture.requestWindow({ width: 360, height: 132 })
      .then(function (w) {
        win = w;
        launched = true;
        wantOpen = true;
        try {
          var st = w.document.createElement('style');
          st.textContent = CSS;
          w.document.head.appendChild(st);
        } catch (_) {}
        try {
          w.addEventListener('pagehide', function () {
            win = null;
            if (wantOpen) setTimeout(function () { safeReopen(); }, 400);
          });
        } catch (_) {}
        render();
        return { ok: true };
      })
      .catch(function (e) {
        launched = false;
        return { ok: false, reason: e && e.message ? e.message : 'failed' };
      });
  }

  /** Открываем повторно без жеста: допустимо, если разрешение уже выдано. */
  function safeReopen() {
    if (!launched || !wantOpen || !isSupported()) return;
    if (ensureWindow()) return;
    try {
      var p = window.documentPictureInPicture.requestWindow({ width: 360, height: 132 });
      if (p && p.then) {
        p.then(function (w) {
          win = w;
          try {
            var st = w.document.createElement('style');
            st.textContent = CSS;
            w.document.head.appendChild(st);
          } catch (_) {}
          render();
        }).catch(function () { /* жест больше не действует — ждём следующего клика */ });
      }
    } catch (_) { /* ignore */ }
  }

  function close() {
    wantOpen = false;
    if (win && !win.closed) { try { win.close(); } catch (_) {} }
    win = null;
  }

  /**
   * Показываем звонок. state: 'ringing' | 'incall'.
   * Если окно ещё не разрешено — вернёт reason 'needs_gesture': UI должен
   * показать кнопку «Включить окно поверх всех».
   */
  function showCall(info) {
    current = info || {};
    wantOpen = true;
    if (!ensureWindow()) {
      if (launched) safeReopen();
      return launched ? { ok: true, deferred: true } : { ok: false, reason: 'needs_gesture' };
    }
    render();
    try { if (win) win.focus(); } catch (_) {}
    return { ok: true };
  }

  /** Звонок завершён — возвращаем компактную плашку «На линии». */
  function clearCall() {
    current = null;
    render();
  }

  /** Мы на линии: держим окно живым (свёрнутая плашка). */
  function setOnLine(on) {
    if (on) {
      wantOpen = true;
      if (launched && !ensureWindow()) safeReopen();
      startHb();
    } else if (!current) {
      stopHb();
      close();
    }
    render();
  }

  function startHb() {
    if (hb) return;
    // ОС может закрыть PiP при сворачивании/переключении окна. Раз в 5 с
    // проверяем и поднимаем снова — но только если разрешение уже дано.
    hb = setInterval(function () {
      if (!launched || !wantOpen) return;
      if (!ensureWindow()) safeReopen();
    }, 5000);
  }

  function stopHb() {
    if (hb) { clearInterval(hb); hb = null; }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtPhone(n) {
    var d = String(n || '').replace(/[^\d]/g, '');
    if (!d) return '';
    if (d.length === 11 && (d[0] === '7' || d[0] === '8')) {
      return '+7 (' + d.slice(1, 4) + ') ' + d.slice(4, 7) + '-' + d.slice(7, 9) + '-' + d.slice(9);
    }
    return n;
  }

  function render() {
    var w = ensureWindow();
    if (!w) return;
    var doc = w.document;
    var call = current;
    var ringing = call && call.state === 'ringing';
    var inCall = call && call.state === 'incall';

    var cls = ringing ? 'ringing' : (inCall ? 'incall' : 'idle');
    var title = ringing ? 'Входящий звонок' : (inCall ? 'Разговор' : 'На линии');
    var num = call ? fmtPhone(call.number) : '';
    var name = call && call.name ? String(call.name) : '';

    var html = ''
      + '<div class="wrap ' + cls + '">'
      +   '<div class="dot"></div>'
      +   '<div class="info">'
      +     '<div class="title">' + esc(title) + '</div>'
      +     (num ? '<div class="num">' + esc(num) + '</div>' : '<div class="num muted">Ожидание звонка</div>')
      +     (name ? '<div class="name">' + esc(name) + '</div>' : '')
      +   '</div>'
      +   '<div class="actions">'
      +     (ringing
            ? '<button class="btn ok" id="cpAnswer">Ответить</button>'
            + '<button class="btn no" id="cpDecline">Отклонить</button>'
            : (inCall ? '<button class="btn no" id="cpHangup">Завершить</button>' : ''))
      +   '</div>'
      + '</div>';

    if (!doc.body) return;
    if (doc.body.getAttribute('data-cp') !== cls + '|' + num) {
      doc.body.innerHTML = html;
      doc.body.setAttribute('data-cp', cls + '|' + num);
      var a = doc.getElementById('cpAnswer');
      var d = doc.getElementById('cpDecline');
      var h = doc.getElementById('cpHangup');
      if (a) a.onclick = function () { if (window.AsgardPhone) window.AsgardPhone.answer(); };
      if (d) d.onclick = function () {
        if (window.AsgardPhone && window.AsgardPhone.hangup) window.AsgardPhone.hangup();
      };
      if (h) h.onclick = function () {
        if (window.AsgardPhone && window.AsgardPhone.hangup) window.AsgardPhone.hangup();
      };
    }
  }

  var CSS = ''
    + '*{box-sizing:border-box}'
    + 'html,body{margin:0;height:100%;background:#0d1420;color:#e6edf7;'
    + 'font:14px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow:hidden}'
    + '.wrap{display:flex;align-items:center;gap:12px;height:100%;padding:14px 16px;'
    + 'border-left:5px solid #2f6fd0}'
    + '.wrap.ringing{border-left-color:#e8a33d;background:#1a1408}'
    + '.wrap.incall{border-left-color:#3fb26b;background:#0b1a11}'
    + '.dot{width:12px;height:12px;border-radius:50%;background:#2f6fd0;flex:0 0 auto}'
    + '.wrap.ringing .dot{background:#e8a33d;animation:p 1s infinite}'
    + '.wrap.incall .dot{background:#3fb26b;animation:p 1.6s infinite}'
    + '@keyframes p{0%,100%{opacity:1}50%{opacity:.25}}'
    + '.info{min-width:0;flex:1 1 auto}'
    + '.title{font-size:12px;text-transform:uppercase;letter-spacing:.8px;opacity:.65}'
    + '.num{font-size:20px;font-weight:800;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.num.muted{font-size:14px;font-weight:600;opacity:.65}'
    + '.name{font-size:12.5px;opacity:.8;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.actions{display:flex;gap:8px;flex:0 0 auto}'
    + '.btn{border:0;border-radius:10px;padding:10px 14px;font:inherit;font-weight:700;cursor:pointer}'
    + '.btn.ok{background:#3fb26b;color:#04210f}'
    + '.btn.no{background:#c8443c;color:#fff}'
    + '.btn:active{transform:scale(.97)}';

  return {
    isSupported: isSupported,
    isArmed: isArmed,
    open: open,
    close: close,
    showCall: showCall,
    clearCall: clearCall,
    setOnLine: setOnLine,
    /** Удобно для проверки из консоли. */
    _debug: function () { return { launched: launched, wantOpen: wantOpen, hasWin: !!ensureWindow(), current: current }; }
  };
})();
