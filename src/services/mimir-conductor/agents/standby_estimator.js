/**
 * ASGARD CRM — Mimir Conductor: агент «Standby и простои» (Сессия 7, Шаг 7.5)
 * ═══════════════════════════════════════════════════════════════════════════
 * БЕЗ LLM. Закладывает резерв 5-15% от ФОТ на простой по вине заказчика
 * (ожидание останова, фронта работ, погодные standby). Процент зависит от
 * признаков риска: работа в действующем производстве, сезон, удалённость.
 *
 * Артефакт: standby_reserve
 *   { summary, key_findings[], reserve_pct, base_fot, standby_reserve, clarifications[] }
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const { formatRub } = require('./_util');

const BASE_PCT = 0.05;     // базовый резерв 5%
const OPERATING_PCT = 0.05; // +5% действующее производство
const WINTER_PCT = 0.03;   // +3% зимний период
const MAX_PCT = 0.15;      // потолок 15%

function isWinter(timing) {
  if (!timing || !timing.start) return false;
  const d = new Date(timing.start);
  if (Number.isNaN(d.getTime())) return false;
  const m = d.getMonth() + 1;
  return m >= 11 || m <= 3;
}

async function run({ requiredArtifacts, onThought }) {
  // crew_plan — обязательный по реестру; ФОТ берём из labor_cost, если доступен.
  const crewPlan = requiredArtifacts.crew_plan || {};
  const labor = requiredArtifacts.labor_cost || {};
  const tz = requiredArtifacts.tz_summary || {};

  onThought('Оцениваю резерв на простои по вине заказчика…');

  const baseFot = Number(labor.subtotal_fot) || 0;
  const cond = tz.conditions || {};
  const reasons = ['Базовый резерв на простой 5%'];

  let pct = BASE_PCT;
  if (cond.operating_facility) { pct += OPERATING_PCT; reasons.push('Действующее производство: +5% (ожидание окон останова)'); }
  if (isWinter(tz.timing)) { pct += WINTER_PCT; reasons.push('Зимний период: +3% (погодные standby)'); }
  pct = Math.min(pct, MAX_PCT);

  const reserve = Math.round(baseFot * pct);

  return {
    summary: `Резерв на простои: ${formatRub(reserve)} (${Math.round(pct * 100)}% от ФОТ${baseFot === 0 ? ', ФОТ не посчитан' : ''})`,
    key_findings: reasons.concat([`Итого резерв: ${formatRub(reserve)}`]),
    reserve_pct: Math.round(pct * 1000) / 10,
    base_fot: Math.round(baseFot),
    crew_count: Number(crewPlan.total_count) || 0,
    standby_reserve: reserve,
    assumptions: ['Резерв применён к ФОТ без налога; простои по вине Асгарда не закладываются'],
    clarifications: []
  };
}

module.exports = { run, isWinter };
