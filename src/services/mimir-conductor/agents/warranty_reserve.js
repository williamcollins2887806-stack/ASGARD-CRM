/**
 * ASGARD CRM — Mimir Conductor: агент «Гарантийный резерв» (Сессия 7, Шаг 7.5)
 * ═══════════════════════════════════════════════════════════════════════════
 * БЕЗ LLM. Считает резерв на гарантийные обязательства 1-3% от себестоимости
 * по сроку гарантии (из tz_summary.warranty_months, если есть) и характеру
 * работ. База — себестоимость из indirects (персонал с налогом + косвенные).
 *
 * Артефакт: warranty
 *   { summary, key_findings[], reserve_pct, warranty_months, base_cost,
 *     warranty_reserve, clarifications[] }
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const { formatRub } = require('./_util');

const BASE_PCT = 0.01;       // 1% базово
const LONG_WARRANTY_PCT = 0.02; // >24 мес → 2%
const CRITICAL_PCT = 0.03;   // критичные работы → 3%

async function run({ requiredArtifacts, onThought }) {
  const indirects = requiredArtifacts.indirects || {};
  const tz = requiredArtifacts.tz_summary || {};

  onThought('Считаю гарантийный резерв…');

  const baseCost = (Number(indirects.base_personnel_with_tax) || 0) + (Number(indirects.total_indirects) || 0);
  const warrantyMonths = Number(tz.warranty_months) || (tz.scope && Number(tz.scope.warranty_months)) || 12;

  let pct = BASE_PCT;
  const reasons = ['Базовый гарантийный резерв 1%'];
  if (warrantyMonths > 24) { pct = LONG_WARRANTY_PCT; reasons.push(`Срок гарантии ${warrantyMonths} мес (>24) → 2%`); }

  const ms = ((tz.scope && tz.scope.method) || []).join(' ').toLowerCase();
  if (/сварк|трубопровод|сосуд|давлен/.test(ms)) { pct = CRITICAL_PCT; reasons.push('Ответственные работы (сварка/давление) → 3%'); }

  const reserve = Math.round(baseCost * pct);

  return {
    summary: `Гарантийный резерв: ${formatRub(reserve)} (${Math.round(pct * 100)}% от себестоимости, гарантия ${warrantyMonths} мес)`,
    key_findings: reasons.concat([`Итого резерв: ${formatRub(reserve)}`]),
    reserve_pct: Math.round(pct * 1000) / 10,
    warranty_months: warrantyMonths,
    base_cost: Math.round(baseCost),
    warranty_reserve: reserve,
    assumptions: ['Срок гарантии при отсутствии в ТЗ принят 12 мес'],
    clarifications: []
  };
}

module.exports = { run };
