/**
 * Tenders Routes - CRUD for tenders
 * ═══════════════════════════════════════════════════════════════════════════
 */

async function routes(fastify, options) {
  const db = fastify.db;
  const { createNotification } = require('../services/notify');
  const { sendToUser, broadcast } = require('./sse');

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /api/tenders - List all tenders
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.get('/', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const {
      period,
      status,
      pm_id,
      type,
      search: rawSearch,
      limit: rawLimit = 100,
      offset: rawOffset = 0
    } = request.query;

    // Clamp limit to minimum of 1 to prevent negative LIMIT crash
    const limit = Math.max(1, parseInt(rawLimit, 10) || 100);
    const offset = Math.max(0, parseInt(rawOffset, 10) || 0);
    // Strip null bytes from search to prevent PostgreSQL crash
    const search = rawSearch ? rawSearch.replace(/\0/g, '') : rawSearch;

    let sql = `
      SELECT t.*, 
             u.name as pm_name,
             (SELECT COUNT(*) FROM estimates e WHERE e.tender_id = t.id) as estimates_count,
             (SELECT COUNT(*) FROM works w WHERE w.tender_id = t.id) as works_count
      FROM tenders t
      LEFT JOIN users u ON t.responsible_pm_id = u.id
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;

    if (period) {
      sql += ` AND t.period = $${idx}`;
      params.push(period);
      idx++;
    }

    if (status) {
      sql += ` AND t.tender_status = $${idx}`;
      params.push(status);
      idx++;
    }

    if (pm_id) {
      sql += ` AND t.responsible_pm_id = $${idx}`;
      params.push(pm_id);
      idx++;
    }

    if (type) {
      sql += ` AND t.tender_type = $${idx}`;
      params.push(type);
      idx++;
    }

    if (search) {
      sql += ` AND (
        LOWER(t.customer_name) LIKE $${idx} OR
        LOWER(t.tender_title) LIKE $${idx} OR
        LOWER(t.group_tag) LIKE $${idx}
      )`;
      params.push(`%${search.toLowerCase()}%`);
      idx++;
    }

    sql += ` ORDER BY t.id DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);

    const result = await db.query(sql, params);
    
    // Get total count (с теми же фильтрами что и основной запрос)
    let countSql = 'SELECT COUNT(*) FROM tenders t WHERE 1=1';
    const countParams = [];
    let countIdx = 1;

    if (period) {
      countSql += ` AND t.period = $${countIdx}`;
      countParams.push(period);
      countIdx++;
    }
    if (status) {
      countSql += ` AND t.tender_status = $${countIdx}`;
      countParams.push(status);
      countIdx++;
    }
    if (pm_id) {
      countSql += ` AND t.responsible_pm_id = $${countIdx}`;
      countParams.push(pm_id);
      countIdx++;
    }
    if (type) {
      countSql += ` AND t.tender_type = $${countIdx}`;
      countParams.push(type);
      countIdx++;
    }
    if (search) {
      countSql += ` AND (
        LOWER(t.customer_name) LIKE $${countIdx} OR
        LOWER(t.tender_title) LIKE $${countIdx} OR
        LOWER(t.group_tag) LIKE $${countIdx}
      )`;
      countParams.push(`%${search.toLowerCase()}%`);
      countIdx++;
    }

    const countResult = await db.query(countSql, countParams);

    return {
      tenders: result.rows,
      total: parseInt(countResult.rows[0].count, 10)
    };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /api/tenders/:id - Get single tender
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.get('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const result = await db.query(`
      SELECT t.*,
             u.name as pm_name,
             COALESCE(c.name, t.customer_name) as customer_display
      FROM tenders t
      LEFT JOIN users u ON t.responsible_pm_id = u.id
      LEFT JOIN customers c ON t.customer_inn = c.inn
      WHERE t.id = $1
    `, [id]);

    if (!result.rows[0]) {
      return reply.code(404).send({ error: 'Тендер не найден' });
    }

    // Get related estimates
    const estimates = await db.query(
      'SELECT * FROM estimates WHERE tender_id = $1 ORDER BY created_at DESC',
      [id]
    );

    // Get related works
    const works = await db.query(
      'SELECT * FROM works WHERE tender_id = $1 ORDER BY created_at DESC',
      [id]
    );

    return {
      tender: result.rows[0],
      estimates: estimates.rows,
      works: works.rows
    };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/tenders - Create tender
  // ─────────────────────────────────────────────────────────────────────────────
  // SECURITY B3: Role-based access for write operations
  fastify.post('/', {
    preHandler: [fastify.requireRoles(['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'])],
    schema: {
      body: {
        type: 'object',
        properties: {
          customer: { type: 'string' },
          customer_inn: { type: 'string' },
          tender_number: { type: 'string' },
          tender_type: { type: 'string' },
          tender_status: { type: 'string' },
          period: { type: 'string' },
          deadline: { type: 'string' },
          tender_price: { type: 'number' },
          responsible_pm_id: { type: 'number' },
          tag: { type: 'string' },
          docs_link: { type: 'string' },
          comment_to: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const raw = request.body;

      // Validate customer is always required via API
      // (Draft workflow uses /api/data/tenders instead, not this route)
      const customerVal = String(raw.customer || raw.customer_name || '').trim();
      if (!customerVal) {
        return reply.code(400).send({ error: 'Обязательное поле: customer' });
      }

      // Set default status to "Новый"
      if (!raw.tender_status) {
        raw.tender_status = 'Новый';
      }

      // Map API field names to DB column names
      if (raw.customer && !raw.customer_name) { raw.customer_name = raw.customer; }
      delete raw.customer;
      if (raw.tender_number && !raw.tender_title) { raw.tender_title = raw.tender_number; }
      delete raw.tender_number;
      if (raw.deadline && !raw.docs_deadline) { raw.docs_deadline = raw.deadline; }
      delete raw.deadline;
      if (raw.tender_price !== undefined && raw.tender_price === undefined) { raw.tender_price = raw.tender_price; }
      delete raw.tender_price;
      if (raw.tag && !raw.group_tag) { raw.group_tag = raw.tag; }
      delete raw.tag;
      if (raw.docs_link && !raw.purchase_url) { raw.purchase_url = raw.docs_link; }
      delete raw.docs_link;
      raw.created_by = request.user.id;
      raw.created_at = new Date().toISOString();

      // Auto-generate period if not provided
      if (!raw.period) {
        const now = new Date();
        raw.period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      }

      // SECURITY: Filter to allowed DB columns only
      const allowedCols = [
        'customer_name', 'customer_inn', 'tender_title', 'tender_type',
        'tender_status', 'period', 'docs_deadline', 'tender_price', 'responsible_pm_id',
        'group_tag', 'purchase_url', 'comment_to', 'comment_dir', 'reject_reason',
        'created_by', 'created_at'
      ];
      const data = {};
      for (const k of allowedCols) {
        if (raw[k] !== undefined) data[k] = raw[k];
      }

      const keys = Object.keys(data);
      const values = Object.values(data);
      const placeholders = keys.map((_, i) => `$${i + 1}`);

      const sql = `
        INSERT INTO tenders (${keys.join(', ')})
        VALUES (${placeholders.join(', ')})
        RETURNING *
      `;

      const result = await db.query(sql, values);

      // Log to audit
      try {
        await db.query(`
          INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, details, created_at)
          VALUES ($1, 'tender', $2, 'create', $3, NOW())
        `, [request.user.id, result.rows[0].id, JSON.stringify({ tender: result.rows[0] })]);
      } catch (auditErr) {
        fastify.log.warn('Audit log insert failed:', auditErr.message);
      }

      // Notify assigned PM about new tender
      const tender = result.rows[0];
      if (tender.responsible_pm_id && tender.responsible_pm_id !== request.user.id) {
        createNotification(db, {
          user_id: tender.responsible_pm_id,
          title: '📋 Новый тендер',
          message: `${request.user.name || 'Пользователь'} создал тендер: ${tender.customer_name || ''} — ${tender.tender_title || ''}`,
          type: 'tender',
          link: `#/tenders?id=${tender.id}`
        });
      }

      // SSE: уведомляем о новом тендере
      broadcast('tender:created', {
        id: tender.id, customer_name: tender.customer_name || '',
        tender_status: tender.tender_status, tender_type: tender.tender_type,
        responsible_pm_id: tender.responsible_pm_id
      });

      return { tender };
    } catch (err) {
      if (err.code === '23503') {
        return reply.code(400).send({ error: `Ссылка на несуществующую запись: ${err.detail || err.message}` });
      }
      const code = err.code === '22001' || err.code === '23502' ? 400 : 500;
      return reply.code(code).send({ error: 'Ошибка создания тендера', detail: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PUT /api/tenders/:id - Update tender
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.put('/:id', {
    preHandler: [fastify.requireRoles(['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'])]
  }, async (request, reply) => {
    const { id } = request.params;
    const data = request.body;

    // Get current tender
    const current = await db.query('SELECT * FROM tenders WHERE id = $1', [id]);
    if (!current.rows[0]) {
      return reply.code(404).send({ error: 'Тендер не найден' });
    }
    const oldTender = current.rows[0];

    // Draft transition validation: require customer when leaving Черновик
    if (oldTender.tender_status === 'Черновик' && data.tender_status && data.tender_status !== 'Черновик') {
      const customerValue = data.customer || oldTender.customer_name;
      if (!customerValue || !String(customerValue).trim()) {
        return reply.code(400).send({
          error: 'Для смены статуса заполните обязательные поля',
          missing_fields: ['customer']
        });
      }
    }

    // Build update query — map API field names to DB columns
    const FIELD_MAP = {
      'customer': 'customer_name',
      'tender_number': 'tender_title',
      'deadline': 'docs_deadline',
      'tender_price': 'tender_price',
      'tag': 'group_tag',
      'docs_link': 'purchase_url'
    };

    const allowedFields = [
      'customer', 'customer_name', 'customer_inn', 'tender_number', 'tender_title',
      'tender_type', 'tender_status', 'period', 'deadline', 'docs_deadline',
      'tender_price', 'tender_price', 'responsible_pm_id', 'tag', 'group_tag',
      'docs_link', 'purchase_url', 'comment_to', 'comment_dir', 'reject_reason'
    ];

    const updates = [];
    const values = [];
    let idx = 1;
    const usedCols = new Set();

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        const dbCol = FIELD_MAP[field] || field;
        if (usedCols.has(dbCol)) continue;
        usedCols.add(dbCol);
        updates.push(`${dbCol} = $${idx}`);
        values.push(data[field]);
        idx++;
      }
    }

    if (updates.length === 0) {
      return reply.code(400).send({ error: 'Нет данных для обновления' });
    }

    updates.push('updated_at = NOW()');
    values.push(id);

    const sql = `
      UPDATE tenders SET ${updates.join(', ')}
      WHERE id = $${idx}
      RETURNING *
    `;

    const result = await db.query(sql, values);

    // Log to audit
    await db.query(`
      INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, details, created_at)
      VALUES ($1, 'tender', $2, 'update', $3, NOW())
    `, [request.user.id, id, JSON.stringify({ before: current.rows[0], after: result.rows[0] })]);

    // Notify PM on status change
    const updated = result.rows[0];
    if (data.tender_status && data.tender_status !== oldTender.tender_status && updated.responsible_pm_id && updated.responsible_pm_id !== request.user.id) {
      createNotification(db, {
        user_id: updated.responsible_pm_id,
        title: `📋 Тендер: ${data.tender_status}`,
        message: `Статус тендера ${updated.customer_name || updated.tender_title || ''} изменён: ${oldTender.tender_status} → ${data.tender_status}`,
        type: 'tender',
        link: `#/tenders?id=${updated.id}`
      });
    }
    // Notify new PM on reassignment
    if (data.responsible_pm_id && data.responsible_pm_id !== oldTender.responsible_pm_id && data.responsible_pm_id !== request.user.id) {
      createNotification(db, {
        user_id: data.responsible_pm_id,
        title: '📋 Тендер назначен вам',
        message: `Вам назначен тендер: ${updated.customer_name || ''} — ${updated.tender_title || ''}`,
        type: 'tender',
        link: `#/tenders?id=${updated.id}`
      });
    }

    // SSE: уведомляем об изменении тендера
    broadcast('tender:updated', {
      id: updated.id, customer_name: updated.customer_name || '',
      tender_status: updated.tender_status,
      old_status: oldTender.tender_status,
      responsible_pm_id: updated.responsible_pm_id
    });

    // SSE: персональное уведомление РП при смене статуса
    if (data.tender_status && data.tender_status !== oldTender.tender_status && updated.responsible_pm_id) {
      sendToUser(updated.responsible_pm_id, 'tender:status_changed', {
        id: updated.id, customer_name: updated.customer_name || '',
        old_status: oldTender.tender_status,
        new_status: updated.tender_status
      });
    }

    return { tender: updated };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // DELETE /api/tenders/:id - Delete tender
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.delete('/:id', {
    preHandler: [fastify.requireRoles(['ADMIN', 'DIRECTOR_GEN'])]
  }, async (request, reply) => {
    const { id } = request.params;

    // Check for related records
    const estimates = await db.query('SELECT COUNT(*) FROM estimates WHERE tender_id = $1', [id]);
    const works = await db.query('SELECT COUNT(*) FROM works WHERE tender_id = $1', [id]);

    if (parseInt(estimates.rows[0].count, 10) > 0 || parseInt(works.rows[0].count, 10) > 0) {
      return reply.code(400).send({ 
        error: 'Нельзя удалить тендер с привязанными расчётами или работами' 
      });
    }

    const result = await db.query('DELETE FROM tenders WHERE id = $1 RETURNING id', [id]);

    if (!result.rows[0]) {
      return reply.code(404).send({ error: 'Тендер не найден' });
    }

    return { message: 'Тендер удалён' };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /api/tenders/stats - Get tender statistics
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.get('/stats/summary', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { period, year } = request.query;

      let whereClause = "1=1 AND tender_status != 'Черновик'";
      const params = [];
      let idx = 1;

      if (period) {
        whereClause += ` AND period = $${idx}`;
        params.push(period);
        idx++;
      }

      if (year) {
        whereClause += ` AND EXTRACT(YEAR FROM created_at) = $${idx}`;
        params.push(year);
      }

      const stats = await db.query(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE tender_status IN ('Выиграли', 'Контракт')) as won,
          COUNT(*) FILTER (WHERE tender_status IN ('Проиграли', 'Отказ')) as lost,
          COUNT(*) FILTER (WHERE tender_status NOT IN ('Выиграли', 'Контракт', 'Проиграли', 'Отказ')) as active,
          COALESCE(SUM(tender_price), 0) as total_sum,
          COALESCE(SUM(tender_price) FILTER (WHERE tender_status IN ('Выиграли', 'Контракт')), 0) as won_sum
        FROM tenders
        WHERE ${whereClause}
      `, params);

      const byStatus = await db.query(`
        SELECT tender_status, COUNT(*) as count, COALESCE(SUM(tender_price), 0) as sum
        FROM tenders
        WHERE ${whereClause}
        GROUP BY tender_status
        ORDER BY count DESC
      `, params);

      return {
        summary: stats.rows[0],
        byStatus: byStatus.rows
      };
    } catch (err) {
      request.log.error(err, 'tenders stats/summary error');
      return reply.code(500).send({ error: 'Stats error', details: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // M15: Аналитика тендерного отдела (для HEAD_TO)
  // ═══════════════════════════════════════════════════════════════

  fastify.get('/analytics/team', {
    preHandler: [fastify.requireRoles(['HEAD_TO', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'])]
  }, async (request, reply) => {
    try {
    const { year, period } = request.query;

    let whereClause = "1=1 AND t.tender_status != 'Черновик'";
    const params = [];
    let idx = 1;

    if (year) {
      whereClause += ` AND EXTRACT(YEAR FROM t.created_at) = $${idx}`;
      params.push(parseInt(year));
      idx++;
    }
    if (period) {
      whereClause += ` AND t.period = $${idx}`;
      params.push(period);
      idx++;
    }

    // KPI по каждому тендерному специалисту
    const teamKpi = await db.query(`
      SELECT
        u.id,
        u.name,
        u.role,
        COUNT(t.id) as total_tenders,
        COUNT(t.id) FILTER (WHERE t.tender_status IN ('Выиграли', 'Контракт', 'Клиент согласился')) as won,
        COUNT(t.id) FILTER (WHERE t.tender_status IN ('Проиграли', 'Отказ', 'Клиент отказался')) as lost,
        COUNT(t.id) FILTER (WHERE t.tender_status NOT IN ('Выиграли', 'Контракт', 'Клиент согласился', 'Проиграли', 'Отказ', 'Клиент отказался', 'Отменён', 'Другое')) as active,
        COALESCE(SUM(t.tender_price) FILTER (WHERE t.tender_status IN ('Выиграли', 'Контракт', 'Клиент согласился')), 0) as won_sum,
        COALESCE(SUM(t.tender_price), 0) as total_sum,
        COUNT(DISTINCT t.customer_inn) as unique_customers,
        MAX(t.created_at) as last_tender_at
      FROM users u
      LEFT JOIN tenders t ON (COALESCE(t.created_by, t.assigned_by_user_id, t.created_by_user_id) = u.id) AND ${whereClause}
      WHERE u.role IN ('TO', 'HEAD_TO') AND u.is_active = true
      GROUP BY u.id, u.name, u.role
      ORDER BY won_sum DESC
    `, params);

    // Общая сводка отдела
    const deptTotal = await db.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE tender_status IN ('Выиграли', 'Контракт', 'Клиент согласился')) as won,
        COUNT(*) FILTER (WHERE tender_status IN ('Проиграли', 'Отказ', 'Клиент отказался')) as lost,
        COALESCE(SUM(tender_price) FILTER (WHERE tender_status IN ('Выиграли', 'Контракт', 'Клиент согласился')), 0) as won_sum,
        COALESCE(SUM(tender_price), 0) as total_sum
      FROM tenders
      WHERE ${whereClause.replace(/t\./g, '')}
    `, params);

    // По статусам
    const byStatus = await db.query(`
      SELECT tender_status, COUNT(*) as count, COALESCE(SUM(tender_price), 0) as sum
      FROM tenders WHERE ${whereClause.replace(/t\./g, '')}
      GROUP BY tender_status ORDER BY count DESC
    `, params);

    // По месяцам (динамика за последние 12 мес)
    const byMonth = await db.query(`
      SELECT
        TO_CHAR(created_at, 'YYYY-MM') as month,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE tender_status IN ('Выиграли', 'Контракт', 'Клиент согласился')) as won,
        COALESCE(SUM(tender_price) FILTER (WHERE tender_status IN ('Выиграли', 'Контракт', 'Клиент согласился')), 0) as won_sum
      FROM tenders
      WHERE created_at >= NOW() - INTERVAL '12 months' AND tender_status != 'Черновик'
      GROUP BY TO_CHAR(created_at, 'YYYY-MM')
      ORDER BY month
    `);

    return {
      team: teamKpi.rows,
      department: deptTotal.rows[0],
      byStatus: byStatus.rows,
      byMonth: byMonth.rows
    };
    } catch (err) {
      request.log.error(err, 'tenders analytics/team error');
      return reply.code(500).send({ error: 'Analytics error', details: err.message });
    }
  });

  // POST /api/tenders/:id/analyze - AI analysis of tender documents
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.post('/:id/analyze', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    try {
      const tender = (await db.query('SELECT * FROM tenders WHERE id = $1', [id])).rows[0];
      if (!tender) return reply.code(404).send({ error: 'Тендер не найден' });

      // Gather all documents text
      const docs = (await db.query(
        'SELECT original_name, filename, mime_type FROM documents WHERE tender_id = $1',
        [id]
      )).rows;

      const aiAnalyzer = require('../services/ai-email-analyzer');
      const bodyParts = [
        'Заказчик: ' + (tender.customer_name || 'не указан'),
        'Тип: ' + (tender.tender_type || 'не указан'),
        'Комментарий ТО: ' + (tender.comment_to || ''),
        'Описание: ' + (tender.tender_description || ''),
        'Документы: ' + docs.map(d => d.original_name).join(', ')
      ];
      const aiReport = await aiAnalyzer.generateReport({
        emailId: null,
        subject: tender.tender_title || 'Тендер #' + id,
        bodyText: bodyParts.join(String.fromCharCode(10)),

        fromEmail: '',
        fromName: tender.customer_name || '',
        attachmentNames: docs.map(d => d.original_name)
      });

      if (aiReport) {
        await db.query('UPDATE tenders SET ai_report = $1, updated_at = NOW() WHERE id = $2', [aiReport, id]);
        return { success: true, ai_report: aiReport };
      }
      return reply.code(500).send({ error: 'AI не смог сгенерировать отчёт' });
    } catch (err) {
      request.log.error(err, 'tender analyze error');
      return reply.code(500).send({ error: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/tenders/:id/calc-cost - AI cost estimation
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.post('/:id/calc-cost', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    try {
      const tender = (await db.query('SELECT * FROM tenders WHERE id = $1', [id])).rows[0];
      if (!tender) return reply.code(404).send({ error: 'Тендер не найден' });

      // Load AI provider and cost estimation prompt
      const aiProvider = require('../services/ai-provider');
      const { COST_ESTIMATION_PROMPT } = require('../prompts/cost-estimation-prompt');

      // Gather tender info and documents
      const docs = (await db.query(
        'SELECT original_name, filename, mime_type FROM documents WHERE tender_id = $1',
        [id]
      )).rows;

      const tenderInfo = [
        'Тендер: ' + (tender.tender_title || 'Без названия'),
        'Заказчик: ' + (tender.customer_name || 'не указан'),
        'Тип работ: ' + (tender.tender_type || 'не указан'),
        'Описание: ' + (tender.tender_description || ''),
        'Комментарий ТО: ' + (tender.comment_to || ''),
        'AI отчёт: ' + (tender.ai_report || 'Нет отчёта'),
        'Документы: ' + docs.map(d => d.original_name).join(', ')
      ].join('\n');

      const userMessage = 'Рассчитай себестоимость для следующего тендера/заявки:\n\n' + tenderInfo;

      const response = await aiProvider.complete({
        system: COST_ESTIMATION_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        maxTokens: 4096,
        temperature: 0.2
      });

      if (!response.text) {
        return reply.code(500).send({ error: 'AI не вернул ответ' });
      }

      // Parse JSON from AI response
      let costData;
      try {
        // Extract JSON from response (handle markdown code blocks)
        let jsonStr = response.text.trim();
        const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) jsonStr = jsonMatch[1].trim();
        costData = JSON.parse(jsonStr);
      } catch (parseErr) {
        request.log.warn({ text: response.text }, 'Failed to parse AI cost JSON');
        // Save raw text as report even if JSON parse fails
        await db.query(
          'UPDATE tenders SET ai_cost_report = $1, updated_at = NOW() WHERE id = $2',
          [response.text, id]
        );
        return { success: true, ai_cost_report: response.text, parse_error: true };
      }

      // Save parsed results
      const totalCost = costData.total_cost || 0;
      await db.query(
        'UPDATE tenders SET ai_cost_estimate = $1, ai_cost_report = $2, updated_at = NOW() WHERE id = $3',
        [totalCost, JSON.stringify(costData), id]
      );

      return { success: true, ai_cost_estimate: totalCost, ai_cost_report: costData };
    } catch (err) {
      request.log.error(err, 'tender calc-cost error');
      return reply.code(500).send({ error: err.message });
    }
  });
}


  // ─────────────────────────────────────────────────────────────────────────────
  
module.exports = routes;