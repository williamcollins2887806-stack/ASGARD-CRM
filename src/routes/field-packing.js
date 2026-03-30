/**
 * ASGARD Field — Packing Lists API (Сборы/Комплектация)
 * ═══════════════════════════════════════════════════════════════
 * POST /                     — create packing list (CRM auth)
 * GET  /                     — list packing lists for project (CRM auth)
 * GET  /:id                  — packing list details + items (CRM auth)
 * PUT  /:id                  — update packing list (CRM auth)
 * POST /:id/items            — add items to list (CRM auth)
 * PUT  /:id/items/:itemId    — update item (CRM auth)
 * DELETE /:id/items/:itemId  — remove item (CRM auth)
 * POST /:id/assign           — assign list to master (CRM auth)
 *
 * GET  /my                   — master's assigned lists (Field auth)
 * PUT  /my/:id/start         — master starts packing (Field auth)
 * PUT  /my/:id/items/:itemId — master marks item packed/shortage (Field auth)
 * POST /my/:id/items/:itemId/photo — upload item photo (Field auth, multipart)
 * PUT  /my/:id/complete      — master completes packing (Field auth)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const MangoService = require('../services/mango');

const UPLOAD_BASE = process.env.UPLOAD_DIR || './uploads';
const MAX_PHOTO_SIZE = 15 * 1024 * 1024; // 15MB
const MANGO_SMS_FROM = process.env.MANGO_SMS_EXTENSION || '101';

const MANAGE_ROLES = ['PM', 'HEAD_PM', 'OFFICE_MANAGER', 'WAREHOUSE', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

async function routes(fastify, options) {
  const db = fastify.db;
  const mango = new MangoService();
  const crmAuth = { preHandler: [fastify.requireRoles(MANAGE_ROLES)] };
  const fieldAuth = { preHandler: [fastify.fieldAuthenticate] };

  // ═════════════════════════════════════════════════════════════════════
  // CRM ENDPOINTS
  // ═════════════════════════════════════════════════════════════════════

  // ─────────────────────────────────────────────────────────────────────
  // POST / — create packing list
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/', crmAuth, async (req, reply) => {
    try {
      const userId = req.user.id;
      const { work_id, title, description, due_date, items } = req.body || {};

      if (!work_id || !title) {
        return reply.code(400).send({ error: 'Укажите work_id и title' });
      }

      const { rows: work } = await db.query('SELECT id FROM works WHERE id = $1', [work_id]);
      if (work.length === 0) return reply.code(404).send({ error: 'Проект не найден' });

      const { rows: list } = await db.query(`
        INSERT INTO field_packing_lists (work_id, title, description, due_date, created_by, status)
        VALUES ($1, $2, $3, $4, $5, 'draft')
        RETURNING *
      `, [work_id, title, description || null, due_date || null, userId]);

      const listId = list[0].id;

      // Bulk insert items if provided
      if (items && Array.isArray(items) && items.length > 0) {
        const values = [];
        const params = [];
        let idx = 1;
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`);
          params.push(
            listId, it.item_name, it.item_category || null,
            it.quantity_required || 1, it.unit || 'шт',
            it.equipment_id || null, it.kit_id || null, i
          );
        }
        await db.query(`
          INSERT INTO field_packing_items (list_id, item_name, item_category, quantity_required, unit, equipment_id, kit_id, sort_order)
          VALUES ${values.join(', ')}
        `, params);

        await db.query(
          'UPDATE field_packing_lists SET items_total = $1, updated_at = NOW() WHERE id = $2',
          [items.length, listId]
        );
      }

      return { list: list[0], items_count: items ? items.length : 0 };
    } catch (err) {
      fastify.log.error('[field-packing] POST / error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET / — list packing lists for project
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/', crmAuth, async (req, reply) => {
    try {
      const workId = parseInt(req.query.work_id);
      if (!workId) return reply.code(400).send({ error: 'Укажите work_id' });

      const { rows } = await db.query(`
        SELECT pl.*, e.fio as assigned_to_name,
               cr.fio as created_by_name
        FROM field_packing_lists pl
        LEFT JOIN employees e ON e.id = pl.assigned_to
        LEFT JOIN employees cr ON cr.user_id = pl.created_by
        WHERE pl.work_id = $1
        ORDER BY pl.created_at DESC
      `, [workId]);

      return { lists: rows };
    } catch (err) {
      fastify.log.error('[field-packing] GET / error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /:id — packing list details with items
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/:id', crmAuth, async (req, reply) => {
    try {
      const listId = parseInt(req.params.id);

      const { rows: list } = await db.query(`
        SELECT pl.*, e.fio as assigned_to_name
        FROM field_packing_lists pl
        LEFT JOIN employees e ON e.id = pl.assigned_to
        WHERE pl.id = $1
      `, [listId]);
      if (list.length === 0) return reply.code(404).send({ error: 'Лист сборки не найден' });

      const { rows: items } = await db.query(`
        SELECT pi.*, ep.fio as photographed_by_name
        FROM field_packing_items pi
        LEFT JOIN employees ep ON ep.id = pi.photographed_by
        WHERE pi.list_id = $1
        ORDER BY pi.sort_order, pi.id
      `, [listId]);

      return { list: list[0], items };
    } catch (err) {
      fastify.log.error('[field-packing] GET /:id error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // PUT /:id — update packing list
  // ─────────────────────────────────────────────────────────────────────
  fastify.put('/:id', crmAuth, async (req, reply) => {
    try {
      const listId = parseInt(req.params.id);
      const { title, description, due_date, tracking_number } = req.body || {};

      const { rows: existing } = await db.query('SELECT id FROM field_packing_lists WHERE id = $1', [listId]);
      if (existing.length === 0) return reply.code(404).send({ error: 'Лист сборки не найден' });

      await db.query(`
        UPDATE field_packing_lists SET
          title = COALESCE($1, title),
          description = COALESCE($2, description),
          due_date = COALESCE($3, due_date),
          tracking_number = COALESCE($4, tracking_number),
          updated_at = NOW()
        WHERE id = $5
      `, [title || null, description || null, due_date || null, tracking_number || null, listId]);

      return { ok: true };
    } catch (err) {
      fastify.log.error('[field-packing] PUT /:id error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /:id/items — add items to list
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/:id/items', crmAuth, async (req, reply) => {
    try {
      const listId = parseInt(req.params.id);
      const { items } = req.body || {};

      const { rows: list } = await db.query('SELECT id FROM field_packing_lists WHERE id = $1', [listId]);
      if (list.length === 0) return reply.code(404).send({ error: 'Лист сборки не найден' });

      if (!items || !Array.isArray(items) || items.length === 0) {
        return reply.code(400).send({ error: 'Укажите массив items' });
      }

      // Get max sort_order
      const { rows: maxSort } = await db.query(
        'SELECT COALESCE(MAX(sort_order), -1) as max_sort FROM field_packing_items WHERE list_id = $1', [listId]
      );
      let sortStart = maxSort[0].max_sort + 1;

      const values = [];
      const params = [];
      let idx = 1;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`);
        params.push(
          listId, it.item_name, it.item_category || null,
          it.quantity_required || 1, it.unit || 'шт',
          it.equipment_id || null, it.kit_id || null, sortStart + i
        );
      }

      const { rows: inserted } = await db.query(`
        INSERT INTO field_packing_items (list_id, item_name, item_category, quantity_required, unit, equipment_id, kit_id, sort_order)
        VALUES ${values.join(', ')}
        RETURNING id
      `, params);

      // Update total
      await db.query(`
        UPDATE field_packing_lists SET items_total = (
          SELECT COUNT(*) FROM field_packing_items WHERE list_id = $1
        ), updated_at = NOW() WHERE id = $1
      `, [listId]);

      return { ok: true, inserted: inserted.length };
    } catch (err) {
      fastify.log.error('[field-packing] POST /:id/items error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // PUT /:id/items/:itemId — update item
  // ─────────────────────────────────────────────────────────────────────
  fastify.put('/:id/items/:itemId', crmAuth, async (req, reply) => {
    try {
      const listId = parseInt(req.params.id);
      const itemId = parseInt(req.params.itemId);
      const { item_name, item_category, quantity_required, unit, sort_order } = req.body || {};

      const { rows } = await db.query(
        'SELECT id FROM field_packing_items WHERE id = $1 AND list_id = $2', [itemId, listId]
      );
      if (rows.length === 0) return reply.code(404).send({ error: 'Позиция не найдена' });

      await db.query(`
        UPDATE field_packing_items SET
          item_name = COALESCE($1, item_name),
          item_category = COALESCE($2, item_category),
          quantity_required = COALESCE($3, quantity_required),
          unit = COALESCE($4, unit),
          sort_order = COALESCE($5, sort_order),
          updated_at = NOW()
        WHERE id = $6
      `, [item_name || null, item_category || null, quantity_required || null,
          unit || null, sort_order !== undefined ? sort_order : null, itemId]);

      return { ok: true };
    } catch (err) {
      fastify.log.error('[field-packing] PUT /:id/items/:itemId error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // DELETE /:id/items/:itemId — remove item
  // ─────────────────────────────────────────────────────────────────────
  fastify.delete('/:id/items/:itemId', crmAuth, async (req, reply) => {
    try {
      const listId = parseInt(req.params.id);
      const itemId = parseInt(req.params.itemId);

      const { rowCount } = await db.query(
        'DELETE FROM field_packing_items WHERE id = $1 AND list_id = $2', [itemId, listId]
      );
      if (rowCount === 0) return reply.code(404).send({ error: 'Позиция не найдена' });

      // Update totals
      await db.query(`
        UPDATE field_packing_lists SET
          items_total = (SELECT COUNT(*) FROM field_packing_items WHERE list_id = $1),
          items_packed = (SELECT COUNT(*) FROM field_packing_items WHERE list_id = $1 AND status = 'packed'),
          updated_at = NOW()
        WHERE id = $1
      `, [listId]);

      return { ok: true };
    } catch (err) {
      fastify.log.error('[field-packing] DELETE /:id/items/:itemId error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /:id/assign — assign list to master + send SMS
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/:id/assign', crmAuth, async (req, reply) => {
    try {
      const listId = parseInt(req.params.id);
      const userId = req.user.id;
      const { employee_id, send_sms } = req.body || {};

      if (!employee_id) return reply.code(400).send({ error: 'Укажите employee_id' });

      const { rows: list } = await db.query(
        'SELECT pl.*, w.work_title FROM field_packing_lists pl JOIN works w ON w.id = pl.work_id WHERE pl.id = $1',
        [listId]
      );
      if (list.length === 0) return reply.code(404).send({ error: 'Лист сборки не найден' });

      const { rows: emp } = await db.query('SELECT id, fio, phone FROM employees WHERE id = $1', [employee_id]);
      if (emp.length === 0) return reply.code(404).send({ error: 'Сотрудник не найден' });

      await db.query(`
        UPDATE field_packing_lists SET
          assigned_to = $1, assigned_by = $2, assigned_at = NOW(),
          status = 'sent', updated_at = NOW()
        WHERE id = $3
      `, [employee_id, userId, listId]);

      // SMS
      let smsSent = false;
      if (send_sms !== false && emp[0].phone) {
        try {
          const smsText = `ASGARD: Лист сборки "${list[0].title}" для "${list[0].work_title}". ${list[0].items_total} позиций. Подробности в ЛК: asgard-crm.ru/field`;
          await mango.sendSms(MANGO_SMS_FROM, emp[0].phone, smsText);
          smsSent = true;
          await db.query(`
            INSERT INTO field_sms_log (employee_id, phone, message_type, message_text, status, work_id, sent_by)
            VALUES ($1, $2, 'packing', $3, 'sent', $4, $5)
          `, [employee_id, emp[0].phone, smsText, list[0].work_id, userId]);
        } catch (smsErr) {
          fastify.log.error('[field-packing] SMS error:', smsErr.message);
        }
      }

      return { ok: true, sms_sent: smsSent };
    } catch (err) {
      fastify.log.error('[field-packing] POST /:id/assign error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ═════════════════════════════════════════════════════════════════════
  // FIELD ENDPOINTS (Master via Field PWA)
  // ═════════════════════════════════════════════════════════════════════

  // ─────────────────────────────────────────────────────────────────────
  // GET /my — master's assigned packing lists
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/my', fieldAuth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;

      const { rows } = await db.query(`
        SELECT pl.*, w.work_title
        FROM field_packing_lists pl
        JOIN works w ON w.id = pl.work_id
        WHERE pl.assigned_to = $1
        ORDER BY
          CASE pl.status WHEN 'sent' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'completed' THEN 2 WHEN 'shipped' THEN 3 ELSE 4 END,
          pl.due_date ASC NULLS LAST,
          pl.created_at DESC
      `, [empId]);

      return { lists: rows };
    } catch (err) {
      fastify.log.error('[field-packing] GET /my error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // PUT /my/:id/start — master starts packing
  // ─────────────────────────────────────────────────────────────────────
  fastify.put('/my/:id/start', fieldAuth, async (req, reply) => {
    try {
      const listId = parseInt(req.params.id);
      const empId = req.fieldEmployee.id;

      const { rows: list } = await db.query(
        'SELECT * FROM field_packing_lists WHERE id = $1 AND assigned_to = $2', [listId, empId]
      );
      if (list.length === 0) return reply.code(404).send({ error: 'Лист сборки не найден' });

      if (!['sent', 'draft'].includes(list[0].status)) {
        return reply.code(400).send({ error: 'Сборка уже начата или завершена' });
      }

      await db.query(`
        UPDATE field_packing_lists SET status = 'in_progress', updated_at = NOW() WHERE id = $1
      `, [listId]);

      // Return items for convenience
      const { rows: items } = await db.query(`
        SELECT * FROM field_packing_items WHERE list_id = $1 ORDER BY sort_order, id
      `, [listId]);

      return { ok: true, status: 'in_progress', items };
    } catch (err) {
      fastify.log.error('[field-packing] PUT /my/:id/start error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // PUT /my/:id/items/:itemId — mark item packed/shortage/replaced
  // ─────────────────────────────────────────────────────────────────────
  fastify.put('/my/:id/items/:itemId', fieldAuth, async (req, reply) => {
    try {
      const listId = parseInt(req.params.id);
      const itemId = parseInt(req.params.itemId);
      const empId = req.fieldEmployee.id;
      const { status, quantity_packed, shortage_note } = req.body || {};

      // Verify ownership
      const { rows: list } = await db.query(
        'SELECT id FROM field_packing_lists WHERE id = $1 AND assigned_to = $2', [listId, empId]
      );
      if (list.length === 0) return reply.code(404).send({ error: 'Лист сборки не найден' });

      const { rows: item } = await db.query(
        'SELECT * FROM field_packing_items WHERE id = $1 AND list_id = $2', [itemId, listId]
      );
      if (item.length === 0) return reply.code(404).send({ error: 'Позиция не найдена' });

      const validStatuses = ['pending', 'packed', 'shortage', 'replaced'];
      if (status && !validStatuses.includes(status)) {
        return reply.code(400).send({ error: 'Недопустимый статус' });
      }

      await db.query(`
        UPDATE field_packing_items SET
          status = COALESCE($1, status),
          quantity_packed = COALESCE($2, quantity_packed),
          shortage_note = COALESCE($3, shortage_note),
          updated_at = NOW()
        WHERE id = $4
      `, [status || null, quantity_packed !== undefined ? quantity_packed : null,
          shortage_note || null, itemId]);

      // Update list packed count
      const { rows: counts } = await db.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'packed' OR status = 'replaced') as packed
        FROM field_packing_items WHERE list_id = $1
      `, [listId]);

      await db.query(
        'UPDATE field_packing_lists SET items_packed = $1, updated_at = NOW() WHERE id = $2',
        [parseInt(counts[0].packed), listId]
      );

      return { ok: true, items_packed: parseInt(counts[0].packed) };
    } catch (err) {
      fastify.log.error('[field-packing] PUT /my/:id/items/:itemId error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /my/:id/items/:itemId/photo — upload item photo
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/my/:id/items/:itemId/photo', fieldAuth, async (req, reply) => {
    try {
      const listId = parseInt(req.params.id);
      const itemId = parseInt(req.params.itemId);
      const empId = req.fieldEmployee.id;

      // Verify ownership
      const { rows: list } = await db.query(
        'SELECT id FROM field_packing_lists WHERE id = $1 AND assigned_to = $2', [listId, empId]
      );
      if (list.length === 0) return reply.code(404).send({ error: 'Лист сборки не найден' });

      const { rows: item } = await db.query(
        'SELECT id FROM field_packing_items WHERE id = $1 AND list_id = $2', [itemId, listId]
      );
      if (item.length === 0) return reply.code(404).send({ error: 'Позиция не найдена' });

      // Parse multipart
      const parts = req.parts();
      let file = null;

      for await (const part of parts) {
        if (part.file) {
          const buffer = await part.toBuffer();
          if (buffer.length > MAX_PHOTO_SIZE) {
            return reply.code(413).send({ error: 'Фото слишком большое (макс 15МБ)' });
          }
          file = { buffer, filename: part.filename, mimetype: part.mimetype };
        }
      }

      if (!file) return reply.code(400).send({ error: 'Фото не загружено' });

      const ext = path.extname(file.filename).toLowerCase() || '.jpg';
      const uploadDir = path.join(UPLOAD_BASE, 'packing');
      await fs.promises.mkdir(uploadDir, { recursive: true });

      const uniqueName = `pack_${crypto.randomBytes(16).toString('hex')}${ext}`;
      await fs.promises.writeFile(path.join(uploadDir, uniqueName), file.buffer);

      await db.query(`
        UPDATE field_packing_items SET
          photo_filename = $1, photo_original = $2,
          photographed_at = NOW(), photographed_by = $3,
          updated_at = NOW()
        WHERE id = $4
      `, [uniqueName, file.filename, empId, itemId]);

      return { ok: true, photo_url: `/uploads/packing/${uniqueName}` };
    } catch (err) {
      fastify.log.error('[field-packing] POST photo error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // PUT /my/:id/complete — master completes packing
  // ─────────────────────────────────────────────────────────────────────
  fastify.put('/my/:id/complete', fieldAuth, async (req, reply) => {
    try {
      const listId = parseInt(req.params.id);
      const empId = req.fieldEmployee.id;

      const { rows: list } = await db.query(
        'SELECT * FROM field_packing_lists WHERE id = $1 AND assigned_to = $2', [listId, empId]
      );
      if (list.length === 0) return reply.code(404).send({ error: 'Лист сборки не найден' });
      if (list[0].status === 'completed' || list[0].status === 'shipped') {
        return reply.code(400).send({ error: 'Сборка уже завершена' });
      }

      await db.query(`
        UPDATE field_packing_lists SET status = 'completed', updated_at = NOW() WHERE id = $1
      `, [listId]);

      return { ok: true, status: 'completed' };
    } catch (err) {
      fastify.log.error('[field-packing] PUT /my/:id/complete error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });
}

module.exports = routes;
