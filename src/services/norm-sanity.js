'use strict';
/**
 * Проверка на абсурд в расчёте нормы.
 *
 * Задача. Модель может применить норму не по адресу: взять «чел·ч на м³
 * ёмкости» для резервуара, где норма верна только при Ø20–25 м, или посчитать
 * 1750 м² как 1750 м³. На глаз это не видно — цифра выглядит нормально.
 *
 * Здесь — детерминированная защита, не зависящая от модели: сравниваем
 * результат с независимой оценкой «площадь × толщина» и, если расхождение
 * больше порога, возвращаем предупреждение. Не падаем и не подгоняем —
 * показываем РП, что цифра подозрительная.
 */

/** Порог: во сколько раз результат должен отличаться, чтобы звать РП. */
const RATIO_LIMIT = 3;

/**
 * Независимая оценка трудозатрат через объём отложений.
 *
 * Физика: чтобы снять V м³ отложений, нужна работа, пропорциональная V.
 * Если норма даёт срок, отличающийся от этой оценки в разы, значит либо
 * норма не та, либо объём неверно пересчитан, либо единица перепутана.
 *
 * @param {object} p
 * @param {number} p.workDays      срок из нормы
 * @param {number} p.volumeM3      объём отложений в м³ (после пересчёта)
 * @param {number} p.people        людей в бригаде
 * @param {number} p.shiftHours    часов в смене
 * @param {number} p.shiftsPerDay  смен в сутки
 * @param {number} p.mhPerM3       удельная трудоёмкость, чел·ч/м³ (из нормы)
 *
 * @returns {{ suspicious: boolean, ratio: number|null, expected_days: number|null, message: string|null }}
 */
function checkSane(p) {
  const o = p || {};
  const workDays = Number(o.workDays);
  const volumeM3 = Number(o.volumeM3);
  const people = Number(o.people) || 1;
  const shiftHours = Number(o.shiftHours) || 12;
  const shiftsPerDay = Number(o.shiftsPerDay) || 2;
  const mhPerM3 = Number(o.mhPerM3);

  if (!(workDays > 0) || !(volumeM3 > 0)) {
    return { suspicious: false, ratio: null, expected_days: null, message: null };
  }

  // Если удельная трудоёмкость неизвестна, независимой оценки нет:
  // не выдумываем «среднюю», просто пропускаем проверку.
  if (!(mhPerM3 > 0)) {
    return { suspicious: false, ratio: null, expected_days: null, message: null };
  }

  // Ожидаемый срок: чел·ч / (людей × смен в сутки × часов) и округляем вверх.
  const manHours = volumeM3 * mhPerM3;
  const expectedDays = Math.ceil(manHours / (people * shiftsPerDay * shiftHours));
  if (!(expectedDays > 0)) {
    return { suspicious: false, ratio: null, expected_days: null, message: null };
  }

  const ratio = Math.max(workDays, expectedDays) / Math.max(1, Math.min(workDays, expectedDays));

  // Ровно на пороге — уже повод проверить: расхождение в 3 раза
  // не объясняется округлением.
  if (ratio < RATIO_LIMIT) {
    return { suspicious: false, ratio: round2(ratio), expected_days: expectedDays, message: null };
  }

  return {
    suspicious: true,
    ratio: round2(ratio),
    expected_days: expectedDays,
    message: `расчёт даёт ${round2(workDays)} сут, а по объёму ${round2(volumeM3)} м³ и норме ${mhPerM3} чел·ч/м³ выходит ${expectedDays} сут — расхождение в ${round2(ratio)} раза. Проверьте единицу измерения и применимость нормы.`
  };
}

/**
 * Проверка применимости нормы к объекту.
 *
 * У нормы есть applicability: диапазон значений и тип отложений. Если объект
 * вне диапазона — норма формально считается, но результат под подозрением.
 *
 * @param {object} applicability  из work_norm_rates.applicability
 * @param {object} ctx            { value, value_field, fouling }
 * @returns {{ ok: boolean, reason: string|null }}
 */
function checkApplicability(applicability, ctx) {
  const a = applicability && typeof applicability === 'object' ? applicability : {};
  const c = ctx || {};
  const has = Object.keys(a).length > 0;
  if (!has) return { ok: true, reason: null };

  const val = Number(c.value);
  const min = Number(a.min_value);
  const max = Number(a.max_value);

  if (Number.isFinite(min) && Number.isFinite(val) && val < min) {
    return { ok: false, reason: `норма применима от ${min}, объект ${val} — вне диапазона (занижает или завышает)` };
  }
  if (Number.isFinite(max) && Number.isFinite(val) && val > max) {
    return { ok: false, reason: `норма применима до ${max}, объект ${val} — вне диапазона` };
  }

  const allowed = Array.isArray(a.fouling) ? a.fouling : null;
  const f = String(c.fouling || '').trim();
  if (allowed && allowed.length && f && !allowed.includes(f)) {
    return { ok: false, reason: `норма для отложений «${allowed.join('/')}», а тут «${f}»` };
  }

  return { ok: true, reason: null };
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

module.exports = { checkSane, checkApplicability, RATIO_LIMIT };
