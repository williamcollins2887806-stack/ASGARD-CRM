'use strict';
/**
 * АСГАРД CRM — Корзина склада (маркетплейс). Регистрируется под /api/warehouse-cart.
 *
 * РП накликивает позиции из каталога/оборудования на странице склада (#/warehouse-v2),
 * открывает корзину (персистентную, одна на пользователя), указывает количества, может
 * добавить вручную (проверка по каталогу) или прикрепить Excel (парс+сопоставление).
 * На submit система ПЕРЕПРОВЕРЯЕТ остатки (FOR UPDATE) и АВТО-РАЗБИВАЕТ:
 *   наличие → резерв на складе (stock.reserved_qty + stock_reservations),
 *   дефицит + новые позиции → ОДНА заявка закупщику (procurement_requests + procurement_items),
 *   оборудование → батч equipment_requests.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const { randomUUID } = require('crypto');
const { reserveStock } = require('../utils/stock-ops');
const { parseProcurementExcel } = require('../utils/excel-parser');

// Кто пользуется корзиной (РП + кладовщик + закупка + руководители)
const CART_ROLES = ['PM', 'HEAD_PM', 'WAREHOUSE', 'PROC', 'ADMIN', 'CHIEF_ENGINEER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
const SEGMENTS = ['cheap', 'medium', 'premium'];

async function routes(fastify) {
  const db = fastify.db;
  const { createNotification } = require('../services/notify');
  const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });
  const num = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };

  async function mainWarehouseId(client) {
    const r = await (client || db).query("SELECT id FROM warehouses WHERE is_main=true AND is_active=true ORDER BY id LIMIT 1");
    return r.rows[0]?.id || null;
  }

  // upsert продукта по имени (как ensureCatalogProduct в procurement.js) — для новых позиций
  async function ensureProduct(c, { name, unit, article, userId }) {
    const nm = (name || '').trim(); if (!nm) return null;
    const r = await c.query('SELECT id FROM products WHERE lower(name)=lower($1) AND deleted_at IS NULL LIMIT 1', [nm]);
    if (r.rows[0]) return r.rows[0].id;
    try {
      const ins = await c.query(
        "INSERT INTO products(name,article,unit,created_from,created_by) VALUES($1,$2,$3,'procurement',$4) RETURNING id",
        [nm, article || null, unit || 'шт', userId || null]);
      return ins.rows[0].id;
    } catch (e) {
      if (e.code === '23505') { const x = await c.query('SELECT id FROM products WHERE lower(name)=lower($1) AND deleted_at IS NULL LIMIT 1', [nm]); return x.rows[0]?.id || null; }
      throw e;
    }
  }

  // Получить корзину пользователя (id) или null
  async function getCart(client, userId) {
    const r = await (client || db).query('SELECT * FROM warehouse_cart WHERE user_id=$1', [userId]);
    return r.rows[0] || null;
  }

  // Снимок остатка/цены товара (на момент добавления)
  async function snapshotProduct(client, productId, warehouseId) {
    const s = await client.query(
      'SELECT COALESCE(SUM(quantity - reserved_qty),0) AS available FROM stock WHERE product_id=$1' + (warehouseId ? ' AND warehouse_id=$2' : ''),
      warehouseId ? [productId, warehouseId] : [productId]);
    const p = await client.query('SELECT unit_price, supplier_name FROM v_last_price_by_product WHERE product_id=$1', [productId]);
    return {
      available: parseFloat(s.rows[0].available) || 0,
      price: p.rows[0] ? p.rows[0].unit_price : null,
      supplier: p.rows[0] ? p.rows[0].supplier_name : null,
    };
  }

  // Полная корзина с live-данными (для ответа всех мутаций)
  async function cartPayload(client, userId) {
    const cart = await getCart(client, userId);
    if (!cart) return { cart: null, items: [] };
    const { rows } = await client.query(`
      SELECT ci.*,
        COALESCE(p.name, e.name, ci.custom_name) AS name,
        p.article, COALESCE(p.unit, 'шт') AS unit, p.photo_url,
        COALESCE((SELECT SUM(s.quantity - s.reserved_qty) FROM stock s WHERE s.product_id=ci.product_id), 0) AS available_qty,
        lp.unit_price AS last_price, lp.supplier_name AS last_supplier
      FROM warehouse_cart_items ci
      LEFT JOIN products p   ON p.id = ci.product_id
      LEFT JOIN equipment e  ON e.id = ci.equipment_id
      LEFT JOIN v_last_price_by_product lp ON lp.product_id = ci.product_id
      WHERE ci.cart_id = $1
      ORDER BY ci.added_at`, [cart.id]);
    return { cart: { id: cart.id, warehouse_id: cart.warehouse_id, updated_at: cart.updated_at }, items: rows };
  }

  // ── GET / — корзина пользователя ──────────────────────────────────────────
  fastify.get('/', { preHandler: [fastify.requireRoles(CART_ROLES)] }, async (req) => {
    return cartPayload(db, req.user.id);
  });

  // ── POST /items — добавить одну/несколько позиций ─────────────────────────
  fastify.post('/items', { preHandler: [fastify.requireRoles(CART_ROLES)] }, async (req, reply) => {
    const items = (req.body && req.body.items) || [];
    if (!Array.isArray(items) || !items.length) return bad(reply, 'items обязателен');
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const wh = req.body.warehouse_id || await mainWarehouseId(client);
      const cu = await client.query(
        `INSERT INTO warehouse_cart(user_id,warehouse_id) VALUES($1,$2)
         ON CONFLICT (user_id) DO UPDATE SET updated_at=NOW(), warehouse_id=COALESCE(warehouse_cart.warehouse_id,EXCLUDED.warehouse_id)
         RETURNING id, warehouse_id`, [req.user.id, wh]);
      const cartId = cu.rows[0].id, cartWh = cu.rows[0].warehouse_id;
      for (const it of items) {
        const type = ['consumable', 'equipment', 'new_position'].includes(it.item_type) ? it.item_type : null;
        if (!type) continue;
        const needQty = num(it.need_qty) || 1;
        const seg = SEGMENTS.includes(it.price_segment) ? it.price_segment : null;
        const src = ['catalog', 'manual', 'excel'].includes(it.source) ? it.source : 'catalog';
        let snap = { available: null, price: null, supplier: null };
        if (it.product_id) snap = await snapshotProduct(client, it.product_id, cartWh);
        if (type === 'consumable' && it.product_id) {
          await client.query(`INSERT INTO warehouse_cart_items
            (cart_id,item_type,product_id,need_qty,work_id,price_segment,supplier_name,snapshot_available,snapshot_price,snapshot_supplier,source)
            VALUES($1,'consumable',$2,$3,$4,$5,$6,$7,$8,$9,$10)
            ON CONFLICT (cart_id,product_id) WHERE product_id IS NOT NULL
            DO UPDATE SET need_qty=EXCLUDED.need_qty, snapshot_available=EXCLUDED.snapshot_available, snapshot_price=EXCLUDED.snapshot_price`,
            [cartId, it.product_id, needQty, it.work_id || null, seg, snap.supplier, snap.available, snap.price, snap.supplier, src]);
        } else if (type === 'equipment' && it.equipment_id) {
          await client.query(`INSERT INTO warehouse_cart_items(cart_id,item_type,equipment_id,need_qty,work_id,source)
            VALUES($1,'equipment',$2,$3,$4,$5)
            ON CONFLICT (cart_id,equipment_id) WHERE equipment_id IS NOT NULL
            DO UPDATE SET need_qty=EXCLUDED.need_qty`,
            [cartId, it.equipment_id, needQty, it.work_id || null, src]);
        } else if (type === 'new_position' && (it.custom_name || '').trim()) {
          await client.query(`INSERT INTO warehouse_cart_items
            (cart_id,item_type,custom_name,need_qty,work_id,price_segment,manual_price,supplier_name,is_new_position,source)
            VALUES($1,'new_position',$2,$3,$4,$5,$6,$7,true,$8)`,
            [cartId, it.custom_name.trim(), needQty, it.work_id || null, seg, num(it.manual_price), it.supplier_name || null, src]);
        }
      }
      await client.query('UPDATE warehouse_cart SET updated_at=NOW() WHERE id=$1', [cartId]);
      await client.query('COMMIT');
      return cartPayload(db, req.user.id);
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  });

  // ── PUT /items/:id — обновить позицию ─────────────────────────────────────
  fastify.put('/items/:id', { preHandler: [fastify.requireRoles(CART_ROLES)] }, async (req, reply) => {
    const id = parseInt(req.params.id); if (isNaN(id)) return bad(reply, 'Неверный ID');
    const own = await db.query(
      'SELECT ci.id FROM warehouse_cart_items ci JOIN warehouse_cart c ON c.id=ci.cart_id WHERE ci.id=$1 AND c.user_id=$2', [id, req.user.id]);
    if (!own.rows[0]) return bad(reply, 'Позиция не найдена', 404);
    const fields = []; const vals = []; let i = 1;
    const b = req.body || {};
    if (b.need_qty !== undefined) { const q = num(b.need_qty); if (q && q > 0) { fields.push(`need_qty=$${i++}`); vals.push(q); } }
    if (b.work_id !== undefined) { fields.push(`work_id=$${i++}`); vals.push(b.work_id || null); }
    if (b.price_segment !== undefined) { fields.push(`price_segment=$${i++}`); vals.push(SEGMENTS.includes(b.price_segment) ? b.price_segment : null); }
    if (b.manual_price !== undefined) { fields.push(`manual_price=$${i++}`); vals.push(num(b.manual_price)); }
    if (b.supplier_name !== undefined) { fields.push(`supplier_name=$${i++}`); vals.push(b.supplier_name || null); }
    if (!fields.length) return bad(reply, 'Нет данных для обновления');
    vals.push(id);
    await db.query(`UPDATE warehouse_cart_items SET ${fields.join(',')} WHERE id=$${i}`, vals);
    await db.query('UPDATE warehouse_cart c SET updated_at=NOW() FROM warehouse_cart_items ci WHERE ci.id=$1 AND ci.cart_id=c.id', [id]);
    return cartPayload(db, req.user.id);
  });

  // ── DELETE /items/:id — убрать позицию ────────────────────────────────────
  fastify.delete('/items/:id', { preHandler: [fastify.requireRoles(CART_ROLES)] }, async (req, reply) => {
    const id = parseInt(req.params.id); if (isNaN(id)) return bad(reply, 'Неверный ID');
    const own = await db.query(
      'SELECT ci.cart_id FROM warehouse_cart_items ci JOIN warehouse_cart c ON c.id=ci.cart_id WHERE ci.id=$1 AND c.user_id=$2', [id, req.user.id]);
    if (!own.rows[0]) return bad(reply, 'Позиция не найдена', 404);
    const cartId = own.rows[0].cart_id;
    await db.query('DELETE FROM warehouse_cart_items WHERE id=$1', [id]);
    const cnt = await db.query('SELECT COUNT(*)::int AS n FROM warehouse_cart_items WHERE cart_id=$1', [cartId]);
    if (cnt.rows[0].n === 0) await db.query('DELETE FROM warehouse_cart WHERE id=$1', [cartId]);
    return cartPayload(db, req.user.id);
  });

  // ── DELETE / — очистить корзину ───────────────────────────────────────────
  fastify.delete('/', { preHandler: [fastify.requireRoles(CART_ROLES)] }, async (req) => {
    await db.query('DELETE FROM warehouse_cart WHERE user_id=$1', [req.user.id]);
    return { success: true };
  });

  // ── POST /add-manual — поиск по каталогу для ручного добавления ────────────
  fastify.post('/add-manual', { preHandler: [fastify.requireRoles(CART_ROLES)] }, async (req) => {
    const name = ((req.body && req.body.name) || '').trim();
    if (name.length < 2) return { matches: [] };
    const cart = await getCart(db, req.user.id);
    const wh = (cart && cart.warehouse_id) || await mainWarehouseId(db);
    const { rows } = await db.query(`
      SELECT p.id, p.name, p.article, p.unit,
        COALESCE((SELECT SUM(s.quantity - s.reserved_qty) FROM stock s WHERE s.product_id=p.id),0) AS available_qty,
        lp.unit_price AS last_price, lp.supplier_name AS last_supplier
      FROM products p
      LEFT JOIN v_last_price_by_product lp ON lp.product_id=p.id
      WHERE p.deleted_at IS NULL AND p.is_active=true
        AND (p.name ILIKE $1 OR p.article ILIKE $1)
      ORDER BY p.name LIMIT 8`, ['%' + name + '%']);
    return { matches: rows, warehouse_id: wh };
  });

  // ── POST /parse-excel — Excel → строки с сопоставлением каталогу ───────────
  fastify.post('/parse-excel', { preHandler: [fastify.requireRoles(CART_ROLES)] }, async (req, reply) => {
    const data = await req.file(); if (!data) return bad(reply, 'Файл не загружен');
    let buf; try { buf = await data.toBuffer(); } catch (_) { return bad(reply, 'Не удалось прочитать файл'); }
    let parsed; try { parsed = await parseProcurementExcel(buf); } catch (_) { return bad(reply, 'Не удалось прочитать Excel'); }
    if (!parsed.length) return bad(reply, 'Не найдено позиций в таблице');
    const cart = await getCart(db, req.user.id);
    const wh = (cart && cart.warehouse_id) || await mainWarehouseId(db);
    const out = [];
    for (const it of parsed) {
      const nm = (it.name || '').trim(); if (!nm) continue;
      const m = await db.query(`
        SELECT p.id, p.unit,
          COALESCE((SELECT SUM(s.quantity - s.reserved_qty) FROM stock s WHERE s.product_id=p.id),0) AS available_qty,
          lp.unit_price AS last_price, lp.supplier_name AS last_supplier
        FROM products p LEFT JOIN v_last_price_by_product lp ON lp.product_id=p.id
        WHERE p.deleted_at IS NULL AND (lower(p.name)=lower($1) OR (p.article IS NOT NULL AND $2<>'' AND lower(p.article)=lower($2)))
        LIMIT 1`, [nm, it.article || '']);
      if (m.rows[0]) {
        out.push({ name: nm, article: it.article || '', quantity: it.quantity || 1, unit: m.rows[0].unit || it.unit || 'шт',
          unit_price: it.unit_price != null ? it.unit_price : m.rows[0].last_price, supplier_name: it.supplier_name || m.rows[0].last_supplier,
          matched: true, product_id: m.rows[0].id, available_qty: parseFloat(m.rows[0].available_qty) || 0,
          last_price: m.rows[0].last_price, is_new_position: false });
      } else {
        out.push({ name: nm, article: it.article || '', quantity: it.quantity || 1, unit: it.unit || 'шт',
          unit_price: it.unit_price, supplier_name: it.supplier_name || null,
          matched: false, product_id: null, available_qty: 0, last_price: null, is_new_position: true });
      }
    }
    return { rows: out, warehouse_id: wh };
  });

  // Внутренний расчёт разбивки корзины (используется preview и submit).
  // forUpdate: предварительно лочим stock-строки расходников отдельным SELECT FOR UPDATE
  // (нельзя FOR UPDATE на nullable-side LEFT JOIN), затем читаем агрегированную картину.
  async function loadSplit(client, userId, globalWorkId, forUpdate) {
    const cart = await getCart(client, userId);
    if (!cart) return { cart: null, items: [] };
    if (forUpdate) {
      // лочим stock-строки только для consumable-позиций корзины
      await client.query(`
        SELECT s.id FROM stock s
        WHERE s.warehouse_id = $2 AND s.product_id IN (
          SELECT ci.product_id FROM warehouse_cart_items ci
          WHERE ci.cart_id = $1 AND ci.item_type='consumable' AND ci.product_id IS NOT NULL
        ) FOR UPDATE`, [cart.id, cart.warehouse_id]);
    }
    const { rows } = await client.query(`
      SELECT ci.*, COALESCE(p.name, e.name, ci.custom_name) AS name, p.unit AS product_unit,
        s.id AS stock_id, s.quantity, s.reserved_qty,
        (COALESCE(s.quantity,0) - COALESCE(s.reserved_qty,0)) AS available_now,
        lp.unit_price AS last_price, lp.supplier_name AS last_supplier
      FROM warehouse_cart_items ci
      LEFT JOIN products p  ON p.id = ci.product_id
      LEFT JOIN equipment e ON e.id = ci.equipment_id
      LEFT JOIN stock s     ON s.product_id = ci.product_id AND s.warehouse_id = $2
      LEFT JOIN v_last_price_by_product lp ON lp.product_id = ci.product_id
      WHERE ci.cart_id = $1`, [cart.id, cart.warehouse_id]);
    return { cart, items: rows };
  }

  // ── POST /preview-submit — разбивка (read-only, без записи) ────────────────
  fastify.post('/preview-submit', { preHandler: [fastify.requireRoles(CART_ROLES)] }, async (req, reply) => {
    const globalWork = (req.body && req.body.global_work_id) || null;
    const { cart, items } = await loadSplit(db, req.user.id, globalWork, false);
    if (!cart) return bad(reply, 'Корзина пуста', 404);
    const reserve_lines = [], procure_lines = [], equipment_lines = [];
    for (const it of items) {
      const work = globalWork || it.work_id || null;
      if (it.item_type === 'equipment') {
        const ea = await db.query("SELECT COUNT(*)::int AS n FROM equipment WHERE id=$1 AND status='on_warehouse'", [it.equipment_id]);
        equipment_lines.push({ cart_item_id: it.id, name: it.name, available: ea.rows[0].n, need: parseFloat(it.need_qty), work_id: work });
      } else {
        const need = parseFloat(it.need_qty);
        const avail = Math.max(0, parseFloat(it.available_now) || 0);
        const reserve = it.is_new_position ? 0 : Math.min(need, avail);
        const deficit = need - reserve;
        if (reserve > 0) reserve_lines.push({ cart_item_id: it.id, name: it.name, unit: it.product_unit || 'шт', reserve_qty: reserve, available: avail, work_id: work });
        if (deficit > 0) procure_lines.push({ cart_item_id: it.id, name: it.name, unit: it.product_unit || 'шт', deficit_qty: deficit,
          last_price: it.is_new_position ? it.manual_price : it.last_price, last_supplier: it.is_new_position ? it.supplier_name : it.last_supplier,
          price_segment: it.price_segment, is_new_position: it.is_new_position });
      }
    }
    return { reserve_lines, procure_lines, equipment_lines };
  });

  // ── POST /submit — главная транзакция (перепроверка + авто-разбивка) ───────
  fastify.post('/submit', { preHandler: [fastify.requireRoles(CART_ROLES)] }, async (req, reply) => {
    const globalWork = (req.body && req.body.global_work_id) || null;
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const { cart, items } = await loadSplit(client, req.user.id, globalWork, true);
      if (!cart || !items.length) { await client.query('ROLLBACK'); return bad(reply, 'Корзина пуста', 404); }

      // 1) Перепроверка остатков: вернулось меньше, чем при добавлении
      const changed = [];
      for (const it of items) {
        if (it.item_type !== 'consumable' || it.is_new_position) continue;
        const now = Math.max(0, parseFloat(it.available_now) || 0);
        const snap = it.snapshot_available != null ? parseFloat(it.snapshot_available) : null;
        if (snap != null && now < snap) changed.push({ cart_item_id: it.id, name: it.name, snapshot_available: snap, new_available: now });
      }
      if (changed.length) { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'stock_changed', changed }); }

      const reservations = [];
      const procureLines = [];   // дефицит + новые позиции + дефицит оборудования (как текст)
      const equipIds = [];

      for (const it of items) {
        const work = globalWork || it.work_id || null;
        if (it.item_type === 'equipment') {
          equipIds.push({ id: it.equipment_id, name: it.name, need: parseFloat(it.need_qty), work });
          continue;
        }
        const need = parseFloat(it.need_qty);
        if (it.is_new_position || !it.product_id) {
          procureLines.push({ name: it.name, qty: need, unit_price: it.manual_price, supplier: it.supplier_name, segment: it.price_segment, work, product_id: null });
          continue;
        }
        const avail = Math.max(0, parseFloat(it.available_now) || 0);
        const reserve = Math.min(need, avail);
        const deficit = need - reserve;
        if (reserve > 0) {
          const r = await reserveStock(client, { product_id: it.product_id, warehouse_id: cart.warehouse_id, qty: reserve,
            work_id: work, reserved_by: req.user.id, notes: 'Резерв из корзины РП' });
          reservations.push({ product_id: it.product_id, name: it.name, reserve_qty: reserve, reservation_id: r.reservation_id });
        }
        if (deficit > 0) procureLines.push({ name: it.name, qty: deficit, unit_price: it.last_price, supplier: it.last_supplier, segment: it.price_segment, work, product_id: it.product_id });
      }

      // 2) Оборудование → батч equipment_requests (FOR UPDATE проверка занятости)
      let equipBatchId = null;
      if (equipIds.length) {
        const ids = equipIds.map(e => e.id);
        const lock = await client.query("SELECT id, name, status FROM equipment WHERE id = ANY($1) FOR UPDATE", [ids]);
        const taken = [];
        for (const e of lock.rows) {
          if (e.status !== 'on_warehouse') { taken.push(e.name); continue; }
          const act = await client.query("SELECT 1 FROM equipment_reservations WHERE equipment_id=$1 AND status='active' LIMIT 1", [e.id]);
          const pend = await client.query("SELECT 1 FROM equipment_requests WHERE equipment_id=$1 AND status='pending' LIMIT 1", [e.id]);
          if (act.rows[0] || pend.rows[0]) taken.push(e.name);
        }
        if (taken.length) { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'equipment_taken', taken }); }
        equipBatchId = randomUUID();
        const eqWork = globalWork || equipIds[0].work || null;
        for (const e of equipIds) {
          await client.query(
            `INSERT INTO equipment_requests(equipment_id,requester_id,batch_id,work_id,request_type,status,notes)
             VALUES($1,$2,$3,$4,'issue','pending',$5)`,
            [e.id, req.user.id, equipBatchId, e.work || eqWork, 'Из корзины склада']);
        }
      }

      // 3) Дефицит + новые позиции → ОДНА заявка закупщику
      let procurementId = null;
      if (procureLines.length) {
        const seg = procureLines.find(l => l.segment)?.segment || null;
        const pr = await client.query(
          `INSERT INTO procurement_requests(work_id,title,price_segment,status,author_id,pm_id)
           VALUES($1,$2,$3,'sent_to_proc',$4,$4) RETURNING id`,
          [globalWork, 'Заявка из корзины склада — ' + new Date().toLocaleDateString('ru-RU'), seg, req.user.id]);
        procurementId = pr.rows[0].id;
        // назначить закупщика
        const pu = await client.query("SELECT id FROM users WHERE role='PROC' AND is_active=true ORDER BY id LIMIT 1");
        if (pu.rows[0]) await client.query('UPDATE procurement_requests SET proc_id=$1 WHERE id=$2', [pu.rows[0].id, procurementId]);
        // позиции bulk
        const n = [], q = [], pp = [], tt = [], sup = [], pid = [], rw = [];
        for (const l of procureLines) {
          let p2 = l.product_id;
          if (!p2) { try { p2 = await ensureProduct(client, { name: l.name, userId: req.user.id }); } catch (_) { p2 = null; } }
          const price = num(l.unit_price);
          n.push(l.name); q.push(l.qty); pp.push(price); tt.push(price ? price * l.qty : null);
          sup.push(l.supplier || null); pid.push(p2); rw.push(l.work || null);
        }
        await client.query(`INSERT INTO procurement_items(procurement_id,name,quantity,unit_price,total_price,supplier,product_id,recipient_work_id,delivery_target)
          SELECT $1,unnest($2::text[]),unnest($3::numeric[]),unnest($4::numeric[]),unnest($5::numeric[]),unnest($6::text[]),unnest($7::int[]),unnest($8::int[]),'warehouse'`,
          [procurementId, n, q, pp, tt, sup, pid, rw]);
        // привязать резервы к заявке (информативно)
        if (reservations.length) {
          await client.query('UPDATE stock_reservations SET procurement_id=$1 WHERE id = ANY($2)', [procurementId, reservations.map(r => r.reservation_id)]);
        }
        // уведомить закупщиков
        const pus = await client.query("SELECT id FROM users WHERE role='PROC' AND is_active=true");
        for (const p of pus.rows) createNotification(db, { user_id: p.id, title: `🛒 Заявка #${procurementId}`,
          message: `Со склада (${req.user.name || ''}): ${procureLines.length} поз. на докупку`, type: 'procurement', link: `#/procurement?id=${procurementId}` });
      }

      // 4) Очистить корзину
      await client.query('DELETE FROM warehouse_cart WHERE id=$1', [cart.id]);
      await client.query('COMMIT');
      return { success: true, reservations, procurement_id: procurementId, equipment_batch_id: equipBatchId };
    } catch (e) {
      await client.query('ROLLBACK');
      if (e.code === 'RESERVED') return bad(reply, 'Остаток изменился во время отправки, повторите', 409);
      throw e;
    } finally { client.release(); }
  });
}

module.exports = routes;
