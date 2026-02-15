/**
 * ASGARD CRM — Предварительные заявки
 * Шаг 10: CRUD + accept/reject + AI-анализ + статистика
 * Prefix: /api/pre-tenders
 */

'use strict';

const db = require('../services/db');
const preTenderService = require('../services/pre-tender-service');
const { sendToUser, sendToRoles, broadcast } = require('./sse');
const path = require('path');
const fs = require('fs');

const ALLOWED_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_TO', 'TO'];

module.exports = async function (fastify) {

  // ═══════════════════════════════════════════════════════════════════
  // 1. GET / — Список заявок
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const { status, ai_color, search, sort = 'created_at', order = 'DESC', limit = 50, offset = 0 } = request.query;

    let where = 'WHERE 1=1';
    const params = [];
    let idx = 1;

    if (status) {
      where += ` AND pt.status = $${idx++}`;
      params.push(status);
    } else {
      // По умолчанию не показываем архивные
      where += ` AND pt.status NOT IN ('expired')`;
    }
    if (ai_color) { where += ` AND pt.ai_color = $${idx++}`; params.push(ai_color); }
    if (search) {
      where += ` AND (pt.customer_name ILIKE $${idx} OR pt.work_description ILIKE $${idx} OR pt.customer_email ILIKE $${idx} OR e.subject ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    const allowedSort = ['created_at', 'ai_color', 'status', 'customer_name', 'estimated_sum', 'work_deadline', 'ai_work_match_score'];
    const sortCol = allowedSort.includes(sort) ? sort : 'created_at';
    const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const countRes = await db.query(`SELECT COUNT(*) as total FROM pre_tender_requests pt LEFT JOIN emails e ON e.id = pt.email_id ${where}`, params);
    const total = parseInt(countRes.rows[0]?.total || 0);

    const dataRes = await db.query(`
      SELECT pt.*,
        e.subject as email_subject,
        e.from_email as email_from,
        e.from_name as email_from_name,
        e.email_date,
        e.has_attachments as email_has_attachments,
        u_dec.name as decision_by_name,
        u_ass.name as assigned_to_name
      FROM pre_tender_requests pt
      LEFT JOIN emails e ON e.id = pt.email_id
      LEFT JOIN users u_dec ON u_dec.id = pt.decision_by
      LEFT JOIN users u_ass ON u_ass.id = pt.assigned_to
      ${where}
      ORDER BY pt.${sortCol} ${sortOrder}
      LIMIT $${idx++} OFFSET $${idx++}
    `, [...params, Math.min(parseInt(limit), 200), parseInt(offset)]);

    return { success: true, items: dataRes.rows, total, limit: parseInt(limit), offset: parseInt(offset) };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2. GET /stats — Статистика
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/stats', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const [statusRes, colorRes, monthRes, avgRes] = await Promise.all([
      db.query(`SELECT status, COUNT(*) as cnt FROM pre_tender_requests GROUP BY status`),
      db.query(`SELECT ai_color, COUNT(*) as cnt FROM pre_tender_requests WHERE status NOT IN ('rejected','expired') GROUP BY ai_color`),
      db.query(`
        SELECT to_char(created_at, 'YYYY-MM') as month,
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'accepted') as accepted,
          COUNT(*) FILTER (WHERE status = 'rejected') as rejected
        FROM pre_tender_requests
        WHERE created_at > NOW() - INTERVAL '6 months'
        GROUP BY to_char(created_at, 'YYYY-MM')
        ORDER BY month DESC
      `),
      db.query(`
        SELECT ROUND(AVG(EXTRACT(EPOCH FROM (decision_at - created_at)) / 3600), 1) as avg_hours
        FROM pre_tender_requests
        WHERE decision_at IS NOT NULL
      `)
    ]);

    const byStatus = {};
    statusRes.rows.forEach(r => byStatus[r.status] = parseInt(r.cnt));
    const byColor = {};
    colorRes.rows.forEach(r => byColor[r.ai_color || 'gray'] = parseInt(r.cnt));

    return {
      success: true,
      total_new: byStatus.new || 0,
      total_in_review: byStatus.in_review || 0,
      total_need_docs: byStatus.need_docs || 0,
      total_accepted: byStatus.accepted || 0,
      total_rejected: byStatus.rejected || 0,
      by_color: byColor,
      by_month: monthRes.rows,
      avg_decision_time_hours: parseFloat(avgRes.rows[0]?.avg_hours || 0)
    };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3. GET /:id — Одна заявка
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/:id', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const { id } = request.params;

    const res = await db.query(`
      SELECT pt.*,
        e.subject as email_subject,
        e.body_text as email_body_text,
        e.body_html as email_body_html,
        e.from_email as email_from,
        e.from_name as email_from_name,
        e.email_date,
        e.email_type,
        e.thread_id,
        u_dec.name as decision_by_name,
        u_ass.name as assigned_to_name
      FROM pre_tender_requests pt
      LEFT JOIN emails e ON e.id = pt.email_id
      LEFT JOIN users u_dec ON u_dec.id = pt.decision_by
      LEFT JOIN users u_ass ON u_ass.id = pt.assigned_to
      WHERE pt.id = $1
    `, [id]);

    if (!res.rows.length) return reply.code(404).send({ error: 'Заявка не найдена' });

    const item = res.rows[0];

    // Получаем вложения
    let attachments = [];
    if (item.email_id) {
      const attRes = await db.query(
        'SELECT id, filename, original_filename, mime_type, size, file_path FROM email_attachments WHERE email_id = $1',
        [item.email_id]
      );
      attachments = attRes.rows;
    }

    // Цепочка писем
    let thread = [];
    if (item.thread_id) {
      const thRes = await db.query(
        'SELECT id, direction, from_email, from_name, subject, snippet, email_date FROM emails WHERE thread_id = $1 ORDER BY email_date',
        [item.thread_id]
      );
      thread = thRes.rows;
    }

    return { success: true, item, attachments, thread };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 4. POST /from-email — Создать из письма
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/from-email', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const { email_id } = request.body;
    if (!email_id) return reply.code(400).send({ error: 'email_id обязателен' });

    // Проверяем письмо
    const emailRes = await db.query('SELECT * FROM emails WHERE id = $1', [email_id]);
    if (!emailRes.rows.length) return reply.code(404).send({ error: 'Письмо не найдено' });

    const email = emailRes.rows[0];
    if (!['direct_request', 'platform_tender'].includes(email.email_type)) {
      return reply.code(400).send({ error: 'Тип письма не подходит: ' + email.email_type });
    }

    const result = await preTenderService.createPreTenderFromEmail(email_id);
    if (!result) return reply.code(500).send({ error: 'Ошибка создания' });
    if (result.exists) return reply.code(409).send({ error: 'Заявка уже создана', id: result.id });

    return { success: true, id: result.id };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 5. POST / — Ручное создание
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const { customer_name, customer_email, customer_inn, contact_person, contact_phone,
            work_description, work_location, work_deadline, estimated_sum } = request.body;
    const user = request.user;

    if (!customer_name && !work_description) {
      return reply.code(400).send({ error: 'Укажите заказчика или описание работ' });
    }

    const ins = await db.query(`
      INSERT INTO pre_tender_requests (
        source_type, customer_name, customer_email, customer_inn,
        contact_person, contact_phone, work_description, work_location,
        work_deadline, estimated_sum, ai_color, status, created_by
      ) VALUES ('manual', $1, $2, $3, $4, $5, $6, $7, $8, $9, 'gray', 'new', $10)
      RETURNING id
    `, [
      customer_name || '', customer_email || '', customer_inn || '',
      contact_person || '', contact_phone || '',
      work_description || '', work_location || '',
      work_deadline || null, estimated_sum || null,
      user.id
    ]);

    const newId = ins.rows[0].id;

    // SSE: уведомляем о новой заявке
    broadcast('pre_tender:new', {
      id: newId, customer_name: customer_name || '', ai_color: 'gray',
      status: 'new', source_type: 'manual', created_by: user.id
    });

    return { success: true, id: newId };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 6. PUT /:id — Обновить
  // ═══════════════════════════════════════════════════════════════════
  fastify.put('/:id', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const { id } = request.params;
    const allowed = ['customer_name', 'customer_inn', 'customer_email', 'contact_person',
                     'contact_phone', 'work_description', 'work_location', 'work_deadline',
                     'estimated_sum', 'assigned_to', 'ai_color'];

    // Статус можно менять только на допустимые значения (для канбан drag-and-drop)
    if (request.body.status && ['new', 'in_review', 'need_docs'].includes(request.body.status)) {
      allowed.push('status');
    }

    const fields = [];
    const vals = [];
    let idx = 1;

    for (const key of allowed) {
      if (request.body[key] !== undefined) {
        fields.push(`${key} = $${idx++}`);
        vals.push(request.body[key]);
      }
    }

    if (!fields.length) return reply.code(400).send({ error: 'Нет полей для обновления' });

    fields.push(`updated_at = NOW()`);
    vals.push(id);

    await db.query(
      `UPDATE pre_tender_requests SET ${fields.join(', ')} WHERE id = $${idx} AND status IN ('new','in_review','need_docs')`,
      vals
    );

    // SSE: уведомляем об обновлении заявки
    broadcast('pre_tender:updated', { id: parseInt(id), updated_fields: Object.keys(request.body) });

    return { success: true };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 7. POST /:id/request-docs — Запрос документов
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/:id/request-docs', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const { id } = request.params;
    const { comment } = request.body || {};

    await db.query(`
      UPDATE pre_tender_requests SET status = 'need_docs', decision_comment = $1, updated_at = NOW()
      WHERE id = $2 AND status IN ('new','in_review')
    `, [comment || 'Запрошены дополнительные документы', id]);

    return { success: true };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 7.5 POST /:id/upload-docs — Загрузка документов
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/:id/upload-docs', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const { id } = request.params;

    // Проверяем заявку
    const ptRes = await db.query('SELECT id, manual_documents FROM pre_tender_requests WHERE id = $1', [id]);
    if (!ptRes.rows.length) return reply.code(404).send({ error: 'Заявка не найдена' });

    const parts = request.parts();
    const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'pre_tenders', String(id));
    fs.mkdirSync(uploadDir, { recursive: true });

    const existingDocs = ptRes.rows[0].manual_documents || [];
    const uploaded = [];

    for await (const part of parts) {
      if (part.type !== 'file') continue;
      const safeName = (part.filename || 'file').replace(/[^\w.\-а-яА-ЯёЁ ]/gi, '_').slice(0, 200);
      const filePath = path.join(uploadDir, safeName);
      const chunks = [];
      for await (const chunk of part.file) chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      fs.writeFileSync(filePath, buf);

      const doc = {
        filename: safeName,
        original_name: part.filename || safeName,
        mime_type: part.mimetype || 'application/octet-stream',
        size: buf.length,
        path: `uploads/pre_tenders/${id}/${safeName}`,
        uploaded_at: new Date().toISOString()
      };
      existingDocs.push(doc);
      uploaded.push(doc);
    }

    if (!uploaded.length) return reply.code(400).send({ error: 'Файлы не загружены' });

    await db.query(
      'UPDATE pre_tender_requests SET manual_documents = $1, has_documents = true, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(existingDocs), id]
    );

    return { success: true, uploaded, total_docs: existingDocs.length };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 8. POST /:id/analyze — AI-анализ
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/:id/analyze', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const { id } = request.params;

    try {
      const result = await preTenderService.analyzePreTender(parseInt(id));
      return { success: true, analysis: result };
    } catch (err) {
      return reply.code(500).send({ error: 'AI-анализ не удался: ' + err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 9. POST /:id/accept — ПРИНЯТЬ ЗАЯВКУ
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/:id/accept', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const { id } = request.params;
    const { comment, contact_person, contact_phone, assigned_pm_id, send_email = true } = request.body || {};
    const user = request.user;

    // Получаем заявку (без JOIN с emails — для ручных заявок emails не нужны)
    const ptRes = await db.query('SELECT * FROM pre_tender_requests WHERE id = $1', [id]);

    if (!ptRes.rows.length) return reply.code(404).send({ error: 'Заявка не найдена' });
    const pt = ptRes.rows[0];

    if (!['new', 'in_review', 'need_docs'].includes(pt.status)) {
      return reply.code(400).send({ error: 'Заявка уже обработана (статус: ' + pt.status + ')' });
    }

    // Подгружаем данные письма, только если есть email_id
    let emailData = {};
    if (pt.email_id) {
      try {
        const emailRes = await db.query(
          'SELECT subject as email_subject, from_email, from_name, email_type, id as eid FROM emails WHERE id = $1',
          [pt.email_id]
        );
        if (emailRes.rows.length) emailData = emailRes.rows[0];
      } catch (emailFetchErr) {
        console.error('[PreTender] Accept: email fetch error:', emailFetchErr.message);
      }
    }

    // 1. Создать тендер
    const period = new Date().toISOString().slice(0, 7);
    const tenderType = pt.source_type === 'email' && emailData.email_type === 'platform_tender' ? 'Тендер' : 'Прямой запрос';
    const commentTo = `Создано из заявки #${id}. ${pt.ai_recommendation || ''} ${comment || ''}`.trim().slice(0, 500);

    // Авто-создание записи в customers если указан ИНН (для FK tenders_customer_inn_fkey)
    if (pt.customer_inn) {
      try {
        await db.query(
          `INSERT INTO customers (inn, name) VALUES ($1, $2) ON CONFLICT (inn) DO NOTHING`,
          [pt.customer_inn, pt.customer_name || 'Не указан']
        );
      } catch (_) { /* customers table might not have this constraint */ }
    }

    let tenderId;
    try {
      const tenderRes = await db.query(`
        INSERT INTO tenders (
          customer_name, customer_inn, tender_type, tender_status,
          tender_price, docs_deadline, responsible_pm_id,
          comment_to, period, created_by, created_at
        ) VALUES ($1, $2, $3, 'Новый', $4, $5, $6, $7, $8, $9, NOW())
        RETURNING id
      `, [
        pt.customer_name || emailData.from_name || 'Не указан',
        pt.customer_inn || null,
        tenderType,
        pt.estimated_sum || null,
        pt.work_deadline || null,
        assigned_pm_id || null,
        commentTo,
        period,
        user.id
      ]);
      tenderId = tenderRes.rows[0].id;
    } catch (tenderErr) {
      console.error('[PreTender] Accept: tender INSERT error:', tenderErr.message, tenderErr.code);
      return reply.code(400).send({ error: 'Ошибка создания тендера: ' + (tenderErr.message || 'неизвестная ошибка') });
    }

    // 2. Обновить заявку
    let responseEmailId = null;

    try {
      await db.query(`
        UPDATE pre_tender_requests SET
          status = 'accepted',
          decision_by = $1, decision_at = NOW(), decision_comment = $2,
          created_tender_id = $3,
          contact_person = COALESCE(NULLIF($4, ''), contact_person),
          contact_phone = COALESCE(NULLIF($5, ''), contact_phone),
          assigned_to = $6,
          updated_at = NOW()
        WHERE id = $7
      `, [user.id, comment || null, tenderId, contact_person || '', contact_phone || '', assigned_pm_id || null, id]);
    } catch (updateErr) {
      console.error('[PreTender] Accept: UPDATE error:', updateErr.message, updateErr.code);
      // Tender was created, return success with warning
    }

    // 3. Отправить письмо через /api/mailbox/send
    if (send_email && pt.customer_email) {
      try {
        // Получаем шаблон tender_accept
        const tplRes = await db.query(
          "SELECT * FROM email_templates_v2 WHERE code = 'tender_accept' AND is_active = true LIMIT 1"
        );

        if (tplRes.rows.length) {
          const tpl = tplRes.rows[0];
          const letterhead = require('../services/email-letterhead');

          const subject = letterhead.fillTemplate(tpl.subject_template, {
            original_subject: emailData.email_subject || pt.work_description?.slice(0, 50) || 'заявка'
          });
          const bodyHtml = letterhead.fillTemplate(tpl.body_template, {
            contact_person: contact_person || 'менеджер',
            contact_phone: contact_phone || ''
          });
          const finalHtml = tpl.use_letterhead ? letterhead.wrapInLetterhead(bodyHtml) : bodyHtml;

          // Находим активный аккаунт
          const accRes = await db.query('SELECT id FROM email_accounts WHERE is_active = true AND smtp_host IS NOT NULL LIMIT 1');
          if (accRes.rows.length) {
            const emailIns = await db.query(`
              INSERT INTO emails (
                account_id, direction, to_emails, subject, body_html, body_text,
                email_type, is_read, sent_by_user_id, reply_to_email_id, email_date
              ) VALUES ($1, 'outbound', $2, $3, $4, $5, 'crm_outbound', true, $6, $7, NOW())
              RETURNING id
            `, [
              accRes.rows[0].id,
              JSON.stringify([{ address: pt.customer_email, name: pt.customer_name || '' }]),
              subject,
              finalHtml,
              subject,
              user.id,
              pt.email_id || null
            ]);
            responseEmailId = emailIns.rows[0].id;

            await db.query('UPDATE pre_tender_requests SET response_email_id = $1 WHERE id = $2', [responseEmailId, id]);
          }
        }
      } catch (emailErr) {
        console.error('[PreTender] Accept email error:', emailErr.message);
      }
    }

    // 4. Audit log
    try {
      await db.query(`
        INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, payload_json, created_at)
        VALUES ($1, 'pre_tender', $2, 'accept', $3, NOW())
      `, [user.id, parseInt(id), JSON.stringify({ tender_id: tenderId, comment })]);
    } catch (_) {}

    // 5. Уведомление назначенному РП
    if (assigned_pm_id) {
      try {
        await db.query(`
          INSERT INTO notifications (user_id, title, message, type, link, entity_id, created_at)
          VALUES ($1, $2, $3, 'info', $4, $5, NOW())
        `, [
          assigned_pm_id,
          'Новый тендер назначен',
          `Вам назначен тендер от ${pt.customer_name || 'заказчика'}`,
          `/tenders/${tenderId}`,
          tenderId
        ]);
      } catch (_) {}
    }

    // SSE: уведомляем о принятии заявки
    broadcast('pre_tender:accepted', {
      id: parseInt(id), tender_id: tenderId,
      customer_name: pt.customer_name || emailData.from_name || '',
      accepted_by: user.id
    });

    // SSE: уведомляем назначенного РП
    if (assigned_pm_id) {
      sendToUser(assigned_pm_id, 'tender:new_assignment', {
        tender_id: tenderId, customer_name: pt.customer_name || '',
        pre_tender_id: parseInt(id)
      });
    }

    return { success: true, tender_id: tenderId, response_email_id: responseEmailId };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 10. POST /:id/reject — ОТКЛОНИТЬ ЗАЯВКУ
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/:id/reject', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const { id } = request.params;
    const { reject_reason, send_email = true } = request.body || {};
    const user = request.user;

    const ptRes = await db.query('SELECT * FROM pre_tender_requests WHERE id = $1', [id]);

    if (!ptRes.rows.length) return reply.code(404).send({ error: 'Заявка не найдена' });
    const pt = ptRes.rows[0];

    if (!['new', 'in_review', 'need_docs'].includes(pt.status)) {
      return reply.code(400).send({ error: 'Заявка уже обработана' });
    }

    // Подгружаем данные письма, только если есть email_id
    let rejectEmailData = {};
    if (pt.email_id) {
      try {
        const emailRes = await db.query(
          'SELECT subject as email_subject, id as eid FROM emails WHERE id = $1',
          [pt.email_id]
        );
        if (emailRes.rows.length) rejectEmailData = emailRes.rows[0];
      } catch (emailFetchErr) {
        console.error('[PreTender] Reject: email fetch error:', emailFetchErr.message);
      }
    }

    // 1. Обновить заявку
    try {
      await db.query(`
        UPDATE pre_tender_requests SET
          status = 'rejected',
          decision_by = $1, decision_at = NOW(),
          reject_reason = $2,
          updated_at = NOW()
        WHERE id = $3
      `, [user.id, reject_reason || 'Не указана', id]);
    } catch (updateErr) {
      console.error('[PreTender] Reject: UPDATE error:', updateErr.message, updateErr.code);
      return reply.code(500).send({ error: 'Ошибка обновления заявки: ' + updateErr.message });
    }

    // 2. Отправить письмо с отказом
    let responseEmailId = null;
    if (send_email && pt.customer_email) {
      try {
        const tplRes = await db.query(
          "SELECT * FROM email_templates_v2 WHERE code = 'tender_reject' AND is_active = true LIMIT 1"
        );

        if (tplRes.rows.length) {
          const tpl = tplRes.rows[0];
          const letterhead = require('../services/email-letterhead');

          const subject = letterhead.fillTemplate(tpl.subject_template, {
            original_subject: rejectEmailData.email_subject || 'заявка'
          });
          const reasonText = reject_reason ? ', в связи с: ' + reject_reason : '';
          const bodyHtml = letterhead.fillTemplate(tpl.body_template, {
            reject_reason: reasonText
          });
          const finalHtml = tpl.use_letterhead ? letterhead.wrapInLetterhead(bodyHtml) : bodyHtml;

          const accRes = await db.query('SELECT id FROM email_accounts WHERE is_active = true AND smtp_host IS NOT NULL LIMIT 1');
          if (accRes.rows.length) {
            const emailIns = await db.query(`
              INSERT INTO emails (
                account_id, direction, to_emails, subject, body_html, body_text,
                email_type, is_read, sent_by_user_id, reply_to_email_id, email_date
              ) VALUES ($1, 'outbound', $2, $3, $4, $5, 'crm_outbound', true, $6, $7, NOW())
              RETURNING id
            `, [
              accRes.rows[0].id,
              JSON.stringify([{ address: pt.customer_email, name: pt.customer_name || '' }]),
              subject,
              finalHtml,
              subject,
              user.id,
              pt.email_id || null
            ]);
            responseEmailId = emailIns.rows[0].id;
            await db.query('UPDATE pre_tender_requests SET response_email_id = $1 WHERE id = $2', [responseEmailId, id]);
          }
        }
      } catch (emailErr) {
        console.error('[PreTender] Reject email error:', emailErr.message);
      }
    }

    // 3. Архивировать письмо
    if (pt.email_id) {
      try {
        await db.query('UPDATE emails SET is_archived = true WHERE id = $1', [pt.email_id]);
      } catch (_) {}
    }

    // 4. Audit log
    try {
      await db.query(`
        INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, payload_json, created_at)
        VALUES ($1, 'pre_tender', $2, 'reject', $3, NOW())
      `, [user.id, parseInt(id), JSON.stringify({ reject_reason })]);
    } catch (_) {}

    // SSE: уведомляем об отклонении
    broadcast('pre_tender:rejected', {
      id: parseInt(id), customer_name: pt.customer_name || '',
      rejected_by: user.id
    });

    return { success: true, response_email_id: responseEmailId };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 11. POST /:id/fast-track — БЫСТРЫЙ ПУТЬ (сразу на просчёт)
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/:id/fast-track', {
    preHandler: [fastify.requireRoles(['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'])]
  }, async (request, reply) => {
    const { id } = request.params;
    const { pm_id, contact_person, contact_phone, comment, send_email = true } = request.body || {};
    const user = request.user;

    // Валидация: pm_id обязателен
    if (!pm_id) {
      return reply.code(400).send({ error: 'Необходимо указать РП (pm_id)' });
    }

    // Проверяем что РП существует и имеет нужную роль
    const pmRes = await db.query(
      "SELECT id, name, role FROM users WHERE id = $1 AND is_active = true AND role IN ('PM','HEAD_PM','ADMIN')",
      [pm_id]
    );
    if (!pmRes.rows.length) {
      return reply.code(400).send({ error: 'Указанный пользователь не найден или не является РП' });
    }
    const pm = pmRes.rows[0];

    // Получаем заявку (без JOIN с emails)
    const ptRes = await db.query('SELECT * FROM pre_tender_requests WHERE id = $1', [id]);

    if (!ptRes.rows.length) return reply.code(404).send({ error: 'Заявка не найдена' });
    const pt = ptRes.rows[0];

    if (!['new', 'in_review', 'need_docs'].includes(pt.status)) {
      return reply.code(400).send({ error: 'Заявка уже обработана (статус: ' + pt.status + ')' });
    }

    // Подгружаем данные письма, только если есть email_id
    let ftEmailData = {};
    if (pt.email_id) {
      try {
        const emailRes = await db.query(
          'SELECT subject as email_subject, from_email, from_name, email_type, id as eid FROM emails WHERE id = $1',
          [pt.email_id]
        );
        if (emailRes.rows.length) ftEmailData = emailRes.rows[0];
      } catch (emailFetchErr) {
        console.error('[PreTender] Fast-track: email fetch error:', emailFetchErr.message);
      }
    }

    const period = new Date().toISOString().slice(0, 7);
    const tenderType = pt.source_type === 'email' && ftEmailData.email_type === 'platform_tender' ? 'Тендер' : 'Прямой запрос';
    const aiComment = pt.ai_recommendation ? `AI: ${pt.ai_recommendation}` : '';
    const fullComment = [
      `Быстрый путь из заявки #${id}`,
      comment || '',
      aiComment
    ].filter(Boolean).join('. ').slice(0, 500);

    // Авто-создание записи в customers если указан ИНН (для FK tenders_customer_inn_fkey)
    if (pt.customer_inn) {
      try {
        await db.query(
          `INSERT INTO customers (inn, name) VALUES ($1, $2) ON CONFLICT (inn) DO NOTHING`,
          [pt.customer_inn, pt.customer_name || 'Не указан']
        );
      } catch (_) { /* customers table might not have this constraint */ }
    }

    // Транзакция: создаём тендер + обновляем заявку + уведомление + audit
    let tenderId;
    try {
      tenderId = await db.transaction(async (client) => {
        // 1. Создаём тендер со статусом "Отправлено на просчёт"
        const tenderRes = await client.query(`
          INSERT INTO tenders (
            customer_name, customer_inn, tender_type, tender_status,
            tender_price, docs_deadline, responsible_pm_id,
            comment_to, period, created_by, created_at, handoff_at
          ) VALUES ($1, $2, $3, 'Отправлено на просчёт', $4, $5, $6, $7, $8, $9, NOW(), NOW())
          RETURNING id
        `, [
          pt.customer_name || ftEmailData.from_name || 'Не указан',
          pt.customer_inn || null,
          tenderType,
          pt.estimated_sum || null,
          pt.work_deadline || null,
          pm_id,
          fullComment,
          period,
          user.id
        ]);
        const tId = tenderRes.rows[0].id;

        // 2. Обновляем заявку → accepted
        await client.query(`
          UPDATE pre_tender_requests SET
            status = 'accepted',
            decision_by = $1, decision_at = NOW(), decision_comment = $2,
            created_tender_id = $3,
            contact_person = COALESCE(NULLIF($4, ''), contact_person),
            contact_phone = COALESCE(NULLIF($5, ''), contact_phone),
            assigned_to = $6,
            updated_at = NOW()
          WHERE id = $7
        `, [user.id, 'Быстрый путь: сразу на просчёт', tId, contact_person || '', contact_phone || '', pm_id, id]);

        // 3. Уведомление РП
        await client.query(`
          INSERT INTO notifications (user_id, title, message, type, link, entity_id, created_at)
          VALUES ($1, $2, $3, 'estimation_request', $4, $5, NOW())
        `, [
          pm_id,
          'Новый тендер на просчёт',
          `Вам назначен тендер от ${pt.customer_name || 'заказчика'}. ${comment || ''}`.trim(),
          `/tenders/${tId}`,
          tId
        ]);

        // 4. Audit log
        await client.query(`
          INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, payload_json, created_at)
          VALUES ($1, 'pre_tender', $2, 'fast_track', $3, NOW())
        `, [user.id, parseInt(id), JSON.stringify({ tender_id: tId, pm_id, comment })]);

        return tId;
      });
    } catch (txErr) {
      console.error('[PreTender] Fast-track transaction error:', txErr.message);
      return reply.code(500).send({ error: 'Ошибка создания тендера: ' + txErr.message });
    }

    // 5. Отправить email заказчику (вне транзакции)
    let responseEmailId = null;
    if (send_email && pt.customer_email) {
      try {
        const tplRes = await db.query(
          "SELECT * FROM email_templates_v2 WHERE code = 'tender_accept' AND is_active = true LIMIT 1"
        );
        if (tplRes.rows.length) {
          const tpl = tplRes.rows[0];
          const letterhead = require('../services/email-letterhead');

          const subject = letterhead.fillTemplate(tpl.subject_template, {
            original_subject: ftEmailData.email_subject || pt.work_description?.slice(0, 50) || 'заявка'
          });
          const bodyHtml = letterhead.fillTemplate(tpl.body_template, {
            contact_person: pm.name || contact_person || 'менеджер',
            contact_phone: contact_phone || ''
          });
          const finalHtml = tpl.use_letterhead ? letterhead.wrapInLetterhead(bodyHtml) : bodyHtml;

          const accRes = await db.query('SELECT id FROM email_accounts WHERE is_active = true AND smtp_host IS NOT NULL LIMIT 1');
          if (accRes.rows.length) {
            const emailIns = await db.query(`
              INSERT INTO emails (
                account_id, direction, to_emails, subject, body_html, body_text,
                email_type, is_read, sent_by_user_id, reply_to_email_id, email_date
              ) VALUES ($1, 'outbound', $2, $3, $4, $5, 'crm_outbound', true, $6, $7, NOW())
              RETURNING id
            `, [
              accRes.rows[0].id,
              JSON.stringify([{ address: pt.customer_email, name: pt.customer_name || '' }]),
              subject, finalHtml, subject, user.id, pt.email_id || null
            ]);
            responseEmailId = emailIns.rows[0].id;
            await db.query('UPDATE pre_tender_requests SET response_email_id = $1 WHERE id = $2', [responseEmailId, id]);
          }
        }
      } catch (emailErr) {
        console.error('[PreTender] Fast-track email error:', emailErr.message);
      }
    }

    // 6. SSE: уведомляем всех о fast-track
    broadcast('pre_tender:accepted', {
      id: parseInt(id), tender_id: tenderId,
      customer_name: pt.customer_name || '', fast_track: true,
      accepted_by: user.id
    });

    // SSE: уведомляем РП о новом тендере на просчёт
    sendToUser(pm_id, 'tender:new_estimation', {
      tender_id: tenderId, customer_name: pt.customer_name || '',
      pre_tender_id: parseInt(id), comment: comment || ''
    });

    return {
      success: true,
      tender_id: tenderId,
      tender_status: 'Отправлено на просчёт',
      assigned_pm: pm.name,
      response_email_id: responseEmailId
    };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 12. DELETE /:id — Удалить
  // ═══════════════════════════════════════════════════════════════════
  fastify.delete('/:id', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const { id } = request.params;
    // Удаляем заявку (обратной ссылки pre_tender_id нет в emails)
    await db.query('DELETE FROM pre_tender_requests WHERE id = $1', [id]);
    return { success: true };
  });

};
