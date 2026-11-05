'use strict';
/**
 * Единый поиск маркетплейса склада: товары + единицы оборудования.
 */

const { queryVariants, enrichOffer } = require('./price-search');

async function searchMarket(db, opts = {}) {
  const q = String(opts.q || '').trim();
  const availability = ['all', 'in_stock', 'order'].includes(opts.availability)
    ? opts.availability : 'all';
  const kind = ['all', 'product', 'equipment'].includes(opts.kind) ? opts.kind : 'all';
  const group = opts.search_group ? String(opts.search_group) : null;
  const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 60, 5), 120);
  const warehouseId = opts.warehouse_id ? parseInt(opts.warehouse_id, 10) : null;

  const variants = q.length >= 2 ? queryVariants(q) : [];
  const likes = variants.map((v) => `%${v}%`);
  const items = [];

  const productRows = (kind === 'all' || kind === 'product')
    ? await fetchProducts(db, { q, likes, group, availability, warehouseId, limit })
    : [];
  for (const r of productRows) {
    const stockQty = Number(r.stock_qty) || 0;
    const inStock = stockQty > 0;
    if (availability === 'in_stock' && !inStock) continue;
    if (availability === 'order' && inStock) continue;
    const pack = r.pack_qty != null ? Number(r.pack_qty) : null;
    const base = r.base_unit || r.unit || 'шт';
    let unitHint = `за ${base}`;
    let priceNote = null;
    const price = r.best_price != null ? Number(r.best_price) : (r.unit_price_base != null ? Number(r.unit_price_base) : null);
    if (pack && pack > 1 && (String(r.unit || '').toLowerCase().includes('упак') || base === 'упак')) {
      unitHint = `за упак (${pack} шт)`;
      if (price != null) priceNote = `≈ ${(price / pack).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽ за 1 шт`;
    } else if (r.unit_price_base != null && pack && pack > 1) {
      priceNote = `≈ ${Number(r.unit_price_base).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽ за 1 шт`;
    } else if (base === 'кг') unitHint = 'за кг';
    else if (base === 'шт') unitHint = 'за 1 шт';

    items.push({
      kind: 'product',
      id: r.id,
      title: r.name,
      article: r.article,
      unit: r.unit || 'шт',
      category_name: r.category_name,
      search_group: r.search_group || 'other',
      photo_url: r.photo_url,
      photo_source: r.photo_source || null,
      market_card_key: r.market_card_key || null,
      description: r.description_ai || null,
      icon_slug: r.icon_slug,
      badge: inStock ? 'in_stock' : 'order',
      badge_label: inStock ? 'В наличии' : 'Под заказ',
      stock_qty: stockQty,
      best_price: price,
      unit_hint: unitHint,
      price_note: priceNote,
      pack_qty: pack,
      best_supplier: r.best_supplier || null,
      keywords: r.search_keywords || []
    });
  }

  if (kind === 'all' || kind === 'equipment') {
    // Витрина как у Ozon: одинаковые единицы → одна карточка + счётчик на складе
    if (availability !== 'order') {
      const eqRows = await fetchEquipmentGrouped(db, { q, likes, warehouseId, limit, availability });
      for (const e of eqRows) {
        const stockQty = Number(e.stock_qty) || 0;
        if (availability === 'in_stock' && stockQty <= 0) continue;
        const availableIds = Array.isArray(e.available_ids)
          ? e.available_ids.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0)
          : [];
        const repId = availableIds[0] || Number(e.id) || null;
        if (!repId) continue;
        items.push({
          kind: 'equipment',
          id: repId,
          title: e.name,
          article: null,
          unit: 'шт',
          category_name: e.category_name,
          search_group: 'equipment',
          photo_url: e.photo_url || null,
          photo_source: e.photo_source || null,
          market_card_key: e.market_card_key || null,
          description: e.description_ai || null,
          badge: stockQty > 0 ? 'in_stock' : 'order',
          badge_label: stockQty > 0 ? 'В наличии' : 'Нет на складе',
          stock_qty: stockQty,
          best_price: null,
          unit_hint: 'за 1 шт',
          price_note: stockQty > 0 ? `${stockQty} шт на складе` : null,
          serial: null,
          warehouse_name: e.warehouse_name || null,
          condition: e.condition || null,
          aggregated: true,
          available_ids: availableIds,
          brand: e.brand || null,
          model: e.model || null,
        });
      }
    }
  }

  // relevance: title includes q first
  const ql = q.toLowerCase();
  items.sort((a, b) => {
    const ra = ql && String(a.title).toLowerCase().includes(ql) ? 1 : 0;
    const rb = ql && String(b.title).toLowerCase().includes(ql) ? 1 : 0;
    if (rb !== ra) return rb - ra;
    if (a.kind !== b.kind) return a.kind === 'product' ? -1 : 1;
    const pa = a.best_price ?? 1e18;
    const pb = b.best_price ?? 1e18;
    return pa - pb;
  });

  return {
    q,
    availability,
    kind,
    search_group: group,
    total: items.length,
    items: items.slice(0, limit)
  };
}

function statusLabel(st) {
  const m = {
    on_warehouse: 'На складе',
    issued: 'Выдано',
    in_transit: 'В пути',
    repair: 'Ремонт',
    broken: 'Неисправно',
    written_off: 'Списано'
  };
  return m[st] || st;
}

async function fetchProducts(db, { q, likes, group, availability, warehouseId, limit }) {
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const wh = p(warehouseId || null);
  // E2E/smoke/демо-маркеры не должны светиться на витрине.
  // Жильё / питание / услуги — номенклатура есть, витрина маркетплейса — нет.
  let where = `p.deleted_at IS NULL AND COALESCE(p.is_active, true) = true
    AND p.name !~* '(^|[[:space:]])(E2E|FALLBACK|FULL-BIZ|Gallery\\+|STORY)([[:space:]_-]|$)'
    AND COALESCE(c.search_group,'other') NOT IN ('housing','food','services')`;
  if (group) {
    // явный чип housing/food/services — пусто (их нет на витрине)
    if (['housing', 'food', 'services'].includes(group)) {
      where += ` AND FALSE`;
    } else {
      where += ` AND COALESCE(c.search_group,'other') = ${p(group)}`;
    }
  }
  if (q && q.length >= 2) {
    const qP = p(q);
    const likesP = p(likes.length ? likes : [`%${q}%`]);
    // keywords — голые стемы (без %), не путать с ILIKE-паттернами
    const stems = (likes.length ? likes : [q]).map((x) => String(x).replace(/%/g, '').toLowerCase()).filter((x) => x.length >= 2);
    const stemsP = p(stems.length ? stems : [q.toLowerCase()]);
    where += ` AND (
      p.name ILIKE ANY(${likesP}::text[])
      OR COALESCE(p.article,'') ILIKE ANY(${likesP}::text[])
      OR EXISTS (
        SELECT 1 FROM unnest(COALESCE(p.search_keywords, '{}'::text[])) kw
        WHERE lower(kw) = ANY(${stemsP}::text[])
           OR lower(kw) ILIKE ANY(${likesP}::text[])
      )
      OR similarity(lower(p.name), lower(${qP})) >= 0.22
    )`;
  }
  // soft filter stock in SQL when possible
  if (availability === 'in_stock') {
    where += ` AND COALESCE(st.qty,0) > 0`;
  } else if (availability === 'order') {
    where += ` AND COALESCE(st.qty,0) <= 0`;
  }

  const sql = `
    SELECT
      p.id, p.name, p.article, p.unit, p.photo_url, p.photo_source, p.market_card_key, p.icon_slug,
      NULLIF(btrim(p.attrs->>'description_ai'),'') AS description_ai,
      p.pack_qty, p.base_unit, p.unit_price_base, p.search_keywords,
      c.name AS category_name, COALESCE(c.search_group,'other') AS search_group,
      COALESCE(st.qty, 0)::float AS stock_qty,
      lp.unit_price AS best_price,
      lp.supplier_name AS best_supplier,
      lp.recorded_at AS price_as_of
    FROM products p
    LEFT JOIN product_categories c ON c.id = p.category_id
    LEFT JOIN LATERAL (
      SELECT SUM(s.quantity - COALESCE(s.reserved_qty,0)) AS qty
      FROM stock s
      WHERE s.product_id = p.id
        AND (${wh}::int IS NULL OR s.warehouse_id = ${wh}::int)
    ) st ON true
    LEFT JOIN LATERAL (
      SELECT pr.unit_price, COALESCE(s.name, pr.supplier_name) AS supplier_name, pr.recorded_at
      FROM price_records pr
      LEFT JOIN suppliers s ON s.id = pr.supplier_id
      WHERE pr.product_id = p.id AND pr.unit_price > 0
      ORDER BY pr.recorded_at DESC NULLS LAST
      LIMIT 1
    ) lp ON true
    WHERE ${where}
    ORDER BY COALESCE(st.qty,0) DESC, p.name
    LIMIT ${p(limit * 2)}
  `;
  try {
    const { rows } = await db.query(sql, params);
    return rows;
  } catch (e) {
    // V449 columns missing — fallback without them
    if (/pack_qty|search_keywords|base_unit|unit_price_base|photo_source|market_card_key/i.test(String(e.message || e))) {
      const { rows } = await db.query(
        `
        SELECT p.id, p.name, p.article, p.unit, p.photo_url,
          NULL::text AS photo_source, NULL::text AS market_card_key, p.icon_slug,
          NULL::numeric AS pack_qty, NULL::text AS base_unit, NULL::numeric AS unit_price_base,
          '{}'::text[] AS search_keywords,
          c.name AS category_name, COALESCE(c.search_group,'other') AS search_group,
          COALESCE((
            SELECT SUM(s.quantity - COALESCE(s.reserved_qty,0)) FROM stock s
            WHERE s.product_id = p.id AND ($1::int IS NULL OR s.warehouse_id = $1::int)
          ),0)::float AS stock_qty,
          (SELECT pr.unit_price FROM price_records pr WHERE pr.product_id=p.id AND pr.unit_price>0
            ORDER BY pr.recorded_at DESC NULLS LAST LIMIT 1) AS best_price,
          (SELECT COALESCE(s.name, pr.supplier_name) FROM price_records pr
            LEFT JOIN suppliers s ON s.id=pr.supplier_id
            WHERE pr.product_id=p.id AND pr.unit_price>0
            ORDER BY pr.recorded_at DESC NULLS LAST LIMIT 1) AS best_supplier
        FROM products p
        LEFT JOIN product_categories c ON c.id = p.category_id
        WHERE p.deleted_at IS NULL
          AND p.name !~* '(^|[[:space:]])(E2E|FALLBACK|FULL-BIZ|Gallery\\+|STORY)([[:space:]_-]|$)'
          AND COALESCE(c.search_group,'other') NOT IN ('housing','food','services')
          AND ($2::text IS NULL OR p.name ILIKE '%'||$2||'%' OR COALESCE(p.article,'') ILIKE '%'||$2||'%')
          AND ($3::text IS NULL OR (
                $3 NOT IN ('housing','food','services')
                AND COALESCE(c.search_group,'other') = $3
              ))
        ORDER BY p.name LIMIT $4
        `,
        [warehouseId || null, q || null, group, limit * 2]
      );
      return rows;
    }
    throw e;
  }
}

/**
 * Схлопывание единиц: одно имя (+марка/модель) → одна карточка.
 * stock_qty = сколько on_warehouse; available_ids — для корзины поштучно.
 */
async function fetchEquipmentGrouped(db, { q, likes, warehouseId, limit, availability }) {
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  let where = `e.deleted_at IS NULL`;
  if (q && q.length >= 2) {
    const likesP = p(likes.length ? likes : [`%${q}%`]);
    where += ` AND (
      e.name ILIKE ANY(${likesP}::text[])
      OR COALESCE(e.inventory_number,'') ILIKE ANY(${likesP}::text[])
      OR COALESCE(e.serial_number,'') ILIKE ANY(${likesP}::text[])
      OR COALESCE(e.brand,'') ILIKE ANY(${likesP}::text[])
      OR COALESCE(e.model,'') ILIKE ANY(${likesP}::text[])
    )`;
  }
  if (warehouseId) {
    where += ` AND e.warehouse_id = ${p(warehouseId)}`;
  }
  // для «в наличии» оставляем группы, где есть хотя бы одна единица на складе
  const having = availability === 'in_stock'
    ? `HAVING COUNT(*) FILTER (WHERE e.status = 'on_warehouse') > 0`
    : '';

  const sql = `
    SELECT
      COALESCE(
        MIN(e.id) FILTER (WHERE e.status = 'on_warehouse'),
        MIN(e.id)
      ) AS id,
      MIN(e.name) AS name,
      NULLIF(MIN(e.brand), '') AS brand,
      NULLIF(MIN(e.model), '') AS model,
      MIN(e.market_card_key) AS market_card_key,
      MAX(e.photo_url) FILTER (WHERE e.photo_url IS NOT NULL AND btrim(e.photo_url) <> '') AS photo_url,
      MAX(e.photo_source) FILTER (WHERE e.photo_source IS NOT NULL) AS photo_source,
      MAX(NULLIF(btrim(e.attrs->>'description_ai'),'')) AS description_ai,
      MAX(c.name) AS category_name,
      MAX(w.name) FILTER (WHERE e.status = 'on_warehouse') AS warehouse_name,
      MAX(e.condition) FILTER (WHERE e.status = 'on_warehouse') AS condition,
      COUNT(*) FILTER (WHERE e.status = 'on_warehouse')::int AS stock_qty,
      COUNT(*)::int AS total_units,
      COALESCE(
        array_agg(e.id ORDER BY e.id) FILTER (WHERE e.status = 'on_warehouse'),
        ARRAY[]::int[]
      ) AS available_ids
    FROM equipment e
    LEFT JOIN equipment_categories c ON c.id = e.category_id
    LEFT JOIN warehouses w ON w.id = e.warehouse_id
    WHERE ${where}
    GROUP BY
      lower(trim(e.name)),
      lower(trim(COALESCE(e.brand, ''))),
      lower(trim(COALESCE(e.model, ''))),
      COALESCE(e.market_card_key, '')
    ${having}
    ORDER BY COUNT(*) FILTER (WHERE e.status = 'on_warehouse') DESC, MIN(e.name)
    LIMIT ${p(Math.min(limit, 80))}
  `;
  try {
    const { rows } = await db.query(sql, params);
    return rows;
  } catch (e) {
    // brand/model могут отсутствовать на старых схемах — fallback без них
    if (/brand|model|photo_source|market_card_key|attrs/i.test(String(e.message || e))) {
      try {
        const params2 = [];
        const p2 = (v) => { params2.push(v); return `$${params2.length}`; };
        let where2 = `e.deleted_at IS NULL`;
        if (q && q.length >= 2) {
          const likesP = p2(likes.length ? likes : [`%${q}%`]);
          where2 += ` AND (e.name ILIKE ANY(${likesP}::text[]) OR COALESCE(e.inventory_number,'') ILIKE ANY(${likesP}::text[]))`;
        }
        if (warehouseId) where2 += ` AND e.warehouse_id = ${p2(warehouseId)}`;
        const having2 = availability === 'in_stock'
          ? `HAVING COUNT(*) FILTER (WHERE e.status = 'on_warehouse') > 0`
          : '';
        const { rows } = await db.query(
          `
          SELECT
            COALESCE(MIN(e.id) FILTER (WHERE e.status='on_warehouse'), MIN(e.id)) AS id,
            MIN(e.name) AS name,
            NULL::text AS brand, NULL::text AS model,
            NULL::text AS market_card_key,
            MAX(e.photo_url) AS photo_url,
            NULL::text AS photo_source,
            NULL::text AS description_ai,
            MAX(c.name) AS category_name,
            MAX(w.name) FILTER (WHERE e.status='on_warehouse') AS warehouse_name,
            NULL::text AS condition,
            COUNT(*) FILTER (WHERE e.status='on_warehouse')::int AS stock_qty,
            COUNT(*)::int AS total_units,
            COALESCE(array_agg(e.id ORDER BY e.id) FILTER (WHERE e.status='on_warehouse'), ARRAY[]::int[]) AS available_ids
          FROM equipment e
          LEFT JOIN equipment_categories c ON c.id = e.category_id
          LEFT JOIN warehouses w ON w.id = e.warehouse_id
          WHERE ${where2}
          GROUP BY lower(trim(e.name))
          ${having2}
          ORDER BY COUNT(*) FILTER (WHERE e.status='on_warehouse') DESC, MIN(e.name)
          LIMIT ${p2(Math.min(limit, 80))}
          `,
          params2
        );
        return rows;
      } catch (_) {
        return [];
      }
    }
    console.warn('[warehouse-market] fetchEquipmentGrouped:', e.message);
    return [];
  }
}

module.exports = { searchMarket, enrichOffer, fetchEquipmentGrouped };
