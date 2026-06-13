/**
 * ASGARD CRM — Mimir Conductor: агент «Косвенные + налоги» (Сессия 6, Шаг 6.12)
 * ═══════════════════════════════════════════════════════════════════════════
 * Детерминированный расчёт БЕЗ LLM. По labor_cost (+ site_conditions, tz_summary)
 * считает все косвенные затраты: накладные, расходные, непредвиденные,
 * лимитированные (зимнее удорожание, ВЗИС), экологию, НДС.
 *
 * Артефакт: indirects
 *   { summary, key_findings[], base_personnel_with_tax, overhead, consumables,
 *     contingency, winter_surcharge, temp_buildings, ecology_cost, vat_pct, total_indirects }
 *
 * База расчёта — personnel_with_tax (ФОТ + налог 55%). Берём subtotal_fot из
 * labor_cost и применяем налог здесь же (final_consolidator применяет свои
 * коэффициенты к labor отдельно — indirects идёт как самостоятельный артефакт
 * с детальной раскладкой лимитированных, которых нет у консолидатора).
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const { formatRub } = require('./_util');

// Fallback-коэффициенты (применяются ТОЛЬКО при отсутствии эталонов в analogs
// и политик в company_profile). При каждом fallback в output идёт пометка
// 'tier:defaults' — РП видит что Conductor «угадывает».
const FALLBACK_FOT_TAX_PCT = 0.302;   // 30% страх. взносы + 0.2% НС/ПЗ V кл (ремонтные)
const FALLBACK_OVERHEAD_PCT = 0.193;  // 19.3% — реальная из эталона КАО Азот
const FALLBACK_CONSUMABLES_PCT = 0.03;
const FALLBACK_CONTINGENCY_PCT = 0.12;
const FALLBACK_WINTER_PCT = 0.04;
const FALLBACK_TEMP_BUILDINGS_PCT = 0.015;
const FALLBACK_ECOLOGY_PCT = 0.02;
const FALLBACK_VAT_PCT = 22;
const FALLBACK_WARRANTY_PCT = 0.024;

/**
 * Резолвим коэффициенты из источников истины в порядке приоритета:
 *   1. analogs_comparison.analysis.applicable_norms
 *   2. work_scope_research.company_profile.financial_policy
 *   3. fallback
 */
function resolveCoefficients(requiredArtifacts) {
  const norms = (requiredArtifacts.analogs_comparison && requiredArtifacts.analogs_comparison.analysis &&
                requiredArtifacts.analogs_comparison.analysis.applicable_norms) || {};
  const policy = (requiredArtifacts.work_scope_research && requiredArtifacts.work_scope_research.company_profile &&
                  requiredArtifacts.work_scope_research.company_profile.financial_policy) || {};
  const tiers = {};
  function pick(v1, v2, v3, name) {
    if (v1 != null && Number.isFinite(Number(v1))) { tiers[name] = 'analogs'; return Number(v1); }
    if (v2 != null && Number.isFinite(Number(v2))) { tiers[name] = 'company_profile'; return Number(v2); }
    tiers[name] = 'defaults'; return Number(v3);
  }
  return {
    fot_tax_pct: FALLBACK_FOT_TAX_PCT,
    overhead_pct: pick(
      norms.overheads_pct != null ? norms.overheads_pct / 100 : null,
      policy.overheads_pct_of_direct != null ? policy.overheads_pct_of_direct / 100 : null,
      FALLBACK_OVERHEAD_PCT, 'overhead'
    ),
    consumables_pct: FALLBACK_CONSUMABLES_PCT,
    contingency_pct: FALLBACK_CONTINGENCY_PCT,
    winter_pct: FALLBACK_WINTER_PCT,
    temp_buildings_pct: FALLBACK_TEMP_BUILDINGS_PCT,
    ecology_pct: FALLBACK_ECOLOGY_PCT,
    warranty_pct: pick(
      norms.warranty_pct != null ? norms.warranty_pct / 100 : null,
      policy.warranty_reserve_pct_of_revenue != null ? policy.warranty_reserve_pct_of_revenue / 100 : null,
      FALLBACK_WARRANTY_PCT, 'warranty'
    ),
    vat_pct: pick(norms.vat_pct, policy.vat_rate_pct, FALLBACK_VAT_PCT, 'vat'),
    _source_tiers: tiers
  };
}

/** Месяц старта зимний? (ноябрь..март) */
function isWinterStart(timing) {
  if (!timing || !timing.start) return false;
  const d = new Date(timing.start);
  if (Number.isNaN(d.getTime())) return false;
  const m = d.getMonth() + 1;
  return m >= 11 || m <= 3;
}

/** Признак химической промывки в методе работ. */
function isChemicalMethod(tz) {
  const method = (tz.scope && tz.scope.method) || [];
  const arr = Array.isArray(method) ? method : [method];
  const joined = arr.join(' ').toLowerCase();
  return /хим|chemical|кислот|реаген|промывк/.test(joined);
}

async function run({ requiredArtifacts, onThought }) {
  const labor = requiredArtifacts.labor_cost || {};
  const tz = requiredArtifacts.tz_summary || {};
  const siteConditions = requiredArtifacts.site_conditions || {};

  // КРИТИЧНЫЙ ФИКС: site_conditions.fot_multiplier теперь применяется ДО налога на
  // ФОТ. Раньше +78% надбавок за ОЗП/вредность/ночные/СИЗ просто терялись.
  let subtotalFot = Number(labor.subtotal_fot) || 0;
  const fotMultiplier = Number(siteConditions.fot_multiplier) || 1;
  if (fotMultiplier > 1) subtotalFot = subtotalFot * fotMultiplier;

  // Резолвим коэф. из эталонов / политик / fallback
  const coef = resolveCoefficients(requiredArtifacts);
  onThought(`Источники коэф.: накладные ${coef._source_tiers.overhead}, гарантия ${coef._source_tiers.warranty}`);
  if (fotMultiplier > 1) onThought(`Применён FOT-multiplier ${fotMultiplier.toFixed(2)} (надбавки за условия работ из site_conditions)`);

  onThought('Считаю налог на ФОТ и базу косвенных…');
  const fotTax = subtotalFot * coef.fot_tax_pct;
  const personnelWithTax = subtotalFot + fotTax;

  onThought('Считаю накладные, расходные, непредвиденные…');
  const overhead = personnelWithTax * coef.overhead_pct;
  const consumables = personnelWithTax * coef.consumables_pct;
  const contingency = personnelWithTax * coef.contingency_pct;

  onThought('Считаю лимитированные затраты (зима, ВЗИС, экология)…');
  const timing = tz.timing || {};
  const winter = isWinterStart(timing);
  const winterSurcharge = winter ? personnelWithTax * coef.winter_pct : 0;
  const tempBuildings = personnelWithTax * coef.temp_buildings_pct;
  const chemical = isChemicalMethod(tz);
  const ecologyCost = chemical ? personnelWithTax * coef.ecology_pct : 0;

  const round = (x) => Math.round(x);
  const totalIndirects = round(
    overhead + consumables + contingency + winterSurcharge + tempBuildings + ecologyCost
  );
  // Гарантийный резерв — от выручки, она ещё не посчитана здесь; считаем приближённо
  // от total_indirects + fot базы (final_consolidator пересчитает точно от revenue)
  const warrantyReserveEstimate = round((personnelWithTax + totalIndirects) * coef.warranty_pct);

  const sourceTag = (v) => v === 'analogs' ? '✅' : v === 'company_profile' ? '⚙' : '⚠';
  const findings = [
    `Персонал с налогом (база): ${formatRub(personnelWithTax)}`,
    fotMultiplier > 1 ? `FOT-multiplier за условия работ: ×${fotMultiplier.toFixed(2)} (применён)` : `FOT без надбавок (нет особых условий)`,
    `Накладные (${(coef.overhead_pct * 100).toFixed(1)}% ${sourceTag(coef._source_tiers.overhead)}): ${formatRub(overhead)}`,
    `Расходные (${(coef.consumables_pct * 100).toFixed(1)}%): ${formatRub(consumables)}`,
    `Непредвиденные (${(coef.contingency_pct * 100).toFixed(1)}%): ${formatRub(contingency)}`,
    `ВЗИС (${(coef.temp_buildings_pct * 100).toFixed(2)}%): ${formatRub(tempBuildings)}`,
    `Гарантийный резерв (${(coef.warranty_pct * 100).toFixed(2)}% ${sourceTag(coef._source_tiers.warranty)}): ${formatRub(warrantyReserveEstimate)}`
  ];
  if (winter) findings.push(`Зимнее удорожание (${(coef.winter_pct * 100).toFixed(1)}%): ${formatRub(winterSurcharge)}`);
  if (chemical) findings.push(`Экология/утилизация реагентов (${(coef.ecology_pct * 100).toFixed(1)}%): ${formatRub(ecologyCost)} — Асгард имеет свою лицензию, эта строка отражает внутренний cost`);

  return {
    summary: `Косвенные затраты: ${formatRub(totalIndirects)} (база ${formatRub(personnelWithTax)}, FOT-multiplier ${fotMultiplier})`,
    key_findings: findings,
    base_personnel_with_tax: round(personnelWithTax),
    subtotal_fot: round(subtotalFot),
    fot_multiplier_applied: fotMultiplier,
    fot_tax: round(fotTax),
    overhead: round(overhead),
    consumables: round(consumables),
    contingency: round(contingency),
    winter_surcharge: round(winterSurcharge),
    temp_buildings: round(tempBuildings),
    ecology_cost: round(ecologyCost),
    warranty_reserve: warrantyReserveEstimate,
    vat_pct: coef.vat_pct,
    total_indirects: totalIndirects,
    _coefficient_sources: coef._source_tiers,
    assumptions: [
      `Источники коэф.: ${JSON.stringify(coef._source_tiers)}`,
      winter ? `Старт в зимний период — учтено зимнее удорожание ${(coef.winter_pct * 100).toFixed(1)}%` : 'Несезонный старт — без зимы',
      chemical ? `Химический метод — экология ${(coef.ecology_pct * 100).toFixed(1)}% (Асгард-лицензия)` : 'Экологический сбор не применялся',
      fotMultiplier > 1 ? `FOT-multiplier ×${fotMultiplier.toFixed(2)} применён к ФОТ за надбавки (site_conditions)` : 'FOT-multiplier = 1 (нет особых условий)'
    ],
    clarifications: []
  };
}

module.exports = { run, isWinterStart, isChemicalMethod };
