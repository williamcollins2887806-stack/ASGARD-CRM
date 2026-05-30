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

// Нормы износа расходки (грубо, привязка к суммарному объёму работ).
const NOZZLE_PER_100 = 1;       // 1 насадка/форсунка на 100 ед. объёма
const NOZZLE_PRICE = 3500;
const BRUSH_PER_100 = 2;        // 2 щётки на 100 ед.
const BRUSH_PRICE = 1200;
const PPE_PER_MANDAY = 1;       // 1 комплект СИЗ-расходки на чел-день
const PPE_PRICE = 450;

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

  onThought('Считаю расходные материалы по объёму работ…');

  const vol = totalVolume(resources) || 100; // дефолтная база, если объёмы не размечены
  const manDays = Number(labor.total_man_days) || 0;

  const nozzleQty = Math.max(1, Math.ceil((vol / 100) * NOZZLE_PER_100));
  const brushQty = Math.max(1, Math.ceil((vol / 100) * BRUSH_PER_100));
  const ppeQty = Math.max(0, Math.ceil(manDays * PPE_PER_MANDAY));

  const items = [
    { name: 'Насадки/форсунки', qty: nozzleQty, unit: 'шт', unit_price: NOZZLE_PRICE, total: nozzleQty * NOZZLE_PRICE },
    { name: 'Щётки/насадки механические', qty: brushQty, unit: 'шт', unit_price: BRUSH_PRICE, total: brushQty * BRUSH_PRICE }
  ];
  if (ppeQty > 0) {
    items.push({ name: 'СИЗ-расходка (перчатки, фильтры)', qty: ppeQty, unit: 'компл', unit_price: PPE_PRICE, total: ppeQty * PPE_PRICE });
  }

  const total = items.reduce((s, it) => s + it.total, 0);

  return {
    summary: `Расходники: ${formatRub(total)} (база объём ${vol}, ${manDays} чел-дн)`,
    key_findings: items.map((it) => `${it.name}: ${it.qty} ${it.unit} = ${formatRub(it.total)}`),
    items,
    total_consumables: total,
    base_volume: vol,
    assumptions: ['Нормы износа расходки приняты типовыми; объём взят из ресурсной ведомости'],
    clarifications: []
  };
}

module.exports = { run, totalVolume };
