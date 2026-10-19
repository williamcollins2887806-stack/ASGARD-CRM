'use strict';

/**
 * Обогащение каталога из строк счёта:
 * найти/создать supplier + product + INSERT price_records.
 */

// Очистка наименований (заказчик 19.10.2026): размеры/ГОСТ/фасовка уходят в
// артикул, в item_name остаётся читаемое имя. Работает для ВСЕХ путей записи
// в номенклатуру (почта, ручная загрузка, импорт) — не только для ИИ-парсера.
const { splitItemName, tidyOrgName } = require('../lib/item-name-clean');

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/** Дата из Postgres (Date) или строки → 'YYYY-MM-DD' | null. */
function toIsoDate(v) {
  if (!v) return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    // Локальные компоненты, а не UTC: date-колонка приходит как полночь локального пояса.
    const p = (x) => String(x).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  return null;
}

async function ensureSupplier(db, { supplierId, supplierName }) {
  if (supplierId) {
    const { rows } = await db.query('SELECT id, name FROM suppliers WHERE id=$1', [supplierId]);
    if (rows[0]) return rows[0];
  }
  // Кавычки в названии из OCR приводим в порядок («ООО "ТД "БАШПРОМТОРГ» → закрытая пара).
  const name = tidyOrgName(String(supplierName || '').trim());
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
 * @param {number} [opts.docRegistryId]    - источник: документ реестра
 * @param {string} [opts.invoiceDate]      - дата счёта (день закупки)
 * @param {string} [opts.invoiceNumber]    - номер счёта
 */
async function enrichCatalogFromLines(db, opts = {}) {
  const lines = Array.isArray(opts.lines) ? opts.lines : [];
  const allowed = new Set(['procurement', 'manual', 'ai_search', 'quote', 'market_monitoring']);
  const source = allowed.has(opts.source) ? opts.source : 'procurement';
  const supplier = await ensureSupplier(db, {
    supplierId: opts.supplierId,
    supplierName: opts.supplierName
  });
  // Дата счёта → день закупки (для временных рядов цен). Пусто → NULL (не выдумываем).
  // ВАЖНО: из Postgres дата приходит как Date-объект — String() даёт «Tue Jul 14 2026»,
  // и проверка на YYYY-MM-DD не срабатывает. Нормализуем оба вида.
  const invDate = toIsoDate(opts.invoiceDate);
  const invNo = opts.invoiceNumber ? String(opts.invoiceNumber).slice(0, 64) : null;
  let created = 0;
  let priced = 0;
  for (const line of lines) {
    // Очистка наименования: «Мат из минваты ... - 2000.1200.60 ГОСТ ... (5,184 м3)»
    // → имя «Мат из минваты ...», остаток в артикул. Чистые названия не трогает.
    const split = splitItemName(line.name || line.invoice_name || line.item_name);
    const name = split.name;
    const articleLine = line.article || split.tail || null;
    const price = num(line.unit_price);
    if (!name || !(price > 0)) continue;
    const qty = num(line.quantity != null ? line.quantity : (line.qty != null ? line.qty : line.need_qty)) || null;
    const product = await findOrCreateProduct(db, {
      name,
      article: articleLine,
      unit: line.unit,
      userId: opts.userId
    });
    if (!product) continue;
    created++;
    const totalRow = qty ? Math.round(price * qty * 100) / 100 : null;
    // V410 (живой тест 18.10.2026): повторный intake того же счёта плодил ДУБЛИ
    // позиций (15 строк вместо 1 за 15 прогонов) — история цен искажалась.
    // Позиция опознаётся по (документ + наименование + артикул): при повторе
    // ОБНОВЛЯЕМ строку, а не вставляем новую.
    if (opts.docRegistryId) {
      const ex = await db.query(
        `SELECT id FROM price_records
          WHERE doc_registry_id=$1 AND lower(trim(item_name))=lower(trim($2))
            AND COALESCE(lower(article),'') = COALESCE(lower($3),'')
          LIMIT 1`,
        [opts.docRegistryId, name, articleLine]);
      if (ex.rows[0]) {
        await db.query(
          `UPDATE price_records SET unit_price=$2, quantity=$3, total=$4,
             invoice_date=$5::date, invoice_number=$6, supplier_id=$7, supplier_name=$8, recorded_at=NOW()
           WHERE id=$1`,
          [ex.rows[0].id, price, qty, totalRow, invDate, invNo,
            supplier?.id || null, supplier?.name || opts.supplierName || null]);
        priced++;
        continue;
      }
    }
    await db.query(
      `INSERT INTO price_records(
         product_id, product_category_id, item_name, article, unit,
         supplier_id, supplier_name, unit_price, quantity, total,
         invoice_date, invoice_number, doc_registry_id,
         source, procurement_item_id, recorded_by, recorded_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::date,$12,$13,$14,$15,$16,NOW())`,
      [
        product.id,
        product.category_id || null,
        name,
        articleLine,
        line.unit || 'шт',
        supplier?.id || null,
        supplier?.name || opts.supplierName || null,
        price,
        qty,
        totalRow,
        invDate,
        invNo,
        opts.docRegistryId || null,
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
           product_id, item_name, supplier_id, supplier_name, unit_price, total,
           invoice_date, invoice_number, doc_registry_id, source, recorded_by, recorded_at
         ) VALUES($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$11,NOW())`,
        [
          product.id,
          label,
          supplier?.id || null,
          supplier?.name || opts.supplierName || null,
          num(opts.headerAmount),
          num(opts.headerAmount),
          invDate,
          invNo,
          opts.docRegistryId || null,
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
