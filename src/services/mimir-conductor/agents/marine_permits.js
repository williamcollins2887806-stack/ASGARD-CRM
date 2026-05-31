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

// Типовые морские допуски: стоимость подготовки/обучения на бригаду, ₽.
const PERMITS = [
  { name: 'БМПВО (безопасность на море, выживание)', days: 5, cost: 45000 },
  { name: 'Морские медкомиссии (УТМ)', days: 3, cost: 18000 },
  { name: 'Допуск на МЛСП/платформу (вводный инструктаж заказчика)', days: 2, cost: 12000 },
  { name: 'Сертификация СИЗ для морских работ', days: 0, cost: 25000 }
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
  // Стоимость обучения/допусков масштабируется на численность для подушевых пунктов.
  const permits = PERMITS.map((p) => ({
    name: p.name,
    days: p.days,
    cost: /сиз/i.test(p.name) ? p.cost : p.cost * Math.max(1, crewCount)
  }));
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
