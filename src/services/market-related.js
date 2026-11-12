'use strict';
/**
 * Related-карточки маркетплейса склада.
 * complementary — co-occurrence (корзины + выдачи на работу)
 * similar — контент (search_group / категория / trigram)
 */

function productKey(id) {
  return `product:${Number(id)}`;
}

function eqCardKey(name, brand, model) {
  const n = String(name || '').trim().toLowerCase();
  const b = String(brand || '').trim().toLowerCase();
  const m = String(model || '').trim().toLowerCase();
  return `eqcard:${n}|${b}|${m}`;
}

function resolveEntityKey(row) {
  if (row.market_card_key && String(row.market_card_key).trim()) {
    return String(row.market_card_key).trim();
  }
  if (row.product_id) return productKey(row.product_id);
  if (row.equipment_id || row.kind === 'equipment') {
    return eqCardKey(row.name || row.title, row.brand, row.model);
  }
  if (row.id && row.kind === 'product') return productKey(row.id);
  return null;
}

/**
 * Пересчёт пар. Возвращает { complementary, similar, wiped }.
 */
async function rebuildMarketRelated(db, opts = {}) {
  const minSupport = Math.max(2, parseInt(opts.minSupport, 10) || 3);
  const maxPerSeed = Math.min(20, parseInt(opts.maxPerSeed, 10) || 12);

  // --- complementary: пары из корзин ---
  const cartPairs = await db.query(`
    WITH lines AS (
      SELECT
        ci.cart_id,
        CASE
          WHEN ci.product_id IS NOT NULL THEN
            COALESCE(NULLIF(btrim(p.market_card_key),''), 'product:' || ci.product_id::text)
          WHEN ci.equipment_id IS NOT NULL THEN
            COALESCE(
              NULLIF(btrim(e.market_card_key),''),
              'eqcard:' || lower(trim(e.name)) || '|' || lower(trim(COALESCE(e.brand,''))) || '|' || lower(trim(COALESCE(e.model,'')))
            )
          ELSE NULL
        END AS item_key
      FROM warehouse_cart_items ci
      LEFT JOIN products p ON p.id = ci.product_id AND p.deleted_at IS NULL
      LEFT JOIN equipment e ON e.id = ci.equipment_id AND e.deleted_at IS NULL
      WHERE ci.item_type IN ('consumable','equipment')
    ),
    clean AS (
      SELECT cart_id, item_key FROM lines WHERE item_key IS NOT NULL
    ),
    pairs AS (
      SELECT a.item_key AS seed_key, b.item_key AS related_key, COUNT(*)::int AS cnt
      FROM clean a
      JOIN clean b ON a.cart_id = b.cart_id AND a.item_key < b.item_key
      GROUP BY 1, 2
      HAVING COUNT(*) >= $1
    ),
    freq AS (
      SELECT item_key, COUNT(DISTINCT cart_id)::float AS n FROM clean GROUP BY 1
    ),
    tot AS (
      SELECT COUNT(DISTINCT cart_id)::float AS n FROM clean
    )
    SELECT p.seed_key, p.related_key, p.cnt AS evidence_count,
      CASE WHEN f1.n > 0 AND f2.n > 0 AND t.n > 0
        THEN (p.cnt::float * t.n) / (f1.n * f2.n)
        ELSE p.cnt::float
      END AS score
    FROM pairs p
    JOIN freq f1 ON f1.item_key = p.seed_key
    JOIN freq f2 ON f2.item_key = p.related_key
    CROSS JOIN tot t
  `, [minSupport]);

  // --- complementary: оборудование на одной работе ---
  const workPairs = await db.query(`
    WITH issued AS (
      SELECT
        work_id,
        COALESCE(
          NULLIF(btrim(market_card_key),''),
          'eqcard:' || lower(trim(name)) || '|' || lower(trim(COALESCE(brand,''))) || '|' || lower(trim(COALESCE(model,'')))
        ) AS item_key
      FROM equipment
      WHERE deleted_at IS NULL AND status = 'issued' AND work_id IS NOT NULL
    ),
    clean AS (
      SELECT DISTINCT work_id, item_key FROM issued WHERE item_key IS NOT NULL
    ),
    pairs AS (
      SELECT a.item_key AS seed_key, b.item_key AS related_key, COUNT(*)::int AS cnt
      FROM clean a
      JOIN clean b ON a.work_id = b.work_id AND a.item_key < b.item_key
      GROUP BY 1, 2
      HAVING COUNT(*) >= $1
    )
    SELECT seed_key, related_key, cnt AS evidence_count, cnt::float AS score
    FROM pairs
  `, [Math.max(2, minSupport - 1)]);

  // merge complementary (symmetric)
  const compMap = new Map();
  function bumpComp(seed, related, score, evidence) {
    if (!seed || !related || seed === related) return;
    const k = `${seed}\t${related}`;
    const cur = compMap.get(k) || { seed_key: seed, related_key: related, score: 0, evidence_count: 0 };
    cur.score = Math.max(cur.score, Number(score) || 0);
    cur.evidence_count += Number(evidence) || 0;
    compMap.set(k, cur);
    // symmetric
    const k2 = `${related}\t${seed}`;
    const cur2 = compMap.get(k2) || { seed_key: related, related_key: seed, score: 0, evidence_count: 0 };
    cur2.score = Math.max(cur2.score, Number(score) || 0);
    cur2.evidence_count = Math.max(cur2.evidence_count, cur.evidence_count);
    compMap.set(k2, cur2);
  }
  for (const r of cartPairs.rows) bumpComp(r.seed_key, r.related_key, r.score, r.evidence_count);
  for (const r of workPairs.rows) bumpComp(r.seed_key, r.related_key, r.score, r.evidence_count);

  // top-N per seed for complementary
  const bySeed = new Map();
  for (const row of compMap.values()) {
    if (!bySeed.has(row.seed_key)) bySeed.set(row.seed_key, []);
    bySeed.get(row.seed_key).push(row);
  }
  const complementary = [];
  for (const [, list] of bySeed) {
    list.sort((a, b) => b.score - a.score || b.evidence_count - a.evidence_count);
    complementary.push(...list.slice(0, maxPerSeed));
  }

  // --- similar: products same search_group / category, trigram-ish ---
  const similar = [];
  const products = await db.query(`
    SELECT id, name, category_id, market_card_key,
      COALESCE(NULLIF(btrim(attrs->>'search_group'),''), 'cat:' || COALESCE(category_id,0)::text) AS sg
    FROM products
    WHERE deleted_at IS NULL
      AND TRIM(COALESCE(name,'')) <> ''
  `);

  const byGroup = new Map();
  for (const p of products.rows) {
    const g = String(p.sg || `cat:${p.category_id || 0}`);
    const key = p.market_card_key && String(p.market_card_key).trim()
      ? String(p.market_card_key).trim()
      : productKey(p.id);
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push({ key, name: p.name, id: p.id });
  }

  function tokenSet(s) {
    return new Set(String(s || '').toLowerCase().replace(/[^a-zа-я0-9ё]+/gi, ' ').split(/\s+/).filter((t) => t.length > 2));
  }
  function jaccard(a, b) {
    if (!a.size || !b.size) return 0;
    let inter = 0;
    for (const t of a) if (b.has(t)) inter++;
    return inter / (a.size + b.size - inter);
  }

  for (const [, list] of byGroup) {
    if (list.length < 2) continue;
    const toks = list.map((x) => tokenSet(x.name));
    for (let i = 0; i < list.length; i++) {
      const scored = [];
      for (let j = 0; j < list.length; j++) {
        if (i === j) continue;
        if (list[i].key === list[j].key) continue;
        const sc = jaccard(toks[i], toks[j]);
        if (sc < 0.15) continue;
        scored.push({
          seed_key: list[i].key,
          related_key: list[j].key,
          score: sc,
          evidence_count: 1,
        });
      }
      scored.sort((a, b) => b.score - a.score);
      similar.push(...scored.slice(0, maxPerSeed));
    }
  }

  // equipment similar by category
  const eq = await db.query(`
    SELECT
      COALESCE(NULLIF(btrim(market_card_key),''),
        'eqcard:' || lower(trim(name)) || '|' || lower(trim(COALESCE(brand,''))) || '|' || lower(trim(COALESCE(model,'')))
      ) AS key,
      name, category_id
    FROM equipment
    WHERE deleted_at IS NULL AND status != 'written_off'
  `);
  const eqByCat = new Map();
  for (const e of eq.rows) {
    const g = `eqcat:${e.category_id || 0}`;
    if (!eqByCat.has(g)) eqByCat.set(g, []);
    eqByCat.get(g).push(e);
  }
  for (const [, list] of eqByCat) {
    // unique by key
    const uniq = new Map();
    for (const e of list) if (!uniq.has(e.key)) uniq.set(e.key, e);
    const arr = [...uniq.values()];
    if (arr.length < 2) continue;
    const toks = arr.map((x) => tokenSet(x.name));
    for (let i = 0; i < arr.length; i++) {
      const scored = [];
      for (let j = 0; j < arr.length; j++) {
        if (i === j) continue;
        const sc = jaccard(toks[i], toks[j]);
        if (sc < 0.2) continue;
        scored.push({
          seed_key: arr[i].key,
          related_key: arr[j].key,
          score: sc,
          evidence_count: 1,
        });
      }
      scored.sort((a, b) => b.score - a.score);
      similar.push(...scored.slice(0, maxPerSeed));
    }
  }

  await db.query('BEGIN');
  try {
    await db.query('DELETE FROM market_related_pairs');
    const all = [
      ...complementary.map((r) => ({ ...r, relation: 'complementary' })),
      ...similar.map((r) => ({ ...r, relation: 'similar' })),
    ];
    for (const r of all) {
      await db.query(
        `INSERT INTO market_related_pairs (seed_key, related_key, relation, score, evidence_count, updated_at)
         VALUES ($1,$2,$3,$4,$5,NOW())
         ON CONFLICT (seed_key, related_key, relation) DO UPDATE SET
           score = GREATEST(market_related_pairs.score, EXCLUDED.score),
           evidence_count = GREATEST(market_related_pairs.evidence_count, EXCLUDED.evidence_count),
           updated_at = NOW()`,
        [r.seed_key, r.related_key, r.relation, r.score, r.evidence_count]
      );
    }
    await db.query('COMMIT');
    return { complementary: complementary.length, similar: similar.length, wiped: true, total: all.length };
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  }
}

/**
 * Резолв seed_key для product|equipment id.
 */
async function seedKeyFor(db, kind, id) {
  const nid = Number(id);
  if (!Number.isFinite(nid)) return null;
  if (kind === 'product') {
    const { rows } = await db.query(
      `SELECT id, name, market_card_key FROM products WHERE id=$1 AND deleted_at IS NULL`,
      [nid]
    );
    if (!rows[0]) return null;
    return rows[0].market_card_key && String(rows[0].market_card_key).trim()
      ? String(rows[0].market_card_key).trim()
      : productKey(rows[0].id);
  }
  if (kind === 'equipment') {
    const { rows } = await db.query(
      `SELECT id, name, brand, model, market_card_key FROM equipment WHERE id=$1 AND deleted_at IS NULL`,
      [nid]
    );
    if (!rows[0]) return null;
    return rows[0].market_card_key && String(rows[0].market_card_key).trim()
      ? String(rows[0].market_card_key).trim()
      : eqCardKey(rows[0].name, rows[0].brand, rows[0].model);
  }
  return null;
}

/**
 * Карточки related для UI (до limit).
 */
async function getRelatedCards(db, { kind, id, limit = 8 }) {
  const seed = await seedKeyFor(db, kind, id);
  if (!seed) return { seed_key: null, items: [] };
  const lim = Math.min(12, Math.max(1, parseInt(limit, 10) || 8));

  const { rows: pairs } = await db.query(
    `SELECT related_key, relation, score, evidence_count
     FROM market_related_pairs
     WHERE seed_key = $1
     ORDER BY
       CASE relation WHEN 'complementary' THEN 0 ELSE 1 END,
       score DESC, evidence_count DESC
     LIMIT 40`,
    [seed]
  );

  const items = [];
  const seen = new Set();

  async function hydrateKey(key, relation, score) {
    if (!key || seen.has(key) || key === seed) return;
    // product:ID
    if (key.startsWith('product:')) {
      const pid = Number(key.slice(8));
      const { rows } = await db.query(
        `SELECT p.id, p.name, p.unit, p.photo_url, p.photo_source, p.market_card_key,
           p.icon_slug, c.name AS category_name,
           NULLIF(btrim(COALESCE(p.attrs->>'description_ai','')),'') AS description_ai,
           COALESCE((SELECT SUM(s.quantity) FROM stock s WHERE s.product_id=p.id),0)::float AS stock_qty
         FROM products p
         LEFT JOIN product_categories c ON c.id = p.category_id
         WHERE p.id=$1 AND p.deleted_at IS NULL`,
        [pid]
      );
      if (!rows[0]) return;
      const r = rows[0];
      seen.add(key);
      items.push({
        kind: 'product',
        id: r.id,
        title: r.name,
        unit: r.unit || 'шт',
        photo_url: r.photo_url,
        photo_source: r.photo_source,
        market_card_key: r.market_card_key,
        description: r.description_ai,
        icon_slug: r.icon_slug,
        category_name: r.category_name,
        stock_qty: Number(r.stock_qty) || 0,
        badge: (Number(r.stock_qty) || 0) > 0 ? 'in_stock' : 'order',
        badge_label: (Number(r.stock_qty) || 0) > 0 ? 'В наличии' : 'Под заказ',
        relation,
        score,
      });
      return;
    }

    // market_card_key or eqcard:
    let eqSql;
    let params;
    if (key.startsWith('eqcard:')) {
      const rest = key.slice(7);
      const parts = rest.split('|');
      const n = parts[0] || '';
      const b = parts[1] || '';
      const m = parts[2] || '';
      eqSql = `
        SELECT e.id, e.name, e.brand, e.model, e.photo_url, e.photo_source, e.market_card_key,
          e.purchase_price, c.name AS category_name,
          NULLIF(btrim(COALESCE(e.attrs->>'description_ai','')),'') AS description_ai,
          COUNT(*) FILTER (WHERE e2.status='on_warehouse' AND e2.deleted_at IS NULL)::int AS stock_qty,
          ARRAY_AGG(e2.id) FILTER (WHERE e2.status='on_warehouse' AND e2.deleted_at IS NULL) AS available_ids
        FROM equipment e
        LEFT JOIN equipment_categories c ON c.id = e.category_id
        LEFT JOIN equipment e2 ON lower(trim(e2.name))=lower(trim(e.name))
          AND lower(trim(COALESCE(e2.brand,'')))=lower(trim(COALESCE(e.brand,'')))
          AND lower(trim(COALESCE(e2.model,'')))=lower(trim(COALESCE(e.model,'')))
          AND e2.deleted_at IS NULL
        WHERE e.deleted_at IS NULL
          AND lower(trim(e.name))=$1
          AND lower(trim(COALESCE(e.brand,'')))=$2
          AND lower(trim(COALESCE(e.model,'')))=$3
        GROUP BY e.id, c.name
        ORDER BY CASE WHEN e.status='on_warehouse' THEN 0 ELSE 1 END, e.id
        LIMIT 1`;
      params = [n, b, m];
    } else {
      // archetype key → product first, else equipment
      const pr = await db.query(
        `SELECT p.id, p.name, p.unit, p.photo_url, p.photo_source, p.market_card_key,
           p.icon_slug, c.name AS category_name,
           NULLIF(btrim(COALESCE(p.attrs->>'description_ai','')),'') AS description_ai,
           COALESCE((SELECT SUM(s.quantity) FROM stock s WHERE s.product_id=p.id),0)::float AS stock_qty
         FROM products p
         LEFT JOIN product_categories c ON c.id = p.category_id
         WHERE p.deleted_at IS NULL AND p.market_card_key=$1
         ORDER BY p.id LIMIT 1`,
        [key]
      );
      if (pr.rows[0]) {
        const r = pr.rows[0];
        seen.add(key);
        items.push({
          kind: 'product',
          id: r.id,
          title: r.name,
          unit: r.unit || 'шт',
          photo_url: r.photo_url,
          photo_source: r.photo_source,
          market_card_key: r.market_card_key,
          description: r.description_ai,
          icon_slug: r.icon_slug,
          category_name: r.category_name,
          stock_qty: Number(r.stock_qty) || 0,
          badge: (Number(r.stock_qty) || 0) > 0 ? 'in_stock' : 'order',
          badge_label: (Number(r.stock_qty) || 0) > 0 ? 'В наличии' : 'Под заказ',
          relation,
          score,
        });
        return;
      }
      eqSql = `
        SELECT e.id, e.name, e.brand, e.model, e.photo_url, e.photo_source, e.market_card_key,
          e.purchase_price, c.name AS category_name,
          NULLIF(btrim(COALESCE(e.attrs->>'description_ai','')),'') AS description_ai,
          (SELECT COUNT(*)::int FROM equipment e2
            WHERE e2.deleted_at IS NULL AND e2.status='on_warehouse'
              AND e2.market_card_key=$1) AS stock_qty,
          (SELECT ARRAY_AGG(e2.id) FROM equipment e2
            WHERE e2.deleted_at IS NULL AND e2.status='on_warehouse'
              AND e2.market_card_key=$1) AS available_ids
        FROM equipment e
        LEFT JOIN equipment_categories c ON c.id = e.category_id
        WHERE e.deleted_at IS NULL AND e.market_card_key=$1
        ORDER BY CASE WHEN e.status='on_warehouse' THEN 0 ELSE 1 END, e.id
        LIMIT 1`;
      params = [key];
    }

    const { rows } = await db.query(eqSql, params);
    if (!rows[0]) return;
    const r = rows[0];
    const availableIds = Array.isArray(r.available_ids)
      ? r.available_ids.map(Number).filter((n) => Number.isFinite(n) && n > 0)
      : [];
    seen.add(key);
    items.push({
      kind: 'equipment',
      id: r.id,
      title: r.name,
      unit: 'шт',
      photo_url: r.photo_url,
      photo_source: r.photo_source,
      market_card_key: r.market_card_key,
      description: r.description_ai,
      category_name: r.category_name,
      brand: r.brand,
      model: r.model,
      stock_qty: Number(r.stock_qty) || 0,
      available_ids: availableIds,
      badge: (Number(r.stock_qty) || 0) > 0 ? 'in_stock' : 'order',
      badge_label: (Number(r.stock_qty) || 0) > 0 ? 'В наличии' : 'Нет на складе',
      relation,
      score,
    });
  }

  // complementary first
  for (const p of pairs.filter((x) => x.relation === 'complementary')) {
    if (items.length >= lim) break;
    await hydrateKey(p.related_key, p.relation, p.score);
  }
  // fill with similar if < 4 complements shown → still fill up to lim
  if (items.length < lim) {
    for (const p of pairs.filter((x) => x.relation === 'similar')) {
      if (items.length >= lim) break;
      await hydrateKey(p.related_key, p.relation, p.score);
    }
  }

  // cold start: same category / search_group if still empty
  if (items.length < 4 && kind === 'product') {
    const { rows: seedProd } = await db.query(
      `SELECT id, category_id, COALESCE(NULLIF(btrim(attrs->>'search_group'),''),'') AS sg, name
       FROM products WHERE id=$1`,
      [Number(id)]
    );
    if (seedProd[0]) {
      const { rows: neighbors } = await db.query(
        `SELECT p.id, p.name, p.unit, p.photo_url, p.photo_source, p.market_card_key,
           p.icon_slug, c.name AS category_name,
           NULLIF(btrim(COALESCE(p.attrs->>'description_ai','')),'') AS description_ai,
           COALESCE((SELECT SUM(s.quantity) FROM stock s WHERE s.product_id=p.id),0)::float AS stock_qty
         FROM products p
         LEFT JOIN product_categories c ON c.id = p.category_id
         WHERE p.deleted_at IS NULL AND p.id <> $1
           AND (
             ($2::int IS NOT NULL AND p.category_id = $2)
             OR ($3::text <> '' AND COALESCE(NULLIF(btrim(p.attrs->>'search_group'),''),'') = $3)
           )
         ORDER BY p.name
         LIMIT $4`,
        [Number(id), seedProd[0].category_id || null, String(seedProd[0].sg || ''), lim]
      );
      for (const r of neighbors) {
        if (items.length >= lim) break;
        const k = r.market_card_key || productKey(r.id);
        if (seen.has(k)) continue;
        seen.add(k);
        items.push({
          kind: 'product',
          id: r.id,
          title: r.name,
          unit: r.unit || 'шт',
          photo_url: r.photo_url,
          photo_source: r.photo_source,
          market_card_key: r.market_card_key,
          description: r.description_ai,
          icon_slug: r.icon_slug,
          category_name: r.category_name,
          stock_qty: Number(r.stock_qty) || 0,
          badge: (Number(r.stock_qty) || 0) > 0 ? 'in_stock' : 'order',
          badge_label: (Number(r.stock_qty) || 0) > 0 ? 'В наличии' : 'Под заказ',
          relation: 'similar',
          score: 0.1,
        });
      }
    }
  }

  return { seed_key: seed, items };
}

module.exports = {
  rebuildMarketRelated,
  getRelatedCards,
  seedKeyFor,
  productKey,
  eqCardKey,
  resolveEntityKey,
};
