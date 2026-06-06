'use strict';
/**
 * АСГАРД CRM — Количественный складской учёт (наличие расходников).
 * Регистрируется в index.js под префиксом /api/stock.
 *
 * Каталог (products) ≠ наличие. Здесь — сколько и где физически лежит.
 * Поштучное оборудование остаётся в equipment. Здесь — количественный учёт
 * расходников (химия, метизы, шланги, СИЗ и т.п.) по складам/ячейкам.
 *
 * Все операции пишут в stock_movements (журнал) и атомарно меняют stock.
 * quick-создание каталог-черновика доступно широкому кругу (рабочие/кладовщик),
 * т.к. закупочный POST /products ограничен PROC.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const WMS_WRITE = ['ADMIN', 'WAREHOUSE', 'CHIEF_ENGINEER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
const WMS_READ = [...WMS_WRITE, 'PM', 'HEAD_PM', 'PROC', 'BUH'];
// Кто может завести каталог-черновик «за 10 сек» (шире, чем PROC):
const QUICK_CREATE = [...WMS_WRITE, 'PM', 'HEAD_PM', 'TO', 'HEAD_TO'];
const MOVE_TYPES = ['receipt', 'issue', 'transfer', 'writeoff', 'return', 'found', 'adjust'];

async function routes(fastify) {
  const db = fastify.db;
  const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });
  const num = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };

  // Главный склад по умолчанию (для приёмки без явного склада)
  async function mainWarehouseId(client) {
    const r = await (client || db).query("SELECT id FROM warehouses WHERE is_main=true AND is_active=true ORDER BY id LIMIT 1");
    return r.rows[0]?.id || null;
  }

  /**
   * Применить дельту к stock-слоту (product, warehouse, location) атомарно.
   * delta>0 — приход, delta<0 — расход. Создаёт строку при отсутствии.
   * Бросает {code:'INSUFFICIENT'} если итог < 0.
   */
  // respectReserved=true: расход не может опустить остаток ниже зарезервированного
  // (issue/transfer не трогают резерв; writeoff может — списание брака/недостачи с причиной).
  async function applyDelta(client, { product_id, warehouse_id, location_id, delta, unit, respectReserved }) {
    const sel = await client.query(
      `SELECT id, quantity, reserved_qty FROM stock WHERE product_id=$1 AND warehouse_id=$2 AND location_id IS NOT DISTINCT FROM $3 FOR UPDATE`,
      [product_id, warehouse_id, location_id || null]);
    if (sel.rows[0]) {
      const next = parseFloat(sel.rows[0].quantity) + delta;
      if (next < 0) { const err = new Error('INSUFFICIENT'); err.code = 'INSUFFICIENT'; throw err; }
      if (respectReserved && delta < 0) {
        const reserved = parseFloat(sel.rows[0].reserved_qty || 0);
        if (next < reserved) { const err = new Error('RESERVED'); err.code = 'RESERVED'; err.available = parseFloat(sel.rows[0].quantity) - reserved; throw err; }
      }
      await client.query('UPDATE stock SET quantity=$1, updated_at=NOW() WHERE id=$2', [next, sel.rows[0].id]);
      return next;
    } else {
      if (delta < 0) { const err = new Error('INSUFFICIENT'); err.code = 'INSUFFICIENT'; throw err; }
      await client.query(
        `INSERT INTO stock(product_id,warehouse_id,location_id,quantity,unit) VALUES($1,$2,$3,$4,$5)`,
        [product_id, warehouse_id, location_id || null, delta, unit || 'шт']);
      return delta;
    }
  }

  async function logMove(client, m) {
    await client.query(
      `INSERT INTO stock_movements(product_id,from_warehouse_id,from_location_id,to_warehouse_id,to_location_id,
        qty,unit,movement_type,ref_type,ref_id,reason,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [m.product_id, m.from_warehouse_id || null, m.from_location_id || null, m.to_warehouse_id || null,
       m.to_location_id || null, m.qty, m.unit || 'шт', m.movement_type, m.ref_type || null, m.ref_id || null,
       m.reason || null, m.created_by]);
  }

  // ═══ НАЛИЧИЕ ═══

  // Остатки (плоский список строк stock с именами)
  fastify.get('/', { preHandler: [fastify.requireRoles(WMS_READ)] }, async (req) => {
    const { product_id, warehouse_id, location_id, low_only, search, limit = 200, offset = 0 } = req.query;
    let sql = `SELECT s.*, p.name AS product_name, p.article, p.is_consumable, p.min_stock_level,
      w.name AS warehouse_name, l.label AS location_label
      FROM stock s JOIN products p ON s.product_id = p.id
      LEFT JOIN warehouses w ON s.warehouse_id = w.id
      LEFT JOIN warehouse_locations l ON s.location_id = l.id
      WHERE p.deleted_at IS NULL`;
    const pr = []; let i = 1;
    if (product_id) { sql += ` AND s.product_id=$${i++}`; pr.push(product_id); }
    if (warehouse_id) { sql += ` AND s.warehouse_id=$${i++}`; pr.push(warehouse_id); }
    if (location_id) { sql += ` AND s.location_id=$${i++}`; pr.push(location_id); }
    if (low_only === 'true') { sql += ` AND p.min_stock_level > 0 AND s.quantity <= p.min_stock_level`; }
    if (search) { sql += ` AND (p.name ILIKE $${i} OR p.article ILIKE $${i})`; pr.push(`%${search}%`); i++; }
    sql += ` ORDER BY p.name LIMIT $${i++} OFFSET $${i++}`;
    pr.push(Math.min(parseInt(limit), 1000), parseInt(offset));
    const { rows } = await db.query(sql, pr);
    return { items: rows };
  });

  /**
   * Наличие конкретной каталог-позиции по складам/ячейкам (для витрины каталога:
   * «в наличии 2 шт на складе X, ячейка A-12»).
   * GET /stock/availability/:productId
   */
  fastify.get('/availability/:productId', { preHandler: [fastify.requireRoles(WMS_READ)] }, async (req) => {
    const pid = parseInt(req.params.productId);
    const { rows } = await db.query(
      `SELECT s.warehouse_id, w.name AS warehouse_name, s.location_id, l.label AS location_label,
        s.quantity, s.reserved_qty, s.unit
       FROM stock s LEFT JOIN warehouses w ON s.warehouse_id=w.id
       LEFT JOIN warehouse_locations l ON s.location_id=l.id
       WHERE s.product_id=$1 AND s.quantity>0 ORDER BY w.name, l.label`, [pid]);
    const total = rows.reduce((a, r) => a + parseFloat(r.quantity), 0);
    return { product_id: pid, total, slots: rows };
  });

  /**
   * Входящие поставки для кладовщика (онлайн-видимость склад↔закупки).
   * GET /stock/incoming?target=warehouse|object|all&status=
   * Показывает позиции закупок: что едет на склад (принять), что напрямую на объект (для инфо),
   * статус (в пути/доставлено), ориентировочные сроки, получатель/работа.
   */
  fastify.get('/incoming', { preHandler: [fastify.requireRoles(WMS_READ)] }, async (req) => {
    const { target = 'all', status } = req.query;
    let sql = `SELECT pi.id, pi.name, pi.article, pi.quantity, pi.unit, pi.item_status, pi.delivery_target,
        pi.actual_delivery, pi.equipment_id, pi.recipient_kind,
        pr.id AS procurement_id, pr.work_id, pr.needed_by, pr.delivery_deadline, pr.delivery_date,
        pr.delivery_address, pr.status AS request_status,
        w.work_title, w.object_name,
        wh.name AS warehouse_name,
        u.name AS proc_name
      FROM procurement_items pi
      JOIN procurement_requests pr ON pi.procurement_id = pr.id
      LEFT JOIN works w ON pr.work_id = w.id
      LEFT JOIN warehouses wh ON pi.warehouse_id = wh.id
      LEFT JOIN users u ON pr.proc_id = u.id
      WHERE pr.status NOT IN ('draft','dir_rejected','closed')
        AND pi.item_status IN ('ordered','shipped','delivered','partially_delivered','pending')`;
    const p = []; let i = 1;
    if (target === 'warehouse') sql += ` AND pi.delivery_target = 'warehouse'`;
    else if (target === 'object') sql += ` AND pi.delivery_target = 'object'`;
    if (status) { sql += ` AND pi.item_status = $${i++}`; p.push(status); }
    sql += ` ORDER BY COALESCE(pr.delivery_deadline, pr.needed_by) NULLS LAST, pr.id DESC LIMIT 300`;
    const { rows } = await db.query(sql, p);
    // сводка для бейджей
    const summary = {
      to_warehouse_in_transit: rows.filter(r => r.delivery_target === 'warehouse' && ['ordered', 'shipped'].includes(r.item_status)).length,
      to_warehouse_delivered: rows.filter(r => r.delivery_target === 'warehouse' && r.item_status === 'delivered').length,
      to_object: rows.filter(r => r.delivery_target === 'object').length,
    };
    return { items: rows, summary };
  });

  // Низкий остаток (для авто-заявки в закупки)
  fastify.get('/low', { preHandler: [fastify.requireRoles(WMS_READ)] }, async () => {
    const { rows } = await db.query(
      `SELECT p.id AS product_id, p.name, p.article, p.min_stock_level, p.unit,
        COALESCE(SUM(s.quantity),0) AS total_qty
       FROM products p LEFT JOIN stock s ON s.product_id=p.id
       WHERE p.deleted_at IS NULL AND p.is_consumable=true AND p.min_stock_level>0
       GROUP BY p.id HAVING COALESCE(SUM(s.quantity),0) <= p.min_stock_level
       ORDER BY (p.min_stock_level - COALESCE(SUM(s.quantity),0)) DESC`);
    return { items: rows };
  });

  // ═══ КАТАЛОГ-ЧЕРНОВИК «за 10 сек» ═══
  // Доступно широкому кругу. Создаёт products(is_draft=true) если такой ещё нет.
  fastify.post('/quick-product', { preHandler: [fastify.requireRoles(QUICK_CREATE)] }, async (req, reply) => {
    const { name, unit, category_id, created_from, article } = req.body;
    const ean = (req.body.ean || '').trim() || null; // W7: пустую строку → NULL
    if (!name || !name.trim()) return bad(reply, 'Название обязательно');
    const nm = name.trim();
    const cf = created_from || 'manual';
    // Поиск существующего (по EAN или имени) — не плодим дубли
    let found = null;
    if (ean) { const e = await db.query('SELECT * FROM products WHERE ean=$1 AND deleted_at IS NULL LIMIT 1', [ean]); found = e.rows[0] || null; }
    if (!found) { const n = await db.query('SELECT * FROM products WHERE lower(name)=lower($1) AND deleted_at IS NULL LIMIT 1', [nm]); found = n.rows[0] || null; }
    if (found) return { item: found, existed: true };
    try {
      const { rows } = await db.query(
        `INSERT INTO products(name,article,unit,category_id,ean,is_draft,created_from,created_by)
         VALUES($1,$2,$3,$4,$5,true,$6,$7) RETURNING *`,
        [nm, article || null, unit || 'шт', category_id || null, ean, cf, req.user.id]);
      return { item: rows[0], existed: false };
    } catch (e) {
      // C6: гонка — другой запрос успел создать черновик с тем же именем (UNIQUE uq_products_draft_name)
      if (e.code === '23505') {
        const r = await db.query('SELECT * FROM products WHERE lower(name)=lower($1) AND deleted_at IS NULL LIMIT 1', [nm]);
        if (r.rows[0]) return { item: r.rows[0], existed: true };
      }
      throw e;
    }
  });

  // Снять черновик (подтвердить позицию каталога) — кладовщик/закупщик
  fastify.put('/products/:id/confirm', { preHandler: [fastify.requireRoles([...WMS_WRITE, 'PROC'])] }, async (req, reply) => {
    const { rows } = await db.query('UPDATE products SET is_draft=false, updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING *', [req.params.id]);
    if (!rows[0]) return bad(reply, 'Не найден', 404);
    return { item: rows[0] };
  });

  // Слить дубль каталога: source → target (перенос остатков и обновление ссылок)
  fastify.post('/products/:id/merge', { preHandler: [fastify.requireRoles([...WMS_WRITE, 'PROC'])] }, async (req, reply) => {
    const sourceId = parseInt(req.params.id);
    const targetId = parseInt(req.body.target_id);
    if (!targetId || sourceId === targetId) return bad(reply, 'Неверный target_id');
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      // C5: target и source должны существовать и быть не удалены (иначе остатки уйдут «в пустоту»).
      const chk = await client.query('SELECT id, deleted_at FROM products WHERE id = ANY($1) FOR UPDATE', [[sourceId, targetId]]);
      const tgt = chk.rows.find(r => r.id === targetId), src = chk.rows.find(r => r.id === sourceId);
      if (!tgt || tgt.deleted_at) { await client.query('ROLLBACK'); return bad(reply, 'Целевая позиция не найдена или удалена', 409); }
      if (!src || src.deleted_at) { await client.query('ROLLBACK'); return bad(reply, 'Исходная позиция не найдена или удалена', 409); }
      // Перенести stock-строки источника на target (суммируя)
      const srcStock = await client.query('SELECT * FROM stock WHERE product_id=$1 FOR UPDATE', [sourceId]);
      for (const s of srcStock.rows) {
        // Надёжный upsert (location может быть NULL): IS NOT DISTINCT FROM.
        const exT = await client.query('SELECT id FROM stock WHERE product_id=$1 AND warehouse_id=$2 AND location_id IS NOT DISTINCT FROM $3 FOR UPDATE', [targetId, s.warehouse_id, s.location_id]);
        if (exT.rows[0]) await client.query('UPDATE stock SET quantity=quantity+$1, reserved_qty=reserved_qty+$2, updated_at=NOW() WHERE id=$3', [s.quantity, s.reserved_qty, exT.rows[0].id]);
        else await client.query('INSERT INTO stock(product_id,warehouse_id,location_id,quantity,reserved_qty,unit) VALUES($1,$2,$3,$4,$5,$6)', [targetId, s.warehouse_id, s.location_id, s.quantity, s.reserved_qty, s.unit]);
      }
      await client.query('DELETE FROM stock WHERE product_id=$1', [sourceId]);
      // Перецепить ссылки
      await client.query('UPDATE stock_movements SET product_id=$1 WHERE product_id=$2', [targetId, sourceId]);
      await client.query('UPDATE equipment SET product_id=$1 WHERE product_id=$2', [targetId, sourceId]);
      await client.query('UPDATE assembly_items SET product_id=$1 WHERE product_id=$2', [targetId, sourceId]);
      await client.query('UPDATE procurement_items SET product_id=$1 WHERE product_id=$2', [targetId, sourceId]);
      await client.query('UPDATE price_records SET product_id=$1 WHERE product_id=$2', [targetId, sourceId]); // W4: сохранить историю цен
      await client.query('UPDATE products SET deleted_at=NOW(), is_active=false WHERE id=$1', [sourceId]);
      await client.query('COMMIT');
      return { success: true, merged_into: targetId };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  });

  // ═══ ОПЕРАЦИИ ═══

  // Приход (оприходование) расходника на склад/ячейку
  fastify.post('/receipt', { preHandler: [fastify.requireRoles(WMS_WRITE)] }, async (req, reply) => {
    const { product_id, warehouse_id, location_id, qty, unit, reason, ref_type, ref_id } = req.body;
    const q = num(qty); if (!product_id || !q || q <= 0) return bad(reply, 'product_id и qty>0 обязательны');
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const wh = warehouse_id || await mainWarehouseId(client);
      if (!wh) { await client.query('ROLLBACK'); return bad(reply, 'Не задан склад и нет главного склада'); }
      await applyDelta(client, { product_id, warehouse_id: wh, location_id, delta: q, unit });
      await logMove(client, { product_id, to_warehouse_id: wh, to_location_id: location_id, qty: q, unit,
        movement_type: 'receipt', ref_type, ref_id, reason, created_by: req.user.id });
      await client.query('COMMIT');
      return { success: true };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  });

  // Находка/излишек (приехало больше чем отправляли / неизвестное)
  fastify.post('/found', { preHandler: [fastify.requireRoles(WMS_WRITE)] }, async (req, reply) => {
    const { product_id, warehouse_id, location_id, qty, unit, reason } = req.body;
    const q = num(qty); if (!product_id || !q || q <= 0) return bad(reply, 'product_id и qty>0 обязательны');
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const wh = warehouse_id || await mainWarehouseId(client);
      await applyDelta(client, { product_id, warehouse_id: wh, location_id, delta: q, unit });
      await logMove(client, { product_id, to_warehouse_id: wh, to_location_id: location_id, qty: q, unit,
        movement_type: 'found', reason: reason || 'Излишек/находка', created_by: req.user.id });
      await client.query('COMMIT');
      return { success: true };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  });

  // Расход (выдача/израсходовано)
  fastify.post('/issue', { preHandler: [fastify.requireRoles(WMS_WRITE)] }, async (req, reply) => {
    const { product_id, warehouse_id, location_id, qty, unit, reason, ref_type, ref_id } = req.body;
    const q = num(qty); if (!product_id || !q || q <= 0) return bad(reply, 'product_id и qty>0 обязательны');
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const wh = warehouse_id || await mainWarehouseId(client);
      await applyDelta(client, { product_id, warehouse_id: wh, location_id, delta: -q, unit, respectReserved: true });
      await logMove(client, { product_id, from_warehouse_id: wh, from_location_id: location_id, qty: q, unit,
        movement_type: 'issue', ref_type, ref_id, reason, created_by: req.user.id });
      await client.query('COMMIT');
      return { success: true };
    } catch (e) {
      await client.query('ROLLBACK');
      if (e.code === 'INSUFFICIENT') return bad(reply, 'Недостаточно остатка', 409);
      if (e.code === 'RESERVED') return bad(reply, `Нельзя выдать: часть зарезервирована. Доступно: ${e.available}`, 409);
      throw e;
    } finally { client.release(); }
  });

  // Списание (недостача/брак)
  fastify.post('/writeoff', { preHandler: [fastify.requireRoles(WMS_WRITE)] }, async (req, reply) => {
    const { product_id, warehouse_id, location_id, qty, unit, reason } = req.body;
    const q = num(qty); if (!product_id || !q || q <= 0) return bad(reply, 'product_id и qty>0 обязательны');
    if (!reason || !reason.trim()) return bad(reply, 'Причина списания обязательна');
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const wh = warehouse_id || await mainWarehouseId(client);
      await applyDelta(client, { product_id, warehouse_id: wh, location_id, delta: -q, unit });
      await logMove(client, { product_id, from_warehouse_id: wh, from_location_id: location_id, qty: q, unit,
        movement_type: 'writeoff', reason, created_by: req.user.id });
      await client.query('COMMIT');
      return { success: true };
    } catch (e) {
      await client.query('ROLLBACK');
      if (e.code === 'INSUFFICIENT') return bad(reply, 'Недостаточно остатка для списания', 409);
      throw e;
    } finally { client.release(); }
  });

  // Перемещение между ячейками/складами
  fastify.post('/transfer', { preHandler: [fastify.requireRoles(WMS_WRITE)] }, async (req, reply) => {
    const { product_id, qty, unit, reason } = req.body;
    // Нормализуем id к числам/null (из JSON могут прийти строки → ломали сравнение типов).
    const toInt = v => { const n = parseInt(v); return isNaN(n) ? null : n; };
    const fromLoc = toInt(req.body.from_location_id), toLoc = toInt(req.body.to_location_id);
    let fromWh = toInt(req.body.from_warehouse_id), toWh = toInt(req.body.to_warehouse_id);
    const q = num(qty); if (!product_id || !q || q <= 0) return bad(reply, 'product_id и qty>0 обязательны');
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      if (!fromWh) fromWh = await mainWarehouseId(client);
      if (!toWh) toWh = fromWh;
      // C2: перемещение в ту же позицию-ячейку — бессмысленно, отклоняем (числовое сравнение).
      if (fromWh === toWh && fromLoc === toLoc) {
        await client.query('ROLLBACK'); return bad(reply, 'Источник и назначение совпадают');
      }
      // C7: целевая ячейка не должна быть удалена/неактивна.
      if (toLoc) {
        const lc = await client.query('SELECT 1 FROM warehouse_locations WHERE id=$1 AND deleted_at IS NULL AND is_active=true', [toLoc]);
        if (!lc.rows[0]) { await client.query('ROLLBACK'); return bad(reply, 'Целевая ячейка не найдена или неактивна', 409); }
      }
      // Списываем строго по порядку (product_id,wh,loc) — детерминированный порядок локов исключает deadlock.
      await applyDelta(client, { product_id, warehouse_id: fromWh, location_id: fromLoc, delta: -q, unit, respectReserved: true });
      await applyDelta(client, { product_id, warehouse_id: toWh, location_id: toLoc, delta: q, unit });
      await logMove(client, { product_id, from_warehouse_id: fromWh, from_location_id: fromLoc, to_warehouse_id: toWh, to_location_id: toLoc,
        qty: q, unit, movement_type: 'transfer', reason, created_by: req.user.id });
      await client.query('COMMIT');
      return { success: true };
    } catch (e) {
      await client.query('ROLLBACK');
      if (e.code === 'INSUFFICIENT') return bad(reply, 'Недостаточно остатка для перемещения', 409);
      if (e.code === 'RESERVED') return bad(reply, `Нельзя переместить: часть зарезервирована. Доступно: ${e.available}`, 409);
      throw e;
    } finally { client.release(); }
  });

  // Журнал движений
  fastify.get('/movements', { preHandler: [fastify.requireRoles(WMS_READ)] }, async (req) => {
    const { product_id, movement_type, limit = 100, offset = 0 } = req.query;
    let sql = `SELECT m.*, p.name AS product_name, u.name AS created_by_name,
      fw.name AS from_wh_name, tw.name AS to_wh_name, fl.label AS from_loc, tl.label AS to_loc
      FROM stock_movements m JOIN products p ON m.product_id=p.id
      LEFT JOIN users u ON m.created_by=u.id
      LEFT JOIN warehouses fw ON m.from_warehouse_id=fw.id LEFT JOIN warehouses tw ON m.to_warehouse_id=tw.id
      LEFT JOIN warehouse_locations fl ON m.from_location_id=fl.id LEFT JOIN warehouse_locations tl ON m.to_location_id=tl.id
      WHERE 1=1`;
    const pr = []; let i = 1;
    if (product_id) { sql += ` AND m.product_id=$${i++}`; pr.push(product_id); }
    if (movement_type) { sql += ` AND m.movement_type=$${i++}`; pr.push(movement_type); }
    sql += ` ORDER BY m.created_at DESC LIMIT $${i++} OFFSET $${i++}`;
    pr.push(Math.min(parseInt(limit), 500), parseInt(offset));
    const { rows } = await db.query(sql, pr);
    return { items: rows };
  });

  // Богатая карточка товара: позиция + наличие по слотам + последние движения + последняя цена.
  fastify.get('/product/:id/card', { preHandler: [fastify.requireRoles(WMS_READ)] }, async (req, reply) => {
    const pid = parseInt(req.params.id); if (isNaN(pid)) return bad(reply, 'Неверный ID');
    const prod = await db.query(`SELECT p.*, c.name AS category_name FROM products p
      LEFT JOIN product_categories c ON p.category_id=c.id WHERE p.id=$1 AND p.deleted_at IS NULL`, [pid]);
    if (!prod.rows[0]) return bad(reply, 'Не найден', 404);
    const slots = await db.query(`SELECT s.quantity, s.reserved_qty, s.unit, w.name AS warehouse_name, l.label AS location_label
      FROM stock s LEFT JOIN warehouses w ON s.warehouse_id=w.id LEFT JOIN warehouse_locations l ON s.location_id=l.id
      WHERE s.product_id=$1 AND s.quantity>0 ORDER BY w.name, l.label`, [pid]);
    const moves = await db.query(`SELECT m.movement_type, m.qty, m.unit, m.reason, m.created_at, u.name AS by_name
      FROM stock_movements m LEFT JOIN users u ON m.created_by=u.id WHERE m.product_id=$1 ORDER BY m.created_at DESC LIMIT 15`, [pid]);
    let lastPrice = null;
    try { const lp = await db.query('SELECT unit_price, supplier_name, recorded_at FROM v_last_price_by_product WHERE product_id=$1', [pid]); lastPrice = lp.rows[0] || null; } catch (_) {}
    const total = slots.rows.reduce((a, r) => a + parseFloat(r.quantity), 0);
    return { item: prod.rows[0], total, slots: slots.rows, movements: moves.rows, last_price: lastPrice };
  });

  // Загрузка фото товара (multipart) или по URL.
  fastify.post('/product/:id/photo', { preHandler: [fastify.requireRoles(QUICK_CREATE)] }, async (req, reply) => {
    const path = require('path'); const fsp = require('fs').promises; const { randomUUID } = require('crypto');
    const pid = parseInt(req.params.id); if (isNaN(pid)) return bad(reply, 'Неверный ID');
    const ct = req.headers['content-type'] || '';
    if (ct.includes('multipart/form-data')) {
      const data = await req.file(); if (!data) return bad(reply, 'Загрузите фото');
      const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
      const ext = path.extname(data.filename || '').toLowerCase() || '.jpg';
      if (!allowed.includes(ext)) return bad(reply, 'Форматы: jpg, png, gif, webp');
      const dir = path.join(process.env.UPLOAD_DIR || './uploads', 'products');
      await fsp.mkdir(dir, { recursive: true });
      const fn = `prod_${pid}_${randomUUID()}${ext}`;
      await fsp.writeFile(path.join(dir, fn), await data.toBuffer());
      const photo_url = '/uploads/products/' + fn;
      await db.query('UPDATE products SET photo_url=$1, updated_at=NOW() WHERE id=$2', [photo_url, pid]);
      return { success: true, photo_url };
    }
    const { photo_url } = req.body || {};
    if (photo_url) { await db.query('UPDATE products SET photo_url=$1, updated_at=NOW() WHERE id=$2', [photo_url, pid]); return { success: true, photo_url }; }
    return bad(reply, 'Нет файла или photo_url');
  });
}

module.exports = routes;
