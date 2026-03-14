'use strict';

/**
 * ASGARD CRM — Заявки на пропуск
 *
 * GET    /              — Список заявок
 * GET    /:id           — Детали
 * POST   /              — Создать
 * PUT    /:id           — Обновить
 * DELETE /:id           — Удалить черновик
 * PUT    /:id/status    — Сменить статус
 * GET    /:id/pdf       — PDF заявки
 */

const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const WRITE_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'HR', 'HR_MANAGER', 'DIRECTOR_GEN'];

async function routes(fastify, options) {
  const db = fastify.db;
  const { createNotification } = require('../services/notify');

  // ═══════════════════════════════════════════════════════════════
  // GET / — Список
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { work_id, status, limit = 100, offset = 0 } = request.query;
    let sql = `
      SELECT pr.*, u.name as creator_name, w.work_title, ap.name as approver_name
      FROM pass_requests pr
      LEFT JOIN users u ON pr.author_id = u.id
      LEFT JOIN works w ON pr.work_id = w.id
      LEFT JOIN users ap ON pr.approved_by = ap.id
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;
    if (work_id) { sql += ` AND pr.work_id = $${idx++}`; params.push(work_id); }
    if (status) { sql += ` AND pr.status = $${idx++}`; params.push(status); }
    sql += ` ORDER BY pr.id DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(Math.min(parseInt(limit), 200), parseInt(offset));

    const { rows } = await db.query(sql, params);
    return { items: rows };
  });

  // ═══════════════════════════════════════════════════════════════
  // GET /:id — Детали
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { rows } = await db.query(`
      SELECT pr.*, u.name as creator_name, w.work_title,
             ap.name as approver_name
      FROM pass_requests pr
      LEFT JOIN users u ON pr.author_id = u.id
      LEFT JOIN works w ON pr.work_id = w.id
      LEFT JOIN users ap ON pr.approved_by = ap.id
      WHERE pr.id = $1
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
    const { work_id, object_name, pass_date_from, pass_date_to,
            employees_json, vehicles_json, equipment_json,
            contact_person, contact_phone, notes } = request.body;

    if (!object_name || !object_name.trim()) {
      return reply.code(400).send({ error: 'Укажите объект' });
    }
    if (!pass_date_from || !pass_date_to) {
      return reply.code(400).send({ error: 'Укажите даты действия пропуска' });
    }

    const { rows } = await db.query(`
      INSERT INTO pass_requests (work_id, object_name, date_from, date_to,
        workers, vehicles, equipment_json,
        contact_person, contact_phone, notes, author_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `, [
      work_id || null, object_name.trim(), pass_date_from, pass_date_to,
      employees_json ? JSON.stringify(employees_json) : '[]',
      vehicles_json ? JSON.stringify(vehicles_json) : '[]',
      equipment_json ? JSON.stringify(equipment_json) : '[]',
      contact_person || null, contact_phone || null, notes || null,
      request.user.id
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
    const allowed = ['work_id', 'object_name', 'date_from', 'date_to',
                     'workers', 'vehicles', 'equipment_json',
                     'contact_person', 'contact_phone', 'notes'];
    const updates = [];
    const values = [];
    let idx = 1;

    // Map frontend field names to DB column names
    if (request.body.employees_json !== undefined && request.body.workers === undefined) {
      request.body.workers = JSON.stringify(request.body.employees_json);
    }
    if (request.body.vehicles_json !== undefined && request.body.vehicles === undefined) {
      request.body.vehicles = JSON.stringify(request.body.vehicles_json);
    }

    for (const key of allowed) {
      if (request.body[key] !== undefined) {
        const val = key.endsWith('_json') ? JSON.stringify(request.body[key]) : request.body[key];
        updates.push(`${key} = $${idx++}`);
        values.push(val);
      }
    }
    if (!updates.length) return reply.code(400).send({ error: 'Нет данных' });

    updates.push('updated_at = NOW()');
    values.push(id);
    const { rows } = await db.query(
      `UPDATE pass_requests SET ${updates.join(', ')} WHERE id = $${idx} AND status IN ('draft','submitted') RETURNING *`,
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
      `DELETE FROM pass_requests WHERE id = $1 AND status = 'draft' RETURNING id`,
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
    const valid = ['draft', 'submitted', 'approved', 'rejected', 'issued', 'expired'];
    if (!valid.includes(status)) {
      return reply.code(400).send({ error: `Статус: ${valid.join(', ')}` });
    }

    const extra = [];
    const extraVals = [];
    let idx = 2;
    if (status === 'approved' || status === 'rejected') {
      extra.push(`approved_by = $${idx++}`, `approved_at = NOW()`);
      extraVals.push(request.user.id);
    }

    const sql = `UPDATE pass_requests SET status = $1${extra.length ? ', ' + extra.join(', ') : ''}, updated_at = NOW() WHERE id = $${idx} RETURNING *`;
    const { rows } = await db.query(sql, [status, ...extraVals, id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Заявка не найдена' });

    // Notifications
    if (status === 'submitted') {
      const directors = await db.query(
        `SELECT id FROM users WHERE role IN ('ADMIN','DIRECTOR_GEN','HR','HR_MANAGER') AND is_active = true`
      );
      for (const d of directors.rows) {
        if (d.id !== request.user.id) {
          createNotification(db, {
            user_id: d.id,
            title: '🏗 Заявка на пропуск',
            message: `${request.user.name || 'Пользователь'} подал заявку на пропуск: ${rows[0].object_name}`,
            type: 'pass_request',
            link: `#/pass-requests?id=${id}`
          });
        }
      }
    } else if (['approved', 'rejected'].includes(status) && rows[0].author_id && rows[0].author_id !== request.user.id) {
      const label = status === 'approved' ? '✅ одобрена' : '❌ отклонена';
      createNotification(db, {
        user_id: rows[0].author_id,
        title: `Заявка на пропуск ${label}`,
        message: `Заявка на пропуск "${rows[0].object_name}" — ${label}`,
        type: 'pass_request',
        link: `#/pass-requests?id=${id}`
      });
    }

    return { item: rows[0] };
  });

  // ═══════════════════════════════════════════════════════════════
  // GET /:id/pdf — PDF заявки на пропуск
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/:id/pdf', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { rows } = await db.query(`
      SELECT pr.*, u.name as creator_name, w.work_title
      FROM pass_requests pr
      LEFT JOIN users u ON pr.author_id = u.id
      LEFT JOIN works w ON pr.work_id = w.id
      WHERE pr.id = $1
    `, [request.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Заявка не найдена' });
    const pr = rows[0];

    const fontPath = path.join(__dirname, '..', '..', 'public', 'assets', 'fonts');
    const regularFont = fs.existsSync(path.join(fontPath, 'DejaVuSans.ttf'))
      ? path.join(fontPath, 'DejaVuSans.ttf') : undefined;
    const boldFont = fs.existsSync(path.join(fontPath, 'DejaVuSans-Bold.ttf'))
      ? path.join(fontPath, 'DejaVuSans-Bold.ttf') : undefined;

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    if (regularFont) doc.registerFont('Regular', regularFont);
    if (boldFont) doc.registerFont('Bold', boldFont);
    const mf = regularFont ? 'Regular' : 'Helvetica';
    const bf = boldFont ? 'Bold' : 'Helvetica-Bold';

    const chunks = [];
    doc.on('data', c => chunks.push(c));

    // Header
    doc.font(bf).fontSize(14).text('ЗАЯВКА НА ОФОРМЛЕНИЕ ПРОПУСКА', { align: 'center' });
    doc.moveDown(0.3);
    doc.font(mf).fontSize(10).text(`№ ${pr.id} от ${new Date(pr.created_at).toLocaleDateString('ru-RU')}`, { align: 'center' });
    doc.moveDown(1);

    // Object
    doc.font(bf).fontSize(11).text('Объект: ', { continued: true });
    doc.font(mf).text(pr.object_name || '—');

    if (pr.work_title) {
      doc.font(bf).text('Работа: ', { continued: true });
      doc.font(mf).text(pr.work_title);
    }

    doc.font(bf).text('Период: ', { continued: true });
    doc.font(mf).text(`${pr.date_from || '—'} — ${pr.date_to || '—'}`);

    if (pr.contact_person) {
      doc.font(bf).text('Контактное лицо: ', { continued: true });
      doc.font(mf).text(`${pr.contact_person}${pr.contact_phone ? ', тел: ' + pr.contact_phone : ''}`);
    }
    doc.moveDown(1);

    // Employees
    const employees = Array.isArray(pr.workers) ? pr.workers : [];
    if (employees.length) {
      doc.font(bf).fontSize(11).text('Сотрудники:');
      doc.moveDown(0.3);
      let n = 1;
      for (const emp of employees) {
        doc.font(mf).fontSize(10).text(
          `${n}. ${emp.fio || emp.name || 'Без имени'} — паспорт: ${emp.passport || '—'}, должность: ${emp.position || '—'}`
        );
        n++;
      }
      doc.moveDown(0.5);
    }

    // Vehicles
    const vehicles = Array.isArray(pr.vehicles) ? pr.vehicles : [];
    if (vehicles.length) {
      doc.font(bf).fontSize(11).text('Транспортные средства:');
      doc.moveDown(0.3);
      let n = 1;
      for (const v of vehicles) {
        doc.font(mf).fontSize(10).text(
          `${n}. ${v.brand || v.type || 'ТС'} — гос.номер: ${v.plate || v.number || '—'}`
        );
        n++;
      }
      doc.moveDown(0.5);
    }

    // Equipment
    const equipment = Array.isArray(pr.equipment_json) ? pr.equipment_json : [];
    if (equipment.length) {
      doc.font(bf).fontSize(11).text('Оборудование:');
      doc.moveDown(0.3);
      let n = 1;
      for (const eq of equipment) {
        doc.font(mf).fontSize(10).text(
          `${n}. ${eq.name || 'Оборудование'} — ${eq.serial || eq.quantity || '—'}`
        );
        n++;
      }
      doc.moveDown(0.5);
    }

    // Notes
    if (pr.notes) {
      doc.font(bf).fontSize(11).text('Примечания:');
      doc.font(mf).fontSize(10).text(pr.notes);
      doc.moveDown(0.5);
    }

    // Signatures
    doc.moveDown(2);
    doc.font(mf).fontSize(10).text(`Составил: ${pr.creator_name || '_______________'}`, 50);
    doc.moveDown(1);
    doc.text('Согласовал: _______________');
    doc.moveDown(1);
    doc.font(mf).fontSize(8).fillColor('#6b7280')
      .text('ООО «АСГАРД СЕРВИС»', { align: 'center' });

    doc.end();
    await new Promise(resolve => doc.on('end', resolve));
    const buffer = Buffer.concat(chunks);

    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="Pass_Request_${pr.id}.pdf"`);
    return reply.send(buffer);
  });
}

module.exports = routes;
