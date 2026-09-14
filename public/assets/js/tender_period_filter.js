/**
 * Фильтр периода саги тендеров — логика + UI (vanilla).
 * Один файл: без хрупкой зависимости от порядка скриптов.
 *
 * Режимы: month | range | quick
 * Поля:   created_at | docs_deadline
 */
(function (root) {
  'use strict';

  function pad2(n) { return String(n).padStart(2, '0'); }

  function ymNow() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }

  function defaultState(overrides) {
    return Object.assign({
      mode: 'month',
      quick: 'all',
      month: ymNow(),
      dateFrom: '',
      dateTo: '',
      dateField: 'created_at'
    }, overrides || {});
  }

  function buildMonthOptions(count) {
    var out = [
      { value: '', label: 'Все периоды' },
      { value: 'year:' + new Date().getFullYear(), label: 'За ' + new Date().getFullYear() + ' год' },
      { value: 'year:' + (new Date().getFullYear() - 1), label: 'За ' + (new Date().getFullYear() - 1) + ' год' }
    ];
    var now = new Date();
    for (var i = 0; i < (count || 18); i++) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      var ym = d.getFullYear() + '-' + pad2(d.getMonth() + 1);
      out.push({
        value: ym,
        label: d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
      });
    }
    return out;
  }

  function toQueryParams(state) {
    var s = state || defaultState();
    var q = { date_field: s.dateField || 'created_at' };
    if (s.mode === 'range') {
      if (s.dateFrom) q.date_from = s.dateFrom;
      if (s.dateTo) q.date_to = s.dateTo;
      if (!q.date_from && !q.date_to) q.period = 'all';
      return q;
    }
    if (s.mode === 'month') {
      var m = s.month || '';
      if (m === 'current') m = ymNow();
      q.period = m || 'all';
      return q;
    }
    var map = { today: '3d', week: '7d', month: '30d', quarter: 'year', year: 'year', all: 'all' };
    q.period = map[s.quick] || 'all';
    return q;
  }

  function summary(state) {
    var q = toQueryParams(state);
    var field = q.date_field === 'docs_deadline' ? 'срок подачи' : 'дата внесения';
    if (q.date_from || q.date_to) {
      var fmt = function (iso) { return iso ? iso.split('-').reverse().join('.') : '…'; };
      return fmt(q.date_from) + ' — ' + fmt(q.date_to) + ' · ' + field;
    }
    if (!q.period || q.period === 'all') return 'Все периоды · ' + field;
    if (q.period === '3d') return '3 дня · ' + field;
    if (q.period === '7d') return '7 дней · ' + field;
    if (q.period === '30d') return '30 дней · ' + field;
    if (q.period === 'year') return 'За год · ' + field;
    if (String(q.period).indexOf('year:') === 0) return 'За ' + q.period.slice(5) + ' · ' + field;
    if (/^\d{4}-\d{2}$/.test(String(q.period))) {
      var parts = String(q.period).split('-');
      var d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
      return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }) + ' · ' + field;
    }
    return String(q.period);
  }

  function appendSearchParams(params, state) {
    var q = toQueryParams(state);
    Object.keys(q).forEach(function (k) {
      if (q[k] != null && q[k] !== '') params.set(k, String(q[k]));
    });
    return params;
  }

  function fromLegacyPeriod(periodVal) {
    var v = periodVal == null ? 'current' : String(periodVal);
    if (v === 'current') return defaultState({ mode: 'month', month: ymNow() });
    if (!v || v === 'all') return defaultState({ mode: 'month', month: '' });
    if (v.indexOf('year:') === 0 || /^\d{4}-\d{2}$/.test(v)) {
      return defaultState({ mode: 'month', month: v === 'current' ? ymNow() : v });
    }
    return defaultState({ mode: 'month', month: v });
  }

  var MODES = [
    { id: 'month', label: 'Месяц' },
    { id: 'range', label: 'От — до' },
    { id: 'quick', label: 'Быстро' }
  ];

  var QUICK = [
    { value: 'today', label: '3 дня' },
    { value: 'week', label: 'Неделя' },
    { value: 'month', label: '30 дней' },
    { value: 'year', label: 'Год' },
    { value: 'all', label: 'Всё время' }
  ];

  var DATE_FIELDS = [
    { id: 'created_at', label: 'Дата внесения', hint: 'когда тендер завели в CRM' },
    { id: 'docs_deadline', label: 'Срок подачи', hint: 'дедлайн заявок на площадке' }
  ];

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function mount(container, opts) {
    opts = opts || {};
    var state = defaultState(opts.state);
    if (opts.legacyPeriod != null && !opts.state) state = fromLegacyPeriod(opts.legacyPeriod);
    var onChange = opts.onChange || function () {};
    var live = opts.live !== false;

    container.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'tpf-wrap';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tpf-trigger';
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.innerHTML =
      '<span class="tpf-trigger-ic" aria-hidden="true">📅</span>' +
      '<span class="tpf-trigger-text"></span>' +
      '<span class="tpf-trigger-caret" aria-hidden="true">▾</span>';

    var pop = document.createElement('div');
    pop.className = 'tpf-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Фильтр периода');

    wrap.appendChild(btn);
    container.appendChild(wrap);
    document.body.appendChild(pop);

    function syncSummary() {
      var text = summary(state);
      btn.querySelector('.tpf-trigger-text').textContent = text;
      btn.title = text;
      btn.setAttribute('aria-expanded', pop.classList.contains('open') ? 'true' : 'false');
    }

    function emit(close) {
      syncSummary();
      onChange(Object.assign({}, state), toQueryParams(state));
      if (close) closePop();
    }

    function positionPop() {
      var r = btn.getBoundingClientRect();
      var w = Math.min(360, Math.max(300, window.innerWidth - 24));
      var left = Math.min(Math.max(12, r.left), window.innerWidth - w - 12);
      var top = r.bottom + 6;
      if (top + 420 > window.innerHeight && r.top > 420) {
        top = Math.max(12, r.top - 6 - Math.min(420, pop.offsetHeight || 360));
      }
      pop.style.width = w + 'px';
      pop.style.left = left + 'px';
      pop.style.top = top + 'px';
    }

    function openPop() {
      pop.classList.add('open');
      positionPop();
      syncSummary();
    }

    function closePop() {
      pop.classList.remove('open');
      syncSummary();
    }

    function render() {
      var fieldHint = '';
      DATE_FIELDS.forEach(function (f) {
        if (f.id === state.dateField) fieldHint = f.hint;
      });

      var bodyHtml = '';
      if (state.mode === 'month') {
        bodyHtml = '<div class="tpf-month-list" role="listbox">' +
          buildMonthOptions(18).map(function (o) {
            var on = (state.month || '') === (o.value || '');
            return '<button type="button" role="option" class="tpf-month-item' + (on ? ' on' : '') + '" data-month="' + esc(o.value) + '" aria-selected="' + (on ? 'true' : 'false') + '">' + esc(o.label) + '</button>';
          }).join('') + '</div>';
      } else if (state.mode === 'range') {
        bodyHtml =
          '<div class="tpf-range">' +
          '<label class="tpf-date-field"><span>С</span><input type="date" class="inp" data-from value="' + esc(state.dateFrom) + '"></label>' +
          '<label class="tpf-date-field"><span>По</span><input type="date" class="inp" data-to value="' + esc(state.dateTo) + '" min="' + esc(state.dateFrom || '') + '"></label>' +
          '</div>' +
          '<p class="tpf-hint">Укажите обе даты или одну — фильтр сработает по доступной границе.</p>';
      } else {
        bodyHtml = '<div class="tpf-chips">' + QUICK.map(function (p) {
          return '<button type="button" class="tpf-chip' + (state.quick === p.value ? ' on' : '') + '" data-quick="' + esc(p.value) + '">' + esc(p.label) + '</button>';
        }).join('') + '</div>';
      }

      pop.innerHTML =
        '<div class="tpf-head">Период</div>' +
        '<div class="tpf-section">' +
          '<div class="tpf-label">Фильтровать по</div>' +
          '<div class="tpf-seg" role="group">' +
            DATE_FIELDS.map(function (f) {
              return '<button type="button" class="' + (state.dateField === f.id ? 'on' : '') + '" data-field="' + f.id + '">' + esc(f.label) + '</button>';
            }).join('') +
          '</div>' +
          (fieldHint ? '<p class="tpf-hint">' + esc(fieldHint) + '</p>' : '') +
        '</div>' +
        '<div class="tpf-section">' +
          '<div class="tpf-label">Как выбрать</div>' +
          '<div class="tpf-tabs" role="tablist">' +
            MODES.map(function (m) {
              return '<button type="button" role="tab" class="' + (state.mode === m.id ? 'on' : '') + '" data-mode="' + m.id + '">' + esc(m.label) + '</button>';
            }).join('') +
          '</div>' +
        '</div>' +
        '<div class="tpf-body tpf-section">' + bodyHtml + '</div>' +
        '<div class="tpf-foot">' +
          '<button type="button" class="btn ghost mini" data-reset>Сбросить</button>' +
          '<button type="button" class="btn mini" data-done>Применить</button>' +
        '</div>';

      wire();
    }

    function wire() {
      pop.querySelectorAll('[data-field]').forEach(function (el) {
        el.addEventListener('click', function () {
          state.dateField = el.getAttribute('data-field');
          render();
          positionPop();
          syncSummary();
        });
      });
      pop.querySelectorAll('[data-mode]').forEach(function (el) {
        el.addEventListener('click', function () {
          state.mode = el.getAttribute('data-mode');
          render();
          positionPop();
        });
      });
      pop.querySelectorAll('[data-month]').forEach(function (el) {
        el.addEventListener('click', function () {
          state.month = el.getAttribute('data-month') || '';
          emit(true);
        });
      });
      pop.querySelectorAll('[data-quick]').forEach(function (el) {
        el.addEventListener('click', function () {
          state.quick = el.getAttribute('data-quick');
          emit(true);
        });
      });
      var fromInp = pop.querySelector('[data-from]');
      var toInp = pop.querySelector('[data-to]');
      if (fromInp) {
        fromInp.addEventListener('change', function () {
          state.dateFrom = fromInp.value;
          if (!state.dateTo) state.dateTo = fromInp.value;
          if (toInp) { toInp.value = state.dateTo; toInp.min = state.dateFrom || ''; }
          syncSummary();
        });
      }
      if (toInp) {
        toInp.addEventListener('change', function () {
          state.dateTo = toInp.value;
          if (!state.dateFrom) state.dateFrom = toInp.value;
          if (fromInp) fromInp.value = state.dateFrom;
          syncSummary();
        });
      }
      pop.querySelector('[data-reset]').addEventListener('click', function () {
        state = defaultState({ month: '', quick: 'all', dateField: state.dateField });
        emit(true);
        render();
      });
      pop.querySelector('[data-done]').addEventListener('click', function () {
        emit(true);
      });
    }

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (pop.classList.contains('open')) closePop();
      else {
        render();
        openPop();
      }
    });

    document.addEventListener('click', function (e) {
      if (!pop.classList.contains('open')) return;
      if (pop.contains(e.target) || btn.contains(e.target)) return;
      closePop();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && pop.classList.contains('open')) closePop();
    });
    window.addEventListener('resize', function () {
      if (pop.classList.contains('open')) positionPop();
    });
    window.addEventListener('scroll', function () {
      if (pop.classList.contains('open')) positionPop();
    }, true);

    syncSummary();

    return {
      getState: function () { return Object.assign({}, state); },
      getQuery: function () { return toQueryParams(state); },
      setState: function (next) {
        state = defaultState(next);
        syncSummary();
        if (pop.classList.contains('open')) render();
      },
      setLegacyPeriod: function (p) {
        state = fromLegacyPeriod(p);
        syncSummary();
      },
      destroy: function () {
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        if (pop.parentNode) pop.parentNode.removeChild(pop);
      }
    };
  }

  root.TenderPeriodFilter = {
    defaultState: defaultState,
    buildMonthOptions: buildMonthOptions,
    toQueryParams: toQueryParams,
    summary: summary,
    appendSearchParams: appendSearchParams,
    fromLegacyPeriod: fromLegacyPeriod,
    ymNow: ymNow
  };
  root.TenderPeriodFilterUI = { mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
