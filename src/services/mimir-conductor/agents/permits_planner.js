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

// БЕЗ ХАРДКОДА. Список ключей-категорий допусков (структура, без цен).
const PERMIT_CATEGORY_KEYS = ['отзп', 'охрана труда', 'высот', 'высота', 'накс', 'сварка', 'вик', 'контроль'];

/** Стоимость обучения только из applicable_norms.training_costs_rub_per_permit.{key}. БЕЗ fallback. */
function costForPermit(permit, requiredArtifacts) {
  const key = String(permit || '').toLowerCase();
  for (const k of PERMIT_CATEGORY_KEYS) {
    if (key.includes(k)) {
      const r = resolveNorm(requiredArtifacts || {}, `training_costs_rub_per_permit.${k}`, null);
      if (r.value != null) return { cost: r.value, source: r.tier, matched_key: k };
    }
  }
  const other = resolveNorm(requiredArtifacts || {}, 'training_costs_rub_per_permit.other', null);
  if (other.value != null) return { cost: other.value, source: other.tier, matched_key: 'other' };
  return { cost: null, source: 'missing', matched_key: null };
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
  const missing = [];

  for (const reqP of required) {
    const key = String(reqP).toLowerCase();
    const covered = [...crewPermits].some((p) => p.includes(key) || key.includes(p));
    if (covered) {
      have.push(reqP);
    } else {
      const count = Math.max(2, Math.ceil(crew.length / 2)) || 2;
      const c = costForPermit(reqP, requiredArtifacts);
      if (c.cost == null) {
        missing.push(reqP);
      } else {
        toTrain.push({ permit: reqP, count, cost_each: c.cost, cost_total: count * c.cost, _source: c.source });
      }
    }
  }
  if (missing.length) {
    const expected_inputs = missing.map((p) => ({
      key: `cost_${String(p).toLowerCase().replace(/[^а-яa-z0-9]/g, '_')}`,
      label: `Стоимость обучения "${p}" (₽/чел)`,
      type: 'number', unit: '₽',
      hint: `Сколько стоит обучить одного человека на допуск "${p}". Сохранится в reference_norms.training_costs_rub_per_permit.<категория> и будет применяться для будущих просчётов.`,
      target: `reference_norms.training_costs_rub_per_permit.${String(p).toLowerCase().split(/[\s(]+/)[0]}`
    }));
    return {
      summary: 'BLOCKED: стоимости обучения не найдены в эталонах',
      key_findings: missing.map((p) => `BLOCKER: training_costs_rub_per_permit для "${p}" не найдено`),
      have, to_train: [], to_hire_external: [], total_training_cost: 0,
      clarifications: [{
        channel: 'PM', category: 'permits', blocking: true,
        question_ru: `Нет стоимостей обучения по допускам: ${missing.join('; ')}. Заполните прямо здесь.`,
        expected_inputs
      }]
    };
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
