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

const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../services/db');
const aiAnalyzer = require('../services/ai-email-analyzer');
const correspondenceService = require('../services/correspondence');
const { createNotification } = require('../services/notify');

const uploadDir = process.env.UPLOAD_DIR || './uploads';

module.exports = async function (fastify) {

  // ═══════════════════════════════════════════════════════════════════
  // 1. GET / — Список заявок
  // ═══════════════════════════════════════════════════════════════════
  // 23.06.2026 BUG-FIX (PreTenders D-5): добавлен requireRoles. До фикса любой залогиненный
  // (бригадир, кладовщик, рабочий) дёргал GET /api/inbox-applications/ и видел ВСЕ входящие
  // обращения — нарушение privacy и компрометация коммерческих данных.
  const INBOX_VIEW_ROLES = [
    'ADMIN', 'HR', 'HR_MANAGER',
    'PM', 'HEAD_PM',
    'TO', 'HEAD_TO',
    'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV',
    'OFFICE_MANAGER', 'BUH'
  ];
  fastify.get('/', {
    preHandler: [fastify.authenticate, fastify.requireRoles(INBOX_VIEW_ROLES)]
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
        u_cr.name as created_by_name,
        u_pm.name as assigned_pm_name,
        e.body_text as email_body_text
      FROM inbox_applications ia
      LEFT JOIN users u_dec ON u_dec.id = ia.decision_by
      LEFT JOIN users u_cr ON u_cr.id = ia.created_by
      LEFT JOIN users u_pm  ON u_pm.id  = ia.assigned_pm_id
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
        u_pm.name as assigned_pm_name,
        e.body_text as email_body_text,
        e.body_html as email_body_html,
        e.from_email as email_from,
        e.from_name as email_from_name
      FROM inbox_applications ia
      LEFT JOIN users u_dec ON u_dec.id = ia.decision_by
      LEFT JOIN users u_cr ON u_cr.id = ia.created_by
      LEFT JOIN users u_pm  ON u_pm.id  = ia.assigned_pm_id
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
  // 3a. (Wave A — BUG-10) GET /:appId/attachments/:attId/download
  //     Скачать конкретный attachment из inbox_application.
  //     Auth: Bearer header ИЛИ query ?token=... (для <a target=_blank>).
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/:appId/attachments/:attId/download', {
    preHandler: [
      async (request, reply) => {
        if (!request.headers.authorization && request.query.token) {
          request.headers.authorization = 'Bearer ' + request.query.token;
        }
      },
      fastify.authenticate
    ]
  }, async (request, reply) => {
    const appId = Number(request.params.appId);
    const attId = Number(request.params.attId);
    if (!Number.isFinite(appId) || !Number.isFinite(attId)) {
      return reply.code(400).send({ error: 'Некорректные параметры' });
    }
    // Wave A+ fix MED#4: owner-guard. PM скачивает вложения только своих заявок.
    // SELECT attachment + assigned_pm_id строго в рамках указанной заявки.
    const r = await db.query(`
      SELECT ea.id, ea.filename, ea.original_filename, ea.mime_type, ea.size, ea.file_path,
             ia.assigned_pm_id
      FROM email_attachments ea
      JOIN emails e ON e.id = ea.email_id
      JOIN inbox_applications ia ON ia.email_id = e.id
      WHERE ea.id = $1 AND ia.id = $2 LIMIT 1
    `, [attId, appId]);
    const att = r.rows[0];
    if (!att) return reply.code(404).send({ error: 'Вложение не найдено' });
    // RBAC: директорские роли + назначенный PM. Иначе 403.
    const DIR_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_TO', 'HEAD_PM'];
    if (!DIR_ROLES.includes(request.user.role) && att.assigned_pm_id !== request.user.id) {
      return reply.code(403).send({ error: 'forbidden' });
    }

    // Резолв пути: file_path обычно относительный (uploads/mail/...).
    const fs = require('fs');
    const path = require('path');
    const candidates = [
      att.file_path,
      path.join(process.cwd(), att.file_path),
      path.join(process.cwd(), 'uploads', att.file_path),
      path.join(process.cwd(), 'uploads', 'mail', att.file_path),
    ];
    let absPath = null;
    for (const p of candidates) {
      try { if (fs.existsSync(p) && fs.statSync(p).isFile()) { absPath = p; break; } } catch (_) {}
    }
    if (!absPath) return reply.code(404).send({ error: 'Файл на диске не найден' });

    const buf = fs.readFileSync(absPath);
    const dispName = (att.original_filename || att.filename || 'attachment').replace(/[\r\n"]/g, '_');
    reply
      .header('Content-Type', att.mime_type || 'application/octet-stream')
      .header('Content-Length', buf.length)
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(dispName)}`)
      .send(buf);
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

    // Pre-filter: пропускаем bounce, internal, system emails
    const skipCheck = aiAnalyzer.shouldSkipEmail({
      fromEmail: email.from_email,
      subject: email.subject,
      bodyText: email.body_text
    });
    if (skipCheck.skip) {
      console.log(`[InboxApp] Skipping email #${email_id}: ${skipCheck.reason}`);
      return reply.code(422).send({
        error: 'Письмо не подходит для создания заявки',
        reason: skipCheck.reason,
        message: skipCheck.reason === 'bounce_or_auto_reply'
          ? 'Это автоматический ответ или уведомление о недоставке'
          : skipCheck.reason === 'internal_email'
          ? 'Это внутреннее письмо от сотрудника компании'
          : 'Это системное уведомление'
      });
    }

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
            extracted_customer_name = $13, extracted_customer_inn = $14,
            extracted_customer_contact_email = $15, extracted_customer_contact_person = $16,
            extracted_customer_phone = $17, extracted_customer_address = $18,
            status = 'ai_processed',
            updated_at = NOW()
          WHERE id = $19
        `, [
          (analysis.classification || '').slice(0, 100), (analysis.color || '').slice(0, 50), (analysis.summary || '').slice(0, 2000), (analysis.recommendation || '').slice(0, 2000),
          (analysis.work_type || '').slice(0, 100), analysis.estimated_budget ? String(analysis.estimated_budget).slice(0, 100) : null, analysis.estimated_days ? String(analysis.estimated_days).slice(0, 100) : null,
          analysis.keywords || [], parseFloat(analysis.confidence) || 0, JSON.stringify(analysis),
          (analysis._raw?.model || '').slice(0, 100),
          JSON.stringify(workload),
          // 30.06.2026 bug #3: реквизиты клиента из AI-разбора тела/фото/подписи.
          analysis.extracted_customer_name ? String(analysis.extracted_customer_name).slice(0, 500) : null,
          analysis.extracted_customer_inn || null,
          analysis.extracted_customer_contact_email ? String(analysis.extracted_customer_contact_email).slice(0, 255) : null,
          analysis.extracted_customer_contact_person ? String(analysis.extracted_customer_contact_person).slice(0, 255) : null,
          analysis.extracted_customer_phone ? String(analysis.extracted_customer_phone).slice(0, 100) : null,
          analysis.extracted_customer_address ? String(analysis.extracted_customer_address).slice(0, 500) : null,
          appId
        ]);

        // Логируем
        await db.query(`
          INSERT INTO ai_analysis_log (entity_type, entity_id, analysis_type, model, provider, duration_ms, output_json, created_by)
          VALUES ('inbox_application', $1, 'email_classification', $2, $3, $4, $5, $6)
        `, [appId, (analysis._raw?.model || '').slice(0, 100), (analysis._raw?.provider || '').slice(0, 50), parseInt(analysis._raw?.durationMs) || null, JSON.stringify(analysis), user.id]);

        // Generate AI report
        try {
          const aiReport = await aiAnalyzer.generateReport({
            emailId: email_id, subject: email.subject, bodyText: email.body_text,
            fromEmail: email.from_email, fromName: email.from_name, attachmentNames
          });
          if (aiReport) {
            await db.query('UPDATE inbox_applications SET ai_report = $1 WHERE id = $2', [aiReport, appId]);
          }
        } catch (reportErr) {
          console.error('[InboxApp] AI report generation error:', reportErr.message);
        }

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

    try {
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
          extracted_customer_name = $14, extracted_customer_inn = $15,
          extracted_customer_contact_email = $16, extracted_customer_contact_person = $17,
          extracted_customer_phone = $18, extracted_customer_address = $19,
          status = CASE WHEN status = 'new' THEN 'ai_processed' ELSE status END,
          updated_at = NOW()
        WHERE id = $13
      `, [
        (analysis.classification || '').slice(0, 100),
        (analysis.color || '').slice(0, 50),
        (analysis.summary || '').slice(0, 2000),
        (analysis.recommendation || '').slice(0, 2000),
        (analysis.work_type || '').slice(0, 100),
        analysis.estimated_budget ? String(analysis.estimated_budget).slice(0, 100) : null,
        analysis.estimated_days ? String(analysis.estimated_days).slice(0, 100) : null,
        analysis.keywords || [],
        parseFloat(analysis.confidence) || 0,
        JSON.stringify(analysis),
        (analysis._raw?.model || '').slice(0, 100),
        JSON.stringify(workload),
        id,
        // 30.06.2026 bug #3: реквизиты клиента из AI-разбора (re-analyze).
        analysis.extracted_customer_name ? String(analysis.extracted_customer_name).slice(0, 500) : null,
        analysis.extracted_customer_inn || null,
        analysis.extracted_customer_contact_email ? String(analysis.extracted_customer_contact_email).slice(0, 255) : null,
        analysis.extracted_customer_contact_person ? String(analysis.extracted_customer_contact_person).slice(0, 255) : null,
        analysis.extracted_customer_phone ? String(analysis.extracted_customer_phone).slice(0, 100) : null,
        analysis.extracted_customer_address ? String(analysis.extracted_customer_address).slice(0, 500) : null
      ]);

      await db.query(`
        INSERT INTO ai_analysis_log (entity_type, entity_id, analysis_type, model, provider, duration_ms, output_json, created_by)
        VALUES ('inbox_application', $1, 'email_classification', $2, $3, $4, $5, $6)
      `, [id, (analysis._raw?.model || '').slice(0, 100), (analysis._raw?.provider || '').slice(0, 50), parseInt(analysis._raw?.durationMs) || null, JSON.stringify(analysis), user.id]);

      // Generate AI report (separate call)
      let aiReport = null;
      try {
        aiReport = await aiAnalyzer.generateReport({
          emailId: app.email_id, subject, bodyText, fromEmail, fromName, attachmentNames
        });
        if (aiReport) {
          await db.query('UPDATE inbox_applications SET ai_report = $1 WHERE id = $2', [aiReport, id]);
        }
      } catch (reportErr) {
        console.error('[InboxApp] AI report generation error:', reportErr.message);
      }

      return { success: true, analysis, ai_report: aiReport };
    } catch (err) {
      console.error(`[InboxApp] Analyze error for application #${id}:`, err.message, err.stack);
      return reply.code(500).send({
        error: 'Ошибка анализа заявки',
        message: err.message,
        detail: err.detail || null
      });
    }
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

    // Если AI создал — при первом редактировании назначаем реального сотрудника
    const user = request.user;
    fields.push(`created_by = COALESCE(created_by, $${idx++})`);
    vals.push(user.id);

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
      UPDATE inbox_applications SET
        status = 'under_review',
        decision_by = $1,
        created_by = COALESCE(created_by, $1),
        updated_at = NOW()
      WHERE id = $2 AND status IN ('new', 'ai_processed')
    `, [user.id, id]);

    return { success: true };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 7a. (Wave B) POST /:id/to-pre-tender
  //     PM/HEAD_PM/директор «Завести просчёт»: создаём pre_tender_request
  //     с правильными данными из inbox_application (учитывая forward-detect
  //     original_sender вместо переслателя), конвертим карту канбана
  //     entity_kind='inbox_application' → 'pre_tender', flow='pre_tender',
  //     main_status='new'.
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/:id/to-pre-tender', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const appId = Number(request.params.id);
    if (!Number.isFinite(appId)) return reply.code(400).send({ error: 'invalid_id' });
    const user = request.user;
    const { note } = request.body || {};
    const personalKanban = require('./personal-kanban'); // Wave D BUG-7

    // Wave A+ fix BLOCKER#NEW: db.connect не существует, надо db.pool.connect.
    // db.js экспортирует { pool, query, transaction, ... } — connect только у pool.
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock + fetch inbox_application
      // extracted_customer_* — структурированные реквизиты клиента из карточки/подписи
      // (название компании, ИНН, контакты). Используем их как приоритет в customer_name,
      // иначе клиент будет «karina@eurochem.ru» вместо «АО НАК Азот».
      const appRes = await client.query(
        `SELECT id, email_id, subject, body_preview, source_kind, source_email, source_name,
                forwarded_from_email, original_sender_email, original_sender_name,
                extracted_customer_name, extracted_customer_inn,
                extracted_customer_contact_email, extracted_customer_contact_person,
                extracted_customer_phone, extracted_customer_address,
                ai_summary, ai_color, ai_classification, ai_recommendation,
                ai_estimated_budget, ai_keywords, ai_raw_json,
                assigned_pm_id, status, attachment_count
         FROM inbox_applications WHERE id = $1 FOR UPDATE`,
        [appId]);
      const app = appRes.rows[0];
      if (!app) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'application_not_found' }); }

      // RBAC: директор / HEAD_PM / TO / HEAD_TO / любой PM.
      // Любой PM может взять корпоративный форвард (например Путков Дима пересылает —
      // он PM, но не assigned). До этого исправления здесь проверяли только assigned_pm_id,
      // и переотправитель ловил 403.
      const isDirector = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_PM'].includes(user.role);
      const isTenderOffice = ['TO', 'HEAD_TO'].includes(user.role);
      const isAnyPM = user.role === 'PM';
      if (!isDirector && !isTenderOffice && !isAnyPM) {
        await client.query('ROLLBACK');
        return reply.code(403).send({ error: 'forbidden' });
      }

      // 2. Проверка дубля pre_tender по email_id
      if (app.email_id) {
        const dup = await client.query(`SELECT id FROM pre_tender_requests WHERE email_id = $1 LIMIT 1`, [app.email_id]);
        if (dup.rows[0]) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'pre_tender_exists', pre_tender_id: dup.rows[0].id });
        }
      }

      // 3. Правильное определение customer:
      // - corporate_forward → original_sender (реальный клиент из тела)
      // - иначе → source_email/name (прямой отправитель)
      // Если AI вытащил полную карточку (extracted_customer_*) — название
      // компании предпочтительнее ФИО/email контактного лица.
      // 30.06.2026 FIX: НИКОГДА не подставлять форвардера/внутреннего сотрудника
      // как заказчика. У пересланных писем source_name/source_email — это наш
      // получатель (напр. Мохарин), а не клиент (ООО «СВС-Н»).
      const INTERNAL_DOMAINS = ['asgard-service.com', 'asgard-crm.ru', 'asgard-service.ru'];
      const isInternalEmail = (e) => {
        if (!e) return false;
        const at = String(e).toLowerCase().split('@')[1] || '';
        return INTERNAL_DOMAINS.some(d => at === d || at.endsWith('.' + d));
      };
      const isForward = app.source_kind === 'corporate_forward';

      // original_sender = реальный клиент, но только если он НЕ внутренний домен.
      const extSenderName  = isInternalEmail(app.original_sender_email) ? null : app.original_sender_name;
      const extSenderEmail = isInternalEmail(app.original_sender_email) ? null : app.original_sender_email;

      // original_sender_company AI кладёт только в ai_raw_json (отдельной колонки нет).
      // Для пересланных корпоративных писем это часто единственное название клиента.
      let origCompany = null;
      try {
        const raw = typeof app.ai_raw_json === 'string' ? JSON.parse(app.ai_raw_json) : (app.ai_raw_json || null);
        origCompany = raw && raw.original_sender_company ? String(raw.original_sender_company).trim() : null;
      } catch (_) { /* битый json — игнор */ }

      // Имя заказчика: extracted (из карточки/фото) → company из подписи (AI) →
      // внешний original_sender → (для НЕ-форварда) source_name.
      // Для форварда source_name НЕ используем — это наш сотрудник.
      let customerName = app.extracted_customer_name
        || origCompany
        || extSenderName
        || (isForward ? '' : (app.source_name || ''));
      // Email заказчика: extracted contact → внешний original_sender →
      // (для НЕ-форварда и НЕ внутреннего) source_email.
      let customerEmail = app.extracted_customer_contact_email
        || extSenderEmail
        || (isForward || isInternalEmail(app.source_email) ? '' : (app.source_email || ''));
      let customerInn = app.extracted_customer_inn || null;
      let contactPerson = app.extracted_customer_contact_person || null;
      const contactPhone = app.extracted_customer_phone || null;

      // 30.06.2026 bug #3: если название заказчика так и не определилось
      // (нет в документах/подписи/original_sender), но есть ИНН или внешняя
      // корпоративная почта — добиваем официальное название через Dadata.
      // Корпоративный ящик почти всегда несёт домен организации (kordiant.ru),
      // по нему suggest/party находит компанию. Не валит транзакцию: при любой
      // ошибке/таймауте/отсутствии токена вернётся null и оставим как было.
      if (!customerName) {
        try {
          const dadata = require('../services/dadata');
          const hit = await dadata.resolveCustomer({
            inn: customerInn,
            email: customerEmail,
            hint: origCompany
          });
          if (hit && hit.name) {
            customerName = hit.name;
            if (!customerInn && hit.inn) customerInn = hit.inn;
            request.log.info({ app_id: appId, resolved: hit.name, inn: hit.inn }, '[to-pre-tender] customer resolved via Dadata');
          }
        } catch (ddErr) {
          request.log.warn({ err: ddErr, app_id: appId }, '[to-pre-tender] Dadata resolve failed');
        }
      }

      // work_description: AI summary + первые 1500 chars body_preview
      const workDescription = [
        app.ai_summary || '',
        '',
        (app.body_preview || '').slice(0, 1500)
      ].filter(Boolean).join('\n');

      // 4. INSERT pre_tender_request
      const ptIns = await client.query(`
        INSERT INTO pre_tender_requests
          (email_id, source_type,
           customer_name, customer_email, customer_inn,
           contact_person, contact_phone,
           work_description,
           estimated_sum,
           ai_summary, ai_color, ai_recommendation,
           has_documents,
           status, assigned_to, created_by)
        VALUES ($1, 'email',
                $2, $3, $4,
                $5, $6,
                $7,
                $8,
                $9, $10, $11,
                $12,
                'new', $13, $14)
        RETURNING id, status, customer_name, customer_inn`,
        [
          app.email_id || null,
          customerName.slice(0, 255),
          customerEmail.slice(0, 255),
          customerInn,
          contactPerson,
          contactPhone,
          workDescription,
          app.ai_estimated_budget || null,
          app.ai_summary || null,
          app.ai_color || 'yellow',
          app.ai_recommendation || null,
          (app.attachment_count || 0) > 0,
          app.assigned_pm_id || null,
          user.id,
        ]);
      const preTenderId = ptIns.rows[0].id;

      // 5. Обратная ссылка email.pre_tender_id (как делает старый сервис)
      if (app.email_id) {
        try { await client.query(`UPDATE emails SET pre_tender_id = $1 WHERE id = $2`, [preTenderId, app.email_id]); }
        catch (_) { /* поле может отсутствовать на старых схемах */ }
      }

      // 6. UPDATE inbox_application.status='accepted' (промежуточный шаг к workflow)
      await client.query(
        `UPDATE inbox_applications SET status='accepted', decision_by=$1, decision_at=now(), decision_notes=$2, updated_at=now()
         WHERE id=$3`,
        [user.id, `Конвертирована в pre_tender_request #${preTenderId}` + (note ? '. ' + note : ''), appId]);

      // 7. Конвертим карту канбана (если есть)
      let kanbanCardId = null;
      const cardRes = await client.query(
        `SELECT id, owner_user_id, current_main_status, current_substage_id, version
         FROM personal_kanban_cards
         WHERE entity_kind='inbox_application' AND entity_id=$1 AND is_closed=false
         ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [appId]);
      const card = cardRes.rows[0];
      if (card) {
        kanbanCardId = card.id;
        // Wave D BUG-7: ensureDefaultSubstages создаст набор если у PM 0 подэтапов
        // для (pre_tender, 'new') — карта попадает в реальный substage, не в «Не размещено».
        const newSubstageId = await personalKanban.ensureDefaultSubstages(client, card.owner_user_id, 'pre_tender', 'new');

        await client.query(
          `UPDATE personal_kanban_cards
           SET entity_kind='pre_tender', entity_id=$1, flow_type='pre_tender',
               current_main_status='new', current_substage_id=$2,
               last_moved_at=now(), version=version+1, updated_at=now()
           WHERE id=$3`,
          [preTenderId, newSubstageId, card.id]);

        await client.query(
          `INSERT INTO personal_kanban_card_history
            (card_id, from_substage_id, to_substage_id, from_main_status, to_main_status, moved_by, action, note)
           VALUES ($1, $2, $3, $4, 'new', $5, 'convert', $6)`,
          [card.id, card.current_substage_id, newSubstageId, card.current_main_status, user.id,
           `inbox_application #${appId} → pre_tender_request #${preTenderId}` + (note ? '. ' + note : '')]);
      }

      await client.query('COMMIT');

      // 8. SSE + notification ПОСЛЕ commit
      try {
        const sse = require('../services/sse');
        sse.broadcast?.('personal_kanban:card_converted', {
          card_id: kanbanCardId, owner_user_id: app.assigned_pm_id,
          flow_type: 'pre_tender', entity_kind: 'pre_tender', entity_id: preTenderId,
          from_entity_kind: 'inbox_application', from_entity_id: appId,
        });
      } catch (_) {}

      if (app.assigned_pm_id && kanbanCardId) {
        try {
          const { createNotification } = require('../services/notify');
          Promise.resolve(createNotification(db, {
            user_id: app.assigned_pm_id,
            title: `Заявка №${appId} → Pre-tender #${preTenderId}`,
            message: `Конвертирована в просчёт: ${customerName || 'клиент не указан'}`,
            type: 'pre_tender_created',
            link: `#/personal-kanban?card=${kanbanCardId}`,
          })).catch(() => {});
        } catch (_) {}
      }

      return reply.send({
        success: true,
        application_id: appId,
        pre_tender_id: preTenderId,
        kanban_card_id: kanbanCardId,
        customer_name: ptIns.rows[0].customer_name,
      });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      request.log.error({ err: e }, '[inbox-app/to-pre-tender] failed');
      return reply.code(500).send({ error: 'internal', message: e.message });
    } finally {
      client.release();
    }
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

    // Проверяем что заявка ещё не обработана
    if (app.status === 'accepted' && app.linked_tender_id) {
      return reply.code(409).send({
        error: 'Заявка уже принята',
        message: `Заявка уже принята ранее. Тендер #${app.linked_tender_id}`,
        tender_id: app.linked_tender_id
      });
    }

    let tenderId = null;

    // Создать тендер из заявки
    if (create_tender) {
      const now = new Date();
      const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      const commentTo = [
        app.ai_report || app.ai_summary || '',
        `Источник: ${app.source_email || 'email'}`,
        `Создано из входящей заявки #${id}.`,
        notes || ''
      ].filter(Boolean).join('\n\n').trim();

      const tenderRes = await db.query(`
        INSERT INTO tenders (
          tender_title, customer_name, tender_type, tender_status,
          tender_price, comment_to, period,
          created_by, created_at, ai_report, ai_cost_estimate, ai_cost_report
        ) VALUES ($1, $2, $3, 'Новый', $4, $5, $6, $7, NOW(), $8, $9, $10)
        RETURNING id
      `, [
        app.subject || 'Заявка из почты #' + id,
        app.source_name || app.source_email || 'Не указан',
        app.ai_work_type || 'Прямой запрос',
        app.ai_estimated_budget || null,
        commentTo,
        period,
        user.id,
        app.ai_report || null,
        app.ai_cost_estimate || null,
        app.ai_cost_report || null
      ]);
      tenderId = tenderRes.rows[0].id;

      // Прикрепляем вложения из письма к тендеру (копируем файлы в uploads)
      if (app.email_id) {
        try {
          const attRes = await db.query(
            'SELECT filename, original_filename, mime_type, size, file_path FROM email_attachments WHERE email_id = $1 AND is_inline = false',
            [app.email_id]
          );
          for (const att of attRes.rows) {
            const ext = path.extname(att.original_filename || '').toLowerCase() || '.bin';
            const newFilename = `${uuidv4()}${ext}`;
            const srcPath = path.resolve(att.file_path);
            const dstPath = path.join(path.resolve(uploadDir), newFilename);
            try {
              await fs.copyFile(srcPath, dstPath);
            } catch (cpErr) {
              console.error(`[InboxApp] Failed to copy file ${srcPath}: ${cpErr.message}`);
              continue;
            }
            await db.query(`
              INSERT INTO documents (filename, original_name, mime_type, size, type, tender_id, uploaded_by, created_at)
              VALUES ($1, $2, $3, $4, 'ТЗ', $5, $6, NOW())
            `, [newFilename, att.original_filename, att.mime_type, att.size || 0, tenderId, user.id]);
          }
          if (attRes.rows.length) {
            console.log(`[InboxApp] Attached ${attRes.rows.length} files from email #${app.email_id} to tender #${tenderId}`);
          }
        } catch (attErr) {
          console.error('[InboxApp] Error attaching files to tender:', attErr.message);
        }
      }
    }

    // Обновляем заявку (created_by = COALESCE: если AI создал, заменяем на реального сотрудника)
    await db.query(`
      UPDATE inbox_applications SET
        status = 'accepted',
        decision_by = $1, decision_at = NOW(), decision_notes = $2,
        linked_tender_id = $3,
        created_by = COALESCE(created_by, $1),
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

    // Notify directors about accepted application
    const directors = await db.query(
      `SELECT id FROM users WHERE role IN ('ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'HEAD_PM', 'HEAD_TO') AND is_active = true`
    );
    for (const dir of directors.rows) {
      if (dir.id !== user.id) {
        createNotification(db, {
          user_id: dir.id,
          title: '✅ Входящая заявка принята',
          message: `${user.name || 'Пользователь'} принял заявку: ${app.subject || ''}${tenderId ? ' → тендер #' + tenderId : ''}`,
          type: 'inbox',
          link: `#/inbox-applications?id=${id}`
        });
      }
    }

    // Wave-5 хук 3: конвертация карты application → tender.
    // Если есть открытая карта inbox_application с этим id и заявка успешно превращена в тендер —
    // переводим её на entity_kind='tender', flow_type='tender', main_status='Новый'.
    // Если карты нет (директор сам accept без assign-pm и тендер ещё не у PM) — НЕ создаём:
    //   карта появится позже при PUT tender responsible_pm_id (хук 2) или assign-work-pm (хук 1).
    let convertedCardId = null;
    if (tenderId) {
      try {
        const personalKanban = require('./personal-kanban');
        const { broadcast } = require('./sse');
        const pkClient = await db.pool.connect();
        try {
          await pkClient.query('BEGIN');
          const ex = await pkClient.query(
            `SELECT id, owner_user_id, current_substage_id, current_main_status, version
               FROM personal_kanban_cards
              WHERE entity_kind = 'inbox_application' AND entity_id = $1 AND is_closed = FALSE
              ORDER BY id LIMIT 1
              FOR UPDATE`,
            [parseInt(id, 10)]);
          if (ex.rows[0]) {
            const card = ex.rows[0];
            // Защита от дубля: у того же owner уже есть карта на новый тендер?
            const dup = await pkClient.query(
              `SELECT id FROM personal_kanban_cards
                WHERE owner_user_id = $1 AND entity_kind = 'tender' AND entity_id = $2 LIMIT 1`,
              [card.owner_user_id, tenderId]);
            if (!dup.rows[0]) {
              const newSub = await personalKanban.ensureDefaultSubstages(
                pkClient, card.owner_user_id, 'tender', 'Новый');
              await pkClient.query(
                `UPDATE personal_kanban_cards
                    SET flow_type = 'tender',
                        entity_kind = 'tender',
                        entity_id = $1,
                        current_main_status = 'Новый',
                        current_substage_id = $2,
                        last_moved_at = now(),
                        version = version + 1,
                        updated_at = now()
                  WHERE id = $3`,
                [tenderId, newSub, card.id]);
              await pkClient.query(
                `INSERT INTO personal_kanban_card_history
                  (card_id, from_substage_id, to_substage_id, from_main_status, to_main_status, moved_by, note, action)
                 VALUES ($1, $2, $3, $4, 'Новый', $5, $6, 'convert')`,
                [card.id, card.current_substage_id, newSub, card.current_main_status, user.id,
                 `auto: accept inbox_application #${id} → tender #${tenderId}`]);
              await pkClient.query('COMMIT');
              convertedCardId = card.id;
              try {
                broadcast('personal_kanban:card_converted', {
                  card_id: card.id,
                  owner_user_id: card.owner_user_id,
                  flow_type: 'tender',
                  entity_kind: 'tender',
                  entity_id: tenderId,
                  from_entity_kind: 'inbox_application',
                  from_entity_id: parseInt(id, 10),
                  main_status: 'Новый',
                  by_user_id: user.id
                });
              } catch (_) {}
            } else {
              // У PM-а уже есть карта на этот тендер — оставляем старую inbox-карту открытой,
              // её закрытие отдельно через H4 (DELETE источника) или ручной move.
              await pkClient.query('ROLLBACK');
            }
          } else {
            await pkClient.query('ROLLBACK');
          }
        } catch (pkErr) {
          try { await pkClient.query('ROLLBACK'); } catch (_) {}
          fastify.log.error({ err: pkErr }, '[inbox-app/accept] personal_kanban convert failed');
        } finally {
          pkClient.release();
        }
      } catch (outerErr) {
        fastify.log.error({ err: outerErr }, '[inbox-app/accept] personal_kanban hook outer failed');
      }
    }

    return { success: true, tender_id: tenderId, kanban_card_id: convertedCardId };
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
        created_by = COALESCE(created_by, $1),
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

    // Create correspondence record for the rejection
    try {
      const rejectBody = reason
        ? `Уважаемый(ая) ${app.source_name || 'коллега'},

Благодарим Вас за обращение в ООО «Асгард Сервис».

К сожалению, мы вынуждены отказаться от участия в данном запросе.
Причина: ${reason}

Надеемся на дальнейшее сотрудничество.

С уважением,
ООО «Асгард Сервис»`
        : `Уважаемый(ая) ${app.source_name || 'коллега'},

Благодарим Вас за обращение в ООО «Асгард Сервис».

К сожалению, данный запрос не соответствует нашему профилю работ.

Надеемся на дальнейшее сотрудничество.

С уважением,
ООО «Асгард Сервис»`;

      await correspondenceService.createCorrespondence(db, {
        direction: 'outgoing',
        date: new Date(),
        doc_type: 'letter',
        subject: 'Отказ: ' + (app.subject || ''),
        body: rejectBody,
        counterparty: app.source_email || '',
        contact_person: app.source_name || '',
        linked_inbox_application_id: id,
        status: 'sent',
        created_by: user.id
      }, {
        userId: user.id
      });
    } catch (corrErr) {
      console.error('[InboxApp] Correspondence auto-register error:', corrErr.message);
    }

    // Notify directors about rejected application
    const rDirectors = await db.query(
      `SELECT id FROM users WHERE role IN ('ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'HEAD_PM') AND is_active = true`
    );
    for (const dir of rDirectors.rows) {
      if (dir.id !== user.id) {
        createNotification(db, {
          user_id: dir.id,
          title: '❌ Входящая заявка отклонена',
          message: `${user.name || 'Пользователь'} отклонил заявку: ${app.subject || ''}${reason ? ' — ' + reason.substring(0, 60) : ''}`,
          type: 'inbox',
          link: `#/inbox-applications?id=${id}`
        });
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
    const appIdInt = parseInt(id, 10);
    const upd = await db.query(
      `UPDATE inbox_applications SET status = 'archived', updated_at = NOW() WHERE id = $1 RETURNING id`,
      [appIdInt]);
    // Wave-5 H4: архив = эквивалент soft-delete для inbox-flow, закрываем открытые карты.
    if (upd.rowCount > 0) {
      try {
        const personalKanban = require('./personal-kanban');
        const { broadcast } = require('./sse');
        const { closed_card_ids, rows } = await personalKanban.closeKanbanCardsForEntity(
          db, 'inbox_application', appIdInt, request.user.id, 'inbox_application archived');
        if (Array.isArray(closed_card_ids) && closed_card_ids.length) {
          for (const card of rows) {
            try {
              broadcast('personal_kanban:card_closed', {
                card_id: card.id,
                owner_user_id: card.owner_user_id,
                entity_kind: 'inbox_application',
                entity_id: appIdInt,
                reason: 'inbox_application archived',
                by_user_id: request.user.id
              });
            } catch (_) {}
          }
        }
      } catch (pkErr) {
        request.log.error({ err: pkErr }, '[inbox-app archive] close kanban cards failed');
      }
    }
    return { success: true };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 11. DELETE /:id — Удалить
  // ═══════════════════════════════════════════════════════════════════
  fastify.delete('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const appIdInt = parseInt(id, 10);
    // Удаляем логи анализов
    await db.query('DELETE FROM ai_analysis_log WHERE entity_type = $1 AND entity_id = $2', ['inbox_application', appIdInt]);
    const del = await db.query('DELETE FROM inbox_applications WHERE id = $1 RETURNING id', [appIdInt]);

    // Wave-5 H4: закрыть orphan-карты канбана (только если реально удалили).
    if (del.rowCount > 0) {
      try {
        const personalKanban = require('./personal-kanban');
        const { broadcast } = require('./sse');
        const { closed_card_ids, rows } = await personalKanban.closeKanbanCardsForEntity(
          db, 'inbox_application', appIdInt, request.user.id, 'inbox_application deleted');
        if (Array.isArray(closed_card_ids) && closed_card_ids.length) {
          for (const card of rows) {
            try {
              broadcast('personal_kanban:card_closed', {
                card_id: card.id,
                owner_user_id: card.owner_user_id,
                entity_kind: 'inbox_application',
                entity_id: appIdInt,
                reason: 'inbox_application deleted',
                by_user_id: request.user.id
              });
            } catch (_) {}
          }
        }
      } catch (pkErr) {
        request.log.error({ err: pkErr }, '[inbox-app DELETE] close kanban cards failed');
      }
    }
    return { success: true };
  });


  // ═══════════════════════════════════════════════════════════════════
  // 12. POST /:id/assign-pm  {pm_user_id, note?}
  // RBAC: ADMIN / DIRECTOR_* / HEAD_PM (см. §2.2). H3: оптимистичный UPDATE.
  // Создаёт personal_kanban_cards (flow_type='application',
  // current_main_status='assigned' — каноник §9.1 для inbox после V223).
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/:id/assign-pm', {
    preHandler: [fastify.requireRoles(['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_PM'])]
  }, async (request, reply) => {
    const { id } = request.params;
    const appId = parseInt(id, 10);
    if (!Number.isFinite(appId)) return reply.code(400).send({ error: 'invalid_id' });
    const body = request.body || {};
    const pmUserId = parseInt(body.pm_user_id, 10);
    if (!Number.isFinite(pmUserId)) return reply.code(400).send({ error: 'pm_user_id_required' });
    const note = body.note ? String(body.note).slice(0, 2000) : null;
    const actor = request.user;

    // Валидируем PM
    const pm = await db.query(
      `SELECT id, name, role, is_active FROM users WHERE id = $1`, [pmUserId]);
    if (!pm.rows[0]) return reply.code(404).send({ error: 'pm_not_found' });
    if (!pm.rows[0].is_active) return reply.code(400).send({ error: 'pm_inactive' });
    if (!['PM', 'HEAD_PM'].includes(pm.rows[0].role)) {
      return reply.code(400).send({ error: 'pm_invalid_role', message: 'assign только PM/HEAD_PM' });
    }

    const personalKanban = require('./personal-kanban');
    const { broadcast } = require('./sse');

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // H3: оптимистичный UPDATE — защита от двойного назначения
      const upd = await client.query(
        `UPDATE inbox_applications
            SET assigned_pm_id = $1, assigned_by = $2, assigned_at = NOW(),
                status = 'assigned', updated_at = NOW()
          WHERE id = $3 AND assigned_pm_id IS NULL
          RETURNING id, subject, source_name, source_email, ai_color, ai_classification`,
        [pmUserId, actor.id, appId]);

      if (upd.rowCount === 0) {
        // Либо нет, либо уже назначено
        const cur = await client.query(
          `SELECT id, assigned_pm_id FROM inbox_applications WHERE id = $1`, [appId]);
        await client.query('ROLLBACK');
        if (!cur.rows[0]) return reply.code(404).send({ error: 'application_not_found' });
        return reply.code(409).send({
          error: 'already_assigned',
          assigned_pm_id: cur.rows[0].assigned_pm_id
        });
      }
      const application = upd.rows[0];

      // Первый активный substage PM для (application, 'assigned')
      const firstSub = await personalKanban.ensureDefaultSubstages(
        client, pmUserId, 'application', 'assigned');

      // Создание карты (UNIQUE owner+entity_kind+entity_id → ON CONFLICT DO NOTHING)
      const cardIns = await client.query(
        `INSERT INTO personal_kanban_cards
          (owner_user_id, flow_type, entity_kind, entity_id,
           current_main_status, current_substage_id)
         VALUES ($1, 'application', 'inbox_application', $2, 'assigned', $3)
         ON CONFLICT (owner_user_id, entity_kind, entity_id) DO NOTHING
         RETURNING id, owner_user_id, current_main_status, current_substage_id`,
        [pmUserId, appId, firstSub]);

      let cardId;
      if (cardIns.rowCount > 0) {
        cardId = cardIns.rows[0].id;
        await client.query(
          `INSERT INTO personal_kanban_card_history
            (card_id, from_substage_id, to_substage_id, from_main_status, to_main_status, moved_by, note, action)
           VALUES ($1, NULL, $2, NULL, 'assigned', $3, $4, 'create')`,
          [cardId, firstSub, actor.id, note || `назначено PM пользователем ${actor.id}`]);
      } else {
        // Уже есть карта (повторное назначение → ровно тому же PM невозможно из-за UPDATE-гарда,
        // но карта могла быть создана отдельно).
        const ex = await client.query(
          `SELECT id FROM personal_kanban_cards
            WHERE owner_user_id = $1 AND entity_kind = 'inbox_application' AND entity_id = $2`,
          [pmUserId, appId]);
        cardId = ex.rows[0]?.id || null;
      }

      await client.query('COMMIT');

      // Уведомление PM (H3: cатчим promise-rejection из async createNotification)
      try {
        Promise.resolve(createNotification(db, {
          user_id: pmUserId,
          title: `Вам назначена заявка №${appId}`,
          message: application.subject ? String(application.subject).slice(0, 200) : '(без темы)',
          type: 'inbox_application_assigned',
          link: cardId ? `#/personal-kanban?card=${cardId}` : `#/inbox-applications?id=${appId}`
        })).catch(err => request.log.warn({ err }, '[inbox-app/assign-pm] notify failed'));
      } catch (e) {
        request.log.warn({ err: e }, '[inbox-app/assign-pm] notify sync-throw');
      }

      // SSE
      try {
        broadcast('inbox_applications:assigned', {
          application_id: appId, pm_user_id: pmUserId,
          assigned_by: actor.id, card_id: cardId
        });
      } catch (_) {}

      return { success: true, application_id: appId, card_id: cardId, assigned_pm_id: pmUserId };
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      request.log.error({ err: e }, '[inbox-app/assign-pm] failed');
      return reply.code(500).send({ error: 'assign_failed', message: e.message });
    } finally {
      client.release();
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 13. POST /direct — прямая заявка (multipart)
  // PM: assign_pm_user_id default = req.user.id
  // DIRECTOR_*/ADMIN/HEAD_PM: assign_pm_user_id обязателен
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/direct', {
    preHandler: [fastify.requireRoles(['ADMIN', 'PM', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'])]
  }, async (request, reply) => {
    const actor = request.user;
    // multipart парсинг
    let title = '';
    let bodyText = '';
    let customerName = '';
    let customerContact = '';
    let assignPmUserId = null;
    const files = [];

    // H7 (Wave-2 fixer): жёсткий лимит multipart-частей.
    const MAX_FILES = 20;
    const MAX_FILE_BYTES = 50 * 1024 * 1024;

    const isMultipart = (request.headers['content-type'] || '').includes('multipart/form-data');
    if (isMultipart) {
      try {
        // limits: files=20, fileSize=50MB — fastify-multipart прокидывает в busboy.
        const parts = request.parts({ limits: { files: MAX_FILES, fileSize: MAX_FILE_BYTES } });
        let tooManyFiles = false;
        let oversize = false;
        for await (const part of parts) {
          if (part.file) {
            // Доп. явный счётчик — если limits не сработал (старые версии библиотеки).
            if (files.length >= MAX_FILES) {
              tooManyFiles = true;
              try { part.file.resume(); } catch (_) {}
              continue;
            }
            const buf = await part.toBuffer();
            // truncated => превышение fileSize в busboy
            if (part.file && part.file.truncated) {
              oversize = true;
              continue;
            }
            if (buf.length > MAX_FILE_BYTES) {
              oversize = true;
              continue;
            }
            files.push({
              filename: part.filename,
              mimetype: part.mimetype,
              buffer: buf
            });
          } else if (part.fieldname === 'title') title = String(part.value || '').trim();
          else if (part.fieldname === 'body') bodyText = String(part.value || '').trim();
          else if (part.fieldname === 'customer_name') customerName = String(part.value || '').trim();
          else if (part.fieldname === 'customer_contact') customerContact = String(part.value || '').trim();
          else if (part.fieldname === 'assign_pm_user_id') {
            const n = parseInt(part.value, 10);
            if (Number.isFinite(n)) assignPmUserId = n;
          }
        }
        if (tooManyFiles) {
          return reply.code(400).send({ error: 'too_many_files', max: MAX_FILES });
        }
        if (oversize) {
          return reply.code(400).send({ error: 'file_too_large', max_bytes: MAX_FILE_BYTES });
        }
      } catch (e) {
        // fastify-multipart кидает FST_REQ_FILE_TOO_LARGE / FST_FILES_LIMIT — мапим в 400.
        const code = e && (e.code || '');
        if (code === 'FST_FILES_LIMIT') {
          return reply.code(400).send({ error: 'too_many_files', max: MAX_FILES });
        }
        if (code === 'FST_REQ_FILE_TOO_LARGE') {
          return reply.code(400).send({ error: 'file_too_large', max_bytes: MAX_FILE_BYTES });
        }
        request.log.error({ err: e }, '[inbox-app/direct] multipart parse error');
        return reply.code(400).send({ error: 'multipart_parse_error', message: e.message });
      }
    } else {
      const b = request.body || {};
      title = String(b.title || '').trim();
      bodyText = String(b.body || '').trim();
      customerName = String(b.customer_name || '').trim();
      customerContact = String(b.customer_contact || '').trim();
      if (b.assign_pm_user_id != null) {
        const n = parseInt(b.assign_pm_user_id, 10);
        if (Number.isFinite(n)) assignPmUserId = n;
      }
    }

    if (!title || title.length < 2 || title.length > 500) {
      return reply.code(400).send({ error: 'invalid_title' });
    }
    if (!bodyText) {
      return reply.code(400).send({ error: 'invalid_body' });
    }

    // Определяем PM
    if (actor.role === 'PM') {
      if (assignPmUserId === null) assignPmUserId = actor.id;
      // PM может назначить только себе
      if (assignPmUserId !== actor.id) {
        return reply.code(403).send({ error: 'pm_can_assign_only_self' });
      }
    } else {
      // DIRECTOR / HEAD_PM / ADMIN — обязателен assign_pm_user_id
      if (assignPmUserId === null) {
        return reply.code(400).send({ error: 'assign_pm_user_id_required' });
      }
    }

    // Валидируем PM
    const pm = await db.query(
      `SELECT id, role, is_active FROM users WHERE id = $1`, [assignPmUserId]);
    if (!pm.rows[0]) return reply.code(404).send({ error: 'pm_not_found' });
    if (!pm.rows[0].is_active) return reply.code(400).send({ error: 'pm_inactive' });
    if (!['PM', 'HEAD_PM'].includes(pm.rows[0].role)) {
      return reply.code(400).send({ error: 'pm_invalid_role' });
    }

    const personalKanban = require('./personal-kanban');
    const { broadcast } = require('./sse');

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // INSERT inbox_applications (source_kind='manual')
      const insApp = await client.query(
        `INSERT INTO inbox_applications
          (source, source_email, source_name, subject, body_preview,
           attachment_count, status, source_kind,
           assigned_pm_id, assigned_by, assigned_at,
           created_by, needs_review)
         VALUES ('direct', $1, $2, $3, $4, $5, 'assigned', 'manual',
                 $6, $7, NOW(), $8, FALSE)
         RETURNING id, subject`,
        [
          customerContact || null,
          customerName || null,
          title.slice(0, 500),
          bodyText.slice(0, 4000),
          files.length,
          assignPmUserId,
          actor.id,
          actor.id
        ]);
      const appId = insApp.rows[0].id;

      // H6 (Wave-2 fixer): файлы НЕ пишем на диск внутри транзакции.
      // Внутри tx — только INSERT в documents (логические записи).
      // После COMMIT — fs.writeFile. Если writeFile упадёт — компенсация:
      //   UPDATE inbox_applications.attachment_count = 0 + DELETE documents.
      const ALLOWED_EXTENSIONS = [
        '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
        '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg',
        '.zip', '.rar', '.7z', '.tar', '.gz',
        '.txt', '.csv', '.rtf', '.odt', '.ods'
      ];
      const fsLocal = require('fs').promises;
      const pathLocal = require('path');
      const uploadBaseDir = pathLocal.resolve(uploadDir);

      // План на запись после COMMIT
      const pendingWrites = []; // [{filepath, buffer, docId}]
      const docIdsCreated = []; // для compensation на failure
      let acceptedFiles = 0;
      for (const f of files) {
        const ext = (pathLocal.extname(f.filename || '') || '.bin').toLowerCase();
        if (!ALLOWED_EXTENSIONS.includes(ext)) {
          continue; // пропускаем недопустимые типы
        }
        const safeName = `${uuidv4()}${ext}`;
        const filepath = pathLocal.join(uploadBaseDir, safeName);
        try {
          const docIns = await client.query(
            `INSERT INTO documents
              (filename, original_name, mime_type, size, type, uploaded_by, download_url, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             RETURNING id`,
            [safeName, f.filename || safeName, f.mimetype || 'application/octet-stream',
             f.buffer.length, 'Прямая заявка', actor.id,
             `/api/files/download/${safeName}`]);
          docIdsCreated.push(docIns.rows[0].id);
          pendingWrites.push({ filepath, buffer: f.buffer, docId: docIns.rows[0].id, safeName });
          acceptedFiles++;
        } catch (dbErr) {
          request.log.warn({ err: dbErr }, '[inbox-app/direct] document INSERT failed');
        }
      }

      // Корректируем attachment_count под реально принятые (вне зависимости от len(files))
      if (acceptedFiles !== files.length) {
        await client.query(
          `UPDATE inbox_applications SET attachment_count = $1 WHERE id = $2`,
          [acceptedFiles, appId]);
      }

      // Карта канбана для PM
      const firstSub = await personalKanban.ensureDefaultSubstages(
        client, assignPmUserId, 'application', 'assigned');

      let cardId = null;
      const cardIns = await client.query(
        `INSERT INTO personal_kanban_cards
          (owner_user_id, flow_type, entity_kind, entity_id,
           current_main_status, current_substage_id)
         VALUES ($1, 'application', 'inbox_application', $2, 'assigned', $3)
         ON CONFLICT (owner_user_id, entity_kind, entity_id) DO NOTHING
         RETURNING id`,
        [assignPmUserId, appId, firstSub]);
      if (cardIns.rowCount > 0) {
        cardId = cardIns.rows[0].id;
        await client.query(
          `INSERT INTO personal_kanban_card_history
            (card_id, from_substage_id, to_substage_id, from_main_status, to_main_status, moved_by, note, action)
           VALUES ($1, NULL, $2, NULL, 'assigned', $3, $4, 'create')`,
          [cardId, firstSub, actor.id, 'прямая заявка']);
      }

      await client.query('COMMIT');

      // H6: запись файлов на диск ПОСЛЕ COMMIT. Failure → компенсация (DELETE documents).
      let filesSaved = 0;
      let writeFailures = 0;
      if (pendingWrites.length > 0) {
        try {
          await fsLocal.mkdir(uploadBaseDir, { recursive: true });
        } catch (_) {}
        for (const w of pendingWrites) {
          try {
            await fsLocal.writeFile(w.filepath, w.buffer);
            filesSaved++;
          } catch (writeErr) {
            writeFailures++;
            request.log.warn({ err: writeErr, doc_id: w.docId },
              '[inbox-app/direct] writeFile failed, will delete orphan document row');
            // Компенсация: удаляем DB-запись, чтобы не было «есть документ, но нет файла»
            try {
              await db.query('DELETE FROM documents WHERE id = $1', [w.docId]);
            } catch (cleanErr) {
              request.log.warn({ err: cleanErr, doc_id: w.docId },
                '[inbox-app/direct] compensation DELETE failed');
            }
          }
        }
        // Если ни один файл не записан / часть не записана — синхронизируем attachment_count.
        if (writeFailures > 0) {
          try {
            await db.query(
              `UPDATE inbox_applications SET attachment_count = $1 WHERE id = $2`,
              [filesSaved, appId]);
          } catch (_) {}
        }
      }

      // Уведомление PM (H3: ловим promise-rejection из async createNotification)
      try {
        Promise.resolve(createNotification(db, {
          user_id: assignPmUserId,
          title: `Новая прямая заявка №${appId}`,
          message: title.slice(0, 200),
          type: 'inbox_application_direct',
          link: cardId ? `#/personal-kanban?card=${cardId}` : `#/inbox-applications?id=${appId}`
        })).catch(err => request.log.warn({ err }, '[inbox-app/direct] notify failed'));
      } catch (e) {
        request.log.warn({ err: e }, '[inbox-app/direct] notify sync-throw');
      }

      try {
        broadcast('inbox_applications:direct_created', {
          application_id: appId, pm_user_id: assignPmUserId,
          by_user_id: actor.id, card_id: cardId
        });
      } catch (_) {}

      return {
        success: true,
        application_id: appId,
        card_id: cardId,
        files_saved: filesSaved,
        files_accepted: acceptedFiles,
        files_received: files.length
      };
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      request.log.error({ err: e }, '[inbox-app/direct] failed');
      return reply.code(500).send({ error: 'direct_create_failed', message: e.message });
    } finally {
      client.release();
    }
  });

  // POST /:id/calc-cost
  fastify.post('/:id/calc-cost', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const app = (await db.query('SELECT * FROM inbox_applications WHERE id = $1', [id])).rows[0];
    if (!app) return reply.code(404).send({ error: 'Not found' });

    try {
      const aiProvider = require('../services/ai-provider');
      const { COST_ESTIMATION_PROMPT } = require('../prompts/cost-estimation-prompt');

      const appInfo = [
        'Заявка: ' + (app.subject || 'Без темы'),
        'Отправитель: ' + (app.from_name || '') + ' <' + (app.source_email || '') + '>',
        'Тип работ: ' + (app.ai_work_type || 'не определён'),
        'AI-отчёт: ' + (app.ai_report || ''),
        'AI-рекомендация: ' + (app.ai_recommendation || ''),
        'Краткое описание: ' + (app.ai_summary || '')
      ].join('\n');

      const userMessage = 'Рассчитай себестоимость для следующей заявки:\n\n' + appInfo;

      const response = await aiProvider.complete({
        system: COST_ESTIMATION_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        maxTokens: 4096,
        temperature: 0.2
      });

      if (!response.text) {
        console.error('[inbox-ai cost-est] AI вернул пустой content. model:', response.model, 'finish_reason:', response.stopReason, 'usage:', JSON.stringify(response.usage));
        return reply.code(502).send({
          error: 'AI вернул пустой ответ. Возможно, сработал контентный фильтр или превышен лимит токенов. См. логи сервера.',
          code: 'empty_response'
        });
      }

      // Parse JSON from AI response
      let costData;
      try {
        let jsonStr = response.text.trim();
        const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) jsonStr = jsonMatch[1].trim();
        costData = JSON.parse(jsonStr);
      } catch (parseErr) {
        // Save raw text even if JSON parse fails
        await db.query(
          'UPDATE inbox_applications SET ai_cost_report = $1, updated_at = NOW() WHERE id = $2',
          [response.text, id]
        );
        return { success: true, ai_cost_report: response.text, parse_error: true };
      }

      const totalCost = costData.total_cost || 0;
      await db.query(
        'UPDATE inbox_applications SET ai_cost_estimate = $1, ai_cost_report = $2, updated_at = NOW() WHERE id = $3',
        [totalCost, JSON.stringify(costData), id]
      );

      return { success: true, ai_cost_estimate: totalCost, ai_cost_report: costData };
    } catch (err) {
      if (err && err.name === 'AIProviderError') {
        request.log.error({
          err_code: err.code, status: err.status,
          provider_msg: err.providerMessage,
          request_summary: err.requestSummary,
          body_sample: err.body ? String(err.body).substring(0, 500) : null
        }, 'inbox app calc-cost AI error');
        return reply.code(err.code === 'insufficient_funds' ? 402 : 502).send({
          error: err.userMessage(), code: err.code, provider_status: err.status
        });
      }
      request.log.error(err, 'inbox app calc-cost error');
      return reply.code(500).send({ error: err.message });
    }
  });


};