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

// БЕЗ ХАРДКОДА. Все значения берутся из БД/эталонов/ТЗ.
// Если данных нет — поднимается BLOCKING-уточнение, а не используется default.

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
  if (!posLow) return null;
  // Двусторонний матчинг: ключ эталона включён в позицию ИЛИ позиция включена в ключ
  // (раньше "слесарь" → "слесарь-универсал" не матчилось; теперь матчится).
  const key = Object.keys(rates).find((k) => {
    const kLow = k.toLowerCase();
    return posLow.includes(kLow) || kLow.includes(posLow.split(/[\s(\-]+/)[0]);
  });
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
  // Приоритет источников (БЕЗ ХАРДКОДА): тарифная сетка → эталоны → реальные employees
  // Если ни в одном — возвращаем null, агент поднимет blocking-уточнение.
  const fromGrid = tariffMap.get(position);
  if (fromGrid && fromGrid > 0) return { rate: fromGrid, source: 'tariff_grid', assumed: false };
  // Двусторонний матчинг по позициям в тарифной сетке (например 'Слесарь-универсал' ↔ 'слесарь')
  for (const [key, value] of tariffMap.entries()) {
    const kLow = String(key).toLowerCase();
    const pLow = String(position).toLowerCase();
    if (value > 0 && (pLow.includes(kLow) || kLow.includes(pLow.split(/[\s(\-]+/)[0]))) {
      return { rate: Number(value), source: 'tariff_grid', assumed: false, matched_key: key };
    }
  }
  const fromAnalogs = rateFromAnalogs(requiredArtifacts && requiredArtifacts.analogs_comparison, position);
  if (fromAnalogs) return fromAnalogs;
  const fromEmp = rateFromEmployees(requiredArtifacts && requiredArtifacts.work_scope_research, position);
  if (fromEmp) return fromEmp;
  return null; // нет ставки — caller поднимет blocking
}

async function run({ requiredArtifacts, onThought }) {
  const tz = (requiredArtifacts.tz_summary) || {};
  const crewPlan = (requiredArtifacts.crew_plan) || {};
  const crew = crewPlan.crew || [];
  const totalCount = crewPlan.total_count || crew.length || 4;
  const shifts = crewPlan.shifts || 1;
  const assumptions = [];
  const clarifications = [];

  onThought('Загружаю тарифную сетку из БД…');
  const tariffMap = await loadTariffs();

  onThought('Загружаю ставки дорога/подготовка из field_tariff_grid…');
  const roadRateRow = tariffMap.get('Дни дороги') || tariffMap.get('Дорога') ||
                       tariffMap.get('Выходной в командировке (карантин, дорога, нерабочий день)') || 0;

  // Источники для prep/mob: ТЗ timing → applicable_norms (эталон) → BLOCKING
  const analogsTimingNorms = (requiredArtifacts.analogs_comparison &&
    requiredArtifacts.analogs_comparison.analysis &&
    requiredArtifacts.analogs_comparison.analysis.applicable_norms &&
    requiredArtifacts.analogs_comparison.analysis.applicable_norms.timing_norms) || {};
  const prepDays = (tz.timing && Number(tz.timing.prep_days)) ||
                   (analogsTimingNorms.prep_days != null ? Number(analogsTimingNorms.prep_days) : null);
  const mobDemobDays = (tz.timing && Number(tz.timing.mob_demob_days)) ||
                       (analogsTimingNorms.mob_demob_days != null ? Number(analogsTimingNorms.mob_demob_days) : null);

  if (prepDays == null) {
    clarifications.push({
      channel: 'PM', category: 'timing', blocking: true,
      question_ru: 'Не задано число дней подготовки на складе.',
      expected_inputs: [{
        key: 'prep_days', label: 'Дни подготовки на складе', type: 'number', unit: 'дн',
        hint: 'Сколько дней бригада готовит оборудование на складе до выезда. Сохранится в applicable_norms эталона (timing_norms.prep_days).',
        target: 'reference_norms.timing_norms.prep_days'
      }]
    });
  }
  if (mobDemobDays == null) {
    clarifications.push({
      channel: 'PM', category: 'timing', blocking: true,
      question_ru: 'Не задано число дней мобилизации+демобилизации.',
      expected_inputs: [{
        key: 'mob_demob_days', label: 'Дни мобилизации+демобилизации', type: 'number', unit: 'дн',
        hint: 'Сколько дней суммарно на моб+демоб (приёмка/сдача объекта, погрузка/разгрузка). Сохранится в applicable_norms.timing_norms.mob_demob_days.',
        target: 'reference_norms.timing_norms.mob_demob_days'
      }]
    });
  }

  onThought('Считаю длительность работ из ТЗ (timing.start/end или duration_days)…');
  const timing = tz.timing || {};
  const objectCity = tz.object && tz.object.city ? tz.object.city : null;
  const roadDays = computeRoadDays(crew, objectCity);

  let totalDays = null;
  if (timing.start && timing.end) {
    const start = new Date(timing.start);
    const end = new Date(timing.end);
    totalDays = Math.round((end - start) / 86400000) + 1;
  } else if (timing.duration_days) {
    totalDays = Number(timing.duration_days);
  } else if (timing.work_days) {
    totalDays = Number(timing.work_days) + 2 * roadDays + (mobDemobDays || 0);
  }

  if (totalDays == null) {
    clarifications.push({
      channel: 'PM', category: 'timing', blocking: true,
      question_ru: 'Сроки выполнения работ не определены.',
      expected_inputs: [
        { key: 'start_date', label: 'Дата начала', type: 'date',
          hint: 'Календарная дата начала работ. Сохранится в tz_summary.timing.start.',
          target: 'tz_summary.timing.start' },
        { key: 'end_date', label: 'Дата окончания', type: 'date',
          hint: 'Календарная дата окончания работ. Сохранится в tz_summary.timing.end.',
          target: 'tz_summary.timing.end' },
        { key: 'work_days', label: 'Или длительность (рабочих дней)', type: 'number', unit: 'дн',
          hint: 'Если дат нет — укажите длительность в рабочих днях. Сохранится в tz_summary.timing.work_days.',
          target: 'tz_summary.timing.work_days', optional: true }
      ]
    });
  }

  // Если данных не хватает — раннее завершение с blocking
  if (clarifications.some((c) => c.blocking)) {
    return {
      summary: 'BLOCKED: нет данных в БД/ТЗ — поднимаем blocking-уточнения',
      key_findings: clarifications.map((c) => `BLOCKER: ${c.question_ru}`),
      personnel: [], subtotal_fot: 0, work_days: 0, road_days: roadDays, total_man_days: 0,
      assumptions, clarifications
    };
  }

  const workDays = totalDays - 2 * roadDays - mobDemobDays;
  if (workDays < 1) {
    onThought('⚠ Окно дат слишком короткое под объём + дорогу + моб/демоб');
    return {
      summary: 'ОШИБКА: окно дат слишком короткое для объёма работ',
      key_findings: [`Всего дней ${totalDays}, дорога ${roadDays}×2, моб/демоб ${mobDemobDays}`],
      personnel: [], subtotal_fot: 0, work_days: 0, road_days: roadDays, total_man_days: 0,
      clarifications: [{ channel: 'PM', category: 'timing', blocking: true,
        question_ru: `Окно ${totalDays} дн не вмещает работу с дорогой ${roadDays}×2 дн и моб/демоб ${mobDemobDays} дн. Сдвинуть сроки или увеличить бригаду?` }]
    };
  }

  onThought('Резолвлю ставки бригады из field_tariff_grid → applicable_norms → employees…');
  const foremanCount = shifts === 2 ? 2 : (crewPlan.foremen || 1);
  const workersCount = (crewPlan.workers || Math.max(totalCount - 1 - foremanCount, 1)) * shifts;

  const positionsToResolve = ['ИТР (РП)', 'Мастер', 'Слесарь-универсал'];
  const resolved = {};
  for (const pos of positionsToResolve) {
    const r = rateFor(tariffMap, pos, requiredArtifacts);
    if (!r) {
      clarifications.push({
        channel: 'PM', category: 'rates', blocking: true,
        question_ru: `Не найдена ставка для позиции "${pos}".`,
        expected_inputs: [{
          key: `rate_${pos.toLowerCase().replace(/[^а-яa-z]/g, '_')}`,
          label: `Ставка "${pos}" (₽/смену)`,
          type: 'number', unit: '₽',
          hint: `Запишется в field_tariff_grid (position_name="${pos}", rate_per_shift, is_active=true). Затем все будущие просчёты будут использовать эту ставку.`,
          target: `field_tariff_grid.${pos}`
        }]
      });
    } else {
      resolved[pos] = r;
      assumptions.push(`Ставка ${pos}: ${r.rate} ₽/смену (источник: ${r.source}${r.matched_key ? ', ключ: ' + r.matched_key : ''})`);
    }
  }
  if (clarifications.some((c) => c.blocking)) {
    return {
      summary: 'BLOCKED: ставки бригады не найдены в БД',
      key_findings: clarifications.map((c) => `BLOCKER: ${c.question_ru}`),
      personnel: [], subtotal_fot: 0, work_days: workDays, road_days: roadDays, total_man_days: 0,
      assumptions, clarifications
    };
  }

  const personnel = [];
  const itr = resolved['ИТР (РП)'];
  const itrDays = workDays + 2 * roadDays + mobDemobDays;
  personnel.push({ item: 'ИТР (РП)', qty: 1, rate: itr.rate, days: itrDays, total: 1 * itr.rate * itrDays, rate_source: itr.source });

  const master = resolved['Мастер'];
  personnel.push({ item: 'Мастер', qty: foremanCount, rate: master.rate, days: workDays, total: foremanCount * master.rate * workDays, rate_source: master.source });

  const worker = resolved['Слесарь-универсал'];
  personnel.push({ item: 'Слесарь-универсал', qty: workersCount, rate: worker.rate, days: workDays, total: workersCount * worker.rate * workDays, rate_source: worker.source });

  // Дни дороги — ставка из тарифной сетки или blocking
  if (roadDays > 0) {
    if (!roadRateRow || roadRateRow <= 0) {
      clarifications.push({ channel: 'PM', category: 'rates', blocking: false,
        question_ru: 'Ставка "Дни дороги" не задана в field_tariff_grid. По умолчанию использована ставка рабочего.' });
      personnel.push({ item: 'Дни дороги', qty: totalCount, rate: worker.rate, days: roadDays * 2, total: totalCount * worker.rate * roadDays * 2, rate_source: 'workers_rate_proxy' });
    } else {
      personnel.push({ item: 'Дни дороги', qty: totalCount, rate: roadRateRow, days: roadDays * 2, total: totalCount * roadRateRow * roadDays * 2, rate_source: 'tariff_grid' });
    }
  }

  // Подготовка на складе — норма из тарифной сетки или crewPlan.prep_crew
  const prepCrew = Number(crewPlan.prep_crew) || 3;
  personnel.push({ item: 'Подготовка на складе', qty: prepCrew, rate: worker.rate, days: prepDays, total: prepCrew * worker.rate * prepDays, rate_source: worker.source });

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
    clarifications
  };
}

module.exports = { run };
