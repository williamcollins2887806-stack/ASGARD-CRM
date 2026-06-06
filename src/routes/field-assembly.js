'use strict';
/**
 * ASGARD Field — Сбор паллет рабочими (Field PWA).
 * Регистрируется в index.js под префиксом /api/field/assembly.
 *
 * Тонкий слой над модулем assembly для рабочих (field JWT через fastify.fieldAuthenticate).
 * Доступ — по факту привязки рабочего к работе (employee_assignments).
 * Полноценный сбор: ведомости моей работы, паллеты, добавление позиции (в т.ч. новой
 * «за 10 сек» с авто-черновиком каталога), раскидка по паллетам, отметка собранного,
 * скан QR паллета (приёмка с GPS). Несколько рабочих собирают одновременно (live-прогресс).
 * ═══════════════════════════════════════════════════════════════════════════
 */

const { randomUUID } = require('crypto');

async function routes(fastify) {
  const db = fastify.db;
  const auth = { preHandler: [fastify.fieldAuthenticate] };
  const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });

  // employees.user_id → users(id) для полей packed_by/received_by (FK на users).
  // fieldEmployee не содержит user_id, поэтому резолвим явно (кэш на запрос не нужен — 1 строка).
  async function resolveUserId(employeeId) {
    const r = await db.query('SELECT user_id FROM employees WHERE id=$1', [employeeId]);
    return r.rows[0]?.user_id || null;
  }

  // Проверка: привязан ли текущий рабочий к работе этой ведомости
  async function assertAccess(reply, employeeId, assemblyId) {
    const a = await db.query('SELECT id, work_id, status, type FROM assembly_orders WHERE id=$1', [assemblyId]);
    if (!a.rows[0]) { bad(reply, 'Ведомость не найдена', 404); return null; }
    const link = await db.query(
      'SELECT 1 FROM employee_assignments WHERE employee_id=$1 AND work_id=$2 LIMIT 1',
      [employeeId, a.rows[0].work_id]);
    if (!link.rows[0]) { bad(reply, 'Нет доступа к этой работе', 403); return null; }
    return a.rows[0];
  }

  async function checkPackingProgress(c, asmId) {
    const ai = await c.query('SELECT packed FROM assembly_items WHERE assembly_id=$1', [asmId]);
    const ap = await c.query('SELECT status FROM assembly_pallets WHERE assembly_id=$1', [asmId]);
    if (!ai.rows.length) return;
    const allPacked = ai.rows.every(i => i.packed);
    const anyPacked = ai.rows.some(i => i.packed);
    const allPalletsPacked = ap.rows.length > 0 && ap.rows.every(p => p.status === 'packed');
    const cur = await c.query('SELECT status FROM assembly_orders WHERE id=$1', [asmId]);
    const st = cur.rows[0]?.status;
    if (allPacked && allPalletsPacked && ['confirmed', 'packing'].includes(st))
      await c.query("UPDATE assembly_orders SET status='packed',updated_at=NOW() WHERE id=$1", [asmId]);
    else if (anyPacked && st === 'confirmed')
      await c.query("UPDATE assembly_orders SET status='packing',updated_at=NOW() WHERE id=$1", [asmId]);
  }

  // ── Автокомплит каталога для рабочего (field JWT) ─────────────────────────
  // Зеркалит /api/products/search, но под field-аутентификацией.
  fastify.get('/catalog-search', auth, async (req) => {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return { items: [] };
    const { rows } = await db.query(
      `SELECT p.id, p.name, p.article, p.unit, c.name AS category_name, similarity(p.name,$1) AS sim
       FROM products p LEFT JOIN product_categories c ON p.category_id=c.id
       WHERE p.deleted_at IS NULL AND (p.name ILIKE $2 OR p.name % $1)
       ORDER BY sim DESC, p.name LIMIT 12`, [q, `%${q}%`]);
    return { items: rows };
  });

  // ── Мои ведомости (по моим активным работам) ──────────────────────────────
  fastify.get('/my', auth, async (req) => {
    const empId = req.fieldEmployee.id;
    const { rows } = await db.query(`
      SELECT ao.id, ao.type, ao.title, ao.status, ao.destination, ao.planned_date, ao.work_id,
        w.work_title, w.object_name,
        (SELECT COUNT(*) FROM assembly_items ai WHERE ai.assembly_id=ao.id) AS items_count,
        (SELECT COUNT(*) FROM assembly_items ai WHERE ai.assembly_id=ao.id AND ai.packed) AS packed_count,
        (SELECT COUNT(*) FROM assembly_pallets ap WHERE ap.assembly_id=ao.id) AS pallets_count
      FROM assembly_orders ao
      JOIN works w ON ao.work_id = w.id
      WHERE ao.work_id IN (SELECT work_id FROM employee_assignments WHERE employee_id=$1)
        AND ao.status NOT IN ('closed','returned')
      ORDER BY ao.planned_date NULLS LAST, ao.id DESC`, [empId]);
    return { items: rows };
  });

  // ── Деталь ведомости (позиции + паллеты) ──────────────────────────────────
  fastify.get('/:id', auth, async (req, reply) => {
    const empId = req.fieldEmployee.id;
    const id = parseInt(req.params.id);
    const acc = await assertAccess(reply, empId, id); if (!acc) return;
    const head = await db.query(`SELECT ao.*, w.work_title, w.object_name FROM assembly_orders ao
      JOIN works w ON ao.work_id=w.id WHERE ao.id=$1`, [id]);
    const items = await db.query('SELECT * FROM assembly_items WHERE assembly_id=$1 ORDER BY sort_order,id', [id]);
    const pallets = await db.query('SELECT * FROM assembly_pallets WHERE assembly_id=$1 ORDER BY pallet_number', [id]);
    return { item: head.rows[0], items: items.rows, pallets: pallets.rows };
  });

  // ── Live-прогресс (несколько сборщиков) ───────────────────────────────────
  fastify.get('/:id/live', auth, async (req, reply) => {
    const empId = req.fieldEmployee.id;
    const id = parseInt(req.params.id);
    const acc = await assertAccess(reply, empId, id); if (!acc) return;
    const totals = await db.query(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE packed) AS packed,
      COUNT(*) FILTER (WHERE pallet_id IS NOT NULL) AS assigned FROM assembly_items WHERE assembly_id=$1`, [id]);
    const byUser = await db.query(`SELECT COALESCE(u.name, e.full_name) AS name, COUNT(*) AS packed_count, MAX(ai.packed_at) AS last_at
      FROM assembly_items ai LEFT JOIN users u ON ai.packed_by=u.id LEFT JOIN employees e ON e.user_id=ai.packed_by
      WHERE ai.assembly_id=$1 AND ai.packed=true GROUP BY COALESCE(u.name, e.full_name) ORDER BY packed_count DESC`, [id]);
    return { status: acc.status, totals: totals.rows[0], by_user: byUser.rows };
  });

  // ── Создать паллет ────────────────────────────────────────────────────────
  fastify.post('/:id/pallets', auth, async (req, reply) => {
    const empId = req.fieldEmployee.id;
    const id = parseInt(req.params.id);
    const acc = await assertAccess(reply, empId, id); if (!acc) return;
    if (!['confirmed', 'packing'].includes(acc.status)) return bad(reply, 'Сбор ещё не подтверждён РП', 409);
    const { label } = req.body || {};
    const mx = await db.query('SELECT COALESCE(MAX(pallet_number),0)+1 AS n FROM assembly_pallets WHERE assembly_id=$1', [id]);
    const { rows } = await db.query('INSERT INTO assembly_pallets(assembly_id,pallet_number,label) VALUES($1,$2,$3) RETURNING *',
      [id, mx.rows[0].n, label || null]);
    return { pallet: rows[0] };
  });

  // ── Быстрое добавление позиции «за 10 сек» (+авто-черновик каталога) ───────
  fastify.post('/:id/items/quick', auth, async (req, reply) => {
    const empId = req.fieldEmployee.id;
    const id = parseInt(req.params.id);
    const acc = await assertAccess(reply, empId, id); if (!acc) return;
    if (!['confirmed', 'packing'].includes(acc.status)) return bad(reply, 'Сбор ещё не подтверждён РП', 409);
    const { name, unit, quantity, source, pallet_id, ean, packed } = req.body || {};
    if (!name || !name.trim()) return bad(reply, 'Название обязательно');
    const src = ['manual', 'on_site_purchase', 'from_warehouse'].includes(source) ? source : 'manual';
    const userId = await resolveUserId(empId); // packed_by ссылается на users(id)
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      let pid = null;
      if (ean) { const e = await client.query('SELECT id FROM products WHERE ean=$1 AND deleted_at IS NULL LIMIT 1', [ean]); pid = e.rows[0]?.id || null; }
      if (!pid) { const n = await client.query('SELECT id FROM products WHERE lower(name)=lower($1) AND deleted_at IS NULL LIMIT 1', [name.trim()]); pid = n.rows[0]?.id || null; }
      if (!pid) {
        const cf = src === 'on_site_purchase' ? 'on_site_purchase' : (src === 'from_warehouse' ? 'from_warehouse' : 'manual');
        const np = await client.query(
          `INSERT INTO products(name,unit,ean,is_draft,created_from,created_by) VALUES($1,$2,$3,true,$4,$5) RETURNING id`,
          [name.trim(), unit || 'шт', ean || null, cf, userId]);
        pid = np.rows[0].id;
      }
      const { rows } = await client.query(
        `INSERT INTO assembly_items(assembly_id,product_id,pallet_id,name,unit,quantity,source,packed,packed_at,packed_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,${packed ? 'NOW()' : 'NULL'},$9) RETURNING *`,
        [id, pid, pallet_id || null, name.trim(), unit || 'шт', quantity || 1, src, !!packed, packed ? userId : null]);
      if (packed) await checkPackingProgress(client, id);
      await client.query('COMMIT');
      return { item: rows[0], product_id: pid };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  });

  // ── Положить позицию на паллет / снять ────────────────────────────────────
  fastify.put('/:id/items/:itemId/pallet', auth, async (req, reply) => {
    const empId = req.fieldEmployee.id;
    const id = parseInt(req.params.id);
    const acc = await assertAccess(reply, empId, id); if (!acc) return;
    const { rows } = await db.query('UPDATE assembly_items SET pallet_id=$1 WHERE id=$2 AND assembly_id=$3 RETURNING *',
      [req.body.pallet_id || null, req.params.itemId, id]);
    if (!rows[0]) return bad(reply, 'Позиция не найдена', 404);
    return { item: rows[0] };
  });

  // ── Отметить позицию собранной / снять отметку ────────────────────────────
  fastify.put('/:id/items/:itemId/pack', auth, async (req, reply) => {
    const empId = req.fieldEmployee.id;
    const id = parseInt(req.params.id);
    const acc = await assertAccess(reply, empId, id); if (!acc) return;
    if (!['confirmed', 'packing'].includes(acc.status)) return bad(reply, 'Сбор ещё не подтверждён РП', 409);
    const userId = await resolveUserId(empId);
    const packed = req.body.packed !== false; // по умолчанию true
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE assembly_items SET packed=$1, packed_at=${packed ? 'NOW()' : 'NULL'}, packed_by=$2
         WHERE id=$3 AND assembly_id=$4 RETURNING *`,
        [packed, packed ? userId : null, req.params.itemId, id]);
      if (!rows[0]) { await client.query('ROLLBACK'); return bad(reply, 'Позиция не найдена', 404); }
      await checkPackingProgress(client, id);
      await client.query('COMMIT');
      return { item: rows[0] };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  });

  // ── Скан QR паллета (приёмка на объекте с GPS) ────────────────────────────
  fastify.post('/scan-pallet', auth, async (req, reply) => {
    const empId = req.fieldEmployee.id;
    const { qr_uuid, lat, lon } = req.body || {};
    if (!qr_uuid) return bad(reply, 'qr_uuid обязателен');
    const plt = await db.query(`SELECT ap.*, ao.work_id, ao.id AS assembly_id FROM assembly_pallets ap
      JOIN assembly_orders ao ON ap.assembly_id=ao.id WHERE ap.qr_uuid=$1`, [qr_uuid]);
    if (!plt.rows[0]) return bad(reply, 'Паллет не найден по QR', 404);
    const link = await db.query('SELECT 1 FROM employee_assignments WHERE employee_id=$1 AND work_id=$2 LIMIT 1', [empId, plt.rows[0].work_id]);
    if (!link.rows[0]) return bad(reply, 'Нет доступа к этой работе', 403);
    const userId = await resolveUserId(empId);
    const { rows } = await db.query(
      `UPDATE assembly_pallets SET status='received', received_at=NOW(), received_by=$1, scanned_lat=$2, scanned_lon=$3
       WHERE id=$4 RETURNING *`, [userId, lat || null, lon || null, plt.rows[0].id]);
    // если все паллеты приняты — переводим ведомость в received
    const all = await db.query('SELECT status FROM assembly_pallets WHERE assembly_id=$1', [plt.rows[0].assembly_id]);
    if (all.rows.length && all.rows.every(p => p.status === 'received'))
      await db.query("UPDATE assembly_orders SET status='received', actual_received_at=NOW(), updated_at=NOW() WHERE id=$1", [plt.rows[0].assembly_id]);
    const items = await db.query('SELECT id, name, quantity, unit, packed, expected_quantity, source FROM assembly_items WHERE pallet_id=$1 ORDER BY sort_order,id', [plt.rows[0].id]);
    return { pallet: rows[0], items: items.rows };
  });

  // ── Разбор возврата с объекта рабочим (план vs факт) ──────────────────────
  // body.items: [{ item_id, received_qty, return_status?, return_reason? }]
  // body.extras: [{ name, quantity, unit }] — приехало больше/неизвестное → находка-черновик
  fastify.post('/:id/reconcile', auth, async (req, reply) => {
    const empId = req.fieldEmployee.id;
    const id = parseInt(req.params.id);
    const acc = await assertAccess(reply, empId, id); if (!acc) return;
    const userId = await resolveUserId(empId);
    const { items = [], extras = [] } = req.body || {};
    const client = await db.pool.connect();
    let shortages = 0, extrasCreated = 0;
    try {
      await client.query('BEGIN');
      for (const it of items) {
        const cur = await client.query('SELECT * FROM assembly_items WHERE id=$1 AND assembly_id=$2', [it.item_id, id]);
        if (!cur.rows[0]) continue;
        const expected = parseFloat(cur.rows[0].expected_quantity ?? cur.rows[0].quantity);
        const got = it.received_qty != null ? parseFloat(it.received_qty) : expected;
        let rs = it.return_status || null;
        if (got < expected && !rs) rs = 'lost';
        await client.query(
          `UPDATE assembly_items SET received=true, received_at=NOW(), received_by=$1, quantity=$2,
             return_status=COALESCE($3,return_status), return_reason=COALESCE($4,return_reason) WHERE id=$5`,
          [userId, got, rs, it.return_reason || null, it.item_id]);
        if (got < expected) shortages++;
      }
      for (const ex of extras) {
        if (!ex.name || !ex.name.trim()) continue;
        const np = await client.query(
          `INSERT INTO products(name,unit,is_draft,created_from,created_by) VALUES($1,$2,true,'found',$3) RETURNING id`,
          [ex.name.trim(), ex.unit || 'шт', userId]);
        await client.query(
          `INSERT INTO assembly_items(assembly_id,product_id,name,unit,quantity,source,over_received,received,received_at,received_by)
           VALUES($1,$2,$3,$4,$5,'manual',true,true,NOW(),$6)`,
          [id, np.rows[0].id, ex.name.trim(), ex.unit || 'шт', ex.quantity || 1, userId]);
        extrasCreated++;
      }
      await client.query('COMMIT');
      return { success: true, shortages, extras_created: extrasCreated };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  });
}

module.exports = routes;
