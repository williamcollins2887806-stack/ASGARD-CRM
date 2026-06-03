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

const ACCESS_ROLES = ['ADMIN', 'TO', 'HEAD_TO', 'DIRECTOR_GEN'];

async function routes(fastify, options) {
  const db = fastify.db;

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
            (employee_id, type_id, valid_to, is_active, created_at)
          VALUES ($1, $2, $3, true, NOW())
        `, [t.employee_id, t.permit_type_id, valid_to]);
      } catch (e) {
        fastify.log.warn('[training/complete] permit insert failed: ' + e.message);
      }
    }

    return { ok: true };
  });

  // ─── POST /upload/:id — заглушка для multipart ────────────────────────────
  fastify.post('/upload/:id', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async (request, reply) => {
    // Реальная загрузка multipart (через @fastify/multipart) реализуется в Сессии 3.
    // Сейчас принимаем JSON { filename, original_name } чтобы запись попала в БД.
    const id = parseInt(request.params.id, 10);
    const { filename, original_name } = request.body || {};
    if (!filename) return reply.code(400).send({ error: 'filename обязателен' });
    await db.query(`
      UPDATE worker_training SET
        certificate_file = $2,
        certificate_original_name = $3,
        updated_at = NOW()
      WHERE id = $1
    `, [id, filename, original_name || null]);
    return { ok: true };
  });
}

module.exports = routes;
