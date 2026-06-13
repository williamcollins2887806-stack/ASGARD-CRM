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

// Fallback (применяется ТОЛЬКО если applicable_norms.marine_permits отсутствует).
const FALLBACK_PERMITS = [
  { key: 'bmpvo', name: 'БМПВО (безопасность на море, выживание)', days: 5, cost: 45000 },
  { key: 'utm', name: 'Морские медкомиссии (УТМ)', days: 3, cost: 18000 },
  { key: 'mlsp', name: 'Допуск на МЛСП/платформу (вводный инструктаж заказчика)', days: 2, cost: 12000 },
  { key: 'siz', name: 'Сертификация СИЗ для морских работ', days: 0, cost: 25000 }
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
  // Резолвим каждый пермит из applicable_norms.marine_permits.{key}.cost/days или fallback
  const sources = [];
  const permits = FALLBACK_PERMITS.map((p) => {
    const costR = resolveNorm(requiredArtifacts || {}, `marine_permits.${p.key}.cost_rub`, p.cost);
    const daysR = resolveNorm(requiredArtifacts || {}, `marine_permits.${p.key}.days`, p.days);
    sources.push({ permit: p.key, cost_tier: costR.tier, days_tier: daysR.tier });
    const isPerCrew = !/сиз/i.test(p.name);
    return {
      name: p.name,
      days: daysR.value,
      cost: isPerCrew ? costR.value * Math.max(1, crewCount) : costR.value,
      _cost_source: costR.tier
    };
  });
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
