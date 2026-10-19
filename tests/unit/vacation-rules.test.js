'use strict';

/**
 * Юнит-тесты правил графика отпусков (без БД).
 * Календарь берётся из реального производственного календаря 2027 (после V412).
 * Запуск: node tests/unit/vacation-rules.test.js
 */

const R = require('../../src/services/vacation-rules');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? ' :: ' + extra : '')); }
}

/* ── Календарь 2027: праздники + переносы (как в V412) ─────────────────── */
const CAL_2027 = [
  ...['01-01', '01-02', '01-03', '01-04', '01-05', '01-06', '01-07', '01-08'].map((d) => ({ date: `2027-${d}`, is_working: false, kind: 'holiday', title: 'Новогодние каникулы' })),
  { date: '2027-02-23', is_working: false, kind: 'holiday', title: 'День защитника Отечества' },
  { date: '2027-03-08', is_working: false, kind: 'holiday', title: 'Международный женский день' },
  { date: '2027-05-01', is_working: false, kind: 'holiday', title: 'Праздник Весны и Труда' },
  { date: '2027-05-09', is_working: false, kind: 'holiday', title: 'День Победы' },
  { date: '2027-06-12', is_working: false, kind: 'holiday', title: 'День России' },
  { date: '2027-11-04', is_working: false, kind: 'holiday', title: 'День народного единства' },
  // переносы
  { date: '2027-02-22', is_working: false, kind: 'shift' },
  { date: '2027-05-03', is_working: false, kind: 'shift' },
  { date: '2027-05-10', is_working: false, kind: 'shift' },
  { date: '2027-06-14', is_working: false, kind: 'shift' },
  { date: '2027-11-05', is_working: false, kind: 'shift' },
  { date: '2027-12-31', is_working: false, kind: 'shift' },
  { date: '2027-02-20', is_working: true, kind: 'working' },
];
const cal = R.makeCalendar(CAL_2027);

const DROWS = { available_days: 42, carry_over_days: 10 };
const base = { calendar: cal, year: 2027, daysRow: DROWS, periods: [], blockedDays: [] };

/* ── 1. Праздники продлевают отпуск (ст. 120 ТК) ────────────────────────── */
check('1–14 января: 8 праздников, 6 оплачиваемых',
  R.chargedDays(cal, '2027-01-01', '2027-01-14') === 6 &&
  R.holidaysIn(cal, '2027-01-01', '2027-01-14').length === 8);
check('праздники не входят в оплачиваемые дни',
  R.isHoliday(cal, '2027-01-01') && R.isHoliday(cal, '2027-01-08') && !R.isHoliday(cal, '2027-01-09'));
check('перенос (выходной) НЕ праздник и не продлевает отпуск',
  !R.isHoliday(cal, '2027-05-03') && !R.isHoliday(cal, '2027-11-05') && R.isNonWorking(cal, '2027-05-03'));
check('20.02.2027 — рабочий день по переносу',
  R.isWorkingDay(cal, '2027-02-20') && R.isNonWorking(cal, '2027-02-22'));

/* ── 2. Продление отпуска до нужного числа оплачиваемых дней ────────────── */
check('extendEnd: 14 оплачиваемых с 1 января → 22 января',
  R.extendEnd(cal, '2027-01-01', 14) === '2027-01-22',
  R.extendEnd(cal, '2027-01-01', 14));
check('extendEnd: без праздников не удлиняет (1–14 мая)',
  R.extendEnd(cal, '2027-05-04', 5) === '2027-05-08',
  R.extendEnd(cal, '2027-05-04', 5));

/* ── 3. Лимиты 14 / 7 (по КАЛЕНДАРНОЙ длительности) ─────────────────────── */
let v = R.validatePeriod(Object.assign({}, base, { start: '2027-07-01', end: '2027-07-16' }));
check('16 календарных разом — запрет', !v.ok && v.code === R.CODES.TOO_LONG, v.code + ' ' + v.msg);
v = R.validatePeriod(Object.assign({}, base, { start: '2027-07-01', end: '2027-07-09' }));
check('9 календарных (не основной) — запрет', !v.ok && v.code === R.CODES.OTHER_MAX, v.code);
v = R.validatePeriod(Object.assign({}, base, { start: '2027-07-01', end: '2027-07-14' }));
check('14 календарных — основной отпуск разрешён', v.ok && v.isMain, JSON.stringify(v));
// Регрессия: 1–22 января = 22 КАЛЕНДАРНЫХ дня → запрет, хотя оплачиваемых всего 14.
v = R.validatePeriod(Object.assign({}, base, { start: '2027-01-01', end: '2027-01-22' }));
check('22 календарных дня (январь с праздниками) — запрет', !v.ok && v.code === R.CODES.TOO_LONG,
  v.code + ' calDays=' + v.calDays + ' days=' + v.days);
// 1–14 января = 14 календарных, но 6 оплачиваемых → это ОСНОВНОЙ отпуск.
v = R.validatePeriod(Object.assign({}, base, { start: '2027-01-01', end: '2027-01-14' }));
check('14 календарных в январе — основной (6 оплачиваемых)', v.ok && v.isMain && v.days === 6,
  JSON.stringify({ code: v.code, isMain: v.isMain, days: v.days, calDays: v.calDays }));

/* ── 4. Один основной отпуск в год ──────────────────────────────────────── */
const withMain = { calendar: cal, year: 2027, daysRow: DROWS, blockedDays: [], periods: [
  { id: 1, date_from: '2027-03-01', date_to: '2027-03-14', days: 14, status: 'approved' },
] };
v = R.validatePeriod(Object.assign({}, withMain, { start: '2027-07-01', end: '2027-07-14' }));
check('второй основной отпуск запрещён', !v.ok && v.code === R.CODES.SINGLE_USED, v.code);

/* ── 5. Пересечение со своим периодом ───────────────────────────────────── */
v = R.validatePeriod(Object.assign({}, withMain, { start: '2027-03-10', end: '2027-03-16' }));
check('пересечение с собственным периодом', !v.ok && v.code === R.CODES.OVERLAP_OWN, v.code);

/* ── 6. Период целиком из праздников ────────────────────────────────────── */
v = R.validatePeriod(Object.assign({}, base, { start: '2027-01-01', end: '2027-01-08' }));
check('период из одних праздников запрещён', !v.ok && v.code === R.CODES.ALL_HOLIDAYS, v.code);
check('в запрете видно, что 8 дней праздничные', v.holidays === 8 && v.days === 0, JSON.stringify(v));

/* ── 7. Границы года ────────────────────────────────────────────────────── */
v = R.validatePeriod(Object.assign({}, base, { start: '2027-12-30', end: '2028-01-02' }));
check('конец за границей года — запрет', !v.ok && v.code === R.CODES.OUT_OF_YEAR, v.code);
v = R.validatePeriod(Object.assign({}, base, { start: '2026-12-25', end: '2027-01-05' }));
check('начало до границы года — запрет', !v.ok && v.code === R.CODES.OUT_OF_YEAR, v.code);
v = R.validatePeriod(Object.assign({}, base, { start: '2027-12-29', end: '2027-12-30' }));
check('период внутри года (29–30.12) разрешён', v.ok && v.days === 2, JSON.stringify(v));

/* ── 8. Снятые дни — блокировка ПО СОТРУДНИКУ ───────────────────────────── */
v = R.validatePeriod(Object.assign({}, base, {
  start: '2027-08-03', end: '2027-08-05', blockedDays: ['2027-08-04'],
}));
check('снятый день повторно не поставить', !v.ok && v.code === R.CODES.BLOCKED, v.code);
v = R.validatePeriod(Object.assign({}, base, {
  start: '2027-08-03', end: '2027-08-05', blockedDays: [],
}));
check('у другого сотрудника те же дни свободны', v.ok, v.code);

/* ── 9. Остаток дней ────────────────────────────────────────────────────── */
const low = { calendar: cal, year: 2027, blockedDays: [], periods: [], daysRow: { available_days: 5, carry_over_days: 0 } };
v = R.validatePeriod(Object.assign({}, low, { start: '2027-07-01', end: '2027-07-07' }));
check('больше остатка — «дни закончились»', !v.ok && v.code === R.CODES.NO_DAYS, v.code + ' ' + v.msg);

/* ── 10. Максимум периодов ──────────────────────────────────────────────── */
const many = { calendar: cal, year: 2027, daysRow: DROWS, blockedDays: [], periods: [] };
for (let i = 0; i < 6; i++) {
  many.periods.push({ id: i + 1, date_from: `2027-0${i + 1}-01`, date_to: `2027-0${i + 1}-05`, days: 5, status: 'approved' });
}
v = R.validatePeriod(Object.assign({}, many, { start: '2027-09-01', end: '2027-09-05' }));
check('7-й период запрещён', !v.ok && v.code === R.CODES.PARTS, v.code);

/* ── 11. Пересечения с коллегами — предупреждение, не запрет ────────────── */
const others = [
  { employee_id: 2, fio: 'Морозов Игорь', date_from: '2027-01-12', date_to: '2027-01-18', days: 7, status: 'approved' },
  { employee_id: 3, fio: 'Петров Андрей', date_from: '2027-06-01', date_to: '2027-06-07', days: 7, status: 'approved' },
];
const cl = R.clashesWith([], others, '2027-01-14', '2027-01-20', 1);
check('пересечение с коллегой найдено (5 дней)', cl.length === 1 && cl[0].overlap_days === 5, JSON.stringify(cl));
check('пересечение НЕ блокирует постановку',
  R.validatePeriod(Object.assign({}, base, { start: '2027-01-11', end: '2027-01-17' })).ok === true);
check('ровно 1-в-1 с коллегой разрешено',
  R.validatePeriod(Object.assign({}, base, { start: '2027-01-12', end: '2027-01-18' })).ok === true);

/* ── 12. Баланс ─────────────────────────────────────────────────────────── */
const bal = R.balance({ available_days: 42, carry_over_days: 10 }, [
  { days: 14, status: 'approved' },
  { days: 7, status: 'pending' },
  { days: 5, status: 'rejected' },
]);
check('баланс: отгуляно 14, на согласовании 7, остаток 21',
  bal.approved === 14 && bal.pending === 7 && bal.left === 21 && bal.rejected === 5, JSON.stringify(bal));

/* ── 13. Окно внесения 01.11–01.12 ──────────────────────────────────────── */
check('окно открыто 18.11.2026', R.windowOpen(2027, '2026-11-18') === true);
check('окно открыто 1 ноября', R.windowOpen(2027, '2026-11-01') === true);
check('окно открыто 1 декабря', R.windowOpen(2027, '2026-12-01') === true);
check('окно закрыто 2 декабря', R.windowOpen(2027, '2026-12-02') === false);
check('окно закрыто 31 октября', R.windowOpen(2027, '2026-10-31') === false);

/* ── 14. Согласование всеми директорами ─────────────────────────────────── */
const dirs = [10, 20, 30];
check('голос 1 из 3 — не согласовано',
  R.approvalProgress([{ director_user_id: 10, decision: 'approve' }], dirs).done === 1 &&
  R.approvalProgress([{ director_user_id: 10, decision: 'approve' }], dirs).left.length === 2);
check('все 3 «за» — согласовано',
  R.approvalProgress([{ director_user_id: 10, decision: 'approve' }, { director_user_id: 20, decision: 'approve' }, { director_user_id: 30, decision: 'approve' }], dirs).done === 3);

console.log('\n' + (fail ? `FAILS: ${fail}` : `ALL PASS`) + ` (${pass} проверок)`);
process.exit(fail ? 1 : 0);
