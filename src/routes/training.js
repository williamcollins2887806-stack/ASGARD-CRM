/**
 * Worker Training API
 * ═══════════════════════════════════════════════════════════════════════════
 * Prefix: /api/training
 *
 * GET  /pending           — все рабочие с pending/in_progress обучением
 * GET  /:id               — детали обучения
 * PUT  /:id/start         — начать обучение (ТО)
 * PUT  /:id/complete      — завершить + создать запись employee_permits
 * POST /upload/:id        — загрузить файл сертификата
 *
 * Доступ: ADMIN, TO, HEAD_TO, DIRECTOR_GEN
 */

const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const { v4: uuidv4 } = require('uuid');

const ACCESS_ROLES = ['ADMIN', 'TO', 'HEAD_TO', 'DIRECTOR_GEN'];

async function routes(fastify, options) {
  const db = fastify.db;
  const uploadDir = process.env.UPLOAD_DIR || './uploads';

  // ─── GET /pending ─────────────────────────────────────────────────────────
  fastify.get('/pending', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async () => {
    const { rows } = await db.query(`
      SELECT
        t.*,
        e.fio, e.phone, e.role_tag,
        w.work_title,
        pt.name AS permit_name, pt.code AS permit_code,
        ab.name AS assigned_by_name
      FROM worker_training t
      LEFT JOIN employees e     ON e.id = t.employee_id
      LEFT JOIN works w         ON w.id = t.work_id
      LEFT JOIN permit_types pt ON pt.id = t.permit_type_id
      LEFT JOIN users ab        ON ab.id = t.assigned_by
      WHERE t.status IN ('pending', 'in_progress')
      ORDER BY t.deadline NULLS LAST, t.created_at DESC
      LIMIT 500
    `);
    return { trainings: rows };
  });

  // ─── GET /:id ─────────────────────────────────────────────────────────────
  fastify.get('/:id', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const { rows: [t] } = await db.query(`
      SELECT
        t.*,
        e.fio, e.phone, e.role_tag,
        w.work_title,
        pt.name AS permit_name, pt.code AS permit_code, pt.validity_months,
        ab.name AS assigned_by_name,
        cb.name AS completed_by_name
      FROM worker_training t
      LEFT JOIN employees e     ON e.id = t.employee_id
      LEFT JOIN works w         ON w.id = t.work_id
      LEFT JOIN permit_types pt ON pt.id = t.permit_type_id
      LEFT JOIN users ab        ON ab.id = t.assigned_by
      LEFT JOIN users cb        ON cb.id = t.completed_by
      WHERE t.id = $1
    `, [id]);
    if (!t) return reply.code(404).send({ error: 'Обучение не найдено' });
    return { training: t };
  });

  // ─── PUT /:id/start ───────────────────────────────────────────────────────
  fastify.put('/:id/start', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const { rows: [t] } = await db.query('SELECT status FROM worker_training WHERE id = $1', [id]);
    if (!t) return reply.code(404).send({ error: 'Не найдено' });
    if (t.status !== 'pending') return reply.code(409).send({ error: 'Можно только из pending' });

    await db.query(`
      UPDATE worker_training SET status = 'in_progress', started_at = CURRENT_DATE, updated_at = NOW()
      WHERE id = $1
    `, [id]);
    return { ok: true };
  });

  // ─── PUT /:id/complete ────────────────────────────────────────────────────
  fastify.put('/:id/complete', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const { certificate_number, certificate_file, certificate_original_name, valid_from, valid_to, trainer_name } = request.body || {};

    const { rows: [t] } = await db.query(
      'SELECT employee_id, permit_type_id, status FROM worker_training WHERE id = $1',
      [id]
    );
    if (!t) return reply.code(404).send({ error: 'Не найдено' });
    if (!['pending','in_progress'].includes(t.status)) {
      return reply.code(409).send({ error: 'Можно только из pending/in_progress' });
    }

    await db.query(`
      UPDATE worker_training SET
        status = 'completed', completed_at = CURRENT_DATE,
        certificate_number = COALESCE($2, certificate_number),
        certificate_file = COALESCE($3, certificate_file),
        certificate_original_name = COALESCE($4, certificate_original_name),
        valid_from = COALESCE($5, valid_from),
        valid_to = COALESCE($6, valid_to),
        trainer_name = COALESCE($7, trainer_name),
        completed_by = $8,
        updated_at = NOW()
      WHERE id = $1
    `, [id, certificate_number, certificate_file, certificate_original_name, valid_from, valid_to, trainer_name, request.user.id]);

    // Создаём запись в employee_permits если есть permit_type_id и valid_to
    if (t.permit_type_id && valid_to) {
      try {
        await db.query(`
          INSERT INTO employee_permits
            (employee_id, type_id, expiry_date, is_active, created_at)
          VALUES ($1, $2, $3, true, NOW())
        `, [t.employee_id, t.permit_type_id, valid_to]);
      } catch (e) {
        fastify.log.warn('[training/complete] permit insert failed: ' + e.message);
      }
    }

    return { ok: true };
  });

  // ─── POST /upload/:id — загрузка файла сертификата (multipart) ─────────────
  fastify.post('/upload/:id', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: 'Неверный id' });

    const { rows: [t] } = await db.query(
      'SELECT certificate_file FROM worker_training WHERE id = $1', [id]
    );
    if (!t) return reply.code(404).send({ error: 'Обучение не найдено' });

    const contentType = request.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      return reply.code(400).send({ error: 'Ожидается multipart/form-data' });
    }

    let file = null;
    const parts = request.parts();
    for await (const part of parts) {
      if (part.file) {
        file = {
          filename: part.filename,
          mimetype: part.mimetype,
          buffer: await part.toBuffer(),
        };
      }
    }
    if (!file) return reply.code(400).send({ error: 'Файл не передан' });

    // Удаляем старый файл (если был)
    if (t.certificate_file) {
      try { await fsp.unlink(path.join(uploadDir, t.certificate_file)); } catch (e) { /* ignore */ }
    }

    const ext = path.extname(file.filename) || '';
    const certFile = `training_${uuidv4()}${ext}`;
    await fsp.mkdir(uploadDir, { recursive: true });
    await fsp.writeFile(path.join(uploadDir, certFile), file.buffer);

    await db.query(`
      UPDATE worker_training SET
        certificate_file = $2,
        certificate_original_name = $3,
        updated_at = NOW()
      WHERE id = $1
    `, [id, certFile, file.filename || null]);

    return { ok: true, certificate_file: certFile, certificate_original_name: file.filename };
  });

  // ─── GET /download/:id — скачать файл сертификата ──────────────────────────
  // Токен принимаем через query (?token=) т.к. файл открывается в новой вкладке
  // через <a href> без Authorization-заголовка (паттерн files.js download).
  fastify.get('/download/:id', {
    preHandler: [
      async (request) => {
        if (!request.headers.authorization && request.query.token) {
          request.headers.authorization = 'Bearer ' + request.query.token;
        }
      },
      fastify.authenticate,
      fastify.requireRoles(ACCESS_ROLES),
    ]
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: 'Неверный id' });

    const { rows: [t] } = await db.query(
      'SELECT certificate_file, certificate_original_name FROM worker_training WHERE id = $1', [id]
    );
    if (!t || !t.certificate_file) return reply.code(404).send({ error: 'Файл не найден' });

    const filePath = path.join(uploadDir, t.certificate_file);
    if (!fs.existsSync(filePath)) return reply.code(404).send({ error: 'Файл отсутствует на диске' });

    const buffer = await fsp.readFile(filePath);
    const origName = t.certificate_original_name || t.certificate_file;
    reply
      .header('Content-Length', buffer.length)
      .header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(origName)}`)
      .send(buffer);
  });
}

module.exports = routes;
