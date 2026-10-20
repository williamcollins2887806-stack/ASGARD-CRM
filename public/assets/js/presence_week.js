/* ═══════════════════════════════════════════════════════════════════════════
   НЕДЕЛЬНЫЙ ГЕЙТ ПРИСУТСТВИЯ — премиальный экран (vanilla)
   ───────────────────────────────────────────────────────────────────────────
   Заменяет нативные <select> на кастомные панели с SVG-иконками и тоном.
   Контракт с бэкендом не меняется: GET/POST /api/daily-presence/week.

   window.AsgardPresenceWeek.mount({ auth, onDone }) → Promise
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Иконки (тон 1.6, без эмодзи) ─────────────────────────────────────── */
  var IC = {
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-3.6 8-10V5.6L12 2.4 4 5.6V12c0 6.4 8 10 8 10Z"/><path d="m8.8 12 2.2 2.2 4.4-4.6"/></svg>',
    office: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V6.5L12 3l8 3.5V21"/><path d="M4 21h16"/><path d="M9 21v-4h6v4"/><path d="M9 9.5h.01M15 9.5h.01M9 13.5h.01M15 13.5h.01"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 10.4 12 3.4l8.5 7"/><path d="M5.5 9.4V20h13V9.4"/><path d="M10 20v-5.5h4V20"/></svg>',
    site: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h18"/><path d="M6 20V9.5l6-3.5 6 3.5V20"/><path d="M9.5 20v-4.5h5V20"/><path d="M12 3v3"/></svg>',
    trip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 16.5V7.2a1.2 1.2 0 0 1 1.2-1.2h6.6a1.2 1.2 0 0 1 1.2 1.2v9.3"/><path d="M14 10.5h3.3a1.2 1.2 0 0 1 1.2 1.2v4.8"/><circle cx="8" cy="17.6" r="1.9"/><circle cx="16.6" cy="17.6" r="1.9"/><path d="M3 16.5h2M9.9 16.5h4.8M18.5 16.5H21"/></svg>',
    meeting: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.1"/><path d="M3.6 19.5a5.6 5.6 0 0 1 10.8 0"/><circle cx="17.2" cy="9.4" r="2.4"/><path d="M15.8 14.2a4.6 4.6 0 0 1 4.6 3.4"/></svg>',
    study: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.4 12 4l9 3.4-9 3.4z"/><path d="M6.5 9.3v4.6c0 1.5 2.5 2.8 5.5 2.8s5.5-1.3 5.5-2.8V9.3"/><path d="M20.5 8.4v5.2"/></svg>',
    warehouse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20V8.6L12 4l9 4.6V20"/><path d="M7.4 20v-6.2h9.2V20"/><path d="M7.4 16.4h9.2"/></svg>',
    sick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v16M4 12h16"/><rect x="3.4" y="3.4" width="17.2" height="17.2" rx="4"/></svg>',
    unpaid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.8" y="6" width="18.4" height="12.4" rx="2.4"/><circle cx="12" cy="12.2" r="2.6"/><path d="M6 9.4h.01M18 15h.01"/></svg>',
    dayoff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.4A8.6 8.6 0 0 1 9.6 3.5a8.6 8.6 0 1 0 10.9 10.9Z"/></svg>',
    vac: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21c4.4 0 7.2-2.6 7.2-6.4 0-4.3-4-7.6-7.2-11.6-3.2 4-7.2 7.3-7.2 11.6C4.8 18.4 7.6 21 12 21Z"/><path d="M12 21v-4.4"/></svg>',
    chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9.5 6 6 6-6"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m4.5 12.5 5 5 10-11"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/></svg>',
    hammer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14.4 3.6 20.4 9.6l-2 2-6-6z"/><path d="m14.4 3.6-1.6 1.6M18.4 7.6 16.8 9.2"/><path d="M13.4 8.4 4.2 17.6a1.7 1.7 0 0 0 2.4 2.4l9.2-9.2"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12h14"/><path d="m13 6.5 5.5 5.5-5.5 5.5"/></svg>',
  };

  /* Тон статуса: цвет плашки. Не «радуга» — приглушённая палитра под Nordic. */
  var TONE = {
    'оф': '#5b9cf8',
    'уд': '#4fd1c5',
    'об': '#f0a94a',
    'км': '#a78bfa',
    'пг': '#7dd3fc',
    'уч': '#93c5fd',
    'ск': '#c4a355',
    'бн': '#f87171',
    'сс': '#94a3b8',
    'вх': '#8b95a8',
  };

  /* Код статуса → иконка. Неизвестный — «щит», чтобы не падать. */
  var ICON_BY_CODE = {
    'оф': IC.office, 'уд': IC.home, 'об': IC.site, 'км': IC.trip,
    'пг': IC.meeting, 'уч': IC.study, 'ск': IC.warehouse, 'бн': IC.sick,
    'сс': IC.unpaid, 'вх': IC.dayoff,
  };

  var WD_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  var WD_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  var MONTH_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function parseIso(iso) {
    var p = String(iso).split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  }

  function dayNum(iso) {
    var p = String(iso).split('-');
    return Number(p[2]);
  }

  function wdShort(iso) { return WD_SHORT[parseIso(iso).getUTCDay()]; }
  function wdFull(iso) { return WD_FULL[parseIso(iso).getUTCDay()]; }

  function fmtShort(iso) {
    var p = String(iso).split('-').map(Number);
    return p[2] + ' ' + MONTH_GEN[p[1] - 1];
  }

  /* «6 — 10 октября» / «29 сентября — 3 октября» */
  function fmtRange(fromIso, toIso) {
    if (!fromIso || !toIso) return '';
    var a = String(fromIso).split('-').map(Number);
    var b = String(toIso).split('-').map(Number);
    if (a[1] === b[1]) return a[2] + ' — ' + b[2] + ' ' + MONTH_GEN[b[1] - 1];
    return a[2] + ' ' + MONTH_GEN[a[1] - 1] + ' — ' + b[2] + ' ' + MONTH_GEN[b[1] - 1];
  }

  /* ── Один кастомный селект ────────────────────────────────────────────── */
  function createSelect(opts) {
    var root = document.createElement('div');
    root.className = 'pg-select';

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'pg-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    var pop = null;
    var activeIdx = -1;
    var value = opts.value || '';

    function findOption(code) {
      for (var i = 0; i < opts.options.length; i++) {
        if (opts.options[i].code === code) return opts.options[i];
      }
      return null;
    }

    function renderTrigger() {
      var o = findOption(value);
      var tone = o ? (TONE[o.code] || 'var(--gold)') : '';
      root.classList.toggle('has-value', !!o);
      if (tone) root.style.setProperty('--pg-tone', tone);
      else root.style.removeProperty('--pg-tone');

      var icon = o ? (ICON_BY_CODE[o.code] || IC.shield) : IC.shield;
      var label = o ? esc(o.label) : esc(opts.placeholder || 'Выбери статус');
      var where = (o && o.place) ? '<span class="pg-trig-where"> · ' + esc(o.place) + '</span>' : '';

      // Обновляем ТОЛЬКО дочерние узлы, сам .pg-trigger не пересоздаём — иначе
      // кнопка теряет фокус и на мгновение выпадает из DOM (клик «проваливается»).
      var wrap = trigger.querySelector('.pg-trig-label');
      var icBox = trigger.querySelector('.pg-trig-ic');
      if (!wrap || !icBox) {
        trigger.innerHTML =
          '<span class="pg-trig-ic"></span><span class="pg-trig-label"></span><span class="pg-chev">' + IC.chev + '</span>';
        wrap = trigger.querySelector('.pg-trig-label');
        icBox = trigger.querySelector('.pg-trig-ic');
      }
      icBox.innerHTML = icon;
      wrap.innerHTML = label + where;
      trigger.title = o ? (o.label + (o.place ? ' · ' + o.place : '')) : (opts.placeholder || '');
    }

    function close() {
      if (!pop) return;
      pop.remove();
      pop = null;
      activeIdx = -1;
      root.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
      document.removeEventListener('mousedown', onDocDown, true);
      document.removeEventListener('keydown', onDocKey, true);
    }

    function onDocDown(e) {
      if (!root.contains(e.target)) close();
    }

    function onDocKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); trigger.focus(); }
    }

    function choose(code) {
      value = code;
      renderTrigger();
      close();
      trigger.focus();
      if (typeof opts.onChange === 'function') opts.onChange(code);
    }

    function open() {
      if (pop) { close(); return; }

      pop = document.createElement('div');
      pop.className = 'pg-pop';
      pop.setAttribute('role', 'listbox');

      opts.options.forEach(function (o, i) {
        var isActive = o.code === value;
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'pg-opt' + (isActive ? ' is-active' : '');
        b.setAttribute('role', 'option');
        b.setAttribute('aria-selected', isActive ? 'true' : 'false');
        b.style.setProperty('--pg-tone', TONE[o.code] || '#8899b8');
        b.innerHTML =
          '<span class="pg-opt-ic">' + (ICON_BY_CODE[o.code] || IC.shield) + '</span>' +
          '<span class="pg-opt-label">' + esc(o.label) + (o.place ? ' <span class="pg-trig-where">· ' + esc(o.place) + '</span>' : '') + '</span>' +
          '<span class="pg-opt-check">' + IC.check + '</span>';
        b.addEventListener('click', function () { choose(o.code); });
        pop.appendChild(b);
        if (isActive) activeIdx = i;
      });

      root.appendChild(pop);
      root.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');

      // Если панель не влезает вниз — раскрываем вверх.
      var rect = root.getBoundingClientRect();
      var spaceBelow = window.innerHeight - rect.bottom;
      if (spaceBelow < 250 && rect.top > spaceBelow) pop.classList.add('is-up');

      document.addEventListener('mousedown', onDocDown, true);
      document.addEventListener('keydown', onDocKey, true);

      var first = pop.querySelector('.pg-opt.is-active') || pop.querySelector('.pg-opt');
      if (first) first.focus({ preventScroll: true });
    }

    trigger.addEventListener('click', open);

    trigger.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });

    root.addEventListener('keydown', function (e) {
      if (!pop) return;
      var items = Array.prototype.slice.call(pop.querySelectorAll('.pg-opt'));
      if (!items.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        activeIdx = (activeIdx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[activeIdx].focus({ preventScroll: true });
      }
    });

    renderTrigger();
    root.appendChild(trigger);
    root._setValue = function (v) { value = v; renderTrigger(); };
    root._getValue = function () { return value; };
    return root;
  }

  /* ── Сборка экрана ────────────────────────────────────────────────────── */
  /* Счётчик поколений: каждый mount() получает номер. Если за время загрузки
     данных кто-то смонтировал экран новее — старый не рисуется. Иначе две
     параллельные загрузки (авто-гейт после входа + ручной вызов) создают две
     наложенные сцены, и клики «проваливаются» в нижнюю. */
  var mountGen = 0;

  function mount(cfg) {
    cfg = cfg || {};
    var auth = cfg.auth;
    if (!auth || !auth.token) return Promise.resolve();

    var myGen = ++mountGen;

    // Защита от двойного монтирования: снимаем ВСЕ предыдущие сцены (не только по id),
    // иначе старая накрывает новую и перехватывает клики.
    Array.prototype.forEach.call(document.querySelectorAll('.pg-scene'), function (el) {
      el.remove();
    });

    return new Promise(function (resolve, reject) {
      var week;
      fetch('/api/daily-presence/week', { headers: { 'Authorization': 'Bearer ' + auth.token } })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          week = j || {};
          // Не офисная роль или неделя уже заполнена — гейт не нужен.
          if (!week.required) { resolve(false); return; }
          var weekKey = 'presence_week_done_' + (week.week_start || '');
          if (localStorage.getItem(weekKey) === '1') { resolve(false); return; }
          build(week, weekKey);
        })
        .catch(reject);

      function build(week, weekKey) {
        // Пока грузились данные, мог смонтироваться более новый экран — уступаем ему.
        if (myGen !== mountGen) { resolve(false); return; }
        var statuses = (week.statuses && week.statuses.length) ? week.statuses : [
          { code: 'оф', label: 'В офисе' }, { code: 'уд', label: 'Удалёнка' },
          { code: 'об', label: 'На объекте', needsWork: true }, { code: 'км', label: 'Командировка' },
          { code: 'пг', label: 'Встреча/переговоры' }, { code: 'уч', label: 'Учёба' },
          { code: 'ск', label: 'Склад' }, { code: 'бн', label: 'Больничный' },
          { code: 'сс', label: 'За свой счёт' }, { code: 'вх', label: 'Выходной' },
        ];
        var works = week.works || [];
        var days = week.days || [];
        var serverDate = week.server_date || new Date().toISOString().slice(0, 10);

        var userName = (auth.user && auth.user.name) ? auth.user.name : '';
        var firstName = userName ? userName.trim().split(/\s+/).slice(-1)[0] : '';

        var scene = document.createElement('div');
        scene.className = 'pg-scene';
        scene.id = 'asgard-presence-week';

        var rowsHtml = days.map(function (d) {
          var isToday = d.date === serverDate;
          if (d.on_vacation) {
            return '<div class="pg-row is-vacation' + (isToday ? ' is-today' : '') + '">' +
              '<div class="pg-day"><span class="pg-day-wd">' + esc(wdShort(d.date)) + '</span>' +
              '<span class="pg-day-num">' + dayNum(d.date) + '</span></div>' +
              '<div class="pg-vac"><span class="pg-vac-ic">' + IC.vac + '</span>' +
              '<span class="pg-vac-tx"><span class="pg-vac-t">Отпуск</span>' +
              '<span class="pg-vac-s">уже согласовано в графике</span></span></div></div>';
          }
          return '<div class="pg-row' + (isToday ? ' is-today' : '') + '" data-day-row="' + esc(d.date) + '">' +
            '<div class="pg-day"><span class="pg-day-wd">' + esc(wdShort(d.date)) + '</span>' +
            '<span class="pg-day-num">' + dayNum(d.date) + '</span></div>' +
            '<div data-slot="' + esc(d.date) + '"></div></div>';
        }).join('');

        var rangeLbl = days.length ? fmtRange(days[0].date, days[days.length - 1].date) : '';

        scene.innerHTML =
          '<div class="pg-card" role="dialog" aria-modal="true" aria-labelledby="pgTitle">' +
            '<div class="pg-head">' +
              '<div class="pg-sigil">' + IC.shield + '</div>' +
              '<div class="pg-head-tx">' +
                '<div class="pg-kicker">Дружина · неделя вперёд</div>' +
                '<h1 class="pg-title" id="pgTitle">' + (firstName ? 'Привет, ' + esc(firstName) + '!' : 'Доброго дня!') + '</h1>' +
                '<div class="pg-sub">Отметь, где ты держишь строй на этой неделе — запись сразу уйдёт в «График офиса».</div>' +
              '</div>' +
              (rangeLbl ? '<div class="pg-range"><div class="pg-range-lbl">Неделя</div>' +
                '<div class="pg-range-val">' + esc(rangeLbl) + '</div></div>' : '') +
            '</div>' +

            '<div class="pg-body"><div class="pg-days">' + rowsHtml + '</div>' +
              '<div class="pg-work" id="pgWork" style="display:none">' +
                '<div class="pg-work-lbl">' + IC.hammer + '<span>Работа для «На объекте»</span></div>' +
                '<div id="pgWorkSlot"></div>' +
              '</div>' +
            '</div>' +

            '<div class="pg-err" id="pgErr"></div>' +

            '<div class="pg-foot">' +
              '<div class="pg-hint">Заполняй только рабочие дни — выходные и праздники пропущены.<br>Без отметки вход в CRM закрыт.</div>' +
              '<button class="pg-btn" id="pgSave" type="button"><span>В строй</span>' + IC.arrow + '</button>' +
            '</div>' +
          '</div>';

        document.body.appendChild(scene);

        // ── Селекты по дням ────────────────────────────────────────────────
        var selects = {};   // date → select element

        days.forEach(function (d) {
          if (d.on_vacation) return;
          var slot = scene.querySelector('[data-slot="' + d.date + '"]');
          if (!slot) return;
          var sel = createSelect({
            options: statuses.map(function (s) { return { code: s.code, label: s.label }; }),
            value: d.status_code || '',
            placeholder: '— не отмечено —',
            onChange: function () { syncWork(); err(''); },
          });
          slot.appendChild(sel);
          selects[d.date] = sel;
        });

        // ── Выбор работы ───────────────────────────────────────────────────
        var workSel = null;
        var workWrap = scene.querySelector('#pgWork');
        var workSlot = scene.querySelector('#pgWorkSlot');

        if (works.length) {
          workSel = createSelect({
            options: works.map(function (w) {
              return { code: String(w.id), label: w.title, place: w.place || '' };
            }),
            value: works.length === 1 ? String(works[0].id) : '',
            placeholder: '— выбери работу —',
            onChange: function () { err(''); },
          });
          workSlot.appendChild(workSel);
        }

        function anyOnSite() {
          return Object.keys(selects).some(function (k) { return selects[k]._getValue() === 'об'; });
        }

        function syncWork() {
          var need = anyOnSite();
          workWrap.style.display = need ? 'block' : 'none';
          if (need && workSel) {
            // Работа обязательна — подсвечиваем триггер, пока не выбрана.
            workSel.classList.toggle('has-value', !!workSel._getValue());
          }
        }
        syncWork();

        function err(msg) {
          var el = scene.querySelector('#pgErr');
          el.innerHTML = msg ? (IC.alert + '<span>' + esc(msg) + '</span>') : '';
        }

        // ── Сохранение ─────────────────────────────────────────────────────
        var btn = scene.querySelector('#pgSave');
        btn.addEventListener('click', function () {
          var payload = [];
          Object.keys(selects).forEach(function (date) {
            var code = selects[date]._getValue();
            if (!code) return;
            payload.push({
              date: date,
              status_code: code,
              work_id: code === 'об' ? (parseInt(workSel && workSel._getValue(), 10) || null) : null,
            });
          });

          if (!payload.length) { err('Отметь хотя бы один день недели'); return; }
          if (payload.some(function (p) { return p.status_code === 'об'; }) && !(workSel && workSel._getValue())) {
            err('Выбери работу для «На объекте»');
            return;
          }

          err('');
          btn.disabled = true;
          btn.innerHTML = '<span>Сохраняю…</span>';

          fetch('/api/daily-presence/week', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + auth.token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ days: payload }),
          })
            .then(function (r) {
              return r.json().catch(function () { return {}; }).then(function (j) {
                if (!r.ok) throw new Error(j.message || 'Не удалось сохранить');
                return j;
              });
            })
            .then(function () {
              localStorage.setItem(weekKey, '1');
              scene.remove();
              if (typeof cfg.onDone === 'function') cfg.onDone();
              resolve(true);
            })
            .catch(function (e) {
              err(e.message || 'Не удалось сохранить. Повтори.');
              btn.disabled = false;
              btn.innerHTML = '<span>В строй</span>' + IC.arrow;
            });
        });

        // Клик по фону не закрывает — гейт блокирующий (осознанно).
        scene.addEventListener('click', function (e) {
          if (e.target === scene) e.stopPropagation();
        });

        // Первый пустой день — фокус, чтобы можно было работать с клавиатуры.
        var firstEmpty = days.filter(function (d) { return !d.on_vacation && !d.status_code; })[0];
        if (firstEmpty && selects[firstEmpty.date]) {
          var t = selects[firstEmpty.date].querySelector('.pg-trigger');
          if (t) t.focus({ preventScroll: true });
        }
      }
    });
  }

  window.AsgardPresenceWeek = { mount: mount, TONE: TONE, IC: IC };
})();
