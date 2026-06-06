'use strict';
/**
 * АСГАРД CRM — Адресное хранение склада (WMS).
 * Регистрируется в index.js под префиксом /api/warehouse.
 *
 * Ячейки склада (зоны/стеллажи/полки/ячейки) с QR. При скане QR ячейки система
 * понимает «куда класть». Bulk-генерация сетки ячеек, печать QR-этикеток.
 *
 * Роли: WAREHOUSE/ADMIN/CHIEF_ENGINEER пишут; читают они + PM/директора.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const QRCode = require('qrcode');

const WMS_WRITE = ['ADMIN', 'WAREHOUSE', 'CHIEF_ENGINEER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
const WMS_READ = [...WMS_WRITE, 'PM', 'HEAD_PM', 'PROC', 'BUH'];
const KINDS = ['storage', 'staging', 'quarantine'];

async function routes(fastify) {
  const db = fastify.db;
  const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });

  // ── Список ячеек (с тем, что лежит) ───────────────────────────────────────
  fastify.get('/locations', { preHandler: [fastify.requireRoles(WMS_READ)] }, async (req) => {
    const { warehouse_id, kind, is_active, search, limit = 500, offset = 0 } = req.query;
    let sql = `SELECT l.*, w.name AS warehouse_name,
      (SELECT COUNT(*) FROM stock s WHERE s.location_id = l.id AND s.quantity > 0) AS stock_lines,
      (SELECT COUNT(*) FROM equipment e WHERE e.location_id = l.id AND e.status != 'written_off') AS unit_count
      FROM warehouse_locations l
      LEFT JOIN warehouses w ON l.warehouse_id = w.id
      WHERE l.deleted_at IS NULL`;
    const p = []; let i = 1;
    if (warehouse_id) { sql += ` AND l.warehouse_id = $${i++}`; p.push(warehouse_id); }
    if (kind) { sql += ` AND l.kind = $${i++}`; p.push(kind); }
    if (is_active !== undefined) { sql += ` AND l.is_active = $${i++}`; p.push(is_active === 'true' || is_active === true); }
    if (search) { sql += ` AND (l.label ILIKE $${i} OR l.zone ILIKE $${i} OR l.rack ILIKE $${i} OR l.cell ILIKE $${i})`; p.push(`%${search}%`); i++; }
    sql += ` ORDER BY l.warehouse_id, l.zone, l.rack, l.shelf, l.cell LIMIT $${i++} OFFSET $${i++}`;
    p.push(Math.min(parseInt(limit), 2000), parseInt(offset));
    const { rows } = await db.query(sql, p);
    return { items: rows };
  });

  // ── Содержимое ячейки ─────────────────────────────────────────────────────
  fastify.get('/locations/:id', { preHandler: [fastify.requireRoles(WMS_READ)] }, async (req, reply) => {
    const id = parseInt(req.params.id); if (isNaN(id)) return bad(reply, 'Неверный ID');
    const loc = await db.query(`SELECT l.*, w.name AS warehouse_name FROM warehouse_locations l
      LEFT JOIN warehouses w ON l.warehouse_id = w.id WHERE l.id = $1 AND l.deleted_at IS NULL`, [id]);
    if (!loc.rows[0]) return bad(reply, 'Ячейка не найдена', 404);
    const stock = await db.query(`SELECT s.*, p.name AS product_name, p.article, p.unit AS product_unit
      FROM stock s JOIN products p ON s.product_id = p.id
      WHERE s.location_id = $1 AND s.quantity > 0 ORDER BY p.name`, [id]);
    const units = await db.query(`SELECT id, name, inventory_number, status FROM equipment
      WHERE location_id = $1 AND status != 'written_off' ORDER BY name`, [id]);
    return { item: loc.rows[0], stock: stock.rows, units: units.rows };
  });

  // ── Скан QR ячейки → что это за ячейка + содержимое ────────────────────────
  fastify.get('/locations/by-qr/:uuid', { preHandler: [fastify.requireRoles(WMS_READ)] }, async (req, reply) => {
    const { rows } = await db.query(`SELECT l.*, w.name AS warehouse_name FROM warehouse_locations l
      LEFT JOIN warehouses w ON l.warehouse_id = w.id WHERE l.qr_uuid = $1 AND l.deleted_at IS NULL`, [req.params.uuid]);
    if (!rows[0]) return bad(reply, 'Ячейка по QR не найдена', 404);
    const stock = await db.query(`SELECT s.*, p.name AS product_name, p.article FROM stock s
      JOIN products p ON s.product_id = p.id WHERE s.location_id = $1 AND s.quantity > 0 ORDER BY p.name`, [rows[0].id]);
    return { item: rows[0], stock: stock.rows };
  });

  // ── Создать одну ячейку ───────────────────────────────────────────────────
  fastify.post('/locations', { preHandler: [fastify.requireRoles(WMS_WRITE)] }, async (req, reply) => {
    const { warehouse_id, zone, rack, shelf, cell, label, kind, capacity } = req.body;
    if (!warehouse_id) return bad(reply, 'warehouse_id обязателен');
    const k = kind || 'storage';
    if (!KINDS.includes(k)) return bad(reply, 'Неверный kind (storage/staging/quarantine)');
    try {
      const { rows } = await db.query(
        `INSERT INTO warehouse_locations(warehouse_id,zone,rack,shelf,cell,label,kind,capacity,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [warehouse_id, zone || 'A', rack || null, shelf || null, cell || null,
         label || null, k, capacity || null, req.user.id]);
      return { item: rows[0] };
    } catch (e) {
      if (e.code === '23505') return bad(reply, 'Такая ячейка уже существует', 409);
      throw e;
    }
  });

  /**
   * Bulk-генерация сетки ячеек.
   * POST /locations/bulk { warehouse_id, zone, racks:[1..N], shelves:[1..M], cells:[1..K], kind }
   * Создаёт декартово произведение rack×shelf×cell. label = "{zone}-{rack}-{shelf}-{cell}".
   */
  fastify.post('/locations/bulk', { preHandler: [fastify.requireRoles(WMS_WRITE)] }, async (req, reply) => {
    const { warehouse_id, zone = 'A', racks = [], shelves = [''], cells = [''], kind = 'storage' } = req.body;
    if (!warehouse_id) return bad(reply, 'warehouse_id обязателен');
    if (!KINDS.includes(kind)) return bad(reply, 'Неверный kind');
    const rackList = Array.isArray(racks) && racks.length ? racks : [''];
    const shelfList = Array.isArray(shelves) && shelves.length ? shelves : [''];
    const cellList = Array.isArray(cells) && cells.length ? cells : [''];
    const total = rackList.length * shelfList.length * cellList.length;
    if (total > 2000) return bad(reply, 'Слишком много ячеек за раз (макс 2000)');
    const client = await db.pool.connect();
    let created = 0, skipped = 0;
    try {
      await client.query('BEGIN');
      for (const r of rackList) for (const sh of shelfList) for (const c of cellList) {
        const parts = [zone, r, sh, c].filter(x => x !== '' && x !== null && x !== undefined);
        const label = parts.join('-');
        const res = await client.query(
          `INSERT INTO warehouse_locations(warehouse_id,zone,rack,shelf,cell,label,kind,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (warehouse_id,zone,rack,shelf,cell) DO NOTHING RETURNING id`,
          [warehouse_id, zone, r || null, sh || null, c || null, label, kind, req.user.id]);
        if (res.rows[0]) created++; else skipped++;
      }
      await client.query('COMMIT');
      return { success: true, created, skipped, total };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  });

  fastify.put('/locations/:id', { preHandler: [fastify.requireRoles(WMS_WRITE)] }, async (req, reply) => {
    if (req.body.kind !== undefined && !KINDS.includes(req.body.kind)) return bad(reply, 'Неверный kind');
    const allowed = ['label', 'kind', 'capacity', 'is_active', 'zone', 'rack', 'shelf', 'cell'];
    const upd = [], vals = []; let i = 1;
    for (const k of allowed) if (req.body[k] !== undefined) { upd.push(`${k}=$${i++}`); vals.push(req.body[k]); }
    if (!upd.length) return bad(reply, 'Нет данных');
    vals.push(req.params.id);
    try {
      const { rows } = await db.query(`UPDATE warehouse_locations SET ${upd.join(',')} WHERE id=$${i} AND deleted_at IS NULL RETURNING *`, vals);
      if (!rows[0]) return bad(reply, 'Не найдена', 404);
      return { item: rows[0] };
    } catch (e) {
      if (e.code === '23505') return bad(reply, 'Конфликт адреса ячейки', 409);
      throw e;
    }
  });

  fastify.delete('/locations/:id', { preHandler: [fastify.requireRoles(WMS_WRITE)] }, async (req, reply) => {
    const id = parseInt(req.params.id);
    const busy = await db.query('SELECT 1 FROM stock WHERE location_id=$1 AND quantity>0 LIMIT 1', [id]);
    if (busy.rows[0]) return bad(reply, 'В ячейке есть остатки — сначала переместите', 409);
    const { rows } = await db.query('UPDATE warehouse_locations SET deleted_at=NOW(), is_active=false WHERE id=$1 AND deleted_at IS NULL RETURNING id', [id]);
    if (!rows[0]) return bad(reply, 'Не найдена', 404);
    return { success: true };
  });

  // ── QR-этикетка ячейки (SVG) — поддержка ?token= для печати ───────────────
  fastify.get('/locations/:id/qr', {
    preHandler: [
      async (request) => { if (!request.headers.authorization && request.query.token) request.headers.authorization = 'Bearer ' + request.query.token; },
      fastify.authenticate
    ]
  }, async (req, reply) => {
    const { rows } = await db.query('SELECT qr_uuid, label FROM warehouse_locations WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдена' });
    const svg = await QRCode.toString(rows[0].qr_uuid, { type: 'svg', width: 220 });
    reply.header('Content-Type', 'image/svg+xml').send(svg);
  });
}

module.exports = routes;
