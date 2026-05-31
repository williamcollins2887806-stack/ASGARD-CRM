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

const FOT_TAX_PCT = 0.55;       // налог на ФОТ 55%
const OVERHEAD_PCT = 0.15;      // накладные 15%
const CONSUMABLES_PCT = 0.03;   // расходные 3%
const CONTINGENCY_PCT = 0.12;   // непредвиденные 12%
const WINTER_PCT = 0.04;        // зимнее удорожание (упрощённо 4%)
const TEMP_BUILDINGS_PCT = 0.015; // ВЗИС 1.5%
const ECOLOGY_PCT = 0.02;       // утилизация реагентов (для химпромывок) 2%
const DEFAULT_VAT_PCT = 22;     // НДС 22%

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
  const subtotalFot = Number(labor.subtotal_fot) || 0;

  onThought('Считаю налог на ФОТ и базу косвенных…');
  const fotTax = subtotalFot * FOT_TAX_PCT;
  const personnelWithTax = subtotalFot + fotTax;

  onThought('Считаю накладные, расходные, непредвиденные…');
  const overhead = personnelWithTax * OVERHEAD_PCT;
  const consumables = personnelWithTax * CONSUMABLES_PCT;
  const contingency = personnelWithTax * CONTINGENCY_PCT;

  onThought('Считаю лимитированные затраты (зима, ВЗИС, экология)…');
  const timing = tz.timing || {};
  const winter = isWinterStart(timing);
  const winterSurcharge = winter ? personnelWithTax * WINTER_PCT : 0;
  const tempBuildings = personnelWithTax * TEMP_BUILDINGS_PCT;
  const chemical = isChemicalMethod(tz);
  const ecologyCost = chemical ? personnelWithTax * ECOLOGY_PCT : 0;

  const round = (x) => Math.round(x);
  const totalIndirects = round(
    overhead + consumables + contingency + winterSurcharge + tempBuildings + ecologyCost
  );

  const findings = [
    `Персонал с налогом (база): ${formatRub(personnelWithTax)}`,
    `Накладные (15%): ${formatRub(overhead)}`,
    `Расходные (3%): ${formatRub(consumables)}`,
    `Непредвиденные (12%): ${formatRub(contingency)}`,
    `ВЗИС (1.5%): ${formatRub(tempBuildings)}`
  ];
  if (winter) findings.push(`Зимнее удорожание (4%): ${formatRub(winterSurcharge)}`);
  if (chemical) findings.push(`Экология/утилизация реагентов (2%): ${formatRub(ecologyCost)} — у Асгарда лицензия, внутренняя себестоимость`);

  return {
    summary: `Косвенные затраты: ${formatRub(totalIndirects)} (база ${formatRub(personnelWithTax)})`,
    key_findings: findings,
    base_personnel_with_tax: round(personnelWithTax),
    subtotal_fot: round(subtotalFot),
    fot_tax: round(fotTax),
    overhead: round(overhead),
    consumables: round(consumables),
    contingency: round(contingency),
    winter_surcharge: round(winterSurcharge),
    temp_buildings: round(tempBuildings),
    ecology_cost: round(ecologyCost),
    vat_pct: DEFAULT_VAT_PCT,
    total_indirects: totalIndirects,
    assumptions: [
      winter ? 'Старт в зимний период — учтено зимнее удорожание 4%' : 'Несезонный старт — зимнее удорожание не применялось',
      chemical ? 'Химический метод — учтена утилизация реагентов (лицензия Асгарда)' : 'Экологический сбор не применялся'
    ],
    clarifications: []
  };
}

module.exports = { run, isWinterStart, isChemicalMethod };
