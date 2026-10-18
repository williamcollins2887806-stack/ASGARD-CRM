/* ASGARD CRM — прототип графика отпусков (офис).
   Мок-данные на реальных ролях CRM (см. src/routes/users.js) и структуре сотрудников офиса.
   Год — 2027. Дни — КАЛЕНДАРНЫЕ. Согласовывают ВСЕ директора. */
window.VS_DATA = (function () {
  'use strict';

  var YEAR = 2027;
  var MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  var MONTHS_GEN = ['января','февраля','марта','апреля','мая','июня',
                    'июля','августа','сентября','октября','ноября','декабря'];
  var WEEKDAYS = ['пн','вт','ср','чт','пт','сб','вс'];

  /* ── Правила (ТЗ заказчика) ────────────────────────────────────────────
     • 14 календарных дней разом — один раз в год;
     • остальные отпуска — не более 7 календарных дней;
     • дни считаются КАЛЕНДАРНЫМИ;
     • сотрудник правит только свои дни, видит всех;
     • согласовывают все директора, отклонение — с обязательным комментарием. */
  var RULES = {
    yearlyLimit: 42,      // максимум, что можно поставить за год (определяется балансом)
    singleMax: 14,        // разом один раз в год
    otherMax: 7,          // остальные отпуска
    singlePerYear: 1,     // сколько «длинных» отпусков разрешено
    maxParts: 6,          // максимум периодов за год
    noticeDays: 15        // за сколько дней директору уходит письмо по конкретному отпуску
  };

  /* ── Должности/роли (русские подписи, как в CRM) ─────────────────────── */
  var ROLE_RU = {
    DIRECTOR_GEN:  'Генеральный директор',
    DIRECTOR_COMM: 'Коммерческий директор',
    DIRECTOR_DEV:  'Директор по развитию',
    PM:            'Руководитель проектов',
    HEAD_PM:       'Главный РП',
    BUH:           'Главный бухгалтер',
    BUH_DEP:       'Бухгалтер',
    TO:            'Тендерный специалист',
    HEAD_TO:       'Руководитель тендерного отдела',
    HR:            'Кадры',
    HR_MANAGER:    'Директор по кадрам',
    OFFICE_MANAGER:'Офис-менеджер',
    PROC:          'Закупки',
    WAREHOUSE:     'Кладовщик',
    CHIEF_ENGINEER:'Главный инженер'
  };

  /* ── Сотрудники офиса, сгруппированные по отделам ──────────────────────
     Порядок групп: Дирекция → Руководители проектов → Бухгалтерия →
     Тендерный отдел → Кадры → Офис / снабжение. */
  var me = { id: 5015, fio: 'Андросов Никита Андреевич', role: 'PM' };

  var GROUPS = [
    { key: 'dir',  title: 'Дирекция', members: [
      { id: 5001, fio: 'Гажилиев Олег Викторович', role: 'DIRECTOR_COMM' },
      { id: 5002, fio: 'Кудряшов Олег Сергеевич',  role: 'DIRECTOR_GEN' },
      { id: 5003, fio: 'Черепанов Виктор Эдуардович', role: 'DIRECTOR_DEV' }
    ]},
    { key: 'pm',   title: 'Руководители проектов', members: [
      { id: 5015, fio: 'Андросов Никита Андреевич', role: 'PM' },
      { id: 5016, fio: 'Морозов Игорь Валентинович', role: 'PM' },
      { id: 5017, fio: 'Петров Андрей Леонидович',  role: 'PM' },
      { id: 5018, fio: 'Трухин Антон Сергеевич',    role: 'HEAD_PM' },
      { id: 5019, fio: 'Людкевич Андрей Игоревич',  role: 'PM' }
    ]},
    { key: 'buh',  title: 'Бухгалтерия', members: [
      { id: 5004, fio: 'Ольга Викторовна (главбух)', role: 'BUH' },
      { id: 5020, fio: 'Путков Дмитрий Александрович', role: 'BUH_DEP' }
    ]},
    { key: 'to',   title: 'Тендерный отдел', members: [
      { id: 5005, fio: 'Соколов Роман Павлович',   role: 'HEAD_TO' },
      { id: 5021, fio: 'Китуашвили Никон Сергеевич', role: 'TO' }
    ]},
    { key: 'hr',   title: 'Кадры', members: [
      { id: 5006, fio: 'Лебедева Ирина Петровна',  role: 'HR_MANAGER' }
    ]},
    { key: 'office', title: 'Офис и снабжение', members: [
      { id: 5007, fio: 'Новиков Игорь Олегович',   role: 'OFFICE_MANAGER' },
      { id: 5022, fio: 'Ермошин Артем Степанович', role: 'PROC' }
    ]}
  ];

  var ALL = [];
  GROUPS.forEach(function (g) {
    g.members.forEach(function (m) { m.group = g.key; m.groupTitle = g.title; ALL.push(m); });
  });
  function byId(id) { for (var i = 0; i < ALL.length; i++) if (ALL[i].id === id) return ALL[i]; return null; }
  function roleRu(r) { return ROLE_RU[r] || r; }
  function groupOf(id) { var e = byId(id); return e ? e.group : 'office'; }

  /* ── Дни: баланс сотрудника ──────────────────────────────────────────
     availableOnJan1  — доступно дней на 01.01.2027 (28 за год + переносы);
     lastYearUnused   — не отгулено за 2026 (переносится и подсвечивается отдельно). */
  var DAYS = {
    5015: { availableOnJan1: 42, lastYearUnused: 0 },   // я (Андросов)
    5016: { availableOnJan1: 38, lastYearUnused: 10 },
    5017: { availableOnJan1: 42, lastYearUnused: 0 },
    5018: { availableOnJan1: 35, lastYearUnused: 7 },
    5019: { availableOnJan1: 42, lastYearUnused: 0 },
    5001: { availableOnJan1: 42, lastYearUnused: 0 },
    5002: { availableOnJan1: 42, lastYearUnused: 0 },
    5003: { availableOnJan1: 35, lastYearUnused: 7 },
    5004: { availableOnJan1: 42, lastYearUnused: 0 },
    5020: { availableOnJan1: 42, lastYearUnused: 0 },
    5005: { availableOnJan1: 35, lastYearUnused: 7 },
    5021: { availableOnJan1: 42, lastYearUnused: 0 },
    5006: { availableOnJan1: 35, lastYearUnused: 7 },
    5007: { availableOnJan1: 42, lastYearUnused: 0 },
    5022: { availableOnJan1: 35, lastYearUnused: 7 }
  };

  /* ── Даты ────────────────────────────────────────────────────────────── */
  function pad(n) { return String(n).padStart(2, '0'); }
  function iso(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }   // m — 0-based
  function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
  function isWeekend(y, m, d) { var g = new Date(y, m, d).getDay(); return g === 0 || g === 6; }
  function parseIso(s) { var p = s.split('-'); return { y: +p[0], m: +p[1] - 1, d: +p[2] }; }
  function fmtDay(isoStr) { var p = parseIso(isoStr); return p.d + ' ' + MONTHS_GEN[p.m]; }
  function fmtRange(a, b) { return fmtDay(a) + ' — ' + fmtDay(b) + ' ' + YEAR; }
  /** Кол-во календарных дней в диапазоне включительно. */
  function daysBetween(a, b) {
    var A = parseIso(a), B = parseIso(b);
    return Math.round((Date.UTC(B.y, B.m, B.d) - Date.UTC(A.y, A.m, A.d)) / 86400000) + 1;
  }
  /** Каждый день диапазона → ['YYYY-MM-DD', ...]. Часовой пояс не сдвигает даты (UTC). */
  function expand(a, b) {
    return rangeDays(a, b);
  }
  /** Явный диапазон дат (без обращения к VAC) — используется валидатором. */
  function rangeDays(a, b) {
    var A = parseIso(a), B = parseIso(b);
    var out = [], cur = Date.UTC(A.y, A.m, A.d), end = Date.UTC(B.y, B.m, B.d);
    while (cur <= end) { out.push(new Date(cur).toISOString().slice(0, 10)); cur += 86400000; }
    return out;
  }
  /** Месяц (0-based) по iso → 0..11 (если диапазон через год — обрезаем по году). */
  function monthOf(isoStr) { return parseIso(isoStr).m; }

  /* ── Статусы периодов ────────────────────────────────────────────────── */
  var ST = {
    approved: { label: 'Согласовано', cls: 'vs-st--ok',       short: 'согл.' },
    pending:  { label: 'Ждёт согласования', cls: 'vs-st--pend', short: 'ждёт' },
    rejected: { label: 'Не согласовано', cls: 'vs-st--bad',   short: 'отказ' },
    draft:    { label: 'Черновик', cls: 'vs-st--draft',       short: 'черновик' }
  };

  /* ── Периоды отпусков (сид) ────────────────────────────────────────────
     kind: 'long' (до 14) | 'short' (до 7) — вычисляется автоматически. */
  var _seq = 7000;
  var VAC = {};   // empId -> [ {id, start, end, days, status, reason?, comment?, decided_by?, submitted_at?} ]
  function addRange(empId, start, end, status, extra) {
    var r = {
      id: 'R' + (_seq++), start: start, end: end, days: daysBetween(start, end),
      status: status || 'approved'
    };
    if (extra) for (var k in extra) r[k] = extra[k];
    if (!VAC[empId]) VAC[empId] = [];
    VAC[empId].push(r);
    return r;
  }

  // Дирекция
  addRange(5001, '2027-07-13', '2027-07-26', 'approved', { comment: 'Отпуск руководителя', submitted_at: '01.12.2026' });
  addRange(5002, '2027-08-09', '2027-08-22', 'approved', { submitted_at: '01.12.2026' });
  addRange(5003, '2027-06-07', '2027-06-13', 'approved', { submitted_at: '02.12.2026' });

  // Руководители проектов
  addRange(5016, '2027-01-12', '2027-01-18', 'approved', { submitted_at: '28.11.2026' });  // 7
  addRange(5018, '2027-09-01', '2027-09-10', 'approved', { submitted_at: '28.11.2026' });  // 10
  addRange(5019, '2027-04-19', '2027-04-25', 'approved', { submitted_at: '01.12.2026' });  // 7
  addRange(5017, '2027-08-03', '2027-08-09', 'pending',  { submitted_at: '12.01.2027' });  // 7 — на решении
  // Я: уже согласованный короткий в феврале (директор сможет убрать в демо) + новый в мае
  addRange(5015, '2027-02-03', '2027-02-09', 'approved', { submitted_at: '27.11.2026' });  // 7
  addRange(5015, '2027-05-01', '2027-05-14', 'pending',  { submitted_at: '15.01.2027' });  // 14 — на решении

  // Бухгалтерия
  addRange(5020, '2027-02-15', '2027-02-21', 'approved', { submitted_at: '29.11.2026' });  // 7
  addRange(5004, '2027-04-06', '2027-04-12', 'approved', { submitted_at: '29.11.2026' });  // 7
  addRange(5004, '2027-05-10', '2027-05-16', 'approved', { submitted_at: '01.12.2026' });  // 7 — попадёт в график офиса (май)

  // Тендерный отдел
  addRange(5005, '2027-03-02', '2027-03-08', 'approved', { submitted_at: '30.11.2026' });  // 7
  addRange(5021, '2027-06-14', '2027-06-27', 'approved', { submitted_at: '30.11.2026' });  // 14

  // Кадры
  addRange(5006, '2027-10-05', '2027-10-11', 'approved', { submitted_at: '01.12.2026' });  // 7

  // Офис
  addRange(5007, '2027-11-09', '2027-11-15', 'pending',  { submitted_at: '13.01.2027' });  // 7 — на решении
  addRange(5022, '2027-12-21', '2027-12-31', 'approved', { submitted_at: '02.12.2026' });  // 11
  addRange(5022, '2027-05-04', '2027-05-08', 'approved', { submitted_at: '01.12.2026' });  // 5 — май, для наложения

  /* ── Помощники по периодам ───────────────────────────────────────────── */
  function rangesOf(empId) { return VAC[empId] || []; }
  function rangesOfMonth(empId, m) {
    return rangesOf(empId).filter(function (r) {
      return expand(r.start, r.end).some(function (d) { return monthOf(d) === m; });
    });
  }
  /** Дни периода, попадающие в конкретный месяц. */
  function rangeDaysInMonth(r, m) {
    return expand(r.start, r.end).filter(function (d) { return monthOf(d) === m; }).length;
  }
  /** Планируемые (не отклонённые) дни сотрудника за год. */
  function plannedDays(empId, statuses) {
    return rangesOf(empId).reduce(function (s, r) {
      if (statuses && statuses.indexOf(r.status) < 0) return s;
      return s + r.days;
    }, 0);
  }
  /** Баланс сотрудника: доступно, отгуляно (согл.), на согласовании, остаток. */
  function balance(empId) {
    var d = DAYS[empId] || { availableOnJan1: 42, lastYearUnused: 0 };
    var approved = plannedDays(empId, ['approved']);
    var pending = plannedDays(empId, ['pending']);
    var rejected = plannedDays(empId, ['rejected']);
    var left = d.availableOnJan1 - approved - pending;
    return {
      availableOnJan1: d.availableOnJan1,
      lastYearUnused: d.lastYearUnused,
      approved: approved,
      pending: pending,
      rejected: rejected,
      plannedTotal: approved + pending,
      left: left,
      leftByPending: d.availableOnJan1 - pending   // «сколько ещё можно взять» с учётом уже отправленного
    };
  }
  /** Сколько «длинных» (14-дневных) отпусков уже занято. */
  function longCount(empId) {
    return rangesOf(empId).filter(function (r) { return r.status !== 'rejected' && r.days >= RULES.singleMax; }).length;
  }
  /** Занятость сотрудников отдела в месяце (кто, когда). */
  function deptBusy(group, m) {
    var out = [];
    GROUPS.forEach(function (g) {
      if (g.key !== group) return;
      g.members.forEach(function (mem) {
        rangesOf(mem.id).forEach(function (r) {
          if (r.status === 'rejected') return;
          if (expand(r.start, r.end).some(function (d) { return monthOf(d) === m; })) {
            out.push({ empId: mem.id, fio: mem.fio, role: mem.role, start: r.start, end: r.end, days: r.days, status: r.status });
          }
        });
      });
    });
    return out;
  }

  /** Кто в месяце в отпуске (все отделы) — для колонки «Занято». */
  function busyInMonth(m) {
    var out = [];
    ALL.forEach(function (mem) {
      rangesOf(mem.id).forEach(function (r) {
        if (r.status === 'rejected') return;
        var ds = expand(r.start, r.end).filter(function (d) { return monthOf(d) === m; });
        if (ds.length) out.push({ empId: mem.id, fio: mem.fio, role: mem.role, group: mem.group, start: r.start, end: r.end, days: ds.length, status: r.status });
      });
    });
    return out;
  }

  /* ── Проверка нового периода ─────────────────────────────────────────── */
  /** Валидация диапазона для сотрудника. Возвращает {ok, code, msg}. */
  function validate(empId, start, end, opts) {
    opts = opts || {};
    var curId = opts.ignoreId || null;
    if (!start || !end) return { ok: false, code: 'empty', msg: 'Выберите дни в календаре', days: 0 };
    if (end < start) return { ok: false, code: 'order', msg: 'Дата окончания раньше начала', days: 0 };
    var days = daysBetween(start, end);
    function fail(code, msg) { return { ok: false, code: code, msg: msg, days: days }; }
    if (days <= 0) return fail('days', 'Период пустой');

    var b = balance(empId);

    // пересечение с любыми своими периодами (кроме отклонённых и игнорируемого)
    var clash = null;
    rangesOf(empId).forEach(function (r) {
      if (r.id === curId || r.status === 'rejected') return;
      if (!(end < r.start || start > r.end)) clash = r;
    });
    if (clash) return fail('overlap', 'Пересекается с вашим периодом: ' + fmtRange(clash.start, clash.end));

    // лимит «14 разом один раз»
    if (days > RULES.singleMax) {
      return fail('too_long', 'Разом можно не больше ' + RULES.singleMax + ' календарных дней');
    }
    var isLong = days >= RULES.singleMax;
    if (days > RULES.otherMax && !isLong) {
      return fail('other_max', 'Кроме основного отпуска — не больше ' + RULES.otherMax + ' дней');
    }
    if (isLong && longCount(empId) >= RULES.singlePerYear && curId === null) {
      return fail('single_used', 'Отпуск на ' + RULES.singleMax + ' дней уже использован в этом году');
    }
    // дней не больше остатка
    if (b.left < days) {
      return fail('no_days', 'Дни закончились: осталось ' + Math.max(0, b.left) + ' из ' + b.availableOnJan1);
    }
    // отклонённые директором дни: повторно поставить нельзя
    if (opts.blocked && opts.blocked.length) {
      var hitBlocks = [];
      rangeDays(start, end).forEach(function (d) { if (opts.blocked.indexOf(d) >= 0) hitBlocks.push(d); });
      if (hitBlocks.length) {
        return fail('blocked', 'Директор не согласовал ' + hitBlocks.length + ' из этих дней — поставьте другие даты');
      }
    }
    // максимум частей
    var activeRanges = rangesOf(empId).filter(function (r) { return r.status !== 'rejected' && r.id !== curId; }).length;
    if (activeRanges >= RULES.maxParts) {
      return fail('parts', 'Не больше ' + RULES.maxParts + ' периодов за год');
    }
    // границы года
    if (start < '2027-01-01' || start > '2027-12-31') {
      return fail('year', 'График только на ' + YEAR + ' год');
    }
    return { ok: true, code: 'ok', days: days, isLong: isLong };
  }

  /** Отклонённые директором дни (глобально, из состояния прототипа). */
  function blockedDays() {
    var bl = (window.VS_STATE && window.VS_STATE.blocked) || {};
    return Object.keys(bl).filter(function (k) { return bl[k]; });
  }

  /** Есть ли у сотрудника хоть один период в месяце (для значка при свёрнутом месяце). */
  function monthMark(empId, m) {
    var rs = rangesOfMonth(empId, m);
    if (!rs.length) return null;
    var days = rs.reduce(function (s, r) { return s + rangeDaysInMonth(r, m); }, 0);
    var hasPending = rs.some(function (r) { return r.status === 'pending'; });
    var hasRejected = rs.some(function (r) { return r.status === 'rejected'; });
    return { days: days, count: rs.length, pending: hasPending, rejected: hasRejected, status: hasPending ? 'pending' : (hasRejected && !rs.some(function (r) { return r.status !== 'rejected'; }) ? 'rejected' : 'approved') };
  }

  return {
    YEAR: YEAR, MONTHS: MONTHS, MONTHS_GEN: MONTHS_GEN, WEEKDAYS: WEEKDAYS,
    RULES: RULES, ROLE_RU: ROLE_RU, GROUPS: GROUPS, ALL: ALL, ST: ST,
    me: me,
    byId: byId, roleRu: roleRu, groupOf: groupOf,
    DAYS: DAYS, VAC: VAC,
    iso: iso, pad: pad, daysInMonth: daysInMonth, isWeekend: isWeekend,
    fmtDay: fmtDay, fmtRange: fmtRange, daysBetween: daysBetween, expand: expand, rangeDays: rangeDays, monthOf: monthOf, parseIso: parseIso,
    rangesOf: rangesOf, rangesOfMonth: rangesOfMonth, rangeDaysInMonth: rangeDaysInMonth,
    plannedDays: plannedDays, balance: balance, longCount: longCount,
    deptBusy: deptBusy, busyInMonth: busyInMonth, validate: validate, monthMark: monthMark, blockedDays: blockedDays
  };
})();
