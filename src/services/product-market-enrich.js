'use strict';
/**
 * Нормализация карточки товара для маркетплейса:
 * pack_qty, base_unit, unit_price_base, search_keywords (10–20).
 */

const { queryVariants } = require('./price-search');

const BASE_UNITS = new Set(['шт', 'кг', 'м', 'л', 'пар', 'компл', 'упак', 'м2', 'м²']);

function parsePackQty(name) {
  const s = String(name || '');
  let m = s.match(/\((\d{2,5})\)/);
  if (m) return parseInt(m[1], 10);
  m = s.match(/(?:уп\.?|упак\.?|упаковка)\s*[^\d]{0,8}(\d{2,5})/i);
  if (m) return parseInt(m[1], 10);
  m = s.match(/(\d{2,5})\s*шт\b/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 10) return n;
  }
  return null;
}

function normalizeBaseUnit(unit, name) {
  const u = String(unit || 'шт').trim().toLowerCase();
  if (/кг|килограм/.test(u)) return 'кг';
  if (/^г$|грам/.test(u)) return 'г';
  if (/упак|^уп\.?$/.test(u)) return 'упак';
  if (/компл|набор/.test(u)) return 'компл';
  if (/пар/.test(u)) return 'пар';
  if (/м2|м²|кв/.test(u)) return 'м²';
  if (/^м$|метр/.test(u)) return 'м';
  if (/л$|литр/.test(u)) return 'л';
  const n = String(name || '').toLowerCase();
  if (/\bкг\b/.test(n) && !parsePackQty(name)) return 'кг';
  return BASE_UNITS.has(u) ? u : 'шт';
}

function extractDims(name) {
  const s = String(name || '');
  const out = [];
  const m = s.match(/(\d+[.,]?\d*)\s*[xх×]\s*(\d+[.,]?\d*)(?:\s*[xх×]\s*(\d+[.,]?\d*))?/i);
  if (m) out.push(m[0].replace(/,/g, '.').toLowerCase());
  return out;
}

function buildKeywords({ name, article, unit, categoryName, searchGroup, packQty }) {
  const raw = String(name || '').trim();
  const set = new Set();
  const add = (x) => {
    const t = String(x || '').trim().toLowerCase();
    if (t.length >= 2 && t.length <= 48) set.add(t);
  };
  add(raw);
  for (const v of queryVariants(raw)) add(v);
  raw.split(/[\s,;/|]+/).forEach((w) => {
    if (w.length >= 3) add(w.replace(/[()«»"]/g, ''));
  });
  if (article) add(article);
  if (categoryName) add(categoryName);
  if (searchGroup) add(searchGroup);
  if (unit) add(unit);
  if (packQty) add(`${packQty} шт`);
  extractDims(raw).forEach(add);
  // синонимные хвосты из price-search уже в queryVariants для типовых запросов
  return [...set].slice(0, 20);
}

function computeUnitPriceBase(unitPrice, packQty, baseUnit) {
  const p = parseFloat(unitPrice);
  if (!Number.isFinite(p) || p <= 0) return null;
  if (baseUnit === 'упак' && packQty && packQty > 1) {
    return Math.round((p / packQty) * 10000) / 10000;
  }
  if (packQty && packQty >= 10 && (baseUnit === 'шт' || !baseUnit)) {
    // цена за упаковку, в названии есть (N)
    return Math.round((p / packQty) * 10000) / 10000;
  }
  return Math.round(p * 10000) / 10000;
}

/**
 * Обновить products после создания/матча из строки счёта.
 */
async function enrichProductMarketCard(db, productId, line = {}) {
  if (!productId) return null;
  const name = line.name || line.item_name || '';
  const unit = line.unit || 'шт';
  const price = parseFloat(line.unit_price);
  const packQty = parsePackQty(name) || (line.pack_qty != null ? parseFloat(line.pack_qty) : null);
  const baseUnit = normalizeBaseUnit(unit, name);
  const unitPriceBase = Number.isFinite(price) && price > 0
    ? computeUnitPriceBase(price, packQty, baseUnit === 'упак' ? 'упак' : baseUnit)
    : null;

  let categoryName = null;
  let searchGroup = null;
  try {
    const { rows } = await db.query(
      `SELECT c.name, c.search_group FROM products p
       LEFT JOIN product_categories c ON c.id = p.category_id WHERE p.id=$1`,
      [productId]
    );
    categoryName = rows[0]?.name || null;
    searchGroup = rows[0]?.search_group || null;
  } catch (_) {}

  const keywords = buildKeywords({
    name, article: line.article, unit, categoryName, searchGroup, packQty
  });

  const attrs = {
    dims: extractDims(name),
    source_unit: unit || null,
    enriched_at: new Date().toISOString()
  };

  try {
    await db.query(
      `UPDATE products SET
         pack_qty = COALESCE($2, pack_qty),
         base_unit = COALESCE($3, base_unit),
         unit_price_base = COALESCE($4, unit_price_base),
         search_keywords = CASE
           WHEN $5::text[] IS NULL OR cardinality($5::text[]) = 0 THEN search_keywords
           ELSE (SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(search_keywords,'{}') || $5::text[])))
         END,
         attrs = COALESCE(attrs, '{}'::jsonb) || $6::jsonb,
         updated_at = NOW()
       WHERE id = $1`,
      [
        productId,
        packQty,
        baseUnit,
        unitPriceBase,
        keywords,
        JSON.stringify(attrs)
      ]
    );
  } catch (e) {
    // колонки V449 могут ещё не быть накатины — тихо пропускаем
    if (!/pack_qty|search_keywords|base_unit|unit_price_base|attrs/i.test(String(e.message || e))) {
      throw e;
    }
  }

  return { packQty, baseUnit, unitPriceBase, keywords };
}

module.exports = {
  enrichProductMarketCard,
  parsePackQty,
  normalizeBaseUnit,
  buildKeywords,
  computeUnitPriceBase
};
