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

// Fallback ставки (₽/смену) — применяются ТОЛЬКО если позиции нет ни в:
//   1. employees_summary.by_qualification[].avg_day_rate_rub (реальные ставки из БД)
//   2. analogs_comparison.analysis.applicable_norms.labor_rates_rub_per_shift (из эталонов)
//   3. field_tariff_grid (тарифная сетка)
// Это последний рубеж. Если попадаем сюда — в assumptions пишется warning.
const FALLBACK_RATES = {
  'ИТР (РП)': 10000,
  'Мастер': 6000,
  'Слесарь-универсал': 4500
};
const FALLBACK_ROAD_RATE = 3000;
const FALLBACK_PREP_DAYS = 2;
const FALLBACK_MOB_DEMOB_DAYS = 4;

/** Найти ставку в employees_summary.by_qualification по нечёткому matching position. */
function rateFromEmployees(workScope, position) {
  const list = (workScope && workScope.employees_summary && workScope.employees_summary.by_qualification) || [];
  const posLow = String(position || '').toLowerCase();
  // Сначала прямое включение
  let hit = list.find((q) => posLow && q.qualification && posLow.includes(q.qualification.toLowerCase()));
  if (!hit) hit = list.find((q) => q.qualification && posLow && q.qualification.toLowerCase().includes(posLow.split(/[\s(]+/)[0]));
  if (hit && hit.avg_day_rate_rub && hit.avg_day_rate_rub > 0) {
    return { rate: Number(hit.avg_day_rate_rub), source: 'employees', assumed: false };
  }
  return null;
}

/** Найти ставку в applicable_norms из historical_comparator. */
function rateFromAnalogs(analogs, position) {
  const norms = (analogs && analogs.analysis && analogs.analysis.applicable_norms) || {};
  const rates = norms.labor_rates_rub_per_shift || {};
  const posLow = String(position || '').toLowerCase();
  const key = Object.keys(rates).find((k) => k.toLowerCase().includes(posLow.split(/[\s(]+/)[0]));
  if (key && rates[key] > 0) {
    return { rate: Number(rates[key]), source: 'analogs', assumed: false };
  }
  return null;
}

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

function rateFor(tariffMap, position, requiredArtifacts) {
  // Приоритет: эталоны → реальные employees → тарифная сетка → fallback
  const fromAnalogs = rateFromAnalogs(requiredArtifacts && requiredArtifacts.analogs_comparison, position);
  if (fromAnalogs) return fromAnalogs;
  const fromEmp = rateFromEmployees(requiredArtifacts && requiredArtifacts.work_scope_research, position);
  if (fromEmp) return fromEmp;
  const fromGrid = tariffMap.get(position);
  if (fromGrid && fromGrid > 0) return { rate: fromGrid, source: 'tariff_grid', assumed: false };
  return { rate: FALLBACK_RATES[position] || 4500, source: 'defaults', assumed: true };
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
    totalDays = 10 + 2 * roadDays + FALLBACK_MOB_DEMOB_DAYS;
    assumptions.push('Даты проекта не заданы — принята длительность 10 рабочих дней (FALLBACK)');
  }

  const workDays = totalDays - 2 * roadDays - FALLBACK_MOB_DEMOB_DAYS;
  if (workDays < 1) {
    onThought('⚠ Окно дат слишком короткое под объём + дорогу + моб/демоб');
    return {
      summary: 'ОШИБКА: окно дат слишком короткое для объёма работ',
      key_findings: [`Всего дней ${totalDays}, дорога ${roadDays}×2, моб/демоб ${FALLBACK_MOB_DEMOB_DAYS}`],
      personnel: [],
      subtotal_fot: 0,
      work_days: 0,
      road_days: roadDays,
      total_man_days: 0,
      clarifications: [{
        channel: 'PM',
        category: 'timing',
        blocking: true,
        question_ru: `Окно ${totalDays} дн не вмещает работу с дорогой ${roadDays}×2 дн и моб/демоб ${FALLBACK_MOB_DEMOB_DAYS} дн. Сдвинуть сроки или увеличить бригаду?`
      }]
    };
  }

  onThought('Считаю ФОТ по позициям…');
  const foremanCount = shifts === 2 ? 2 : (crewPlan.foremen || 1);
  const workersCount = (crewPlan.workers || Math.max(totalCount - 1 - foremanCount, 1)) * shifts;

  const personnel = [];

  // ИТР — ставка из аналогов / employees / тарифной сетки / fallback
  const itr = rateFor(tariffMap, 'ИТР (РП)', requiredArtifacts);
  assumptions.push(`Ставка ИТР: ${itr.rate} ₽/смену (источник: ${itr.source})`);
  const itrDays = workDays + 2 * roadDays + FALLBACK_MOB_DEMOB_DAYS;
  personnel.push({ item: 'ИТР (РП)', qty: 1, rate: itr.rate, days: itrDays, total: 1 * itr.rate * itrDays, rate_source: itr.source });

  // Мастер(а)
  const master = rateFor(tariffMap, 'Мастер', requiredArtifacts);
  assumptions.push(`Ставка мастера: ${master.rate} ₽/смену (источник: ${master.source})`);
  personnel.push({ item: 'Мастер', qty: foremanCount, rate: master.rate, days: workDays, total: foremanCount * master.rate * workDays, rate_source: master.source });

  // Рабочие
  const worker = rateFor(tariffMap, 'Слесарь-универсал', requiredArtifacts);
  assumptions.push(`Ставка рабочего: ${worker.rate} ₽/смену (источник: ${worker.source})`);
  personnel.push({ item: 'Слесарь-универсал', qty: workersCount, rate: worker.rate, days: workDays, total: workersCount * worker.rate * workDays, rate_source: worker.source });

  // Дни дороги
  if (roadDays > 0) {
    personnel.push({ item: 'Дни дороги', qty: totalCount, rate: FALLBACK_ROAD_RATE, days: roadDays * 2, total: totalCount * FALLBACK_ROAD_RATE * roadDays * 2, rate_source: 'fallback' });
  }

  // Подготовка на складе — берём crewPlan.prep_crew если указан, иначе 3 (минимум)
  const prepCrew = Number(crewPlan.prep_crew) || 3;
  personnel.push({ item: 'Подготовка на складе', qty: prepCrew, rate: worker.rate, days: FALLBACK_PREP_DAYS, total: prepCrew * worker.rate * FALLBACK_PREP_DAYS, rate_source: worker.source });

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
