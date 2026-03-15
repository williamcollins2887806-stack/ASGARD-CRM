'use strict';

/**
 * Travel Routes — Командировки (mobile-first)
 *
 * GET  /           — список командировок
 * POST /           — создать командировку
 * POST /:id/upload — загрузить файл (билет/чек)
 * GET  /:id/files/:fileId — скачать файл
 */
module.exports = async function (fastify) {
  const db = fastify.db;
  const path = require('path');
  const fs = require('fs').promises;
  const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads', 'travel');

  // Ensure upload dir
  try { await fs.mkdir(uploadDir, { recursive: true }); } catch (_) {}

  // ── GET / — Список командировок ─────────────────────────────────────
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user;
    const limit = parseInt(request.query.limit) || 100;
    const offset = parseInt(request.query.offset) || 0;

    // Admins and directors see all, others see own
    const isAdmin = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_PM', 'OFFICE_MANAGER'].includes(user.role);

    let query, params;
    if (isAdmin) {
      query = `
        SELECT bt.*,
               u.fio AS author_name,
               w.name AS work_name,
               si.object_name
        FROM business_trips bt
        LEFT JOIN users u ON u.id = bt.author_id
        LEFT JOIN works w ON w.id = bt.work_id
        LEFT JOIN site_inspections si ON si.id = bt.inspection_id
        ORDER BY bt.created_at DESC
        LIMIT $1 OFFSET $2
      `;
      params = [limit, offset];
    } else {
      query = `
        SELECT bt.*,
               u.fio AS author_name,
               w.name AS work_name,
               si.object_name
        FROM business_trips bt
        LEFT JOIN users u ON u.id = bt.author_id
        LEFT JOIN works w ON w.id = bt.work_id
        LEFT JOIN site_inspections si ON si.id = bt.inspection_id
        WHERE bt.author_id = $3
           OR bt.employees_json::text LIKE '%"employee_id":' || $3 || '%'
        ORDER BY bt.created_at DESC
        LIMIT $1 OFFSET $2
      `;
      params = [limit, offset, user.id];
    }

    const { rows } = await db.query(query, params);

    // Normalize for mobile frontend
    const data = rows.map(r => ({
      id: r.id,
      destination: r.object_name || r.work_name || '—',
      purpose: r.notes || '',
      start_date: r.date_from,
      end_date: r.date_to,
      status: r.status,
      employee_name: r.author_name,
      object_name: r.object_name || r.work_name,
      transport: r.transport_type,
      budget: r.advance_amount,
      accommodation: null,
      documents: [],
    }));

    // Attach documents
    for (const trip of data) {
      try {
        const docs = await db.query(
          `SELECT id, original_name AS name, download_url AS url
           FROM documents WHERE type = 'travel' AND tender_id = $1
           ORDER BY created_at DESC`, [trip.id]
        );
        trip.documents = docs.rows;
      } catch (_) {}
    }

    return reply.send({ data });
  });

  // ── POST / — Создать командировку ───────────────────────────────────
  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user;
    const b = request.body || {};

    const { rows } = await db.query(`
      INSERT INTO business_trips
        (date_from, date_to, transport_type,
         need_advance, advance_amount, notes,
         author_id, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft')
      RETURNING *
    `, [
      b.start_date || b.date_from || null,
      b.end_date || b.date_to || null,
      b.transport || b.transport_type || null,
      !!b.budget,
      b.budget || null,
      [b.destination, b.purpose].filter(Boolean).join(' — ') || null,
      user.id,
    ]);

    return reply.code(201).send(rows[0]);
  });

  // ── POST /:id/upload — Загрузить файл ──────────────────────────────
  fastify.post('/:id/upload', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;

    // Verify trip exists
    const trip = await db.query('SELECT id FROM business_trips WHERE id = $1', [id]);
    if (!trip.rows.length) return reply.code(404).send({ error: 'Командировка не найдена' });

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: 'Файл не найден' });

    const ext = path.extname(data.filename) || '';
    const filename = `travel_${id}_${Date.now()}${ext}`;
    const filepath = path.join(uploadDir, filename);

    await fs.writeFile(filepath, await data.toBuffer());

    await db.query(`
      INSERT INTO documents (filename, original_name, mime_type, size, type, tender_id, uploaded_by, download_url, created_at)
      VALUES ($1, $2, $3, $4, 'travel', $5, $6, $7, NOW())
    `, [
      filename, data.filename, data.mimetype, data.file.bytesRead || 0,
      id, request.user.id, `/api/travel/${id}/files/${filename}`,
    ]);

    return reply.send({ ok: true, filename });
  });

  // ── GET /:id/files/:filename — Скачать файл ────────────────────────
  fastify.get('/:id/files/:filename', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { filename } = request.params;
    const filepath = path.join(uploadDir, path.basename(filename));

    try {
      const stat = await fs.stat(filepath);
      const stream = require('fs').createReadStream(filepath);
      return reply.type('application/octet-stream').send(stream);
    } catch (_) {
      return reply.code(404).send({ error: 'Файл не найден' });
    }
  });
};
