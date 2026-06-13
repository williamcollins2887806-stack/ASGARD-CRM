/**
 * ASGARD CRM — Mimir Conductor: агент «Допуски + обучение» (Сессия 6, Шаг 6.11)
 * ═══════════════════════════════════════════════════════════════════════════
 * Сверяет требуемые допуски (tz_summary.permits_required) с допусками выбранных
 * сотрудников (crew_plan + employee_permits). Чего не хватает — закладывает
 * стоимость обучения по справочнику.
 *
 * Артефакт: permits_plan
 *   { summary, key_findings[], have:[...], to_train:[{permit,count,cost_each,cost_total}],
 *     to_hire_external:[...], total_training_cost }
 *
 * Sonnet 4.6 + Python-матчер. На stub — детерминированный матчер по БД (без LLM).
 * Стоимость обучения (₽/чел): ОТЗП 28к, Высота 20к, НАКС 65к, ВИК 35к, прочее 15к.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const db = require('../../db');
const { formatRub } = require('./_util');
const { resolveNorm } = require('./_norms');

// Fallback стоимости обучения (применяется только если нет в applicable_norms).
const FALLBACK_TRAINING_COST = {
  'отзп': 28000, 'охрана труда': 28000,
  'высот': 20000, 'высота': 20000,
  'накс': 65000, 'сварка': 65000,
  'вик': 35000, 'контроль': 35000
};
const FALLBACK_OTHER_TRAINING = 15000;

/** Стоимость обучения с приоритетом: applicable_norms.training_costs_rub_per_permit.{key} → fallback. */
function costForPermit(permit, requiredArtifacts) {
  const key = String(permit || '').toLowerCase();
  // Сначала пробуем из эталонов по конкретному имени допуска
  for (const k of Object.keys(FALLBACK_TRAINING_COST)) {
    if (key.includes(k)) {
      const r = resolveNorm(requiredArtifacts || {}, `training_costs_rub_per_permit.${k}`, FALLBACK_TRAINING_COST[k]);
      return { cost: r.value, source: r.tier, matched_key: k };
    }
  }
  // Прочие
  const other = resolveNorm(requiredArtifacts || {}, 'training_costs_rub_per_permit.other', FALLBACK_OTHER_TRAINING);
  return { cost: other.value, source: other.tier, matched_key: 'other' };
}

/** Загрузить допуски сотрудников бригады из employee_permits. */
async function loadCrewPermits(employeeIds) {
  const ids = employeeIds.filter((x) => Number.isInteger(x) && x > 0);
  if (!ids.length) return new Map();
  try {
    const r = await db.query(
      `SELECT employee_id, permit_type FROM employee_permits
       WHERE employee_id = ANY($1::int[])
         AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)`,
      [ids]
    );
    const map = new Map();
    for (const row of r.rows) {
      if (!map.has(row.employee_id)) map.set(row.employee_id, []);
      map.get(row.employee_id).push(row.permit_type);
    }
    return map;
  } catch (_) {
    return new Map();
  }
}

async function run({ requiredArtifacts, onThought }) {
  const tz = requiredArtifacts.tz_summary || {};
  const crewPlan = requiredArtifacts.crew_plan || {};
  const required = Array.isArray(tz.permits_required) ? tz.permits_required : [];
  const crew = Array.isArray(crewPlan.crew) ? crewPlan.crew : [];

  onThought(`Проверяю допуски: требуется ${required.length} типов, бригада ${crew.length} чел…`);

  const employeeIds = crew.map((m) => m.employee_id).filter(Boolean);
  const permitsMap = await loadCrewPermits(employeeIds);

  // Все допуски, имеющиеся у бригады (плоский набор).
  const crewPermits = new Set();
  for (const list of permitsMap.values()) {
    for (const p of list) crewPermits.add(String(p).toLowerCase());
  }

  const have = [];
  const toTrain = [];

  for (const reqP of required) {
    const key = String(reqP).toLowerCase();
    const covered = [...crewPermits].some((p) => p.includes(key) || key.includes(p));
    if (covered) {
      have.push(reqP);
    } else {
      // Сколько человек обучить: грубо — половина бригады, минимум 2.
      const count = Math.max(2, Math.ceil(crew.length / 2)) || 2;
      const c = costForPermit(reqP, requiredArtifacts);
      toTrain.push({ permit: reqP, count, cost_each: c.cost, cost_total: count * c.cost, _source: c.source });
    }
  }

  const totalTraining = toTrain.reduce((s, x) => s + x.cost_total, 0);

  return {
    summary: `Допуски: есть ${have.length}, обучить ${toTrain.length} (${formatRub(totalTraining)})`,
    key_findings: [
      `Требуется допусков: ${required.length}`,
      `Покрыто бригадой: ${have.length}`,
      `Нужно обучение: ${toTrain.map((t) => t.permit + ' (' + t.count + ' чел)').join(', ') || 'нет'}`,
      `Стоимость обучения: ${formatRub(totalTraining)}`
    ],
    have,
    to_train: toTrain,
    to_hire_external: [],
    total_training_cost: totalTraining,
    clarifications: toTrain.length ? [{
      channel: 'PM', category: 'permits', blocking: false,
      question_ru: `Не хватает допусков: ${toTrain.map((t) => t.permit).join('; ')}. Обучить наших (заложено ${formatRub(totalTraining)}) или привлечь сторонних?`,
      default_assumption: { action: 'train_own' }
    }] : []
  };
}

module.exports = { run, costForPermit };
