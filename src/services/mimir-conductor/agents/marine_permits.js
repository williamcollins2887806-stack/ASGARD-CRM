/**
 * ASGARD CRM — Mimir Conductor: агент «Морские допуски» (Сессия 7, Шаг 7.5)
 * ═══════════════════════════════════════════════════════════════════════════
 * БЕЗ LLM. Морские/шельфовые допуски и сертификаты (МЛСП, БМПВО): требования,
 * сроки, стоимость. Триггерится по флагу has_MLSP / морским признакам в ТЗ.
 *
 * Артефакт: marine_permits
 *   { summary, key_findings[], permits:[{name,days,cost}], total_marine,
 *     lead_time_days, clarifications[] }
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const { formatRub } = require('./_util');
const { resolveNorm } = require('./_norms');

// БЕЗ ХАРДКОДА. Только структура (ключи + имена). Cost/days резолвятся из
// applicable_norms.marine_permits[key].cost_rub/days. Без — BLOCKING.
const PERMIT_KEYS = [
  { key: 'bmpvo', name: 'БМПВО (безопасность на море, выживание)' },
  { key: 'utm', name: 'Морские медкомиссии (УТМ)' },
  { key: 'mlsp', name: 'Допуск на МЛСП/платформу (вводный инструктаж заказчика)' },
  { key: 'siz', name: 'Сертификация СИЗ для морских работ' }
];

function isMarine(tz) {
  const text = JSON.stringify(tz || {}).toLowerCase();
  return /млсп|шельф|платформ|морск|offshore|бмпво|судно|плавуч/.test(text);
}

async function run({ requiredArtifacts, input, onThought }) {
  const tz = requiredArtifacts.tz_summary || {};

  onThought('Проверяю необходимость морских допусков…');

  const forced = input && (input.has_MLSP || input.marine);
  if (!isMarine(tz) && !forced) {
    return {
      summary: 'Морские допуски не требуются (объект не морской)',
      key_findings: ['Признаки МЛСП/шельфа/моря в ТЗ не выявлены'],
      permits: [], total_marine: 0, lead_time_days: 0, clarifications: []
    };
  }

  const crewCount = (requiredArtifacts.crew_plan && Number(requiredArtifacts.crew_plan.total_count)) || 1;
  // Резолвим каждый пермит из applicable_norms.marine_permits.{key}.cost/days. БЕЗ fallback.
  const sources = [];
  const missing = [];
  const permits = [];
  for (const p of PERMIT_KEYS) {
    const costR = resolveNorm(requiredArtifacts || {}, `marine_permits.${p.key}.cost_rub`, null);
    const daysR = resolveNorm(requiredArtifacts || {}, `marine_permits.${p.key}.days`, null);
    if (costR.value == null) missing.push(`marine_permits.${p.key}.cost_rub`);
    if (daysR.value == null) missing.push(`marine_permits.${p.key}.days`);
    sources.push({ permit: p.key, cost_tier: costR.tier, days_tier: daysR.tier });
    if (costR.value != null && daysR.value != null) {
      const isPerCrew = !/сиз/i.test(p.name);
      permits.push({
        name: p.name, days: daysR.value,
        cost: isPerCrew ? costR.value * Math.max(1, crewCount) : costR.value,
        _cost_source: costR.tier
      });
    }
  }
  if (missing.length) {
    const PERMIT_LABELS = {
      bmpvo: 'БМПВО (безопасность на море)', utm: 'УТМ (морская медкомиссия)',
      mlsp: 'Допуск на МЛСП/платформу', siz: 'Сертификация СИЗ морских работ'
    };
    const expected_inputs = missing.map((k) => {
      const parts = k.split('.'); // marine_permits.bmpvo.cost_rub
      const permitKey = parts[1];
      const field = parts[2];
      const isCost = field === 'cost_rub';
      return {
        key: `${permitKey}_${field}`,
        label: `${PERMIT_LABELS[permitKey] || permitKey} — ${isCost ? 'стоимость ₽/чел' : 'срок оформления (дн)'}`,
        type: 'number', unit: isCost ? '₽' : 'дн',
        hint: isCost
          ? `Стоимость допуска "${permitKey}" на одного человека. Сохранится для будущих морских проектов.`
          : `Срок оформления "${permitKey}" в днях.`,
        target: `reference_norms.${k}`
      };
    });
    return {
      summary: 'BLOCKED: морские допуски — нет цен/сроков в эталонах',
      key_findings: missing.map((k) => `BLOCKER: ${k}`),
      permits: [], total_marine: 0, lead_time_days: 0, crew_count: crewCount,
      _source_tiers: { missing },
      assumptions: [`Заполните прямо здесь — значения сохранятся в reference_norms для будущих морских проектов.`],
      clarifications: [{
        channel: 'PM', category: 'marine_permits', blocking: true,
        question_ru: `Нет морских допусков в эталонах: ${missing.join(', ')}. Заполните прямо здесь.`,
        expected_inputs
      }]
    };
  }
  const totalMarine = permits.reduce((s, p) => s + p.cost, 0);
  const leadTime = Math.max(...permits.map((p) => p.days), 0);

  return {
    summary: `Морские допуски: ${formatRub(totalMarine)} (срок оформления ~${leadTime} дн, бригада ${crewCount} чел)`,
    key_findings: permits.map((p) => `${p.name}: ${formatRub(p.cost)}`),
    permits,
    total_marine: totalMarine,
    lead_time_days: leadTime,
    crew_count: crewCount,
    assumptions: ['Стоимость допусков масштабирована на численность бригады; уточняется по требованиям оператора платформы'],
    clarifications: [{
      channel: 'CUSTOMER', category: 'permits', blocking: false,
      question_ru: 'Подтвердите перечень обязательных морских допусков (БМПВО, медкомиссии, сертификаты СИЗ) и срок их действия для допуска на объект.'
    }]
  };
}

module.exports = { run, isMarine };
