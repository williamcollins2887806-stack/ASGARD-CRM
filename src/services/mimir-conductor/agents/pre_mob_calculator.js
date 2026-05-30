/**
 * ASGARD CRM — Mimir Conductor: агент «Pre-mob и подготовка» (Сессия 7, Шаг 7.5)
 * ═══════════════════════════════════════════════════════════════════════════
 * БЕЗ LLM. Считает затраты на мобилизацию/подготовку: складская подготовка
 * (комплектация, погрузка) + ИТР на этапе подготовки площадки/бытовых городков.
 *
 * Артефакт: pre_mob_cost
 *   { summary, key_findings[], prep_days, warehouse_crew, itr_count,
 *     warehouse_cost, itr_cost, total_pre_mob, clarifications[] }
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const { formatRub } = require('./_util');

const WAREHOUSE_RATE = 4500;   // ₽/чел/день складского
const ITR_RATE = 10000;        // ₽/чел/день ИТР на подготовке
const DEFAULT_PREP_DAYS = 3;   // 2-5 дней
const WAREHOUSE_CREW = 2;      // складские
const ITR_COUNT = 1;           // ИТР на подготовке (2-3 для крупных)

async function run({ requiredArtifacts, onThought }) {
  const crewPlan = requiredArtifacts.crew_plan || {};
  const totalCount = Number(crewPlan.total_count) || (crewPlan.crew ? crewPlan.crew.length : 0) || 4;

  onThought('Считаю мобилизацию и подготовку площадки…');

  // Чем больше бригада — тем дольше подготовка и больше ИТР.
  const prepDays = totalCount > 12 ? 5 : (totalCount > 6 ? 4 : DEFAULT_PREP_DAYS);
  const itrCount = totalCount > 12 ? 3 : (totalCount > 6 ? 2 : ITR_COUNT);
  const warehouseCrew = totalCount > 8 ? 3 : WAREHOUSE_CREW;

  const warehouseCost = warehouseCrew * WAREHOUSE_RATE * prepDays;
  const itrCost = itrCount * ITR_RATE * prepDays;
  const totalPreMob = warehouseCost + itrCost;

  return {
    summary: `Мобилизация/подготовка: ${formatRub(totalPreMob)} (${prepDays} дн, ${warehouseCrew} складских + ${itrCount} ИТР)`,
    key_findings: [
      `Подготовка: ${prepDays} дн`,
      `Складская комплектация: ${warehouseCrew} чел × ${formatRub(WAREHOUSE_RATE)}/дн = ${formatRub(warehouseCost)}`,
      `ИТР на подготовке: ${itrCount} чел × ${formatRub(ITR_RATE)}/дн = ${formatRub(itrCost)}`
    ],
    prep_days: prepDays,
    warehouse_crew: warehouseCrew,
    itr_count: itrCount,
    warehouse_cost: warehouseCost,
    itr_cost: itrCost,
    total_pre_mob: totalPreMob,
    assumptions: ['Сроки/состав подготовки оценены эвристически по размеру бригады'],
    clarifications: []
  };
}

module.exports = { run };
