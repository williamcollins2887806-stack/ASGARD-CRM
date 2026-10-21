/* ═══════════════════════════════════════════════════════════════════════════
   ЕЖЕДНЕВНЫЙ ГЕЙТ ПРИСУТСТВИЯ — «где ты сегодня» + сверка с табелем
   ───────────────────────────────────────────────────────────────────────────
   Основа — СТАРЫЙ дневной гейт CRM (коммиты a4af75c9 / 9c6af639 / 5c85c0df):
   сетка статусов 2 колонки, выбранная плитка с золотой обводкой, кнопка синяя.
   Доработано: токены темы вместо хардкода, обе темы, SVG-иконки вместо эмодзи,
   строка «в табеле стоит …» и подтверждение одним нажатием.

   Контракт API: GET /api/daily-presence/today → { required, current, statuses, works }
                 POST /api/daily-presence        → { status_code, work_id }
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var IC = {
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2.5"/><path d="M3 9h18M8 2.5v3M16 2.5v3"/><path d="M8.5 14.5h2M13.5 14.5h2"/></svg>',
    office: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V6.5L12 3l8 3.5V21"/><path d="M4 21h16"/><path d="M9 21v-4h6v4"/><path d="M9 9.5h.01M15 9.5h.01"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 10.4 12 3.4l8.5 7"/><path d="M5.5 9.4V20h13V9.4"/></svg>',
    site: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h18"/><path d="M6 20V9.5l6-3.5 6 3.5V20"/><path d="M9.5 20v-4.5h5V20"/></svg>',
    trip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 16.5V7.2a1.2 1.2 0 0 1 1.2-1.2h6.6a1.2 1.2 0 0 1 1.2 1.2v9.3"/><path d="M14 10.5h3.3a1.2 1.2 0 0 1 1.2 1.2v4.8"/><circle cx="8" cy="17.6" r="1.9"/><circle cx="16.6" cy="17.6" r="1.9"/></svg>',
    meeting: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.1"/><path d="M3.6 19.5a5.6 5.6 0 0 1 10.8 0"/><circle cx="17.2" cy="9.4" r="2.4"/><path d="M15.8 14.2a4.6 4.6 0 0 1 4.6 3.4"/></svg>',
    study: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.4 12 4l9 3.4-9 3.4z"/><path d="M6.5 9.3v4.6c0 1.5 2.5 2.8 5.5 2.8s5.5-1.3 5.5-2.8V9.3"/></svg>',
    warehouse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20V8.6L12 4l9 4.6V20"/><path d="M7.4 20v-6.2h9.2V20"/><path d="M7.4 16.4h9.2"/></svg>',
    sick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v16M4 12h16"/><rect x="3.4" y="3.4" width="17.2" height="17.2" rx="4"/></svg>',
    unpaid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.8" y="6" width="18.4" height="12.4" rx="2.4"/><circle cx="12" cy="12.2" r="2.6"/></svg>',
    dayoff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.4A8.6 8.6 0 0 1 9.6 3.5a8.6 8.6 0 1 0 10.9 10.9Z"/></svg>',
    vac: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21c4.4 0 7.2-2.6 7.2-6.4 0-4.3-4-7.6-7.2-11.6-3.2 4-7.2 7.3-7.2 11.6C4.8 18.4 7.6 21 12 21Z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m4.5 12.5 5 5 10-11"/></svg>',
  };

  var ICON_BY_CODE = {
    'оф': IC.office, 'уд': IC.home, 'об': IC.site, 'км': IC.trip,
    'пг': IC.meeting, 'уч': IC.study, 'ск': IC.warehouse, 'бн': IC.sick,
    'сс': IC.unpaid, 'вх': IC.dayoff,
  };

  var WD_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  var MONTH_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtToday(iso) {
    var p = String(iso).split('-').map(Number);
    return WD_FULL[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()] + ', ' + p[2] + ' ' + MONTH_GEN[p[1] - 1];
  }

  function labelOf(statuses, code) {
    for (var i = 0; i < statuses.length; i++) if (statuses[i].code === code) return statuses[i].label;
    return code === 'отп' ? 'Отпуск' : '—';
  }

  /**
   * Показывает дневной гейт, если на сегодня ещё нет отметки.
   * @returns Promise<boolean> true — был показан и сохранил
   */
  function mount(cfg) {
    cfg = cfg || {};
    var auth = cfg.auth;
    if (!auth || !auth.token) return Promise.resolve(false);

    return new Promise(function (resolve) {
      var token = auth.token;

      fetch('/api/daily-presence/today', { headers: { 'Authorization': 'Bearer ' + token } })
        .then(function (r) { return r.json(); })
        .then(function (info) {
          if (!info || !info.required) { resolve(false); return; }

          var serverDate = info.server_date || new Date().toISOString().slice(0, 10);
          // Флаг по ДАТЕ сервера: спрашиваем каждый день, но один раз в день.
          var dayKey = 'presence_done_' + serverDate;
          if (localStorage.getItem(dayKey) === '1') { resolve(false); return; }

          build(info, serverDate, dayKey);
        })
        .catch(function () { resolve(false); });   // сеть упала — не блокируем

      function build(info, serverDate, dayKey) {
        var statuses = (info.statuses && info.statuses.length) ? info.statuses : [
          { code: 'оф', label: 'В офисе' }, { code: 'уд', label: 'Удалёнка' },
          { code: 'об', label: 'На объекте' }, { code: 'км', label: 'Командировка' },
          { code: 'пг', label: 'Встреча/переговоры' }, { code: 'уч', label: 'Учёба' },
          { code: 'ск', label: 'Склад' }, { code: 'бн', label: 'Больничный' },
          { code: 'сс', label: 'За свой счёт' }, { code: 'вх', label: 'Выходной' },
        ];
        var works = info.works || [];
        var current = info.current || null;
        var userName = (auth.user && auth.user.name) ? auth.user.name : '';
        var firstName = userName ? userName.trim().split(/\s+/).slice(-1)[0] : '';

        // Уже отмечено сегодня? Тогда предвыбираем этот статус.
        var chosen = current && current.status_code ? current.status_code : null;
        var workId = current && current.work_id ? String(current.work_id) : '';
        var isVacation = chosen === 'отп';

        var scene = document.createElement('div');
        scene.className = 'pd-scene';
        scene.id = 'asgard-presence-day';

        var tiles = statuses.map(function (s) {
          var sel = chosen === s.code;
          return '<button type="button" class="pd-opt' + (sel ? ' sel' : '') + '" data-code="' + esc(s.code) + '">' +
            '<span class="pd-oi">' + (ICON_BY_CODE[s.code] || IC.calendar) + '</span>' +
            '<span class="pd-ot">' + esc(s.label) + '</span></button>';
        }).join('');

        var curLine = '';
        if (chosen && !isVacation) {
          curLine =
            '<div class="pd-cur">' +
              '<span class="pd-ci">' + (ICON_BY_CODE[chosen] || IC.calendar) + '</span>' +
              '<span class="pd-cx"><b>' + esc(labelOf(statuses, chosen)) + '</b>' +
              '<span>по недельному графику</span></span>' +
            '</div>';
        } else if (isVacation) {
          curLine =
            '<div class="pd-cur"><span class="pd-ci">' + IC.vac + '</span>' +
            '<span class="pd-cx"><b>Отпуск</b><span>согласован в графике</span></span></div>';
        }

        var q = chosen && !isVacation
          ? 'В табеле на сегодня стоит <b>«' + esc(labelOf(statuses, chosen)) + '»</b>. Подтверждаешь или меняем?'
          : 'Отметься в дружину — где ты сегодня держишь строй?';

        scene.innerHTML =
          '<div class="pd-gate" role="dialog" aria-modal="true" aria-labelledby="pdTitle">' +
            '<div class="pd-head">' +
              '<div class="pd-top">' +
                '<span class="pd-gi">' + IC.calendar + '</span>' +
                '<span class="pd-title" id="pdTitle">' + (firstName ? 'Привет, ' + esc(firstName) + '!' : 'Отметка на сегодня') + '</span>' +
              '</div>' +
              '<div class="pd-sub">' + esc(fmtToday(serverDate)) + '</div>' +
              '<div class="pd-q">' + q + '</div>' +
            '</div>' +

            '<div class="pd-body">' +
              curLine +
              '<div class="pd-opts">' + tiles + '</div>' +
              '<div class="pd-work" id="pdWork">' +
                '<label for="pdWorkSel">Работа для «На объекте»</label>' +
                '<select id="pdWorkSel">' +
                  '<option value="">— выбери работу —</option>' +
                  works.map(function (w) {
                    return '<option value="' + esc(String(w.id)) + '"' + (workId === String(w.id) ? ' selected' : '') + '>' +
                      esc(w.title) + (w.place ? ' · ' + esc(w.place) : '') + '</option>';
                  }).join('') +
                '</select>' +
              '</div>' +
            '</div>' +

            '<div class="pd-err" id="pdErr"></div>' +

            '<div class="pd-foot">' +
              '<button type="button" class="pd-btn" id="pdSave">' + IC.check +
                '<span>' + (chosen && !isVacation ? 'Подтвердить «' + esc(labelOf(statuses, chosen)) + '»' : 'В строй') + '</span>' +
              '</button>' +
            '</div>' +
          '</div>';

        document.body.appendChild(scene);

        var optsBox = scene.querySelector('.pd-opts');
        var workWrap = scene.querySelector('#pdWork');
        var workSel = scene.querySelector('#pdWorkSel');
        var errEl = scene.querySelector('#pdErr');
        var saveBtn = scene.querySelector('#pdSave');

        function syncWork() {
          workWrap.classList.toggle('on', chosen === 'об');
        }
        syncWork();

        function setChosen(code) {
          chosen = code;
          Array.prototype.forEach.call(optsBox.children, function (b) {
            b.classList.toggle('sel', b.getAttribute('data-code') === code);
          });
          syncWork();
          errEl.textContent = '';
          var lbl = (code && code !== 'отп') ? 'Подтвердить «' + labelOf(statuses, code) + '»' : 'В строй';
          saveBtn.innerHTML = IC.check + '<span>' + esc(lbl) + '</span>';
        }

        optsBox.addEventListener('click', function (e) {
          var b = e.target.closest ? e.target.closest('.pd-opt') : null;
          if (!b) return;
          setChosen(b.getAttribute('data-code'));
        });

        // Клик вне не закрывает — гейт блокирующий (как в старом окне).
        scene.addEventListener('click', function (e) { if (e.target === scene) e.stopPropagation(); });

        saveBtn.addEventListener('click', function () {
          if (!chosen) { errEl.textContent = 'Выбери, где ты сегодня'; return; }
          var wid = null;
          if (chosen === 'об') {
            wid = parseInt(workSel && workSel.value, 10) || null;
            if (!wid) { errEl.textContent = 'Выбери работу'; return; }
          }

          saveBtn.disabled = true;
          saveBtn.innerHTML = '<span>Сохранение…</span>';

          fetch('/api/daily-presence', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ status_code: chosen, work_id: wid }),
          })
            .then(function (r) {
              return r.json().catch(function () { return {}; }).then(function (j) {
                if (!r.ok) throw new Error(j.message || 'Не удалось сохранить');
                return j;
              });
            })
            .then(function () {
              localStorage.setItem(dayKey, '1');
              scene.remove();
              if (typeof cfg.onDone === 'function') cfg.onDone();
              resolve(true);
            })
            .catch(function (e) {
              errEl.textContent = e.message || 'Не удалось сохранить. Повтори.';
              saveBtn.disabled = false;
              var lbl = chosen ? 'Подтвердить «' + labelOf(statuses, chosen) + '»' : 'В строй';
              saveBtn.innerHTML = IC.check + '<span>' + esc(lbl) + '</span>';
            });
        });
      }
    });
  }

  window.AsgardPresenceDay = { mount: mount };
})();
