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

  /* ── Производственный календарь 2027 (РФ) ─────────────────────────────
     Праздничные НЕРАБОЧИЕ дни по ст. 112 ТК РФ. Эти дни в число календарных
     дней отпуска НЕ входят и продлевают отпуск (ст. 120 ТК РФ).
     Переносы 2027 (официальное постановление на момент вёрстки не опубликовано)
     отмечены как ПРОЕКТНЫЕ — перед выкаткой сверить с постановлением. */
  var HOLIDAYS_2027_RAW = [
    { from: '2027-01-01', to: '2027-01-08', title: 'Новогодние каникулы', note: 'ст. 112 ТК РФ' },
    { from: '2027-01-07', to: '2027-01-07', title: 'Рождество Христово', note: 'входит в каникулы' },
    { from: '2027-02-23', to: '2027-02-23', title: 'День защитника Отечества' },
    { from: '2027-03-08', to: '2027-03-08', title: 'Международный женский день' },
    { from: '2027-05-01', to: '2027-05-01', title: 'Праздник Весны и Труда' },
    { from: '2027-05-09', to: '2027-05-09', title: 'День Победы' },
    { from: '2027-06-12', to: '2027-06-12', title: 'День России' },
    { from: '2027-11-04', to: '2027-11-04', title: 'День народного единства' }
  ];

  /* Переносы выходных (проект, сверять с постановлением Правительства РФ). */
  var SHIFTS_2027_RAW = [
    { from: '2027-01-02', to: '2027-05-03', title: 'перенос с 2 января (сб)', draft: true },
    { from: '2027-01-03', to: '2027-05-04', title: 'перенос с 3 января (вс)', draft: true },
    { from: '2027-02-20', to: '2027-02-22', title: 'перенос с 20 февраля (сб)', draft: true },
    { from: '2027-11-06', to: '2027-11-08', title: 'перенос с 6 ноября (сб)', draft: true }
  ];

  /** Множество нерабочих праздничных дней 'YYYY-MM-DD'. */
  var HOLIDAYS = {};
  function _rangeHoliday(a, b, title) {
    rangeDays(a, b).forEach(function (d) { HOLIDAYS[d] = true; HOLIDAY_TITLES[d] = title; });
  }
  var HOLIDAY_TITLES = {};
  /** Перенесённые выходные (нерабочие, но НЕ продлевают отпуск — это не праздник ст. 112). */
  var SHIFT_DAYS = {};
  var SHIFT_TITLES = {};

  HOLIDAYS_2027_RAW.forEach(function (h) { _rangeHoliday(h.from, h.to, h.title); });
  SHIFTS_2027_RAW.forEach(function (s) { SHIFT_DAYS[s.to] = true; SHIFT_TITLES[s.to] = s.title; });

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
    noticeDays: 15,       // за сколько дней директору уходит письмо по конкретному отпуску
    planStart: '2026-11-01',   // с 1 ноября сотрудники вносят график на 2027
    planDeadline: '2026-12-01',// до 1 декабря график должен быть закрыт
    today: '2026-11-18',       // «сегодня» для прототипа (внутри окна внесения)
    remindEveryHours: 24,      // напоминание директору раз в сутки
    remindMax: 3,              // не больше 3 писем
    autoCancelAfter: 3,        // после 3-го письма без ответа — автоснятие
    carryOverMax: 12           // ст. 124 ТК РФ: перенос не более 12 дней
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

  /* ── Праздники, производственный календарь ──────────────────────────── */
  function isHoliday(isoStr) { return !!HOLIDAYS[isoStr]; }
  function holidayTitle(isoStr) { return HOLIDAY_TITLES[isoStr] || ''; }
  function isShifted(isoStr) { return !!SHIFT_DAYS[isoStr]; }
  function shiftTitle(isoStr) { return SHIFT_TITLES[isoStr] || ''; }
  /** Праздники, попавшие в диапазон. */
  function holidaysIn(a, b) {
    return rangeDays(a, b).filter(function (d) { return isHoliday(d); });
  }
  /** Оплачиваемые календарные дни отпуска: календарные МИНУС праздники ст. 112 (ст. 120 ТК). */
  function chargedDays(a, b) {
    return rangeDays(a, b).filter(function (d) { return !isHoliday(d); }).length;
  }
  /** Продлить конец периода, чтобы «оплачиваемых» дней стало need (праздники продлевают отпуск). */
  function extendEnd(start, need) {
    var p = parseIso(start), cur = Date.UTC(p.y, p.m, p.d), got = 0;
    while (true) {
      var iso2 = new Date(cur).toISOString().slice(0, 10);
      if (!isHoliday(iso2)) got++;
      if (got >= need) return iso2;
      cur += 86400000;
    }
  }
  /** Подпись праздников диапазона: «1 мая — Праздник Весны и Труда». */
  function holidayNote(a, b) {
    return holidaysIn(a, b).map(function (d) {
      var p = parseIso(d);
      return p.d + ' ' + MONTHS_GEN[p.m] + ' — ' + (holidayTitle(d) || 'праздник');
    });
  }

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
      id: 'R' + (_seq++), start: start, end: end, days: chargedDays(start, end),
      calDays: daysBetween(start, end), hol: holidaysIn(start, end).length,
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
  addRange(5016, '2027-01-12', '2027-01-18', 'approved', { submitted_at: '28.11.2026' });  // 7 — для демо пересечения
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

  /* ── Согласование всеми директорами ────────────────────────────────────
     Директоров трое; период согласован, когда «за» все трое. */
  var DIRECTORS = [
    { id: 5001, fio: 'Гажилиев Олег Викторович', role: 'DIRECTOR_COMM' },
    { id: 5002, fio: 'Кудряшов Олег Сергеевич',  role: 'DIRECTOR_GEN' },
    { id: 5003, fio: 'Черепанов Виктор Эдуардович', role: 'DIRECTOR_DEV' }
  ];
  function directorById(id) { return DIRECTORS.filter(function (d) { return d.id === id; })[0]; }
  /** Текущий директор (для демо-подписи «вы»). */
  var ME_DIRECTOR = 5002;

  /** Голоса «за» по периоду. */
  function approvesOf(r) { return (r && r.approves) || []; }
  /** Сколько директоров ещё не проголосовало. */
  function directorsLeft(r) {
    return DIRECTORS.filter(function (d) { return approvesOf(r).indexOf(d.id) < 0; });
  }
  /** Итог согласования: сколько из скольких. */
  function approveProgress(r) {
    return { done: approvesOf(r).length, total: DIRECTORS.length, left: directorsLeft(r) };
  }

  /** Отклонённые (снятые) директором дни — храним даты и причину, повторно не поставить. */
  var REJECTED = [];   // [{empId, periodId, days:[iso], reason, by, byId, at}]

  /** Напоминания директору по периоду: 3 письма раз в сутки, затем автоснятие. */
  var REMINDERS = {};  // periodId -> { count, lastAt, autoCancelled }
  function reminderOf(id) {
    if (!REMINDERS[id]) REMINDERS[id] = { count: 0, lastAt: null, autoCancelled: false };
    return REMINDERS[id];
  }

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
  /** Открыто ли окно внесения графика: с 1 ноября до 1 декабря предыдущего года. */
  function windowOpen(dateIso) {
    var now = dateIso || RULES.today;
    return now >= RULES.planStart && now <= RULES.planDeadline;
  }
  /** Дней до дедлайна (отрицательное — просрочено). */
  function daysToDeadline(dateIso) {
    return daysBetween(dateIso || RULES.today, RULES.planDeadline) - 1;
  }

  /**
   * Валидация диапазона для сотрудника. Возвращает {ok, code, msg, days, calDays, hol}.
   * Дни считаются по ст. 120 ТК РФ: календарные МИНУС нерабочие праздники (они продлевают отпуск).
   */
  function validate(empId, start, end, opts) {
    opts = opts || {};
    var curId = opts.ignoreId || null;
    if (!start || !end) return { ok: false, code: 'empty', msg: 'Выберите дни в календаре', days: 0 };
    if (end < start) return { ok: false, code: 'order', msg: 'Дата окончания раньше начала', days: 0 };
    var calDays = daysBetween(start, end);
    var days = chargedDays(start, end);          // оплачиваемые календарные (без праздников)
    var hol = calDays - days;                    // сколько праздников продлевают отпуск
    function fail(code, msg) { return { ok: false, code: code, msg: msg, days: days, calDays: calDays, hol: hol }; }
    if (calDays <= 0) return fail('days', 'Период пустой');
    // весь период — нерабочие праздники: отпускных дней нет, ставить нечего
    if (days <= 0) {
      return fail('all_holidays', 'В эти дни только праздники (' + hol + ') — календарных дней отпуска нет. Выберите другие даты.');
    }
    // границы года — проверяем ОБА конца, иначе период может вылезти за 2027
    if (start < YEAR + '-01-01' || end > YEAR + '-12-31') {
      return fail('year', 'График только на ' + YEAR + ' год — период должен целиком укладываться в год');
    }

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
    return { ok: true, code: 'ok', days: days, calDays: calDays, hol: hol, isLong: isLong, clash: null };
  }

  /**
   * Пересечения с коллегами в диапазоне (для предупреждения, не блокирует постановку).
   * Возвращает [{empId, fio, role, group, title, start, end, days, sameDept, overlapDays}].
   */
  function clashesWith(empId, start, end) {
    var out = [], myGroup = groupOf(empId);
    ALL.forEach(function (e) {
      if (e.id === empId) return;
      rangesOf(e.id).forEach(function (r) {
        if (r.status === 'rejected') return;
        if (end < r.start || start > r.end) return;
        var a = start > r.start ? start : r.start;
        var b = end < r.end ? end : r.end;
        out.push({
          empId: e.id, fio: e.fio, role: e.role, group: e.group, groupTitle: e.groupTitle,
          start: r.start, end: r.end, days: r.days, status: r.status,
          sameDept: e.group === myGroup, overlapDays: daysBetween(a, b)
        });
      });
    });
    // сначала свой отдел, затем по числу пересекающихся дней
    out.sort(function (x, y) {
      if (x.sameDept !== y.sameDept) return x.sameDept ? -1 : 1;
      return y.overlapDays - x.overlapDays;
    });
    return out;
  }


  /** Отклонённые (снятые) дни — блокируются ПО СОТРУДНИКУ, повторно не поставить.
      blockedByEmp: { empId: { 'YYYY-MM-DD': true } } */
  function blockedDays(empId) {
    var st = window.VS_STATE || {};
    var byEmp = st.blockedByEmp || {};
    var mine = byEmp[empId] || {};
    return Object.keys(mine).filter(function (k) { return mine[k]; });
  }
  /** Есть ли конкретный день в блокировке сотрудника. */
  function isBlocked(empId, iso) {
    var st = window.VS_STATE || {};
    return !!(st.blockedByEmp && st.blockedByEmp[empId] && st.blockedByEmp[empId][iso]);
  }

  /** Есть ли у сотрудника хоть один период в месяце (для значка при свёрнутом месяце). */
  function monthMark(empId, m) {
    var rs = rangesOfMonth(empId, m);
    if (!rs.length) return null;
    var days = rs.reduce(function (s, r) { return s + rangeDaysInMonth(r, m); }, 0);
    var hasPending = rs.some(function (r) { return r.status === 'pending'; });
    var hasRejected = rs.some(function (r) { return r.status === 'rejected'; });
    var label = rs.map(function (r) {
      var ds = expand(r.start, r.end).filter(function (d) { return monthOf(d) === m; });
      return ds[0] + '—' + ds[ds.length - 1];
    }).join(', ');
    return {
      days: days, count: rs.length, label: label, pending: hasPending, rejected: hasRejected,
      status: hasPending ? 'pending' : (hasRejected && !rs.some(function (r) { return r.status !== 'rejected'; }) ? 'rejected' : 'approved')
    };
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
    deptBusy: deptBusy, busyInMonth: busyInMonth, validate: validate, monthMark: monthMark,
    blockedDays: blockedDays, isBlocked: isBlocked,
    /* согласование директорами */
    DIRECTORS: DIRECTORS, ME_DIRECTOR: ME_DIRECTOR, directorById: directorById,
    approvesOf: approvesOf, directorsLeft: directorsLeft, approveProgress: approveProgress,
    REJECTED: REJECTED, REMINDERS: REMINDERS, reminderOf: reminderOf,
    /* производственный календарь 2027 */
    HOLIDAYS_2027: HOLIDAYS_2027_RAW, SHIFTS_2027: SHIFTS_2027_RAW,
    isHoliday: isHoliday, holidayTitle: holidayTitle, isShifted: isShifted, shiftTitle: shiftTitle,
    holidaysIn: holidaysIn, holidayNote: holidayNote, chargedDays: chargedDays, extendEnd: extendEnd,
    clashesWith: clashesWith, windowOpen: windowOpen, daysToDeadline: daysToDeadline
  };
})();
