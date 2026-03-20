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

  // ═══ CRUD ═══

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (req) => {
    const { work_id, type, status, limit = 50, offset = 0 } = req.query;
    let sql = `SELECT ao.*,w.work_title,u.name as creator_name,
      (SELECT COUNT(*) FROM assembly_items ai WHERE ai.assembly_id=ao.id) as items_count,
      (SELECT COUNT(*) FROM assembly_pallets ap WHERE ap.assembly_id=ao.id) as pallets_count,
      (SELECT COUNT(*) FROM assembly_items ai WHERE ai.assembly_id=ao.id AND ai.packed=true) as packed_count
      FROM assembly_orders ao LEFT JOIN works w ON ao.work_id=w.id LEFT JOIN users u ON ao.created_by=u.id WHERE 1=1`;
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
    const { rows } = await db.query(`SELECT ao.*,w.work_title,w.customer_name,u.name as creator_name
      FROM assembly_orders ao LEFT JOIN works w ON ao.work_id=w.id LEFT JOIN users u ON ao.created_by=u.id WHERE ao.id=$1`, [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдена' });
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
        // Забронированное
        const reserved = await client.query(`SELECT e.*,er.id as rid FROM equipment_reservations er
          JOIN equipment e ON er.equipment_id=e.id WHERE er.work_id=$1 AND er.status='active'`, [work_id]);
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
    const { rows } = await db.query('DELETE FROM assembly_items WHERE id=$1 AND assembly_id=$2 RETURNING id', [req.params.itemId, req.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдена' }); return { success: true };
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
    const mx = await db.query('SELECT COALESCE(MAX(pallet_number),0)+1 as n FROM assembly_pallets WHERE assembly_id=$1', [asmId]);
    const { rows } = await db.query('INSERT INTO assembly_pallets(assembly_id,pallet_number,label,notes,capacity_items,capacity_kg)VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
      [asmId, mx.rows[0].n, label || null, notes || null, capacity_items || null, capacity_kg || null]);
    return { pallet: rows[0] };
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

  fastify.get('/:id/pallets/:pid/qr', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { rows } = await db.query('SELECT qr_uuid FROM assembly_pallets WHERE id=$1 AND assembly_id=$2', [req.params.pid, req.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    const svg = await QRCode.toString(rows[0].qr_uuid, { type: 'svg', width: 200 });
    reply.header('Content-Type', 'image/svg+xml').send(svg);
  });

  fastify.get('/:id/pallets/:pid/label-pdf', { preHandler: [fastify.authenticate] }, async (req, reply) => {
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

  fastify.get('/:id/checklist-pdf', { preHandler: [fastify.authenticate] }, async (req, reply) => {
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

  fastify.post('/:id/pallets/:pid/scan', { preHandler: [fastify.authenticate] }, async (req, reply) => {
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
          if (item.source === 'on_site_purchase' && item.return_status === 'returning') {
            const qr = randomUUID(); const wh = await client.query("SELECT id FROM warehouses WHERE is_main=true LIMIT 1");
            await client.query(`INSERT INTO equipment(name,quantity,unit,status,warehouse_id,qr_uuid,qr_code,notes)VALUES($1,$2,$3,'on_warehouse',$4,$5,$6,$7)`,
              [item.name, item.quantity, item.unit, wh.rows[0]?.id || null, qr, qr, 'Купл. на объекте, демоб #' + asmId]);
            retCnt++;
          }
          continue;
        }
        const rs = item.return_status || 'returning';
        if (rs === 'returning') {
          await client.query("UPDATE equipment SET status='on_warehouse',current_holder_id=NULL,current_object_id=NULL WHERE id=$1", [item.equipment_id]);
          await client.query(`INSERT INTO equipment_movements(equipment_id,movement_type,to_warehouse_id,notes,performed_by)
            VALUES($1,'return',(SELECT warehouse_id FROM equipment WHERE id=$1),$2,$3)`, [item.equipment_id, 'Возврат демоб #' + asmId, req.user.id]);
          retCnt++;
        } else {
          await client.query("UPDATE equipment SET status='written_off' WHERE id=$1", [item.equipment_id]);
          const reason = rs === 'damaged' ? 'Сломано' : rs === 'lost' ? 'Утеряно' : 'Израсходовано';
          await client.query(`INSERT INTO equipment_movements(equipment_id,movement_type,notes,performed_by)VALUES($1,'write_off',$2,$3)`,
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

  fastify.get('/:id/export-excel', { preHandler: [fastify.authenticate] }, async (req, reply) => {
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
}

module.exports = routes;
