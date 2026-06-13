/**
 * ASGARD CRM — Mimir Conductor: агент «Расходники по объёму» (Сессия 7, Шаг 7.5)
 * ═══════════════════════════════════════════════════════════════════════════
 * БЕЗ LLM. Считает расходные материалы (насадки, щётки, форсунки, СИЗ-расходка)
 * пропорционально объёмам работ из resources. Привязка к объёму труб / м² /
 * чел-часам по нормам износа.
 *
 * Артефакт: consumables
 *   { summary, key_findings[], items:[{name,qty,unit,unit_price,total}],
 *     total_consumables, clarifications[] }
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const { formatRub } = require('./_util');
const { resolveNorm } = require('./_norms');

// Fallback нормы (применяются ТОЛЬКО если applicable_norms не содержит).
// Помечаются source='defaults' в output — РП видит что Mimir угадывает.
const FALLBACK_NOZZLE_PER_100 = 1;
const FALLBACK_NOZZLE_PRICE = 3500;
const FALLBACK_BRUSH_PER_100 = 2;
const FALLBACK_BRUSH_PRICE = 1200;
const FALLBACK_PPE_PER_MANDAY = 1;
const FALLBACK_PPE_PRICE = 450;

/** Суммарный объём работ из resources (сумма volume по позициям). */
function totalVolume(resources) {
  const list = Array.isArray(resources.resources) ? resources.resources : [];
  let v = 0;
  for (const r of list) {
    v += Number(r.volume) || Number(r.qty) || 0;
  }
  return v;
}

async function run({ requiredArtifacts, onThought }) {
  const resources = requiredArtifacts.resources || {};
  const labor = requiredArtifacts.labor_cost || {};

  onThought('Резолвлю нормы расходки из applicable_norms → fallback…');
  // Источник истины: applicable_norms.consumables_consumption_rules.{nozzle_per_100,
  // brush_per_100, ppe_per_manday, nozzle_price, brush_price, ppe_price}
  const nozzlePer100 = resolveNorm(requiredArtifacts, 'consumables_consumption_rules.nozzle_per_100', FALLBACK_NOZZLE_PER_100);
  const nozzlePrice = resolveNorm(requiredArtifacts, 'consumables_consumption_rules.nozzle_price_rub', FALLBACK_NOZZLE_PRICE);
  const brushPer100 = resolveNorm(requiredArtifacts, 'consumables_consumption_rules.brush_per_100', FALLBACK_BRUSH_PER_100);
  const brushPrice = resolveNorm(requiredArtifacts, 'consumables_consumption_rules.brush_price_rub', FALLBACK_BRUSH_PRICE);
  const ppePerManDay = resolveNorm(requiredArtifacts, 'consumables_consumption_rules.ppe_per_manday', FALLBACK_PPE_PER_MANDAY);
  const ppePrice = resolveNorm(requiredArtifacts, 'consumables_consumption_rules.ppe_price_rub', FALLBACK_PPE_PRICE);

  onThought(`Источники: насадка ${nozzlePer100.tier}, цена ${nozzlePrice.tier}, СИЗ ${ppePrice.tier}`);
  onThought('Считаю расходные материалы по объёму работ…');

  const vol = totalVolume(resources) || 100;
  const manDays = Number(labor.total_man_days) || 0;

  const nozzleQty = Math.max(1, Math.ceil((vol / 100) * nozzlePer100.value));
  const brushQty = Math.max(1, Math.ceil((vol / 100) * brushPer100.value));
  const ppeQty = Math.max(0, Math.ceil(manDays * ppePerManDay.value));

  const tagSrc = (t) => t === 'analogs' ? '✅' : t === 'company_profile' ? '⚙' : '⚠';
  const items = [
    { name: 'Насадки/форсунки', qty: nozzleQty, unit: 'шт', unit_price: nozzlePrice.value, total: nozzleQty * nozzlePrice.value, _source: nozzlePrice.tier },
    { name: 'Щётки/насадки механические', qty: brushQty, unit: 'шт', unit_price: brushPrice.value, total: brushQty * brushPrice.value, _source: brushPrice.tier }
  ];
  if (ppeQty > 0) {
    items.push({ name: 'СИЗ-расходка (перчатки, фильтры)', qty: ppeQty, unit: 'компл', unit_price: ppePrice.value, total: ppeQty * ppePrice.value, _source: ppePrice.tier });
  }

  const total = items.reduce((s, it) => s + it.total, 0);
  const tiers = { nozzle: nozzlePer100.tier, brush: brushPer100.tier, ppe: ppePerManDay.tier, prices: { nozzle: nozzlePrice.tier, brush: brushPrice.tier, ppe: ppePrice.tier } };

  return {
    summary: `Расходники: ${formatRub(total)} (база объём ${vol}, ${manDays} чел-дн)`,
    key_findings: items.map((it) => `${tagSrc(it._source)} ${it.name}: ${it.qty} ${it.unit} × ${formatRub(it.unit_price)} = ${formatRub(it.total)}`),
    items,
    total_consumables: total,
    base_volume: vol,
    _source_tiers: tiers,
    assumptions: [
      `Нормы расходки: ${JSON.stringify(tiers)}`,
      'Если все source=defaults — нужно загрузить эталоны (mimir_reference_projects) с consumables_consumption_rules'
    ],
    clarifications: []
  };
}

module.exports = { run, totalVolume };
