'use strict';
const { randomUUID } = require('crypto');
const QRCode = require('qrcode');

const PM_ROLES = ['PM', 'HEAD_PM'];
const WH_ROLES = ['WAREHOUSE', 'ADMIN'];
const DIR_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
const ALL_ROLES = [...new Set([...PM_ROLES, ...WH_ROLES, ...DIR_ROLES])];
// РП управляет сборкой (паллеты, drag-drop, упаковка). Кладовщик только принимает (receive-all).
const ASSEMBLY_MANAGERS = ALL_ROLES;
const RECEIVERS = WH_ROLES;

async function routes(fastify) {
  const db = fastify.db;
  const { createNotification } = require('../services/notify');

  async function checkPackingProgress(c, asmId) {
    const ai = await c.query('SELECT packed FROM assembly_items WHERE assembly_id=$1', [asmId]);
    const ap = await c.query('SELECT status FROM assembly_pallets WHERE assembly_id=$1', [asmId]);
    if (!ai.rows.length) return;
    const anyPacked = ai.rows.some(i => i.packed);
    const allPacked = ai.rows.every(i => i.packed);
    const allPalletsPacked = ap.rows.length > 0 && ap.rows.every(p => p.status === 'packed');
    const cur = await c.query('SELECT status FROM assembly_orders WHERE id=$1', [asmId]);
    const st = cur.rows[0]?.status;
    if (allPacked && allPalletsPacked && ['confirmed', 'packing'].includes(st))
      await c.query("UPDATE assembly_orders SET status='packed',updated_at=NOW() WHERE id=$1", [asmId]);
    else if (anyPacked && st === 'confirmed')
      await c.query("UPDATE assembly_orders SET status='packing',updated_at=NOW() WHERE id=$1", [asmId]);
  }

  async function computeAssemblyKpi(dbConn, asmId) {
    const totals = await dbConn.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE packed)::int AS packed
       FROM assembly_items WHERE assembly_id=$1`, [asmId]);
    const pallets = await dbConn.query(
      `SELECT COUNT(*)::int AS n,
              COALESCE(SUM(capacity_kg),0)::float AS weight
       FROM assembly_pallets WHERE assembly_id=$1`, [asmId]);
    const total = totals.rows[0]?.total || 0;
    const packed = totals.rows[0]?.packed || 0;
    const pallets_count = pallets.rows[0]?.n || 0;
    const packed_weight_kg = Math.round((pallets.rows[0]?.weight || 0) * 10) / 10;
    const ready_pct = total ? Math.round(100 * packed / total) : 0;
    return { total, packed, pallets_count, packed_weight_kg, ready_pct };
  }

  async function buildBoardForAssembly(dbConn, asmId) {
    const order = await dbConn.query('SELECT * FROM assembly_orders WHERE id=$1', [asmId]);
    if (!order.rows[0]) return { board: [], live: null };
    const workId = order.rows[0].work_id;
    const items = await dbConn.query('SELECT * FROM assembly_items WHERE assembly_id=$1 ORDER BY id', [asmId]);
    const procs = workId ? await dbConn.query(
      `SELECT pi.id AS item_id, pi.name, pi.quantity, pi.item_status, pi.product_id,
              pr.id AS procurement_id, pr.status AS procurement_status,
              ii.approval_status AS invoice_wave
       FROM procurement_items pi
       JOIN procurement_requests pr ON pr.id=pi.procurement_id
       LEFT JOIN procurement_invoice_imports ii ON ii.id=pi.invoice_import_id
       WHERE pr.work_id=$1 AND COALESCE(pi.item_status,'pending')<>'cancelled'`, [workId]) : { rows: [] };
    const board = items.rows.map((it) => {
      const st = it.line_status || '';
      const packed = !!(it.packed || it.pallet_id);
      const onShelf = st === 'on_shelf' || st === 'stock_ready';
      const inTransit = st === 'in_transit' || order.rows[0].status === 'in_transit';
      const awaitingProc = st === 'awaiting_procurement';
      const reserved = st === 'reserved' || st === 'awaiting_wh_approve';
      const procHit = procs.rows.find((p) =>
        (it.product_id && p.product_id === it.product_id) ||
        (p.name && it.name && p.name.toLowerCase() === String(it.name).toLowerCase())
      );
      const paid = procHit && (procHit.invoice_wave === 'paid' || ['paid', 'delivered', 'partially_delivered'].includes(procHit.procurement_status));
      const flags = {
        reserved: reserved || packed || onShelf,
        assembled: packed,
        in_transit: inTransit,
        in_procurement: awaitingProc || !!(procHit && !paid && procHit.item_status !== 'delivered'),
        paid: !!paid,
        on_shelf: onShelf || procHit?.item_status === 'delivered'
      };
      let edit_mode = 'delete';
      if (flags.assembled || flags.in_transit) edit_mode = 'locked';
      else if (flags.paid || flags.on_shelf || flags.in_procurement) edit_mode = 'decrease';
      else if (flags.reserved) edit_mode = 'stock';
      return {
        assembly_item_id: it.id,
        assembly_id: asmId,
        name: it.name,
        qty: it.quantity,
        line_status: st,
        product_id: it.product_id || null,
        flags,
        edit_mode
      };
    });
    const kpi = await computeAssemblyKpi(dbConn, asmId);
    return { board, live: { status: order.rows[0].status, ...kpi }, kpi };
  }

  // ═══ CRUD ═══

  // Доска статусов позиций по работе (РП)
  fastify.get('/board', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const workId = parseInt(req.query.work_id);
    if (!workId) return reply.code(400).send({ error: 'work_id обязателен' });
    const asms = await db.query(
      `SELECT ao.id, ao.title, ao.status, ao.type
       FROM assembly_orders ao
       WHERE ao.work_id=$1 AND ao.status NOT IN ('closed','returned')
       ORDER BY ao.id DESC`, [workId]);
    const items = await db.query(
      `SELECT ai.*, ao.id AS assembly_id, ao.status AS assembly_status, ao.title AS assembly_title
       FROM assembly_items ai
       JOIN assembly_orders ao ON ao.id=ai.assembly_id
       WHERE ao.work_id=$1 AND ao.status NOT IN ('closed','returned')
       ORDER BY ai.id`, [workId]);
    const procs = await db.query(
      `SELECT pi.id AS item_id, pi.name, pi.quantity, pi.unit_price, pi.item_status, pi.product_id,
              pr.id AS procurement_id, pr.status AS procurement_status,
              ii.id AS invoice_import_id, ii.approval_status AS invoice_wave
       FROM procurement_items pi
       JOIN procurement_requests pr ON pr.id=pi.procurement_id
       LEFT JOIN procurement_invoice_imports ii ON ii.id=pi.invoice_import_id
       WHERE pr.work_id=$1 AND COALESCE(pi.item_status,'pending')<>'cancelled'
       ORDER BY pi.id`, [workId]);
    const pays = await db.query(
      `SELECT id, amount, status, payment_status, procurement_id, invoice_import_id
       FROM payment_invoices WHERE work_id=$1 ORDER BY id DESC`, [workId]).catch(() => ({ rows: [] }));

    const board = items.rows.map(it => {
      const st = it.line_status || '';
      const packed = !!(it.packed || it.pallet_id);
      const onShelf = st === 'on_shelf' || st === 'stock_ready';
      const inTransit = st === 'in_transit' || it.assembly_status === 'in_transit';
      const awaitingProc = st === 'awaiting_procurement';
      const reserved = st === 'reserved' || st === 'awaiting_wh_approve';
      const procHit = procs.rows.find(p =>
        (it.product_id && p.product_id === it.product_id) ||
        (p.name && it.name && p.name.toLowerCase() === String(it.name).toLowerCase())
      );
      const paid = procHit && (procHit.invoice_wave === 'paid' || ['paid','delivered','partially_delivered'].includes(procHit.procurement_status));
      const flags = {
        reserved: reserved || packed || onShelf,
        assembled: packed,
        in_transit: inTransit,
        in_procurement: awaitingProc || !!(procHit && !paid && procHit.item_status !== 'delivered'),
        paid: !!paid,
        on_shelf: onShelf || procHit?.item_status === 'delivered'
      };
      let edit_mode = 'delete'; // ещё не закуплено
      if (flags.assembled || flags.in_transit) edit_mode = 'locked';
      else if (flags.paid || flags.on_shelf) edit_mode = 'decrease';
      else if (flags.reserved) edit_mode = 'stock';
      else if (flags.in_procurement) edit_mode = 'decrease';
      return {
        assembly_item_id: it.id,
        assembly_id: it.assembly_id,
        name: it.name,
        qty: it.quantity,
        line_status: st,
        product_id: it.product_id || null,
        flags,
        edit_mode,
        procurement_id: procHit?.procurement_id || null,
        invoice_wave: procHit?.invoice_wave || null
      };
    });

    // KPI по всем открытым сборкам работы
    const kpiByAsm = {};
    for (const a of asms.rows) {
      kpiByAsm[a.id] = await computeAssemblyKpi(db, a.id);
    }
    const kpiAgg = Object.values(kpiByAsm).reduce((acc, k) => {
      acc.total += k.total || 0;
      acc.packed += k.packed || 0;
      acc.pallets_count += k.pallets_count || 0;
      acc.packed_weight_kg += k.packed_weight_kg || 0;
      return acc;
    }, { total: 0, packed: 0, pallets_count: 0, packed_weight_kg: 0 });
    const ready_pct = kpiAgg.total ? Math.round(100 * kpiAgg.packed / kpiAgg.total) : 0;

    return {
      work_id: workId,
      assemblies: asms.rows.map((a) => ({ ...a, kpi: kpiByAsm[a.id] || null })),
      board,
      procurement_items: procs.rows,
      payments: pays.rows,
      kpi: { ...kpiAgg, ready_pct }
    };
  });

  /** Список сборок для мониторинга РП (свои / по роли) + KPI */
  fastify.get('/monitor', { preHandler: [fastify.authenticate] }, async (req) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 40, 100);
    const mine = String(req.query.mine || '1') !== '0';
    const role = req.user.role;
    const isPm = PM_ROLES.includes(role);
    const p = [];
    let i = 1;
    let sql = `SELECT ao.*, w.work_title, w.customer_name, pm.name AS pm_name,
      (SELECT COUNT(*)::int FROM assembly_items ai WHERE ai.assembly_id=ao.id) AS items_count,
      (SELECT COUNT(*)::int FROM assembly_items ai WHERE ai.assembly_id=ao.id AND ai.packed) AS packed_count,
      (SELECT COUNT(*)::int FROM assembly_pallets ap WHERE ap.assembly_id=ao.id) AS pallets_count
      FROM assembly_orders ao
      LEFT JOIN works w ON w.id=ao.work_id
      LEFT JOIN users pm ON pm.id=w.pm_id
      WHERE ao.status NOT IN ('closed','returned')`;
    if (mine && isPm && !DIR_ROLES.includes(role) && role !== 'ADMIN') {
      sql += ` AND (ao.created_by=$${i} OR w.pm_id=$${i})`;
      p.push(req.user.id); i++;
    }
    sql += ` ORDER BY ao.planned_date NULLS LAST, ao.id DESC LIMIT $${i}`;
    p.push(limit);
    const { rows } = await db.query(sql, p);
    const items = [];
    for (const row of rows) {
      const kpi = await computeAssemblyKpi(db, row.id);
      items.push({
        ...row,
        ready_pct: kpi.ready_pct,
        packed_weight_kg: kpi.packed_weight_kg,
        kpi
      });
    }
    return { items };
  });

  fastify.get('/monitor/:id', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: 'Bad ID' });
    const { rows } = await db.query(
      `SELECT ao.*, w.work_title, w.customer_name, w.pm_id, pm.name AS pm_name
       FROM assembly_orders ao
       LEFT JOIN works w ON w.id=ao.work_id
       LEFT JOIN users pm ON pm.id=w.pm_id
       WHERE ao.id=$1`, [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдена' });
    const boardRes = await buildBoardForAssembly(db, id);
    const kpi = await computeAssemblyKpi(db, id);
    return { item: rows[0], board: boardRes.board, kpi, live: boardRes.live };
  });

  /** PATCH qty с правилами мониторинга */
  fastify.patch('/:id/items/:itemId/monitor-qty', { preHandler: [fastify.requireRoles(ALL_ROLES)] }, async (req, reply) => {
    const asmId = parseInt(req.params.id, 10);
    const itemId = parseInt(req.params.itemId, 10);
    const qty = parseFloat(req.body && req.body.quantity);
    if (!(qty > 0)) return reply.code(400).send({ error: 'quantity > 0' });
    const asm = await db.query('SELECT status FROM assembly_orders WHERE id=$1', [asmId]);
    if (!asm.rows[0]) return reply.code(404).send({ error: 'Не найдена' });
    if (['in_transit', 'closed', 'returned'].includes(asm.rows[0].status)) {
      return reply.code(409).send({ error: 'Сборка уже отправлена/закрыта' });
    }
    const it = await db.query('SELECT * FROM assembly_items WHERE id=$1 AND assembly_id=$2', [itemId, asmId]);
    if (!it.rows[0]) return reply.code(404).send({ error: 'Не найдена' });
    const row = it.rows[0];
    const st = row.line_status || '';
    const packed = !!(row.packed || row.pallet_id);
    if (packed || st === 'in_transit') return reply.code(409).send({ error: 'Собранную/в пути позицию нельзя менять здесь' });
    const cur = parseFloat(row.quantity) || 0;
    const awaitingProc = st === 'awaiting_procurement';
    const reserved = st === 'reserved' || st === 'awaiting_wh_approve';
    if (awaitingProc || st === 'on_shelf' || st === 'stock_ready') {
      if (qty > cur) return reply.code(409).send({ error: 'Закупленное можно только уменьшить' });
    } else if (reserved) {
      // в пределах текущего qty (доступный остаток отдельно; не раздуваем выше need)
      if (qty > cur * 2) return reply.code(409).send({ error: 'Слишком большое увеличение' });
    } else if (qty > cur) {
      return reply.code(409).send({ error: 'Можно только уменьшить или удалить' });
    }
    const { rows } = await db.query(
      'UPDATE assembly_items SET quantity=$1 WHERE id=$2 AND assembly_id=$3 RETURNING *',
      [qty, itemId, asmId]);
    return { item: rows[0], edit_ok: true };
  });

  /** Удаление с dry-run mail PROC/WH */
  fastify.post('/:id/items/:itemId/monitor-remove', { preHandler: [fastify.requireRoles(ALL_ROLES)] }, async (req, reply) => {
    const { notifyLineRemoved } = require('../services/assembly-mail');
    const asmId = parseInt(req.params.id, 10);
    const itemId = parseInt(req.params.itemId, 10);
    const asm = await db.query(
      `SELECT ao.*, w.pm_id FROM assembly_orders ao LEFT JOIN works w ON w.id=ao.work_id WHERE ao.id=$1`, [asmId]);
    if (!asm.rows[0]) return reply.code(404).send({ error: 'Не найдена' });
    if (['in_transit', 'closed', 'returned'].includes(asm.rows[0].status)) {
      return reply.code(409).send({ error: 'Сборка уже отправлена/закрыта' });
    }
    const it = await db.query('SELECT * FROM assembly_items WHERE id=$1 AND assembly_id=$2', [itemId, asmId]);
    if (!it.rows[0]) return reply.code(404).send({ error: 'Не найдена' });
    const row = it.rows[0];
    if (row.packed || row.pallet_id) {
      return reply.code(409).send({ error: 'Сначала уберите с паллета (unpick)' });
    }
    const st = row.line_status || '';
    const wasStock = st === 'reserved' || st === 'awaiting_wh_approve' || st === 'on_shelf';
    const wasProc = st === 'awaiting_procurement';
    await db.query('DELETE FROM assembly_items WHERE id=$1 AND assembly_id=$2', [itemId, asmId]);

    const emails = [];
    const userIds = [];
    if (wasProc) {
      const procs = await db.query("SELECT id, email FROM users WHERE role='PROC' AND is_active=true");
      for (const u of procs.rows) { userIds.push(u.id); if (u.email) emails.push(u.email); }
    }
    if (wasStock) {
      const whs = await db.query("SELECT id, email FROM users WHERE role='WAREHOUSE' AND is_active=true");
      for (const u of whs.rows) { userIds.push(u.id); if (u.email) emails.push(u.email); }
    }
    for (const uid of [...new Set(userIds)]) {
      createNotification(db, {
        user_id: uid,
        title: 'Позиция снята со сборки',
        message: `${row.name} · сборка #${asmId}`,
        type: 'assembly',
        link: `#/warehouse-v2?tab=monitor&id=${asmId}`
      });
    }
    const mail = await notifyLineRemoved(db, {
      toEmails: emails,
      assemblyId: asmId,
      itemName: row.name,
      qty: row.quantity,
      actor: req.user.name || req.user.login,
      reason: req.body && req.body.reason
    });
    return { success: true, mail };
  });

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (req) => {
    const { work_id, type, status, limit = 50, offset = 0 } = req.query;
    let sql = `SELECT ao.*,w.work_title,u.name as creator_name, pm.name as pm_name,
      (SELECT COUNT(*) FROM assembly_items ai WHERE ai.assembly_id=ao.id) as items_count,
      (SELECT COUNT(*) FROM assembly_pallets ap WHERE ap.assembly_id=ao.id) as pallets_count,
      (SELECT COUNT(*) FROM assembly_items ai WHERE ai.assembly_id=ao.id AND ai.packed=true) as packed_count
      FROM assembly_orders ao
      LEFT JOIN works w ON ao.work_id=w.id
      LEFT JOIN users u ON ao.created_by=u.id
      LEFT JOIN users pm ON w.pm_id=pm.id
      WHERE 1=1`;
    const p = []; let i = 1;
    if (work_id) { sql += ` AND ao.work_id=$${i++}`; p.push(work_id); }
    if (type) { sql += ` AND ao.type=$${i++}`; p.push(type); }
    if (status) { sql += ` AND ao.status=$${i++}`; p.push(status); }
    sql += ` ORDER BY ao.id DESC LIMIT $${i++} OFFSET $${i++}`;
    p.push(Math.min(parseInt(limit), 200), parseInt(offset));
    const { rows } = await db.query(sql, p); return { items: rows };
  });

  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const id = parseInt(req.params.id); if (isNaN(id)) return reply.code(400).send({ error: 'Bad ID' });
    const { rows } = await db.query(`SELECT ao.*,w.work_title,w.customer_name,w.pm_id as work_pm_id,u.name as creator_name
      FROM assembly_orders ao LEFT JOIN works w ON ao.work_id=w.id LEFT JOIN users u ON ao.created_by=u.id WHERE ao.id=$1`, [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдена' });
    // G-12 F5 SECURITY: IDOR ownership-check. PM видит только свои сборки (создал сам или назначен на работу).
    // Остальные роли (WAREHOUSE/PROC/HEAD_PM/DIRECTOR_*/ADMIN/TO/HEAD_TO/CHIEF_ENGINEER/OFFICE_MANAGER/BUH) — без ограничения.
    if (req.user.role === 'PM') {
      const ownsCreate = rows[0].created_by === req.user.id;
      const ownsWork = rows[0].work_pm_id === req.user.id;
      if (!ownsCreate && !ownsWork) {
        return reply.code(403).send({ error: 'Нет доступа к этой сборке' });
      }
    }
    const items = await db.query('SELECT * FROM assembly_items WHERE assembly_id=$1 ORDER BY sort_order,id', [id]);
    const pallets = await db.query('SELECT * FROM assembly_pallets WHERE assembly_id=$1 ORDER BY pallet_number', [id]);
    return { item: rows[0], items: items.rows, pallets: pallets.rows };
  });

  fastify.post('/', { preHandler: [fastify.requireRoles(ALL_ROLES)] }, async (req, reply) => {
    const { work_id, type, title, destination, planned_date, notes } = req.body;
    if (!work_id) return reply.code(400).send({ error: 'work_id обязателен' });
    if (!type || !['mobilization', 'demobilization', 'transfer'].includes(type)) return reply.code(400).send({ error: 'type: mobilization/demobilization/transfer' });
    const wc = await db.query('SELECT id,work_title FROM works WHERE id=$1', [work_id]);
    if (!wc.rows[0]) return reply.code(400).send({ error: 'Работа не найдена' });
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(`INSERT INTO assembly_orders(work_id,type,title,destination,planned_date,notes,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [work_id, type, title || `${type === 'mobilization' ? 'Мобилизация' : 'Демобилизация'}: ${wc.rows[0].work_title}`,
         destination || null, planned_date || null, notes || null, req.user.id]);
      const asmId = rows[0].id;

      if (type === 'mobilization') {
        // Забронированное. C4: исключаем единицы, уже находящиеся в НЕзакрытой мобилизации
        // другой работы (чтобы одну единицу не отгрузили на 2 объекта).
        const reserved = await client.query(`SELECT e.*,er.id as rid FROM equipment_reservations er
          JOIN equipment e ON er.equipment_id=e.id
          WHERE er.work_id=$1 AND er.status='active'
            AND NOT EXISTS (
              SELECT 1 FROM assembly_items ai JOIN assembly_orders ao ON ai.assembly_id=ao.id
              WHERE ai.equipment_id=e.id AND ao.type='mobilization'
                AND ao.work_id<>$1 AND ao.status NOT IN ('returned','closed')
            )`, [work_id]);
        for (const eq of reserved.rows)
          await client.query(`INSERT INTO assembly_items(assembly_id,equipment_id,name,article,unit,quantity,source)VALUES($1,$2,$3,$4,$5,$6,'reservation')`,
            [asmId, eq.id, eq.name, eq.article || null, eq.unit || 'шт', eq.quantity || 1]);

        // Закупки на объект
        const po = await client.query(`SELECT pi.* FROM procurement_items pi JOIN procurement_requests pr ON pi.procurement_id=pr.id
          WHERE pr.work_id=$1 AND pi.delivery_target='object' AND pi.item_status IN('ordered','shipped','delivered')`, [work_id]);
        for (const pi of po.rows)
          await client.query(`INSERT INTO assembly_items(assembly_id,procurement_item_id,name,article,unit,quantity,source)VALUES($1,$2,$3,$4,$5,$6,'procurement_object')`,
            [asmId, pi.id, pi.name, pi.article || null, pi.unit || 'шт', pi.quantity || 1]);

        // Закупки на склад (доставлены)
        const pw = await client.query(`SELECT pi.*,e.id as eq_id,e.name as eq_name FROM procurement_items pi
          JOIN procurement_requests pr ON pi.procurement_id=pr.id LEFT JOIN equipment e ON pi.equipment_id=e.id
          WHERE pr.work_id=$1 AND pi.delivery_target='warehouse' AND pi.item_status='delivered' AND pi.equipment_id IS NOT NULL`, [work_id]);
        for (const pi of pw.rows)
          await client.query(`INSERT INTO assembly_items(assembly_id,equipment_id,procurement_item_id,name,unit,quantity,source)VALUES($1,$2,$3,$4,$5,$6,'procurement_warehouse')`,
            [asmId, pi.eq_id, pi.id, pi.eq_name || pi.name, pi.unit || 'шт', pi.quantity || 1]);

        // WMS: закупленные на склад РАСХОДНИКИ (ушли в stock количеством, без equipment_id),
        // но привязаны к каталогу — тоже включаем в ведомость (иначе теряются).
        const pwc = await client.query(`SELECT pi.* FROM procurement_items pi
          JOIN procurement_requests pr ON pi.procurement_id=pr.id
          WHERE pr.work_id=$1 AND pi.delivery_target='warehouse' AND pi.item_status='delivered'
            AND pi.equipment_id IS NULL AND pi.product_id IS NOT NULL`, [work_id]);
        for (const pi of pwc.rows)
          await client.query(`INSERT INTO assembly_items(assembly_id,product_id,procurement_item_id,name,unit,quantity,source)VALUES($1,$2,$3,$4,$5,$6,'from_warehouse')`,
            [asmId, pi.product_id, pi.id, pi.name, pi.unit || 'шт', pi.quantity || 1]);
      }
      await client.query('COMMIT');
      const detail = await db.query('SELECT * FROM assembly_orders WHERE id=$1', [asmId]);
      const autoItems = await db.query('SELECT * FROM assembly_items WHERE assembly_id=$1', [asmId]);
      // Уведомить кладовщиков
      const whs = await db.query("SELECT id FROM users WHERE role='WAREHOUSE' AND is_active=true");
      for (const w of whs.rows) {
        if (w.id !== req.user.id) createNotification(db, { user_id: w.id, title: '🏗️ Новая ведомость',
          message: `${type === 'mobilization' ? 'Моб' : 'Демоб'} для «${wc.rows[0].work_title}» — ${autoItems.rows.length} поз.`,
          type: 'assembly', link: `#/assembly?id=${asmId}` });
      }
      return { item: detail.rows[0], items: autoItems.rows };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  });

  fastify.put('/:id', { preHandler: [fastify.requireRoles(ALL_ROLES)] }, async (req, reply) => {
    const id = parseInt(req.params.id);
    const ck = await db.query('SELECT status FROM assembly_orders WHERE id=$1', [id]);
    if (!ck.rows[0]) return reply.code(404).send({ error: 'Не найдена' });
    if (!['draft', 'confirmed'].includes(ck.rows[0].status)) return reply.code(409).send({ error: 'Только draft/confirmed' });
    const allowed = ['title', 'destination', 'planned_date', 'notes', 'object_name'];
    const upd = [], vals = []; let i = 1;
    for (const k of allowed) { if (req.body[k] !== undefined) { upd.push(`${k}=$${i++}`); vals.push(req.body[k]); } }
    if (!upd.length) return reply.code(400).send({ error: 'Нет данных' });
    upd.push('updated_at=NOW()'); vals.push(id);
    const { rows } = await db.query(`UPDATE assembly_orders SET ${upd.join(',')} WHERE id=$${i} RETURNING *`, vals);
    return { item: rows[0] };
  });

  fastify.delete('/:id', { preHandler: [fastify.requireRoles(['ADMIN'])] }, async (req, reply) => {
    const { rows } = await db.query("DELETE FROM assembly_orders WHERE id=$1 AND status='draft' RETURNING id", [req.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдена/не draft' }); return { success: true };
  });

  fastify.put('/:id/confirm', { preHandler: [fastify.requireRoles([...PM_ROLES, ...DIR_ROLES])] }, async (req, reply) => {
    const id = parseInt(req.params.id);
    const ck = await db.query('SELECT status FROM assembly_orders WHERE id=$1', [id]);
    if (!ck.rows[0]) return reply.code(404).send({ error: 'Не найдена' });
    if (ck.rows[0].status !== 'draft') return reply.code(409).send({ error: 'Только draft' });
    const { rows } = await db.query(`UPDATE assembly_orders SET status='confirmed',confirmed_by=$1,updated_at=NOW() WHERE id=$2 RETURNING *`, [req.user.id, id]);
    return { item: rows[0] };
  });

  // ═══ ПОЗИЦИИ ═══

  fastify.post('/:id/items', { preHandler: [fastify.requireRoles(ALL_ROLES)] }, async (req, reply) => {
    const asmId = parseInt(req.params.id);
    const ck = await db.query('SELECT status FROM assembly_orders WHERE id=$1', [asmId]);
    if (!ck.rows[0]) return reply.code(404).send({ error: 'Не найдена' });
    if (!['draft', 'confirmed', 'packing'].includes(ck.rows[0].status)) return reply.code(409).send({ error: 'Нельзя добавлять' });
    const { name, article, unit, quantity, source, equipment_id, procurement_item_id, notes, sort_order } = req.body;
    if (!name) return reply.code(400).send({ error: 'name обязателен' });
    const { rows } = await db.query(`INSERT INTO assembly_items(assembly_id,name,article,unit,quantity,source,equipment_id,procurement_item_id,notes,sort_order)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [asmId, name, article || null, unit || 'шт', quantity || 1, source || 'manual', equipment_id || null, procurement_item_id || null, notes || null, sort_order || 0]);
    return { item: rows[0] };
  });

  fastify.put('/:id/items/:itemId', { preHandler: [fastify.requireRoles(ALL_ROLES)] }, async (req, reply) => {
    const allowed = ['name', 'article', 'unit', 'quantity', 'notes', 'sort_order', 'return_status', 'return_reason'];
    const upd = [], vals = []; let i = 1;
    for (const k of allowed) { if (req.body[k] !== undefined) { upd.push(`${k}=$${i++}`); vals.push(req.body[k]); } }
    if (!upd.length) return reply.code(400).send({ error: 'Нет данных' });
    vals.push(parseInt(req.params.itemId), parseInt(req.params.id));
    const { rows } = await db.query(`UPDATE assembly_items SET ${upd.join(',')} WHERE id=$${i} AND assembly_id=$${i + 1} RETURNING *`, vals);
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдена' }); return { item: rows[0] };
  });

  fastify.delete('/:id/items/:itemId', { preHandler: [fastify.requireRoles(ALL_ROLES)] }, async (req, reply) => {
    const asmId = parseInt(req.params.id);
    const itemId = parseInt(req.params.itemId);
    const ck = await db.query('SELECT status FROM assembly_orders WHERE id=$1', [asmId]);
    if (!ck.rows[0]) return reply.code(404).send({ error: 'Не найдена' });
    if (['in_transit', 'closed', 'returned'].includes(ck.rows[0].status)) {
      return reply.code(409).send({ error: 'Сборка уже отправлена/закрыта' });
    }
    const it = await db.query('SELECT * FROM assembly_items WHERE id=$1 AND assembly_id=$2', [itemId, asmId]);
    if (!it.rows[0]) return reply.code(404).send({ error: 'Не найдена' });
    const row = it.rows[0];
    // уже на паллете → unpick queue, не hard-delete
    if (row.packed || row.pallet_id) {
      const { rows } = await db.query(
        `UPDATE assembly_items SET line_status='unpick_requested' WHERE id=$1 RETURNING *`, [itemId]);
      const whs = await db.query("SELECT id FROM users WHERE role='WAREHOUSE' AND is_active=true");
      for (const w of whs.rows) {
        createNotification(db, {
          user_id: w.id, title: '↩ Убрать с паллета',
          message: row.name, type: 'assembly', link: `#/assembly?id=${asmId}`
        });
      }
      return { success: true, unpick_requested: true, item: rows[0] };
    }
    const { rows } = await db.query('DELETE FROM assembly_items WHERE id=$1 AND assembly_id=$2 RETURNING id', [itemId, asmId]);
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдена' });
    return { success: true, unpick_requested: false };
  });

  // Change-order: add from stock / procure after cart submit
  fastify.post('/:id/change-order', { preHandler: [fastify.requireRoles(ALL_ROLES)] }, async (req, reply) => {
    const asmId = parseInt(req.params.id);
    const b = req.body || {};
    const ck = await db.query('SELECT * FROM assembly_orders WHERE id=$1', [asmId]);
    if (!ck.rows[0]) return reply.code(404).send({ error: 'Не найдена' });
    if (['in_transit', 'closed', 'returned'].includes(ck.rows[0].status)) {
      return reply.code(409).send({ error: 'Слишком поздно для правок' });
    }
    const action = b.action; // add_stock | procure | remove
    if (action === 'remove' && b.item_id) {
      const it = await db.query('SELECT * FROM assembly_items WHERE id=$1 AND assembly_id=$2', [b.item_id, asmId]);
      if (!it.rows[0]) return reply.code(404).send({ error: 'Не найдена' });
      if (it.rows[0].packed || it.rows[0].pallet_id) {
        const { rows } = await db.query(`UPDATE assembly_items SET line_status='unpick_requested' WHERE id=$1 RETURNING *`, [b.item_id]);
        const whs = await db.query("SELECT id FROM users WHERE role='WAREHOUSE' AND is_active=true");
        for (const w of whs.rows) {
          createNotification(db, { user_id: w.id, title: '↩ Убрать с паллета', message: it.rows[0].name, type: 'assembly', link: '#/warehouse-v2' });
        }
        return { item: rows[0], unpick_requested: true };
      }
      await db.query('DELETE FROM assembly_items WHERE id=$1', [b.item_id]);
      return { success: true, unpick_requested: false };
    }
    if (action === 'add_stock' || action === 'new_position') {
      if (!b.name && !b.product_id && !b.equipment_id) return reply.code(400).send({ error: 'Нужна позиция' });
      const { rows } = await db.query(
        `INSERT INTO assembly_items(assembly_id,product_id,equipment_id,name,unit,quantity,source,line_status)
         VALUES($1,$2,$3,$4,$5,$6,'change_order',$7) RETURNING *`,
        [asmId, b.product_id || null, b.equipment_id || null, b.name || 'Позиция', b.unit || 'шт', b.quantity || 1,
          action === 'new_position' ? 'awaiting_procurement' : 'reserved']);
      return { item: rows[0] };
    }
    if (action === 'procure') {
      const { rows } = await db.query(
        `INSERT INTO assembly_items(assembly_id,product_id,name,unit,quantity,source,line_status)
         VALUES($1,$2,$3,$4,$5,'change_order','awaiting_procurement') RETURNING *`,
        [asmId, b.product_id || null, b.name || 'Дозаказ', b.unit || 'шт', b.quantity || 1]);
      return { item: rows[0] };
    }
    return reply.code(400).send({ error: 'action: add_stock | procure | remove' });
  });

  // bulk site receipt (also on warehouse-ops; mirror for assembly UI)
  fastify.post('/:id/site-receipt-bulk', { preHandler: [fastify.requireRoles(ALL_ROLES)] }, async (req, reply) => {
    const { item_ids, note } = req.body || {};
    const ids = Array.isArray(item_ids) ? item_ids : [];
    let sql = `UPDATE assembly_items SET received=true, received_at=NOW(), received_by=$1,
      notes=COALESCE(notes,'') || $2 WHERE assembly_id=$3`;
    const p = [req.user.id, note ? `\n[site-bulk] ${note}` : '\n[site-bulk]', req.params.id];
    if (ids.length) { sql += ` AND id = ANY($4)`; p.push(ids); }
    sql += ' RETURNING id';
    const { rows } = await db.query(sql, p);
    return { updated: rows.length, ids: rows.map(r => r.id) };
  });

  fastify.put('/:id/items/:itemId/pack', { preHandler: [fastify.requireRoles(ASSEMBLY_MANAGERS)] }, async (req, reply) => {
    const asmId = parseInt(req.params.id);
    const sc = await db.query('SELECT status FROM assembly_orders WHERE id=$1', [asmId]);
    if (!sc.rows[0]) return reply.code(404).send({ error: 'Не найдена' });
    if (!['confirmed', 'packing'].includes(sc.rows[0].status)) return reply.code(409).send({ error: 'Только confirmed/packing' });
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(`UPDATE assembly_items SET packed=true,packed_at=NOW(),packed_by=$1 WHERE id=$2 AND assembly_id=$3 RETURNING *`,
        [req.user.id, req.params.itemId, asmId]);
      if (!rows[0]) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Не найдена' }); }
      await checkPackingProgress(client, asmId);
      await client.query('COMMIT'); return { item: rows[0] };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  });

  fastify.put('/:id/items/:itemId/return-status', { preHandler: [fastify.requireRoles([...PM_ROLES, ...WH_ROLES])] }, async (req, reply) => {
    const { return_status, return_reason } = req.body;
    if (!['returning', 'damaged', 'lost', 'consumed'].includes(return_status)) return reply.code(400).send({ error: 'Неверный return_status' });
    if (['damaged', 'lost'].includes(return_status) && !return_reason) return reply.code(400).send({ error: 'Причина обязательна' });
    const { rows } = await db.query('UPDATE assembly_items SET return_status=$1,return_reason=$2 WHERE id=$3 AND assembly_id=$4 RETURNING *',
      [return_status, return_reason || null, req.params.itemId, req.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдена' }); return { item: rows[0] };
  });

  fastify.put('/:id/items/:itemId/assign-pallet', { preHandler: [fastify.requireRoles(ASSEMBLY_MANAGERS)] }, async (req, reply) => {
    const { rows } = await db.query('UPDATE assembly_items SET pallet_id=$1 WHERE id=$2 AND assembly_id=$3 RETURNING *',
      [req.body.pallet_id, req.params.itemId, req.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдена' }); return { item: rows[0] };
  });

  fastify.put('/:id/items/:itemId/unassign-pallet', { preHandler: [fastify.requireRoles(ASSEMBLY_MANAGERS)] }, async (req, reply) => {
    const { rows } = await db.query('UPDATE assembly_items SET pallet_id=NULL WHERE id=$1 AND assembly_id=$2 RETURNING *', [req.params.itemId, req.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдена' }); return { item: rows[0] };
  });

  // ═══ ПАЛЛЕТОМЕСТА ═══

  fastify.get('/:id/pallets', { preHandler: [fastify.authenticate] }, async (req) => {
    const { rows } = await db.query('SELECT * FROM assembly_pallets WHERE assembly_id=$1 ORDER BY pallet_number', [req.params.id]);
    return { pallets: rows };
  });

  fastify.post('/:id/pallets', { preHandler: [fastify.requireRoles(ASSEMBLY_MANAGERS)] }, async (req) => {
    const asmId = parseInt(req.params.id);
    const { label, notes, capacity_items, capacity_kg } = req.body;
    // Ретрай при гонке номера паллета (UNIQUE assembly_id,pallet_number).
    for (let attempt = 0; attempt < 5; attempt++) {
      const mx = await db.query('SELECT COALESCE(MAX(pallet_number),0)+1 as n FROM assembly_pallets WHERE assembly_id=$1', [asmId]);
      try {
        const { rows } = await db.query('INSERT INTO assembly_pallets(assembly_id,pallet_number,label,notes,capacity_items,capacity_kg)VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
          [asmId, mx.rows[0].n, label || null, notes || null, capacity_items || null, capacity_kg || null]);
        return { pallet: rows[0] };
      } catch (e) { if (e.code === '23505' && attempt < 4) continue; throw e; }
    }
  });

  fastify.put('/:id/pallets/:pid', { preHandler: [fastify.requireRoles(ASSEMBLY_MANAGERS)] }, async (req, reply) => {
    const allowed = ['label', 'notes', 'capacity_items', 'capacity_kg'];
    const upd = [], vals = []; let i = 1;
    for (const k of allowed) { if (req.body[k] !== undefined) { upd.push(`${k}=$${i++}`); vals.push(req.body[k]); } }
    if (!upd.length) return reply.code(400).send({ error: 'Нет данных' });
    vals.push(req.params.pid, req.params.id);
    const { rows } = await db.query(`UPDATE assembly_pallets SET ${upd.join(',')} WHERE id=$${i} AND assembly_id=$${i+1} RETURNING *`, vals);
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдено' }); return { pallet: rows[0] };
  });

  fastify.delete('/:id/pallets/:pid', { preHandler: [fastify.requireRoles(ASSEMBLY_MANAGERS)] }, async (req, reply) => {
    await db.query('UPDATE assembly_items SET pallet_id=NULL WHERE pallet_id=$1', [req.params.pid]);
    const { rows } = await db.query('DELETE FROM assembly_pallets WHERE id=$1 AND assembly_id=$2 RETURNING id', [req.params.pid, req.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдено' }); return { success: true };
  });

  fastify.put('/:id/pallets/:pid/pack', { preHandler: [fastify.requireRoles(ASSEMBLY_MANAGERS)] }, async (req, reply) => {
    const asmId = parseInt(req.params.id);
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query("UPDATE assembly_pallets SET status='packed',packed_at=NOW() WHERE id=$1 AND assembly_id=$2 RETURNING *",
        [req.params.pid, asmId]);
      if (!rows[0]) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Не найдено' }); }
      await checkPackingProgress(client, asmId);
      await client.query('COMMIT'); return { pallet: rows[0] };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  });

  // ═══ QR + PDF ═══

  fastify.get('/:id/pallets/:pid/qr', { preHandler: [
    async (request, reply) => {
      if (!request.headers.authorization && request.query.token) {
        request.headers.authorization = 'Bearer ' + request.query.token;
      }
    },
    fastify.authenticate
  ] }, async (req, reply) => {
    const { rows } = await db.query('SELECT qr_uuid FROM assembly_pallets WHERE id=$1 AND assembly_id=$2', [req.params.pid, req.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    const svg = await QRCode.toString(rows[0].qr_uuid, { type: 'svg', width: 200 });
    reply.header('Content-Type', 'image/svg+xml').send(svg);
  });

  fastify.get('/:id/pallets/:pid/label-pdf', { preHandler: [
    async (request, reply) => {
      if (!request.headers.authorization && request.query.token) {
        request.headers.authorization = 'Bearer ' + request.query.token;
      }
    },
    fastify.authenticate
  ] }, async (req, reply) => {
    const PDFDocument = require('pdfkit'); const path = require('path'); const fs = require('fs');
    const FP = path.join(__dirname, '../../public/assets/fonts/DejaVuSans.ttf');
    const FB = path.join(__dirname, '../../public/assets/fonts/DejaVuSans-Bold.ttf');
    const plt = await db.query(`SELECT ap.*,ao.title as at,ao.destination,w.work_title FROM assembly_pallets ap
      JOIN assembly_orders ao ON ap.assembly_id=ao.id LEFT JOIN works w ON ao.work_id=w.id WHERE ap.id=$1 AND ap.assembly_id=$2`, [req.params.pid, req.params.id]);
    if (!plt.rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    const items = await db.query('SELECT name,quantity,unit FROM assembly_items WHERE pallet_id=$1 ORDER BY sort_order,id', [req.params.pid]);
    const p = plt.rows[0];
    const qrPng = await QRCode.toBuffer(p.qr_uuid, { type: 'png', width: 150, margin: 1 });
    const doc = new PDFDocument({ size: 'A4', margin: 40 }); const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => { reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `attachment; filename="pallet_${p.id}.pdf"`).send(Buffer.concat(chunks)); });
    if (fs.existsSync(FB)) doc.registerFont('B', FB); if (fs.existsSync(FP)) doc.registerFont('R', FP);
    doc.font(fs.existsSync(FB) ? 'B' : 'Helvetica-Bold').fontSize(20).text('АСГАРД СЕРВИС', { align: 'center' });
    doc.fontSize(16).text(`Паллет №${p.pallet_number}`, { align: 'center' }); doc.moveDown();
    doc.font(fs.existsSync(FP) ? 'R' : 'Helvetica').fontSize(12);
    doc.text(`Объект: ${p.destination || p.work_title || '—'}`);
    doc.text(`Ведомость: ${p.at || '#' + p.assembly_id}`);
    if (p.label) doc.text(`Метка: ${p.label}`); doc.moveDown();
    doc.image(qrPng, doc.page.width / 2 - 75, doc.y, { width: 150 }); doc.moveDown(8);
    if (items.rows.length) {
      doc.font(fs.existsSync(FB) ? 'B' : 'Helvetica-Bold').text('Содержимое:', { underline: true });
      doc.font(fs.existsSync(FP) ? 'R' : 'Helvetica');
      items.rows.forEach((it, idx) => doc.text(`${idx + 1}. ${it.name} — ${it.quantity} ${it.unit}`));
    }
    doc.end();
  });

  fastify.get('/:id/checklist-pdf', { preHandler: [
    async (request, reply) => {
      if (!request.headers.authorization && request.query.token) {
        request.headers.authorization = 'Bearer ' + request.query.token;
      }
    },
    fastify.authenticate
  ] }, async (req, reply) => {
    const PDFDocument = require('pdfkit'); const path = require('path'); const fs = require('fs');
    const FP = path.join(__dirname, '../../public/assets/fonts/DejaVuSans.ttf');
    const FB = path.join(__dirname, '../../public/assets/fonts/DejaVuSans-Bold.ttf');
    const asm = await db.query('SELECT ao.*,w.work_title FROM assembly_orders ao LEFT JOIN works w ON ao.work_id=w.id WHERE ao.id=$1', [req.params.id]);
    if (!asm.rows[0]) return reply.code(404).send({ error: 'Не найдена' });
    const items = await db.query(`SELECT ai.*,ap.pallet_number FROM assembly_items ai LEFT JOIN assembly_pallets ap ON ai.pallet_id=ap.id
      WHERE ai.assembly_id=$1 ORDER BY ap.pallet_number NULLS LAST,ai.sort_order,ai.id`, [req.params.id]);
    const doc = new PDFDocument({ size: 'A4', margin: 40 }); const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => { reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `attachment; filename="checklist_${req.params.id}.pdf"`).send(Buffer.concat(chunks)); });
    if (fs.existsSync(FB)) doc.registerFont('B', FB); if (fs.existsSync(FP)) doc.registerFont('R', FP);
    doc.font(fs.existsSync(FB) ? 'B' : 'Helvetica-Bold').fontSize(16).text(`Чек-лист: ${asm.rows[0].title || '#' + asm.rows[0].id}`, { align: 'center' });
    doc.fontSize(10).text(`Работа: ${asm.rows[0].work_title || '—'}`, { align: 'center' }); doc.moveDown();
    doc.font(fs.existsSync(FP) ? 'R' : 'Helvetica').fontSize(10);
    items.rows.forEach((it, idx) => {
      const ps = it.pallet_number ? ` [П${it.pallet_number}]` : '';
      doc.text(`${it.packed ? '☑' : '☐'} ${idx + 1}. ${it.name} — ${it.quantity} ${it.unit}${ps}`);
    });
    doc.end();
  });

  fastify.get('/:id/print-all', { preHandler: [fastify.authenticate] }, async (req) => {
    const { rows } = await db.query('SELECT id,pallet_number,qr_uuid,label FROM assembly_pallets WHERE assembly_id=$1 ORDER BY pallet_number', [req.params.id]);
    return { pallets: rows };
  });

  // ═══ ОТПРАВКА / ПРИЁМКА ═══

  fastify.put('/:id/send', { preHandler: [fastify.requireRoles([...PM_ROLES, ...WH_ROLES])] }, async (req, reply) => {
    const id = parseInt(req.params.id);
    const ck = await db.query('SELECT * FROM assembly_orders WHERE id=$1', [id]);
    if (!ck.rows[0]) return reply.code(404).send({ error: 'Не найдена' });
    if (!['confirmed', 'packing', 'packed'].includes(ck.rows[0].status)) return reply.code(409).send({ error: 'Нужен confirmed/packing/packed' });
    await db.query("UPDATE assembly_pallets SET status='shipped',shipped_at=NOW() WHERE assembly_id=$1 AND status='packed'", [id]);
    const { rows } = await db.query("UPDATE assembly_orders SET status='in_transit',actual_sent_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *", [id]);
    const pc = await db.query('SELECT COUNT(*) as cnt FROM assembly_pallets WHERE assembly_id=$1', [id]);
    if (rows[0].created_by) createNotification(db, { user_id: rows[0].created_by, title: '🚛 Отправлено',
      message: `На «${rows[0].destination || 'объект'}» — ${pc.rows[0].cnt} мест`, type: 'assembly', link: `#/assembly?id=${id}` });
    return { item: rows[0] };
  });

  fastify.post('/:id/pallets/:pid/scan', { preHandler: [fastify.requireRoles([...PM_ROLES, ...WH_ROLES, ...DIR_ROLES])] }, async (req, reply) => {
    const { lat, lon } = req.body || {};
    const { rows } = await db.query(`UPDATE assembly_pallets SET status='received',received_at=NOW(),received_by=$1,scanned_lat=$2,scanned_lon=$3
      WHERE id=$4 AND assembly_id=$5 RETURNING *`, [req.user.id, lat || null, lon || null, req.params.pid, req.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    const all = await db.query('SELECT status FROM assembly_pallets WHERE assembly_id=$1', [req.params.id]);
    if (all.rows.length > 0 && all.rows.every(p => p.status === 'received'))
      await db.query("UPDATE assembly_orders SET status='received',actual_received_at=NOW(),updated_at=NOW() WHERE id=$1", [req.params.id]);
    return { pallet: rows[0] };
  });

  fastify.put('/:id/receive-all', { preHandler: [fastify.requireRoles(WH_ROLES)] }, async (req, reply) => {
    const asmId = parseInt(req.params.id);
    const asm = await db.query('SELECT * FROM assembly_orders WHERE id=$1', [asmId]);
    if (!asm.rows[0]) return reply.code(404).send({ error: 'Не найдена' });
    if (asm.rows[0].type !== 'demobilization') return reply.code(409).send({ error: 'Только для демобилизации' });
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const items = await client.query('SELECT * FROM assembly_items WHERE assembly_id=$1', [asmId]);
      let retCnt = 0, dmgCnt = 0;
      for (const item of items.rows) {
        await client.query('UPDATE assembly_items SET received=true,received_at=NOW(),received_by=$1 WHERE id=$2', [req.user.id, item.id]);
        if (!item.equipment_id) {
          const rs = item.return_status || 'returning';
          // C3: расходник из WMS (есть product_id) — возвращаем КОЛИЧЕСТВОМ в stock либо списываем с причиной.
          if (item.product_id) {
            const wh = await client.query("SELECT id FROM warehouses WHERE is_main=true LIMIT 1");
            const whId = wh.rows[0]?.id || null;
            if (rs === 'returning') {
              // Надёжный upsert без зависимости от NULL-семантики UNIQUE: ищем слот (location NULL), иначе вставляем.
              const ex = await client.query('SELECT id FROM stock WHERE product_id=$1 AND warehouse_id=$2 AND location_id IS NULL FOR UPDATE', [item.product_id, whId]);
              if (ex.rows[0]) await client.query('UPDATE stock SET quantity=quantity+$1, updated_at=NOW() WHERE id=$2', [item.quantity, ex.rows[0].id]);
              else await client.query('INSERT INTO stock(product_id,warehouse_id,location_id,quantity,unit) VALUES($1,$2,NULL,$3,$4)', [item.product_id, whId, item.quantity, item.unit || 'шт']);
              await client.query(
                `INSERT INTO stock_movements(product_id,to_warehouse_id,qty,unit,movement_type,ref_type,ref_id,reason,created_by)
                 VALUES($1,$2,$3,$4,'return','assembly',$5,$6,$7)`,
                [item.product_id, whId, item.quantity, item.unit || 'шт', asmId, 'Возврат с объекта, демоб #' + asmId, req.user.id]);
              retCnt++;
            } else {
              const reason = rs === 'damaged' ? 'Сломано' : rs === 'lost' ? 'Утеряно' : 'Израсходовано';
              await client.query(
                `INSERT INTO stock_movements(product_id,from_warehouse_id,qty,unit,movement_type,ref_type,ref_id,reason,created_by)
                 VALUES($1,$2,$3,$4,'writeoff','assembly',$5,$6,$7)`,
                [item.product_id, whId, item.quantity, item.unit || 'шт', asmId, `${reason}: ${item.return_reason || '—'} (демоб #${asmId})`, req.user.id]);
              dmgCnt++;
            }
            continue;
          }
          // Куплено на объекте (поштучно, без каталога) — оприходуем как новую единицу equipment.
          if (item.source === 'on_site_purchase' && rs === 'returning') {
            const qr = randomUUID(); const wh = await client.query("SELECT id FROM warehouses WHERE is_main=true LIMIT 1");
            const invNum='INV-'+Date.now().toString(36).toUpperCase();
            await client.query(`INSERT INTO equipment(name,inventory_number,quantity,unit,status,warehouse_id,qr_uuid,qr_code,product_id,notes)VALUES($1,$2,$3,$4,'on_warehouse',$5,$6,$7,$8,$9)`,
              [item.name, invNum, item.quantity, item.unit, wh.rows[0]?.id || null, qr, qr, item.product_id || null, 'Купл. на объекте, демоб #' + asmId]);
            retCnt++;
          }
          continue;
        }
        const rs = item.return_status || 'returning';
        if (rs === 'returning') {
          await client.query("UPDATE equipment SET status='on_warehouse',current_holder_id=NULL,current_object_id=NULL WHERE id=$1", [item.equipment_id]);
          await client.query(`INSERT INTO equipment_movements(equipment_id,movement_type,to_warehouse_id,notes,created_by)
            VALUES($1,'return',(SELECT warehouse_id FROM equipment WHERE id=$1),$2,$3)`, [item.equipment_id, 'Возврат демоб #' + asmId, req.user.id]);
          // W1: снять активный резерв этой единицы (вернулась на склад — резерв больше не нужен).
          await client.query("UPDATE equipment_reservations SET status='released' WHERE equipment_id=$1 AND status='active'", [item.equipment_id]);
          retCnt++;
        } else {
          await client.query("UPDATE equipment SET status='written_off' WHERE id=$1", [item.equipment_id]);
          const reason = rs === 'damaged' ? 'Сломано' : rs === 'lost' ? 'Утеряно' : 'Израсходовано';
          await client.query(`INSERT INTO equipment_movements(equipment_id,movement_type,notes,created_by)VALUES($1,'write_off',$2,$3)`,
            [item.equipment_id, `${reason}: ${item.return_reason || '—'} (демоб #${asmId})`, req.user.id]);
          dmgCnt++;
        }
      }
      await client.query("UPDATE assembly_orders SET status='returned',actual_received_at=NOW(),updated_at=NOW() WHERE id=$1", [asmId]);
      await client.query('COMMIT');
      const whs = await db.query("SELECT id FROM users WHERE role='WAREHOUSE' AND is_active=true");
      for (const w of whs.rows) createNotification(db, { user_id: w.id, title: '📦 Демоб принята',
        message: `${retCnt} возвр., ${dmgCnt} спис.`, type: 'assembly', link: `#/assembly?id=${asmId}` });
      return { success: true, status: 'returned', returned: retCnt, written_off: dmgCnt };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  });

  fastify.post('/:id/create-demob', { preHandler: [fastify.requireRoles([...PM_ROLES, ...WH_ROLES])] }, async (req, reply) => {
    const mobId = parseInt(req.params.id);
    const mob = await db.query('SELECT * FROM assembly_orders WHERE id=$1', [mobId]);
    if (!mob.rows[0]) return reply.code(404).send({ error: 'Не найдена' });
    if (mob.rows[0].type !== 'mobilization') return reply.code(409).send({ error: 'Только из мобилизации' });
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(`INSERT INTO assembly_orders(work_id,type,title,destination,source_assembly_id,notes,created_by)
        VALUES($1,'demobilization',$2,$3,$4,$5,$6) RETURNING *`,
        [mob.rows[0].work_id, 'Демоб: ' + (mob.rows[0].title || '#' + mobId), mob.rows[0].destination, mobId, 'Из моб #' + mobId, req.user.id]);
      const dId = rows[0].id;
      const mi = await client.query('SELECT * FROM assembly_items WHERE assembly_id=$1', [mobId]);
      for (const it of mi.rows)
        await client.query(`INSERT INTO assembly_items(assembly_id,equipment_id,procurement_item_id,name,article,unit,quantity,source,return_status,sort_order,notes)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,'returning',$9,$10)`,
          [dId, it.equipment_id, it.procurement_item_id, it.name, it.article, it.unit, it.quantity, it.source, it.sort_order, it.notes]);
      await client.query('COMMIT');
      const det = await db.query('SELECT * FROM assembly_orders WHERE id=$1', [dId]);
      const di = await db.query('SELECT * FROM assembly_items WHERE assembly_id=$1', [dId]);
      return { item: det.rows[0], items: di.rows };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  });

  fastify.get('/:id/export-excel', { preHandler: [
    async (request, reply) => {
      if (!request.headers.authorization && request.query.token) {
        request.headers.authorization = 'Bearer ' + request.query.token;
      }
    },
    fastify.authenticate
  ] }, async (req, reply) => {
    const id = parseInt(req.params.id); const ExcelJS = require('exceljs');
    const asm = await db.query('SELECT ao.*,w.work_title FROM assembly_orders ao LEFT JOIN works w ON ao.work_id=w.id WHERE ao.id=$1', [id]);
    if (!asm.rows[0]) return reply.code(404).send({ error: 'Не найдена' });
    const items = await db.query(`SELECT ai.*,ap.pallet_number FROM assembly_items ai LEFT JOIN assembly_pallets ap ON ai.pallet_id=ap.id
      WHERE ai.assembly_id=$1 ORDER BY ap.pallet_number NULLS LAST,ai.sort_order,ai.id`, [id]);
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Ведомость #' + id);
    ws.columns = [{ header: '№', key: 'n', width: 6 }, { header: 'Наименование', key: 'name', width: 35 }, { header: 'Артикул', key: 'article', width: 15 },
      { header: 'Ед.', key: 'unit', width: 8 }, { header: 'Кол-во', key: 'quantity', width: 10 }, { header: 'Паллет', key: 'pallet', width: 10 },
      { header: 'Собрано', key: 'packed', width: 10 }, { header: 'Источник', key: 'source', width: 18 }];
    items.rows.forEach((it, idx) => ws.addRow({ n: idx + 1, name: it.name, article: it.article, unit: it.unit, quantity: it.quantity,
      pallet: it.pallet_number || '—', packed: it.packed ? 'Да' : 'Нет', source: it.source }));
    const buf = await wb.xlsx.writeBuffer();
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="assembly_${id}.xlsx"`); return reply.send(Buffer.from(buf));
  });

  // ═══ БЫСТРОЕ ДОБАВЛЕНИЕ ПОЗИЦИИ «ЗА 10 СЕК» (рабочий/РП/кладовщик) ═══
  // Если позиции нет в каталоге — заводим products(is_draft=true) и сразу кладём в сбор.
  // source: manual | on_site_purchase | from_warehouse. При наличии pallet_id — сразу на паллет.
  fastify.post('/:id/items/quick', { preHandler: [fastify.requireRoles(ASSEMBLY_MANAGERS)] }, async (req, reply) => {
    const asmId = parseInt(req.params.id);
    const ck = await db.query('SELECT status FROM assembly_orders WHERE id=$1', [asmId]);
    if (!ck.rows[0]) return reply.code(404).send({ error: 'Не найдена' });
    if (!['draft', 'confirmed', 'packing'].includes(ck.rows[0].status)) return reply.code(409).send({ error: 'Нельзя добавлять в текущем статусе' });
    const { name, unit, quantity, source, pallet_id, product_id, category_id, ean, packed } = req.body;
    if (!name || !name.trim()) return reply.code(400).send({ error: 'name обязателен' });
    const src = ['manual', 'on_site_purchase', 'from_warehouse'].includes(source) ? source : 'manual';
    const nm = name.trim();
    const eanN = (ean || '').trim() || null;
    // 1) Резолв/создание каталога ВНЕ транзакции — конфликт UNIQUE (23505) не должен ронять весь сбор.
    let pid = product_id || null;
    if (!pid && eanN) { const e = await db.query('SELECT id FROM products WHERE ean=$1 AND deleted_at IS NULL LIMIT 1', [eanN]); pid = e.rows[0]?.id || null; }
    if (!pid) { const n = await db.query('SELECT id FROM products WHERE lower(name)=lower($1) AND deleted_at IS NULL LIMIT 1', [nm]); pid = n.rows[0]?.id || null; }
    if (!pid) {
      const cf = src === 'on_site_purchase' ? 'on_site_purchase' : (src === 'from_warehouse' ? 'from_warehouse' : 'manual');
      try {
        const np = await db.query(`INSERT INTO products(name,unit,category_id,ean,is_draft,created_from,created_by) VALUES($1,$2,$3,$4,true,$5,$6) RETURNING id`,
          [nm, unit || 'шт', category_id || null, eanN, cf, req.user.id]);
        pid = np.rows[0].id;
      } catch (e) { if (e.code === '23505') { const r = await db.query('SELECT id FROM products WHERE lower(name)=lower($1) AND deleted_at IS NULL LIMIT 1', [nm]); pid = r.rows[0]?.id; } else throw e; }
    }
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      // 2) Кладём позицию в сбор
      const { rows } = await client.query(
        `INSERT INTO assembly_items(assembly_id,product_id,pallet_id,name,unit,quantity,source,packed,packed_at,packed_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,${packed ? 'NOW()' : 'NULL'},$9) RETURNING *`,
        [asmId, pid, pallet_id || null, nm, unit || 'шт', quantity || 1, src, !!packed, packed ? req.user.id : null]);
      if (packed && pallet_id) await checkPackingProgress(client, asmId);
      await client.query('COMMIT');
      return { item: rows[0], product_id: pid };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  });

  // ═══ LIVE-ПРОГРЕСС (несколько сборщиков одновременно) ═══
  // Кто что собрал + сводка по паллетам. Для поллинга с фронта рабочих.
  fastify.get('/:id/live', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const id = parseInt(req.params.id); if (isNaN(id)) return reply.code(400).send({ error: 'Bad ID' });
    const o = await db.query('SELECT id,status,updated_at,destination,planned_date,title FROM assembly_orders WHERE id=$1', [id]);
    if (!o.rows[0]) return reply.code(404).send({ error: 'Не найдена' });
    const totals = await db.query(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE packed) AS packed,
      COUNT(*) FILTER (WHERE pallet_id IS NOT NULL) AS assigned FROM assembly_items WHERE assembly_id=$1`, [id]);
    const byUser = await db.query(`SELECT u.id,u.name, COUNT(*) AS packed_count, MAX(ai.packed_at) AS last_at
      FROM assembly_items ai JOIN users u ON ai.packed_by=u.id
      WHERE ai.assembly_id=$1 AND ai.packed=true GROUP BY u.id,u.name ORDER BY packed_count DESC`, [id]);
    const pallets = await db.query(`SELECT ap.id,ap.pallet_number,ap.status,ap.label,ap.capacity_kg,
      (SELECT COUNT(*) FROM assembly_items ai WHERE ai.pallet_id=ap.id) AS items,
      (SELECT COUNT(*) FROM assembly_items ai WHERE ai.pallet_id=ap.id AND ai.packed) AS packed
      FROM assembly_pallets ap WHERE ap.assembly_id=$1 ORDER BY ap.pallet_number`, [id]);
    const kpi = await computeAssemblyKpi(db, id);
    return {
      status: o.rows[0].status,
      updated_at: o.rows[0].updated_at,
      destination: o.rows[0].destination,
      planned_date: o.rows[0].planned_date,
      title: o.rows[0].title,
      totals: totals.rows[0],
      by_user: byUser.rows,
      pallets: pallets.rows,
      ready_pct: kpi.ready_pct,
      packed_weight_kg: kpi.packed_weight_kg,
      pallets_count: kpi.pallets_count,
      kpi
    };
  });

  // ═══ РАЗБОР ВОЗВРАТА С ОБЪЕКТА (план vs факт, расхождения) ═══
  // body.items: [{ item_id, received_qty, return_status?, return_reason? }]
  // body.extras: [{ name, quantity, unit, ean?, product_id? }] — излишек/неизвестное (приехало больше)
  // Недостача (received_qty < expected) → отмечаем; излишек → оприходуем находкой (over_received).
  fastify.post('/:id/reconcile', { preHandler: [fastify.requireRoles([...PM_ROLES, ...WH_ROLES])] }, async (req, reply) => {
    const asmId = parseInt(req.params.id);
    const asm = await db.query('SELECT * FROM assembly_orders WHERE id=$1', [asmId]);
    if (!asm.rows[0]) return reply.code(404).send({ error: 'Не найдена' });
    const { items = [], extras = [] } = req.body || {};
    const client = await db.pool.connect();
    let shortages = 0, extrasCreated = 0;
    try {
      await client.query('BEGIN');
      // 1) Сверка ожидаемых позиций
      for (const it of items) {
        const cur = await client.query('SELECT * FROM assembly_items WHERE id=$1 AND assembly_id=$2', [it.item_id, asmId]);
        if (!cur.rows[0]) continue;
        const expected = parseFloat(cur.rows[0].expected_quantity ?? cur.rows[0].quantity);
        const got = it.received_qty != null ? parseFloat(it.received_qty) : expected;
        let rs = it.return_status || null;
        if (got < expected && !rs) rs = 'lost'; // недостача без явной причины → утеря
        await client.query(
          `UPDATE assembly_items SET received=true, received_at=NOW(), received_by=$1,
             quantity=$2, return_status=COALESCE($3,return_status), return_reason=COALESCE($4,return_reason)
           WHERE id=$5`,
          [req.user.id, got, rs, it.return_reason || null, it.item_id]);
        if (got < expected) shortages++;
      }
      // 2) Излишки/неизвестное — заводим позиции (over_received) + каталог-черновик
      for (const ex of extras) {
        if (!ex.name || !ex.name.trim()) continue;
        const nm = ex.name.trim();
        let pid = ex.product_id || null;
        if (!pid) { const f = await client.query('SELECT id FROM products WHERE lower(name)=lower($1) AND deleted_at IS NULL LIMIT 1', [nm]); pid = f.rows[0]?.id || null; }
        if (!pid) {
          try {
            const np = await client.query(`INSERT INTO products(name,unit,ean,is_draft,created_from,created_by) VALUES($1,$2,$3,true,'found',$4) RETURNING id`,
              [nm, ex.unit || 'шт', ex.ean || null, req.user.id]);
            pid = np.rows[0].id;
          } catch (e) { if (e.code === '23505') { const r = await client.query('SELECT id FROM products WHERE lower(name)=lower($1) AND deleted_at IS NULL LIMIT 1', [nm]); pid = r.rows[0]?.id; } else throw e; }
        }
        await client.query(
          `INSERT INTO assembly_items(assembly_id,product_id,name,unit,quantity,source,over_received,received,received_at,received_by)
           VALUES($1,$2,$3,$4,$5,'manual',true,true,NOW(),$6)`,
          [asmId, pid, nm, ex.unit || 'шт', ex.quantity || 1, req.user.id]);
        extrasCreated++;
      }
      await client.query('COMMIT');
      return { success: true, shortages, extras_created: extrasCreated };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  });
}

module.exports = routes;
