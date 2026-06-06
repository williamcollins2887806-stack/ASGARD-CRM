'use strict';
/**
 * АСГАРД CRM — Справочники закупок 2.0
 * ═══════════════════════════════════════════════════════════════════════════
 * Регистрируется в index.js под НЕСКОЛЬКИМИ префиксами (см. ниже), но физически
 * один файл. Префиксы: /api/suppliers, /api/product-categories, /api/products,
 * /api/price-records.
 *
 * - Поставщики + контакты (PROC/ADMIN пишут, все читают)
 * - Категории товаров (ADMIN управляет, все читают)
 * - Каталог номенклатуры + автокомплит (PROC/ADMIN пишут)
 * - База цен: список, ручная запись, ПОДСКАЗКА (hint) для UI
 * ═══════════════════════════════════════════════════════════════════════════
 */

const PROC_ROLES = ['PROC', 'ADMIN'];
const READ_ROLES = ['PROC', 'ADMIN', 'PM', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'BUH', 'WAREHOUSE'];
const SUPPLIER_CATEGORIES = ['materials', 'equipment_rental', 'services', 'other'];
const PRICE_SOURCES = ['procurement', 'manual', 'ai_search', 'quote', 'market_monitoring'];

async function routes(fastify) {
  const db = fastify.db;

  function bad(reply, msg, code = 400) { return reply.code(code).send({ error: msg }); }
  function valNum(v, name) {
    if (v === undefined || v === null || v === '') return null;
    const n = parseFloat(v); if (isNaN(n)) return `${name} должен быть числом`;
    if (n < 0) return `${name} не может быть отрицательным`; return null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ПОСТАВЩИКИ  /api/suppliers
  // ═══════════════════════════════════════════════════════════════════════

  fastify.get('/suppliers', { preHandler: [fastify.requireRoles(READ_ROLES)] }, async (req) => {
    const { category, is_active, search, rating_gte, limit = 100, offset = 0 } = req.query;
    let sql = `SELECT s.*, u.name as created_by_name,
      (SELECT COUNT(*) FROM supplier_contacts sc WHERE sc.supplier_id=s.id) as contacts_count
      FROM suppliers s LEFT JOIN users u ON s.created_by=u.id WHERE s.deleted_at IS NULL`;
    const p = []; let i = 1;
    if (category) { sql += ` AND s.category=$${i++}`; p.push(category); }
    if (is_active !== undefined) { sql += ` AND s.is_active=$${i++}`; p.push(is_active === 'true' || is_active === true); }
    if (rating_gte) { sql += ` AND s.rating>=$${i++}`; p.push(parseInt(rating_gte)); }
    if (search) { sql += ` AND (s.name ILIKE $${i} OR s.inn ILIKE $${i})`; p.push(`%${search}%`); i++; }
    sql += ` ORDER BY s.name LIMIT $${i++} OFFSET $${i++}`;
    p.push(Math.min(parseInt(limit), 500), parseInt(offset));
    const { rows } = await db.query(sql, p);
    return { items: rows };
  });

  fastify.get('/suppliers/:id', { preHandler: [fastify.requireRoles(READ_ROLES)] }, async (req, reply) => {
    const id = parseInt(req.params.id); if (isNaN(id)) return bad(reply, 'Неверный ID');
    const { rows } = await db.query('SELECT * FROM suppliers WHERE id=$1 AND deleted_at IS NULL', [id]);
    if (!rows[0]) return bad(reply, 'Не найден', 404);
    const contacts = await db.query('SELECT * FROM supplier_contacts WHERE supplier_id=$1 ORDER BY is_primary DESC, full_name', [id]);
    return { item: rows[0], contacts: contacts.rows };
  });

  fastify.post('/suppliers', { preHandler: [fastify.requireRoles(PROC_ROLES)] }, async (req, reply) => {
    const { name, inn, kpp, ogrn, phone, email, website, address, category, rating, notes } = req.body;
    if (!name || !name.trim()) return bad(reply, 'Название обязательно');
    const cat = category || 'materials';
    if (!SUPPLIER_CATEGORIES.includes(cat)) return bad(reply, 'Неверная категория поставщика');
    const { rows } = await db.query(
      `INSERT INTO suppliers(name,inn,kpp,ogrn,phone,email,website,address,category,rating,notes,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [name.trim(), inn || null, kpp || null, ogrn || null, phone || null, email || null,
       website || null, address || null, cat, rating || null, notes || null, req.user.id]);
    return { item: rows[0] };
  });

  fastify.put('/suppliers/:id', { preHandler: [fastify.requireRoles(PROC_ROLES)] }, async (req, reply) => {
    const id = parseInt(req.params.id); if (isNaN(id)) return bad(reply, 'Неверный ID');
    if (req.body.category !== undefined && !SUPPLIER_CATEGORIES.includes(req.body.category)) return bad(reply, 'Неверная категория');
    const allowed = ['name', 'inn', 'kpp', 'ogrn', 'phone', 'email', 'website', 'address', 'category', 'rating', 'notes', 'is_active'];
    const upd = [], vals = []; let i = 1;
    for (const k of allowed) if (req.body[k] !== undefined) { upd.push(`${k}=$${i++}`); vals.push(req.body[k]); }
    if (!upd.length) return bad(reply, 'Нет данных');
    upd.push('updated_at=NOW()'); vals.push(id);
    const { rows } = await db.query(`UPDATE suppliers SET ${upd.join(',')} WHERE id=$${i} AND deleted_at IS NULL RETURNING *`, vals);
    if (!rows[0]) return bad(reply, 'Не найден', 404);
    return { item: rows[0] };
  });

  fastify.delete('/suppliers/:id', { preHandler: [fastify.requireRoles(['ADMIN'])] }, async (req, reply) => {
    const { rows } = await db.query('UPDATE suppliers SET deleted_at=NOW(), is_active=false WHERE id=$1 AND deleted_at IS NULL RETURNING id', [req.params.id]);
    if (!rows[0]) return bad(reply, 'Не найден', 404);
    return { success: true };
  });

  // ── Контакты поставщика ──────────────────────────────────────────────────
  fastify.get('/suppliers/:id/contacts', { preHandler: [fastify.requireRoles(READ_ROLES)] }, async (req) => {
    const { rows } = await db.query('SELECT * FROM supplier_contacts WHERE supplier_id=$1 ORDER BY is_primary DESC, full_name', [req.params.id]);
    return { items: rows };
  });

  fastify.post('/suppliers/:id/contacts', { preHandler: [fastify.requireRoles(PROC_ROLES)] }, async (req, reply) => {
    const supplierId = parseInt(req.params.id); if (isNaN(supplierId)) return bad(reply, 'Неверный ID');
    const { full_name, role, phone, email, telegram, is_primary, notes } = req.body;
    if (!full_name || !full_name.trim()) return bad(reply, 'Имя контакта обязательно');
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      if (is_primary) await client.query('UPDATE supplier_contacts SET is_primary=false WHERE supplier_id=$1 AND is_primary=true', [supplierId]);
      const { rows } = await client.query(
        `INSERT INTO supplier_contacts(supplier_id,full_name,role,phone,email,telegram,is_primary,notes)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [supplierId, full_name.trim(), role || null, phone || null, email || null, telegram || null, !!is_primary, notes || null]);
      await client.query('COMMIT');
      return { item: rows[0] };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  });

  fastify.put('/suppliers/:id/contacts/:cid', { preHandler: [fastify.requireRoles(PROC_ROLES)] }, async (req, reply) => {
    const supplierId = parseInt(req.params.id), cid = parseInt(req.params.cid);
    const allowed = ['full_name', 'role', 'phone', 'email', 'telegram', 'is_primary', 'notes'];
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      if (req.body.is_primary === true) await client.query('UPDATE supplier_contacts SET is_primary=false WHERE supplier_id=$1 AND is_primary=true AND id<>$2', [supplierId, cid]);
      const upd = [], vals = []; let i = 1;
      for (const k of allowed) if (req.body[k] !== undefined) { upd.push(`${k}=$${i++}`); vals.push(req.body[k]); }
      if (!upd.length) { await client.query('ROLLBACK'); return bad(reply, 'Нет данных'); }
      upd.push('updated_at=NOW()'); vals.push(cid, supplierId);
      const { rows } = await client.query(`UPDATE supplier_contacts SET ${upd.join(',')} WHERE id=$${i} AND supplier_id=$${i + 1} RETURNING *`, vals);
      await client.query('COMMIT');
      if (!rows[0]) return bad(reply, 'Контакт не найден', 404);
      return { item: rows[0] };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  });

  fastify.delete('/suppliers/:id/contacts/:cid', { preHandler: [fastify.requireRoles(PROC_ROLES)] }, async (req, reply) => {
    const { rows } = await db.query('DELETE FROM supplier_contacts WHERE id=$1 AND supplier_id=$2 RETURNING id', [req.params.cid, req.params.id]);
    if (!rows[0]) return bad(reply, 'Не найден', 404);
    return { success: true };
  });

  // ── История цен и статистика поставщика ──────────────────────────────────
  fastify.get('/suppliers/:id/price-history', { preHandler: [fastify.requireRoles(READ_ROLES)] }, async (req) => {
    const { product_id, category_id, date_from, limit = 100 } = req.query;
    let sql = `SELECT pr.*, p.name as product_name FROM price_records pr
      LEFT JOIN products p ON pr.product_id=p.id WHERE pr.supplier_id=$1`;
    const params = [req.params.id]; let i = 2;
    if (product_id) { sql += ` AND pr.product_id=$${i++}`; params.push(product_id); }
    if (category_id) { sql += ` AND pr.product_category_id=$${i++}`; params.push(category_id); }
    if (date_from) { sql += ` AND pr.recorded_at>=$${i++}`; params.push(date_from); }
    sql += ` ORDER BY pr.recorded_at DESC LIMIT $${i++}`; params.push(Math.min(parseInt(limit), 500));
    const { rows } = await db.query(sql, params);
    return { items: rows };
  });

  fastify.get('/suppliers/:id/stats', { preHandler: [fastify.requireRoles(READ_ROLES)] }, async (req) => {
    const id = req.params.id;
    const summary = await db.query(`SELECT
      (SELECT COUNT(DISTINCT pi.procurement_id) FROM procurement_items pi WHERE pi.supplier_id=$1) as deals_count,
      (SELECT COUNT(*) FROM price_records WHERE supplier_id=$1) as price_points,
      (SELECT MAX(recorded_at) FROM price_records WHERE supplier_id=$1) as last_price_at`, [id]);
    const topItems = await db.query(`SELECT item_name, COUNT(*) as cnt, ROUND(AVG(unit_price),2) as avg_price
      FROM price_records WHERE supplier_id=$1 GROUP BY item_name ORDER BY cnt DESC LIMIT 10`, [id]);
    return { summary: summary.rows[0], top_items: topItems.rows };
  });

  // ═══════════════════════════════════════════════════════════════════════
  // КАТЕГОРИИ ТОВАРОВ  /api/product-categories
  // ═══════════════════════════════════════════════════════════════════════

  fastify.get('/product-categories', { preHandler: [fastify.authenticate] }, async () => {
    const { rows } = await db.query(`SELECT c.*,
      (SELECT COUNT(*) FROM products p WHERE p.category_id=c.id AND p.is_active=true) as products_count
      FROM product_categories c WHERE c.is_active=true ORDER BY c.parent_id NULLS FIRST, c.sort_order, c.name`);
    return { items: rows };
  });

  fastify.post('/product-categories', { preHandler: [fastify.requireRoles(['ADMIN'])] }, async (req, reply) => {
    const { name, parent_id, sort_order } = req.body;
    if (!name || !name.trim()) return bad(reply, 'Название обязательно');
    // Enforce max depth = 2: parent должен быть корневым
    if (parent_id) {
      const pc = await db.query('SELECT parent_id FROM product_categories WHERE id=$1', [parent_id]);
      if (!pc.rows[0]) return bad(reply, 'Родительская категория не найдена');
      if (pc.rows[0].parent_id) return bad(reply, 'Максимум 2 уровня категорий');
    }
    const { rows } = await db.query('INSERT INTO product_categories(name,parent_id,sort_order) VALUES($1,$2,$3) RETURNING *',
      [name.trim(), parent_id || null, sort_order || 0]);
    return { item: rows[0] };
  });

  fastify.put('/product-categories/:id', { preHandler: [fastify.requireRoles(['ADMIN'])] }, async (req, reply) => {
    const allowed = ['name', 'sort_order', 'is_active'];
    const upd = [], vals = []; let i = 1;
    for (const k of allowed) if (req.body[k] !== undefined) { upd.push(`${k}=$${i++}`); vals.push(req.body[k]); }
    if (!upd.length) return bad(reply, 'Нет данных');
    vals.push(req.params.id);
    const { rows } = await db.query(`UPDATE product_categories SET ${upd.join(',')} WHERE id=$${i} RETURNING *`, vals);
    if (!rows[0]) return bad(reply, 'Не найдена', 404);
    return { item: rows[0] };
  });

  fastify.delete('/product-categories/:id', { preHandler: [fastify.requireRoles(['ADMIN'])] }, async (req, reply) => {
    const id = req.params.id;
    const kids = await db.query('SELECT 1 FROM product_categories WHERE parent_id=$1 LIMIT 1', [id]);
    if (kids.rows[0]) return bad(reply, 'Есть подкатегории — сначала удалите их', 409);
    const prods = await db.query('SELECT 1 FROM products WHERE category_id=$1 LIMIT 1', [id]);
    if (prods.rows[0]) return bad(reply, 'Есть товары в категории', 409);
    await db.query('DELETE FROM product_categories WHERE id=$1', [id]);
    return { success: true };
  });

  // ═══════════════════════════════════════════════════════════════════════
  // КАТАЛОГ НОМЕНКЛАТУРЫ  /api/products
  // ═══════════════════════════════════════════════════════════════════════

  fastify.get('/products', { preHandler: [fastify.authenticate] }, async (req) => {
    const { category_id, search, is_active, limit = 100, offset = 0 } = req.query;
    let sql = `SELECT p.*, c.name as category_name FROM products p
      LEFT JOIN product_categories c ON p.category_id=c.id WHERE 1=1`;
    const params = []; let i = 1;
    if (category_id) { sql += ` AND p.category_id=$${i++}`; params.push(category_id); }
    if (is_active !== undefined) { sql += ` AND p.is_active=$${i++}`; params.push(is_active === 'true' || is_active === true); }
    else { sql += ` AND p.is_active=true`; }
    if (search) { sql += ` AND (p.name ILIKE $${i} OR p.article ILIKE $${i})`; params.push(`%${search}%`); i++; }
    sql += ` ORDER BY p.name LIMIT $${i++} OFFSET $${i++}`;
    params.push(Math.min(parseInt(limit), 500), parseInt(offset));
    const { rows } = await db.query(sql, params);
    return { items: rows };
  });

  // Автокомплит для поля «позиция закупки» — trigram similarity
  fastify.get('/products/search', { preHandler: [fastify.authenticate] }, async (req) => {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return { items: [] };
    const { rows } = await db.query(
      `SELECT p.id, p.name, p.article, p.unit, p.category_id, c.name as category_name,
        similarity(p.name, $1) as sim
       FROM products p LEFT JOIN product_categories c ON p.category_id=c.id
       WHERE p.is_active=true AND (p.name ILIKE $2 OR p.name % $1)
       ORDER BY sim DESC, p.name LIMIT 12`,
      [q, `%${q}%`]);
    return { items: rows };
  });

  fastify.get('/products/:id', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { rows } = await db.query(`SELECT p.*, c.name as category_name FROM products p
      LEFT JOIN product_categories c ON p.category_id=c.id WHERE p.id=$1`, [req.params.id]);
    if (!rows[0]) return bad(reply, 'Не найден', 404);
    return { item: rows[0] };
  });

  fastify.post('/products', { preHandler: [fastify.requireRoles(PROC_ROLES)] }, async (req, reply) => {
    const { name, article, unit, category_id, notes } = req.body;
    if (!name || !name.trim()) return bad(reply, 'Название обязательно');
    const { rows } = await db.query(
      `INSERT INTO products(name,article,unit,category_id,notes,created_by)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name.trim(), article || null, unit || 'шт', category_id || null, notes || null, req.user.id]);
    return { item: rows[0] };
  });

  fastify.put('/products/:id', { preHandler: [fastify.requireRoles(PROC_ROLES)] }, async (req, reply) => {
    const allowed = ['name', 'article', 'unit', 'category_id', 'notes', 'is_active'];
    const upd = [], vals = []; let i = 1;
    for (const k of allowed) if (req.body[k] !== undefined) { upd.push(`${k}=$${i++}`); vals.push(req.body[k]); }
    if (!upd.length) return bad(reply, 'Нет данных');
    upd.push('updated_at=NOW()'); vals.push(req.params.id);
    const { rows } = await db.query(`UPDATE products SET ${upd.join(',')} WHERE id=$${i} RETURNING *`, vals);
    if (!rows[0]) return bad(reply, 'Не найден', 404);
    return { item: rows[0] };
  });

  // История цен и статистика по товару
  fastify.get('/products/:id/price-history', { preHandler: [fastify.requireRoles(READ_ROLES)] }, async (req) => {
    const { rows } = await db.query(
      `SELECT pr.*, s.name as supplier_ref_name FROM price_records pr
       LEFT JOIN suppliers s ON pr.supplier_id=s.id WHERE pr.product_id=$1
       ORDER BY pr.recorded_at DESC LIMIT 200`, [req.params.id]);
    return { items: rows };
  });

  fastify.get('/products/:id/price-stats', { preHandler: [fastify.requireRoles(READ_ROLES)] }, async (req) => {
    const days = Math.min(parseInt(req.query.days) || 90, 365);
    const { rows } = await db.query(
      `SELECT COUNT(*) as sample_count, MIN(unit_price) as min_price, MAX(unit_price) as max_price,
        ROUND(AVG(unit_price),2) as avg_price,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unit_price) as median_price
       FROM price_records WHERE product_id=$1 AND recorded_at >= NOW() - ($2 || ' days')::interval`,
      [req.params.id, days]);
    return { stats: rows[0] };
  });

  // ═══════════════════════════════════════════════════════════════════════
  // БАЗА ЦЕН  /api/price-records
  // ═══════════════════════════════════════════════════════════════════════

  fastify.get('/price-records', { preHandler: [fastify.requireRoles(READ_ROLES)] }, async (req) => {
    const { product_id, supplier_id, category_id, source, date_from, date_to, search, limit = 100, offset = 0 } = req.query;
    let sql = `SELECT pr.*, p.name as product_ref_name, s.name as supplier_ref_name, u.name as recorded_by_name
      FROM price_records pr LEFT JOIN products p ON pr.product_id=p.id
      LEFT JOIN suppliers s ON pr.supplier_id=s.id LEFT JOIN users u ON pr.recorded_by=u.id WHERE 1=1`;
    const params = []; let i = 1;
    if (product_id) { sql += ` AND pr.product_id=$${i++}`; params.push(product_id); }
    if (supplier_id) { sql += ` AND pr.supplier_id=$${i++}`; params.push(supplier_id); }
    if (category_id) { sql += ` AND pr.product_category_id=$${i++}`; params.push(category_id); }
    if (source) { sql += ` AND pr.source=$${i++}`; params.push(source); }
    if (date_from) { sql += ` AND pr.recorded_at>=$${i++}`; params.push(date_from); }
    if (date_to) { sql += ` AND pr.recorded_at<=$${i++}`; params.push(date_to + 'T23:59:59'); }
    if (search) { sql += ` AND pr.item_name ILIKE $${i}`; params.push(`%${search}%`); i++; }
    sql += ` ORDER BY pr.recorded_at DESC LIMIT $${i++} OFFSET $${i++}`;
    params.push(Math.min(parseInt(limit), 300), parseInt(offset));
    const { rows } = await db.query(sql, params);
    return { items: rows };
  });

  fastify.post('/price-records', { preHandler: [fastify.requireRoles(PROC_ROLES)] }, async (req, reply) => {
    const { product_id, product_category_id, item_name, article, unit, supplier_id, supplier_name,
      unit_price, currency, region, source, source_url, valid_until, notes } = req.body;
    if (!item_name || !item_name.trim()) return bad(reply, 'Наименование обязательно');
    const e = valNum(unit_price, 'unit_price'); if (e) return bad(reply, e);
    if (!unit_price || parseFloat(unit_price) <= 0) return bad(reply, 'Цена должна быть больше 0');
    const src = source || 'manual';
    if (!PRICE_SOURCES.includes(src)) return bad(reply, 'Неверный источник цены');
    // snapshot имени поставщика
    let supName = supplier_name || null;
    if (supplier_id && !supName) {
      const s = await db.query('SELECT name FROM suppliers WHERE id=$1', [supplier_id]);
      supName = s.rows[0]?.name || null;
    }
    const { rows } = await db.query(
      `INSERT INTO price_records(product_id,product_category_id,item_name,article,unit,supplier_id,supplier_name,
        unit_price,currency,region,source,source_url,valid_until,notes,recorded_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [product_id || null, product_category_id || null, item_name.trim(), article || null, unit || 'шт',
       supplier_id || null, supName, parseFloat(unit_price), currency || 'RUB', region || null,
       src, source_url || null, valid_until || null, notes || null, req.user.id]);
    return { item: rows[0] };
  });

  /**
   * Подсказка цены для UI при вводе позиции.
   * GET /price-records/hint?product_id=&name=
   * Возвращает: последнюю цену (last) + статистику рынка (avg/median/min/max за 90 дней).
   */
  fastify.get('/price-records/hint', { preHandler: [fastify.requireRoles([...READ_ROLES])] }, async (req) => {
    const { product_id, name } = req.query;
    if (!product_id && !(name && name.trim())) return { last: null, stats: null };

    let last = null, stats = null;
    if (product_id) {
      const l = await db.query('SELECT item_name,unit_price,currency,supplier_id,supplier_name,source,recorded_at FROM v_last_price_by_product WHERE product_id=$1', [product_id]);
      last = l.rows[0] || null;
      const s = await db.query(
        `SELECT COUNT(*) as sample_count, ROUND(AVG(unit_price),2) as avg_price,
          MIN(unit_price) as min_price, MAX(unit_price) as max_price,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unit_price) as median_price
         FROM price_records WHERE product_id=$1 AND recorded_at >= NOW() - INTERVAL '90 days'`, [product_id]);
      stats = s.rows[0]?.sample_count > 0 ? s.rows[0] : null;
    } else {
      // по названию (нет product_id) — последняя запись по похожему имени
      const l = await db.query(
        `SELECT item_name,unit_price,currency,supplier_id,supplier_name,source,recorded_at
         FROM price_records WHERE item_name ILIKE $1 ORDER BY recorded_at DESC LIMIT 1`, [`%${name.trim()}%`]);
      last = l.rows[0] || null;
      const s = await db.query(
        `SELECT COUNT(*) as sample_count, ROUND(AVG(unit_price),2) as avg_price,
          MIN(unit_price) as min_price, MAX(unit_price) as max_price,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unit_price) as median_price
         FROM price_records WHERE item_name ILIKE $1 AND recorded_at >= NOW() - INTERVAL '90 days'`, [`%${name.trim()}%`]);
      stats = s.rows[0]?.sample_count > 0 ? s.rows[0] : null;
    }
    return { last, stats };
  });

  // Сравнение поставщиков по товару/категории
  fastify.get('/price-records/supplier-compare', { preHandler: [fastify.requireRoles(READ_ROLES)] }, async (req) => {
    const { product_id, category_id, days = 180 } = req.query;
    if (!product_id && !category_id) return { items: [] };
    const col = product_id ? 'product_id' : 'product_category_id';
    const val = product_id || category_id;
    const { rows } = await db.query(
      `SELECT pr.supplier_id, COALESCE(s.name, pr.supplier_name) as supplier_name,
        COUNT(*) as offers, ROUND(AVG(pr.unit_price),2) as avg_price,
        MIN(pr.unit_price) as min_price, MAX(pr.recorded_at) as last_seen
       FROM price_records pr LEFT JOIN suppliers s ON pr.supplier_id=s.id
       WHERE pr.${col}=$1 AND pr.recorded_at >= NOW() - ($2 || ' days')::interval
         AND (pr.supplier_id IS NOT NULL OR pr.supplier_name IS NOT NULL)
       GROUP BY pr.supplier_id, COALESCE(s.name, pr.supplier_name)
       ORDER BY avg_price ASC`,
      [val, Math.min(parseInt(days), 730)]);
    return { items: rows };
  });
}

module.exports = routes;
