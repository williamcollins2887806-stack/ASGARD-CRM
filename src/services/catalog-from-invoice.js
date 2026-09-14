'use strict';

/**
 * Обогащение каталога из строк счёта:
 * найти/создать supplier + product + INSERT price_records.
 */

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

async function ensureSupplier(db, { supplierId, supplierName }) {
  if (supplierId) {
    const { rows } = await db.query('SELECT id, name FROM suppliers WHERE id=$1', [supplierId]);
    if (rows[0]) return rows[0];
  }
  const name = String(supplierName || '').trim();
  if (!name) return null;
  const found = await db.query(
    `SELECT id, name FROM suppliers WHERE lower(name)=lower($1) LIMIT 1`,
    [name]
  );
  if (found.rows[0]) return found.rows[0];
  const ins = await db.query(
    `INSERT INTO suppliers(name, created_at) VALUES($1, NOW()) RETURNING id, name`,
    [name]
  );
  return ins.rows[0];
}

async function findOrCreateProduct(db, { name, article, unit, userId }) {
  const nm = String(name || '').trim();
  if (!nm) return null;
  const art = article ? String(article).trim() : null;
  if (art) {
    const byArt = await db.query(
      `SELECT id, name, category_id FROM products WHERE lower(article)=lower($1) LIMIT 1`,
      [art]
    );
    if (byArt.rows[0]) return byArt.rows[0];
  }
  // Exact name first — иначе trgm склеивает серии E2E/тестовых позиций в один product
  const byExact = await db.query(
    `SELECT id, name, category_id FROM products
     WHERE deleted_at IS NULL AND lower(name)=lower($1)
     LIMIT 1`,
    [nm]
  );
  if (byExact.rows[0]) return byExact.rows[0];
  // Уникальный артикул без совпадения → всегда новая позиция (не схлопывать trgm)
  if (!art) {
    const byName = await db.query(
      `SELECT id, name, category_id, similarity(lower(name), lower($1)) AS s
       FROM products
       WHERE deleted_at IS NULL AND similarity(lower(name), lower($1)) >= 0.45
       ORDER BY s DESC LIMIT 1`,
      [nm]
    );
    if (byName.rows[0]) return byName.rows[0];
  }
  const ins = await db.query(
    `INSERT INTO products(name, article, unit, created_from, created_by, created_at, updated_at)
     VALUES($1,$2,COALESCE($3,'шт'),'procurement',$4,NOW(),NOW())
     RETURNING id, name, category_id`,
    [nm, art, unit || 'шт', userId || null]
  );
  return ins.rows[0];
}

/**
 * @param {object} db - pool or client with .query
 * @param {object} opts
 * @param {Array} opts.lines - [{name, article, unit, unit_price, quantity}]
 * @param {string} [opts.supplierName]
 * @param {number} [opts.supplierId]
 * @param {number} [opts.userId]
 * @param {string} [opts.source] - quote|procurement|manual (CHECK constraint)
 * @param {number} [opts.procurementItemId]
 */
async function enrichCatalogFromLines(db, opts = {}) {
  const lines = Array.isArray(opts.lines) ? opts.lines : [];
  const allowed = new Set(['procurement', 'manual', 'ai_search', 'quote', 'market_monitoring']);
  const source = allowed.has(opts.source) ? opts.source : 'procurement';
  const supplier = await ensureSupplier(db, {
    supplierId: opts.supplierId,
    supplierName: opts.supplierName
  });
  let created = 0;
  let priced = 0;
  for (const line of lines) {
    const name = line.name || line.invoice_name || line.item_name;
    const price = num(line.unit_price);
    if (!name || !(price > 0)) continue;
    const product = await findOrCreateProduct(db, {
      name,
      article: line.article,
      unit: line.unit,
      userId: opts.userId
    });
    if (!product) continue;
    created++;
    await db.query(
      `INSERT INTO price_records(
         product_id, product_category_id, item_name, article, unit,
         supplier_id, supplier_name, unit_price, source, procurement_item_id, recorded_by, recorded_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())`,
      [
        product.id,
        product.category_id || null,
        name,
        line.article || null,
        line.unit || 'шт',
        supplier?.id || null,
        supplier?.name || opts.supplierName || null,
        price,
        source,
        opts.procurementItemId || line.item_id || null,
        opts.userId || null
      ]
    );
    priced++;
  }
  // header-only fallback: one price row by supplier + amount label
  if (!lines.length && opts.headerAmount > 0 && (opts.supplierName || opts.supplierId)) {
    const label = opts.headerLabel || opts.supplierName || 'Счёт на оплату';
    const product = await findOrCreateProduct(db, {
      name: label,
      userId: opts.userId
    });
    if (product) {
      await db.query(
        `INSERT INTO price_records(
           product_id, item_name, supplier_id, supplier_name, unit_price, source, recorded_by, recorded_at
         ) VALUES($1,$2,$3,$4,$5,$6,$7,NOW())`,
        [
          product.id,
          label,
          supplier?.id || null,
          supplier?.name || opts.supplierName || null,
          num(opts.headerAmount),
          source,
          opts.userId || null
        ]
      );
      priced++;
    }
  }
  return { supplier, products_touched: created, price_records: priced };
}

module.exports = {
  enrichCatalogFromLines,
  ensureSupplier,
  findOrCreateProduct
};
