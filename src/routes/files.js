/**
 * Files Routes - Upload/Download
 * SECURITY: ????????? ????????? ????? ?????? (MED-3)
 * SECURITY: ???????? auth ? download (HIGH-2)
 */
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');

async function routes(fastify, options) {
  const db = fastify.db;
  const uploadDir = process.env.UPLOAD_DIR || './uploads';
  const uploadBaseDir = path.resolve(uploadDir);

  // SECURITY: ????? ?????? ?????????? ?????? (MED-3)
  const ALLOWED_EXTENSIONS = [
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg',
    '.zip', '.rar', '.7z', '.tar', '.gz',
    '.txt', '.csv', '.rtf', '.odt', '.ods'
  ];

  function parseNumericId(value) {
    const rawValue = String(value || '').trim();
    if (!/^\d+$/.test(rawValue)) return null;
    return parseInt(rawValue, 10);
  }

  function getSafeFilenameParam(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed !== path.basename(trimmed)) return null;
    if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) return null;
    return trimmed;
  }

  function resolveStoredFilePath(storedPath) {
    if (typeof storedPath !== 'string') return null;

    const trimmed = storedPath.trim();
    if (!trimmed || trimmed.includes('\0')) return null;

    const normalizedPath = path.normalize(trimmed);
    const resolvedPath = path.resolve(path.isAbsolute(normalizedPath) ? normalizedPath : path.join(uploadBaseDir, normalizedPath));
    const relativePath = path.relative(uploadBaseDir, resolvedPath);

    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return null;
    }

    return resolvedPath;
  }

  function buildContentDisposition(filename) {
    const preferredName = (filename || '').trim() || 'download';
    const fallbackName = preferredName
      .replace(/[\r\n"]/g, '_')
      .replace(/[^\w.()\- ]+/g, '_')
      .trim() || 'download';
    const encodedName = encodeURIComponent(preferredName)
      .replace(/['()]/g, escape)
      .replace(/\*/g, '%2A');

    return `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`;
  }

  // Ensure upload directory exists
  try {
    await fs.mkdir(uploadBaseDir, { recursive: true });
  } catch (e) {}

  fastify.post('/upload', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const parts = request.parts();
    let file = null;
    let tenderId = null;
    let workId = null;
    let docType = '????????';

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
        if (part.fieldname === 'type') docType = part.value || '????????';
      }
    }

    if (!file) return reply.code(400).send({ error: '???? ?? ???????' });

    // SECURITY: ???????? ?????????? ????? (MED-3)
    const ext = path.extname(file.filename).toLowerCase() || '';
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return reply.code(400).send({ error: '???????????? ??? ?????: ' + ext });
    }

    const filename = `${uuidv4()}${ext}`;
    const filepath = path.join(uploadBaseDir, filename);

    await fs.writeFile(filepath, file.buffer);

    const result = await db.query(`
      INSERT INTO documents (filename, original_name, mime_type, size, type, tender_id, work_id, uploaded_by, download_url, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      RETURNING *
    `, [filename, file.filename, file.mimetype, file.buffer.length, docType, tenderId || null, workId || null, request.user.id, `/api/files/download/${filename}`]);

    return { success: true, file: result.rows[0], download_url: `/api/files/download/${filename}` };
  });

  // SECURITY: ???????? auth ? download (HIGH-2)
  fastify.get('/download/:filename', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const requestedFilename = getSafeFilenameParam(request.params.filename);
    if (!requestedFilename) {
      return reply.code(400).send({ error: '???????????? ????????????? ?????' });
    }

    const result = await db.query(
      'SELECT filename, original_name, mime_type FROM documents WHERE filename = $1 LIMIT 1',
      [requestedFilename]
    );
    const doc = result.rows[0];

    if (!doc || !doc.filename) {
      return reply.code(404).send({ error: '???? ?? ??????' });
    }

    const filePath = resolveStoredFilePath(doc.filename);
    if (!filePath) {
      return reply.code(404).send({ error: '???? ?? ??????' });
    }

    try {
      await fs.access(filePath);
    } catch (e) {
      return reply.code(404).send({ error: '???? ?? ??????' });
    }

    const buffer = await fs.readFile(filePath);

    reply
      .header('Content-Type', doc.mime_type || 'application/octet-stream')
      .header('Content-Disposition', buildContentDisposition(doc.original_name || doc.filename))
      .send(buffer);
  });

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tender_id, work_id, type, limit = 50, cascade = 'true' } = request.query;
    const params = [];
    let idx = 1;

    // ??????: ??? ??????? ?? work_id ? ????? ??????????? ????????? ?? ???????
    // ??? ??????? ?? tender_id ? ????? ??????????? ????????? ?? ????????? ?????
    if (cascade !== 'false' && (work_id || tender_id)) {
      const conditions = [];

      if (work_id) {
        conditions.push(`work_id = $${idx}`);
        params.push(work_id);
        idx++;
        // ????? tender_id ?? ?????? ? ????????? ??? ?????????
        const workRes = await db.query('SELECT tender_id FROM works WHERE id = $1', [work_id]);
        if (workRes.rows.length && workRes.rows[0].tender_id) {
          conditions.push(`tender_id = $${idx}`);
          params.push(workRes.rows[0].tender_id);
          idx++;
        }
      } else if (tender_id) {
        conditions.push(`tender_id = $${idx}`);
        params.push(tender_id);
        idx++;
        // ????????? ????????? ?? ????????? ?????
        const worksRes = await db.query('SELECT id FROM works WHERE tender_id = $1', [tender_id]);
        for (const w of worksRes.rows) {
          conditions.push(`work_id = $${idx}`);
          params.push(w.id);
          idx++;
        }
      }

      let sql = `SELECT * FROM documents WHERE (${conditions.join(' OR ')})`;
      if (type) { sql += ` AND type = $${idx}`; params.push(type); idx++; }
      sql += ` ORDER BY created_at DESC LIMIT $${idx}`;
      params.push(parseInt(limit));
      const result = await db.query(sql, params);
      return { files: result.rows };
    }

    // ??????? ?????? ??? ???????
    let sql = 'SELECT * FROM documents WHERE 1=1';
    if (tender_id) { sql += ` AND tender_id = $${idx}`; params.push(tender_id); idx++; }
    if (work_id) { sql += ` AND work_id = $${idx}`; params.push(work_id); idx++; }
    if (type) { sql += ` AND type = $${idx}`; params.push(type); idx++; }
    sql += ` ORDER BY created_at DESC LIMIT $${idx}`;
    params.push(parseInt(limit));
    const result = await db.query(sql, params);
    return { files: result.rows };
  });

  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const fileId = parseNumericId(request.params.id);
    if (fileId === null) {
      return reply.code(400).send({ error: '???????????? ????????????? ?????' });
    }

    // Get file info
    const result = await db.query('SELECT * FROM documents WHERE id = $1', [fileId]);
    const fileRecord = result.rows[0];
    if (!fileRecord) return reply.code(404).send({ error: '???? ?? ??????' });

    // Check permissions (owner or admin)
    if (fileRecord.uploaded_by !== request.user.id && request.user.role !== 'ADMIN') {
      return reply.code(403).send({ error: '???????????? ????' });
    }

    const filePath = resolveStoredFilePath(fileRecord.filename);
    if (!filePath) {
      return reply.code(404).send({ error: '???? ?? ??????' });
    }

    try {
      await fs.access(filePath);
    } catch (e) {
      return reply.code(404).send({ error: '???? ?? ??????' });
    }

    await fs.unlink(filePath);

    // Delete from DB
    await db.query('DELETE FROM documents WHERE id = $1', [fileId]);

    return { message: '???? ??????' };
  });
}

module.exports = routes;
