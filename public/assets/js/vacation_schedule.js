/* ═══════════════════════════════════════════════════════════════════════════
   ASGARD CRM — График отпусков (офис). Ванильная страница.

   Порт утверждённого рендера prototypes/vacation-schedule на РЕАЛЬНЫЕ данные
   API /api/vacations (см. src/routes/vacations.js). Прототип: 76/76 PASS.

   Экраны: Мои дни · Согласование (директор) · Балансы дней (бухгалтерия) ·
   Документы (заявление / приказ Т-6 / график Т-7 / XLSX).
   Роут и подключение файла делает app.js/index.html (родитель).
   ═══════════════════════════════════════════════════════════════════════════ */
window.AsgardVacationSchedulePage = (function () {
  'use strict';

  var U = window.AsgardUI || {};
  var $ = U.$, $$ = U.$$, esc = U.esc || function (s) { return String(s == null ? '' : s); };
  var toast = U.toast || function () {};

  /* ── Группы отделов: порядок как в утверждённом макете (D.GROUPS) ─────── */
  var GROUPS = [
    { key: 'dir', title: 'Дирекция', roles: ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'] },
    { key: 'pm', title: 'Руководители проектов', roles: ['HEAD_PM', 'PM'] },
    { key: 'buh', title: 'Бухгалтерия', roles: ['BUH'] },
    { key: 'to', title: 'Тендерный отдел', roles: ['HEAD_TO', 'TO'] },
    { key: 'hr', title: 'Кадры', roles: ['HR_MANAGER', 'HR'] },
    { key: 'office', title: 'Офис и снабжение', roles: ['OFFICE_MANAGER', 'PROC', 'WAREHOUSE', 'CHIEF_ENGINEER'] }
  ];
  var FALLBACK_GROUP = 'office';

  var ROLE_RU = {
    DIRECTOR_GEN: 'Генеральный директор', DIRECTOR_COMM: 'Коммерческий директор',
    DIRECTOR_DEV: 'Директор по развитию', PM: 'Руководитель проектов', HEAD_PM: 'Главный РП',
    BUH: 'Бухгалтер', TO: 'Тендерный специалист', HEAD_TO: 'Руководитель тендерного отдела',
    HR: 'Кадры', HR_MANAGER: 'Директор по кадрам', OFFICE_MANAGER: 'Офис-менеджер',
    PROC: 'Закупки', WAREHOUSE: 'Кладовщик', CHIEF_ENGINEER: 'Главный инженер',
    ADMIN: 'Администратор', FIELD_WORKER: 'Полевой рабочий'
  };

  var ST = {
    approved: { label: 'Согласовано', short: 'согл.', cls: 'vs-st--ok' },
    pending: { label: 'Ждёт согласования', short: 'ждёт', cls: 'vs-st--pend' },
    rejected: { label: 'Не согласовано', short: 'отказ', cls: 'vs-st--bad' },
    cancelled: { label: 'Снят', short: 'снят', cls: 'vs-st--bad' },
    draft: { label: 'Черновик', short: 'черновик', cls: 'vs-st--draft' }
  };

  var MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  var MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  var WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
  var WEEKDAY_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  var MINI_W = '26px';

  /* ── Иконки: inline SVG, единый штрих (не эмодзи) ─────────────────────── */
  function svg(p) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
  }
  var IC = {
    cal: svg('<rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M3 9.5h18M8 3v3M16 3v3"/>'),
    eyeOff: svg('<path d="M3 3l18 18"/><path d="M10.6 5.2A9.9 9.9 0 0 1 12 5c5 0 9 4.5 9 7 0 .9-.5 2-1.4 3.1M6.2 6.5C3.9 8 2.3 10.3 2.3 12c0 2.5 4 7 9.7 7 1.5 0 2.9-.4 4.1-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
    eye: svg('<path d="M2.3 12C2.3 9.5 6.3 5 12 5s9.7 4.5 9.7 7-4 7-9.7 7-9.7-4.5-9.7-7Z"/><circle cx="12" cy="12" r="3"/>'),
    people: svg('<circle cx="9" cy="8" r="3.2"/><path d="M2.8 20a6.2 6.2 0 0 1 12.4 0"/><path d="M16.5 5.4a3.2 3.2 0 0 1 0 5.2M18 20h3.2a5.6 5.6 0 0 0-3.4-5.2"/>'),
    check: svg('<path d="M4.5 12.6l4.6 4.6L19.5 6.8"/>'),
    x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3.2 2"/>'),
    gift: svg('<rect x="3" y="8.5" width="18" height="12" rx="2.5"/><path d="M3 13h18M12 8.5V21M12 8.5S10.5 3 7.8 3.8 8.4 8.5 12 8.5s4.9-2.4 4.2-4.7S12 8.5 12 8.5Z"/>'),
    undo: svg('<path d="M9 7H5.5V3.5"/><path d="M5.9 7.2A8 8 0 1 1 4 12"/>'),
    board: svg('<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8.5 4V2.5M15.5 4V2.5M8 13.5h3M8 17h6"/>'),
    doc: svg('<path d="M6 2.8h7.5L18.5 8v13.2H6z"/><path d="M13.2 2.9V8h5.3M9 13h6M9 16.5h6"/>'),
    down: svg('<path d="M12 3.5v11M7.5 10.2 12 14.7l4.5-4.5M4.5 20h15"/>'),
    lock: svg('<rect x="4.5" y="10.5" width="15" height="10.5" rx="3"/><path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9"/>'),
    warn: svg('<path d="M12 3.6 21 19.5H3z"/><path d="M12 9.2v4.4M12 16.6h.01"/>'),
    ok: svg('<circle cx="12" cy="12" r="9"/><path d="M8.2 12.4l2.6 2.6 5-5.2"/>'),
    bell: svg('<path d="M18 15.5V11a6 6 0 1 0-12 0v4.5L4.5 18h15z"/><path d="M10 21h4"/>'),
    spark: svg('<path d="M12 3.2l1.9 5.1 5.1 1.9-5.1 1.9L12 17.2l-1.9-5.1L5 10.2l5.1-1.9z"/><path d="M18.6 16.4l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8z"/>'),
    chev: svg('<path d="M8.5 9.5 12 6l3.5 3.5M8.5 14.5 12 18l3.5-3.5"/>'),
    seal: svg('<path d="M12 3.5l2.3 1.6 2.8-.2.9 2.7 2.3 1.6-1.2 2.6 1.2 2.6-2.3 1.6-.9 2.7-2.8-.2L12 20.5l-2.3-1.6-2.8.2-.9-2.7L3.7 14.8l1.2-2.6-1.2-2.6 2.3-1.6.9-2.7 2.8.2z"/><path d="M9.3 12.2l1.9 1.9 3.6-3.9"/>'),
    table: svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M3 15h18M9.5 9.5V20"/>'),
    refresh: svg('<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 3.5V7h-3.5"/>')
  };
  function ic(name, cls) { return '<span class="vsp-ic ' + (cls || '') + '">' + (IC[name] || '') + '</span>'; }

  /* ── Состояние страницы ────────────────────────────────────────────────── */
  var S = {
    year: null, tab: 'me', loading: false, loadError: '',
    closed: false, directors: [], vacations: [], cal: {}, blocked: [],
    me: null, balance: null, windowOpen: true, daysToDeadline: 0, rules: null,
    balances: null, carryOverMax: 12, pending: null,
    myEmployeeId: null, myUserId: null, myRole: '',
    openMonth: null, sel: {}, editingId: null,
    hiddenGroups: {}, hiddenPeople: {}, deptOnly: false, hideAll: false,
    docVac: null, isDirector: false, isBuh: false
  };

  /* ── Дата-хелперы (UTC, без сдвига часового пояса) ────────────────────── */
  function pad(n) { return String(n).padStart(2, '0'); }
  function iso(y, m1, d) { return y + '-' + pad(m1) + '-' + pad(d); }          // m1 — 1-based
  function parseIso(s) { var p = String(s).slice(0, 10).split('-'); return { y: +p[0], m: +p[1], d: +p[2] }; }
  function daysInMonth(y, m1) { return new Date(Date.UTC(y, m1, 0)).getUTCDate(); }
  function dow(y, m1, d) { return new Date(Date.UTC(y, m1 - 1, d)).getUTCDay(); }
  function isWeekend(y, m1, d) { var g = dow(y, m1, d); return g === 0 || g === 6; }
  function rangeDays(a, b) {
    var A = parseIso(a), B = parseIso(b), out = [];
    for (var t = Date.UTC(A.y, A.m - 1, A.d), e = Date.UTC(B.y, B.m - 1, B.d); t <= e; t += 86400000) {
      out.push(new Date(t).toISOString().slice(0, 10));
    }
    return out;
  }
  function daysBetween(a, b) {
    var A = parseIso(a), B = parseIso(b);
    return Math.round((Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d)) / 86400000) + 1;
  }
  function fmtDay(isoStr) { var p = parseIso(isoStr); return p.d + ' ' + MONTHS_GEN[p.m - 1]; }
  function fmtShort(isoStr) { var p = parseIso(isoStr); return pad(p.d) + '.' + pad(p.m) + '.' + p.y; }
  function fmtRange(a, b) { return fmtDay(a) + ' — ' + fmtDay(b); }
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }
  function daysWord(n) { return n + ' ' + plural(n, 'день', 'дня', 'дней'); }
  function initials(fio) {
    var p = String(fio || '?').trim().split(/\s+/);
    return ((p[0] || '?')[0] || '') + (p[1] ? (p[1][0] || '') : '');
  }

  /* ── Производственный календарь (из GET /api/vacations/calendar) ─────── */
  function calOf(d) { return S.cal[String(d).slice(0, 10)] || null; }
  function isHoliday(d) { var r = calOf(d); return !!r && r.kind === 'holiday' && r.is_working === false; }
  function isShift(d) { var r = calOf(d); return !!r && r.kind === 'shift'; }
  function calTitle(d) { var r = calOf(d); return r && r.title ? r.title : ''; }
  /** Продлить конец периода, чтобы оплачиваемых дней стало need (праздники продлевают, ст.120 ТК). */
  function extendEnd(start, need) {
    var p = parseIso(start), t = Date.UTC(p.y, p.m - 1, p.d), got = 0;
    for (var i = 0; i < 400; i++) {
      var s = new Date(t).toISOString().slice(0, 10);
      if (!isHoliday(s)) got++;
      if (got >= need) return s;
      t += 86400000;
    }
    return new Date(t).toISOString().slice(0, 10);
  }

  /* ── API ───────────────────────────────────────────────────────────────── */
  function token() { return (window.AsgardAuth && AsgardAuth.getAuth() ? AsgardAuth.getAuth().token : '') || ''; }
  async function api(method, path, body) {
    var res = await fetch(path, {
      method: method,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    var data = null;
    try { data = await res.json(); } catch (_) { data = null; }
    if (!res.ok) {
      var err = new Error((data && data.message) || ('Сервер вернул ' + res.status));
      err.status = res.status; err.code = data && data.error;
      throw err;
    }
    return data;
  }

  /* ── Производные данные ────────────────────────────────────────────────── */
  function roleOf(r) { return String(r || ''); }
  function roleRu(r) { return ROLE_RU[r] || r || ''; }
  function groupKeyOf(role) {
    var g = GROUPS.filter(function (x) { return x.roles.indexOf(role) >= 0; })[0];
    return g ? g.key : FALLBACK_GROUP;
  }
  function groupTitleOf(key) {
    var g = GROUPS.filter(function (x) { return x.key === key; })[0];
    return g ? g.title : '';
  }
  function periodStatus(r) { return ST[r.status] ? r.status : 'draft'; }
  function stOf(r) { return ST[periodStatus(r)]; }
  function activePeriods(list) {
    return (list || []).filter(function (r) { return r.status !== 'rejected' && r.status !== 'cancelled'; });
  }
  function periodsOf(empId) {
    return S.vacations.filter(function (v) { return Number(v.employee_id) === Number(empId); });
  }

  /** Сотрудник в отпуске в этот день? Возвращает период-статус или null. */
  function cellPeriod(empId, d) {
    var list = periodsOf(empId);
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (String(r.date_from) <= d && d <= String(r.date_to)) return r;
    }
    return null;
  }
  /** Свои ли это дни (править можно только их). */
  function isMine(empId) { return Number(empId) === Number(S.myEmployeeId); }
  function canEditDays() { return S.tab === 'me' && !S.closed && !!S.myEmployeeId; }

  /** Реестр видимых сотрудников сгруппирован по отделам (порядок — GROUPS). */
  function roster() {
    var byId = new Map();
    (S.balances || []).forEach(function (s) {
      byId.set(Number(s.employee_id), {
        id: Number(s.employee_id), fio: s.fio, role: roleOf(s.role), userId: s.user_id,
        avail: s.available_days, carry: s.carry_over_days, balance: s.balance
      });
    });
    S.vacations.forEach(function (v) {
      var id = Number(v.employee_id);
      if (!byId.has(id)) byId.set(id, { id: id, fio: v.fio, role: roleOf(v.role), userId: v.user_id });
    });
    var list = [];
    byId.forEach(function (e) {
      if (!e.fio) return;
      if (isTestRow(e.fio) && Number(e.userId) !== Number(S.myUserId)) return;  // тест-аккаунты не в графике
      e.group = groupKeyOf(e.role);
      e.groupTitle = groupTitleOf(e.group);
      list.push(e);
    });
    // Моя строка — всегда первой в своём отделе
    var grouped = GROUPS.map(function (g) {
      var members = list.filter(function (e) { return e.group === g.key; })
        .sort(function (a, b) {
          if (isMine(a.id) !== isMine(b.id)) return isMine(a.id) ? -1 : 1;
          return String(a.fio).localeCompare(String(b.fio), 'ru');
        });
      return { key: g.key, title: g.title, members: members };
    });
    // Пустые отделы НЕ вырезаем: по ТЗ порядок групп фиксирован (Дирекция → РП →
    // Бухгалтерия → Тендерный → Кадры → Офис). Отдел без сотрудников показываем
    // с пометкой — иначе кажется, что отдела нет вовсе.
    rosterCache = list;          // плоский список сотрудников (для поиска/подсчётов)
    groupCache = grouped;        // сгруппированный (для рендера таблицы)
    return grouped;
  }
  function isTestRow(fio) { return /^(test|тест)\s/i.test(String(fio || '').trim()); }

  function groupsVisible(groups) {
    if (S.hideAll) {
      // «Скрыть всех» скрывает КОЛЛЕГ, но не меня: своя строка должна остаться,
      // иначе некуда ставить отпуск (заказчик, 20.10.2026).
      return groups.map(function (g) {
        // ВАЖНО: filter передаёт элемент, а не id — isMine(m) дал бы Number(object)=NaN
        // и скрыл бы себя же. Передаём m.id явно.
        return { key: g.key, title: g.title, members: g.members.filter(function (m) { return isMine(m.id); }) };
      }).filter(function (g) { return g.members.length; });
    }
    if (S.deptOnly) {
      var myGroup = groupKeyOf(S.myRole);
      return groups.filter(function (g) { return g.key === myGroup; });
    }
    return groups.filter(function (g) { return !S.hiddenGroups[g.key]; })
      .map(function (g) {
        return { key: g.key, title: g.title, members: g.members.filter(function (m) { return !S.hiddenPeople[m.id] || isMine(m.id); }) };
      })
      .filter(function (g) { return g.members.length; });
  }

  /** Баланс человека: из /balances, иначе считаем по периодам. */
  function balanceOf(empId) {
    var known = null;
    (S.balances || []).forEach(function (s) { if (Number(s.employee_id) === Number(empId)) known = s; });
    var approved = 0, pending = 0;
    periodsOf(empId).forEach(function (r) {
      if (r.status === 'approved') approved += Number(r.days) || 0;
      else if (r.status === 'pending') pending += Number(r.days) || 0;
    });
    var avail = known ? Number(known.available_days) || 0 : null;
    var carry = known ? Number(known.carry_over_days) || 0 : 0;
    return {
      available: avail, carry: carry, approved: approved, pending: pending,
      planned: approved + pending,
      left: avail === null ? null : avail - approved - pending
    };
  }
  var rosterCache = [];
  var groupCache = [];

  /** Значок свёрнутого месяца: сколько дней сотрудника попадает в месяц + даты. */
  function monthMark(empId, m1) {
    var rs = periodsOf(empId).filter(function (r) {
      return rangeDays(String(r.date_from), String(r.date_to)).some(function (d) { return +d.slice(5, 7) === m1; });
    });
    if (!rs.length) return null;
    var days = 0, labels = [], hasPend = false, hasRej = false, hasLive = false;
    rs.forEach(function (r) {
      var ds = rangeDays(String(r.date_from), String(r.date_to)).filter(function (d) { return +d.slice(5, 7) === m1; });
      days += ds.length;
      labels.push(fmtShort(ds[0]) + '—' + fmtShort(ds[ds.length - 1]));
      if (r.status === 'pending') hasPend = true;
      if (r.status === 'rejected' || r.status === 'cancelled') hasRej = true; else hasLive = true;
    });
    return {
      days: days, count: rs.length, label: labels.join(', '), pending: hasPend,
      status: hasPend ? 'pending' : (hasRej && !hasLive ? 'rejected' : 'approved')
    };
  }

  /** Пересечения с коллегами в диапазоне (предупреждение, не блокирует). */
  function clashesFor(start, end, selfEmpId) {
    var myGroup = groupKeyOf(S.myRole), out = [];
    rosterCache.forEach(function (e) {
      if (Number(e.id) === Number(selfEmpId)) return;
      periodsOf(e.id).forEach(function (r) {
        if (r.status === 'rejected' || r.status === 'cancelled') return;
        var from = String(r.date_from), to = String(r.date_to);
        if (end < from || start > to) return;
        var a = start > from ? start : from, b = end < to ? end : to;
        out.push({
          employee_id: e.id, fio: e.fio, role: e.role,
          date_from: from, date_to: to, overlap_days: daysBetween(a, b),
          sameDept: e.group === myGroup
        });
      });
    });
    out.sort(function (x, y) {
      if (x.sameDept !== y.sameDept) return x.sameDept ? -1 : 1;
      return y.overlap_days - x.overlap_days;
    });
    return out;
  }

  /** Сводка по выделенным дням (не блокирует, сервер — источник правды). */
  function selInfo() {
    var days = Object.keys(S.sel).filter(function (k) { return S.sel[k]; }).sort();
    if (!days.length) return null;
    var start = days[0], end = days[days.length - 1];
    var all = rangeDays(start, end);
    var hol = all.filter(isHoliday);
    var charged = all.length - hol.length;
    return {
      start: start, end: end, calDays: all.length, hol: hol.length, days: charged,
      holNotes: hol.map(function (d) { return fmtDay(d) + ' — ' + (calTitle(d) || 'праздник'); }),
      clashes: clashesFor(start, end, S.myEmployeeId),
      extendTo: hol.length && charged > 0 ? extendEnd(start, charged) : null
    };
  }

  /* ── Рендер: месяцы ───────────────────────────────────────────────────── */
  function colTemplate() {
    var cols = ['var(--vs-name-w)'];
    for (var m = 1; m <= 12; m++) {
      if (S.openMonth === null) cols.push('minmax(0, 1fr)');
      else cols.push(S.openMonth === m ? 'minmax(0, 1fr)' : MINI_W);
    }
    return cols.join(' ');
  }
  function dayCells(m1) {
    var n = daysInMonth(S.year, m1), out = [];
    for (var d = 1; d <= n; d++) {
      var s = iso(S.year, m1, d);
      out.push({ d: d, iso: s, wk: isWeekend(S.year, m1, d), hol: isHoliday(s), shift: isShift(s) });
    }
    return out;
  }
  function monthsHeader() {
    var cells = '';
    for (var m = 1; m <= 12; m++) {
      if (S.openMonth === m) {
        var holCount = rangeDays(iso(S.year, m, 1), iso(S.year, m, daysInMonth(S.year, m))).filter(isHoliday).length;
        cells += '<div class="vs-days vs-days--head is-open" data-month="' + m + '" title="Скрыть ' + MONTHS[m - 1] + '">' +
          '<div class="vs-days__cap"><span class="vs-days__m">' + MONTHS[m - 1] + '</span>' +
          (holCount ? '<span class="vs-days__hol">' + holCount + ' празд.</span>' : '') +
          '<span class="vs-days__x">' + IC.chev + '</span></div>' +
          '<div class="vs-days__wd">' + WEEKDAYS.map(function (w) { return '<div class="vs-d vs-d--wd">' + w + '</div>'; }).join('') + '</div>' +
          '<div class="vs-days__nm">' + dayCells(m).map(function (c) {
            var cls = 'vs-d vs-d--hd' + (c.wk ? ' is-wk' : '') + (c.hol ? ' is-hol' : '') + (c.shift ? ' is-shift' : '');
            // Тултип: что за праздник / какой перенос / просто выходной.
            var tip = '';
            if (c.hol) tip = 'Праздник РФ: ' + (calTitle(c.iso) || 'нерабочий день') + ' — в отпуск не входит, продлевает его (ст. 120 ТК РФ)';
            else if (c.shift) tip = 'Перенос выходного: ' + (calTitle(c.iso) || 'нерабочий день');
            else if (c.wk) tip = 'Выходной день недели';
            return '<div class="' + cls + '"' + (tip ? ' title="' + esc(tip) + '"' : '') + '>' + c.d + '</div>';
          }).join('') + '</div></div>';
      } else {
        var mk = monthMark(S.myEmployeeId, m);
        var tip = MONTHS[m - 1] + (mk ? ' · ' + mk.days + ' ' + plural(mk.days, 'день', 'дня', 'дней') + ': ' + mk.label : ' · отпусков нет');
        var tight = S.openMonth !== null;
        cells += '<div class="vs-mon vs-mon--head' + (mk ? ' has-mark' : '') + (tight ? ' is-tight' : '') + '" data-month="' + m + '" title="' + esc(tip) + '">' +
          '<span class="vs-mon__n">' + (tight ? MONTHS[m - 1].slice(0, 3) : MONTHS[m - 1]) + '</span>' +
          (mk ? '<span class="vs-mon__mk ' + (mk.pending ? 'is-pend' : mk.status === 'rejected' ? 'is-bad' : 'is-ok') + '">' + mk.days + '</span>' : '') +
          '</div>';
      }
    }
    return '<div class="vs-head" style="grid-template-columns:' + colTemplate() + '">' +
      '<div class="vs-name vs-name--head">' +
        '<span class="vs-name__t">Сотрудник</span>' +
        '<small>отдел · должность · отпуска за ' + S.year + '</small>' +
        '<div class="vs-name__acts">' +
          '<button class="vs-mini' + (S.deptOnly ? ' is-on' : '') + '" data-vs-dept-only>' + ic('people') + 'Только мой отдел</button>' +
          (S.hideAll || hasHidden()
            ? '<button class="vs-mini" data-vs-show-all>' + ic('eye') + 'Показать всех</button>'
            : '<button class="vs-mini" data-vs-hide-all>' + ic('eyeOff') + 'Скрыть всех</button>') +
        '</div>' +
      '</div>' + cells + '</div>';
  }
  function hasHidden() {
    return Object.keys(S.hiddenGroups).length > 0 || Object.keys(S.hiddenPeople).length > 0 || S.deptOnly;
  }

  function periodChips(empId) {
    var rs = periodsOf(empId).slice().sort(function (a, b) { return String(a.date_from) < String(b.date_from) ? -1 : 1; });
    if (!rs.length) return '<span class="vs-chip vs-chip--none">отпусков нет</span>';
    return rs.map(function (r) {
      var st = stOf(r);
      var sm = MONTHS[+String(r.date_from).slice(5, 7) - 1];
      var tip = fmtRange(String(r.date_from), String(r.date_to)) + ' · ' + st.label +
        (r.holidays_count ? ' · ' + r.holidays_count + ' празд. продлевают' : '') +
        (r.reason ? ' · причина: ' + r.reason : '');
      return '<button type="button" class="vs-chip ' + st.cls + '" title="' + esc(tip) + '" data-period="' + r.id + '" data-emp="' + empId + '">' +
        '<b>' + esc(sm.slice(0, 3)) + '</b> ' + st.short + ' ' + r.days + 'д</button>';
    }).join('');
  }

  function collapseRanges(rs) {
    var by = {};
    (rs || []).forEach(function (r) { by[r.year] = (by[r.year] || 0) + (Number(r.days) || 0); });
    return Object.keys(by).sort().map(function (y) { return by[y] + ' дн. (' + y + ')'; }).join(' · ');
  }
  /** Ячейка месяца сотрудника: значок с числом дней и тултипом с датами. */
  function monthMarkCell(emp, m1) {
    var mk = monthMark(emp.id, m1);
    var cls = 'vs-cdn' + (mk ? ' has-mark' : '') + (S.openMonth !== null ? ' is-tight' : '');
    if (mk) cls += ' ' + (mk.pending ? 'is-pend' : mk.status === 'rejected' ? 'is-bad' : 'is-ok');
    var tip = MONTHS[m1 - 1] + (mk ? ' · ' + mk.days + ' ' + plural(mk.days, 'день', 'дня', 'дней') + ': ' + mk.label : ' · отпусков нет');
    return '<div class="' + cls + '" title="' + esc(tip) + '">' + (mk ? mk.days : '') + '</div>';
  }

  function personRow(emp) {
    var mine = isMine(emp.id);
    var bal = balanceOf(emp.id);
    var allYears = periodsOf(emp.id).length ? collapseRanges(periodsOf(emp.id)) : '';
    var cmpYear = new Date().getFullYear();
    var cells = '';
    for (var m = 1; m <= 12; m++) {
      // В раскрытом месяце сетка дней видна У ВСЕХ сотрудников — иначе непонятно,
      // когда коллега в отпуске и с кем можно совпасть. Редактировать можно только
      // свою строку (canEditDays), у остальных ячейки — витрина.
      if (S.openMonth === m) {
        var mineRow = mine;
        cells += '<div class="vs-days">' + dayCells(m).map(function (c) {
          var r = cellPeriod(emp.id, c.iso);
          var sel = mineRow && canEditDays() && !!S.sel[c.iso];
          var editable = mineRow && canEditDays();
          var blocked = S.blocked.indexOf(c.iso) >= 0;
          var cls = ['vs-d'];
          if (c.wk) cls.push('is-wk');
          if (c.hol) cls.push('is-hol'); else if (c.shift) cls.push('is-shift');
          if (mineRow) cls.push('is-mine');
          if (sel) cls.push('is-sel');
          if (r) {
            cls.push('is-vac');
            cls.push(r.status === 'approved' ? 'v-ok' : r.status === 'pending' ? 'v-pend' : 'v-bad');
          }
          if (blocked) cls.push('is-blocked');
          var attrs = editable ? ' data-day="' + c.iso + '" data-emp="' + emp.id + '" role="button" tabindex="0"' : '';
          if (!editable && r) attrs += ' data-vs-why="График закрыт или период согласован — правка недоступна"';
          if (blocked) attrs += ' data-vs-blocked="' + c.iso + '"';
          var fmtD = parseIso(c.iso);
          var tip = fmtD.d + '.' + pad(fmtD.m) + ' · ' + (WEEKDAY_FULL[dow(S.year, m, c.d)] || '');
          if (c.hol) tip += ' · Праздник РФ: ' + (calTitle(c.iso) || 'нерабочий день') + ' (в отпуск не входит, продлевает его)';
          else if (c.shift) tip += ' · Перенос выходного: ' + (calTitle(c.iso) || 'нерабочий день');
          else if (c.wk) tip += ' · выходной';
          if (r) tip += ' · ' + stOf(r).label + ': ' + fmtRange(String(r.date_from), String(r.date_to));
          if (blocked) tip += ' · снято директором — повторно нельзя';
          return '<div class="' + cls.join(' ') + '"' + attrs + ' title="' + esc(tip) + '">' +
            (r ? '<i class="vs-d__dot"></i>' : '') + c.d + '</div>';
        }).join('') + '</div>';
      } else {
        cells += monthMarkCell(emp, m);
      }
    }
    var pend = periodsOf(emp.id).some(function (r) { return r.status === 'pending'; });
    var leftTxt = bal.left === null ? '—' : bal.left + ' дн.';
    return '<div class="vs-row' + (mine ? ' is-me' : '') + (S.isDirector && pend ? ' has-pending' : '') + '" style="grid-template-columns:' + colTemplate() + '">' +
      '<div class="vs-name">' +
        '<div class="vs-who">' +
          '<span class="vs-ava' + (mine ? ' is-me' : '') + '">' + esc(initials(emp.fio)) + '</span>' +
          '<div class="vs-who__tx">' +
            '<div class="vs-who__n">' + esc(emp.fio) + (mine ? ' <span class="vs-you">вы</span>' : '') + '</div>' +
            '<div class="vs-who__r">' + esc(roleRu(emp.role)) + '</div>' +
          '</div>' +
          '<button class="vs-hide" data-vs-hide="' + emp.id + '" title="Скрыть строку — останутся только нужные люди">' +
            IC.eyeOff + '<span class="vs-hide__t">скрыть</span></button>' +
        '</div>' +
        '<div class="vs-chips">' + periodChips(emp.id) + '</div>' +
        '<div class="vs-left' + (bal.left < 0 ? ' is-neg' : '') + '">остаток: <b class="num">' + leftTxt + '</b>' +
          (bal.carry ? ' · перенос ' + bal.carry : '') +
          (bal.pending ? ' · <span class="vs-left__p">на согласовании ' + bal.pending + '</span>' : '') +
          (allYears ? ' · <span class="vs-left__p">за ' + cmpYear + ': ' + allYears + '</span>' : '') +
        '</div>' +
      '</div>' + cells + '</div>';
  }

  /* ── Плашки ────────────────────────────────────────────────────────────── */
  function balanceStrip() {
    var b = S.balance || {};
    var avail = Number(b.available_days) || 0;
    var carry = Number(b.carry_over_days) || 0;
    var approved = Number(b.approved) || 0, pending = Number(b.pending) || 0;
    var left = Math.max(0, Number(b.left) || 0);
    function accCard(icon, label, value, unit, mod, hint) {
      return '<div class="vs-acc vs-acc--' + mod + '" title="' + esc(hint) + '">' +
        '<div class="vs-acc__glow"></div>' +
        '<div class="vs-acc__ic">' + (IC[icon] || '') + '</div>' +
        '<div class="vs-acc__tx"><div class="vs-acc__l">' + esc(label) + '</div>' +
        '<div class="vs-acc__v num">' + value + ' <small>' + unit + '</small></div>' +
        '<div class="vs-acc__h">' + esc(hint) + '</div></div></div>';
    }
    function pct(v, total) { return total ? Math.max(0, Math.min(100, Math.round(v / total * 100))) : 0; }
    return '<div class="vs-bal">' +
      accCard('gift', 'Доступно на 01.01.' + S.year, avail, 'кал. дн.', 'avail',
        'Основной отпуск ' + Math.max(0, avail - carry) + ' дн. + перенос ' + carry) +
      accCard('undo', 'Не отгулено за ' + (S.year - 1), carry, 'кал. дн.', 'carry',
        carry ? 'Переносится на ' + S.year + ' год (не более ' + S.carryOverMax + ' дн., ст. 124 ТК)' : 'Переносов нет') +
      '<div class="vs-acc vs-acc--can">' +
        '<div class="vs-acc__glow"></div>' +
        '<div class="vs-acc__tx">' +
          '<div class="vs-acc__l">Можно взять ещё</div>' +
          '<div class="vs-acc__v num">' + left + ' <small>из ' + avail + '</small></div>' +
          '<div class="vs-acc__bars">' +
            '<i class="vs-b vs-b--ok" style="width:' + pct(approved, avail) + '%"></i>' +
            '<i class="vs-b vs-b--pend" style="width:' + pct(pending, avail) + '%"></i>' +
            '<i class="vs-b vs-b--free" style="width:' + pct(left, avail) + '%"></i>' +
          '</div>' +
          '<div class="vs-acc__lg">' +
            '<span><i class="vs-b vs-b--ok"></i>отгуляно <b>' + approved + '</b></span>' +
            '<span><i class="vs-b vs-b--pend"></i>на согласовании <b>' + pending + '</b></span>' +
            '<span><i class="vs-b vs-b--free"></i>свободно <b>' + left + '</b></span>' +
          '</div>' +
        '</div>' +
      '</div></div>';
  }

  function deadlineBanner() {
    var all = rosterCache;
    var filled = all.filter(function (e) { return periodsOf(e.id).some(function (r) { return r.status !== 'rejected' && r.status !== 'cancelled'; }); }).length;
    var pctFilled = all.length ? Math.round(filled / all.length * 100) : 0;
    var dleft = Number(S.daysToDeadline) || 0;
    var stateCls = S.closed ? ' is-closed' : (!S.windowOpen && dleft <= 0 ? ' is-soon' : (dleft > 0 && dleft <= 7 ? ' is-soon' : ''));
    var stateTxt = S.closed
      ? 'График закрыт — правки невозможны.'
      : S.windowOpen
        ? (dleft > 0 ? 'Окно внесения открыто · ' + daysWord(dleft) + ' до закрытия' : 'Сегодня последний день внесения.')
        : (dleft > 0 ? 'Окно внесения откроется 1 ноября · ' + daysWord(dleft) + ' до закрытия' : 'Срок внесения прошёл — правки согласует директор.');
    return '<div class="vs-deadline' + stateCls + '">' +
      '<div class="vs-deadline__ic">' + IC.clock + '</div>' +
      '<div class="vs-deadline__tx">' +
        '<div class="vs-deadline__t">График на ' + S.year + ' год — внесение с <b>1 ноября</b>, закрытие до <b>1 декабря ' + (S.year - 1) + '</b></div>' +
        '<div class="vs-deadline__s">Внесли ' + filled + ' из ' + all.length + ' офисных сотрудников. ' + esc(stateTxt) + '</div>' +
      '</div>' +
      '<div class="vs-deadline__prog"><div class="vs-deadline__bar"><i style="width:' + pctFilled + '%"></i></div>' +
      '<span class="num">' + pctFilled + '%</span></div></div>';
  }

  function legend() {
    return '<div class="vs-legend">' +
      '<span class="vs-lg"><i class="vsp-sw v-ok"></i>согласовано</span>' +
      '<span class="vs-lg"><i class="vsp-sw v-pend"></i>ждёт согласования</span>' +
      '<span class="vs-lg"><i class="vsp-sw v-bad"></i>не согласовано</span>' +
      '<span class="vs-lg"><i class="vsp-sw is-hol"></i>праздник РФ (продлевает отпуск)</span>' +
      '<span class="vs-lg"><i class="vsp-sw is-wk"></i>выходной</span>' +
      '<span class="vs-lg"><i class="vsp-sw is-blocked"></i>дни сняты директором — повторно нельзя</span>' +
      (S.rules ? '<span class="vs-lg vs-lg--hint">Основной отпуск — ' + S.rules.SINGLE_MAX + ' дн. разом 1 раз в год; остальные — до ' +
        S.rules.OTHER_MAX + ' дн. Праздники (ст. 112 ТК) в отпуск не входят.</span>' : '') +
      '</div>';
  }

  /* ── Шапка ────────────────────────────────────────────────────────────── */
  function tabBtn(k, label, icon) {
    return '<button type="button" class="vs-tab' + (S.tab === k ? ' is-on' : '') + '" data-vs-tab="' + k + '">' + ic(icon) + label + '</button>';
  }
  function modalHead() {
    var who = S.tab === 'buh' ? { fio: 'Бухгалтерия', role: 'Настройка дней' }
      : S.tab === 'docs' ? { fio: 'Документы отпуска', role: 'Заявление · приказ Т-6 · график Т-7' }
        : { fio: (S.me && S.me.fio) || '', role: roleRu(S.myRole) };
    var tabs = tabBtn('me', 'Мои дни', 'people');
    if (S.isDirector) tabs += tabBtn('director', 'Согласование', 'check');
    if (S.isBuh) tabs += tabBtn('buh', 'Балансы дней', 'gift');
    tabs += tabBtn('docs', 'Документы', 'doc');
    return '<div class="vs-mhead">' +
      '<div class="vs-mhead__ic">' + IC.cal + '</div>' +
      '<div class="vs-mhead__tx">' +
        '<div class="vs-mhead__t">График отпусков · ' + S.year + ' <span class="badge gold">офис</span>' +
          (S.closed ? ' <span class="badge muted">закрыт</span>' : '') + '</div>' +
        '<div class="vs-mhead__s">' + esc(who.fio) + ' · ' + esc(who.role) + ' · дни календарные, праздники не входят</div>' +
      '</div>' +
      '<div class="vs-mhead__acts">' +
        '<button class="btn ghost sm" data-year="-1" title="Предыдущий год">◀</button>' +
        '<button class="btn ghost sm" data-year="1" title="Следующий год">▶</button>' +
        tabs +
        '<button class="btn ghost sm" data-vs-rules>' + ic('board') + 'Правила</button>' +
        (!S.loading ? '<button class="btn ghost sm" data-vs-reload title="Обновить">' + ic('refresh') + '</button>' : '') +
        (S.isDirector ? '<button class="btn ok sm" data-vs-approve-all>' + ic('check') + 'Согласовать всё</button>' : '') +
        (S.isDirector ? '<button class="btn ghost sm" data-vs-close-graph>' + ic('lock') + 'Закрыть график</button>' : '') +
      '</div>' +
      /* Выход из полноэкранной модалки — заказчик: «крестик в шапке справа». */
      '<button type="button" class="vsp-x vs-mhead__x" data-vs-close-modal title="Закрыть">' + IC.x + '</button>' +
      '</div>' +
      (S.closed ? '<div class="vs-note vs-closed">' + ic('lock') + 'График согласован и закрыт. Редактирование недоступно.</div>' : '') +
      (S.note ? '<div class="vs-note vs-note--' + esc(S.note.type) + '">' + (S.note.type === 'err' ? ic('warn') : ic('ok')) + esc(S.note.msg) + '</div>' : '');
  }

  /* ── Экран: Мои дни / Согласование ────────────────────────────────────── */
  function scheduleScreen() {
    var groups = groupsVisible(groupCache);
    var rows = groups.map(function (g) {
      var members = g.members;
      if (!members.length) {
        // Отдел без сотрудников: показываем заголовок с пометкой, чтобы порядок
        // групп соответствовал ТЗ и было видно, что отдел есть.
        return '<div class="vs-group vs-group--empty">' +
          '<span class="vs-group__t">' + esc(g.title) + '</span>' +
          '<span class="vs-group__c">сотрудников в CRM нет</span>' +
          '<span class="vs-group__line"></span></div>';
      }
      var pendN = members.filter(function (m) { return periodsOf(m.id).some(function (r) { return r.status === 'pending'; }); }).length;
      return '<div class="vs-group">' +
        '<span class="vs-group__t">' + esc(g.title) + '</span>' +
        '<span class="vs-group__c">' + members.length + ' чел.' + (pendN ? ' · ' + pendN + ' ждут решения' : '') + '</span>' +
        '<span class="vs-group__line"></span>' +
        '<button class="vs-hide vs-hide--grp" data-vs-hidegroup="' + g.key + '" title="Скрыть отдел «' + esc(g.title) + '»">' + IC.eyeOff + '<span class="vs-hide__t">скрыть отдел</span></button>' +
        '</div>' + members.map(personRow).join('');
    }).join('');

    var hidden = Object.keys(S.hiddenGroups).map(function (k) {
      return '<button type="button" class="vs-chip vs-chip--restore" data-vs-unhidegroup="' + k + '">' + 'показать отдел «' + esc(groupTitleOf(k)) + '»</button>';
    }).join('') + Object.keys(S.hiddenPeople).map(function (id) {
      var e = rosterCache.filter(function (x) { return Number(x.id) === Number(id); })[0];
      return e ? '<button type="button" class="vs-chip vs-chip--restore" data-vs-unhide="' + id + '">показать ' + esc(String(e.fio).split(' ')[0]) + '</button>' : '';
    }).join('');

    var empty = '<div class="empty-state"><div class="icon">' + IC.people + '</div>' +
      '<div class="title">Отделы скрыты</div><div class="hint">Нажмите «Показать всех», чтобы вернуть строки</div></div>';

    return '<div class="vs-stage"><div class="vs-modal">' +
      modalHead() +
      (S.tab === 'me' ? balanceStrip() : '') +
      deadlineBanner() +
      legend() +
      (S.tab === 'director' ? directorBar() : '') +
      (hidden ? '<div class="vs-hiddenbar">' + hidden + '</div>' : '') +
      '<div class="vs-tablewrap' + (S.openMonth !== null ? ' is-narrow' : '') + '">' + monthsHeader() +
        '<div class="vs-body">' + (rows || empty) + '</div>' +
      '</div>' +
      selBar() +
      '<div class="vs-foot"><div class="vs-foot__tx">' + footHint() + '</div>' +
        (S.tab === 'me' && !S.closed
          ? '<button class="btn gold" data-vs-submit>' + ic('check') + 'Готово и согласовать</button>' : '') +
        (S.tab === 'me'
          ? '<span class="badge ' + (S.closed ? 'muted' : 'success') + '">' + (S.closed ? 'график закрыт' : 'первый месяц раскрывается кликом по названию') + '</span>' : '') +
        (S.isDirector ? '<button class="btn ok" data-vs-approve-all>' + ic('check') + 'Согласовать всё</button>' : '') +
      '</div>' +
    '</div></div>';
  }

  function footHint() {
    if (S.closed) return 'График закрыт — правки невозможны.';
    if (S.tab === 'director') return 'Согласуйте периоды в очереди или по ФИО. Отклонение — с обязательным комментарием.';
    return 'Нажмите месяц, затем дни 1–' + (S.rules ? S.rules.SINGLE_MAX : 14) + ' для основного отпуска. Раскрыт всегда один месяц. Свои дни правите вы, чужие видите.';
  }

  /* ── Панель и очередь директора ───────────────────────────────────────── */
  function pendingList() {
    if (S.pending) return S.pending;
    var out = [];
    rosterCache.forEach(function (e) {
      periodsOf(e.id).forEach(function (r) { if (r.status === 'pending') out.push(Object.assign({}, r, { fio: e.fio, role: e.role })); });
    });
    out.sort(function (a, b) { return String(a.date_from) < String(b.date_from) ? -1 : 1; });
    return out;
  }
  function voteRow(approvals, dirs) {
    var yes = (approvals || []).filter(function (a) { return a.decision === 'approve'; })
      .map(function (a) { return Number(a.director_user_id); });
    return (dirs || []).map(function (d) {
      var ok = yes.indexOf(Number(d.id)) >= 0;
      return '<span class="vs-vote' + (ok ? ' is-yes' : '') + '" title="' + esc((d.name || d.fio) + ' — ' + (ok ? 'согласовал' : 'ждём решения')) + '">' +
        esc(initials(d.name || d.fio)) + '</span>';
    }).join('');
  }
  function progressOf(r) { return r.progress && typeof r.progress.done === 'number' ? r.progress : { done: 0, total: (S.directors || []).length, left: [] }; }

  function directorBar() {
    var pend = pendingList();
    var filled = rosterCache.filter(function (e) { return periodsOf(e.id).some(function (r) { return r.status !== 'rejected' && r.status !== 'cancelled'; }); }).length;
    return '<div class="vs-dirbar">' +
      '<div class="vs-dirbar__i"><b class="num">' + filled + '/' + rosterCache.length + '</b><span>заполнили график</span></div>' +
      '<div class="vs-dirbar__sep"></div>' +
      '<div class="vs-dirbar__i vs-dirbar__i--hot"><b class="num">' + pend.length + '</b><span>' + plural(pend.length, 'период ждёт', 'периода ждут', 'периодов ждут') + ' решения</span></div>' +
      '<div class="vs-dirbar__sep"></div>' +
      '<div class="vs-dirbar__i"><b class="num">' + (S.directors || []).length + '</b><span>директора согласуют</span></div>' +
      '<div class="vs-dirbar__hint">Согласовать может любой директор; период считается согласованным, когда «за» все. Отклонение — только с комментарием, снятые дни система запоминает.</div>' +
      '</div>' + dirQueue(pend);
  }

  function dirQueue(pend) {
    if (!pend.length) {
      return '<div class="vs-queue vs-queue--empty">' + ic('ok', 'vs-ok-ic') +
        '<div><b>Очередь пуста</b><span>Все отправленные периоды согласованы. Можно закрывать график.</span></div></div>';
    }
    var cards = pend.map(function (r) {
      var pr = progressOf(r);
      var clashes = r.clashes || clashesFor(String(r.date_from), String(r.date_to), r.employee_id);
      var clashTxt = clashes.length
        ? '<span class="vs-q__clash">' + ic('warn') + 'пересечение: ' + clashes.slice(0, 2).map(function (c) {
          return esc(String(c.fio || '').split(' ')[0]) + ' (' + (c.overlap_days || c.overlapDays) + ' дн.)';
        }).join(', ') + (clashes.length > 2 ? ' и ещё ' + (clashes.length - 2) : '') + '</span>'
        : '<span class="vs-q__clear">' + ic('check') + 'пересечений нет</span>';
      return '<div class="vs-q" data-stop>' +
        '<span class="vs-q__ava">' + esc(initials(r.fio)) + '</span>' +
        '<div class="vs-q__who">' +
          '<div class="vs-q__n">' + esc(r.fio) + ' <span class="vs-q__role">' + esc(roleRu(r.role)) + '</span></div>' +
          '<div class="vs-q__d">' + esc(fmtRange(String(r.date_from), String(r.date_to))) + ' · <b>' + daysWord(r.days) + '</b>' +
            (r.holidays_count ? ' <span class="vs-q__hol">+' + r.holidays_count + ' празд. продлевают</span>' : '') +
            (+r.days >= (S.rules ? S.rules.SINGLE_MAX : 14) ? ' <span class="badge gold">основной</span>' : '') + '</div>' +
          '<div class="vs-q__meta">' + clashTxt +
            '<span class="vs-q__votes"><span class="dim" style="font-size:10.5px;margin-right:4px">Согласовали ' + pr.done + ' из ' + pr.total + '</span>' +
            voteRow(r.approvals, S.directors) + '</span></div>' +
        '</div>' +
        '<div class="vs-q__acts">' +
          '<button class="btn ok sm" data-vs-decide="' + r.id + '|approve">' + ic('check') + 'Согласовать</button>' +
          '<button class="btn danger sm" data-vs-decide="' + r.id + '|reject">' + ic('x') + 'Отклонить</button>' +
        '</div></div>';
    }).join('');
    return '<div class="vs-queue"><div class="vs-queue__h">' +
      '<span class="vs-queue__t">' + ic('bell') + 'Очередь на согласование</span>' +
      '<span class="vs-queue__c">' + pend.length + ' ' + plural(pend.length, 'период', 'периода', 'периодов') + '</span>' +
      '</div><div class="vs-queue__list">' + cards + '</div></div>';
  }

  /* ── Панель выделения (свои дни) ──────────────────────────────────────── */
  function selBar() {
    if (S.tab !== 'me' || !canEditDays()) return '';
    var v = selInfo();
    if (!v) return '';
    var clashHtml = v.clashes.length
      ? '<div class="vs-selbar__clash">' + ic('warn') + '<b>Пересечение:</b> ' + v.clashes.slice(0, 3).map(function (c) {
        return esc(String(c.fio).split(' ')[0]) + ' (' + c.overlap_days + ' ' + plural(c.overlap_days, 'день', 'дня', 'дней') + ')';
      }).join(', ') + (v.clashes.length > 3 ? ' и ещё ' + (v.clashes.length - 3) : '') +
      ' <span class="dim">— поставить можно, но проверьте пересечение</span></div>'
      : '<div class="vs-selbar__clash is-clear">' + ic('check') + 'Пересечений с коллегами нет</div>';
    var holHtml = v.hol
      ? '<div class="vs-selbar__hol">' + ic('spark') + 'Выделено ' + v.calDays + ' ' + plural(v.calDays, 'календарный день', 'календарных дня', 'календарных дней') +
        ', из них ' + v.hol + ' ' + plural(v.hol, 'праздник', 'праздника', 'праздников') + ' (' + esc(v.holNotes.join('; ')) + ') — в отпуск не входят.' +
        (v.extendTo ? ' Чтобы получить ' + v.calDays + ' оплачиваемых, продлите до <b>' + esc(fmtDay(v.extendTo)) + '</b>' : '') + '</div>'
      : '';
    return '<div class="vs-selbar">' +
      '<div class="vs-selbar__tx">' +
        '<div class="vs-selbar__r">' + esc(fmtRange(v.start, v.end)) + '</div>' +
        '<div class="vs-selbar__d">' + daysWord(v.days) + ' оплачиваемых' +
          (v.hol ? ' · ' + v.hol + ' празд. не в счёт' : '') +
          (S.rules && v.days >= S.rules.SINGLE_MAX ? ' · основной отпуск (до ' + S.rules.SINGLE_MAX + ')' :
            (S.rules && v.days > S.rules.OTHER_MAX ? ' · <span class="vs-bad">кроме основного — не больше ' + S.rules.OTHER_MAX + ' дней</span>' : ' · дополнительный (до ' + (S.rules ? S.rules.OTHER_MAX : 7) + ')')) +
        '</div>' + holHtml + clashHtml +
      '</div>' +
      '<div class="vs-selbar__acts">' +
        '<button class="btn ghost sm" data-vs-clear>' + (S.editingId ? 'Отменить правку' : 'Очистить') + '</button>' +
        '<button class="btn gold sm" data-vs-save>' + ic('check') + (S.editingId ? 'Сохранить правку' : 'Поставить отпуск') + '</button>' +
      '</div></div>';
  }

  /* ── Экран бухгалтерии ────────────────────────────────────────────────── */
  function buhScreen() {
    var groups = GROUPS.map(function (g) {
      var members = rosterCache.filter(function (e) { return e.group === g.key; });
      if (!members.length) return '';
      return '<tr class="vs-buh-g"><td colspan="7">' + esc(g.title) + '</td></tr>' + members.map(function (e) {
        var b = balanceOf(e.id);
        return '<tr>' +
          '<td><div class="vs-who__n">' + esc(e.fio) + '</div><div class="vs-who__r">' + esc(roleRu(e.role)) + '</div></td>' +
          '<td>' + esc(g.title) + '</td>' +
          '<td class="right"><input class="input vs-inp" type="number" min="0" max="365" value="' + (b.available === null ? 0 : b.available) + '" data-buh-avail="' + e.id + '"><div class="vs-inp__h">положено за год</div></td>' +
          '<td class="right"><input class="input vs-inp" type="number" min="0" max="365" value="' + (b.carry || 0) + '" data-buh-carry="' + e.id + '"><div class="vs-inp__h">не отгулено за ' + (S.year - 1) + '</div></td>' +
          '<td class="right num">' + b.planned + '</td>' +
          '<td class="right num"><b>' + (b.left === null ? '—' : b.left) + '</b></td>' +
          '<td><span class="vs-chip ' + (b.pending ? ST.pending.cls : ST.approved.cls) + '">' + (b.pending ? 'ждёт решения' : 'ок') + '</span></td>' +
          '</tr>';
      }).join('');
    }).join('');
    return '<div class="vs-stage"><div class="vs-modal">' +
      modalHead() +
      '<div class="vs-buhnote">' + ic('warn') +
        '«Положено за год» — сколько дней доступно сотруднику на 01.01.' + S.year +
        '; «не отгулено за ' + (S.year - 1) + '» переносится отдельной строкой. Переносить можно не более ' + S.carryOverMax +
        ' дней (ст. 124 ТК) — поле подсветится. Сохранение — кнопкой «Сохранить».</div>' +
      '<div class="vs-buhwrap"><table class="tbl vs-buhtbl">' +
        '<thead><tr><th>Сотрудник</th><th>Отдел</th><th class="right">Положено за год</th>' +
        '<th class="right">Не отгулено за ' + (S.year - 1) + '</th><th class="right">Запланировано</th><th class="right">Остаток</th><th>Статус</th></tr></thead>' +
        '<tbody>' + (groups || '<tr><td colspan="7" class="muted" style="padding:12px">Нет офисных сотрудников</td></tr>') + '</tbody>' +
      '</table></div>' +
      '<div class="vs-foot"><div class="vs-foot__tx">Максимальный перенос — ' + S.carryOverMax + ' дней (ст. 124 ТК РФ). Балансы видит бухгалтерия.</div>' +
        '<button class="btn gold" data-vs-buh-save>' + ic('check') + 'Сохранить балансы</button>' +
      '</div>' +
    '</div></div>';
  }

  /* ── Экран документов ─────────────────────────────────────────────────── */
  var DOCS = [
    { k: 'zayav', t: 'Заявление на отпуск', s: 'Сотрудник · DOCX по присланной форме', icon: 'doc' },
    { k: 'prikaz', t: 'Приказ о предоставлении (Т-6)', s: 'Бухгалтерия или админ · DOCX', icon: 'seal' },
    { k: 't7', t: 'График отпусков (Т-7)', s: 'Бухгалтерия или директор · DOCX', icon: 'board' },
    { k: 't7xlsx', t: 'График отпусков — XLSX', s: 'Выгрузка таблицей для проверки', icon: 'table' }
  ];
  function myVacationsForDoc() {
    return periodsOf(S.myEmployeeId).slice().sort(function (a, b) { return String(a.date_from) > String(b.date_from) ? -1 : 1; });
  }
  function docsScreen() {
    var mine = myVacationsForDoc();
    if (S.docVac === null && mine.length) S.docVac = mine[0].id;
    var opts = mine.map(function (r) {
      return '<option value="' + r.id + '"' + (Number(S.docVac) === Number(r.id) ? ' selected' : '') + '>' +
        esc(fmtRange(String(r.date_from), String(r.date_to)) + ' · ' + stOf(r).label) + '</option>';
    }).join('');
    var cards = DOCS.map(function (d) {
      return '<button type="button" class="vs-doc" data-vs-doc="' + d.k + '">' +
        '<span class="vs-doc__ic">' + (IC[d.icon] || '') + '</span>' +
        '<span><span class="vs-doc__t">' + esc(d.t) + '</span><span class="vs-doc__s">' + esc(d.s) + '</span></span>' +
        '<span class="vs-doc__go">' + IC.down + '</span></button>';
    }).join('');
    return '<div class="vs-stage"><div class="vs-modal">' +
      modalHead() +
      '<div class="vs-buhnote">' + ic('doc') +
        'Документы формируются сервером в .docx и скачиваются с авторизацией. Для заявления и приказа Т-6 берётся согласованный отпуск; если их несколько — выберите нужный ниже.</div>' +
      '<div class="vs-docs">' +
        (mine.length
          ? '<label class="lbl" for="vsDocVac">Отпуск для заявления и приказа</label>' +
            '<select class="input" id="vsDocVac" data-vs-doc-vac style="max-width:420px;margin-bottom:14px">' + opts + '</select>'
          : '<div class="vs-note" style="margin:0 0 14px">' + ic('warn') + 'Своих отпусков за ' + S.year + ' нет — заявление и приказ Т-6 формировать не из чего. График Т-7 доступен всегда.</div>') +
        '<div class="vs-docs__grid">' + cards + '</div>' +
      '</div>' +
      '<div class="vs-foot"><div class="vs-foot__tx">Формы: заявление — сотрудник; приказ Т-6 и график Т-7 — бухгалтерия или администратор.</div></div>' +
    '</div></div>';
  }

  /* ── Модалки: правила, период, отклонение ─────────────────────────────── */
  function closeOverlays() { $$('.vsp-ov').forEach(function (o) { o.remove() }); }

  /** Выход из полноэкранной модалки графика отпусков.
      Возвращаемся туда, откуда пришли (страница графика офиса), иначе — на главную.
      Заказчик: модалка открывается кнопкой на графике офиса, значит закрывается
      «назад» туда же, а не оставляет пользователя в пустоте. */
  function closeSchedulePage() {
    closeOverlays();
    var ref = document.referrer || '';
    if (ref && ref.indexOf(location.origin) === 0 && /#\//.test(ref)) {
      location.hash = ref.slice(ref.indexOf('#'));
      return;
    }
    location.hash = '#/office-schedule';
  }

  function rulesModal() {
    closeOverlays();
    var r = S.rules || {};
    var ov = document.createElement('div');
    ov.className = 'vsp-ov';
    ov.setAttribute('data-vs-ov', '1');
    ov.innerHTML = '<div class="vsp-sheet" data-stop>' +
      '<div class="vsp-sheet__h"><span class="vsp-sheet__ic">' + IC.board + '</span><b>Правила графика отпусков (офис)</b>' +
        '<button class="vsp-x" data-vs-close-overlay>' + IC.x + '</button></div>' +
      '<ul class="vs-rules__l">' +
        '<li>Основной отпуск — <b>' + (r.SINGLE_MAX || 14) + ' календарных дней разом, один раз в год</b>.</li>' +
        '<li>Остальные отпуска — <b>не более ' + (r.OTHER_MAX || 7) + ' календарных дней</b>, не более ' + (r.MAX_PARTS || 6) + ' периодов за год.</li>' +
        '<li>Дни считаются <b>календарные</b>. Нерабочие праздники (ст. 112 ТК РФ) в отпуск <b>не входят</b> и продлевают его (ст. 120 ТК РФ).</li>' +
        '<li>Сотрудник правит <b>только свои</b> дни, чужие видит — так видно пересечения.</li>' +
        '<li>График вносится <b>с 1 ноября</b> и закрывается <b>до 1 декабря</b> предыдущего года.</li>' +
        '<li>Согласовывают <b>все директора</b>: период согласован, когда «за» все.</li>' +
        '<li>Отклонение — только с комментарием; снятые дни система запоминает, повторно поставить нельзя.</li>' +
        '<li>За ' + (r.NOTICE_DAYS || 15) + ' дней до начала отпуска директору уходит письмо. Напоминания — раз в сутки, всего ' +
          (r.REMIND_MAX || 3) + '; без ответа отпуск снимается автоматически.</li>' +
        '<li>Перенос дней — не более ' + (r.CARRY_OVER_MAX || 12) + ' (ст. 124 ТК РФ).</li>' +
        '<li>График закрывается, когда все внесли и директора согласовали.</li>' +
      '</ul></div>';
    document.body.appendChild(ov);
  }

  function periodModal(periodId, empId) {
    closeOverlays();
    var emp = rosterCache.filter(function (e) { return Number(e.id) === Number(empId); })[0] || {};
    var r = periodsOf(empId).filter(function (x) { return Number(x.id) === Number(periodId); })[0];
    if (!r) return;
    var st = stOf(r);
    var mine = isMine(empId);
    var pr = progressOf(r);
    var from = String(r.date_from), to = String(r.date_to);
    var clashes = clashesFor(from, to, empId);
    var bal = balanceOf(empId);
    var votesHtml = r.status === 'pending'
      ? '<div class="vs-pc-line__voteline"><span>Согласовали ' + pr.done + ' из ' + pr.total + '</span>' + voteRow(r.approvals, S.directors) + '</div>' : '';
    var acts = '';
    if (S.isDirector && r.status === 'pending') {
      acts = '<div class="vs-pc-line__acts">' +
        '<button class="btn ok sm" data-vs-decide="' + r.id + '|approve">' + ic('check') + 'Согласовать</button>' +
        '<button class="btn danger sm" data-vs-decide="' + r.id + '|reject">' + ic('x') + 'Не согласовать</button></div>';
    } else if (S.isDirector && (r.status === 'rejected' || r.status === 'approved') && !S.closed) {
      acts = '<div class="vs-pc-line__acts"><button class="btn ghost sm" data-vs-revoke="' + r.id + '">' + ic('undo') + 'Вернуть на согласование</button></div>';
    } else if (mine && !S.closed && r.status !== 'approved') {
      acts = '<div class="vs-pc-line__acts">' +
        '<button class="btn ghost sm" data-vs-edit="' + r.id + '" data-emp="' + empId + '">Изменить дни</button>' +
        '<button class="btn danger sm" data-vs-cancel="' + r.id + '">' + ic('x') + 'Снять период</button></div>';
    }
    var ov = document.createElement('div');
    ov.className = 'vsp-ov';
    ov.setAttribute('data-vs-ov', '1');
    ov.innerHTML = '<div class="vsp-sheet vs-pc" data-stop>' +
      '<div class="vs-pc__h"><span class="vs-ava' + (mine ? ' is-me' : '') + '">' + esc(initials(emp.fio)) + '</span>' +
        '<div><div class="vs-pc__n">' + esc(emp.fio) + '</div>' +
        '<div class="vs-pc__r">' + esc(roleRu(emp.role)) + ' · ' + esc(emp.groupTitle || '') + '</div></div>' +
        '<button class="vsp-x" data-vs-close-overlay>' + IC.x + '</button></div>' +
      '<div class="vs-pc__kpis">' +
        '<div class="vs-pc__k"><b class="num">' + (bal.available === null ? '—' : bal.available) + '</b><span>доступно</span></div>' +
        '<div class="vs-pc__k"><b class="num">' + bal.carry + '</b><span>перенос ' + (S.year - 1) + '</span></div>' +
        '<div class="vs-pc__k"><b class="num">' + bal.planned + '</b><span>запланировано</span></div>' +
        '<div class="vs-pc__k' + (bal.left < 0 ? ' is-neg' : '') + '"><b class="num">' + (bal.left === null ? '—' : bal.left) + '</b><span>остаток</span></div>' +
      '</div>' +
      '<div class="vs-pc__body"><div class="vs-pc-line"><div class="vs-pc-line__t">' + esc(fmtRange(from, to)) +
        ' <span class="vs-chip ' + st.cls + '">' + st.label + '</span>' +
        '<span class="vs-pc-line__d">' + daysWord(r.days) + (r.holidays_count ? ' +' + r.holidays_count + ' празд.' : '') + '</span>' +
        (+r.days >= (S.rules ? S.rules.SINGLE_MAX : 14) ? '<span class="badge gold">основной</span>' : '') + '</div>' +
        votesHtml +
        (clashes.length ? '<div class="vs-pc-line__clash">' + ic('warn') + 'Пересечение: ' + clashes.map(function (c) {
          return esc(String(c.fio).split(' ')[0]) + ' · ' + c.overlap_days + ' дн.';
        }).join(', ') + '</div>' : '') +
        (r.reason ? '<div class="vs-pc-line__r">' + ic('doc') + '<span>причина: ' + esc(r.reason) + '</span></div>' : '') +
        acts +
      '</div></div></div>';
    document.body.appendChild(ov);
  }

  function rejectModal(periodId) {
    closeOverlays();
    var r = S.vacations.filter(function (x) { return Number(x.id) === Number(periodId); })[0];
    if (!r) return;
    var ov = document.createElement('div');
    ov.className = 'vsp-ov';
    ov.setAttribute('data-vs-ov', '1');
    ov.innerHTML = '<div class="vsp-sheet vs-reject" data-stop>' +
      '<div class="vsp-sheet__h"><span class="vsp-sheet__ic is-bad">' + IC.x + '</span><b>Не согласовать отпуск</b>' +
        '<button class="vsp-x" data-vs-close-overlay>' + IC.x + '</button></div>' +
      '<div class="vs-reject__who">' + esc(r.fio) + ' · ' + esc(fmtRange(String(r.date_from), String(r.date_to))) + ' · ' + daysWord(r.days) + '</div>' +
      '<label class="lbl" for="vsRejectText">Комментарий сотруднику — <b class="vs-bad">обязательно</b></label>' +
      '<textarea class="input vs-reject__ta" id="vsRejectText" rows="3" placeholder="Почему не согласовано и когда лучше взять (например: «Сдача объекта 1–15 мая, возьми после 20-го»)."></textarea>' +
      '<div class="vs-reject__hint">' + ic('warn') + 'Дни будут сняты: сотрудник получит уведомление, а система запомнит эти даты — поставить их повторно не даст.</div>' +
      '<div class="vs-reject__acts">' +
        '<button class="btn ghost" data-vs-close-overlay>Отмена</button>' +
        '<button class="btn danger" data-vs-reject-confirm="' + r.id + '">' + ic('x') + 'Не согласовать и уведомить</button>' +
      '</div></div>';
    document.body.appendChild(ov);
    setTimeout(function () { var t = document.getElementById('vsRejectText'); if (t) t.focus(); }, 40);
  }

  /* ── Действия ──────────────────────────────────────────────────────────── */
  async function reload(keepState) {
    S.loading = true; S.loadError = ''; paint();
    var year = S.year;
    try {
      var me = await api('GET', '/api/vacations/me?year=' + year);
      S.myEmployeeId = me.employee_id;
      S.balance = me.balance;
      S.blocked = me.blocked_days || [];
      S.windowOpen = !!me.window_open;
      S.daysToDeadline = Number(me.days_to_deadline) || 0;
      S.closed = !!me.closed;
      S.rules = me.rules || S.rules;
      var all = await api('GET', '/api/vacations?year=' + year);
      S.vacations = all.vacations || [];
      S.directors = all.directors || [];
      S.closed = !!all.closed || S.closed;
      var cal = await api('GET', '/api/vacations/calendar?year=' + year);
      var map = {};
      (cal.days || []).forEach(function (d) { map[String(d.date).slice(0, 10)] = d; });
      S.cal = map;
      var bal = null;
      try { bal = await api('GET', '/api/vacations/balances?year=' + year); } catch (_) { bal = null; }
      S.balances = bal ? (bal.staff || []) : [];
      S.carryOverMax = (bal && bal.carry_over_max) || (S.rules && S.rules.CARRY_OVER_MAX) || 12;
      if (S.isDirector) {
        try { var p = await api('GET', '/api/vacations/pending?year=' + year); S.pending = p.pending || []; }
        catch (_) { S.pending = null; }
      }
      roster();   // заполняет rosterCache (плоский) и groupCache (группы)
      if (!keepState) { S.openMonth = null; S.sel = {}; S.editingId = null; }
    } catch (e) {
      S.loadError = e.message || String(e);
    } finally {
      S.loading = false; paint();
    }
  }

  function setNote(type, msg) { S.note = msg ? { type: type, msg: msg } : null; }

  async function savePeriod() {
    var v = selInfo();
    if (!v) return;
    try {
      var res;
      if (S.editingId) {
        res = await api('PUT', '/api/vacations/' + S.editingId, { date_from: v.start, date_to: v.end });
        toast('Правка сохранена', fmtRange(v.start, v.end) + ' · снова на согласование', 'ok');
      } else {
        res = await api('POST', '/api/vacations', { year: S.year, date_from: v.start, date_to: v.end });
        toast('Отпуск поставлен', fmtRange(v.start, v.end) + ' · ' + daysWord(res.days || v.days) + ' · на согласование', 'ok');
      }
      if (res && res.clashes && res.clashes.length) {
        setNote('ok', 'Поставлено. Пересечения: ' + res.clashes.slice(0, 3).map(function (c) {
          return String(c.fio || '').split(' ')[0] + ' (' + (c.overlap_days || c.overlapDays) + ' дн.)';
        }).join(', ') + ' — можно оставить, но проверьте.');
      } else {
        setNote('ok', S.closed ? 'Период сохранён.' : 'Период отправлен директорам на согласование.');
      }
    // После сохранения открываем месяц нового периода, чтобы он сразу был виден.
    S.sel = {}; S.editingId = null;
    if (res && res.vacation && res.vacation.date_from) S.openMonth = +String(res.vacation.date_from).slice(5, 7);
    await reload(true);
    } catch (e) {
      setNote('err', e.message);
      toast('Нельзя поставить', e.message, 'err');
      paint();
    }
  }

  /** «Готово и согласовать»: отправить все свои черновые периоды директорам. */
  async function submitAllMine() {
    var mine = periodsOf(S.meEmployeeId || (D && D.meId))
      .filter(function (r) { return r.status === 'draft'; });
    if (!mine.length) {
      // Если черновиков нет — считаем, что всё уже отправлено (периоды создаются сразу pending).
      toast('Готово', 'Все ваши периоды уже отправлены директорам на согласование', 'ok');
      setNote('ok', 'График отправлен. Директора увидят ваши периоды в очереди; за 15 дней до отпуска придёт письмо с кнопками «Да/Нет».');
      paint();
      return;
    }
    try {
      for (var i = 0; i < mine.length; i++) {
        await api('POST', '/api/vacations/' + mine[i].id + '/submit', {});
      }
      toast('Готово и согласовать', 'Отправлено директорам: ' + mine.length, 'ok');
      setNote('ok', 'График отправлен на согласование. Директора проверят дни; при отказе вы получите комментарий и сможете переставить.');
      await reload();
    } catch (e) { setNote('err', e.message); toast('Не удалось отправить', e.message, 'err'); paint(); }
  }

  async function cancelPeriod(id) {
    try {
      await api('DELETE', '/api/vacations/' + id);
      toast('Период снят', 'Дни освобождены, согласование отменено', 'warn');
      closeOverlays();
      S.editingId = null; S.sel = {};
      await reload();
    } catch (e) { setNote('err', e.message); toast('Не удалось снять', e.message, 'err'); paint(); }
  }

  async function startEdit(id) {
    var r = S.vacations.filter(function (x) { return Number(x.id) === Number(id); })[0];
    if (!r) return;
    closeOverlays();
    S.editingId = Number(id);
    S.sel = {};
    rangeDays(String(r.date_from), String(r.date_to)).forEach(function (d) { S.sel[d] = true; });
    S.openMonth = +String(r.date_from).slice(5, 7);
    toast('Правка периода', 'Измените дни и нажмите «Сохранить правку»', 'info');
    paint();
  }

  async function decide(id, action) {
    if (action === 'reject') { rejectModal(id); return; }
    try {
      var res = await api('POST', '/api/vacations/' + id + '/approve');
      var pr = res.progress || {};
      var leftNames = (pr.left || []).map(function (uid) {
        var d = (S.directors || []).filter(function (x) { return Number(x.id) === Number(uid); })[0];
        return d ? String(d.name || d.fio).split(' ')[0] : ('#' + uid);
      });
      toast(res.approved ? 'Согласовано всеми директорами' : 'Ваш голос учтён',
        res.approved ? 'Сотруднику ушло уведомление' : 'Осталось: ' + (leftNames.join(', ') || '—'), 'ok');
      closeOverlays();
      await reload(true);
    } catch (e) { setNote('err', e.message); toast('Не удалось согласовать', e.message, 'err'); paint(); }
  }

  async function confirmReject(id) {
    var ta = document.getElementById('vsRejectText');
    var txt = ((ta && ta.value) || '').trim();
    if (!txt) {
      if (ta) { ta.classList.add('is-err'); ta.focus(); }
      toast('Нужен комментарий', 'Без причины отклонять нельзя — сотрудник должен понять, когда взять отпуск', 'err');
      return;
    }
    try {
      await api('POST', '/api/vacations/' + id + '/reject', { reason: txt });
      toast('Не согласовано', 'Дни сняты и заблокированы только у этого сотрудника', 'warn');
      closeOverlays();
      await reload(true);
    } catch (e) { setNote('err', e.message); toast('Не удалось отклонить', e.message, 'err'); paint(); }
  }

  async function revoke(id) {
    try {
      await api('POST', '/api/vacations/' + id + '/revoke');
      toast('Возвращено на согласование', 'Снятые дни разблокированы', 'ok');
      closeOverlays();
      await reload(true);
    } catch (e) { setNote('err', e.message); toast('Не удалось вернуть', e.message, 'err'); paint(); }
  }

  async function approveAll() {
    if (!S.isDirector) return;
    try {
      var res = await api('POST', '/api/vacations/approve-all', { year: S.year });
      toast('Согласовано', (res.approved || 0) + ' ' + plural(res.approved || 0, 'период', 'периода', 'периодов') + ' подтверждено всеми директорами', 'ok');
      setNote('ok', 'Все отправленные периоды согласованы — можно закрывать график.');
      await reload(true);
    } catch (e) { setNote('err', e.message); toast('Не удалось согласовать всё', e.message, 'err'); paint(); }
  }

  async function closeSchedule() {
    if (!S.isDirector) return;
    if (!window.confirm('Закрыть график отпусков на ' + S.year + ' год? Редактирование отключится у всех.')) return;
    try {
      await api('POST', '/api/vacations/close', { year: S.year });
      toast('График закрыт', 'Редактирование отключено у всех', 'warn');
      await reload(true);
    } catch (e) { setNote('err', e.message); toast('Не удалось закрыть', e.message, 'err'); paint(); }
  }

  async function saveBalances() {
    var items = [];
    $$('[data-buh-avail]').forEach(function (inp) {
      var id = Number(inp.getAttribute('data-buh-avail'));
      var carry = document.querySelector('[data-buh-carry="' + id + '"]');
      items.push({
        employee_id: id,
        available_days: Math.max(0, parseInt(inp.value, 10) || 0),
        carry_over_days: Math.max(0, parseInt(carry && carry.value, 10) || 0)
      });
    });
    if (!items.length) return;
    try {
      var res = await api('PUT', '/api/vacations/balances', { year: S.year, items: items });
      toast('Сохранено', 'Балансы обновлены: ' + (res.saved || items.length) + ' ' + plural(res.saved || items.length, 'сотрудник', 'сотрудника', 'сотрудников'), 'ok');
      await reload(true);
    } catch (e) { setNote('err', e.message); toast('Не удалось сохранить', e.message, 'err'); paint(); }
  }

  async function downloadDoc(kind) {
    var url = '/api/vacations/docs/' + kind + '?year=' + S.year;
    if ((kind === 'zayav' || kind === 'prikaz') && S.docVac) url += '&vacation_id=' + encodeURIComponent(S.docVac);
    try {
      var res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token() } });
      if (!res.ok) {
        var msg = 'Сервер вернул ' + res.status;
        try { var j = await res.json(); msg = j.message || j.error || msg; } catch (_) { }
        setNote('err', msg); toast('Не удалось скачать', msg, 'err'); paint();
        return;
      }
      var blob = await res.blob();
      var name = kind + '-' + S.year + '.docx';
      var cd = res.headers.get('Content-Disposition') || '';
      var m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
      if (m && m[1]) name = decodeURIComponent(m[1].replace(/^"|"$/g, ''));
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      toast('Скачано', name, 'ok');
      setNote('ok', 'Файл «' + name + '» сформирован из данных графика (' + S.year + ').');
      paint();
    } catch (e) { setNote('err', e.message); toast('Не удалось скачать', e.message, 'err'); paint(); }
  }

  /* ── Рисование ─────────────────────────────────────────────────────────── */
  function screenHtml() {
    if (S.loading) {
      return '<div class="vs-stage"><div class="vs-modal"><div class="vs-mhead">' +
        '<div class="vs-mhead__ic">' + IC.cal + '</div>' +
        '<div class="vs-mhead__tx"><div class="vs-mhead__t">График отпусков · загрузка…</div>' +
        '<div class="vs-mhead__s">Запрашиваем данные API /api/vacations</div></div>' +
        '<button type="button" class="vsp-x vs-mhead__x" data-vs-close-modal title="Закрыть">' + IC.x + '</button>' +
        '</div>' +
        '<div style="padding:40px;text-align:center;color:var(--t3)">Загрузка…</div></div></div>';
    }
    if (S.loadError) {
      return '<div class="vs-stage"><div class="vs-modal">' +
        '<div class="vs-mhead"><div class="vs-mhead__ic">' + IC.warn + '</div>' +
        '<div class="vs-mhead__tx"><div class="vs-mhead__t">График отпусков</div>' +
        '<div class="vs-mhead__s">Данные не получены</div></div>' +
        '<div class="vs-mhead__acts"><button class="btn ghost sm" data-vs-reload>' + ic('refresh') + 'Повторить</button></div>' +
        '<button type="button" class="vsp-x vs-mhead__x" data-vs-close-modal title="Закрыть">' + IC.x + '</button>' +
        '</div>' +
        '<div class="vs-note vs-note--err">' + ic('warn') + esc(S.loadError) + '</div>' +
        '</div></div>';
    }
    if (S.tab === 'buh') return buhScreen();
    if (S.tab === 'docs') return docsScreen();
    return scheduleScreen();
  }

  function paint() {
    var root = document.getElementById('vsRoot');
    if (!root) return;
    root.innerHTML = screenHtml();
    bindCarryWarn();
  }

  function bindCarryWarn() {
    $$('[data-buh-carry]').forEach(function (inp) {
      var paintWarn = function () {
        inp.classList.toggle('is-warn', (parseInt(inp.value, 10) || 0) > S.carryOverMax);
      };
      inp.addEventListener('input', paintWarn);
      paintWarn();
    });
  }

  /* ── Обработчики (делегирование; навешиваются один раз) ──────────────── */
  /** Работаем только если на странице есть наш корень или наш оверлей —
      чтобы не вмешиваться в клики других страниц CRM. */
  function onDocClick(ev) {
    if (!document.getElementById('vsRoot') && !document.querySelector('.vsp-ov[data-vs-ov]')) return;
    handleClick(ev);
  }

  function handleClick(ev) {
    var el = ev.target.closest ? ev.target.closest('[data-vs-tab],[data-year],[data-month],[data-day],[data-period],[data-vs-hide],[data-vs-unhide],[data-vs-hidegroup],[data-vs-unhidegroup],[data-vs-dept-only],[data-vs-show-all],[data-vs-hide-all],[data-vs-why],[data-vs-blocked],[data-vs-clear],[data-vs-save],[data-vs-rules],[data-vs-reload],[data-vs-approve-all],[data-vs-close-graph],[data-vs-decide],[data-vs-reject-confirm],[data-vs-revoke],[data-vs-edit],[data-vs-cancel],[data-vs-buh-save],[data-vs-doc],[data-vs-close-overlay],[data-vs-close-modal]') : null;

    if (!el) {
      // клик мимо шита — закрыть оверлей
      var ct = classTarget(ev);
      if (ct && ct.classList && ct.classList.contains('vsp-ov')) closeOverlays();
      return;
    }
    var a = function (k) { return el.hasAttribute(k) ? el.getAttribute(k) : null; };

    if (a('data-vs-close-overlay') !== null) { closeOverlays(); return; }
    if (a('data-vs-close-modal') !== null) { closeSchedulePage(); return; }
    if (a('data-vs-tab') !== null) { S.tab = a('data-vs-tab'); S.note = null; closeOverlays(); paint(); return; }
    if (a('data-year') !== null) {
      S.year = S.year + Number(a('data-year'));
      S.openMonth = null; S.sel = {}; S.editingId = null; S.docVac = null; S.pending = null; setNote(null, null);
      reload(); return;
    }
    if (a('data-vs-reload') !== null) { reload(true); return; }
    if (a('data-vs-rules') !== null) { rulesModal(); return; }
    if (a('data-month') !== null) {
      var m = Number(a('data-month'));
      if (S.openMonth === m) { S.openMonth = null; } else { S.openMonth = m; S.sel = {}; S.editingId = null; }
      paint(); return;
    }
    if (a('data-day') !== null) {
      var d = a('data-day'), emp = Number(a('data-emp'));
      if (!canEditDays() || !isMine(emp)) { toast('Это чужие дни', 'Править можно только свои дни', 'warn'); return; }
      if (S.blocked.indexOf(d) >= 0) { toast('Эти дни недоступны', 'Директор не согласовал их — поставьте другие дни', 'err'); return; }
      if (S.sel[d]) delete S.sel[d]; else S.sel[d] = true;
      paint(); return;
    }
    if (a('data-vs-why') !== null) { toast('Чужой период', a('data-vs-why') || 'Видно всем, правит только владелец', 'warn'); return; }
    if (a('data-vs-blocked') !== null) { toast('Эти дни недоступны', 'Директор не согласовал их — поставьте другие дни', 'err'); return; }
    if (a('data-period') !== null) { periodModal(a('data-period'), a('data-emp')); return; }
    if (a('data-vs-hide') !== null) {
      S.hiddenPeople[Number(a('data-vs-hide'))] = true;
      var p = rosterCache.filter(function (x) { return Number(x.id) === Number(a('data-vs-hide')); })[0];
      toast('Скрыт', (p ? String(p.fio).split(' ')[0] : 'сотрудник') + ' — строка скрыта', 'warn');
      paint(); return;
    }
    if (a('data-vs-unhide') !== null) { delete S.hiddenPeople[Number(a('data-vs-unhide'))]; paint(); return; }
    if (a('data-vs-hidegroup') !== null) { S.hiddenGroups[a('data-vs-hidegroup')] = true; paint(); return; }
    if (a('data-vs-unhidegroup') !== null) { delete S.hiddenGroups[a('data-vs-unhidegroup')]; paint(); return; }
    if (a('data-vs-dept-only') !== null) {
      S.deptOnly = !S.deptOnly;
      if (S.deptOnly) { S.hiddenGroups = {}; S.hiddenPeople = {}; S.hideAll = false; }
      toast(S.deptOnly ? 'Только мой отдел' : 'Все отделы',
        S.deptOnly ? 'Показаны сотрудники отдела «' + groupTitleOf(groupKeyOf(S.myRole)) + '»' : 'Строки всех отделов возвращены', 'ok');
      paint(); return;
    }
    if (a('data-vs-hide-all') !== null) { S.hideAll = true; S.deptOnly = false; S.hiddenGroups = {}; S.hiddenPeople = {}; toast('Скрыть всех', 'Нажмите «Показать всех», чтобы вернуть строки', 'warn'); paint(); return; }
    if (a('data-vs-show-all') !== null) { S.hideAll = false; S.hiddenGroups = {}; S.hiddenPeople = {}; S.deptOnly = false; toast('Показать всех', 'Все строки возвращены', 'ok'); paint(); return; }
    if (a('data-vs-clear') !== null) { S.sel = {}; S.editingId = null; paint(); return; }
    if (a('data-vs-save') !== null) { savePeriod(); return; }
    if (a('data-vs-submit') !== null) { submitAllMine(); return; }
    if (a('data-vs-approve-all') !== null) { approveAll(); return; }
    if (a('data-vs-close-graph') !== null) { closeSchedule(); return; }
    if (a('data-vs-decide') !== null) {
      var pr = String(a('data-vs-decide')).split('|');
      decide(pr[0], pr[1]); return;
    }
    if (a('data-vs-reject-confirm') !== null) { confirmReject(a('data-vs-reject-confirm')); return; }
    if (a('data-vs-revoke') !== null) { revoke(a('data-vs-revoke')); return; }
    if (a('data-vs-edit') !== null) { startEdit(a('data-vs-edit')); return; }
    if (a('data-vs-cancel') !== null) {
      if (window.confirm('Снять период? Дни вернутся в баланс.')) cancelPeriod(a('data-vs-cancel'));
      return;
    }
    if (a('data-vs-buh-save') !== null) { saveBalances(); return; }
    if (a('data-vs-doc') !== null) { downloadDoc(a('data-vs-doc')); return; }
  }

  function onDocKeydown(ev) {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    var d = ev.target && ev.target.closest ? ev.target.closest('[data-day]') : null;
    if (!d) return;
    ev.preventDefault();
    d.click();
  }

  /** SVG-иконка внутри кнопки не имеет .classList — нормализуем цель. */
  function classTarget(ev) {
    var t = ev.target;
    return (t && t.classList) ? t : (t && t.parentElement) || null;
  }

  /* ── Точка входа ───────────────────────────────────────────────────────── */
  async function render({ layout, title } = {}) {
    var auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }
    var user = auth.user || {};
    S.myUserId = user.id;
    S.myRole = roleOf(user.role);
    S.isDirector = !!(window.AsgardAuth && AsgardAuth.isDirectorRole && AsgardAuth.isDirectorRole(S.myRole));
    S.isBuh = S.myRole === 'BUH' || S.myRole === 'ADMIN';
    S.tab = 'me';
    S.note = null;
    if (!S.year) {
      // Планируем следующий год, когда окно внесения уже близко (окт–дек).
      var now = new Date();
      S.year = now.getMonth() + 1 >= 10 ? now.getFullYear() + 1 : now.getFullYear();
    }

    await layout('<div id="vsRoot"></div>', { title: title || 'График отпусков (офис)' });

    if (!window.__vacationScheduleBound) {
      window.__vacationScheduleBound = true;
      document.addEventListener('click', onDocClick);
      document.addEventListener('keydown', onDocKeydown);
      document.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') closeOverlays();
      });
    }
    await reload();
  }

  return { render: render };
})();
