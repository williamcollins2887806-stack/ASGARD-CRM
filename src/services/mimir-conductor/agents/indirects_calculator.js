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
// БЕЗ ХАРДКОДА. Все коэффициенты из applicable_norms (эталоны) → company_profile
// (settings.company_profile.financial_policy) → BLOCKING.

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
  function pick(v1, v2, name) {
    if (v1 != null && Number.isFinite(Number(v1))) { tiers[name] = 'analogs'; return Number(v1); }
    if (v2 != null && Number.isFinite(Number(v2))) { tiers[name] = 'company_profile'; return Number(v2); }
    tiers[name] = 'missing'; return null;
  }
  return {
    fot_tax_pct: pick(norms.fot_tax_pct, policy.fot_tax_pct, 'fot_tax'),
    overhead_pct: pick(
      norms.overheads_pct != null ? norms.overheads_pct / 100 : null,
      policy.overheads_pct_of_direct != null ? policy.overheads_pct_of_direct / 100 : null,
      'overhead'
    ),
    consumables_pct: pick(
      norms.consumables_pct_of_personnel != null ? norms.consumables_pct_of_personnel / 100 : null,
      policy.consumables_pct_of_personnel != null ? policy.consumables_pct_of_personnel / 100 : null,
      'consumables'
    ),
    contingency_pct: pick(
      norms.contingency_pct != null ? norms.contingency_pct / 100 : null,
      policy.contingency_pct != null ? policy.contingency_pct / 100 : null,
      'contingency'
    ),
    winter_pct: pick(
      norms.winter_pct != null ? norms.winter_pct / 100 : null,
      policy.winter_pct != null ? policy.winter_pct / 100 : null,
      'winter'
    ),
    temp_buildings_pct: pick(
      norms.temp_buildings_pct != null ? norms.temp_buildings_pct / 100 : null,
      policy.temp_buildings_pct != null ? policy.temp_buildings_pct / 100 : null,
      'temp_buildings'
    ),
    ecology_pct: pick(
      norms.ecology_pct != null ? norms.ecology_pct / 100 : null,
      policy.ecology_pct != null ? policy.ecology_pct / 100 : null,
      'ecology'
    ),
    warranty_pct: pick(
      norms.warranty_pct != null ? norms.warranty_pct / 100 : null,
      policy.warranty_reserve_pct_of_revenue != null ? policy.warranty_reserve_pct_of_revenue / 100 : null,
      'warranty'
    ),
    vat_pct: pick(norms.vat_pct, policy.vat_rate_pct, 'vat'),
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

  // Резолвим коэф. из эталонов / company_profile. БЕЗ fallback.
  const coef = resolveCoefficients(requiredArtifacts);
  onThought(`Источники коэф.: накладные ${coef._source_tiers.overhead}, гарантия ${coef._source_tiers.warranty}`);
  if (fotMultiplier > 1) onThought(`Применён FOT-multiplier ${fotMultiplier.toFixed(2)} (надбавки за условия работ из site_conditions)`);

  // Проверка отсутствующих критичных коэф.
  const required = ['fot_tax', 'overhead', 'warranty', 'vat'];
  const missingCritical = required.filter((k) => coef._source_tiers[k] === 'missing');
  if (missingCritical.length) {
    // Структурированные поля для inline-ввода РП в War Room
    const FIELD_MAP = {
      fot_tax: { label: 'Налог на ФОТ (%)', type: 'number', unit: '%',
        hint: 'Страховые взносы 30% + НС/ПЗ (для ремонтных работ V класс 0.2%). Сохранится в settings.company_profile.financial_policy.fot_tax_pct',
        target: 'company_profile.financial_policy.fot_tax_pct' },
      overhead: { label: 'Накладные расходы (% от прямых)', type: 'number', unit: '%',
        hint: 'Доля накладных от прямой себестоимости (ФОТ+налог). Например: 19.3 (КАО Азот) или 18-25 (типовое). Сохранится в company_profile.financial_policy.overheads_pct_of_direct',
        target: 'company_profile.financial_policy.overheads_pct_of_direct' },
      warranty: { label: 'Гарантийный резерв (% от выручки)', type: 'number', unit: '%',
        hint: 'Резерв на гарантийные обязательства от revenue. Например: 2.4 (КАО Азот). Сохранится в company_profile.financial_policy.warranty_reserve_pct_of_revenue',
        target: 'company_profile.financial_policy.warranty_reserve_pct_of_revenue' },
      vat: { label: 'НДС (%)', type: 'number', unit: '%',
        hint: 'Ставка НДС на дату подачи. С 2026 — 22%. Сохранится в company_profile.financial_policy.vat_rate_pct',
        target: 'company_profile.financial_policy.vat_rate_pct' }
    };
    const expected_inputs = missingCritical.map((k) => ({ key: k + '_pct', ...FIELD_MAP[k] }));
    return {
      summary: 'BLOCKED: критичные коэффициенты не найдены в эталонах/company_profile',
      key_findings: missingCritical.map((k) => `BLOCKER: ${k}_pct не найден`),
      base_personnel_with_tax: 0, subtotal_fot: Math.round(subtotalFot),
      fot_multiplier_applied: fotMultiplier, fot_tax: 0,
      overhead: 0, consumables: 0, contingency: 0,
      winter_surcharge: 0, temp_buildings: 0, ecology_cost: 0,
      warranty_reserve: 0, vat_pct: 0, total_indirects: 0,
      _coefficient_sources: coef._source_tiers,
      assumptions: ['Заполните поля прямо в War Room — данные сохранятся в settings.company_profile и просчёт продолжится.'],
      clarifications: [{
        channel: 'PM', category: 'indirects', blocking: true,
        question_ru: `Не найдены коэффициенты ССР: ${missingCritical.join(', ')}. Заполните прямо здесь.`,
        expected_inputs
      }]
    };
  }

  onThought('Считаю налог на ФОТ и базу косвенных…');
  const fotTax = subtotalFot * coef.fot_tax_pct;
  const personnelWithTax = subtotalFot + fotTax;

  onThought('Считаю накладные, расходные, непредвиденные…');
  const overhead = personnelWithTax * coef.overhead_pct;
  const consumables = coef.consumables_pct != null ? personnelWithTax * coef.consumables_pct : 0;
  const contingency = coef.contingency_pct != null ? personnelWithTax * coef.contingency_pct : 0;

  onThought('Считаю лимитированные затраты (зима, ВЗИС, экология)…');
  const timing = tz.timing || {};
  const winter = isWinterStart(timing);
  const winterSurcharge = (winter && coef.winter_pct != null) ? personnelWithTax * coef.winter_pct : 0;
  const tempBuildings = coef.temp_buildings_pct != null ? personnelWithTax * coef.temp_buildings_pct : 0;
  const chemical = isChemicalMethod(tz);
  const ecologyCost = (chemical && coef.ecology_pct != null) ? personnelWithTax * coef.ecology_pct : 0;

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
