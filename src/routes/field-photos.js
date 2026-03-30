/**
 * ASGARD Field — Photos API
 * ═══════════════════════════════════════════════════════════════
 * POST /upload — upload photo (multipart)
 * GET  /       — list photos for project/date
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_BASE = process.env.UPLOAD_DIR || './uploads';
const MAX_PHOTO_SIZE = 20 * 1024 * 1024; // 20MB

const FIELD_QUOTES_PHOTO = [
  'Runy zafiksirovany! Letopis popolnena',
  'Zapechatleno! Istoriya ne zabudet',
  'Foto dobavleno v khroniki Asgarda',
];

function randomQuote(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function routes(fastify, options) {
  const db = fastify.db;
  const fieldAuth = { preHandler: [fastify.fieldAuthenticate] };

  // ─────────────────────────────────────────────────────────────────────
  // POST /upload — upload photo
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/upload', fieldAuth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;

      const parts = req.parts();
      let file = null;
      let workId = null;
      let photoType = 'work';
      let caption = null;
      let reportId = null;
      let checkinId = null;
      let lat = null;
      let lng = null;

      for await (const part of parts) {
        if (part.file) {
          const buffer = await part.toBuffer();
          if (buffer.length > MAX_PHOTO_SIZE) {
            return reply.code(413).send({ error: 'Файл слишком большой (макс 20МБ)' });
          }
          file = {
            buffer,
            filename: part.filename,
            mimetype: part.mimetype,
          };
        } else {
          switch (part.fieldname) {
            case 'work_id': workId = parseInt(part.value); break;
            case 'photo_type': photoType = part.value; break;
            case 'caption': caption = part.value; break;
            case 'report_id': reportId = parseInt(part.value) || null; break;
            case 'checkin_id': checkinId = parseInt(part.value) || null; break;
            case 'lat': lat = parseFloat(part.value) || null; break;
            case 'lng': lng = parseFloat(part.value) || null; break;
          }
        }
      }

      if (!file) {
        return reply.code(400).send({ error: 'Файл не загружен' });
      }
      if (!workId) {
        return reply.code(400).send({ error: 'Укажите work_id' });
      }

      // Validate extension
      const ext = path.extname(file.filename).toLowerCase();
      const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'];
      if (!allowedExts.includes(ext)) {
        return reply.code(400).send({ error: 'Допустимые форматы: JPG, PNG, WebP, HEIC' });
      }

      // Create dir
      const uploadDir = path.join(UPLOAD_BASE, 'field', String(workId));
      await fs.promises.mkdir(uploadDir, { recursive: true });

      // Generate unique filename
      const uniqueName = crypto.randomBytes(16).toString('hex') + ext;
      const filePath = path.join(uploadDir, uniqueName);

      // Try to resize with sharp if available
      let finalBuffer = file.buffer;
      try {
        const sharp = require('sharp');
        finalBuffer = await sharp(file.buffer)
          .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer();
      } catch (_) {
        // sharp not available, save original
      }

      await fs.promises.writeFile(filePath, finalBuffer);

      // Insert record
      const { rows: inserted } = await db.query(`
        INSERT INTO field_photos (employee_id, work_id, report_id, checkin_id,
          filename, original_name, mime_type, size, photo_type, caption, lat, lng, taken_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
        RETURNING id, created_at
      `, [
        empId, workId, reportId, checkinId,
        uniqueName, file.filename, file.mimetype, finalBuffer.length,
        photoType, caption, lat, lng
      ]);

      return {
        photo_id: inserted[0].id,
        filename: uniqueName,
        url: `/uploads/field/${workId}/${uniqueName}`,
        quote: randomQuote(FIELD_QUOTES_PHOTO),
      };
    } catch (err) {
      fastify.log.error('[field-photos] POST /upload error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET / — list photos
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/', fieldAuth, async (req, reply) => {
    try {
      const workId = parseInt(req.query.work_id);
      if (!workId) return reply.code(400).send({ error: 'Укажите work_id' });

      let sql = `
        SELECT fp.id, fp.employee_id, fp.filename, fp.original_name, fp.photo_type,
               fp.caption, fp.lat, fp.lng, fp.taken_at, fp.created_at,
               e.fio as author_name
        FROM field_photos fp
        JOIN employees e ON e.id = fp.employee_id
        WHERE fp.work_id = $1
      `;
      const params = [workId];
      let idx = 2;

      if (req.query.date) {
        sql += ` AND fp.created_at::date = $${idx}`;
        params.push(req.query.date);
        idx++;
      }
      if (req.query.report_id) {
        sql += ` AND fp.report_id = $${idx}`;
        params.push(parseInt(req.query.report_id));
        idx++;
      }
      if (req.query.photo_type) {
        sql += ` AND fp.photo_type = $${idx}`;
        params.push(req.query.photo_type);
        idx++;
      }

      sql += ` ORDER BY fp.created_at DESC LIMIT 200`;

      const { rows } = await db.query(sql, params);

      // Add URL
      const photos = rows.map(p => ({
        ...p,
        url: `/uploads/field/${workId}/${p.filename}`,
      }));

      return { photos };
    } catch (err) {
      fastify.log.error('[field-photos] GET / error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });
}

module.exports = routes;
