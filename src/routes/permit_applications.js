/**
 * ASGARD CRM — Заявки на оформление разрешений
 * Требования маршрутной карты: №38, №39, №40
 *
 * GET    /                    — Список заявок с фильтрами
 * GET    /:id                 — Детали заявки с элементами
 * POST   /                    — Создать заявку (транзакция)
 * PUT    /:id                 — Обновить черновик (транзакция)
 * DELETE /:id                 — Удалить черновик
 * POST   /:id/status          — Изменить статус
 * GET    /:id/excel            — Скачать Excel-реестр
 * POST   /:id/send             — Отправить email подрядчику
 * GET    /contractors          — Автокомплит подрядчиков
 * GET    /types                — Список типов разрешений
 * POST   /types                — Добавить кастомный тип
 * PUT    /types/:id            — Редактировать тип
 * DELETE /types/:id            — Деактивировать кастомный тип
 */

const ExcelJS = require('exceljs');
const nodemailer = require('nodemailer');

async function routes(fastify, options) {
  const db = fastify.db;

  const ALLOWED_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HR', 'TO', 'HEAD_TO', 'HR_MANAGER'];
  const TYPE_MGMT_ROLES = ['ADMIN', 'HR', 'TO', 'HEAD_TO', 'HR_MANAGER'];

  function checkAccess(user) {
    if (user.role === 'ADMIN') return true;
    return ALLOWED_ROLES.includes(user.role);
  }
  function checkTypeMgmt(user) {
    if (user.role === 'ADMIN') return true;
    return TYPE_MGMT_ROLES.includes(user.role);
  }

  const CATEGORY_NAMES = {
    safety: 'Безопасность', electric: 'Электрика', special: 'Спецработы',
    medical: 'Медицина', attest: 'Аттестация', offshore: 'Шельф / Морские',
    gas: 'Газоопасные', transport: 'Транспорт'
  };
  const CATEGORY_COLORS = {
    safety: '#22c55e', electric: '#f59e0b', special: '#3b82f6',
    medical: '#ef4444', attest: '#8b5cf6', offshore: '#06b6d4',
    gas: '#f97316', transport: '#64748b'
  };

  const STATUS_TRANSITIONS = {
    draft: ['cancelled'],
    sent: ['in_progress', 'cancelled'],
    in_progress: ['completed', 'cancelled']
  };

  // ═══════════════════════════════════════════════════════════════
  // Nodemailer transport (same pattern as email.js)
  // ═══════════════════════════════════════════════════════════════
  let _transporter = null;
  async function getTransporter() {
    if (_transporter) return _transporter;
    try {
      const result = await db.query("SELECT value_json FROM settings WHERE key = 'smtp_config'");
      if (result.rows.length > 0) {
        const config = JSON.parse(result.rows[0].value_json);
        _transporter = nodemailer.createTransport(config);
        return _transporter;
      }
    } catch (e) { /* fallback */ }

    if (process.env.SMTP_HOST) {
      _transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      });
      return _transporter;
    }

    // Test mode
    _transporter = {
      sendMail: async (opts) => {
        console.log('[PermitApp] Email (test mode):', JSON.stringify({
          to: opts.to, cc: opts.cc, subject: opts.subject,
          attachments: (opts.attachments || []).map(a => a.filename)
        }));
        return { messageId: 'test_' + Date.now() + '@asgard-crm' };
      }
    };
    return _transporter;
  }

  // ═══════════════════════════════════════════════════════════════
  // 1. GET / — Список заявок
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    if (!checkAccess(user)) return reply.code(403).send({ error: 'Недостаточно прав' });

    const { status, search, limit: lim, offset: off } = request.query;
    const limit = Math.min(parseInt(lim) || 50, 200);
    const offset = parseInt(off) || 0;

    try {
      const params = [status || null, search || null, limit, offset];
      const { rows } = await db.query(`
        SELECT
          pa.*,
          u.name as created_by_name,
          COALESCE(stats.employee_count, 0)::int as employee_count,
          COALESCE(stats.permit_count, 0)::int as permit_count
        FROM permit_applications pa
        LEFT JOIN users u ON u.id = pa.created_by
        LEFT JOIN LATERAL (
          SELECT
            COUNT(DISTINCT pai.employee_id) as employee_count,
            SUM(COALESCE(array_length(pai.permit_type_ids, 1), 0)) as permit_count
          FROM permit_application_items pai
          WHERE pai.application_id = pa.id
        ) stats ON TRUE
        WHERE ($1::text IS NULL OR pa.status = $1)
          AND ($2::text IS NULL OR (
            pa.number ILIKE '%' || $2 || '%'
            OR pa.contractor_name ILIKE '%' || $2 || '%'
            OR pa.title ILIKE '%' || $2 || '%'
          ))
        ORDER BY pa.created_at DESC
        LIMIT $3 OFFSET $4
      `, params);

      const countRes = await db.query(`
        SELECT COUNT(*) as total
        FROM permit_applications pa
        WHERE ($1::text IS NULL OR pa.status = $1)
          AND ($2::text IS NULL OR (
            pa.number ILIKE '%' || $2 || '%'
            OR pa.contractor_name ILIKE '%' || $2 || '%'
            OR pa.title ILIKE '%' || $2 || '%'
          ))
      `, [status || null, search || null]);

      return { applications: rows, total: parseInt(countRes.rows[0].total) };
    } catch (error) {
      console.error('[PermitApp] GET / error:', error);
      return reply.code(500).send({ error: error.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 2. GET /:id — Детали заявки
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    if (!checkAccess(user)) return reply.code(403).send({ error: 'Недостаточно прав' });

    const { id } = request.params;
    try {
      // Application
      const appRes = await db.query(`
        SELECT pa.*,
          u1.name as created_by_name,
          u2.name as sent_by_name
        FROM permit_applications pa
        LEFT JOIN users u1 ON u1.id = pa.created_by
        LEFT JOIN users u2 ON u2.id = pa.sent_by
        WHERE pa.id = $1
      `, [id]);
      if (appRes.rows.length === 0) return reply.code(404).send({ error: 'Заявка не найдена' });
      const application = appRes.rows[0];

      // Items with employee data
      const itemsRes = await db.query(`
        SELECT pai.*,
          e.fio as employee_fio,
          e.full_name as employee_full_name,
          e.role_tag as employee_role_tag,
          e.phone as employee_phone
        FROM permit_application_items pai
        LEFT JOIN employees e ON e.id = pai.employee_id
        WHERE pai.application_id = $1
        ORDER BY e.fio
      `, [id]);

      // Get permit type names for each item
      const allTypeIds = new Set();
      itemsRes.rows.forEach(item => {
        (item.permit_type_ids || []).forEach(tid => allTypeIds.add(tid));
      });

      let typeMap = {};
      if (allTypeIds.size > 0) {
        const typesRes = await db.query(
          'SELECT id, code, name, category FROM permit_types WHERE id = ANY($1)',
          [Array.from(allTypeIds)]
        );
        typesRes.rows.forEach(t => { typeMap[t.id] = t; });
      }

      // Get existing permits for employees
      const empIds = [...new Set(itemsRes.rows.map(i => i.employee_id))];
      let existingPermitsMap = {};
      if (empIds.length > 0) {
        const epRes = await db.query(
          'SELECT * FROM employee_permits WHERE employee_id = ANY($1)',
          [empIds]
        );
        epRes.rows.forEach(ep => {
          if (!existingPermitsMap[ep.employee_id]) existingPermitsMap[ep.employee_id] = [];
          existingPermitsMap[ep.employee_id].push(ep);
        });
      }

      const items = itemsRes.rows.map(item => ({
        ...item,
        employee_fio: item.employee_fio || item.employee_full_name || 'Сотрудник #' + item.employee_id,
        permit_type_names: (item.permit_type_ids || []).map(tid =>
          typeMap[tid] ? typeMap[tid].name : 'Тип #' + tid
        ),
        permit_type_details: (item.permit_type_ids || []).map(tid => typeMap[tid] || { id: tid, name: 'Тип #' + tid }),
        existing_permits: existingPermitsMap[item.employee_id] || []
      }));

      // History
      const histRes = await db.query(`
        SELECT pah.*, u.name as changed_by_name
        FROM permit_application_history pah
        LEFT JOIN users u ON u.id = pah.changed_by
        WHERE pah.application_id = $1
        ORDER BY pah.created_at
      `, [id]);

      return { application, items, history: histRes.rows };
    } catch (error) {
      console.error('[PermitApp] GET /:id error:', error);
      return reply.code(500).send({ error: error.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 3. POST / — Создать заявку
  // ═══════════════════════════════════════════════════════════════
  fastify.post('/', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    if (!checkAccess(user)) return reply.code(403).send({ error: 'Недостаточно прав' });

    const { title, contractor_name, contractor_email, cover_letter, items } = request.body || {};

    // Validation
    if (!contractor_name || contractor_name.trim().length < 2) {
      return reply.code(400).send({ error: 'Укажите название подрядчика (мин. 2 символа)' });
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return reply.code(400).send({ error: 'Добавьте хотя бы одного сотрудника' });
    }
    if (items.length > 100) {
      return reply.code(400).send({ error: 'Максимум 100 сотрудников в заявке' });
    }
    for (const item of items) {
      if (!item.employee_id) return reply.code(400).send({ error: 'Каждый элемент должен содержать employee_id' });
      if (!item.permit_type_ids || !Array.isArray(item.permit_type_ids) || item.permit_type_ids.length === 0) {
        return reply.code(400).send({ error: 'Для каждого сотрудника выберите хотя бы одно разрешение' });
      }
    }

    try {
      const result = await db.transaction(async (client) => {
        // Insert application (number auto-generated by trigger)
        const appRes = await client.query(`
          INSERT INTO permit_applications (title, contractor_name, contractor_email, cover_letter, created_by)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING *
        `, [title || null, contractor_name.trim(), contractor_email || null, cover_letter || null, user.id]);

        const app = appRes.rows[0];

        // Insert items
        for (const item of items) {
          await client.query(`
            INSERT INTO permit_application_items (application_id, employee_id, permit_type_ids, notes)
            VALUES ($1, $2, $3, $4)
          `, [app.id, item.employee_id, item.permit_type_ids, item.notes || '']);
        }

        // History
        await client.query(`
          INSERT INTO permit_application_history (application_id, old_status, new_status, changed_by)
          VALUES ($1, NULL, 'draft', $2)
        `, [app.id, user.id]);

        return app;
      });

      return reply.code(201).send({ application: result });
    } catch (error) {
      console.error('[PermitApp] POST / error:', error);
      return reply.code(500).send({ error: error.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 4. PUT /:id — Обновить черновик
  // ═══════════════════════════════════════════════════════════════
  fastify.put('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    if (!checkAccess(user)) return reply.code(403).send({ error: 'Недостаточно прав' });

    const { id } = request.params;
    const { title, contractor_name, contractor_email, cover_letter, items } = request.body || {};

    try {
      // Check existing
      const existing = await db.query('SELECT * FROM permit_applications WHERE id = $1', [id]);
      if (existing.rows.length === 0) return reply.code(404).send({ error: 'Заявка не найдена' });

      const app = existing.rows[0];
      if (app.status !== 'draft') {
        return reply.code(409).send({ error: 'Редактировать можно только черновик' });
      }
      if (app.created_by !== user.id && user.role !== 'ADMIN') {
        return reply.code(403).send({ error: 'Редактировать может только автор или ADMIN' });
      }

      // Validation
      if (items && items.length > 100) {
        return reply.code(400).send({ error: 'Максимум 100 сотрудников в заявке' });
      }

      const result = await db.transaction(async (client) => {
        await client.query(`
          UPDATE permit_applications
          SET title = $1, contractor_name = $2, contractor_email = $3,
              cover_letter = $4, updated_at = NOW()
          WHERE id = $5
        `, [
          title !== undefined ? title : app.title,
          contractor_name ? contractor_name.trim() : app.contractor_name,
          contractor_email !== undefined ? contractor_email : app.contractor_email,
          cover_letter !== undefined ? cover_letter : app.cover_letter,
          id
        ]);

        // Replace items if provided
        if (items && Array.isArray(items)) {
          await client.query('DELETE FROM permit_application_items WHERE application_id = $1', [id]);
          for (const item of items) {
            if (!item.employee_id || !item.permit_type_ids || item.permit_type_ids.length === 0) continue;
            await client.query(`
              INSERT INTO permit_application_items (application_id, employee_id, permit_type_ids, notes)
              VALUES ($1, $2, $3, $4)
            `, [id, item.employee_id, item.permit_type_ids, item.notes || '']);
          }
        }

        const updated = await client.query('SELECT * FROM permit_applications WHERE id = $1', [id]);
        return updated.rows[0];
      });

      return { application: result };
    } catch (error) {
      console.error('[PermitApp] PUT /:id error:', error);
      return reply.code(500).send({ error: error.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 5. DELETE /:id — Удалить черновик
  // ═══════════════════════════════════════════════════════════════
  fastify.delete('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    if (!checkAccess(user)) return reply.code(403).send({ error: 'Недостаточно прав' });

    const { id } = request.params;
    try {
      const existing = await db.query('SELECT * FROM permit_applications WHERE id = $1', [id]);
      if (existing.rows.length === 0) return reply.code(404).send({ error: 'Заявка не найдена' });
      if (existing.rows[0].status !== 'draft') {
        return reply.code(409).send({ error: 'Удалить можно только черновик' });
      }

      await db.query('DELETE FROM permit_applications WHERE id = $1', [id]);
      return { success: true };
    } catch (error) {
      console.error('[PermitApp] DELETE /:id error:', error);
      return reply.code(500).send({ error: error.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 6. POST /:id/status — Изменить статус
  // ═══════════════════════════════════════════════════════════════
  fastify.post('/:id/status', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    if (!checkAccess(user)) return reply.code(403).send({ error: 'Недостаточно прав' });

    const { id } = request.params;
    const { status: newStatus, comment } = request.body || {};

    try {
      const existing = await db.query('SELECT * FROM permit_applications WHERE id = $1', [id]);
      if (existing.rows.length === 0) return reply.code(404).send({ error: 'Заявка не найдена' });

      const app = existing.rows[0];
      const allowed = STATUS_TRANSITIONS[app.status];
      if (!allowed || !allowed.includes(newStatus)) {
        return reply.code(400).send({
          error: `Нельзя перевести из "${app.status}" в "${newStatus}"`
        });
      }

      await db.query(`
        UPDATE permit_applications SET status = $1, updated_at = NOW() WHERE id = $2
      `, [newStatus, id]);

      await db.query(`
        INSERT INTO permit_application_history (application_id, old_status, new_status, changed_by, comment)
        VALUES ($1, $2, $3, $4, $5)
      `, [id, app.status, newStatus, user.id, comment || null]);

      return { success: true, status: newStatus };
    } catch (error) {
      console.error('[PermitApp] POST /:id/status error:', error);
      return reply.code(500).send({ error: error.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 7. GET /:id/excel — Скачать Excel-реестр
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/:id/excel', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    if (!checkAccess(user)) return reply.code(403).send({ error: 'Недостаточно прав' });

    const { id } = request.params;
    try {
      // Load application
      const appRes = await db.query('SELECT * FROM permit_applications WHERE id = $1', [id]);
      if (appRes.rows.length === 0) return reply.code(404).send({ error: 'Заявка не найдена' });
      const app = appRes.rows[0];

      // Load items with employees
      const itemsRes = await db.query(`
        SELECT pai.*, e.fio, e.full_name, e.role_tag, e.phone
        FROM permit_application_items pai
        LEFT JOIN employees e ON e.id = pai.employee_id
        WHERE pai.application_id = $1
        ORDER BY e.fio
      `, [id]);

      // Load permit type names
      const allTypeIds = new Set();
      itemsRes.rows.forEach(item => (item.permit_type_ids || []).forEach(tid => allTypeIds.add(tid)));
      let typeMap = {};
      if (allTypeIds.size > 0) {
        const typesRes = await db.query('SELECT id, name FROM permit_types WHERE id = ANY($1)', [Array.from(allTypeIds)]);
        typesRes.rows.forEach(t => { typeMap[t.id] = t.name; });
      }

      // Generate Excel
      const buffer = await generateExcel(app, itemsRes.rows, typeMap);

      const filename = encodeURIComponent((app.number || 'draft') + '_реестр.xlsx');
      reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(Buffer.from(buffer));
    } catch (error) {
      console.error('[PermitApp] GET /:id/excel error:', error);
      return reply.code(500).send({ error: error.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 8. POST /:id/send — Отправить email подрядчику
  // ═══════════════════════════════════════════════════════════════
  fastify.post('/:id/send', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    if (!checkAccess(user)) return reply.code(403).send({ error: 'Недостаточно прав' });

    const { id } = request.params;
    const { copy_to_self } = request.body || {};

    try {
      // Load application
      const appRes = await db.query('SELECT * FROM permit_applications WHERE id = $1', [id]);
      if (appRes.rows.length === 0) return reply.code(404).send({ error: 'Заявка не найдена' });
      const app = appRes.rows[0];

      if (app.status !== 'draft') {
        return reply.code(409).send({ error: 'Отправить можно только черновик' });
      }
      if (!app.contractor_email) {
        return reply.code(400).send({ error: 'Укажите email подрядчика' });
      }

      // Load items
      const itemsRes = await db.query(`
        SELECT pai.*, e.fio, e.full_name, e.role_tag, e.phone
        FROM permit_application_items pai
        LEFT JOIN employees e ON e.id = pai.employee_id
        WHERE pai.application_id = $1
        ORDER BY e.fio
      `, [id]);
      if (itemsRes.rows.length === 0) {
        return reply.code(400).send({ error: 'В заявке нет сотрудников' });
      }

      // Load permit type names
      const allTypeIds = new Set();
      itemsRes.rows.forEach(item => (item.permit_type_ids || []).forEach(tid => allTypeIds.add(tid)));
      let typeMap = {};
      if (allTypeIds.size > 0) {
        const typesRes = await db.query('SELECT id, name FROM permit_types WHERE id = ANY($1)', [Array.from(allTypeIds)]);
        typesRes.rows.forEach(t => { typeMap[t.id] = t.name; });
      }

      // Generate Excel buffer
      const excelBuffer = await generateExcel(app, itemsRes.rows, typeMap);

      // Compute stats
      const employeeCount = new Set(itemsRes.rows.map(i => i.employee_id)).size;
      const permitCount = itemsRes.rows.reduce((s, i) => s + (i.permit_type_ids || []).length, 0);

      // Get cover letter template
      let subject, body;
      if (app.cover_letter) {
        // Use custom cover letter
        body = app.cover_letter;
        subject = `Заявка на оформление разрешений ${app.number || ''} — ООО «Асгард Сервис»`;
      } else {
        // Load template from settings
        try {
          const tplRes = await db.query("SELECT value_json FROM settings WHERE key = 'permit_cover_letter_template'");
          if (tplRes.rows.length > 0) {
            const tpl = JSON.parse(tplRes.rows[0].value_json);
            subject = tpl.subject || '';
            body = tpl.body || '';
          }
        } catch(e) { /* fallback */ }
        if (!subject) subject = `Заявка на оформление разрешений ${app.number || ''} — ООО «Асгард Сервис»`;
        if (!body) body = 'Направляем реестр сотрудников для оформления разрешений. Реестр во вложении.';
      }

      // Replace placeholders
      const dateStr = new Date().toLocaleDateString('ru-RU');
      const replacePlaceholders = (text) => text
        .replace(/\{number\}/g, app.number || '')
        .replace(/\{date\}/g, dateStr)
        .replace(/\{employee_count\}/g, String(employeeCount))
        .replace(/\{permit_count\}/g, String(permitCount))
        .replace(/\{contractor_name\}/g, app.contractor_name || '');

      subject = replacePlaceholders(subject);
      body = replacePlaceholders(body);

      // CC list
      const cc = [];
      try {
        const ccRes = await db.query("SELECT value_json FROM settings WHERE key = 'crm_copy_email'");
        if (ccRes.rows.length > 0) {
          const crmEmail = JSON.parse(ccRes.rows[0].value_json);
          if (crmEmail) cc.push(crmEmail);
        }
      } catch(e) { /* skip */ }
      if (copy_to_self && user.email) cc.push(user.email);

      // Send email
      const transport = await getTransporter();
      const mailResult = await transport.sendMail({
        from: process.env.SMTP_FROM || '"АСГАРД CRM" <noreply@asgard-service.ru>',
        to: app.contractor_email,
        cc: cc.length > 0 ? cc : undefined,
        subject,
        text: body,
        html: body.replace(/\n/g, '<br>'),
        attachments: [{
          filename: (app.number || 'draft') + '_реестр.xlsx',
          content: Buffer.from(excelBuffer),
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        }]
      });

      // Update application status
      await db.query(`
        UPDATE permit_applications
        SET status = 'sent', sent_at = NOW(), sent_by = $1, email_message_id = $2, updated_at = NOW()
        WHERE id = $3
      `, [user.id, mailResult.messageId || null, id]);

      // History
      await db.query(`
        INSERT INTO permit_application_history (application_id, old_status, new_status, changed_by, comment)
        VALUES ($1, 'draft', 'sent', $2, $3)
      `, [id, user.id, 'Отправлено на ' + app.contractor_email]);

      // Log to email_log if table exists
      try {
        await db.query(`
          INSERT INTO email_log (to_email, subject, status, message_id, sent_at, sent_by)
          VALUES ($1, $2, 'sent', $3, NOW(), $4)
        `, [app.contractor_email, subject, mailResult.messageId, user.id]);
      } catch(e) {
        // email_log may not exist — ignore
      }

      return { success: true, messageId: mailResult.messageId };
    } catch (error) {
      console.error('[PermitApp] POST /:id/send error:', error);
      return reply.code(500).send({ error: 'Ошибка отправки: ' + error.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 9. GET /contractors — Автокомплит подрядчиков
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/contractors', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    if (!checkAccess(user)) return reply.code(403).send({ error: 'Недостаточно прав' });

    const { search } = request.query;
    if (!search || search.length < 2) return { contractors: [] };

    try {
      const { rows } = await db.query(`
        SELECT contractor_name as name, contractor_email as email, COUNT(*)::int as count
        FROM permit_applications
        WHERE contractor_name ILIKE '%' || $1 || '%'
        GROUP BY contractor_name, contractor_email
        ORDER BY count DESC
        LIMIT 10
      `, [search]);
      return { contractors: rows };
    } catch (error) {
      console.error('[PermitApp] GET /contractors error:', error);
      return reply.code(500).send({ error: error.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 10. GET /types — Список типов разрешений
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/types', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { rows } = await db.query(`
        SELECT * FROM permit_types WHERE is_active = TRUE ORDER BY sort_order, name
      `);

      // Build categories summary
      const categories = {};
      for (const cat of Object.keys(CATEGORY_NAMES)) {
        const count = rows.filter(r => r.category === cat).length;
        categories[cat] = { name: CATEGORY_NAMES[cat], color: CATEGORY_COLORS[cat], count };
      }

      return { types: rows, categories };
    } catch (error) {
      console.error('[PermitApp] GET /types error:', error);
      return reply.code(500).send({ error: error.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 11. POST /types — Добавить кастомный тип
  // ═══════════════════════════════════════════════════════════════
  fastify.post('/types', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    if (!checkTypeMgmt(user)) return reply.code(403).send({ error: 'Недостаточно прав' });

    const { name, category } = request.body || {};
    if (!name || name.trim().length < 3) {
      return reply.code(400).send({ error: 'Название должно быть не менее 3 символов' });
    }
    const validCategories = Object.keys(CATEGORY_NAMES);
    if (!category || !validCategories.includes(category)) {
      return reply.code(400).send({ error: 'Укажите корректную категорию' });
    }

    try {
      const code = 'custom_' + Date.now();
      const maxOrder = await db.query('SELECT COALESCE(MAX(sort_order), 0) + 10 as next_order FROM permit_types');

      const { rows } = await db.query(`
        INSERT INTO permit_types (code, name, category, sort_order, is_system, is_active, created_by)
        VALUES ($1, $2, $3, $4, FALSE, TRUE, $5)
        RETURNING *
      `, [code, name.trim(), category, maxOrder.rows[0].next_order, user.id]);

      return reply.code(201).send({ type: rows[0] });
    } catch (error) {
      console.error('[PermitApp] POST /types error:', error);
      return reply.code(500).send({ error: error.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 12. PUT /types/:id — Редактировать тип
  // ═══════════════════════════════════════════════════════════════
  fastify.put('/types/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    if (!checkTypeMgmt(user)) return reply.code(403).send({ error: 'Недостаточно прав' });

    const { id } = request.params;
    const { name, category } = request.body || {};

    try {
      const existing = await db.query('SELECT * FROM permit_types WHERE id = $1', [id]);
      if (existing.rows.length === 0) return reply.code(404).send({ error: 'Тип не найден' });

      const pt = existing.rows[0];
      if (pt.is_system) {
        return reply.code(403).send({ error: 'Системный тип нельзя редактировать' });
      }

      const updates = [];
      const params = [];
      let idx = 1;

      if (name !== undefined) {
        updates.push(`name = $${idx++}`);
        params.push(name.trim());
      }
      if (category !== undefined) {
        updates.push(`category = $${idx++}`);
        params.push(category);
      }
      updates.push(`updated_at = NOW()`);
      params.push(id);

      await db.query(`UPDATE permit_types SET ${updates.join(', ')} WHERE id = $${idx}`, params);

      const updated = await db.query('SELECT * FROM permit_types WHERE id = $1', [id]);
      return { type: updated.rows[0] };
    } catch (error) {
      console.error('[PermitApp] PUT /types/:id error:', error);
      return reply.code(500).send({ error: error.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 13. DELETE /types/:id — Деактивировать кастомный тип
  // ═══════════════════════════════════════════════════════════════
  fastify.delete('/types/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    if (!checkTypeMgmt(user)) return reply.code(403).send({ error: 'Недостаточно прав' });

    const { id } = request.params;
    try {
      const existing = await db.query('SELECT * FROM permit_types WHERE id = $1', [id]);
      if (existing.rows.length === 0) return reply.code(404).send({ error: 'Тип не найден' });

      if (existing.rows[0].is_system) {
        return reply.code(403).send({ error: 'Системный тип нельзя удалить' });
      }

      await db.query('UPDATE permit_types SET is_active = FALSE, updated_at = NOW() WHERE id = $1', [id]);
      return { success: true };
    } catch (error) {
      console.error('[PermitApp] DELETE /types/:id error:', error);
      return reply.code(500).send({ error: error.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // Excel generation helper
  // ═══════════════════════════════════════════════════════════════
  async function generateExcel(app, items, typeMap) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ASGARD CRM';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Реестр разрешений', {
      pageSetup: {
        paperSize: 9, // A4
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        margins: { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 }
      }
    });

    // Column widths
    sheet.columns = [
      { width: 6 },   // A: №
      { width: 30 },  // B: ФИО
      { width: 22 },  // C: Должность
      { width: 18 },  // D: Телефон
      { width: 60 },  // E: Разрешения
      { width: 25 }   // F: Примечания
    ];

    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3358' } };
    const headerFont = { name: 'Arial', bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    const borderThin = {
      top: { style: 'thin', color: { argb: 'FF3A5682' } },
      bottom: { style: 'thin', color: { argb: 'FF3A5682' } },
      left: { style: 'thin', color: { argb: 'FF3A5682' } },
      right: { style: 'thin', color: { argb: 'FF3A5682' } }
    };

    // Row 1: Title
    sheet.mergeCells('A1:F1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = 'РЕЕСТР СОТРУДНИКОВ НА ОФОРМЛЕНИЕ РАЗРЕШЕНИЙ';
    titleCell.font = { name: 'Arial', bold: true, size: 16 };
    titleCell.alignment = { horizontal: 'center' };
    sheet.getRow(1).height = 30;

    // Row 2: Application info
    sheet.mergeCells('A2:F2');
    const infoCell = sheet.getCell('A2');
    const dateStr = app.created_at ? new Date(app.created_at).toLocaleDateString('ru-RU') : new Date().toLocaleDateString('ru-RU');
    infoCell.value = `Заявка ${app.number || 'черновик'} от ${dateStr}`;
    infoCell.font = { name: 'Arial', bold: true, size: 12 };

    // Row 3: Contractor
    sheet.mergeCells('A3:F3');
    const contrCell = sheet.getCell('A3');
    contrCell.value = `Подрядчик: ${app.contractor_name || '—'}${app.contractor_email ? ' (' + app.contractor_email + ')' : ''}`;
    contrCell.font = { name: 'Arial', size: 11 };

    // Row 4: empty
    // Row 5: Headers
    const headers = ['№', 'ФИО сотрудника', 'Должность', 'Телефон', 'Требуемые разрешения', 'Примечания'];
    const headerRow = sheet.getRow(5);
    headers.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = h;
      cell.fill = headerFill;
      cell.font = headerFont;
      cell.border = borderThin;
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
    headerRow.height = 22;

    // Data rows
    let totalPermits = 0;
    items.forEach((item, idx) => {
      const row = sheet.getRow(6 + idx);
      const permits = (item.permit_type_ids || []).map(tid => typeMap[tid] || 'Тип #' + tid).join(', ');
      totalPermits += (item.permit_type_ids || []).length;

      row.getCell(1).value = idx + 1;
      row.getCell(2).value = item.fio || item.full_name || 'Сотрудник #' + item.employee_id;
      row.getCell(3).value = item.role_tag || '';
      row.getCell(4).value = item.phone || '';
      row.getCell(5).value = permits;
      row.getCell(6).value = item.notes || '';

      // Alternating row colors
      const bgColor = idx % 2 === 0 ? 'FFF5F7FA' : 'FFFFFFFF';
      for (let c = 1; c <= 6; c++) {
        const cell = row.getCell(c);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
        cell.border = borderThin;
        cell.alignment = { vertical: 'top', wrapText: true };
      }
    });

    // Summary row
    const summaryRowNum = 6 + items.length + 1;
    sheet.mergeCells(`A${summaryRowNum}:F${summaryRowNum}`);
    const summaryCell = sheet.getCell(`A${summaryRowNum}`);
    summaryCell.value = `Всего сотрудников: ${items.length}, разрешений к оформлению: ${totalPermits}`;
    summaryCell.font = { name: 'Arial', bold: true, size: 11 };

    // Generated timestamp
    const tsRowNum = summaryRowNum + 1;
    sheet.mergeCells(`A${tsRowNum}:F${tsRowNum}`);
    const tsCell = sheet.getCell(`A${tsRowNum}`);
    const now = new Date();
    tsCell.value = `Документ сформирован: ${now.toLocaleDateString('ru-RU')} в ${now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} | ASGARD CRM`;
    tsCell.font = { name: 'Arial', italic: true, size: 9, color: { argb: 'FF888888' } };

    return workbook.xlsx.writeBuffer();
  }
}

module.exports = routes;
