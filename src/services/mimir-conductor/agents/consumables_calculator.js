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

const db = require('../../db');
const aiProvider = require('../../ai-provider');
const { formatRub } = require('./_util');
const { resolveNorm } = require('./_norms');

// БЕЗ ХАРДКОДА. Источники в порядке приоритета:
//   1. applicable_norms.consumables_consumption_rules (из эталонов mimir_reference_projects)
//   2. products каталог (для цен — реальные last_price_rub поставщиков)
//   3. AI web search (Perplexity Sonar — поиск рыночных цен 2026)
// Если нет ни в одном — поднимается BLOCKING-уточнение (без выдуманных цифр).

/** Цена позиции из каталога products по фрагменту имени/категории. */
async function priceFromCatalog(nameFragment, categoryFragment) {
  try {
    const r = await db.query(
      `SELECT id, name, last_price_rub
         FROM products
        WHERE deleted_at IS NULL
          AND (lower(name) ILIKE $1 OR lower(category) ILIKE $2)
          AND last_price_rub > 0
        ORDER BY last_price_rub DESC LIMIT 1`,
      [`%${String(nameFragment || '').toLowerCase()}%`, `%${String(categoryFragment || '').toLowerCase()}%`]
    );
    if (r.rows[0]) {
      return { value: Number(r.rows[0].last_price_rub), source: 'catalog', matched_name: r.rows[0].name };
    }
  } catch (_) { /* products таблицы может не быть */ }
  return null;
}

/** Цена позиции через AI web search (perplexity sonar). Медиана 3-5 предложений. */
async function priceFromWebSearch(query) {
  if (aiProvider.isStubMode && aiProvider.isStubMode()) return null;
  try {
    const result = await aiProvider.searchWeb({
      query: `${query} цена 2026 рублей купить оптом`,
      model: 'sonar-opus', maxResults: 5
    });
    const prices = (result.citations || []).map((c) => {
      const m = String(c.snippet || c.title || '').match(/(\d[\d\s.,]{2,})\s*(?:руб|₽|р\.)/i);
      if (!m) return null;
      const num = Number(m[1].replace(/[\s.]/g, '').replace(',', '.'));
      return Number.isFinite(num) && num > 50 ? num : null;
    }).filter(Boolean).sort((a, b) => a - b);
    if (prices.length >= 2) {
      const mid = Math.floor(prices.length / 2);
      const median = prices.length % 2 ? prices[mid] : Math.round((prices[mid - 1] + prices[mid]) / 2);
      return { value: median, source: 'web_search', sample_count: prices.length };
    }
  } catch (_) { /* searchWeb может упасть в stub */ }
  return null;
}

/** Суммарный объём работ из resources (сумма volume по позициям). */
function totalVolume(resources) {
  const list = Array.isArray(resources.resources) ? resources.resources : [];
  let v = 0;
  for (const r of list) {
    v += Number(r.volume) || Number(r.qty) || 0;
  }
  return v;
}

/** Резолвер нормы расхода: только applicable_norms (эталоны) → null (blocking). */
function resolveConsumptionRate(requiredArtifacts, key) {
  const r = resolveNorm(requiredArtifacts, `consumables_consumption_rules.${key}`, null);
  if (r.value != null) return { value: r.value, source: r.tier };
  return { value: null, source: 'missing' };
}

/** Резолвер цены: applicable_norms → products каталог → AI web search → null (blocking). */
async function resolvePrice(requiredArtifacts, key, catalogQuery, webQuery) {
  const r = resolveNorm(requiredArtifacts, `consumables_consumption_rules.${key}`, null);
  if (r.value != null) return { value: r.value, source: r.tier };
  if (catalogQuery) {
    const cat = await priceFromCatalog(catalogQuery.name, catalogQuery.category);
    if (cat) return { value: cat.value, source: 'catalog', matched_name: cat.matched_name };
  }
  if (webQuery) {
    const web = await priceFromWebSearch(webQuery);
    if (web) return { value: web.value, source: 'web_search', sample_count: web.sample_count };
  }
  return { value: null, source: 'missing' };
}

async function run({ requiredArtifacts, onThought }) {
  const resources = requiredArtifacts.resources || {};
  const labor = requiredArtifacts.labor_cost || {};
  const clarifications = [];

  onThought('Резолвлю нормы расхода: applicable_norms (эталоны)…');
  const nozzlePer100 = resolveConsumptionRate(requiredArtifacts, 'nozzle_per_100');
  const brushPer100 = resolveConsumptionRate(requiredArtifacts, 'brush_per_100');
  const ppePerManDay = resolveConsumptionRate(requiredArtifacts, 'ppe_per_manday');

  onThought('Резолвлю цены: applicable_norms → products каталог → AI web search…');
  const nozzlePrice = await resolvePrice(requiredArtifacts, 'nozzle_price_rub',
    { name: 'насадк', category: 'расходник' }, 'насадка форсунка гидроочистки');
  const brushPrice = await resolvePrice(requiredArtifacts, 'brush_price_rub',
    { name: 'щётка', category: 'расходник' }, 'щётка металлическая для чистки трубок');
  const ppePrice = await resolvePrice(requiredArtifacts, 'ppe_price_rub',
    { name: 'СИЗ', category: 'СИЗ' }, 'СИЗ комплект перчатки респиратор фильтры');

  const missing = [];
  for (const [k, r] of [['nozzle_per_100', nozzlePer100], ['nozzle_price_rub', nozzlePrice],
                        ['brush_per_100', brushPer100], ['brush_price_rub', brushPrice],
                        ['ppe_per_manday', ppePerManDay], ['ppe_price_rub', ppePrice]]) {
    if (r.value == null) missing.push(k);
  }
  if (missing.length) {
    const FIELD_MAP = {
      nozzle_per_100: { label: 'Норма насадок (шт на 100 ед объёма)', type: 'number', unit: 'шт',
        hint: 'Сколько насадок/форсунок изнашивается на 100 единиц объёма работ. Сохранится в applicable_norms эталона.',
        target: 'reference_norms.consumables_consumption_rules.nozzle_per_100' },
      nozzle_price_rub: { label: 'Цена насадки (₽/шт)', type: 'number', unit: '₽',
        hint: 'Цена одной насадки/форсунки. Можно добавить в каталог products или в applicable_norms.',
        target: 'reference_norms.consumables_consumption_rules.nozzle_price_rub' },
      brush_per_100: { label: 'Норма щёток (шт на 100 ед)', type: 'number', unit: 'шт',
        hint: 'Сколько щёток изнашивается на 100 единиц объёма работ.',
        target: 'reference_norms.consumables_consumption_rules.brush_per_100' },
      brush_price_rub: { label: 'Цена щётки (₽/шт)', type: 'number', unit: '₽',
        hint: 'Цена одной щётки.',
        target: 'reference_norms.consumables_consumption_rules.brush_price_rub' },
      ppe_per_manday: { label: 'Норма СИЗ-расходки (компл на чел-день)', type: 'number', unit: 'компл',
        hint: 'Сколько комплектов СИЗ-расходки (перчатки, фильтры) на одного человека в день.',
        target: 'reference_norms.consumables_consumption_rules.ppe_per_manday' },
      ppe_price_rub: { label: 'Цена СИЗ-комплекта (₽)', type: 'number', unit: '₽',
        hint: 'Цена одного комплекта СИЗ-расходки.',
        target: 'reference_norms.consumables_consumption_rules.ppe_price_rub' }
    };
    const expected_inputs = missing.map((k) => ({ key: k, ...FIELD_MAP[k] }));
    clarifications.push({
      channel: 'PM', category: 'consumables', blocking: true,
      question_ru: `Нормы расходки/цены отсутствуют: ${missing.join(', ')}. Заполните прямо здесь.`,
      expected_inputs
    });
    return {
      summary: 'BLOCKED: нормы расходки не найдены ни в эталонах, ни в каталоге, ни через web search',
      key_findings: missing.map((k) => `BLOCKER: норма ${k} не найдена ни в одном источнике`),
      items: [], total_consumables: 0, base_volume: 0,
      _source_tiers: { missing }, assumptions: [], clarifications
    };
  }

  onThought(`Источники: насадка-норма ${nozzlePer100.source}, насадка-цена ${nozzlePrice.source}, СИЗ-цена ${ppePrice.source}`);
  onThought('Считаю расходные материалы по объёму работ…');

  const vol = totalVolume(resources);
  if (vol <= 0) {
    clarifications.push({ channel: 'PM', category: 'consumables', blocking: true,
      question_ru: 'Объём работ из resources = 0. Расчёт расходников невозможен — запустите resource_planner и убедитесь что в resources заполнены volume/qty.' });
    return {
      summary: 'BLOCKED: объём работ не определён',
      key_findings: ['BLOCKER: vol=0 в resources'],
      items: [], total_consumables: 0, base_volume: 0,
      _source_tiers: {}, assumptions: [], clarifications
    };
  }
  const manDays = Number(labor.total_man_days) || 0;

  const nozzleQty = Math.max(1, Math.ceil((vol / 100) * nozzlePer100.value));
  const brushQty = Math.max(1, Math.ceil((vol / 100) * brushPer100.value));
  const ppeQty = Math.max(0, Math.ceil(manDays * ppePerManDay.value));

  const tagSrc = (s) => s === 'analogs' ? '✅' : s === 'settings' ? '⚙' : s === 'catalog' ? '📦' : '⚠';
  const items = [
    { name: 'Насадки/форсунки', qty: nozzleQty, unit: 'шт', unit_price: nozzlePrice.value, total: nozzleQty * nozzlePrice.value, _source: nozzlePrice.source, _matched: nozzlePrice.matched_name },
    { name: 'Щётки/насадки механические', qty: brushQty, unit: 'шт', unit_price: brushPrice.value, total: brushQty * brushPrice.value, _source: brushPrice.source, _matched: brushPrice.matched_name }
  ];
  if (ppeQty > 0) {
    items.push({ name: 'СИЗ-расходка (перчатки, фильтры)', qty: ppeQty, unit: 'компл', unit_price: ppePrice.value, total: ppeQty * ppePrice.value, _source: ppePrice.source, _matched: ppePrice.matched_name });
  }

  const total = items.reduce((s, it) => s + it.total, 0);
  const tiers = { nozzle: nozzlePer100.source, brush: brushPer100.source, ppe: ppePerManDay.source, prices: { nozzle: nozzlePrice.source, brush: brushPrice.source, ppe: ppePrice.source } };

  return {
    summary: `Расходники: ${formatRub(total)} (база объём ${vol}, ${manDays} чел-дн)`,
    key_findings: items.map((it) => `${tagSrc(it._source)} ${it.name}: ${it.qty} ${it.unit} × ${formatRub(it.unit_price)} = ${formatRub(it.total)}${it._matched ? ' (каталог: ' + it._matched + ')' : ''}`),
    items, total_consumables: total, base_volume: vol,
    _source_tiers: tiers,
    assumptions: [`Источники расходки: ${JSON.stringify(tiers)}`],
    clarifications
  };
}

module.exports = { run, totalVolume };
