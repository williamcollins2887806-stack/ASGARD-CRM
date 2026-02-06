/**
 * Files Routes - Upload/Download
 * SECURITY: Добавлена валидация типов файлов (MED-3)
 * SECURITY: Добавлен auth к download (HIGH-2)
 */
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');

async function routes(fastify, options) {
  const db = fastify.db;
  const uploadDir = process.env.UPLOAD_DIR || './uploads';

  // SECURITY: Белый список расширений файлов (MED-3)
  const ALLOWED_EXTENSIONS = [
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg',
    '.zip', '.rar', '.7z', '.tar', '.gz',
    '.txt', '.csv', '.rtf', '.odt', '.ods'
  ];

  // Ensure upload directory exists
  try {
    await fs.mkdir(uploadDir, { recursive: true });
  } catch (e) {}

  fastify.post('/upload', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const parts = request.parts();
    let file = null;
    let tenderId = null;
    let workId = null;
    let docType = 'Документ';

    for await (const part of parts) {
      if (part.file) {
        file = {
          filename: part.filename,
          mimetype: part.mimetype,
          buffer: await part.toBuffer()
        };
      } else {
        if (part.fieldname === 'tender_id') tenderId = part.value;
        if (part.fieldname === 'work_id') workId = part.value;
        if (part.fieldname === 'type') docType = part.value || 'Документ';
      }
    }

    if (!file) return reply.code(400).send({ error: 'Файл не передан' });

    // SECURITY: Проверка расширения файла (MED-3)
    const ext = path.extname(file.filename).toLowerCase() || '';
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return reply.code(400).send({ error: 'Недопустимый тип файла: ' + ext });
    }

    const filename = `${uuidv4()}${ext}`;
    const filepath = path.join(uploadDir, filename);

    await fs.writeFile(filepath, file.buffer);

    const result = await db.query(`
      INSERT INTO documents (filename, original_name, mime_type, size, type, tender_id, work_id, uploaded_by, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      RETURNING *
    `, [filename, file.filename, file.mimetype, file.buffer.length, docType, tenderId || null, workId || null, request.user.id]);

    return { success: true, file: result.rows[0], download_url: `/api/files/download/${filename}` };
  });

  // SECURITY: Добавлен auth к download (HIGH-2)
  fastify.get('/download/:filename', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { filename } = request.params;

    // Защита от Path Traversal атак
    const safeFilename = path.basename(filename);
    const filepath = path.join(uploadDir, safeFilename);
    const realPath = path.resolve(filepath);
    const uploadDirReal = path.resolve(uploadDir);

    if (!realPath.startsWith(uploadDirReal)) {
      return reply.code(403).send({ error: 'Недопустимый путь' });
    }

    try {
      await fs.access(filepath);
    } catch (e) {
      return reply.code(404).send({ error: 'Файл не найден' });
    }

    // Get original name from DB
    const result = await db.query('SELECT original_name, mime_type FROM documents WHERE filename = $1', [filename]);
    const doc = result.rows[0];

    const buffer = await fs.readFile(filepath);
    
    reply
      .header('Content-Type', doc?.mime_type || 'application/octet-stream')
      .header('Content-Disposition', `attachment; filename="${encodeURIComponent(doc?.original_name || filename)}"`)
      .send(buffer);
  });

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tender_id, work_id, type, limit = 50 } = request.query;
    let sql = 'SELECT * FROM documents WHERE 1=1';
    const params = [];
    let idx = 1;
    if (tender_id) { sql += ` AND tender_id = $${idx}`; params.push(tender_id); idx++; }
    if (work_id) { sql += ` AND work_id = $${idx}`; params.push(work_id); idx++; }
    if (type) { sql += ` AND type = $${idx}`; params.push(type); idx++; }
    sql += ` ORDER BY created_at DESC LIMIT $${idx}`;
    params.push(limit);
    const result = await db.query(sql, params);
    return { files: result.rows };
  });

  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    
    // Get file info
    const result = await db.query('SELECT * FROM documents WHERE id = $1', [id]);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Файл не найден' });

    // Check permissions (owner or admin)
    if (result.rows[0].uploaded_by !== request.user.id && request.user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Недостаточно прав' });
    }

    // Delete file from disk
    try {
      await fs.unlink(path.join(uploadDir, result.rows[0].filename));
    } catch (e) {}

    // Delete from DB
    await db.query('DELETE FROM documents WHERE id = $1', [id]);

    return { message: 'Файл удалён' };
  });
}

module.exports = routes;
