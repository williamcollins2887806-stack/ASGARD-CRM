/**
 * ASGARD CRM — Входящие заявки (AI-анализ)
 * Фаза 9: routes/inbox_applications_ai.js
 *
 * Эндпоинты:
 *  GET    /                 — список заявок (фильтры, пагинация)
 *  GET    /:id              — одна заявка
 *  POST   /from-email       — создать заявку из письма
 *  POST   /:id/analyze      — запустить/перезапустить AI-анализ
 *  PUT    /:id              — обновить заявку
 *  POST   /:id/accept       — принять (создать тендер, отправить письмо)
 *  POST   /:id/reject       — отклонить (отправить письмо, архивировать)
 *  POST   /:id/review       — взять на рассмотрение
 *  POST   /:id/archive      — архивировать
 *  DELETE /:id              — удалить
 *  GET    /stats/summary    — статистика
 */

'use strict';

const db = require('../services/db');
const aiAnalyzer = require('../services/ai-email-analyzer');

module.exports = async function (fastify) {

  // ═══════════════════════════════════════════════════════════════════
  // 1. GET / — Список заявок
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { status, color, classification, search, limit = 50, offset = 0, sort = 'created_at', order = 'DESC' } = request.query;

    let where = 'WHERE 1=1';
    const params = [];
    let idx = 1;

    if (status) { where += ` AND ia.status = $${idx++}`; params.push(status); }
    if (color) { where += ` AND ia.ai_color = $${idx++}`; params.push(color); }
    if (classification) { where += ` AND ia.ai_classification = $${idx++}`; params.push(classification); }
    if (search) {
      where += ` AND (ia.subject ILIKE $${idx} OR ia.source_email ILIKE $${idx} OR ia.source_name ILIKE $${idx} OR ia.ai_summary ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    const allowedSort = ['created_at', 'ai_color', 'status', 'subject', 'ai_confidence'];
    const sortCol = allowedSort.includes(sort) ? sort : 'created_at';
    const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const countRes = await db.query(`SELECT COUNT(*) as total FROM inbox_applications ia ${where}`, params);
    const total = parseInt(countRes.rows[0]?.total || 0);

    const dataRes = await db.query(`
      SELECT ia.*,
        u_dec.name as decision_by_name,
        e.body_text as email_body_text
      FROM inbox_applications ia
      LEFT JOIN users u_dec ON u_dec.id = ia.decision_by
      LEFT JOIN emails e ON e.id = ia.email_id
      ${where}
      ORDER BY ia.${sortCol} ${sortOrder}
      LIMIT $${idx++} OFFSET $${idx++}
    `, [...params, Math.min(parseInt(limit), 200), parseInt(offset)]);

    return { success: true, items: dataRes.rows, total, limit: parseInt(limit), offset: parseInt(offset) };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2. GET /stats/summary — Статистика
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/stats/summary', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const [statusRes, colorRes, classRes, recentRes] = await Promise.all([
      db.query(`SELECT status, COUNT(*) as cnt FROM inbox_applications GROUP BY status`),
      db.query(`SELECT ai_color, COUNT(*) as cnt FROM inbox_applications WHERE status NOT IN ('archived') GROUP BY ai_color`),
      db.query(`SELECT ai_classification, COUNT(*) as cnt FROM inbox_applications WHERE status NOT IN ('archived') GROUP BY ai_classification`),
      db.query(`SELECT COUNT(*) as cnt FROM inbox_applications WHERE created_at > NOW() - INTERVAL '7 days'`)
    ]);

    const byStatus = {};
    statusRes.rows.forEach(r => byStatus[r.status] = parseInt(r.cnt));
    const byColor = {};
    colorRes.rows.forEach(r => byColor[r.ai_color || 'none'] = parseInt(r.cnt));
    const byClass = {};
    classRes.rows.forEach(r => byClass[r.ai_classification || 'unknown'] = parseInt(r.cnt));

    return {
      success: true,
      stats: {
        byStatus,
        byColor,
        byClassification: byClass,
        recentWeek: parseInt(recentRes.rows[0]?.cnt || 0),
        total: Object.values(byStatus).reduce((s, v) => s + v, 0)
      }
    };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3. GET /:id — Одна заявка
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const res = await db.query(`
      SELECT ia.*,
        u_dec.name as decision_by_name,
        u_cr.name as created_by_name,
        e.body_text as email_body_text,
        e.body_html as email_body_html,
        e.from_email as email_from,
        e.from_name as email_from_name
      FROM inbox_applications ia
      LEFT JOIN users u_dec ON u_dec.id = ia.decision_by
      LEFT JOIN users u_cr ON u_cr.id = ia.created_by
      LEFT JOIN emails e ON e.id = ia.email_id
      WHERE ia.id = $1
    `, [id]);

    if (!res.rows.length) return reply.code(404).send({ error: 'Заявка не найдена' });

    // Получаем вложения если есть email_id
    let attachments = [];
    if (res.rows[0].email_id) {
      const attRes = await db.query('SELECT id, filename, original_filename, mime_type, size, file_path FROM email_attachments WHERE email_id = $1', [res.rows[0].email_id]);
      attachments = attRes.rows;
    }

    // Получаем историю AI-анализов
    const logRes = await db.query(
      'SELECT id, analysis_type, model, provider, duration_ms, output_json, error, created_at FROM ai_analysis_log WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at DESC LIMIT 10',
      ['inbox_application', id]
    );

    return {
      success: true,
      item: res.rows[0],
      attachments,
      analysisHistory: logRes.rows
    };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 4. POST /from-email — Создать заявку из письма
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/from-email', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { email_id, auto_analyze = true } = request.body;
    const user = request.user;

    if (!email_id) return reply.code(400).send({ error: 'email_id обязателен' });

    // Проверяем что письмо существует
    const emailRes = await db.query('SELECT * FROM emails WHERE id = $1', [email_id]);
    if (!emailRes.rows.length) return reply.code(404).send({ error: 'Письмо не найдено' });
    const email = emailRes.rows[0];

    // Проверяем что заявка не создана ранее
    const existing = await db.query('SELECT id FROM inbox_applications WHERE email_id = $1', [email_id]);
    if (existing.rows.length) return reply.code(409).send({ error: 'Заявка для этого письма уже создана', application_id: existing.rows[0].id });

    // Считаем вложения
    const attRes = await db.query('SELECT COUNT(*) as cnt FROM email_attachments WHERE email_id = $1', [email_id]);

    // Создаём заявку
    const ins = await db.query(`
      INSERT INTO inbox_applications (
        email_id, source, source_email, source_name, subject, body_preview,
        attachment_count, status, created_by
      ) VALUES ($1, 'email', $2, $3, $4, $5, $6, 'new', $7)
      RETURNING id
    `, [
      email_id,
      email.from_email || '',
      email.from_name || '',
      email.subject || '(без темы)',
      (email.body_text || '').slice(0, 500),
      parseInt(attRes.rows[0]?.cnt || 0),
      user.id
    ]);

    const appId = ins.rows[0].id;

    // Автоматический AI-анализ
    if (auto_analyze) {
      try {
        // Получаем имена вложений
        const attNames = await db.query('SELECT original_filename FROM email_attachments WHERE email_id = $1', [email_id]);
        const attachmentNames = attNames.rows.map(r => r.original_filename);

        const analysis = await aiAnalyzer.analyzeEmail({
          emailId: email_id,
          subject: email.subject,
          bodyText: email.body_text,
          fromEmail: email.from_email,
          fromName: email.from_name,
          attachmentNames
        });

        // Обновляем заявку результатами анализа
        const workload = await aiAnalyzer.getWorkloadData();

        await db.query(`
          UPDATE inbox_applications SET
            ai_classification = $1, ai_color = $2, ai_summary = $3, ai_recommendation = $4,
            ai_work_type = $5, ai_estimated_budget = $6, ai_estimated_days = $7,
            ai_keywords = $8, ai_confidence = $9, ai_raw_json = $10,
            ai_analyzed_at = NOW(), ai_model = $11,
            workload_snapshot = $12,
            status = 'ai_processed',
            updated_at = NOW()
          WHERE id = $13
        `, [
          analysis.classification, analysis.color, analysis.summary, analysis.recommendation,
          analysis.work_type, analysis.estimated_budget, analysis.estimated_days,
          analysis.keywords, analysis.confidence, JSON.stringify(analysis),
          analysis._raw?.model || null,
          JSON.stringify(workload),
          appId
        ]);

        // Логируем
        await db.query(`
          INSERT INTO ai_analysis_log (entity_type, entity_id, analysis_type, model, provider, duration_ms, output_json, created_by)
          VALUES ('inbox_application', $1, 'email_classification', $2, $3, $4, $5, $6)
        `, [appId, analysis._raw?.model, analysis._raw?.provider, analysis._raw?.durationMs, JSON.stringify(analysis), user.id]);

      } catch (aiErr) {
        console.error('[InboxApp] AI analysis error:', aiErr.message);
        // Заявка создана, но AI не сработал — оставляем status='new'
      }
    }

    return { success: true, id: appId };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 5. POST /:id/analyze — Запустить/перезапустить AI-анализ
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/:id/analyze', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user;

    const appRes = await db.query('SELECT * FROM inbox_applications WHERE id = $1', [id]);
    if (!appRes.rows.length) return reply.code(404).send({ error: 'Заявка не найдена' });
    const app = appRes.rows[0];

    // Получаем текст письма
    let subject = app.subject;
    let bodyText = app.body_preview;
    let fromEmail = app.source_email;
    let fromName = app.source_name;
    let attachmentNames = [];

    if (app.email_id) {
      const emailRes = await db.query('SELECT subject, body_text, from_email, from_name FROM emails WHERE id = $1', [app.email_id]);
      if (emailRes.rows.length) {
        const e = emailRes.rows[0];
        subject = e.subject || subject;
        bodyText = e.body_text || bodyText;
        fromEmail = e.from_email || fromEmail;
        fromName = e.from_name || fromName;
      }
      const attRes = await db.query('SELECT original_filename FROM email_attachments WHERE email_id = $1', [app.email_id]);
      attachmentNames = attRes.rows.map(r => r.original_filename);
    }

    const analysis = await aiAnalyzer.analyzeEmail({
      emailId: app.email_id,
      subject, bodyText, fromEmail, fromName, attachmentNames
    });

    const workload = await aiAnalyzer.getWorkloadData();

    await db.query(`
      UPDATE inbox_applications SET
        ai_classification = $1, ai_color = $2, ai_summary = $3, ai_recommendation = $4,
        ai_work_type = $5, ai_estimated_budget = $6, ai_estimated_days = $7,
        ai_keywords = $8, ai_confidence = $9, ai_raw_json = $10,
        ai_analyzed_at = NOW(), ai_model = $11,
        workload_snapshot = $12,
        status = CASE WHEN status = 'new' THEN 'ai_processed' ELSE status END,
        updated_at = NOW()
      WHERE id = $13
    `, [
      analysis.classification, analysis.color, analysis.summary, analysis.recommendation,
      analysis.work_type, analysis.estimated_budget, analysis.estimated_days,
      analysis.keywords, analysis.confidence, JSON.stringify(analysis),
      analysis._raw?.model || null,
      JSON.stringify(workload),
      id
    ]);

    await db.query(`
      INSERT INTO ai_analysis_log (entity_type, entity_id, analysis_type, model, provider, duration_ms, output_json, created_by)
      VALUES ('inbox_application', $1, 'email_classification', $2, $3, $4, $5, $6)
    `, [id, analysis._raw?.model, analysis._raw?.provider, analysis._raw?.durationMs, JSON.stringify(analysis), user.id]);

    return { success: true, analysis };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 6. PUT /:id — Обновить заявку
  // ═══════════════════════════════════════════════════════════════════
  fastify.put('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { decision_notes, ai_color } = request.body;

    const fields = [];
    const vals = [];
    let idx = 1;

    if (decision_notes !== undefined) { fields.push(`decision_notes = $${idx++}`); vals.push(decision_notes); }
    if (ai_color && ['green', 'yellow', 'red'].includes(ai_color)) { fields.push(`ai_color = $${idx++}`); vals.push(ai_color); }

    if (!fields.length) return reply.code(400).send({ error: 'Нет полей для обновления' });

    fields.push(`updated_at = NOW()`);
    vals.push(id);

    await db.query(`UPDATE inbox_applications SET ${fields.join(', ')} WHERE id = $${idx}`, vals);
    return { success: true };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 7. POST /:id/review — Взять на рассмотрение
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/:id/review', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user;

    await db.query(`
      UPDATE inbox_applications SET status = 'under_review', decision_by = $1, updated_at = NOW()
      WHERE id = $2 AND status IN ('new', 'ai_processed')
    `, [user.id, id]);

    return { success: true };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 8. POST /:id/accept — Принять заявку
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/:id/accept', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { notes, create_tender = true, send_email = true } = request.body || {};
    const user = request.user;

    const appRes = await db.query('SELECT * FROM inbox_applications WHERE id = $1', [id]);
    if (!appRes.rows.length) return reply.code(404).send({ error: 'Заявка не найдена' });
    const app = appRes.rows[0];

    let tenderId = null;

    // Создать тендер из заявки
    if (create_tender) {
      const tenderRes = await db.query(`
        INSERT INTO tenders (
          tender_title, customer_name, tender_status, source, source_email,
          work_type, estimated_budget, notes,
          created_by, created_at, updated_at
        ) VALUES ($1, $2, 'Новый', 'inbox_ai', $3, $4, $5, $6, $7, NOW(), NOW())
        RETURNING id
      `, [
        app.subject || 'Заявка из почты #' + id,
        app.source_name || app.source_email || 'Не указан',
        app.source_email || '',
        app.ai_work_type || '',
        app.ai_estimated_budget || 0,
        `Создано из входящей заявки #${id}. ${notes || ''}`.trim(),
        user.id
      ]);
      tenderId = tenderRes.rows[0].id;
    }

    // Обновляем заявку
    await db.query(`
      UPDATE inbox_applications SET
        status = 'accepted',
        decision_by = $1, decision_at = NOW(), decision_notes = $2,
        linked_tender_id = $3,
        updated_at = NOW()
      WHERE id = $4
    `, [user.id, notes || null, tenderId, id]);

    // Отправить ответное письмо
    if (send_email && app.email_id && app.source_email) {
      try {
        // Получаем аккаунт отправки
        const accRes = await db.query('SELECT ea.id FROM email_accounts ea WHERE ea.is_active = true AND ea.smtp_host IS NOT NULL LIMIT 1');
        if (accRes.rows.length) {
          await db.query(`
            INSERT INTO emails (
              account_id, direction, from_email, to_emails, subject,
              body_text, email_type, is_read, sent_by_user_id, reply_to_email_id, email_date
            ) VALUES ($1, 'outbound', $2, $3, $4, $5, 'crm_outbound', true, $6, $7, NOW())
          `, [
            accRes.rows[0].id,
            '', // from_email заполнится из аккаунта
            JSON.stringify([{ address: app.source_email, name: app.source_name || '' }]),
            'Re: ' + (app.subject || ''),
            `Добрый день!\n\nБлагодарим за обращение. Ваша заявка принята в работу.\nНаш специалист свяжется с вами в ближайшее время для уточнения деталей.\n\nС уважением,\nАСГАРД СЕРВИС`,
            user.id,
            app.email_id
          ]);
        }
      } catch (emailErr) {
        console.error('[InboxApp] Accept email error:', emailErr.message);
      }
    }

    return { success: true, tender_id: tenderId };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 9. POST /:id/reject — Отклонить заявку
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/:id/reject', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { reason, send_email = true } = request.body || {};
    const user = request.user;

    const appRes = await db.query('SELECT * FROM inbox_applications WHERE id = $1', [id]);
    if (!appRes.rows.length) return reply.code(404).send({ error: 'Заявка не найдена' });
    const app = appRes.rows[0];

    await db.query(`
      UPDATE inbox_applications SET
        status = 'rejected',
        decision_by = $1, decision_at = NOW(),
        rejection_reason = $2, decision_notes = $3,
        updated_at = NOW()
      WHERE id = $4
    `, [user.id, reason || 'Не указана', reason || null, id]);

    // Отправить вежливый отказ
    if (send_email && app.email_id && app.source_email) {
      try {
        const accRes = await db.query('SELECT ea.id FROM email_accounts ea WHERE ea.is_active = true AND ea.smtp_host IS NOT NULL LIMIT 1');
        if (accRes.rows.length) {
          const rejectText = reason
            ? `Добрый день!\n\nБлагодарим за обращение.\nК сожалению, в настоящее время мы не можем принять данную заявку.\nПричина: ${reason}\n\nС уважением,\nАСГАРД СЕРВИС`
            : `Добрый день!\n\nБлагодарим за обращение.\nК сожалению, данный запрос не соответствует нашему профилю работ.\n\nС уважением,\nАСГАРД СЕРВИС`;

          await db.query(`
            INSERT INTO emails (
              account_id, direction, from_email, to_emails, subject,
              body_text, email_type, is_read, sent_by_user_id, reply_to_email_id, email_date
            ) VALUES ($1, 'outbound', $2, $3, $4, $5, 'crm_outbound', true, $6, $7, NOW())
          `, [
            accRes.rows[0].id,
            '',
            JSON.stringify([{ address: app.source_email, name: app.source_name || '' }]),
            'Re: ' + (app.subject || ''),
            rejectText,
            user.id,
            app.email_id
          ]);
        }
      } catch (emailErr) {
        console.error('[InboxApp] Reject email error:', emailErr.message);
      }
    }

    return { success: true };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 10. POST /:id/archive — Архивировать
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/:id/archive', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    await db.query(`UPDATE inbox_applications SET status = 'archived', updated_at = NOW() WHERE id = $1`, [id]);
    return { success: true };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 11. DELETE /:id — Удалить
  // ═══════════════════════════════════════════════════════════════════
  fastify.delete('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    // Удаляем логи анализов
    await db.query('DELETE FROM ai_analysis_log WHERE entity_type = $1 AND entity_id = $2', ['inbox_application', parseInt(id)]);
    await db.query('DELETE FROM inbox_applications WHERE id = $1', [id]);
    return { success: true };
  });

};
