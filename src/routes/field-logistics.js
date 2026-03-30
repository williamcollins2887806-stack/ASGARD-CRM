/**
 * ASGARD Field — Logistics API
 * ═══════════════════════════════════════════════════════════════
 * POST /          — create logistics item (CRM auth)
 * POST /:id/attach — attach document (CRM auth)
 * POST /:id/send  — send to employee via SMS (CRM auth)
 * GET  /          — logistics matrix (CRM auth)
 * GET  /my        — employee's logistics (Field auth)
 * GET  /my/history — employee's logistics history (Field auth)
 */

const MangoService = require('../services/mango');
const { createNotification } = require('../services/notify');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MANGO_SMS_FROM = process.env.MANGO_SMS_EXTENSION || '101';
const UPLOAD_BASE = process.env.UPLOAD_DIR || './uploads';
const LOGISTICS_ROLES = ['PM', 'HEAD_PM', 'OFFICE_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

const FIELD_QUOTES_LOGISTICS = [
  'Put otkryt! Prover detali v LK',
  'Krov obespechen! Detali v razdele "Bilety"',
  'Novyj dokument — zaglyani v LK',
];

function randomQuote(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function routes(fastify, options) {
  const db = fastify.db;
  const mango = new MangoService();
  const crmAuth = { preHandler: [fastify.requireRoles(LOGISTICS_ROLES)] };
  const fieldAuth = { preHandler: [fastify.fieldAuthenticate] };

  // ─────────────────────────────────────────────────────────────────────
  // POST / — create logistics item
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/', crmAuth, async (req, reply) => {
    try {
      const userId = req.user.id;
      const { work_id, employee_id, item_type, title, description, details, date_from, date_to } = req.body || {};

      if (!work_id || !employee_id || !item_type || !title) {
        return reply.code(400).send({ error: 'Укажите work_id, employee_id, item_type и title' });
      }

      const { rows: inserted } = await db.query(`
        INSERT INTO field_logistics (work_id, employee_id, item_type, title, description,
          details, date_from, date_to, status, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9)
        RETURNING id, created_at
      `, [work_id, employee_id, item_type, title, description || null,
          details ? JSON.stringify(details) : '{}',
          date_from || null, date_to || null, userId]);

      return { logistics_id: inserted[0].id, created_at: inserted[0].created_at };
    } catch (err) {
      fastify.log.error('[field-logistics] POST / error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /:id/attach — attach document
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/:id/attach', crmAuth, async (req, reply) => {
    try {
      const logisticsId = parseInt(req.params.id);
      const userId = req.user.id;

      // Check logistics item exists
      const { rows: item } = await db.query(
        `SELECT id, work_id, employee_id FROM field_logistics WHERE id = $1`, [logisticsId]
      );
      if (item.length === 0) return reply.code(404).send({ error: 'Запись не найдена' });

      const parts = req.parts();
      let file = null;

      for await (const part of parts) {
        if (part.file) {
          file = {
            buffer: await part.toBuffer(),
            filename: part.filename,
            mimetype: part.mimetype,
          };
        }
      }

      if (!file) return reply.code(400).send({ error: 'Файл не загружен' });

      // Save file
      const ext = path.extname(file.filename).toLowerCase();
      const uploadDir = path.join(UPLOAD_BASE, 'logistics');
      await fs.promises.mkdir(uploadDir, { recursive: true });

      const uniqueName = crypto.randomBytes(16).toString('hex') + ext;
      const filePath = path.join(uploadDir, uniqueName);
      await fs.promises.writeFile(filePath, file.buffer);

      // Insert into documents
      const { rows: doc } = await db.query(`
        INSERT INTO documents (filename, original_name, mime_type, size, type, work_id, uploaded_by, download_url, created_at)
        VALUES ($1, $2, $3, $4, 'logistics', $5, $6, $7, NOW())
        RETURNING id
      `, [uniqueName, file.filename, file.mimetype, file.buffer.length,
          item[0].work_id, userId, `/uploads/logistics/${uniqueName}`]);

      // Link to logistics
      await db.query(
        `UPDATE field_logistics SET document_id = $1, status = 'ready', updated_at = NOW() WHERE id = $2`,
        [doc[0].id, logisticsId]
      );

      return { ok: true, document_id: doc[0].id };
    } catch (err) {
      fastify.log.error('[field-logistics] POST /:id/attach error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /:id/send — send to employee
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/:id/send', crmAuth, async (req, reply) => {
    try {
      const logisticsId = parseInt(req.params.id);
      const userId = req.user.id;

      const { rows: item } = await db.query(`
        SELECT fl.*, e.phone, e.fio, e.user_id, w.work_title
        FROM field_logistics fl
        JOIN employees e ON e.id = fl.employee_id
        JOIN works w ON w.id = fl.work_id
        WHERE fl.id = $1
      `, [logisticsId]);

      if (item.length === 0) return reply.code(404).send({ error: 'Запись не найдена' });

      const rec = item[0];
      let smsSent = false;
      let pushSent = false;

      // SMS
      if (rec.phone) {
        const smsText = `ASGARD: ${rec.title}. Проект "${rec.work_title}". Подробности: asgard-crm.ru/field`;
        try {
          await mango.sendSms(MANGO_SMS_FROM, rec.phone, smsText);
          smsSent = true;
          await db.query(`
            INSERT INTO field_sms_log (employee_id, phone, message_type, message_text, status, work_id, sent_by)
            VALUES ($1, $2, 'logistics', $3, 'sent', $4, $5)
          `, [rec.employee_id, rec.phone, smsText, rec.work_id, userId]);
        } catch (smsErr) {
          fastify.log.error('[field-logistics] SMS error:', smsErr.message);
        }
      }

      // Push notification
      if (rec.user_id) {
        try {
          await createNotification(db, {
            user_id: rec.user_id,
            title: rec.title,
            message: `Проект "${rec.work_title}": ${rec.description || rec.title}`,
            type: 'field_logistics',
            link: '/field'
          });
          pushSent = true;
        } catch (_) {}
      }

      // Update status
      await db.query(
        `UPDATE field_logistics SET sent_to_employee = true, sent_at = NOW(), status = 'sent', updated_at = NOW() WHERE id = $1`,
        [logisticsId]
      );

      return { ok: true, sms_sent: smsSent, push_sent: pushSent };
    } catch (err) {
      fastify.log.error('[field-logistics] POST /:id/send error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET / — logistics matrix (CRM view)
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/', crmAuth, async (req, reply) => {
    try {
      const workId = parseInt(req.query.work_id);
      if (!workId) return reply.code(400).send({ error: 'Укажите work_id' });

      const { rows } = await db.query(`
        SELECT fl.*, e.fio, e.phone,
               d.original_name as document_name, d.download_url
        FROM field_logistics fl
        JOIN employees e ON e.id = fl.employee_id
        LEFT JOIN documents d ON d.id = fl.document_id
        WHERE fl.work_id = $1
        ORDER BY e.fio, fl.item_type, fl.created_at DESC
      `, [workId]);

      // Group by employee
      const matrix = {};
      for (const row of rows) {
        if (!matrix[row.employee_id]) {
          matrix[row.employee_id] = { employee_id: row.employee_id, fio: row.fio, phone: row.phone, items: [] };
        }
        matrix[row.employee_id].items.push(row);
      }

      return { logistics: Object.values(matrix), total: rows.length };
    } catch (err) {
      fastify.log.error('[field-logistics] GET / error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /my — employee's current logistics (Field auth)
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/my', fieldAuth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;

      const { rows } = await db.query(`
        SELECT fl.*, w.work_title, w.city,
               d.original_name as document_name, d.download_url
        FROM field_logistics fl
        JOIN works w ON w.id = fl.work_id
        LEFT JOIN documents d ON d.id = fl.document_id
        WHERE fl.employee_id = $1 AND (fl.date_to IS NULL OR fl.date_to >= CURRENT_DATE - INTERVAL '7 days')
        ORDER BY fl.date_from DESC NULLS LAST, fl.created_at DESC
      `, [empId]);

      return { logistics: rows };
    } catch (err) {
      fastify.log.error('[field-logistics] GET /my error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /my/history — employee's logistics history (Field auth)
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/my/history', fieldAuth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;

      const { rows } = await db.query(`
        SELECT fl.*, w.work_title, w.city,
               d.original_name as document_name, d.download_url
        FROM field_logistics fl
        JOIN works w ON w.id = fl.work_id
        LEFT JOIN documents d ON d.id = fl.document_id
        WHERE fl.employee_id = $1
        ORDER BY fl.created_at DESC
        LIMIT 100
      `, [empId]);

      return { logistics: rows };
    } catch (err) {
      fastify.log.error('[field-logistics] GET /my/history error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });
}

module.exports = routes;
