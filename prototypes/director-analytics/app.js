/* ASGARD CRM · Дашборд руководителя — v3
   Тендеры / Заявки (11 статусов канбана) / Работы → модальная карточка. */
(function () {
  'use strict';

  var M = window.ASGARD_DIRECTOR_MOCK;
  if (!M) {
    document.body.innerHTML = '<p style="padding:40px;font-family:sans-serif">mock-data.js не загрузился</p>';
    return;
  }

  var MONTHS_RU = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
  ];

  var state = {
    theme: 'dark',
    vp: 'desktop',
    device: 'iphone',
    period: 'month',
    view: 'overview',          // overview | list
    listSection: null,
    listStatus: 'all',
    listQuery: '',
    listSort: 'deadline',      // deadline | sum | created
    listPage: 1,
    modal: null,
    tab: null
  };

  var el = {
    pageHead: document.getElementById('pageHead'),
    sections: document.getElementById('sections'),
    page: document.getElementById('page'),
    crm: document.getElementById('crm'),
    stage: document.getElementById('stage'),
    modalRoot: document.getElementById('modalRoot'),
    modal: document.getElementById('modal'),
    clock: null
  };

  /* ── Утилиты ──────────────────────────────────────────────────────────── */
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function num(n) {
    return new Intl.NumberFormat('ru-RU').format(Math.round(Number(n) || 0));
  }

  function rub(n) {
    return num(n) + ' ₽';
  }

  /* Крупная сумма → { v, u } — «12,68» + «млн ₽» */
  function compact(n) {
    var v = Math.abs(Number(n) || 0);
    var sign = Number(n) < 0 ? '−' : '';
    if (v >= 1e9) return { v: sign + (v / 1e9).toFixed(2).replace('.', ','), u: 'млрд ₽' };
    if (v >= 1e6) {
      var m = (v / 1e6).toFixed(2).replace('.', ',');
      if (m.slice(-3) === ',00') m = m.slice(0, -3);
      else if (m.slice(-1) === '0') m = m.slice(0, -1);
      return { v: sign + m, u: 'млн ₽' };
    }
    if (v >= 1e3) return { v: sign + num(v), u: '₽' };
    return { v: sign + num(v), u: '₽' };
  }

  function moneyShort(n) {
    if (!n) return '—';
    var c = compact(n);
    return c.v + ' ' + c.u;
  }

  function fmtDate(isoStr) {
    if (!isoStr) return '—';
    var p = isoStr.split('-');
    return p[2] + '.' + p[1] + '.' + p[0];
  }

  function shortDate(isoStr) {
    if (!isoStr) return '—';
    var p = isoStr.split('-');
    return p[2] + '.' + p[1];
  }

  function daysLeft(isoStr) {
    if (!isoStr) return null;
    var d = new Date(isoStr + 'T12:00:00');
    var now = new Date();
    now.setHours(12, 0, 0, 0);
    return Math.round((d - now) / 86400000);
  }

  function deadlineText(isoStr) {
    var d = daysLeft(isoStr);
    if (d === null) return 'без срока';
    if (d === 0) return 'сегодня';
    if (d > 0) return 'через ' + d + ' дн.';
    return 'просрочен на ' + Math.abs(d) + ' дн.';
  }

  function daysWord(n) {
    var a = Math.abs(n) % 100;
    var b = a % 10;
    if (a > 10 && a < 20) return 'дней';
    if (b === 1) return 'день';
    if (b >= 2 && b <= 4) return 'дня';
    return 'дней';
  }

  /** Чип дедлайна в строке списка: обычный / сегодня / просрочен. */
  function deadlineChip(isoStr, closed) {
    if (!isoStr) return '<span class="dl-chip">без срока</span>';
    var d = daysLeft(isoStr);
    if (closed) return '<span class="dl-chip is-muted">' + esc(shortDate(isoStr)) + '</span>';
    if (d < 0) {
      return '<span class="dl-chip is-over">просрочен ' + Math.abs(d) + ' ' + daysWord(d) + '</span>';
    }
    if (d === 0) return '<span class="dl-chip is-today">дедлайн сегодня</span>';
    if (d <= 3) return '<span class="dl-chip is-soon">' + esc(shortDate(isoStr)) + ' · ' + d + ' ' + daysWord(d) + '</span>';
    return '<span class="dl-chip">дедлайн ' + esc(shortDate(isoStr)) + '</span>';
  }

  function initials(name) {
    if (!name) return '—';
    var s = String(name).replace(/[«»"'()]/g, ' ').trim();
    var parts = s.split(/\s+/).filter(Boolean);
    if (!parts.length) return '—';
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }

  function pct(n) {
    var v = Number(n);
    if (!isFinite(v)) return '—';
    return (Math.round(v * 10) / 10).toLocaleString('ru-RU') + ' %';
  }

  function toneCls(t) {
    return 'tone-' + (t || 'muted');
  }

  function chev() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function statusMeta(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* ── Выборки по периоду ───────────────────────────────────────────────── */
  function tenders() {
    return M.tenders.filter(function (t) { return M.inPeriod(t.date, state.period); });
  }
  function apps() {
    return M.applications.filter(function (a) { return M.inPeriod(a.created, state.period); });
  }
  function works() {
    return M.works.filter(function (w) { return M.inPeriod(w.start, state.period); });
  }
  function source(section) {
    if (section === 'tenders') return tenders();
    if (section === 'applications') return apps();
    return works();
  }
  function statusesOf(section) {
    if (section === 'tenders') return M.TENDER_STATUSES;
    if (section === 'applications') return M.APP_STATUSES;
    return M.WORK_STATUSES;
  }
  function itemsOf(section, statusId) {
    return source(section).filter(function (x) {
      return section === 'tenders' ? x.registry_status === statusId
        : section === 'applications' ? x.status === statusId
          : x.phase === statusId;
    });
  }
  function amountOf(item) {
    if (item.contract != null) return item.contract;
    if (item.amount != null) return item.amount;
    if (item.work_price != null) return item.work_price;
    return 0;
  }
  function findItem(section, id) {
    var pool = section === 'tenders' ? M.tenders : section === 'applications' ? M.applications : M.works;
    for (var i = 0; i < pool.length; i++) if (pool[i].id === id) return pool[i];
    return null;
  }

  /* ── Шапка страницы ───────────────────────────────────────────────────── */
  function renderHead() {
    var now = new Date();
    var timeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    var dateStr = now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

    var periods = ['month', 'half_year', 'year', 'all'];
    var chips = periods.map(function (p) {
      var on = state.period === p;
      return '<button type="button" role="tab" data-period="' + p + '"' +
        (on ? ' class="is-on" aria-selected="true"' : ' aria-selected="false"') + '>' +
        esc(M.PERIODS[p].label) + '</button>';
    }).join('');

    el.pageHead.innerHTML =
      '<div class="p-head">' +
        '<div class="p-head-left">' +
          '<nav class="p-crumbs" aria-label="Хлебные крошки">' +
            '<span>Главная</span><span class="sep">/</span>' +
            '<span class="cur">Дашборд руководителя</span>' +
          '</nav>' +
          '<h1 class="p-title">Дашборд руководителя</h1>' +
          '<p class="p-sub">Тендеры, заявки и работы · сводка на ' + esc(dateStr) + '</p>' +
        '</div>' +
        '<div class="p-head-right">' +
          '<div class="p-clock"><span class="p-clock-dot"></span>Обновлено <time id="liveClock">' + esc(timeStr) + '</time></div>' +
          '<div class="period-bar" role="tablist" aria-label="Период"><span class="period-ind" id="periodInd"></span>' + chips + '</div>' +
        '</div>' +
      '</div>';

    el.clock = document.getElementById('liveClock');
    requestAnimationFrame(positionPeriodInd);
  }

  function positionPeriodInd() {
    var bar = el.pageHead.querySelector('.period-bar');
    var ind = document.getElementById('periodInd');
    if (!bar || !ind) return;
    var on = bar.querySelector('button.is-on');
    if (!on) return;
    ind.style.left = on.offsetLeft + 'px';
    ind.style.width = on.offsetWidth + 'px';
  }

  /* ── Хиро-метрики секций ──────────────────────────────────────────────── */
  function heroTenders() {
    var list = tenders();
    var nmck = list.reduce(function (a, t) { return a + t.nmck; }, 0);
    var price = list.reduce(function (a, t) { return a + t.work_price; }, 0);
    var win = list.filter(function (t) { return t.registry_status === 'выиграли'; }).length;
    var lose = list.filter(function (t) { return t.registry_status === 'проиграли'; }).length;
    var closed = win + lose;
    var conv = closed ? (win / closed) * 100 : null;
    var inWork = list.filter(function (t) {
      return t.registry_status === 'рассмотрение' || t.registry_status === 'готовим' || t.registry_status === 'подались';
    }).length;

    return [
      cell('Тендеров в периоде', String(list.length), '', 'из них <b>' + inWork + '</b> в активной фазе', ''),
      cellMoney('Сумма НМЦК', nmck, '', 'по ' + list.length + ' процедурам'),
      cellMoney('Цена работ без НДС', price, '', 'сметы Асгард'),
      cell(conv === null ? 'Конверсия' : 'Конверсия', conv === null ? '—' : Math.round(conv * 10) / 10 + ' %', '',
        '<b>' + win + '</b> побед из <b>' + closed + '</b> закрытых', conv !== null && conv >= 30 ? 'tone-ok' : '')
    ];
  }

  function heroApps() {
    var list = apps();
    var sum = list.reduce(function (a, x) { return a + x.amount; }, 0);
    var active = list.filter(function (a) {
      return ['calc', 'approval', 'kp_prep', 'sent', 'addendum'].indexOf(a.status) >= 0;
    });
    var activeSum = active.reduce(function (a, x) { return a + x.amount; }, 0);
    var win = list.filter(function (a) { return a.status === 'win' || a.status === 'work' || a.status === 'done'; });
    var winSum = win.reduce(function (a, x) { return a + x.amount; }, 0);
    var lose = list.filter(function (a) { return a.status === 'lose'; }).length;
    var closed = win.length + lose;
    var conv = closed ? (win.length / closed) * 100 : null;

    return [
      cell('Заявок в периоде', String(list.length), '', 'все 11 статусов канбана', ''),
      cellMoney('В работе', activeSum, '', active.length + ' заявок в контуре', ''),
      cellMoney('Выиграно', winSum, 'tone-ok', win.length + ' заявок закрыто успешно'),
      cell(conv === null ? 'Конверсия' : 'Конверсия', conv === null ? '—' : Math.round(conv * 10) / 10 + ' %', '',
        '<b>' + win.length + '</b> из <b>' + closed + '</b> решённых', conv !== null && conv >= 40 ? 'tone-ok' : '')
    ];
  }

  function heroWorks() {
    var list = works();
    var contract = list.reduce(function (a, w) { return a + w.contract; }, 0);
    var cost = list.reduce(function (a, w) { return a + w.cost; }, 0);
    var margin = contract - cost;
    var marginPct = contract ? (margin / contract) * 100 : 0;
    var paid = list.reduce(function (a, w) { return a + w.paid; }, 0);
    var active = list.filter(function (w) { return w.phase === 'active'; }).length;
    var risk = list.filter(function (w) { return w.schedule_light !== 'ok'; }).length;

    return [
      cell('Работ в периоде', String(list.length), '', '<b>' + active + '</b> активных · <b>' + risk + '</b> в риске', ''),
      cellMoney('Портфель контрактов', contract, '', 'по ' + list.length + ' договорам'),
      cell('Средняя маржа', Math.round(marginPct * 10) / 10 + ' %', marginPct >= 18 ? 'tone-ok' : 'tone-gold',
        moneyShort(margin) + ' валовой прибыли'),
      cellMoney('Оплачено', paid, '', 'остаток ' + moneyShort(Math.max(0, contract - paid)))
    ];
  }

  function cell(cap, value, cls, meta, extra) {
    return '<div class="hero-cell ' + (cls || '') + (extra ? ' ' + extra : '') + '">' +
      '<div class="hero-cap">' + esc(cap) + '</div>' +
      '<div class="hero-num lg">' + esc(value) + '</div>' +
      (meta ? '<div class="hero-meta">' + meta + '</div>' : '') +
      '</div>';
  }

  function cellMoney(cap, value, cls, meta) {
    var c = compact(value);
    return '<div class="hero-cell ' + (cls || '') + '">' +
      '<div class="hero-cap">' + esc(cap) + '</div>' +
      '<div class="hero-num money">' + esc(c.v) + '<span class="unit">' + esc(c.u) + '</span></div>' +
      (meta ? '<div class="hero-meta">' + meta + '</div>' : '') +
      '</div>';
  }

  /* ── Строка статуса ───────────────────────────────────────────────────── */
  function statusRow(section, st) {
    var items = itemsOf(section, st.id);
    var n = items.length;
    var sum = items.reduce(function (a, x) { return a + amountOf(x); }, 0);
    var meta = statusMetaLine(section, st, items);
    var sumCap = section === 'applications' && st.id === 'trash' ? 'сумма не считается' : 'сумма';
    var money = n ? moneyShort(sum) : '—';

    return '<button type="button" class="status-card ' + toneCls(st.tone) + '"' +
      ' data-status="' + esc(st.id) + '" data-section="' + section + '">' +
      '<span class="sc-bar"></span>' +
      '<span class="sc-top">' +
        '<span class="sc-name"><span class="sc-dot"></span>' + esc(st.label) + '</span>' +
        '<span class="sc-count' + (n ? '' : ' zero') + '">' + n + '</span>' +
      '</span>' +
      '<span class="sc-money">' + esc(money) + '<span class="sc-money-cap">' + esc(sumCap) + '</span></span>' +
      '<span class="sc-meta">' + meta + '</span>' +
      '<span class="sc-go" aria-hidden="true">' + chev() + '</span>' +
    '</button>';
  }

  function statusMetaLine(section, st, items) {
    if (!items.length) return 'нет карточек за период';
    if (section === 'tenders') {
      var near = items.slice().sort(function (a, b) {
        return new Date(a.deadline) - new Date(b.deadline);
      })[0];
      var d = daysLeft(near.deadline);
      var tail = d === null ? '' : d < 0 ? ' · ближайший просрочен' : ' · ближайший через ' + d + ' ' + daysWord(d);
      return 'НМЦК <b>' + moneyShort(items.reduce(function (a, t) { return a + t.nmck; }, 0)) + '</b>' + tail;
    }
    if (section === 'applications') {
      var green = items.filter(function (a) { return a.ai && a.ai.color === 'green'; }).length;
      return 'AI зелёных <b>' + green + '</b> · <b>' + items.length + '</b> в колонке';
    }
    var paid = items.reduce(function (a, w) { return a + w.paid; }, 0);
    var risk = items.filter(function (w) { return w.schedule_light !== 'ok'; }).length;
    return 'оплачено <b>' + moneyShort(paid) + '</b>' + (risk ? ' · <b>' + risk + '</b> в риске' : ' · график в норме');
  }

  /* ── Список под статусом ──────────────────────────────────────────────── */
  /** Срочность дедлайна для строки списка: '' | 'today' | 'over'. */
  function dueFlag(deadline, closed) {
    if (!deadline || closed) return '';
    var d = daysLeft(deadline);
    if (d === null) return '';
    if (d < 0) return 'over';
    if (d === 0) return 'today';
    return '';
  }

  function rowFor(section, item, st) {
    var av = '', t1 = '', t2 = '', money = '', moneySub = '', moneySubCls = '', flag = '';

    if (section === 'tenders') {
      var closed = item.registry_status === 'выиграли' || item.registry_status === 'проиграли' || item.registry_status === 'отмена';
      flag = dueFlag(item.deadline, closed);
      av = initials(item.customer);
      t1 = '<span class="t">' + esc(item.title) + '</span>';
      t2 = esc(item.customer) +
        '<span class="dotsep">·</span>' + esc(item.region) +
        '<span class="dotsep"></span>' + deadlineChip(item.deadline, closed);
      money = rub(item.work_price);
      moneySub = 'маржа ' + pct(item.estimate.margin_pct);
      moneySubCls = item.estimate.margin_pct >= 20 ? 'ok' : item.estimate.margin_pct >= 14 ? 'warn' : 'err';
    } else if (section === 'applications') {
      var aClosed = item.status === 'win' || item.status === 'lose' || item.status === 'trash' || item.status === 'done';
      flag = dueFlag(item.deadline, aClosed);
      av = initials(item.sender.name);
      t1 = '<span class="t">' + esc(item.title) + '</span>';
      t2 = esc(item.customer) +
        '<span class="dotsep">·</span>' + esc(M.CHANNELS[item.channel] || item.channel) +
        '<span class="dotsep">·</span>' + esc(shortDate(item.created)) +
        (item.deadline ? '<span class="dotsep"></span>' + deadlineChip(item.deadline, aClosed) : '');
      money = item.amount ? rub(item.amount) : '—';
      moneySub = item.pm ? 'РП ' + item.pm.name.split(' ')[0] : 'РП не назначен';
      moneySubCls = item.pm ? '' : 'warn';
    } else {
      av = initials(item.pm.name);
      t1 = '<span class="t">' + esc(item.title) + '</span>';
      t2 = esc(item.customer) +
        '<span class="dotsep">·</span>' + esc(item.region) +
        '<span class="dotsep">·</span>бригада ' + item.brigade.length +
        '<span class="dotsep">·</span>до ' + esc(fmtDate(item.due));
      money = rub(item.contract);
      moneySub = 'маржа ' + pct(item.margin_pct);
      moneySubCls = item.margin_pct >= 20 ? 'ok' : item.margin_pct >= 12 ? 'warn' : 'err';
    }

    return '<button type="button" class="row' + (flag ? ' row--' + flag : '') + '" data-item="' + esc(item.id) + '" data-section="' + section + '">' +
      '<span class="row-av ' + toneCls(st.tone) + '">' + esc(av) + '</span>' +
      '<span class="row-main">' +
        '<span class="row-t1">' + t1 + '</span>' +
        '<span class="row-t2">' + t2 + '</span>' +
      '</span>' +
      '<span class="row-side">' +
        '<span class="row-money">' +
          '<span class="row-money-val">' + esc(money) + '</span>' +
          '<span class="row-money-sub ' + moneySubCls + '">' + esc(moneySub) + '</span>' +
        '</span>' +
        '<span class="row-chev">' + chev() + '</span>' +
      '</span>' +
    '</button>';
  }

  /* ── Экран реестра: полный список с поиском, сортировкой и страницами ── */
  var PAGE_SIZE = 25;

  function listSectionMeta(section) {
    if (section === 'tenders') return { title: 'Тендеры', unit: 'тендеров', hero: heroTenders };
    if (section === 'applications') return { title: 'Заявки', unit: 'заявок', hero: heroApps };
    return { title: 'Работы', unit: 'работ', hero: heroWorks };
  }

  function matchesQuery(section, item, q) {
    if (!q) return true;
    var hay = [];
    if (section === 'tenders') {
      hay = [item.title, item.customer, item.inn, item.notice, item.region, item.registry_status, item.pm && item.pm.name];
    } else if (section === 'applications') {
      hay = [item.title, item.customer, item.sender && item.sender.name, item.note, item.status];
    } else {
      hay = [item.title, item.customer, item.object, item.region, item.contract_no, item.pm && item.pm.name];
    }
    var s = hay.filter(Boolean).join(' ').toLowerCase();
    return s.indexOf(q) >= 0;
  }

  function listItems(section) {
    var st = state.listStatus;
    var q = state.listQuery.trim().toLowerCase();
    var arr = st === 'all' ? source(section).slice() : itemsOf(section, st);
    arr = arr.filter(function (x) { return matchesQuery(section, x, q); });
    var sort = state.listSort;
    arr.sort(function (a, b) {
      if (sort === 'sum') return amountOf(b) - amountOf(a);
      if (sort === 'created') return new Date(b.date || b.created || b.start) - new Date(a.date || a.created || a.start);
      return new Date(a.deadline || a.due || 0) - new Date(b.deadline || b.due || 0);
    });
    return arr;
  }

  function listScreen() {
    var section = state.listSection;
    var meta = listSectionMeta(section);
    var all = listItems(section);
    var totalSum = all.reduce(function (a, x) { return a + amountOf(x); }, 0);
    var pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    if (state.listPage > pages) state.listPage = pages;
    var from = (state.listPage - 1) * PAGE_SIZE;
    var pageItems = all.slice(from, from + PAGE_SIZE);
    var stMeta = statusMeta(statusesOf(section), state.listStatus);

    var tabs = statusesOf(section).map(function (st) {
      var n = itemsOf(section, st.id).length;
      var on = state.listStatus === st.id ? ' is-on' : '';
      return '<button type="button" class="lt-tab' + on + ' ' + toneCls(st.tone) + '" data-list-status="' + esc(st.id) + '">' +
          esc(st.label) + '<span class="lt-n">' + n + '</span></button>';
    }).join('');
    var allOn = state.listStatus === 'all' ? ' is-on' : '';

    var body = pageItems.length
      ? pageItems.map(function (x) { return rowFor(section, x, statusMeta(statusesOf(section), x.registry_status || x.status || x.phase)); }).join('')
      : '<div class="empty">Ничего не найдено. Измените фильтр или период.</div>';

    var pager = '';
    if (pages > 1) {
      var nums = '';
      var lo = Math.max(1, state.listPage - 2);
      var hi = Math.min(pages, lo + 4);
      lo = Math.max(1, hi - 4);
      for (var i = lo; i <= hi; i++) {
        nums += '<button type="button" class="pg-n' + (i === state.listPage ? ' is-on' : '') + '" data-page="' + i + '">' + i + '</button>';
      }
      pager = '<div class="pager">' +
          '<span class="pg-info">' + (from + 1) + '–' + Math.min(from + PAGE_SIZE, all.length) + ' из ' + all.length + '</span>' +
          '<span class="pg-btns">' +
            '<button type="button" class="pg-arrow" data-page="' + (state.listPage - 1) + '"' + (state.listPage === 1 ? ' disabled' : '') + '>' + chevL() + '</button>' +
            nums +
            '<button type="button" class="pg-arrow" data-page="' + (state.listPage + 1) + '"' + (state.listPage === pages ? ' disabled' : '') + '>' + chev() + '</button>' +
          '</span>' +
        '</div>';
    }

    return '<div class="list-screen">' +
        '<div class="ls-head">' +
          '<button type="button" class="ls-back" data-back-overview>' + chevL() + '<span>К обзору</span></button>' +
          '<div class="ls-titles">' +
            '<nav class="p-crumbs"><span>Главная</span><span class="sep">/</span>' +
              '<span>Дашборд руководителя</span><span class="sep">/</span>' +
              '<span class="cur">' + esc(meta.title) + '</span></nav>' +
            '<h1 class="ls-title">' + esc(meta.title) +
              '<span class="ls-badge">' + esc(stMeta && state.listStatus !== 'all' ? stMeta.label : 'все статусы') + '</span></h1>' +
          '</div>' +
          '<div class="ls-sum">' +
            '<span class="ls-sum-cap">' + esc(M.PERIODS[state.period].label) + ' · ' + all.length + ' ' + esc(meta.unit) + '</span>' +
            '<span class="ls-sum-val">' + esc(moneyShort(totalSum)) + '</span>' +
          '</div>' +
        '</div>' +

        '<div class="ls-bar">' +
          '<label class="ls-search">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="m16 16 4 4" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>' +
            '<input type="search" placeholder="Заказчик, ИНН, название, РП…" value="' + esc(state.listQuery) + '" data-list-search>' +
          '</label>' +
          '<div class="ls-sort">' +
            '<span class="ls-sort-cap">Сортировка</span>' +
            '<div class="seg-switch sm" role="group">' +
              '<button type="button" data-sort="deadline" class="' + (state.listSort === 'deadline' ? 'is-on' : '') + '">По дедлайну</button>' +
              '<button type="button" data-sort="sum" class="' + (state.listSort === 'sum' ? 'is-on' : '') + '">По сумме</button>' +
              '<button type="button" data-sort="created" class="' + (state.listSort === 'created' ? 'is-on' : '') + '">По дате</button>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="ls-tabs" role="tablist">' +
          '<button type="button" class="lt-tab lt-all' + allOn + '" data-list-status="all">Все<span class="lt-n">' + source(section).length + '</span></button>' +
          tabs +
        '</div>' +

        '<div class="ls-body">' +
          '<div class="ls-thead">' +
            '<span>Карточка</span><span>Дедлайн</span><span class="ta-r">Сумма</span>' +
          '</div>' +
          '<div class="rows rows--table">' + body + '</div>' +
        '</div>' +
        pager +
      '</div>';
  }

  function chevL() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  /* ── Обзор: секции со статусами ───────────────────────────────────────── */
  /** Сводка по срокам: сколько карточек просрочено / истекает сегодня. */
  function overdueSummary(section, list) {
    var over = 0, today = 0;
    list.forEach(function (x) {
      var closed = section === 'tenders'
        ? (x.registry_status === 'выиграли' || x.registry_status === 'проиграли' || x.registry_status === 'отмена')
        : (x.status === 'win' || x.status === 'lose' || x.status === 'trash' || x.status === 'done');
      var f = dueFlag(x.deadline, closed);
      if (f === 'over') over++;
      else if (f === 'today') today++;
    });
    if (!over && !today) return '';
    return '<div class="due-strip' + (over ? ' is-over' : '') + '">' +
        '<span class="due-strip-ico" aria-hidden="true">!</span>' +
        '<span class="due-strip-text">' +
          (over ? '<b>' + over + '</b> с просроченным дедлайном' : '') +
          (over && today ? ' · ' : '') +
          (today ? '<b>' + today + '</b> истекает сегодня' : '') +
        '</span>' +
        '<button type="button" class="due-strip-act" data-open-list="' + section + '" data-list-status="all">Показать всё</button>' +
      '</div>';
  }

  function sectionBlock(cfg) {
    var list = source(cfg.id);
    var total = list.reduce(function (a, x) { return a + amountOf(x); }, 0);
    var count = list.length;

    var cards = statusesOf(cfg.id).map(function (st) { return statusRow(cfg.id, st); }).join('');

    return '<section class="sec" id="sec-' + cfg.id + '">' +
      '<div class="sec-head">' +
        '<div class="sec-head-left">' +
          '<span class="sec-mark"></span>' +
          '<h2 class="sec-title">' + esc(cfg.title) + '</h2>' +
          '<span class="sec-note">' + esc(cfg.note) + '</span>' +
        '</div>' +
        '<div class="sec-head-right">' +
          '<span class="sec-total">' + esc(compact(total).v + ' ' + compact(total).u) + '</span>' +
          '<button type="button" class="sec-open" data-open-list="' + cfg.id + '">Открыть реестр' + chev() + '</button>' +
        '</div>' +
      '</div>' +
      overdueSummary(cfg.id, list) +
      '<div class="sec-hero">' + cfg.hero().join('') + '</div>' +
      '<div class="status-grid">' + cards + '</div>' +
      attentionList(cfg.id, list) +
    '</section>';
  }

  /** Требует внимания: 3 самые горячие карточки (просрочка → дедлайн сегодня → риск). */
  function attentionList(section, list) {
    var scored = list.map(function (x) {
      var closed = section === 'tenders'
        ? (x.registry_status === 'выиграли' || x.registry_status === 'проиграли' || x.registry_status === 'отмена')
        : (x.status === 'win' || x.status === 'lose' || x.status === 'trash' || x.status === 'done');
      var f = dueFlag(x.deadline || x.due, closed);
      var score = f === 'over' ? 3 : f === 'today' ? 2 : (section === 'works' && x.schedule_light === 'err') ? 1 : 0;
      return { x: x, score: score, closed: closed };
    }).filter(function (r) { return r.score > 0; });
    if (!scored.length) return '';
    scored.sort(function (a, b) { return b.score - a.score; });
    var top = scored.slice(0, 3);
    var st = statusesOf(section);
    var body = top.map(function (r) {
      var statusId = section === 'tenders' ? r.x.registry_status : section === 'applications' ? r.x.status : r.x.phase;
      return rowFor(section, r.x, statusMeta(st, statusId));
    }).join('');
    return '<div class="attention">' +
        '<div class="attention-h">' +
          '<span class="attention-ico" aria-hidden="true">!</span>' +
          '<span class="attention-title">Требует внимания</span>' +
          '<span class="attention-n">' + scored.length + '</span>' +
          '<button type="button" class="attention-all" data-open-list="' + section + '" data-list-status="all">Весь реестр' + chev() + '</button>' +
        '</div>' +
        '<div class="rows rows--compact">' + body + '</div>' +
      '</div>';
  }

  function renderPage() {
    if (state.view === 'list' && state.listSection) {
      el.pageHead.innerHTML = '';
      el.pageHead.hidden = true;
      el.sections.innerHTML = listScreen();
      el.sections.className = 'sections sections--list';
    } else {
      el.pageHead.hidden = false;
      el.sections.className = 'sections';
      renderHead();
      renderSections();
    }
  }

  function openList(section, status) {
    state.view = 'list';
    state.listSection = section;
    state.listStatus = status || 'all';
    state.listPage = 1;
    renderPage();
    window.scrollTo({ top: 0 });
  }

  function closeList() {
    state.view = 'overview';
    state.listSection = null;
    state.listQuery = '';
    state.listPage = 1;
    renderPage();
    window.scrollTo({ top: 0 });
  }

  function renderSections() {
    el.sections.innerHTML =
      sectionBlock({
        id: 'tenders', title: 'Тендеры',
        note: '6 статусов реестра',
        hero: heroTenders
      }) +
      sectionBlock({
        id: 'applications', title: 'Заявки',
        note: '11 статусов канбана',
        hero: heroApps
      }) +
      sectionBlock({
        id: 'works', title: 'Работы',
        note: 'Активные · пауза · архив',
        hero: heroWorks
      });
  }

  /* ── Модалка: общие части ─────────────────────────────────────────────── */
  function modalShell(opts) {
    var tabs = opts.tabs.map(function (t) {
      var on = state.tab === t.id;
      return '<button type="button" role="tab" data-tab="' + esc(t.id) + '"' +
        (on ? ' class="is-on" aria-selected="true"' : ' aria-selected="false"') + '>' + esc(t.label) + '</button>';
    }).join('');

    return '<div class="modal-head">' +
        '<div class="modal-head-top">' +
          '<button type="button" class="modal-back" data-close-modal aria-label="Назад">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
          '</button>' +
          '<div class="modal-head-main">' +
            '<div class="modal-kicker"><span>' + esc(opts.kicker) + '</span><span class="mono">' + esc(opts.id) + '</span></div>' +
            '<h2 class="modal-title" id="modalTitle">' + esc(opts.title) + '</h2>' +
            '<div class="modal-sub">' + opts.sub + '</div>' +
          '</div>' +
          '<button type="button" class="modal-close" data-close-modal aria-label="Закрыть">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="modal-tabs" role="tablist"><span class="tabs-ind" id="tabsInd"></span>' + tabs + '</div>' +
      '</div>' +
      '<div class="modal-body">' + opts.body() + '</div>';
  }

  function positionTabsInd() {
    var ind = document.getElementById('tabsInd');
    var bar = el.modal.querySelector('.modal-tabs');
    if (!ind || !bar) return;
    var on = bar.querySelector('button.is-on');
    if (!on) return;
    ind.style.left = on.offsetLeft + 'px';
    ind.style.width = on.offsetWidth + 'px';
  }

  function kvRow(k, v) {
    return '<div class="kv-row"><span class="kv-k">' + esc(k) + '</span><span class="kv-v">' + v + '</span></div>';
  }

  /**
   * Баннер просрочки/срочности по дедлайну.
   * Показываем только когда срок уже прошёл или истекает сегодня/завтра.
   */
  function deadlineBanner(deadline, opts) {
    if (!deadline) return '';
    var d = daysLeft(deadline);
    if (d === null || d > 1) return '';
    var o = opts || {};
    var cls = d < 0 ? 'is-over' : 'is-today';
    var head = d < 0
      ? 'Просрочка: дедлайн прошёл ' + Math.abs(d) + ' ' + daysWord(d)
      : d === 0
        ? 'Дедлайн сегодня'
        : 'Дедлайн завтра';
    var tail = o.status ? ' · статус «' + o.status + '»' : '';
    var hint = d < 0
      ? 'Карточка не закрыта. Требуется решение: продлить, подать или закрыть статусом.'
      : 'Срок истекает. Проверьте готовность пакета и решение по подаче.';
    return '<div class="dl-banner ' + cls + '">' +
        '<span class="dl-banner-ico" aria-hidden="true">!</span>' +
        '<span class="dl-banner-body">' +
          '<span class="dl-banner-head">' + esc(head) + esc(tail) + '</span>' +
          '<span class="dl-banner-hint">' + esc(hint) + '</span>' +
        '</span>' +
        '<span class="dl-banner-date mono">' + esc(shortDate(deadline)) + '</span>' +
      '</div>';
  }

  /** Блок аудита: кто завёл, кто анализировал, кто считал. */
  function auditBlock(rows) {
    var body = rows.filter(function (r) { return r && r.name; }).map(function (r) {
      return '<div class="audit-row">' +
          '<span class="audit-av">' + esc(initials(r.name)) + '</span>' +
          '<span class="audit-main">' +
            '<span class="audit-role">' + esc(r.role) + '</span>' +
            '<span class="audit-name">' + esc(r.name) + '</span>' +
          '</span>' +
          '<span class="audit-when mono">' + esc(r.at ? fmtDate(r.at) : '—') + '</span>' +
        '</div>';
    }).join('');
    if (!body) body = '<div class="empty" style="padding:16px">Данных об авторе нет</div>';
    return block('Кто вёл карточку', '<div class="audit">' + body + '</div>');
  }

  /** Блок причины закрытия (проигрыш / отмена). */
  function outcomeBlock(outcome) {
    if (!outcome) return '';
    var isCancel = outcome.kind === 'cancel';
    var badge = isCancel
      ? '<span class="badge neutral">Отмена</span>'
      : '<span class="badge err">Проигрыш</span>';
    return block(isCancel ? 'Почему отменили' : 'Почему проиграли',
      '<div class="outcome ' + (isCancel ? 'is-cancel' : 'is-lose') + '">' +
        '<div class="outcome-head">' + badge + '<span class="outcome-reason">' + esc(outcome.reason) + '</span></div>' +
        (outcome.detail ? '<div class="outcome-detail">' + esc(outcome.detail) + '</div>' : '') +
        '<div class="outcome-foot">' +
          '<span>Зафиксировал: <b>' + esc(outcome.by || '—') + '</b></span>' +
          '<span class="mono">' + esc(outcome.at ? fmtDate(outcome.at) : '—') + '</span>' +
        '</div>' +
      '</div>');
  }

  function kv(rows) {
    return '<div class="kv">' + rows.join('') + '</div>';
  }

  function block(title, body, headRight) {
    return '<div class="block">' +
      '<div class="block-h"><h3>' + esc(title) + '</h3>' + (headRight || '') + '</div>' +
      body + '</div>';
  }

  function sideCard(cap, value, cls, sub, rows) {
    return '<div class="side-card">' +
      '<div class="side-cap">' + esc(cap) + '</div>' +
      '<div class="side-big ' + (cls || '') + '">' + value + '</div>' +
      (sub ? '<div class="side-cap-sub">' + esc(sub) + '</div>' : '') +
      (rows && rows.length ? '<div class="side-rows">' + rows.map(function (r) {
        return '<div class="side-row"><span class="k">' + esc(r[0]) + '</span><span class="v">' + r[1] + '</span></div>';
      }).join('') + '</div>' : '') +
    '</div>';
  }

  function personLine(p, tag) {
    if (!p) return '';
    return '<div class="person">' +
      '<span class="person-av">' + esc(initials(p.name)) + '</span>' +
      '<span class="person-txt"><span class="person-n">' + esc(p.name) + '</span>' +
      '<span class="person-r">' + esc(p.post || p.role || '') + '</span></span>' +
      (tag ? '<span class="person-tag">' + esc(tag) + '</span>' : '') +
    '</div>';
  }

  function docList(docs) {
    if (!docs || !docs.length) return '<div class="empty">Документов нет</div>';
    return '<div class="docs">' + docs.map(function (d) {
      return '<button type="button" class="doc">' +
        '<span class="doc-ext ' + esc(d.ext) + '">' + esc(d.ext) + '</span>' +
        '<span class="doc-main"><span class="doc-n">' + esc(d.name) + '</span>' +
        '<span class="doc-m">' + esc(d.size) + ' · ' + esc(fmtDate(d.date)) + '</span></span>' +
        '<span class="doc-dl"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v10m0 0 4-4m-4 4-4-4M5 18h14" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg></span>' +
      '</button>';
    }).join('') + '</div>';
  }

  function statusPill(meta) {
    if (!meta) return '';
    return '<span class="pill-tone ' + toneCls(meta.tone) + '"><span class="sr-dot" style="background:currentColor"></span>' + esc(meta.label) + '</span>';
  }

  /* ── Модалка тендера ──────────────────────────────────────────────────── */
  var TENDER_TABS = [
    { id: 'summary', label: 'Сводка' },
    { id: 'calc', label: 'Просчёт РП' },
    { id: 'estimate', label: 'Смета' },
    { id: 'checklist', label: 'Чек-лист' },
    { id: 'report', label: 'Отчёт РП' },
    { id: 'docs', label: 'Документы' }
  ];

  function tenderSub(t) {
    var st = statusMeta(M.TENDER_STATUSES, t.registry_status);
    return statusPill(st) +
      '<span class="dotsep">·</span><span>' + esc(t.platform) + '</span>' +
      '<span class="dotsep">·</span><span>' + esc(t.customer) + '</span>';
  }

  function tenderBody(t) {
    if (state.tab === 'calc') {
      var c = t.rp_calc;
      var decision = c.decision === 'submit'
        ? '<span class="badge ok">Подавать</span>'
        : '<span class="badge err">Не подавать</span>';
      var main =
        deadlineBanner(t.deadline, { status: t.registry_status }) +
        block('Кто и что посчитал',
          '<div class="people">' + personLine(c.who, String(c.kind).toUpperCase()) + '</div>' +
          kv([
            kvRow('Роль в просчёте', c.kind === 'pm' ? 'Промышленный просчёт (TO/PM)' : 'Сервис и ТО (TO)'),
            kvRow('Цена работ', rub(c.work_price) + ' <span class="muted">без НДС</span>'),
            kvRow('Себестоимость', rub(c.cost)),
            kvRow('Маржа', pct(c.margin_pct) + ' <span class="muted">· ' + rub(c.margin_rub) + '</span>'),
            kvRow('Решение', decision),
            kvRow('Дата финализации', fmtDate(c.finalized_at))
          ]), decision) +
        block('Рекомендация калькулятора',
          '<div class="report">' + esc(c.recommendation) + '</div>');

      var side =
        sideCard('Цена работ без НДС', esc(compact(c.work_price).v) + '<span class="unit" style="font-size:13px;color:var(--tx-3);margin-left:3px">' + esc(compact(c.work_price).u) + '</span>', '', 'канон: цена без НДС', [
          ['НМЦК', esc(moneyShort(t.nmck))],
          ['Себестоимость', esc(moneyShort(c.cost))],
          ['Маржа', esc(pct(c.margin_pct))],
          ['Доля цены от НМЦК', esc(pct((c.work_price / t.nmck) * 100))]
        ]) +
        sideCard('Аналитик', esc(initials(t.analyzer.name)), '', t.analyzer.name,
          [['Площадка', esc(t.platform)], ['Регион', esc(t.region)]]);

      return '<div class="split"><div class="split-main">' + main + '</div><div class="split-side">' + side + '</div></div>';
    }

    if (state.tab === 'estimate') {
      var est = t.estimate;
      var rows = est.rows.map(function (r, i) {
        return '<tr>' +
          '<td>' + (i + 1) + '. ' + esc(r.name) + '<span class="sub">' + esc(r.unit) + '</span></td>' +
          '<td class="num">' + num(r.qty) + ' <span class="sub" style="display:inline">' + esc(r.unit) + '</span></td>' +
          '<td class="num">' + rub(r.sum) + '</td>' +
          '<td class="num">' + rub(r.cost) + '</td>' +
          '<td class="num pct' + (r.margin_pct >= 20 ? '' : r.margin_pct >= 14 ? ' low' : ' bad') + '">' + pct(r.margin_pct) + '</td>' +
        '</tr>';
      }).join('');

      var table = '<div class="tbl-wrap"><table class="tbl">' +
        '<thead><tr><th>Позиция</th><th class="num">Кол-во</th><th class="num">Сумма</th><th class="num">Себест.</th><th class="num">Маржа</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
        '<tfoot><tr><td>Итого</td><td class="num">' + est.rows.length + ' поз.</td>' +
          '<td class="num">' + rub(est.total_no_vat) + '</td>' +
          '<td class="num">' + rub(est.cost_total) + '</td>' +
          '<td class="num pct' + (est.margin_pct >= 20 ? '' : est.margin_pct >= 14 ? ' low' : ' bad') + '">' + pct(est.margin_pct) + '</td></tr></tfoot>' +
        '</table></div>';

      var totals = '<div class="totals">' +
        '<div class="totals-row"><span class="k">Без НДС</span><span class="v">' + rub(est.total_no_vat) + '</span></div>' +
        '<div class="totals-row"><span class="k">НДС 20 %</span><span class="v">' + rub(est.vat) + '</span></div>' +
        '<div class="totals-row grand"><span class="k">С НДС</span><span class="v">' + rub(est.total_with_vat) + '</span></div>' +
        '<div class="totals-row accent"><span class="k">Маржа</span><span class="v">' + rub(est.margin_rub) + ' · ' + pct(est.margin_pct) + '</span></div>' +
      '</div>';

      var side = sideCard('Цена работ без НДС', esc(compact(est.total_no_vat).v) +
        '<span class="unit" style="font-size:13px;color:var(--tx-3);margin-left:3px">' + esc(compact(est.total_no_vat).u) + '</span>',
        '', 'ндс начисляется сверху', [
          ['Позиций', String(est.rows.length)],
          ['Себестоимость', esc(moneyShort(est.cost_total))],
          ['Маржа', esc(pct(est.margin_pct))],
          ['НДС 20 %', esc(moneyShort(est.vat))]
        ]) +
        sideCard('Сверка с НМЦК', esc(pct((est.total_no_vat / t.nmck) * 100)), 'warn', 'доля цены работ от НМЦК',
          [['НМЦК', esc(moneyShort(t.nmck))], ['Запас', esc(moneyShort(t.nmck - est.total_no_vat))]]);

      return '<div class="split"><div class="split-main">' + block('Смета Асгард · ' + est.rows.length + ' позиций', table + totals) +
        '</div><div class="split-side">' + side + '</div></div>';
    }

    if (state.tab === 'checklist') {
      var done = t.checklist.filter(function (x) { return x.done; }).length;
      var items = t.checklist.map(function (c) {
        var when = c.done ? fmtDate(c.date) : (c.due ? 'до ' + fmtDate(c.due) : '—');
        return '<div class="check-item' + (c.done ? ' done' : '') + '">' +
          '<span class="check-box">' + (c.done ? '✓' : '') + '</span>' +
          '<span class="check-txt">' + esc(c.text) + '</span>' +
          '<span class="check-when' + (c.done ? '' : ' pending') + '">' + esc(when) + '</span>' +
        '</div>';
      }).join('');

      return '<div class="split"><div class="split-main">' +
        block('Чек-лист анализа', '<div class="checklist">' + items + '</div>',
          '<span class="badge neutral">' + done + ' / ' + t.checklist.length + '</span>') +
        '</div><div class="split-side">' +
        sideCard('Готовность', done + ' / ' + t.checklist.length, done === t.checklist.length ? 'ok' : 'warn',
          done === t.checklist.length ? 'все пункты закрыты' : 'осталось ' + (t.checklist.length - done) + ' пункт(а)') +
        sideCard('Ответственные', esc(initials(t.calculator.name)), '', t.calculator.name + ' · калькулятор',
          [['Аналитик', esc(t.analyzer.name)], ['РП', esc(t.pm.name)]]) +
        '</div></div>';
    }

    if (state.tab === 'report') {
      var r = t.report;
      var badge = r.decision === 'submit'
        ? '<span class="badge ok">Согласовано · подавать</span>'
        : '<span class="badge err">Отказ</span>';
      return '<div class="split"><div class="split-main">' +
        block('Заключение РП', '<div class="report">' + esc(r.text) + '</div>' +
          '<div class="report-meta"><span>' + esc(r.author) + ' · РП</span><span>' + esc(fmtDate(r.date)) + '</span></div>', badge) +
        '</div><div class="split-side">' +
        sideCard('Решение', r.decision === 'submit' ? 'Подавать' : 'Не подавать', r.decision === 'submit' ? 'ok' : 'err',
          r.decision === 'submit' ? 'заключение положительное' : 'заключение отрицательное') +
        sideCard('Кто в контуре', esc(initials(t.pm.name)), '', t.pm.name + ' · РП', [
          ['Калькулятор', esc(t.calculator.name)],
          ['Аналитик', esc(t.analyzer.name)]
        ]) +
        '</div></div>';
    }

    if (state.tab === 'docs') {
      return block('Документы процедуры', docList(t.docs),
        '<span class="badge neutral">' + t.docs.length + ' файла</span>');
    }

    /* Сводка */
    var st = statusMeta(M.TENDER_STATUSES, t.registry_status);
    var form = t.registry_status === 'выиграли' || t.registry_status === 'проиграли' || t.registry_status === 'отмена'
      ? 'закрыт' : 'в работе';
    var main =
      deadlineBanner(t.deadline, { status: t.registry_status }) +
      block('Паспорт процедуры', kv([
        kvRow('Заказчик', esc(t.customer)),
        kvRow('ИНН', '<span class="mono">' + esc(t.inn) + '</span>'),
        kvRow('Площадка', esc(t.platform) + ' <a href="' + esc(t.link) + '" target="_blank" rel="noopener">открыть ↗</a>'),
        kvRow('Извещение', '<span class="mono">' + esc(t.notice) + '</span>'),
        kvRow('НМЦК', rub(t.nmck)),
        kvRow('Цена работ', '<b>' + rub(t.work_price) + '</b> <span class="muted">без НДС</span>'),
        kvRow('Дедлайн', fmtDate(t.deadline) + ' <span class="muted">· ' + esc(deadlineText(t.deadline)) + '</span>'),
        kvRow('Реестр / тендер', statusPill(st) + ' <span class="muted">· ' + esc(t.tender_status) + '</span>'),
        kvRow('Регион', esc(t.region))
      ])) +
      outcomeBlock(t.outcome) +
      auditBlock([
        { name: t.added_by && t.added_by.name, role: 'Добавил тендер', at: t.added_by && t.added_by.at },
        { name: t.analyzed_by && t.analyzed_by.name, role: 'Анализировал', at: t.analyzed_by && t.analyzed_by.at },
        { name: t.calculated_by && t.calculated_by.name, role: 'Считал просчёт', at: t.calculated_by && t.calculated_by.at },
        { name: t.pm.name, role: 'Ответственный РП', at: t.date }
      ]);

    var d = daysLeft(t.deadline);
    var side =
      sideCard('Цена работ без НДС', esc(compact(t.work_price).v) +
        '<span class="unit" style="font-size:13px;color:var(--tx-3);margin-left:3px">' + esc(compact(t.work_price).u) + '</span>',
        '', 'смета Асгард · ' + t.estimate.rows.length + ' позиций', [
          ['НМЦК', esc(moneyShort(t.nmck))],
          ['Маржа сметы', esc(pct(t.estimate.margin_pct))],
          ['Маржа, ₽', esc(moneyShort(t.estimate.margin_rub))]
        ]) +
      sideCard('Дедлайн', d === null ? '—' : Math.abs(d) + ' ' + daysWord(d), d === null ? '' : d < 0 ? 'err' : d <= 5 ? 'warn' : 'ok',
        fmtDate(t.deadline) + ' · ' + deadlineText(t.deadline)) +
      sideCard('Статус', esc(st.label), '', t.tender_status + ' · ' + form, [
        ['Чек-лист', t.checklist.filter(function (x) { return x.done; }).length + ' / ' + t.checklist.length],
        ['Документов', String(t.docs.length)],
        ['Заведён', esc(fmtDate(t.date))]
      ]);

    return '<div class="split"><div class="split-main">' + main + '</div><div class="split-side">' + side + '</div></div>';
  }

  /* ── Модалка заявки ───────────────────────────────────────────────────── */
  var APP_TABS = [
    { id: 'summary', label: 'Сводка' },
    { id: 'estimate', label: 'Просчёт' },
    { id: 'history', label: 'История' },
    { id: 'docs', label: 'Документы' }
  ];

  function appBody(a) {
    if (state.tab === 'estimate') {
      if (!a.estimate) {
        return '<div class="empty" style="padding:40px 0">Просчёт по заявке ещё не создан.<br>Калькулятор закрепляется автоматически при переходе в статус «Просчёт».</div>';
      }
      var e = a.estimate;
      var rows = e.rows.map(function (r, i) {
        return '<tr><td>' + (i + 1) + '. ' + esc(r.name) + '<span class="sub">' + esc(r.unit) + '</span></td>' +
          '<td class="num">' + num(r.qty) + '</td>' +
          '<td class="num">' + rub(r.sum) + '</td>' +
          '<td class="num">' + rub(r.cost) + '</td></tr>';
      }).join('');
      var totals = '<div class="totals">' +
        '<div class="totals-row"><span class="k">Без НДС</span><span class="v">' + rub(e.total_no_vat) + '</span></div>' +
        '<div class="totals-row"><span class="k">НДС 20 %</span><span class="v">' + rub(e.vat) + '</span></div>' +
        '<div class="totals-row grand"><span class="k">С НДС</span><span class="v">' + rub(e.total_with_vat) + '</span></div>' +
        '<div class="totals-row accent"><span class="k">Маржа</span><span class="v">' + pct(e.margin_pct) + '</span></div>' +
      '</div>';

      return '<div class="split"><div class="split-main">' +
        block(e.title,
          '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Позиция</th><th class="num">Кол-во</th><th class="num">Сумма</th><th class="num">Себест.</th></tr></thead><tbody>' +
          rows + '</tbody></table></div>' + totals) +
        '</div><div class="split-side">' +
        sideCard('Сумма без НДС', esc(compact(e.total_no_vat).v) +
          '<span class="unit" style="font-size:13px;color:var(--tx-3);margin-left:3px">' + esc(compact(e.total_no_vat).u) + '</span>', '',
          'позиций: ' + e.rows.length, [
            ['Себестоимость', esc(moneyShort(e.cost_total))],
            ['Маржа', esc(pct(e.margin_pct))],
            ['НДС 20 %', esc(moneyShort(e.vat))]
          ]) +
        '</div></div>';
    }

    if (state.tab === 'history') {
      var items = a.history.map(function (h, i) {
        var meta = statusMeta(M.APP_STATUSES, h.status);
        var last = i === a.history.length - 1;
        return '<div class="tl-item' + (last ? ' is-last' : '') + '">' +
          '<span class="tl-dot"></span>' +
          '<div class="tl-head"><span class="tl-status">' + esc(meta ? meta.label : h.status) + '</span>' +
          '<span class="tl-date">' + esc(fmtDate(h.at)) + '</span></div>' +
          '<div class="tl-note">' + esc(h.note) + '</div>' +
          '<div class="tl-by">' + esc(h.by) + '</div>' +
        '</div>';
      }).join('');
      return '<div class="split"><div class="split-main">' +
        block('История статусов', '<div class="timeline">' + items + '</div>',
          '<span class="badge neutral">' + a.history.length + ' событий</span>') +
        '</div><div class="split-side">' +
        sideCard('Текущий статус', esc((statusMeta(M.APP_STATUSES, a.status) || {}).label || a.status), '',
          'создана ' + fmtDate(a.created), [
            ['Событий', String(a.history.length)],
            ['Дедлайн', a.deadline ? esc(fmtDate(a.deadline)) : '—']
          ]) +
        '</div></div>';
    }

    if (state.tab === 'docs') {
      return block('Документы заявки', docList(a.docs),
        '<span class="badge neutral">' + a.docs.length + ' файла</span>');
    }

    /* Сводка */
    var st = statusMeta(M.APP_STATUSES, a.status);
    var ai = a.ai;
    var colorLabel = ai.color === 'green' ? 'зелёный' : ai.color === 'amber' ? 'жёлтый' : 'красный';

    var aiCard = '<div class="ai-card">' +
      '<div class="ai-top">' +
        '<span class="ai-num">AI-разбор</span>' +
        '<span class="badge ' + (ai.color === 'green' ? 'ok' : ai.color === 'amber' ? 'warn' : 'err') + '">' + esc(colorLabel) + '</span>' +
      '</div>' +
      '<div class="ai-meter">' +
        '<span class="ai-bar"><i class="' + esc(ai.color) + '" style="width:' + Math.round(ai.confidence * 100) + '%"></i></span>' +
        '<span class="ai-num">' + Math.round(ai.confidence * 100) + ' %</span>' +
      '</div>' +
      '<div class="ai-sum">' + esc(ai.summary) + '</div>' +
    '</div>';

    var main =
      deadlineBanner(a.deadline, { status: statusMeta(M.APP_STATUSES, a.status).label }) +
      block('AI-разбор письма', aiCard) +
      block('Паспорт заявки', kv([
        kvRow('Заказчик', esc(a.customer)),
        kvRow('Отправитель', esc(a.sender.name) + ' <span class="muted">· ' + esc(a.sender.org) + '</span>'),
        kvRow('Контакт', '<span class="mono">' + esc(a.sender.addr) + '</span>'),
        kvRow('Канал', esc(M.CHANNELS[a.channel] || a.channel)),
        kvRow('Создана', fmtDate(a.created)),
        kvRow('Дедлайн', a.deadline ? fmtDate(a.deadline) + ' <span class="muted">· ' + esc(deadlineText(a.deadline)) + '</span>' : '—'),
        kvRow('Статус', statusPill(st)),
        kvRow('Назначенный РП', a.pm ? esc(a.pm.name) : '<span class="muted">не назначен</span>'),
        kvRow('Просчёт', a.estimate ? '<b>' + esc(a.estimate.title) + '</b> · ' + rub(a.estimate.total_no_vat) + ' <span class="muted">без НДС</span>' : '<span class="muted">не создан</span>')
      ])) +
      outcomeBlock(a.outcome) +
      auditBlock([
        { name: a.added_by && a.added_by.name, role: 'Добавил заявку', at: a.added_by && a.added_by.at },
        { name: a.analyzed_by && a.analyzed_by.name, role: 'Анализировал / считал', at: a.analyzed_by && a.analyzed_by.at },
        { name: a.pm && a.pm.name, role: 'Назначенный РП', at: a.created }
      ]) +
      (a.note ? block('Комментарий', '<div class="report">' + esc(a.note) + '</div>') : '');

    var d = daysLeft(a.deadline);
    var side =
      sideCard('Оценка суммы', a.amount ? esc(compact(a.amount).v) +
        '<span class="unit" style="font-size:13px;color:var(--tx-3);margin-left:3px">' + esc(compact(a.amount).u) + '</span>' : '—',
        '', a.estimate ? 'смета: ' + moneyShort(a.estimate.total_no_vat) : 'смета не создана') +
      sideCard('Дедлайн', d === null ? '—' : Math.abs(d) + ' ' + daysWord(d),
        d === null ? '' : d < 0 ? 'err' : d <= 3 ? 'warn' : 'ok',
        a.deadline ? fmtDate(a.deadline) : 'без срока') +
      sideCard('В контуре', String(a.history.length), '', 'событий по заявке', [
        ['Документов', String(a.docs.length)],
        ['AI', colorLabel + ' · ' + Math.round(ai.confidence * 100) + ' %']
      ]);

    return '<div class="split"><div class="split-main">' + main + '</div><div class="split-side">' + side + '</div></div>';
  }

  /* ── Модалка работы ───────────────────────────────────────────────────── */
  var WORK_TABS = [
    { id: 'summary', label: 'Сводка' },
    { id: 'finance', label: 'Финансы' },
    { id: 'timesheet', label: 'Табель' },
    { id: 'brigade', label: 'Бригада' },
    { id: 'checkins', label: 'Чекины' }
  ];

  var MONTH_IDX = {
    'Январь': 0, 'Февраль': 1, 'Март': 2, 'Апрель': 3, 'Май': 4, 'Июнь': 5,
    'Июль': 6, 'Август': 7, 'Сентябрь': 8, 'Октябрь': 9, 'Ноябрь': 10, 'Декабрь': 11
  };

  function monthBounds(label) {
    var parts = String(label).split(' ');
    var idx = MONTH_IDX[parts[0]];
    var year = Number(parts[1]);
    if (idx == null || !year) return null;
    return { first: new Date(year, idx, 1), last: new Date(year, idx + 1, 0) };
  }

  function timesheetData(w) {
    var ts = w.timesheet;
    var months = ts.window.map(function (m, i) {
      var days = 0, sum = 0;
      ts.persons.forEach(function (p) {
        var mm = p.months[i];
        days += mm.days;
        sum += mm.days * mm.rate;
      });
      return {
        label: m.label,
        short: m.short,
        days: days,
        sum: sum,
        rate: days ? sum / days : 0
      };
    });

    var persons = ts.persons.map(function (p) {
      var days = 0, sum = 0;
      p.months.forEach(function (m) {
        days += m.days;
        sum += m.days * m.rate;
      });
      return {
        name: p.name,
        role: p.role,
        rate: p.rate,
        arrive: p.arrive,
        leave: p.leave,
        months: p.months,
        days: days,
        sum: sum
      };
    });

    var totalDays = persons.reduce(function (a, p) { return a + p.days; }, 0);
    var totalSum = persons.reduce(function (a, p) { return a + p.sum; }, 0);

    return { months: months, persons: persons, totalDays: totalDays, totalSum: totalSum };
  }

  function timesheetBody(w) {
    var d = timesheetData(w);

    var head = '<div class="ts-head">' +
      '<div class="ts-totals">' +
        '<div class="ts-total"><div class="ts-total-cap">Человеко-дней</div><div class="ts-total-val">' + num(d.totalDays) + '</div></div>' +
        '<div class="ts-total"><div class="ts-total-cap">Начислено</div><div class="ts-total-val accent">' + rub(d.totalSum) + '</div></div>' +
        '<div class="ts-total"><div class="ts-total-cap">В бригаде</div><div class="ts-total-val">' + d.persons.length + ' чел.</div></div>' +
        '<div class="ts-total"><div class="ts-total-cap">Средняя ставка</div><div class="ts-total-val">' + rub(d.totalDays ? d.totalSum / d.totalDays : 0) + '</div></div>' +
      '</div>' +
      '<span class="badge neutral">' + w.timesheet.window[0].short + ' — ' + w.timesheet.window[w.timesheet.window.length - 1].short + '</span>' +
    '</div>';

    /* 1. По месяцам */
    var monthRows = d.months.map(function (m) {
      return '<tr' + (m.days ? '' : ' class="is-empty"') + '>' +
        '<td class="month">' + esc(m.label) + '</td>' +
        '<td class="num days">' + (m.days ? m.days : '—') + '</td>' +
        '<td class="num rate">' + (m.days ? rub(m.rate) : '—') + '</td>' +
        '<td class="num sum">' + (m.sum ? rub(m.sum) : '—') + '</td>' +
      '</tr>';
    }).join('');

    var monthTable = '<div class="ts-block">' +
      '<table class="ts"><thead><tr><th>Месяц</th><th class="num">Дней</th><th class="num">Ставка</th><th class="num">Начислено</th></tr></thead>' +
      '<tbody>' + monthRows + '</tbody>' +
      '<tfoot><tr class="total-row"><td>Итого за период</td><td class="num">' + num(d.totalDays) + '</td>' +
        '<td class="num">' + rub(d.totalDays ? d.totalSum / d.totalDays : 0) + '</td>' +
        '<td class="num">' + rub(d.totalSum) + '</td></tr></tfoot></table>' +
    '</div>';

    /* 2. По людям */
    var personRows = d.persons.map(function (p) {
      return '<tr>' +
        '<td><b>' + esc(p.name) + '</b><span class="sub">' + esc(p.role) + ' · ' + esc(shortDate(p.arrive)) + ' — ' + esc(shortDate(p.leave)) + '</span></td>' +
        '<td class="num days">' + p.days + '</td>' +
        '<td class="num rate">' + rub(p.rate) + '</td>' +
        '<td class="num sum">' + rub(p.sum) + '</td>' +
      '</tr>';
    }).join('');

    var personTable = '<div class="ts-block">' +
      '<div class="ts-sub"><span>Сводка по людям</span><span class="mono">дни × ставка = начислено</span></div>' +
      '<table class="ts"><thead><tr><th>ФИО</th><th class="num">Дней</th><th class="num">Ставка</th><th class="num">Начислено</th></tr></thead>' +
      '<tbody>' + personRows + '</tbody></table>' +
    '</div>';

    /* 3. Таймлайн заезд/выезд */
    var winStart = null, winEnd = null;
    w.timesheet.window.forEach(function (m) {
      var b = monthBounds(m.label);
      if (!b) return;
      if (!winStart || b.first < winStart) winStart = b.first;
      if (!winEnd || b.last > winEnd) winEnd = b.last;
    });

    var spanRows = '';
    if (winStart && winEnd) {
      var span = winEnd - winStart || 1;
      spanRows = d.persons.map(function (p) {
        var a = new Date(p.arrive + 'T12:00:00');
        var b2 = new Date(p.leave + 'T12:00:00');
        var left = Math.max(0, Math.min(100, ((a - winStart) / span) * 100));
        var width = Math.max(2, Math.min(100 - left, ((b2 - a) / span) * 100));
        return '<div class="span-row">' +
          '<span class="span-name" title="' + esc(p.name) + '">' + esc(p.name.split(' ')[0]) + ' ' + esc((p.name.split(' ')[1] || '').slice(0, 1)) + '.</span>' +
          '<span class="span-track"><span class="span-fill" style="left:' + left.toFixed(2) + '%;width:' + width.toFixed(2) + '%"></span></span>' +
          '<span class="span-dates">' + esc(shortDate(p.arrive)) + ' — ' + esc(shortDate(p.leave)) + '</span>' +
        '</div>';
      }).join('');
    }

    var axis = w.timesheet.window.map(function (m) {
      return '<span>' + esc(m.short) + '</span>';
    }).join('');

    var timeline = '<div class="span-line">' +
      '<div class="span-cap">Заезд → выезд по месяцам</div>' +
      spanRows +
      '<div class="span-axis">' + axis + '</div>' +
    '</div>';

    return head + monthTable +
      block('Сводка по людям', personTable) +
      block('График заездов', timeline);
  }

  function workBody(w) {
    if (state.tab === 'finance') {
      var f = {
        contract: w.contract,
        cost: w.cost,
        margin: w.margin_rub,
        marginPct: w.margin_pct,
        paid: w.paid,
        spent: w.spent,
        left: w.leftover
      };
      var grid = '<div class="fin-grid">' +
        '<div class="fin-cell"><div class="fin-cap">Контракт</div><div class="fin-val">' + rub(f.contract) + '</div></div>' +
        '<div class="fin-cell"><div class="fin-cap">Себестоимость</div><div class="fin-val">' + rub(f.cost) + '</div></div>' +
        '<div class="fin-cell"><div class="fin-cap">Маржа</div><div class="fin-val ' + (f.marginPct >= 20 ? 'ok' : f.marginPct >= 12 ? 'warn' : 'err') + '">' + rub(f.margin) + ' · ' + pct(f.marginPct) + '</div></div>' +
        '<div class="fin-cell"><div class="fin-cap">Оплачено</div><div class="fin-val">' + rub(f.paid) + '</div></div>' +
        '<div class="fin-cell"><div class="fin-cap">Остаток к оплате</div><div class="fin-val">' + rub(f.left) + '</div></div>' +
        '<div class="fin-cell"><div class="fin-cap">Расходы факт</div><div class="fin-val">' + rub(f.spent) + '</div></div>' +
      '</div>';

      var paidPct = f.contract ? Math.min(100, (f.paid / f.contract) * 100) : 0;
      var costPct = f.contract ? Math.min(100, (f.spent / f.contract) * 100) : 0;

      var prog = '<div class="prog"><div class="prog-bar"><i style="width:' + paidPct.toFixed(1) + '%"></i></div>' +
        '<div class="prog-cap"><span>Оплачено ' + pct(paidPct) + '</span><span>' + rub(f.paid) + ' из ' + rub(f.contract) + '</span></div></div>' +
        '<div class="prog"><div class="prog-bar"><i style="width:' + costPct.toFixed(1) + '%;background:var(--tx-3)"></i></div>' +
        '<div class="prog-cap"><span>Израсходовано ' + pct(costPct) + '</span><span>' + rub(f.spent) + '</span></div></div>';

      var side = sideCard('Маржа по договору', pct(f.marginPct),
        f.marginPct >= 20 ? 'ok' : f.marginPct >= 12 ? 'warn' : 'err', rub(f.margin) + ' валовой прибыли', [
          ['Контракт', esc(moneyShort(f.contract))],
          ['Себестоимость', esc(moneyShort(f.cost))],
          ['Оплачено', esc(moneyShort(f.paid))],
          ['Остаток', esc(moneyShort(f.left))]
        ]) +
        sideCard('Исполнение', w.fact_pct + ' %', w.schedule_light === 'ok' ? 'ok' : w.schedule_light === 'warn' ? 'warn' : 'err',
          'план ' + w.plan_pct + ' % на текущую дату');

      return '<div class="split"><div class="split-main">' + block('Финансы договора', grid) +
        block('Оплаты и расходы', prog) +
        '</div><div class="split-side">' + side + '</div></div>';
    }

    if (state.tab === 'timesheet') {
      return timesheetBody(w);
    }

    if (state.tab === 'brigade') {
      var rows = w.brigade.map(function (p) {
        var person = w.timesheet.persons.filter(function (x) { return x.name === p.name; })[0];
        var arrive = person ? person.arrive : null;
        var leave = person ? person.leave : null;
        var days = person ? person.months.reduce(function (a, m) { return a + m.days; }, 0) : 0;
        return '<div class="brig-person">' +
          '<span class="brig-av">' + esc(initials(p.name)) + '</span>' +
          '<span><span class="brig-n">' + esc(p.name) + '</span><span class="brig-r">' + esc(p.role) + '</span></span>' +
          '<span class="brig-rate">' + rub(p.rate) + ' / смена<span class="brig-r" style="display:block;text-align:right">' + days + ' дн.</span></span>' +
          '<span class="brig-dates">' + (arrive ? esc(shortDate(arrive)) + ' — ' + esc(shortDate(leave)) : '—') + '</span>' +
        '</div>';
      }).join('');

      return '<div class="split"><div class="split-main">' +
        block('Бригада на объекте', '<div class="brigade">' + rows + '</div>',
          '<span class="badge neutral">' + w.brigade.length + ' чел.</span>') +
        '</div><div class="split-side">' +
        sideCard('Бригадир', esc(initials(w.lead)), '', w.lead,
          [['РП', esc(w.pm.name)], ['Регион', esc(w.region)]]) +
        '</div></div>';
    }

    if (state.tab === 'checkins') {
      var list = w.checkins.map(function (c) {
        return '<div class="check-row">' +
          '<span class="check-date">' + esc(fmtDate(c.at)) + '</span>' +
          '<span class="check-kind ' + (c.ok ? 'ok' : 'warn') + '">' + esc(c.kind) + '</span>' +
          '<span class="check-note">' + esc(c.ok ? 'Подтверждено' : 'Без фото · требует внимания') +
            '<small>' + esc(c.who) + ' · ' + esc(c.note) + '</small></span>' +
        '</div>';
      }).join('');

      var okCount = w.checkins.filter(function (c) { return c.ok; }).length;

      return '<div class="split"><div class="split-main">' +
        block('Последние чекины', '<div class="checks">' + list + '</div>',
          '<span class="badge ' + (okCount === w.checkins.length ? 'ok' : 'warn') + '">' + okCount + ' / ' + w.checkins.length + ' ок</span>') +
        '</div><div class="split-side">' +
        sideCard('Дисциплина', pct((okCount / w.checkins.length) * 100), okCount === w.checkins.length ? 'ok' : 'warn',
          'чекинов с подтверждением') +
        '</div></div>';
    }

    /* Сводка работы */
    var lightText = w.schedule_light === 'ok' ? 'Укладываемся в график'
      : w.schedule_light === 'warn' ? 'Небольшое отставание'
        : 'Отставание от графика';

    var light = '<div class="light-card ' + w.schedule_light + '">' +
      '<span class="light-lamp"></span>' +
      '<span class="light-txt"><span class="light-t">' + esc(lightText) + '</span>' +
      '<span class="light-s">факт ' + w.fact_pct + ' % · план ' + w.plan_pct + ' % · Δ ' +
        (w.fact_pct - w.plan_pct > 0 ? '+' : '') + (w.fact_pct - w.plan_pct) + ' п.п.</span></span>' +
    '</div>';

    var main =
      block('Паспорт объекта', kv([
        kvRow('Заказчик', esc(w.customer)),
        kvRow('Объект', esc(w.object)),
        kvRow('Адрес', esc(w.address)),
        kvRow('Договор', '<span class="mono">' + esc(w.contract_no) + '</span>'),
        kvRow('РП', esc(w.pm.name)),
        kvRow('Бригадир', esc(w.lead)),
        kvRow('Старт', fmtDate(w.start)),
        kvRow(w.closed ? 'Закрыт' : 'Плановое окончание', fmtDate(w.closed || w.due)),
        kvRow('Фаза', statusPill(statusMeta(M.WORK_STATUSES, w.phase)))
      ])) +
      block('Светофор сроков', light) +
      (w.pause_reason ? block('Причина паузы', '<div class="report">' + esc(w.pause_reason) + '</div>') : '');

    var side =
      sideCard('Контракт', esc(compact(w.contract).v) +
        '<span class="unit" style="font-size:13px;color:var(--tx-3);margin-left:3px">' + esc(compact(w.contract).u) + '</span>',
        '', 'маржа ' + pct(w.margin_pct), [
          ['Себестоимость', esc(moneyShort(w.cost))],
          ['Оплачено', esc(moneyShort(w.paid))],
          ['Остаток', esc(moneyShort(w.leftover))]
        ]) +
      sideCard('Бригада', w.brigade.length + ' чел.', '', 'человеко-дней: ' + timesheetData(w).totalDays) +
      sideCard('Табель', rub(timesheetData(w).totalSum), 'warn', 'начислено за период');

    return '<div class="split"><div class="split-main">' + main + '</div><div class="split-side">' + side + '</div></div>';
  }

  /* ── Открытие / закрытие модалки ──────────────────────────────────────── */
  function openModal(section, id) {
    var item = findItem(section, id);
    if (!item) return;

    state.modal = { section: section, id: id };
    state.tab = (section === 'tenders' ? TENDER_TABS : section === 'applications' ? APP_TABS : WORK_TABS)[0].id;

    renderModal();
    el.modalRoot.hidden = false;
    requestAnimationFrame(positionTabsInd);

    var closeBtn = el.modal.querySelector('.modal-close');
    if (closeBtn && state.vp === 'desktop') closeBtn.focus({ preventScroll: true });
  }

  function renderModal() {
    if (!state.modal) return;
    var section = state.modal.section;
    var item = findItem(section, state.modal.id);
    if (!item) return;

    var html;
    if (section === 'tenders') {
      html = modalShell({
        kicker: 'Тендер',
        id: item.id,
        title: item.title,
        sub: tenderSub(item),
        tabs: TENDER_TABS,
        body: function () { return tenderBody(item); }
      });
    } else if (section === 'applications') {
      html = modalShell({
        kicker: 'Заявка',
        id: item.id,
        title: item.title,
        sub: statusPill(statusMeta(M.APP_STATUSES, item.status)) +
          '<span class="dotsep">·</span><span>' + esc(item.customer) + '</span>' +
          '<span class="dotsep">·</span><span>' + esc(M.CHANNELS[item.channel] || item.channel) + '</span>',
        tabs: APP_TABS,
        body: function () { return appBody(item); }
      });
    } else {
      html = modalShell({
        kicker: 'Работа',
        id: item.id,
        title: item.title,
        sub: statusPill(statusMeta(M.WORK_STATUSES, item.phase)) +
          '<span class="dotsep">·</span><span>' + esc(item.customer) + '</span>' +
          '<span class="dotsep">·</span><span class="mono">' + esc(item.contract_no) + '</span>',
        tabs: WORK_TABS,
        body: function () { return workBody(item); }
      });
    }

    el.modal.innerHTML = html;
    requestAnimationFrame(positionTabsInd);
  }

  function closeModal() {
    state.modal = null;
    el.modalRoot.hidden = true;
    el.modal.innerHTML = '';
  }

  /* ── Обработчики ──────────────────────────────────────────────────────── */
  document.addEventListener('click', function (e) {
    var t = e.target;

    var periodBtn = t.closest('[data-period]');
    if (periodBtn) {
      state.period = periodBtn.getAttribute('data-period');
      state.listPage = 1;
      renderPage();
      return;
    }

    var openListBtn = t.closest('[data-open-list]');
    if (openListBtn) {
      openList(
        openListBtn.getAttribute('data-open-list'),
        openListBtn.getAttribute('data-list-status') || 'all'
      );
      return;
    }

    if (t.closest('[data-back-overview]')) {
      closeList();
      return;
    }

    var listStatusBtn = t.closest('[data-list-status]');
    if (listStatusBtn && state.view === 'list') {
      state.listStatus = listStatusBtn.getAttribute('data-list-status');
      state.listPage = 1;
      renderPage();
      return;
    }

    var sortBtn = t.closest('[data-sort]');
    if (sortBtn) {
      state.listSort = sortBtn.getAttribute('data-sort');
      state.listPage = 1;
      renderPage();
      return;
    }

    var pageBtn = t.closest('[data-page]');
    if (pageBtn && !pageBtn.disabled) {
      var n = parseInt(pageBtn.getAttribute('data-page'), 10);
      if (Number.isFinite(n) && n > 0) {
        state.listPage = n;
        renderPage();
      }
      return;
    }

    var statusBtn = t.closest('[data-status]');
    if (statusBtn) {
      openList(statusBtn.getAttribute('data-section'), statusBtn.getAttribute('data-status'));
      return;
    }

    var rowBtn = t.closest('[data-item]');
    if (rowBtn) {
      openModal(rowBtn.getAttribute('data-section'), rowBtn.getAttribute('data-item'));
      return;
    }

    if (t.closest('[data-close-modal]')) {
      closeModal();
      return;
    }

    var tabBtn = t.closest('[data-tab]');
    if (tabBtn) {
      state.tab = tabBtn.getAttribute('data-tab');
      renderModal();
      var body = el.modal.querySelector('.modal-body');
      if (body) body.scrollTop = 0;
      return;
    }

    var themeBtn = t.closest('[data-theme-set]');
    if (themeBtn) {
      setTheme(themeBtn.getAttribute('data-theme-set'));
      return;
    }

    var vpBtn = t.closest('button[data-vp]');
    if (vpBtn) {
      setViewport(vpBtn.getAttribute('data-vp'));
      return;
    }

    var devBtn = t.closest('[data-device-set]');
    if (devBtn) {
      applyDevice(devBtn.getAttribute('data-device-set'));
      return;
    }

    var jump = t.closest('[data-jump]');
    if (jump) {
      var target = jump.getAttribute('data-jump');
      document.querySelectorAll('.m-tab').forEach(function (b) {
        b.classList.toggle('is-active', b === jump);
      });
      if (target === 'top') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        el.page.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (target === 'more') {
        var foot = document.querySelector('.page-foot');
        if (foot) foot.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        var sec2 = document.getElementById('sec-' + target);
        if (sec2) sec2.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }
  });

  document.addEventListener('input', function (e) {
    var s = e.target.closest('[data-list-search]');
    if (!s) return;
    state.listQuery = s.value;
    state.listPage = 1;
    var section = state.listSection;
    var all = listItems(section);
    var rowsEl = el.sections.querySelector('.rows--table');
    if (!rowsEl) return;
    var meta = statusMeta(statusesOf(section), state.listStatus);
    var from = 0;
    var pageItems = all.slice(0, PAGE_SIZE);
    rowsEl.innerHTML = pageItems.length
      ? pageItems.map(function (x) {
          return rowFor(section, x, statusMeta(statusesOf(section), x.registry_status || x.status || x.phase));
        }).join('')
      : '<div class="empty">Ничего не найдено. Измените фильтр или период.</div>';
    var info = el.sections.querySelector('.pg-info');
    if (info) info.textContent = all.length ? '1–' + Math.min(PAGE_SIZE, all.length) + ' из ' + all.length : '0 из 0';
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.modal) closeModal();
  });

  window.addEventListener('resize', function () {
    positionPeriodInd();
    if (state.modal) positionTabsInd();
  });

  /* Тема и viewport */
  function setTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelectorAll('[data-theme-set]').forEach(function (b) {
      var on = b.getAttribute('data-theme-set') === theme;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function setViewport(vp) {
    state.vp = vp;
    document.body.setAttribute('data-vp', vp);
    el.crm.setAttribute('data-vp', vp);
    el.stage.setAttribute('data-viewport', vp);
    el.stage.classList.toggle('stage--desktop', vp === 'desktop');
    el.stage.classList.toggle('stage--mobile', vp === 'mobile');
    document.querySelectorAll('button[data-vp]').forEach(function (b) {
      if (b.closest('#vpSwitch')) {
        var on = b.getAttribute('data-vp') === vp;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    });
    var dg = document.getElementById('deviceGroup');
    if (dg) dg.hidden = vp !== 'mobile';
    if (vp === 'mobile') applyDevice(state.device || 'iphone');
    requestAnimationFrame(function () {
      positionPeriodInd();
      if (state.modal) positionTabsInd();
    });
  }

  /* ── Устройства: iPhone · Z Fold (сложенный/раскрытый) · iPad ────────── */
  var DEVICES = {
    iphone: { name: 'iPhone 15 Pro', width: 393, spec: '393 × 852 · safe area 59 / 34', cls: 'iphone' },
    fold: { name: 'Samsung Z Fold 5', width: 344, spec: '344 × 882 · внешний экран', cls: 'fold' },
    'fold-open': { name: 'Samsung Z Fold 5 · раскрыт', width: 673, spec: '673 × 841 · внутренний экран', cls: 'fold-open' },
    ipad: { name: 'iPad Air', width: 834, spec: '834 × 1112 · планшет', cls: 'ipad' }
  };

  function applyDevice(key) {
    var d = DEVICES[key] || DEVICES.iphone;
    state.device = key;
    document.body.setAttribute('data-device', d.cls);
    document.documentElement.style.setProperty('--mob-w', d.width + 'px');
    el.stage.style.setProperty('--mob-w', d.width + 'px');
    var spec = document.getElementById('deviceSpec');
    if (spec) {
      spec.querySelector('.ds-name').textContent = d.name;
      spec.querySelector('.ds-size').textContent = d.spec;
    }
    document.querySelectorAll('[data-device-set]').forEach(function (b) {
      var on = b.getAttribute('data-device-set') === key;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    requestAnimationFrame(function () {
      positionPeriodInd();
      if (state.modal) positionTabsInd();
    });
  }

  /* Часы */
  function tickClock() {
    if (!el.clock) el.clock = document.getElementById('liveClock');
    if (!el.clock) return;
    var d = new Date();
    el.clock.textContent = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  /* ── Старт ────────────────────────────────────────────────────────────── */
  renderPage();
  setViewport('desktop');
  setInterval(tickClock, 30000);
})();
