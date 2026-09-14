'use strict';
/**
 * WMS operations: sessions (receive/putaway/pick/inventory/unpick), scan confirm, cell history.
 * Prefix: /api/warehouse-ops
 */

const WMS_WRITE = ['ADMIN', 'WAREHOUSE', 'CHIEF_ENGINEER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
const WMS_READ = [...WMS_WRITE, 'PM', 'HEAD_PM', 'PROC', 'BUH'];
const SESSION_TYPES = ['receive','putaway','pick','inventory','unpick'];

async function routes(fastify) {
  const db = fastify.db;
  const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });

  // ── Sessions list ─────────────────────────────────────────────────────────
  fastify.get('/sessions', { preHandler: [fastify.requireRoles(WMS_READ)] }, async (req) => {
    const { warehouse_id, status, session_type, assembly_id, limit = 50 } = req.query;
    let sql = `SELECT s.*, u.name AS opened_by_name FROM warehouse_op_sessions s
      LEFT JOIN users u ON u.id=s.opened_by WHERE 1=1`;
    const p = []; let i = 1;
    if (warehouse_id) { sql += ` AND s.warehouse_id=$${i++}`; p.push(warehouse_id); }
    if (status) { sql += ` AND s.status=$${i++}`; p.push(status); }
    if (session_type) { sql += ` AND s.session_type=$${i++}`; p.push(session_type); }
    if (assembly_id) { sql += ` AND s.assembly_id=$${i++}`; p.push(assembly_id); }
    sql += ` ORDER BY s.opened_at DESC LIMIT $${i++}`;
    p.push(Math.min(parseInt(limit, 10) || 50, 200));
    const { rows } = await db.query(sql, p);
    return { items: rows };
  });

  fastify.get('/sessions/:id', { preHandler: [fastify.requireRoles(WMS_READ)] }, async (req, reply) => {
    const s = await db.query(`SELECT * FROM warehouse_op_sessions WHERE id=$1`, [req.params.id]);
    if (!s.rows[0]) return bad(reply, 'Сессия не найдена', 404);
    const items = await db.query(
      `SELECT i.*,
        COALESCE(p.name, e.name) AS item_name,
        l.label AS location_label, l.place_code,
        tl.label AS target_label, tl.place_code AS target_place_code
       FROM warehouse_op_session_items i
       LEFT JOIN products p ON p.id=i.product_id
       LEFT JOIN equipment e ON e.id=i.equipment_id
       LEFT JOIN warehouse_locations l ON l.id=i.location_id
       LEFT JOIN warehouse_locations tl ON tl.id=i.target_location_id
       WHERE i.session_id=$1 ORDER BY i.line_no, i.id`, [req.params.id]);
    return { session: s.rows[0], items: items.rows };
  });

  fastify.post('/sessions', { preHandler: [fastify.requireRoles(WMS_WRITE)] }, async (req, reply) => {
    const b = req.body || {};
    if (!b.warehouse_id || !b.session_type) return bad(reply, 'warehouse_id и session_type обязательны');
    if (!SESSION_TYPES.includes(b.session_type)) return bad(reply, 'Неизвестный session_type');
    const { rows } = await db.query(
      `INSERT INTO warehouse_op_sessions(warehouse_id,session_type,title,assembly_id,document_ref,meta_json,opened_by,device)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING *`,
      [b.warehouse_id, b.session_type, b.title || null, b.assembly_id || null,
       b.document_ref || null, JSON.stringify(b.meta_json || {}), req.user.id, b.device || 'crm']);
    const session = rows[0];
    const lines = Array.isArray(b.items) ? b.items : [];
    const created = [];
    let n = 1;
    for (const it of lines) {
      const r = await db.query(
        `INSERT INTO warehouse_op_session_items(
           session_id,line_no,track_type,product_id,equipment_id,assembly_item_id,
           location_id,target_location_id,planned_qty,unit,meta_json)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) RETURNING *`,
        [session.id, n++, it.track_type || (it.equipment_id ? 'piece' : 'consumable'),
         it.product_id || null, it.equipment_id || null, it.assembly_item_id || null,
         it.location_id || null, it.target_location_id || null,
         it.planned_qty ?? null, it.unit || 'шт', JSON.stringify(it.meta_json || {})]);
      created.push(r.rows[0]);
    }
    return { session, items: created };
  });

  fastify.post('/sessions/:id/close', { preHandler: [fastify.requireRoles(WMS_WRITE)] }, async (req, reply) => {
    const id = req.params.id;
    const pending = await db.query(
      `SELECT COUNT(*)::int AS n FROM warehouse_op_session_items WHERE session_id=$1 AND status IN ('pending','locked')`, [id]);
    if (pending.rows[0].n > 0 && !(req.body && req.body.force)) {
      return bad(reply, `Есть незакрытые строки: ${pending.rows[0].n}`, 409);
    }
    const { rows } = await db.query(
      `UPDATE warehouse_op_sessions SET status='closed', closed_by=$1, closed_at=NOW() WHERE id=$2 AND status='open' RETURNING *`,
      [req.user.id, id]);
    if (!rows[0]) return bad(reply, 'Сессия не open', 409);
    return { session: rows[0] };
  });

  // ── Lock / unlock row (concurrent helpers) ────────────────────────────────
  fastify.post('/items/:id/lock', { preHandler: [fastify.requireRoles(WMS_WRITE)] }, async (req, reply) => {
    const id = req.params.id;
    const { rows } = await db.query(
      `UPDATE warehouse_op_session_items
       SET status='locked', locked_by=$1, locked_at=NOW(), lock_version=lock_version+1, device=$2
       WHERE id=$3 AND (
         status='pending' OR (status='locked' AND locked_by=$1)
       ) RETURNING *`,
      [req.user.id, (req.body && req.body.device) || 'crm', id]);
    if (!rows[0]) return bad(reply, 'Строка занята или уже закрыта', 409);
    return { item: rows[0] };
  });

  fastify.post('/items/:id/unlock', { preHandler: [fastify.requireRoles(WMS_WRITE)] }, async (req, reply) => {
    const { rows } = await db.query(
      `UPDATE warehouse_op_session_items SET status='pending', locked_by=NULL, locked_at=NULL
       WHERE id=$1 AND (locked_by=$2 OR $3=true) AND status='locked' RETURNING *`,
      [req.params.id, req.user.id, ['ADMIN','WAREHOUSE'].includes(req.user.role)]);
    if (!rows[0]) return bad(reply, 'Нельзя снять блок', 409);
    return { item: rows[0] };
  });

  /**
   * Confirm fact after place scan:
   * body: { location_id|place_code|qr_uuid, fact_qty?, equipment_qr|equipment_id?, reason_code?, device? }
   * piece: equipment scan required; consumable: fact_qty required.
   */
  fastify.post('/items/:id/confirm', { preHandler: [fastify.requireRoles(WMS_WRITE)] }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const b = req.body || {};
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const itQ = await client.query(`SELECT i.*, s.session_type, s.warehouse_id, s.assembly_id
        FROM warehouse_op_session_items i JOIN warehouse_op_sessions s ON s.id=i.session_id
        WHERE i.id=$1 FOR UPDATE OF i`, [id]);
      const it = itQ.rows[0];
      if (!it) { await client.query('ROLLBACK'); return bad(reply, 'Строка не найдена', 404); }
      if (!['pending','locked','variance'].includes(it.status)) {
        await client.query('ROLLBACK'); return bad(reply, 'Строка уже закрыта', 409);
      }
      if (it.status === 'locked' && it.locked_by && it.locked_by !== req.user.id) {
        await client.query('ROLLBACK'); return bad(reply, 'Строка занята другим', 409);
      }

      let locationId = b.location_id || it.location_id || it.target_location_id;
      if (!locationId && b.place_code) {
        const lc = await client.query(
          `SELECT id FROM warehouse_locations WHERE warehouse_id=$1 AND deleted_at IS NULL
             AND UPPER(COALESCE(place_code,label,''))=UPPER($2) LIMIT 1`,
          [it.warehouse_id, b.place_code]);
        locationId = lc.rows[0]?.id;
      }
      if (!locationId && b.qr_uuid) {
        const lc = await client.query(
          `SELECT id FROM warehouse_locations WHERE qr_uuid=$1 AND deleted_at IS NULL LIMIT 1`, [b.qr_uuid]);
        locationId = lc.rows[0]?.id;
      }
      if (!locationId) { await client.query('ROLLBACK'); return bad(reply, 'Нужен скан QR места'); }

      let factQty = b.fact_qty != null ? parseFloat(b.fact_qty) : null;
      let equipmentId = it.equipment_id;

      if (it.track_type === 'piece') {
        if (b.equipment_id) equipmentId = b.equipment_id;
        if (b.equipment_qr) {
          const eq = await client.query(
            `SELECT id FROM equipment WHERE (qr_uuid::text=$1 OR inventory_number=$1 OR barcode=$1) AND deleted_at IS NULL LIMIT 1`,
            [String(b.equipment_qr)]);
          if (!eq.rows[0] && !b.force_list_pick) {
            await client.query('ROLLBACK'); return bad(reply, 'QR единицы не найден');
          }
          if (eq.rows[0]) equipmentId = eq.rows[0].id;
        }
        if (!equipmentId) { await client.query('ROLLBACK'); return bad(reply, 'Для piece нужен скан QR единицы'); }
        factQty = factQty == null ? 1 : factQty;
        // move equipment to location on putaway / from location on pick
        if (it.session_type === 'putaway' || it.session_type === 'receive') {
          await client.query(`UPDATE equipment SET location_id=$1, updated_at=NOW() WHERE id=$2`, [locationId, equipmentId]);
        } else if (it.session_type === 'pick' || it.session_type === 'unpick') {
          if (it.session_type === 'unpick') {
            await client.query(`UPDATE equipment SET location_id=$1, updated_at=NOW() WHERE id=$2`, [locationId, equipmentId]);
            if (it.assembly_item_id) {
              await client.query(
                `UPDATE assembly_items SET pallet_id=NULL, packed=false, line_status='pending', unpick_to_location_id=$1 WHERE id=$2`,
                [locationId, it.assembly_item_id]);
            }
          }
        }
      } else {
        // consumable
        if (factQty == null) factQty = it.planned_qty != null ? parseFloat(it.planned_qty) : null;
        if (factQty == null || Number.isNaN(factQty)) {
          await client.query('ROLLBACK'); return bad(reply, 'Укажите fact_qty / вес');
        }
        let productId = it.product_id;
        if (!productId) {
          let meta = it.meta_json;
          if (typeof meta === 'string') {
            try { meta = JSON.parse(meta); } catch (_) { meta = null; }
          }
          const nm = meta && meta.name ? String(meta.name).trim() : '';
          if (nm) {
            const pr = await client.query(
              `SELECT id FROM products WHERE deleted_at IS NULL AND lower(name)=lower($1) LIMIT 1`, [nm]);
            productId = pr.rows[0] && pr.rows[0].id;
            if (productId) {
              await client.query('UPDATE warehouse_op_session_items SET product_id=$1 WHERE id=$2', [productId, id]);
            }
          }
        }
        if (!productId && (it.session_type === 'receive' || it.session_type === 'putaway')) {
          await client.query('ROLLBACK');
          return bad(reply, 'Для приёмки/раскладки расходника нужен product_id (или имя из каталога в meta)');
        }
        if (productId && (it.session_type === 'putaway' || it.session_type === 'receive')) {
          await upsertStock(client, productId, it.warehouse_id, locationId, factQty, req.user.id, 'putaway', it.id);
        } else if (productId && (it.session_type === 'pick' || it.session_type === 'unpick')) {
          const sign = it.session_type === 'unpick' ? 1 : -1;
          await upsertStock(client, productId, it.warehouse_id, locationId, sign * Math.abs(factQty), req.user.id, it.session_type, it.id);
          if (it.session_type === 'unpick' && it.assembly_item_id) {
            await client.query(
              `UPDATE assembly_items SET pallet_id=NULL, packed=false, line_status='pending', unpick_to_location_id=$1 WHERE id=$2`,
              [locationId, it.assembly_item_id]);
          }
        }
      }

      const planned = it.planned_qty != null ? parseFloat(it.planned_qty) : null;
      let status = 'done';
      if (planned != null && Math.abs(planned - factQty) > 1e-6) status = 'variance';
      if (factQty === 0 && b.reason_code === 'missing') status = 'variance';

      const { rows } = await client.query(
        `UPDATE warehouse_op_session_items SET
           status=$1, location_id=COALESCE($2,location_id), fact_qty=$3, equipment_id=COALESCE($4,equipment_id),
           reason_code=$5, notes=COALESCE($6,notes), done_by=$7, done_at=NOW(), device=$8,
           locked_by=NULL, locked_at=NULL, lock_version=lock_version+1
         WHERE id=$9 RETURNING *`,
        [status, locationId, factQty, equipmentId, b.reason_code || null, b.notes || null,
         req.user.id, b.device || 'crm', id]);

      if (it.assembly_item_id && it.session_type === 'pick' && status === 'done') {
        await client.query(
          `UPDATE assembly_items SET packed=true, packed_at=NOW(), packed_by=$1, line_status='on_pallet',
             source_location_id=COALESCE(source_location_id,$2) WHERE id=$3`,
          [req.user.id, locationId, it.assembly_item_id]);
      }

      await client.query('COMMIT');
      return { item: rows[0], variance: status === 'variance' };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ── Cell history (missing-on-shelf) ───────────────────────────────────────
  fastify.get('/locations/:id/history', { preHandler: [fastify.requireRoles(WMS_READ)] }, async (req) => {
    const id = req.params.id;
    const moves = await db.query(
      `SELECT m.*, u.name AS user_name, p.name AS product_name
       FROM stock_movements m
       LEFT JOIN users u ON u.id=m.created_by
       LEFT JOIN products p ON p.id=m.product_id
       WHERE m.from_location_id=$1 OR m.to_location_id=$1
       ORDER BY m.created_at DESC LIMIT 100`, [id]).catch(() => ({ rows: [] }));
    const ops = await db.query(
      `SELECT i.*, s.session_type, s.title, u.name AS done_by_name
       FROM warehouse_op_session_items i
       JOIN warehouse_op_sessions s ON s.id=i.session_id
       LEFT JOIN users u ON u.id=i.done_by
       WHERE i.location_id=$1 OR i.target_location_id=$1
       ORDER BY COALESCE(i.done_at, i.created_at) DESC LIMIT 100`, [id]);
    const stock = await db.query(
      `SELECT s.*, p.name FROM stock s JOIN products p ON p.id=s.product_id WHERE s.location_id=$1 AND s.quantity<>0`, [id]);
    const equip = await db.query(
      `SELECT id, name, inventory_number, qr_uuid, status FROM equipment WHERE location_id=$1 AND deleted_at IS NULL`, [id]);
    // соседние ячейки того же стеллажа / map-object (подсказки «нет на полке»)
    const similar = await db.query(
      `SELECT l.id, l.place_code, l.label, l.rack, l.shelf, l.cell, l.zone,
         (SELECT COALESCE(SUM(s.quantity),0) FROM stock s WHERE s.location_id=l.id) AS stock_qty
       FROM warehouse_locations l
       JOIN warehouse_locations src ON src.id=$1
       WHERE l.deleted_at IS NULL AND l.id<>src.id
         AND l.warehouse_id=src.warehouse_id
         AND (
           (src.rack IS NOT NULL AND l.rack=src.rack)
           OR (src.map_object_id IS NOT NULL AND l.map_object_id=src.map_object_id)
         )
       ORDER BY l.shelf NULLS LAST, l.cell NULLS LAST, l.place_code NULLS LAST
       LIMIT 12`, [id]).catch(() => ({ rows: [] }));
    return { movements: moves.rows, op_items: ops.rows, stock: stock.rows, equipment: equip.rows, similar: similar.rows };
  });

  // ── Unpick queue for storekeeper ──────────────────────────────────────────
  fastify.get('/unpick-queue', { preHandler: [fastify.requireRoles(WMS_READ)] }, async (req) => {
    const { warehouse_id } = req.query;
    let sql = `SELECT ai.*, ao.title AS assembly_title, ao.work_id, ap.pallet_number, ap.label AS pallet_label,
        e.name AS equipment_name, p.name AS product_name
      FROM assembly_items ai
      JOIN assembly_orders ao ON ao.id=ai.assembly_id
      LEFT JOIN assembly_pallets ap ON ap.id=ai.pallet_id
      LEFT JOIN equipment e ON e.id=ai.equipment_id
      LEFT JOIN products p ON p.id=ai.product_id
      WHERE ai.line_status='unpick_requested' AND ao.status NOT IN ('closed','returned')`;
    const p = [];
    if (warehouse_id) { /* assembly not tied to wh directly — filter via meta later */ }
    sql += ' ORDER BY ai.id DESC LIMIT 200';
    const { rows } = await db.query(sql, p);
    return { items: rows };
  });

  fastify.post('/unpick-request', { preHandler: [fastify.requireRoles(WMS_READ)] }, async (req, reply) => {
    const { assembly_item_id, to_location_id } = req.body || {};
    if (!assembly_item_id) return bad(reply, 'assembly_item_id обязателен');
    const { rows } = await db.query(
      `UPDATE assembly_items SET line_status='unpick_requested', unpick_to_location_id=$1
       WHERE id=$2 AND (packed=true OR pallet_id IS NOT NULL) RETURNING *`,
      [to_location_id || null, assembly_item_id]);
    if (!rows[0]) return bad(reply, 'Позиция не на паллете', 409);
    // notify warehouse
    const whs = await db.query("SELECT id FROM users WHERE role='WAREHOUSE' AND is_active=true");
    for (const w of whs.rows) {
      try {
        const { createNotification } = require('../services/notify');
        createNotification(db, {
          user_id: w.id, title: '↩ Убрать с паллета',
          message: rows[0].name, type: 'assembly', link: '#/warehouse-v2'
        });
      } catch (_) {}
    }
    return { item: rows[0] };
  });

  // ── Inventory ─────────────────────────────────────────────────────────────
  fastify.post('/inventory', { preHandler: [fastify.requireRoles(WMS_WRITE)] }, async (req, reply) => {
    const b = req.body || {};
    if (!b.warehouse_id) return bad(reply, 'warehouse_id обязателен');
    const { rows } = await db.query(
      `INSERT INTO warehouse_inventory_sessions(warehouse_id,title,scope_json,opened_by)
       VALUES($1,$2,$3::jsonb,$4) RETURNING *`,
      [b.warehouse_id, b.title || 'Инвентаризация', JSON.stringify(b.scope_json || {}), req.user.id]);
    return { session: rows[0] };
  });

  fastify.get('/inventory', { preHandler: [fastify.requireRoles(WMS_READ)] }, async (req) => {
    const { warehouse_id, status, limit = 50 } = req.query;
    let sql = 'SELECT * FROM warehouse_inventory_sessions WHERE 1=1';
    const p = []; let i = 1;
    if (warehouse_id) { sql += ` AND warehouse_id=$${i++}`; p.push(warehouse_id); }
    if (status) { sql += ` AND status=$${i++}`; p.push(status); }
    sql += ` ORDER BY opened_at DESC LIMIT $${i++}`;
    p.push(Math.min(parseInt(limit, 10) || 50, 200));
    const { rows } = await db.query(sql, p);
    return { items: rows };
  });

  fastify.post('/inventory/:id/lines', { preHandler: [fastify.requireRoles(WMS_WRITE)] }, async (req, reply) => {
    const b = req.body || {};
    const expected = b.expected_qty != null ? parseFloat(b.expected_qty) : null;
    const fact = b.fact_qty != null ? parseFloat(b.fact_qty) : null;
    let variance = null, status = 'pending';
    if (expected != null && fact != null) {
      variance = fact - expected;
      if (Math.abs(variance) < 1e-6) status = 'matched';
      else if (variance > 0) status = 'surplus';
      else if (fact === 0) status = 'missing';
      else status = 'shortage';
    }
    const { rows } = await db.query(
      `INSERT INTO warehouse_inventory_lines(
         session_id,location_id,map_object_id,track_type,product_id,equipment_id,
         expected_qty,fact_qty,variance_qty,status,reason_code,notes,scanned_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW()) RETURNING *`,
      [req.params.id, b.location_id || null, b.map_object_id || null,
       b.track_type || 'consumable', b.product_id || null, b.equipment_id || null,
       expected, fact, variance, status, b.reason_code || null, b.notes || null]);
    return { line: rows[0] };
  });

  fastify.post('/inventory/:id/close', { preHandler: [fastify.requireRoles(WMS_WRITE)] }, async (req, reply) => {
    const openVar = await db.query(
      `SELECT COUNT(*)::int AS n FROM warehouse_inventory_lines
       WHERE session_id=$1 AND status IN ('surplus','shortage','missing') AND resolved_at IS NULL`,
      [req.params.id]);
    const isDir = ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'].includes(req.user.role);
    if (openVar.rows[0].n > 0 && !isDir && !(req.body && req.body.force && isDir)) {
      if (!isDir) return bad(reply, 'Есть неразрешённые расхождения — нужен ADMIN/DIR', 403);
    }
    const { rows } = await db.query(
      `UPDATE warehouse_inventory_sessions SET status='closed', closed_by=$1, closed_at=NOW()
       WHERE id=$2 AND status IN ('open','review') RETURNING *`,
      [req.user.id, req.params.id]);
    if (!rows[0]) return bad(reply, 'Сессия не найдена/закрыта', 409);
    return { session: rows[0] };
  });

  // ── Director summary ──────────────────────────────────────────────────────
  fastify.get('/director-summary', { preHandler: [fastify.requireRoles(WMS_READ)] }, async () => {
    const assemblies = await db.query(
      `SELECT status, COUNT(*)::int AS n FROM assembly_orders
       WHERE status NOT IN ('closed','returned') GROUP BY status`);
    const unpick = await db.query(
      `SELECT COUNT(*)::int AS n FROM assembly_items WHERE line_status='unpick_requested'`);
    const inv = await db.query(
      `SELECT status, COUNT(*)::int AS n FROM warehouse_inventory_sessions GROUP BY status`);
    const openOps = await db.query(
      `SELECT session_type, COUNT(*)::int AS n FROM warehouse_op_sessions WHERE status='open' GROUP BY session_type`);
    const fill = await db.query(
      `SELECT object_type, COUNT(*)::int AS n FROM warehouse_map_objects WHERE deleted_at IS NULL AND is_active GROUP BY object_type`);
    return {
      assemblies: assemblies.rows,
      unpick_queue: unpick.rows[0]?.n || 0,
      inventory: inv.rows,
      open_sessions: openOps.rows,
      map_fill: fill.rows
    };
  });

  // ── Bulk site receipt mark ────────────────────────────────────────────────
  fastify.post('/site-receipt-bulk', { preHandler: [fastify.requireRoles(WMS_READ)] }, async (req, reply) => {
    const { assembly_id, item_ids, note } = req.body || {};
    if (!assembly_id) return bad(reply, 'assembly_id обязателен');
    const ids = Array.isArray(item_ids) ? item_ids : [];
    let sql = `UPDATE assembly_items SET received=true, received_at=NOW(), received_by=$1,
      notes=COALESCE(notes,'') || $2
      WHERE assembly_id=$3`;
    const p = [req.user.id, note ? `\n[site-bulk] ${note}` : '\n[site-bulk]', assembly_id];
    if (ids.length) { sql += ` AND id = ANY($4)`; p.push(ids); }
    sql += ' RETURNING id';
    const { rows } = await db.query(sql, p);
    return { updated: rows.length, ids: rows.map(r => r.id) };
  });

  // ── Suggest return putaway after demob ────────────────────────────────────
  fastify.get('/suggest-return', { preHandler: [fastify.requireRoles(WMS_READ)] }, async (req) => {
    const { warehouse_id, category, heavy, clothing, equipment_id, product_id } = req.query;
    let sql = `SELECT o.*,
      (SELECT COUNT(*) FROM warehouse_locations l WHERE l.map_object_id=o.id AND l.deleted_at IS NULL) AS loc_count
      FROM warehouse_map_objects o
      WHERE o.deleted_at IS NULL AND o.is_active=true`;
    const p = []; let i = 1;
    if (warehouse_id) { sql += ` AND o.warehouse_id=$${i++}`; p.push(warehouse_id); }
    if (clothing === '1' || clothing === 'true') sql += ` AND o.object_type='clothing'`;
    else if (heavy === '1' || heavy === 'true') sql += ` AND o.object_type IN ('shelf_pallet','floor_zone')`;
    else sql += ` AND o.object_type IN ('shelf_light','shelf_pallet','floor_zone','clothing')`;
    if (category) { sql += ` AND $${i++}=ANY(o.category_tags)`; p.push(category); }
    sql += ' ORDER BY o.object_type, o.code NULLS LAST LIMIT 15';
    const { rows } = await db.query(sql, p);
    return { suggestions: rows, equipment_id: equipment_id || null, product_id: product_id || null };
  });

  // ── Create putaway session from receive lines / suggestions ───────────────
  fastify.post('/putaway-from-receive', { preHandler: [fastify.requireRoles(WMS_WRITE)] }, async (req, reply) => {
    const b = req.body || {};
    if (!b.warehouse_id) return bad(reply, 'warehouse_id обязателен');
    const lines = Array.isArray(b.items) ? b.items : [];
    const { rows } = await db.query(
      `INSERT INTO warehouse_op_sessions(warehouse_id,session_type,title,document_ref,meta_json,opened_by,device)
       VALUES($1,'putaway',$2,$3,$4::jsonb,$5,$6) RETURNING *`,
      [b.warehouse_id, b.title || 'Раскладка', b.document_ref || null,
       JSON.stringify({ cross_dock: !!b.cross_dock, assembly_id: b.assembly_id || null }),
       req.user.id, b.device || 'crm']);
    const session = rows[0];
    const created = [];
    let n = 1;
    for (const it of lines) {
      const r = await db.query(
        `INSERT INTO warehouse_op_session_items(
           session_id,line_no,track_type,product_id,equipment_id,target_location_id,planned_qty,unit,meta_json)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) RETURNING *`,
        [session.id, n++, it.track_type || (it.equipment_id ? 'piece' : 'consumable'),
         it.product_id || null, it.equipment_id || null, it.target_location_id || null,
         it.planned_qty ?? it.qty ?? 1, it.unit || 'шт',
         JSON.stringify({ cross_dock_pallet: it.cross_dock_pallet || null, ...(it.meta_json || {}) })]);
      created.push(r.rows[0]);
    }
    return { session, items: created };
  });
}

async function upsertStock(client, productId, warehouseId, locationId, deltaQty, userId, reason, refId) {
  const moveType = ({
    putaway: 'receipt', receive: 'receipt', pick: 'issue', unpick: 'return',
    issue: 'issue', writeoff: 'writeoff', adjust: 'adjust', transfer: 'transfer',
  })[reason] || (deltaQty >= 0 ? 'receipt' : 'issue');
  const cur = await client.query(
    `SELECT id, quantity FROM stock WHERE product_id=$1 AND warehouse_id=$2 AND location_id=$3 FOR UPDATE`,
    [productId, warehouseId, locationId]);
  let stockId;
  if (cur.rows[0]) {
    const next = parseFloat(cur.rows[0].quantity) + deltaQty;
    if (next < -1e-6) throw Object.assign(new Error('Недостаточно остатка на месте'), { code: 'STOCK' });
    await client.query(`UPDATE stock SET quantity=$1, updated_at=NOW() WHERE id=$2`, [next, cur.rows[0].id]);
    stockId = cur.rows[0].id;
  } else {
    if (deltaQty < 0) throw Object.assign(new Error('Нет остатка на месте'), { code: 'STOCK' });
    const ins = await client.query(
      `INSERT INTO stock(product_id,warehouse_id,location_id,quantity) VALUES($1,$2,$3,$4) RETURNING id`,
      [productId, warehouseId, locationId, deltaQty]);
    stockId = ins.rows[0].id;
  }
  try {
    await client.query('SAVEPOINT stock_mov');
    await client.query(
      `INSERT INTO stock_movements(product_id,from_warehouse_id,from_location_id,to_warehouse_id,to_location_id,
        qty,unit,movement_type,ref_type,ref_id,reason,created_by)
       VALUES($1,$2,$3,$4,$5,$6,'шт',$7,'warehouse_op',$8,$9,$10)`,
      [productId,
       deltaQty < 0 ? warehouseId : null, deltaQty < 0 ? locationId : null,
       deltaQty > 0 ? warehouseId : null, deltaQty > 0 ? locationId : null,
       Math.abs(deltaQty), moveType, refId, reason, userId]);
    await client.query('RELEASE SAVEPOINT stock_mov');
  } catch (_) {
    try { await client.query('ROLLBACK TO SAVEPOINT stock_mov'); } catch (__) { /* ignore */ }
  }
  return stockId;
}

module.exports = routes;
