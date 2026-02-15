'use strict';

/**
 * ASGARD CRM — Заявки на ТМЦ (товарно-материальные ценности)
 *
 * GET    /              — Список заявок
 * GET    /:id           — Детали
 * POST   /              — Создать
 * PUT    /:id           — Обновить
 * DELETE /:id           — Удалить черновик
 * PUT    /:id/status    — Сменить статус
 * GET    /:id/excel     — Экспорт в Excel
 * GET    /export        — Массовый Excel экспорт
 */

const ExcelJS = require('exceljs');

const WRITE_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'BUH'];

async function routes(fastify, options) {
  const db = fastify.db;
  const { createNotification } = require('../services/notify');

  // ═══════════════════════════════════════════════════════════════
  // GET / — Список
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { work_id, status, priority, limit = 100, offset = 0 } = request.query;
    let sql = `
      SELECT tr.*, u.name as creator_name, w.work_title, ap.name as approver_name
      FROM tmc_requests tr
      LEFT JOIN users u ON tr.author_id = u.id
      LEFT JOIN works w ON tr.work_id = w.id
      LEFT JOIN users ap ON tr.approved_by = ap.id
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;
    if (work_id) { sql += ` AND tr.work_id = $${idx++}`; params.push(work_id); }
    if (status) { sql += ` AND tr.status = $${idx++}`; params.push(status); }
    if (priority) { sql += ` AND tr.priority = $${idx++}`; params.push(priority); }
    sql += ` ORDER BY tr.id DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(Math.min(parseInt(limit), 200), parseInt(offset));

    const { rows } = await db.query(sql, params);
    return { items: rows };
  });

  // ═══════════════════════════════════════════════════════════════
  // GET /export — Массовый Excel экспорт
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/export', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { status, work_id } = request.query;
    let sql = `SELECT tr.*, u.name as creator_name, w.work_title FROM tmc_requests tr
      LEFT JOIN users u ON tr.author_id = u.id LEFT JOIN works w ON tr.work_id = w.id WHERE 1=1`;
    const params = [];
    let idx = 1;
    if (status) { sql += ` AND tr.status = $${idx++}`; params.push(status); }
    if (work_id) { sql += ` AND tr.work_id = $${idx++}`; params.push(work_id); }
    sql += ' ORDER BY tr.id DESC LIMIT 500';
    const { rows } = await db.query(sql, params);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'ASGARD CRM';
    const ws = wb.addWorksheet('Заявки ТМЦ');

    // Header
    ws.mergeCells('A1:H1');
    ws.getCell('A1').value = 'ООО «АСГАРД СЕРВИС» — Реестр заявок на ТМЦ';
    ws.getCell('A1').font = { bold: true, size: 14 };
    ws.getRow(2).values = [];

    // Table header
    const headerRow = ws.getRow(3);
    const headers = ['№', 'Дата', 'Название', 'Проект', 'Приоритет', 'Сумма', 'Статус', 'Автор'];
    headerRow.values = headers;
    headerRow.font = { bold: true };
    headerRow.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } }; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; });

    ws.columns = [
      { width: 6 }, { width: 12 }, { width: 30 }, { width: 25 },
      { width: 12 }, { width: 14 }, { width: 14 }, { width: 20 }
    ];

    let rowNum = 4;
    for (const r of rows) {
      ws.getRow(rowNum).values = [
        r.id,
        r.created_at ? new Date(r.created_at).toLocaleDateString('ru-RU') : '',
        r.title || '',
        r.work_title || '',
        r.priority || 'normal',
        r.total_sum ? Number(r.total_sum) : 0,
        r.status || '',
        r.creator_name || ''
      ];
      rowNum++;
    }

    const buffer = await wb.xlsx.writeBuffer();
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', 'attachment; filename="TMC_Requests.xlsx"');
    return reply.send(Buffer.from(buffer));
  });

  // ═══════════════════════════════════════════════════════════════
  // GET /:id — Детали
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { rows } = await db.query(`
      SELECT tr.*, u.name as creator_name, w.work_title, ap.name as approver_name
      FROM tmc_requests tr
      LEFT JOIN users u ON tr.author_id = u.id
      LEFT JOIN works w ON tr.work_id = w.id
      LEFT JOIN users ap ON tr.approved_by = ap.id
      WHERE tr.id = $1
    `, [request.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Заявка не найдена' });
    return { item: rows[0] };
  });

  // ═══════════════════════════════════════════════════════════════
  // POST / — Создать
  // ═══════════════════════════════════════════════════════════════
  fastify.post('/', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const { work_id, title, items_json, total_sum, priority,
            needed_by, delivery_address, supplier, notes } = request.body;

    if (!title || !title.trim()) {
      return reply.code(400).send({ error: 'Обязательное поле: title' });
    }

    const { rows } = await db.query(`
      INSERT INTO tmc_requests (work_id, title, items, total_sum, priority,
        needed_by, delivery_address, supplier, notes, author_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
    `, [
      work_id || null, title.trim(),
      items_json ? JSON.stringify(items_json) : '[]',
      total_sum || 0, priority || 'normal',
      needed_by || null, delivery_address || null,
      supplier || null, notes || null, request.user.id
    ]);

    return { item: rows[0] };
  });

  // ═══════════════════════════════════════════════════════════════
  // PUT /:id — Обновить
  // ═══════════════════════════════════════════════════════════════
  fastify.put('/:id', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const allowed = ['work_id', 'title', 'items', 'total_sum', 'priority',
                     'needed_by', 'delivery_address', 'supplier', 'notes'];
    const updates = [];
    const values = [];
    let idx = 1;

    for (const key of allowed) {
      if (request.body[key] !== undefined) {
        const val = key === 'items' ? JSON.stringify(request.body[key]) : request.body[key];
        updates.push(`${key} = $${idx++}`);
        values.push(val);
      }
    }
    if (!updates.length) return reply.code(400).send({ error: 'Нет данных' });

    updates.push('updated_at = NOW()');
    values.push(id);
    const { rows } = await db.query(
      `UPDATE tmc_requests SET ${updates.join(', ')} WHERE id = $${idx} AND status IN ('draft','submitted') RETURNING *`,
      values
    );
    if (!rows[0]) return reply.code(404).send({ error: 'Заявка не найдена или не редактируема' });
    return { item: rows[0] };
  });

  // ═══════════════════════════════════════════════════════════════
  // DELETE /:id — Удалить черновик
  // ═══════════════════════════════════════════════════════════════
  fastify.delete('/:id', {
    preHandler: [fastify.requireRoles(['ADMIN'])]
  }, async (request, reply) => {
    const { rows } = await db.query(
      `DELETE FROM tmc_requests WHERE id = $1 AND status = 'draft' RETURNING id`,
      [request.params.id]
    );
    if (!rows[0]) return reply.code(404).send({ error: 'Заявка не найдена или не является черновиком' });
    return { success: true };
  });

  // ═══════════════════════════════════════════════════════════════
  // PUT /:id/status — Сменить статус
  // ═══════════════════════════════════════════════════════════════
  fastify.put('/:id/status', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const { status } = request.body;
    const valid = ['draft', 'submitted', 'approved', 'rejected', 'ordered', 'delivered', 'closed'];
    if (!valid.includes(status)) {
      return reply.code(400).send({ error: `Статус: ${valid.join(', ')}` });
    }

    const extra = [];
    const extraVals = [];
    let idx = 2;
    if (['approved', 'rejected'].includes(status)) {
      extra.push(`approved_by = $${idx++}`, `approved_at = NOW()`);
      extraVals.push(request.user.id);
    }

    const sql = `UPDATE tmc_requests SET status = $1${extra.length ? ', ' + extra.join(', ') : ''}, updated_at = NOW() WHERE id = $${idx} RETURNING *`;
    const { rows } = await db.query(sql, [status, ...extraVals, id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Заявка не найдена' });

    // Notifications
    const statusLabels = { submitted: 'подана', approved: 'одобрена', rejected: 'отклонена', ordered: 'заказана', delivered: 'доставлена' };
    if (status === 'submitted') {
      const directors = await db.query(
        `SELECT id FROM users WHERE role IN ('ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','BUH') AND is_active = true`
      );
      for (const d of directors.rows) {
        if (d.id !== request.user.id) {
          createNotification(db, {
            user_id: d.id,
            title: '📦 Заявка на ТМЦ',
            message: `${request.user.name || 'Пользователь'} подал заявку: ${rows[0].title}${rows[0].total_sum ? ' — ' + rows[0].total_sum + ' ₽' : ''}`,
            type: 'tmc',
            link: `#/tmc-requests?id=${id}`
          });
        }
      }
    } else if (statusLabels[status] && rows[0].author_id && rows[0].author_id !== request.user.id) {
      createNotification(db, {
        user_id: rows[0].author_id,
        title: `📦 Заявка ТМЦ ${statusLabels[status]}`,
        message: `Заявка "${rows[0].title}" — ${statusLabels[status]}`,
        type: 'tmc',
        link: `#/tmc-requests?id=${id}`
      });
    }

    return { item: rows[0] };
  });

  // ═══════════════════════════════════════════════════════════════
  // GET /:id/excel — Экспорт одной заявки
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/:id/excel', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { rows } = await db.query(`
      SELECT tr.*, u.name as creator_name, w.work_title
      FROM tmc_requests tr
      LEFT JOIN users u ON tr.author_id = u.id
      LEFT JOIN works w ON tr.work_id = w.id
      WHERE tr.id = $1
    `, [request.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Заявка не найдена' });
    const req = rows[0];
    const items = Array.isArray(req.items) ? req.items : [];

    const wb = new ExcelJS.Workbook();
    wb.creator = 'ASGARD CRM';
    const ws = wb.addWorksheet('Заявка ТМЦ');

    // Header
    ws.mergeCells('A1:G1');
    ws.getCell('A1').value = 'ООО «АСГАРД СЕРВИС»';
    ws.getCell('A1').font = { bold: true, size: 14 };

    ws.mergeCells('A2:G2');
    ws.getCell('A2').value = `Заявка на ТМЦ №${req.id} от ${new Date(req.created_at).toLocaleDateString('ru-RU')}`;
    ws.getCell('A2').font = { bold: true, size: 12 };

    ws.getRow(3).values = ['Название:', req.title || ''];
    if (req.work_title) ws.getRow(4).values = ['Проект:', req.work_title];
    if (req.supplier) ws.getRow(5).values = ['Поставщик:', req.supplier];
    ws.getRow(6).values = [];

    // Items table
    const headerRow = ws.getRow(7);
    headerRow.values = ['№', 'Артикул', 'Наименование', 'Ед.', 'Кол-во', 'Цена', 'Сумма'];
    headerRow.font = { bold: true };
    headerRow.eachCell(c => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } };
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.border = { bottom: { style: 'thin' } };
    });

    ws.columns = [
      { width: 5 }, { width: 14 }, { width: 35 }, { width: 8 },
      { width: 10 }, { width: 12 }, { width: 14 }
    ];

    let rowNum = 8;
    let grandTotal = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const total = (parseFloat(item.quantity) || 0) * (parseFloat(item.price) || 0);
      grandTotal += total;
      const row = ws.getRow(rowNum);
      row.values = [
        i + 1,
        item.article || '',
        item.name || '',
        item.unit || 'шт.',
        item.quantity || 0,
        item.price || 0,
        item.total || total
      ];
      row.getCell(6).numFmt = '#,##0.00';
      row.getCell(7).numFmt = '#,##0.00';
      rowNum++;
    }

    // Total row
    const totalRow = ws.getRow(rowNum);
    totalRow.values = ['', '', '', '', '', 'ИТОГО:', grandTotal || req.total_sum || 0];
    totalRow.font = { bold: true };
    totalRow.getCell(7).numFmt = '#,##0.00';

    const buffer = await wb.xlsx.writeBuffer();
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="TMC_Request_${req.id}.xlsx"`);
    return reply.send(Buffer.from(buffer));
  });
}

module.exports = routes;
