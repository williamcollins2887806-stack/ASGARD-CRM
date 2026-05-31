/**
 * ASGARD CRM — Mimir Conductor: агент «Расчёт труда» (Сессия 4, Шаг 4.4)
 * ═══════════════════════════════════════════════════════════════════════════
 * БЕЗ LLM. По crew_plan + tz_summary + тарифной сетке считает ФОТ (без налога).
 *
 * Артефакт: labor_cost
 *   { summary, key_findings[], personnel:[{item,qty,rate,days,total}],
 *     subtotal_fot, work_days, road_days, total_man_days, clarifications[] }
 *
 * Дисциплина дат: если окно дат слишком короткое под объём + дорогу + моб/демоб —
 * поднимаем БЛОКИРУЮЩЕЕ уточнение PM (как в плане). Если дат нет вовсе —
 * берём дефолтную длительность (10 раб. дней) и помечаем допущение.
 *
 * Тарифы из field_tariff_grid(position_name, rate_per_shift, is_active).
 * Если позиции нет в сетке — берём дефолтные ставки (помечаем допущение).
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const db = require('../../db');
const { formatRub } = require('./_util');

// Дефолтные ставки (₽/смену), если позиции нет в тарифной сетке.
const DEFAULT_RATES = {
  'ИТР (РП)': 10000,
  'Мастер': 6000,
  'Слесарь-универсал': 4500
};
const ROAD_RATE = 3000;        // ₽/чел/день дороги
const PREP_DAYS = 2;           // подготовка на складе
const MOB_DEMOB_DAYS = 4;      // моб + демоб

/** Грубая оценка дней дороги по городам бригады vs объекта. */
function computeRoadDays(crew, objectCity) {
  if (!objectCity) return 1;
  const sameCity = (crew || []).every(
    (m) => (m.city || '').toLowerCase() === String(objectCity).toLowerCase()
  );
  return sameCity ? 0 : 1;
}

async function loadTariffs() {
  try {
    const r = await db.query(
      'SELECT position_name, rate_per_shift FROM field_tariff_grid WHERE is_active = true'
    );
    const map = new Map();
    for (const row of r.rows) {
      if (row.position_name) map.set(row.position_name, Number(row.rate_per_shift) || 0);
    }
    return map;
  } catch (_) {
    return new Map();
  }
}

function rateFor(tariffMap, position) {
  const fromGrid = tariffMap.get(position);
  if (fromGrid && fromGrid > 0) return { rate: fromGrid, assumed: false };
  return { rate: DEFAULT_RATES[position] || 4500, assumed: true };
}

async function run({ requiredArtifacts, onThought }) {
  const tz = (requiredArtifacts.tz_summary) || {};
  const crewPlan = (requiredArtifacts.crew_plan) || {};
  const crew = crewPlan.crew || [];
  const totalCount = crewPlan.total_count || crew.length || 4;
  const shifts = crewPlan.shifts || 1;
  const assumptions = [];

  onThought('Загружаю тарифную сетку…');
  const tariffMap = await loadTariffs();

  onThought('Считаю длительность работ…');
  const timing = tz.timing || {};
  const objectCity = tz.object && tz.object.city ? tz.object.city : null;
  const roadDays = computeRoadDays(crew, objectCity);

  let totalDays;
  if (timing.start && timing.end) {
    const start = new Date(timing.start);
    const end = new Date(timing.end);
    totalDays = Math.round((end - start) / 86400000) + 1;
  } else if (timing.duration_days) {
    totalDays = Number(timing.duration_days);
  } else {
    totalDays = 10 + 2 * roadDays + MOB_DEMOB_DAYS; // дефолт: 10 рабочих дней
    assumptions.push('Даты проекта не заданы — принята длительность 10 рабочих дней');
  }

  const workDays = totalDays - 2 * roadDays - MOB_DEMOB_DAYS;
  if (workDays < 1) {
    onThought('⚠ Окно дат слишком короткое под объём + дорогу + моб/демоб');
    return {
      summary: 'ОШИБКА: окно дат слишком короткое для объёма работ',
      key_findings: [`Всего дней ${totalDays}, дорога ${roadDays}×2, моб/демоб ${MOB_DEMOB_DAYS}`],
      personnel: [],
      subtotal_fot: 0,
      work_days: 0,
      road_days: roadDays,
      total_man_days: 0,
      clarifications: [{
        channel: 'PM',
        category: 'timing',
        blocking: true,
        question_ru: `Окно ${totalDays} дн не вмещает работу с дорогой ${roadDays}×2 дн и моб/демоб ${MOB_DEMOB_DAYS} дн. Сдвинуть сроки или увеличить бригаду?`
      }]
    };
  }

  onThought('Считаю ФОТ по позициям…');
  const foremanCount = shifts === 2 ? 2 : (crewPlan.foremen || 1);
  const workersCount = (crewPlan.workers || Math.max(totalCount - 1 - foremanCount, 1)) * shifts;

  const personnel = [];

  // ИТР — фиксированная ставка
  const itr = rateFor(tariffMap, 'ИТР (РП)');
  if (itr.assumed) assumptions.push('Ставка ИТР принята по умолчанию (нет в тарифной сетке)');
  const itrDays = workDays + 2 * roadDays + MOB_DEMOB_DAYS;
  personnel.push({ item: 'ИТР (РП)', qty: 1, rate: itr.rate, days: itrDays, total: 1 * itr.rate * itrDays });

  // Мастер(а)
  const master = rateFor(tariffMap, 'Мастер');
  if (master.assumed) assumptions.push('Ставка мастера принята по умолчанию');
  personnel.push({ item: 'Мастер', qty: foremanCount, rate: master.rate, days: workDays, total: foremanCount * master.rate * workDays });

  // Рабочие
  const worker = rateFor(tariffMap, 'Слесарь-универсал');
  if (worker.assumed) assumptions.push('Ставка рабочего принята по умолчанию');
  personnel.push({ item: 'Слесарь-универсал', qty: workersCount, rate: worker.rate, days: workDays, total: workersCount * worker.rate * workDays });

  // Дни дороги
  if (roadDays > 0) {
    personnel.push({ item: 'Дни дороги', qty: totalCount, rate: ROAD_RATE, days: roadDays * 2, total: totalCount * ROAD_RATE * roadDays * 2 });
  }

  // Подготовка на складе
  personnel.push({ item: 'Подготовка на складе', qty: 3, rate: worker.rate, days: PREP_DAYS, total: 3 * worker.rate * PREP_DAYS });

  const subtotal = personnel.reduce((s, p) => s + p.total, 0);

  return {
    summary: `ФОТ (без налога): ${formatRub(subtotal)}, ${workDays} рабочих дней, ${totalCount} чел`,
    key_findings: [
      `Чистые рабочие смены: ${workDays}`,
      `Дни дороги: ${roadDays}× 2`,
      `Бригада: ${totalCount} чел (смен ${shifts})`,
      `ФОТ без налога: ${formatRub(subtotal)}`,
      ...assumptions
    ],
    personnel,
    subtotal_fot: subtotal,
    work_days: workDays,
    road_days: roadDays,
    total_man_days: workersCount * workDays,
    assumptions,
    clarifications: []
  };
}

module.exports = { run };
