'use strict';

/**
 * Расчёт бригады и срока по ТРУДОЁМКОСТИ из ТЗ.
 *
 * ── Ситуация ───────────────────────────────────────────────────────────────
 * Заказчик иногда сам считает норму: «зачистка ёмкости — 1800 мин». Это
 * 30 человеко-часов. Физического объёма (м², м³) нет, справочник норм
 * применить нечем — и раньше анализ считался незавершённым.
 *
 * ── Как считаем правильно ──────────────────────────────────────────────────
 * 1800 чел·ч — это НЕ «один человек 1800 часов». Это ОБЩИЙ фонд рабочего
 * времени, который заказчик оценил на работу. Значит:
 *
 *   срок (смен) = трудозатраты / (людей × часов в смене)
 *
 * Мастера и ИТР НЕ входят в эти человеко-часы: заказчик оценивал работу
 * исполнителей. Они ставятся СВЕРХУ, потому что их труд в цену входит, а в
 * норму заказчика — нет.
 *
 * Пример: 1800 чел·ч, 10 слесарей, смена 11 ч, 2 смены в сутки →
 *   1800 / (10 × 11 × 2) = 8,2 суток на бригаду из 10 человек.
 *   Сверху мастер (1) и ИТР (1) — они не в фонде, но нужны.
 */

/** Часов в смене по умолчанию. */
const DEFAULT_SHIFT_HOURS = 11;

/** Смен в сутки по умолчанию. */
const DEFAULT_SHIFTS_PER_DAY = 2;

/** Минимальный срок: меньше почти не бывает даже на малый объём. */
const MIN_DAYS = 1;

/**
 * Переводит значение в человеко-часы.
 *
 * Понимает все формы, которые встречаются в ТЗ: «1800 мин», «30 чел·ч»,
 * «1800 минута», «30 человеко-часов», «2 чел-дня».
 *
 * @param {number} value — число из документа
 * @param {string} unit — единица («мин», «чел·ч», «чел-дн»)
 * @returns {number} человеко-часы или 0, если это не трудоёмкость
 */
function toLaborHours(value, unit) {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return 0;
  const u = String(unit || '').toLowerCase().replace(/\s+/g, '');

  // Минуты: «мин», «минута», «минут», «мин.».
  if (/^мин/.test(u)) return Math.round((v / 60) * 100) / 100;
  // Человеко-дни: смена 8 часов — стандарт учёта труда.
  if (/чел[·.\-]?дн|чел[·.\-]?день|человеко[·.\-]?дн/.test(u)) return Math.round(v * 8 * 100) / 100;
  // Человеко-смены.
  if (/чел[·.\-]?см|человеко[·.\-]?смен/.test(u)) return Math.round(v * 8 * 100) / 100;
  // Часы и человеко-часы.
  if (/чел[·.\-]?ч|человеко[·.\-]?час|нормо[·.\-]?час|^ч$|^час/.test(u)) return v;
  return 0;
}

/**
 * Считает бригаду и срок по трудозатратам.
 *
 * @param {object} p
 * @param {number} p.laborHours — общий фонд, человеко-часы
 * @param {number} [p.workers] — сколько исполнителей в бригаде
 * @param {number} [p.shiftHours] — часов в смене
 * @param {number} [p.shiftsPerDay] — смен в сутки
 * @param {boolean} [p.withMaster] — добавить мастера сверх фонда
 * @param {boolean} [p.withItr] — добавить ИТР сверх фонда
 * @returns {{days: number, workers: number, masters: number, itr: number,
 *            total_people: number, labor_hours: number, note: string}}
 */
function planByLabor(p) {
  const o = p || {};
  const hours = Number(o.laborHours) || 0;
  const workers = Math.max(1, Math.round(Number(o.workers) || 10));
  const shiftHours = Number(o.shiftHours) > 0 ? Number(o.shiftHours) : DEFAULT_SHIFT_HOURS;
  const shiftsPerDay = Number(o.shiftsPerDay) > 0 ? Number(o.shiftsPerDay) : DEFAULT_SHIFTS_PER_DAY;

  // Мастер и ИТР — СВЕРХУ: их труд не входит в человеко-часы заказчика.
  const masters = o.withMaster === false ? 0 : 1;
  const itr = o.withItr === false ? 0 : 1;

  if (!(hours > 0)) {
    return {
      days: 0,
      workers,
      masters,
      itr,
      total_people: workers + masters + itr,
      labor_hours: 0,
      note: 'трудоёмкость не указана'
    };
  }

  // Фонд / (людей × часов в смене × смен в сутки) = суток.
  const perDay = workers * shiftHours * shiftsPerDay;
  const rawDays = hours / perDay;
  const days = Math.max(MIN_DAYS, Math.round(rawDays * 10) / 10);

  return {
    days,
    workers,
    masters,
    itr,
    total_people: workers + masters + itr,
    labor_hours: hours,
    note: `${hours} чел·ч ÷ (${workers} чел × ${shiftHours} ч × ${shiftsPerDay} смен) `
      + `= ${days} сут; мастер и ИТР — сверх фонда заказчика`
  };
}

/**
 * Подбирает число исполнителей, чтобы срок попал в окно из ТЗ.
 *
 * Если заказчик написал «работы за 30 суток», 8 суток — не нарушение, но
 * может не устраивать по людям. Функция даёт вариант «сколько людей нужно,
 * чтобы уложиться в срок».
 *
 * @param {number} laborHours
 * @param {number} targetDays
 * @param {{shiftHours?: number, shiftsPerDay?: number}} [opts]
 * @returns {number} требуемое число исполнителей
 */
function workersForDays(laborHours, targetDays, opts = {}) {
  const hours = Number(laborHours) || 0;
  const days = Number(targetDays) || 0;
  const shiftHours = Number(opts.shiftHours) > 0 ? Number(opts.shiftHours) : DEFAULT_SHIFT_HOURS;
  const shiftsPerDay = Number(opts.shiftsPerDay) > 0 ? Number(opts.shiftsPerDay) : DEFAULT_SHIFTS_PER_DAY;
  if (!(hours > 0) || !(days > 0)) return 1;
  return Math.max(1, Math.ceil(hours / (days * shiftHours * shiftsPerDay)));
}

module.exports = {
  DEFAULT_SHIFT_HOURS,
  DEFAULT_SHIFTS_PER_DAY,
  MIN_DAYS,
  toLaborHours,
  planByLabor,
  workersForDays
};
