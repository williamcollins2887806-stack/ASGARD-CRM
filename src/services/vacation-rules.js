'use strict';

/**
 * vacation-rules.js — ЕДИНЫЙ ИСТОЧНИК ПРАВДЫ по правилам графика отпусков (офис).
 *
 * Заказчик (17–18.10.2026), сверено с ТЗ и уточнениями в переписке:
 *   • основной отпуск — 14 календарных дней РАЗОМ, один раз в год;
 *   • остальные отпуска — не более 7 календарных дней; не более 6 периодов за год;
 *   • дни считаются КАЛЕНДАРНЫМИ, но нерабочие праздничные дни (ст. 112 ТК РФ)
 *     в отпуск НЕ входят и ПРОДЛЕВАЮТ его (ст. 120 ТК РФ);
 *   • сотрудник правит только свои дни, чужие видит (для планирования без пересечений);
 *   • пересечение с коллегой — предупреждение, НЕ запрет (можно ровно 1-в-1);
 *   • согласовывают ВСЕ директора: период «согласован», когда «за» все;
 *   • при отклонении комментарий обязателен, снятые дни повторно поставить нельзя;
 *   • график вносится с 1 ноября, закрывается до 1 декабря;
 *   • только офис, не полевые рабочие.
 *
 * Модуль НЕ ходит в БД напрямую: календарь и данные передаются аргументами.
 * Это позволяет тестировать правила без базы (см. tests/unit/vacation-rules.test.js)
 * и гарантирует, что UI и сервер говорят одинаковыми текстами ошибок.
 */

const RULES = {
  SINGLE_MAX: 14,         // разом максимум (основной отпуск)
  OTHER_MAX: 7,           // остальные отпуска
  SINGLE_PER_YEAR: 1,     // сколько «длинных» отпусков в год
  MAX_PARTS: 6,           // максимум периодов за год
  NOTICE_DAYS: 15,        // за сколько дней директору уходит письмо
  REMIND_MAX: 3,          // сколько писем-напоминаний
  AUTO_CANCEL_AFTER: 3,   // после какого письма — автоснятие
  CARRY_OVER_MAX: 12,     // ст. 124 ТК РФ: перенос не более 12 дней
  PLAN_START: '11-01',    // с 1 ноября вносим
  PLAN_DEADLINE: '12-01', // до 1 декабря закрываем
};

// ── Коды ответов валидатора (UI показывает те же смыслы) ───────────────────
const CODES = {
  OK: 'ok',
  EMPTY: 'empty',
  ORDER: 'order',
  OUT_OF_YEAR: 'year',
  ALL_HOLIDAYS: 'all_holidays',
  TOO_LONG: 'too_long',
  OTHER_MAX: 'other_max',
  SINGLE_USED: 'single_used',
  NO_DAYS: 'no_days',
  BLOCKED: 'blocked',
  PARTS: 'parts',
  OVERLAP_OWN: 'overlap',
  WINDOW_CLOSED: 'window_closed',
};

// ── Дата-хелперы (строки 'YYYY-MM-DD', UTC — без сдвигов часового пояса) ───
function pad(n) { return String(n).padStart(2, '0'); }
function parseIso(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return { y, m, d };
}
function toIso(dt) { return dt.toISOString().slice(0, 10); }
function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

/** Каждый день диапазона включительно. */
function rangeDays(a, b) {
  const A = parseIso(a), B = parseIso(b);
  const out = [];
  for (let t = Date.UTC(A.y, A.m - 1, A.d), end = Date.UTC(B.y, B.m - 1, B.d); t <= end; t += 86400000) {
    out.push(toIso(new Date(t)));
  }
  return out;
}

/** Кол-во календарных дней в диапазоне включительно. */
function daysBetween(a, b) {
  const A = parseIso(a), B = parseIso(b);
  return Math.round((Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d)) / 86400000) + 1;
}

function fmtDay(iso) {
  const M = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const p = parseIso(iso);
  return p.d + ' ' + M[p.m - 1];
}
function fmtRange(a, b) { return fmtDay(a) + ' — ' + fmtDay(b); }

/**
 * Календарь (передаётся аргументом): { 'YYYY-MM-DD': { is_working:boolean, kind:'holiday'|'shift'|'working' } }
 * Праздник (kind='holiday', is_working=false) — продлевает отпуск (ст. 120 ТК).
 * Перенос (kind='shift') — нерабочий, но НЕ продлевает.
 * 'working' — выходной, ставший рабочим.
 */
function makeCalendar(rows) {
  const cal = Object.create(null);
  (rows || []).forEach((r) => {
    const key = String(r.date).slice(0, 10);
    cal[key] = {
      is_working: r.is_working !== false,
      kind: r.kind || (r.is_working === false ? 'shift' : 'working'),
      title: r.title || r.note || '',
    };
  });
  return cal;
}

/** Нерабочий праздничный день (ст. 112) — именно он продлевает отпуск. */
function isHoliday(cal, iso) {
  const r = cal[iso];
  return !!r && r.kind === 'holiday' && r.is_working === false;
}
/** Любой нерабочий день (праздник, перенос, выходной). */
function isNonWorking(cal, iso) {
  const r = cal[iso];
  if (r && r.kind === 'working') return false;
  if (r && r.is_working === false) return true;
  const p = parseIso(iso);
  const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return dow === 0 || dow === 6;
}
function isWorkingDay(cal, iso) { return !isNonWorking(cal, iso); }

/** Праздники внутри диапазона. */
function holidaysIn(cal, a, b) {
  return rangeDays(a, b).filter((d) => isHoliday(cal, d));
}

/**
 * Оплачиваемые календарные дни отпуска = календарные минус праздники (ст. 120 ТК).
 */
function chargedDays(cal, a, b) {
  return rangeDays(a, b).filter((d) => !isHoliday(cal, d)).length;
}

/** Продлить конец периода так, чтобы оплачиваемых дней стало `need` (праздники продлевают отпуск). */
function extendEnd(cal, start, need) {
  const p = parseIso(start);
  let t = Date.UTC(p.y, p.m - 1, p.d), got = 0;
  // предохранитель от бесконечного цикла
  for (let i = 0; i < 400; i++) {
    const iso = toIso(new Date(t));
    if (!isHoliday(cal, iso)) got++;
    if (got >= need) return iso;
    t += 86400000;
  }
  return toIso(new Date(t));
}

/** Подпись праздников: «1 января — Новогодние каникулы». */
function holidayNote(cal, a, b) {
  return holidaysIn(cal, a, b).map((d) => fmtDay(d) + (cal[d] && cal[d].title ? ' — ' + cal[d].title : ''));
}

// ── Окно внесения графика ──────────────────────────────────────────────────
/** Открыто ли окно внесения: с 1 ноября по 1 декабря года, ПРЕДШЕСТВУЮЩЕГО году графика. */
function windowOpen(year, todayIso) {
  if (!todayIso) return true;
  const today = String(todayIso).slice(0, 10);
  return today >= `${year - 1}-${RULES.PLAN_START}` && today <= `${year - 1}-${RULES.PLAN_DEADLINE}`;
}
function daysToDeadline(year, todayIso) {
  if (!todayIso) return 0;
  return daysBetween(String(todayIso).slice(0, 10), `${year - 1}-${RULES.PLAN_DEADLINE}`) - 1;
}

// ── Баланс ─────────────────────────────────────────────────────────────────
/**
 * Баланс сотрудника.
 * @param {{available_days:number, carry_over_days:number}|null} daysRow — из office_vacation_days
 * @param {Array} periods — его периоды [{date_from,date_to,days,status}]
 */
function balance(daysRow, periods) {
  const available = Number(daysRow && daysRow.available_days) || 0;
  const carry = Number(daysRow && daysRow.carry_over_days) || 0;
  const total = available;
  let approved = 0, pending = 0, rejected = 0;
  (periods || []).forEach((r) => {
    const d = Number(r.days) || 0;
    if (r.status === 'approved') approved += d;
    else if (r.status === 'pending') pending += d;
    else if (r.status === 'rejected') rejected += d;
  });
  return {
    available_days: available,
    carry_over_days: carry,
    approved,
    pending,
    rejected,
    planned: approved + pending,
    left: total - approved - pending,          // сколько ещё можно взять
    total,
  };
}

/** Сколько «основных» (14-дневных) отпусков уже использовано — по КАЛЕНДАРНОЙ длительности. */
function mainUsed(periods, ignoreId) {
  return (periods || []).filter((r) =>
    r.status !== 'rejected' && r.status !== 'cancelled' &&
    r.id !== ignoreId &&
    (Number(r.cal_days) >= RULES.SINGLE_MAX || (!r.cal_days && Number(r.days) >= RULES.SINGLE_MAX))
  ).length;
}

/**
 * Валидация нового/правимого периода.
 *
 * @param {object} p
 * @param {object} p.calendar — из makeCalendar()
 * @param {number|string} p.year
 * @param {string} p.start,p.end — 'YYYY-MM-DD'
 * @param {Array} p.periods — существующие периоды сотрудника
 * @param {Array<string>} p.blockedDays — снятые директором дни ЭТОГО сотрудника
 * @param {{available_days:number,carry_over_days:number}|null} p.daysRow
 * @param {string} [p.ignoreId] — id правимого периода
 * @returns {{ok:boolean, code:string, msg:string, days:number, calDays:number, holidays:number, isMain:boolean, extendTo:string|null}}
 */
function validatePeriod(p) {
  const cal = p.calendar || {};
  const year = Number(p.year);
  const { start, end } = p;
  const fail = (code, msg, extra) => Object.assign(
    { ok: false, code, msg, days: 0, calDays: 0, holidays: 0, isMain: false, extendTo: null },
    extra || {}
  );

  if (!start || !end) return fail(CODES.EMPTY, 'Выберите дни в календаре.');
  if (String(end) < String(start)) return fail(CODES.ORDER, 'Дата окончания раньше начала.');

  const calDays = daysBetween(start, end);
  const holidays = holidaysIn(cal, start, end).length;
  const days = calDays - holidays;   // оплачиваемые (ст. 120 ТК)

  const base = { calDays, holidays, days };

  if (calDays <= 0) return fail(CODES.EMPTY, 'Период пустой.', base);

  // Границы года — проверяем ОБА конца
  if (String(start) < `${year}-01-01` || String(end) > `${year}-12-31`) {
    return fail(CODES.OUT_OF_YEAR, `График только на ${year} год — период должен целиком укладываться в год.`, base);
  }

  // Период целиком из праздников — отпускных дней нет
  if (days <= 0) {
    return fail(CODES.ALL_HOLIDAYS,
      `В эти дни только праздники (${holidays}) — календарных дней отпуска нет. Выберите другие даты.`, base);
  }

  const bal = balance(p.daysRow, p.periods);

  // Пересечение с собственными периодами
  const clash = (p.periods || []).find((r) =>
    r.id !== p.ignoreId && r.status !== 'rejected' && r.status !== 'cancelled' &&
    !(String(end) < String(r.date_from) || String(start) > String(r.date_to)));
  if (clash) {
    return fail(CODES.OVERLAP_OWN,
      `Пересекается с вашим периодом: ${fmtRange(String(clash.date_from).slice(0, 10), String(clash.date_to).slice(0, 10))}.`, base);
  }

  // Лимиты длительности.
  // ВАЖНО: заказчик ограничивает «14 дней РАЗОМ» и «не больше недели» — это про
  // длительность периода в КАЛЕНДАРНЫХ днях (как человек его себе представляет),
  // а не про оплачиваемые (оплачиваемые минус праздники уходят в баланс).
  // Иначе период 1–22 января (22 календарных дня!) проходил как «14 оплачиваемых».
  if (calDays > RULES.SINGLE_MAX) {
    return fail(CODES.TOO_LONG, `Разом можно не больше ${RULES.SINGLE_MAX} календарных дней (вы выбрали ${calDays}).`, base);
  }
  const isMain = calDays >= RULES.SINGLE_MAX;
  if (calDays > RULES.OTHER_MAX && !isMain) {
    return fail(CODES.OTHER_MAX, `Кроме основного отпуска — не больше ${RULES.OTHER_MAX} дней (вы выбрали ${calDays}).`, base);
  }
  if (isMain && !p.ignoreId && mainUsed(p.periods) >= RULES.SINGLE_PER_YEAR) {
    return fail(CODES.SINGLE_USED, `Отпуск на ${RULES.SINGLE_MAX} дней уже использован в этом году.`, Object.assign({ isMain: true }, base));
  }

  // Снятые директором дни — повторно нельзя
  const blocked = (p.blockedDays || []);
  if (blocked.length) {
    const hit = rangeDays(start, end).filter((d) => blocked.indexOf(d) >= 0);
    if (hit.length) {
      return fail(CODES.BLOCKED,
        `Директор не согласовал ${hit.length} из этих дней — поставьте другие даты.`, base);
    }
  }

  // Остаток дней
  if (bal.left < days) {
    return fail(CODES.NO_DAYS,
      `Дни закончились: осталось ${Math.max(0, bal.left)} из ${bal.total}.`, base);
  }

  // Количество периодов
  const active = (p.periods || []).filter((r) =>
    r.status !== 'rejected' && r.status !== 'cancelled' && r.id !== p.ignoreId).length;
  if (active >= RULES.MAX_PARTS) {
    return fail(CODES.PARTS, `Не больше ${RULES.MAX_PARTS} периодов за год.`, base);
  }

  return {
    ok: true, code: CODES.OK, msg: '',
    days, calDays, holidays, isMain,
    extendTo: holidays ? extendEnd(cal, start, days) : null,
  };
}

/**
 * Пересечения с коллегами (предупреждение, не запрет).
 * @param {Array} others — [{employee_id, fio, date_from, date_to, days, status}]
 */
function clashesWith(periods, others, start, end, selfEmployeeId) {
  const out = [];
  (others || []).forEach((o) => {
    if (String(o.employee_id) === String(selfEmployeeId)) return;
    if (o.status === 'rejected' || o.status === 'cancelled') return;
    const from = String(o.date_from).slice(0, 10), to = String(o.date_to).slice(0, 10);
    if (String(end) < from || String(start) > to) return;
    const a = String(start) > from ? start : from;
    const b = String(end) < to ? end : to;
    out.push({
      employee_id: o.employee_id, fio: o.fio,
      date_from: from, date_to: to,
      overlap_days: daysBetween(a, b),
    });
  });
  out.sort((x, y) => y.overlap_days - x.overlap_days);
  return out;
}

/** Итог согласования: сколько директоров уже «за». */
function approvalProgress(votes, directorIds) {
  const yes = (votes || []).filter((v) => v.decision === 'approve').map((v) => Number(v.director_user_id));
  const total = (directorIds || []).length;
  const left = (directorIds || []).filter((id) => yes.indexOf(Number(id)) < 0);
  return { done: yes.filter((id) => (directorIds || []).map(Number).indexOf(id) >= 0).length, total, left };
}

module.exports = {
  RULES, CODES,
  pad, parseIso, toIso, daysInMonth, rangeDays, daysBetween, fmtDay, fmtRange,
  makeCalendar, isHoliday, isNonWorking, isWorkingDay,
  holidaysIn, chargedDays, extendEnd, holidayNote,
  windowOpen, daysToDeadline,
  balance, mainUsed, validatePeriod, clashesWith, approvalProgress,
};
