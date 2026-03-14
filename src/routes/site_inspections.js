/**
 * ASGARD CRM — Site Inspections & Business Trips API
 * ═══════════════════════════════════════════════════════════
 * Модуль "Осмотр объекта" + Командировки
 *
 * Endpoints:
 *   GET    /                   — список заявок (фильтры: work_id, status)
 *   GET    /:id                — детали заявки
 *   POST   /                   — создать заявку
 *   PUT    /:id                — обновить заявку
 *   PUT    /:id/status         — сменить статус
 *   GET    /:id/pdf            — скачать PDF заявки
 *   POST   /:id/send-email     — отправить email клиенту
 *
 *   POST   /trips              — создать командировку
 *   PUT    /trips/:id          — обновить командировку
 *   PUT    /trips/:id/status   — сменить статус командировки
 *   POST   /trips/:id/send     — отправить (уведомить office manager + создать аванс)
 *   GET    /trips/:id/pdf      — PDF командировки
 */

'use strict';

const PDFDocument = require('pdfkit');
const path = require('path');

// DejaVuSans font path (same pattern as pass_requests.js)
const fontDir = path.join(__dirname, '..', '..', 'public', 'assets', 'fonts');
const fs_check = require('fs');
const FONT_REGULAR = fs_check.existsSync(path.join(fontDir, 'DejaVuSans.ttf')) ? path.join(fontDir, 'DejaVuSans.ttf') : undefined;
const FONT_BOLD = fs_check.existsSync(path.join(fontDir, 'DejaVuSans-Bold.ttf')) ? path.join(fontDir, 'DejaVuSans-Bold.ttf') : undefined;

// Valid status transitions
const INSPECTION_TRANSITIONS = {
  draft:        ['sent'],
  sent:         ['approved', 'rejected'],
  approved:     ['trip_planned'],
  rejected:     ['draft'],
  trip_planned: ['trip_sent', 'completed'],
  trip_sent:    ['completed'],
  completed:    []
};

const TRIP_TRANSITIONS = {
  draft:     ['sent'],
  sent:      ['approved', 'rejected'],
  approved:  ['completed'],
  rejected:  ['draft'],
  completed: []
};

module.exports = async function (fastify) {
  const db = fastify.db;

  // ═══════════════════════════════════════════════════════════════════════════
  // SITE INSPECTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── GET / — Список заявок ─────────────────────────────────────────────
  fastify.get('/', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { work_id, tender_id, estimate_id, status, author_id } = request.query;
    const conditions = [];
    const params = [];
    let idx = 1;

    if (work_id) { conditions.push(`si.work_id = $${idx++}`); params.push(work_id); }
    if (tender_id) { conditions.push(`si.tender_id = $${idx++}`); params.push(tender_id); }
    if (estimate_id) { conditions.push(`si.estimate_id = $${idx++}`); params.push(estimate_id); }
    if (status) { conditions.push(`si.status = $${idx++}`); params.push(status); }
    if (author_id) { conditions.push(`si.author_id = $${idx++}`); params.push(author_id); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const { rows } = await db.query(`
      SELECT si.*, u.name as author_name
      FROM site_inspections si
      LEFT JOIN users u ON u.id = si.author_id
      ${where}
      ORDER BY si.created_at DESC
    `, params);

    return rows;
  });

  // ─── GET /:id — Детали ────────────────────────────────────────────────
  fastify.get('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { rows } = await db.query(`
      SELECT si.*, u.name as author_name
      FROM site_inspections si
      LEFT JOIN users u ON u.id = si.author_id
      WHERE si.id = $1
    `, [id]);

    if (!rows.length) return reply.code(404).send({ error: 'Заявка не найдена' });

    // Attach business trips
    const trips = await db.query(`SELECT * FROM business_trips WHERE inspection_id = $1 ORDER BY created_at DESC`, [id]);

    return { ...rows[0], trips: trips.rows };
  });

  // ─── POST / — Создать заявку ──────────────────────────────────────────
  fastify.post('/', {
    preHandler: [fastify.requirePermission('works', 'write')]
  }, async (request, reply) => {
    const user = request.user;
    const {
      work_id, estimate_id, tender_id,
      object_name, object_address,
      customer_name, customer_contact_person, customer_contact_email, customer_contact_phone,
      inspection_dates, employees_json, vehicles_json,
      notes
    } = request.body;

    if (!object_name || !object_name.trim()) {
      return reply.code(400).send({ error: 'Укажите название объекта' });
    }

    const { rows } = await db.query(`
      INSERT INTO site_inspections
        (work_id, estimate_id, tender_id,
         object_name, object_address,
         customer_name, customer_contact_person, customer_contact_email, customer_contact_phone,
         inspection_dates, employees_json, vehicles_json,
         notes, author_id, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'draft')
      RETURNING *
    `, [
      work_id || null, estimate_id || null, tender_id || null,
      object_name.trim(), object_address || null,
      customer_name || null, customer_contact_person || null,
      customer_contact_email || null, customer_contact_phone || null,
      JSON.stringify(inspection_dates || []),
      JSON.stringify(employees_json || []),
      JSON.stringify(vehicles_json || []),
      notes || null, user.id
    ]);

    return reply.code(201).send(rows[0]);
  });

  // ─── PUT /:id — Обновить заявку ───────────────────────────────────────
  fastify.put('/:id', {
    preHandler: [fastify.requirePermission('works', 'write')]
  }, async (request, reply) => {
    const { id } = request.params;
    const existing = await db.query('SELECT * FROM site_inspections WHERE id = $1', [id]);
    if (!existing.rows.length) return reply.code(404).send({ error: 'Заявка не найдена' });

    const si = existing.rows[0];
    // Only editable in draft or sent status
    if (!['draft', 'sent'].includes(si.status)) {
      return reply.code(400).send({ error: 'Заявку нельзя редактировать в текущем статусе' });
    }

    const b = request.body;
    const { rows } = await db.query(`
      UPDATE site_inspections SET
        object_name = COALESCE($2, object_name),
        object_address = COALESCE($3, object_address),
        customer_name = COALESCE($4, customer_name),
        customer_contact_person = COALESCE($5, customer_contact_person),
        customer_contact_email = COALESCE($6, customer_contact_email),
        customer_contact_phone = COALESCE($7, customer_contact_phone),
        inspection_dates = COALESCE($8, inspection_dates),
        employees_json = COALESCE($9, employees_json),
        vehicles_json = COALESCE($10, vehicles_json),
        notes = COALESCE($11, notes),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [
      id,
      b.object_name || null, b.object_address || null,
      b.customer_name || null, b.customer_contact_person || null,
      b.customer_contact_email || null, b.customer_contact_phone || null,
      b.inspection_dates ? JSON.stringify(b.inspection_dates) : null,
      b.employees_json ? JSON.stringify(b.employees_json) : null,
      b.vehicles_json ? JSON.stringify(b.vehicles_json) : null,
      b.notes || null
    ]);

    return rows[0];
  });

  // ─── PUT /:id/status — Сменить статус ─────────────────────────────────
  fastify.put('/:id/status', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { status, reason } = request.body;
    const user = request.user;

    const existing = await db.query('SELECT * FROM site_inspections WHERE id = $1', [id]);
    if (!existing.rows.length) return reply.code(404).send({ error: 'Заявка не найдена' });

    const si = existing.rows[0];
    const allowed = INSPECTION_TRANSITIONS[si.status] || [];
    if (!allowed.includes(status)) {
      return reply.code(400).send({
        error: `Нельзя перейти из "${si.status}" в "${status}". Допустимо: ${allowed.join(', ') || 'нет переходов'}`
      });
    }

    const updates = [`status = $2`, `updated_at = NOW()`];
    const params = [id, status];
    let idx = 3;

    if (status === 'sent') {
      updates.push(`sent_at = NOW()`);
    }
    if (status === 'approved') {
      updates.push(`approved_by = $${idx}`); params.push(user.id); idx++;
      updates.push(`approved_at = NOW()`);
    }
    if (status === 'rejected') {
      updates.push(`rejected_at = NOW()`);
      if (reason) { updates.push(`rejected_reason = $${idx}`); params.push(reason); idx++; }
    }

    const { rows } = await db.query(
      `UPDATE site_inspections SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
      params
    );

    // Notify author on approval/rejection
    if (['approved', 'rejected'].includes(status) && si.author_id) {
      const msg = status === 'approved'
        ? `Осмотр объекта "${si.object_name}" одобрен`
        : `Осмотр объекта "${si.object_name}" отклонён${reason ? ': ' + reason : ''}`;

      try {
        await db.query(`
          INSERT INTO notifications (user_id, title, message, type, entity_id, entity_type, url, created_at)
          VALUES ($1, $2, $3, 'site_inspection', $4, 'site_inspection', $5, NOW())
        `, [si.author_id, 'Осмотр объекта', msg, si.id, `#/pm-works`]);
      } catch (_) { /* notification is non-critical */ }
    }

    return rows[0];
  });

  // ─── GET /:id/pdf — Скачать PDF ──────────────────────────────────────
  fastify.get('/:id/pdf', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { rows } = await db.query('SELECT * FROM site_inspections WHERE id = $1', [id]);
    if (!rows.length) return reply.code(404).send({ error: 'Заявка не найдена' });

    const si = rows[0];

    // Get work title
    let workTitle = '';
    if (si.work_id) {
      const w = await db.query('SELECT work_title FROM works WHERE id = $1', [si.work_id]);
      workTitle = w.rows[0]?.work_title || '';
    }

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));

    let fontOk = false;
    try { if (FONT_REGULAR) doc.registerFont('Regular', FONT_REGULAR); if (FONT_BOLD) doc.registerFont('Bold', FONT_BOLD); fontOk = !!(FONT_REGULAR && FONT_BOLD); } catch (_) {}

    const setFont = (name, size) => {
      if (fontOk) doc.font(name); else doc.font('Helvetica' + (name === 'Bold' ? '-Bold' : ''));
      doc.fontSize(size);
    };

    // Header
    setFont('Bold', 16);
    doc.text('ЗАЯВКА НА ОСМОТР ОБЪЕКТА', { align: 'center' });
    doc.moveDown(0.3);
    setFont('Regular', 9);
    doc.text('ООО «АСГАРД-СЕРВИС»', { align: 'center' });
    doc.moveDown(1);

    // Object data
    setFont('Bold', 11);
    doc.text('Данные объекта');
    setFont('Regular', 10);
    doc.moveDown(0.3);
    doc.text(`Объект: ${si.object_name || '—'}`);
    doc.text(`Адрес: ${si.object_address || '—'}`);
    if (workTitle) doc.text(`Работа: ${workTitle}`);
    doc.text(`Заказчик: ${si.customer_name || '—'}`);
    doc.text(`Контактное лицо: ${si.customer_contact_person || '—'}`);
    doc.text(`Email: ${si.customer_contact_email || '—'}`);
    doc.text(`Телефон: ${si.customer_contact_phone || '—'}`);
    doc.moveDown(0.8);

    // Dates
    const dates = (typeof si.inspection_dates === 'string' ? JSON.parse(si.inspection_dates) : si.inspection_dates) || [];
    if (dates.length) {
      setFont('Bold', 11);
      doc.text('Возможные даты осмотра');
      setFont('Regular', 10);
      doc.moveDown(0.3);
      dates.forEach((d, i) => {
        doc.text(`${i + 1}. ${d.date || '—'}  с ${d.time_from || '—'} до ${d.time_to || '—'}`);
      });
      doc.moveDown(0.8);
    }

    // Employees
    const employees = (typeof si.employees_json === 'string' ? JSON.parse(si.employees_json) : si.employees_json) || [];
    if (employees.length) {
      setFont('Bold', 11);
      doc.text('Сотрудники');
      setFont('Regular', 10);
      doc.moveDown(0.3);
      employees.forEach((e, i) => {
        const passport = (e.passport_series && e.passport_number) ? `, паспорт: ${e.passport_series} ${e.passport_number}` : '';
        doc.text(`${i + 1}. ${e.fio || '—'} — ${e.position || '—'}${passport}${e.phone ? ', тел: ' + e.phone : ''}`);
      });
      doc.moveDown(0.8);
    }

    // Vehicles
    const vehicles = (typeof si.vehicles_json === 'string' ? JSON.parse(si.vehicles_json) : si.vehicles_json) || [];
    if (vehicles.length) {
      setFont('Bold', 11);
      doc.text('Транспортные средства');
      setFont('Regular', 10);
      doc.moveDown(0.3);
      vehicles.forEach((v, i) => {
        doc.text(`${i + 1}. ${v.brand || ''} ${v.model || ''} — гос. номер: ${v.plate_number || '—'}${v.driver_fio ? ', водитель: ' + v.driver_fio : ''}`);
      });
      doc.moveDown(0.8);
    }

    // Notes
    if (si.notes) {
      setFont('Bold', 11);
      doc.text('Примечания');
      setFont('Regular', 10);
      doc.moveDown(0.3);
      doc.text(si.notes);
      doc.moveDown(0.8);
    }

    // Signatures
    doc.moveDown(1);
    setFont('Regular', 10);
    const sigY = doc.y;
    doc.text('Руководитель проекта: _______________', 50, sigY);
    doc.text(`Дата: ${new Date().toLocaleDateString('ru-RU')}`, 350, sigY);

    doc.end();

    return new Promise((resolve) => {
      doc.on('end', () => {
        const buf = Buffer.concat(chunks);
        reply
          .header('Content-Type', 'application/pdf')
          .header('Content-Disposition', `attachment; filename="inspection_${id}.pdf"`)
          .send(buf);
        resolve();
      });
    });
  });

  // ─── POST /:id/send-email — Отправить email ──────────────────────────
  fastify.post('/:id/send-email', {
    preHandler: [fastify.requirePermission('works', 'write')]
  }, async (request, reply) => {
    const { id } = request.params;
    const { to, subject, body: emailBody } = request.body;
    const user = request.user;

    const existing = await db.query('SELECT * FROM site_inspections WHERE id = $1', [id]);
    if (!existing.rows.length) return reply.code(404).send({ error: 'Заявка не найдена' });

    const si = existing.rows[0];
    const recipientEmail = to || si.customer_contact_email;

    if (!recipientEmail) {
      return reply.code(400).send({ error: 'Не указан email получателя' });
    }

    // Queue email (uses existing email module)
    try {
      await db.query(`
        INSERT INTO email_queue (recipient, subject, body, status, created_at)
        VALUES ($1, $2, $3, 'pending', NOW())
      `, [
        recipientEmail,
        subject || `Заявка на осмотр объекта: ${si.object_name}`,
        emailBody || buildEmailBody(si)
      ]);
    } catch (e) {
      fastify.log.error(e);
      return reply.code(500).send({ error: 'Ошибка постановки email в очередь' });
    }

    // Update status to 'sent' if still draft
    if (si.status === 'draft') {
      await db.query(`
        UPDATE site_inspections SET status = 'sent', sent_at = NOW(), email_sent_to = $2, updated_at = NOW()
        WHERE id = $1
      `, [id, recipientEmail]);
    }

    return { success: true, message: 'Email поставлен в очередь отправки' };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BUSINESS TRIPS
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── POST /trips — Создать командировку ───────────────────────────────
  fastify.post('/trips', {
    preHandler: [fastify.requirePermission('works', 'write')]
  }, async (request, reply) => {
    const user = request.user;
    const b = request.body;

    if (!b.inspection_id && !b.work_id) {
      return reply.code(400).send({ error: 'Укажите inspection_id или work_id' });
    }

    const { rows } = await db.query(`
      INSERT INTO business_trips
        (inspection_id, work_id, date_from, date_to,
         employees_json, transport_type,
         need_fuel_card, need_air_ticket, need_advance, advance_amount,
         ticket_details, notes, author_id, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'draft')
      RETURNING *
    `, [
      b.inspection_id || null, b.work_id || null,
      b.date_from || null, b.date_to || null,
      JSON.stringify(b.employees_json || []),
      b.transport_type || null,
      !!b.need_fuel_card, !!b.need_air_ticket, !!b.need_advance,
      b.advance_amount || null,
      b.ticket_details || null, b.notes || null,
      user.id
    ]);

    return reply.code(201).send(rows[0]);
  });

  // ─── PUT /trips/:id — Обновить командировку ──────────────────────────
  fastify.put('/trips/:id', {
    preHandler: [fastify.requirePermission('works', 'write')]
  }, async (request, reply) => {
    const { id } = request.params;
    const existing = await db.query('SELECT * FROM business_trips WHERE id = $1', [id]);
    if (!existing.rows.length) return reply.code(404).send({ error: 'Командировка не найдена' });

    const trip = existing.rows[0];
    if (!['draft'].includes(trip.status)) {
      return reply.code(400).send({ error: 'Командировку нельзя редактировать в текущем статусе' });
    }

    const b = request.body;
    const { rows } = await db.query(`
      UPDATE business_trips SET
        date_from = COALESCE($2, date_from),
        date_to = COALESCE($3, date_to),
        employees_json = COALESCE($4, employees_json),
        transport_type = COALESCE($5, transport_type),
        need_fuel_card = COALESCE($6, need_fuel_card),
        need_air_ticket = COALESCE($7, need_air_ticket),
        need_advance = COALESCE($8, need_advance),
        advance_amount = COALESCE($9, advance_amount),
        ticket_details = COALESCE($10, ticket_details),
        notes = COALESCE($11, notes),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [
      id,
      b.date_from || null, b.date_to || null,
      b.employees_json ? JSON.stringify(b.employees_json) : null,
      b.transport_type || null,
      b.need_fuel_card != null ? !!b.need_fuel_card : null,
      b.need_air_ticket != null ? !!b.need_air_ticket : null,
      b.need_advance != null ? !!b.need_advance : null,
      b.advance_amount || null,
      b.ticket_details || null, b.notes || null
    ]);

    return rows[0];
  });

  // ─── PUT /trips/:id/status — Сменить статус ──────────────────────────
  fastify.put('/trips/:id/status', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { status } = request.body;
    const user = request.user;

    const existing = await db.query('SELECT * FROM business_trips WHERE id = $1', [id]);
    if (!existing.rows.length) return reply.code(404).send({ error: 'Командировка не найдена' });

    const trip = existing.rows[0];
    const allowed = TRIP_TRANSITIONS[trip.status] || [];
    if (!allowed.includes(status)) {
      return reply.code(400).send({
        error: `Нельзя перейти из "${trip.status}" в "${status}". Допустимо: ${allowed.join(', ') || 'нет'}`
      });
    }

    const updates = [`status = $2`, `updated_at = NOW()`];
    const params = [id, status];
    let idx = 3;

    if (status === 'approved') {
      updates.push(`approved_by = $${idx}`); params.push(user.id); idx++;
      updates.push(`approved_at = NOW()`);
    }

    const { rows } = await db.query(
      `UPDATE business_trips SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
      params
    );

    return rows[0];
  });

  // ─── POST /trips/:id/send — Отправить (notify + аванс) ───────────────
  fastify.post('/trips/:id/send', {
    preHandler: [fastify.requirePermission('works', 'write')]
  }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user;

    const existing = await db.query('SELECT * FROM business_trips WHERE id = $1', [id]);
    if (!existing.rows.length) return reply.code(404).send({ error: 'Командировка не найдена' });

    const trip = existing.rows[0];
    let inspectionName = 'Осмотр объекта';

    if (trip.inspection_id) {
      const si = await db.query('SELECT object_name FROM site_inspections WHERE id = $1', [trip.inspection_id]);
      inspectionName = si.rows[0]?.object_name || inspectionName;
    }

    // 1. Update status to 'sent'
    await db.query(`
      UPDATE business_trips SET status = 'sent', sent_to_office_manager = true,
        office_manager_notified_at = NOW(), updated_at = NOW()
      WHERE id = $1
    `, [id]);

    // 2. Notify OFFICE_MANAGER if need_fuel_card or need_air_ticket
    if (trip.need_fuel_card || trip.need_air_ticket) {
      const needs = [];
      if (trip.need_fuel_card) needs.push('топливная карта');
      if (trip.need_air_ticket) needs.push('авиабилет');

      const officeManagers = await db.query(
        `SELECT id FROM users WHERE role IN ('OFFICE_MANAGER', 'ADMIN') AND is_active = true`
      );

      for (const om of officeManagers.rows) {
        try {
          await db.query(`
            INSERT INTO notifications (user_id, title, message, type, entity_id, entity_type, url, created_at)
            VALUES ($1, 'Заявка на командировку', $2, 'business_trip', $3, 'business_trip', '#/pm-works', NOW())
          `, [om.id, `Новая заявка на командировку: ${inspectionName}. Требуется: ${needs.join(', ')}`, id]);
        } catch (_) {}
      }
    }

    // 3. Create cash_request if need_advance
    let cashRequestId = null;
    if (trip.need_advance && trip.advance_amount > 0) {
      try {
        const cashResult = await db.query(`
          INSERT INTO cash_requests
            (user_id, work_id, type, amount, purpose, cover_letter, status, created_at, updated_at)
          VALUES ($1, $2, 'advance', $3, $4, $5, 'requested', NOW(), NOW())
          RETURNING id
        `, [
          user.id,
          trip.work_id,
          trip.advance_amount,
          `Аванс на командировку: ${inspectionName}`,
          `Автоматически создано из модуля командировок (business_trip #${id})`
        ]);

        cashRequestId = cashResult.rows[0]?.id;

        // Link cash_request to trip
        if (cashRequestId) {
          await db.query(
            `UPDATE business_trips SET cash_request_id = $2, updated_at = NOW() WHERE id = $1`,
            [id, cashRequestId]
          );
        }

        // Notify directors for advance approval
        const directors = await db.query(
          `SELECT id FROM users WHERE role IN ('DIRECTOR_GEN', 'DIRECTOR_COMM', 'HEAD_PM', 'ADMIN') AND is_active = true`
        );
        for (const dir of directors.rows) {
          try {
            await db.query(`
              INSERT INTO notifications (user_id, title, message, type, entity_id, entity_type, url, created_at)
              VALUES ($1, 'Заявка на аванс', $2, 'cash_request', $3, 'cash_request', '#/cash', NOW())
            `, [dir.id, `Заявка на аванс ${Number(trip.advance_amount).toLocaleString('ru-RU')} ₽: ${inspectionName}`, cashRequestId]);
          } catch (_) {}
        }
      } catch (e) {
        fastify.log.error('Failed to create cash_request:', e);
      }
    }

    // 4. Update inspection status to trip_planned
    if (trip.inspection_id) {
      await db.query(`
        UPDATE site_inspections SET status = 'trip_planned', updated_at = NOW()
        WHERE id = $1 AND status = 'approved'
      `, [trip.inspection_id]);
    }

    return {
      success: true,
      cash_request_id: cashRequestId,
      message: 'Командировка отправлена'
    };
  });

  // ─── GET /trips/:id/pdf — PDF командировки ───────────────────────────
  fastify.get('/trips/:id/pdf', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { rows } = await db.query('SELECT * FROM business_trips WHERE id = $1', [id]);
    if (!rows.length) return reply.code(404).send({ error: 'Командировка не найдена' });

    const trip = rows[0];

    // Get inspection info
    let inspectionName = '';
    if (trip.inspection_id) {
      const si = await db.query('SELECT object_name, object_address FROM site_inspections WHERE id = $1', [trip.inspection_id]);
      inspectionName = si.rows[0]?.object_name || '';
    }

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));

    let fontOk = false;
    try { if (FONT_REGULAR) doc.registerFont('Regular', FONT_REGULAR); if (FONT_BOLD) doc.registerFont('Bold', FONT_BOLD); fontOk = !!(FONT_REGULAR && FONT_BOLD); } catch (_) {}
    const setFont = (name, size) => {
      if (fontOk) doc.font(name); else doc.font('Helvetica' + (name === 'Bold' ? '-Bold' : ''));
      doc.fontSize(size);
    };

    setFont('Bold', 16);
    doc.text('КОМАНДИРОВКА НА ОСМОТР ОБЪЕКТА', { align: 'center' });
    doc.moveDown(0.3);
    setFont('Regular', 9);
    doc.text('ООО «АСГАРД-СЕРВИС»', { align: 'center' });
    doc.moveDown(1);

    setFont('Bold', 11);
    doc.text('Общая информация');
    setFont('Regular', 10);
    doc.moveDown(0.3);
    if (inspectionName) doc.text(`Объект: ${inspectionName}`);
    doc.text(`Даты: ${trip.date_from || '—'} — ${trip.date_to || '—'}`);

    const transportLabels = { auto: 'Автомобиль', rail: 'Ж/Д', air: 'Авиа', mixed: 'Комбинированный' };
    doc.text(`Способ передвижения: ${transportLabels[trip.transport_type] || trip.transport_type || '—'}`);

    const needs = [];
    if (trip.need_fuel_card) needs.push('Топливная карта');
    if (trip.need_air_ticket) needs.push('Авиабилет');
    if (trip.need_advance) needs.push(`Аванс: ${Number(trip.advance_amount || 0).toLocaleString('ru-RU')} ₽`);
    if (needs.length) doc.text(`Потребности: ${needs.join(', ')}`);
    doc.moveDown(0.8);

    // Employees
    const employees = (typeof trip.employees_json === 'string' ? JSON.parse(trip.employees_json) : trip.employees_json) || [];
    if (employees.length) {
      setFont('Bold', 11);
      doc.text('Сотрудники');
      setFont('Regular', 10);
      doc.moveDown(0.3);
      employees.forEach((e, i) => {
        doc.text(`${i + 1}. ${e.fio || '—'} — ${e.position || '—'}`);
      });
      doc.moveDown(0.8);
    }

    if (trip.notes) {
      setFont('Bold', 11); doc.text('Примечания');
      setFont('Regular', 10); doc.moveDown(0.3);
      doc.text(trip.notes);
    }

    doc.moveDown(1.5);
    setFont('Regular', 10);
    doc.text('Руководитель проекта: _______________');
    doc.text(`Дата: ${new Date().toLocaleDateString('ru-RU')}`);

    doc.end();

    return new Promise((resolve) => {
      doc.on('end', () => {
        const buf = Buffer.concat(chunks);
        reply
          .header('Content-Type', 'application/pdf')
          .header('Content-Disposition', `attachment; filename="trip_${id}.pdf"`)
          .send(buf);
        resolve();
      });
    });
  });

  // ═══ Helper: Build email body ═════════════════════════════════════════
  function buildEmailBody(si) {
    const dates = (typeof si.inspection_dates === 'string' ? JSON.parse(si.inspection_dates) : si.inspection_dates) || [];
    const employees = (typeof si.employees_json === 'string' ? JSON.parse(si.employees_json) : si.employees_json) || [];
    const vehicles = (typeof si.vehicles_json === 'string' ? JSON.parse(si.vehicles_json) : si.vehicles_json) || [];

    let text = `Уважаемый(ая) ${si.customer_contact_person || 'коллега'},\n\n`;
    text += `Направляем заявку на осмотр объекта: ${si.object_name || '—'}\n`;
    text += `Адрес: ${si.object_address || '—'}\n\n`;

    if (dates.length) {
      text += 'Возможные даты осмотра:\n';
      dates.forEach((d, i) => {
        text += `  ${i + 1}. ${d.date || '—'} с ${d.time_from || '—'} до ${d.time_to || '—'}\n`;
      });
      text += '\n';
    }

    if (employees.length) {
      text += 'Данные сотрудников для оформления пропуска:\n';
      employees.forEach((e, i) => {
        const passport = (e.passport_series && e.passport_number) ? `, паспорт: ${e.passport_series} ${e.passport_number}` : '';
        text += `  ${i + 1}. ${e.fio || '—'}${e.position ? ', ' + e.position : ''}${passport}${e.phone ? ', тел: ' + e.phone : ''}\n`;
      });
      text += '\n';
    }

    if (vehicles.length) {
      text += 'Транспортные средства:\n';
      vehicles.forEach((v, i) => {
        text += `  ${i + 1}. ${v.brand || ''} ${v.model || ''}, гос. номер: ${v.plate_number || '—'}${v.driver_fio ? ', водитель: ' + v.driver_fio : ''}\n`;
      });
      text += '\n';
    }

    if (si.notes) text += `Примечания: ${si.notes}\n\n`;

    text += 'С уважением,\nООО «АСГАРД-СЕРВИС»';
    return text;
  }
};
