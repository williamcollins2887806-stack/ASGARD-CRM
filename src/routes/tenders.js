/**
 * Tenders Routes - CRUD for tenders
 * ═══════════════════════════════════════════════════════════════════════════
 */

// State machine тендеров — допустимые переходы для обычных ролей
// ВНИМАНИЕ: статус 'Готово к отправке КП' выставляется автоматически после создания ТКП
// (см. src/routes/tkp.js POST /api/tkp). Вручную переходить в него нельзя.
const TENDER_TRANSITIONS = {
  'Черновик':              ['Новый', 'Не подходит'],
  'Новый':                 ['На анализе', 'Проиграли', 'Не подходит'],
  'На анализе':            ['Новый', 'Не подходит'],
  'Отправлено на просчёт': ['Согласование ТКП', 'Проиграли', 'Не подходит', 'Новый'],
  'Согласование ТКП':      ['ТКП согласовано', 'Отправлено на просчёт', 'Проиграли', 'Не подходит'],
  'ТКП согласовано':       ['Готово к отправке КП', 'Согласование ТКП', 'Проиграли', 'Не подходит'],
  'Готово к отправке КП':  ['КП отправлено', 'ТКП согласовано', 'Проиграли', 'Не подходит'],
  'КП отправлено':         ['Выиграли', 'Проиграли', 'Не подходит'],
  'Выиграли':              [],
  'Проиграли':             ['Новый'],
  'Не подходит':           ['Новый']
};

// Расширенные переходы для HEAD_TO (рук. тендерного отдела)
// HEAD_TO анализирует тендер и либо отправляет в просчёт, либо отсеивает
const HEAD_TO_TRANSITIONS = {
  'Черновик':              ['Новый', 'Не подходит', 'Проиграли'],
  'Новый':                 ['На анализе', 'Проиграли', 'Не подходит'],
  'На анализе':            ['Отправлено на просчёт', 'Новый', 'Не подходит'],
  'Отправлено на просчёт': ['Новый', 'Проиграли', 'Не подходит'],
  'Согласование ТКП':      ['Отправлено на просчёт', 'Проиграли', 'Не подходит'],
  'ТКП согласовано':       ['Согласование ТКП', 'Проиграли', 'Не подходит'],
  'Готово к отправке КП':  ['КП отправлено', 'ТКП согласовано', 'Проиграли', 'Не подходит'],
  'КП отправлено':         ['Выиграли', 'Проиграли', 'Не подходит'],
  'Выиграли':              [],
  'Проиграли':             ['Новый'],
  'Не подходит':           ['Новый']
};

const VALID_TENDER_STATUSES = [...Object.keys(TENDER_TRANSITIONS)];

// Роли которые могут двигать статусы в воронке
const FUNNEL_MOVE_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_TO'];

function isValidTenderTransition(fromStatus, toStatus, userRole) {
  if (userRole === 'ADMIN') return true;
  if (['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(userRole)) return true;
  if (!fromStatus) return true;
  // HEAD_TO использует расширенную матрицу
  if (userRole === 'HEAD_TO') {
    const allowed = HEAD_TO_TRANSITIONS[fromStatus];
    return allowed ? allowed.includes(toStatus) : false;
  }
  const allowed = TENDER_TRANSITIONS[fromStatus];
  if (!allowed) return true;
  return allowed.includes(toStatus);
}

// Категории отсева (для статуса "Не подходит")
const ARCHIVE_REASONS = [
  'Не наш профиль', 'Нет ресурсов', 'Срок истёк', 'Нерентабельно', 'Далеко',
  'Мало информации', 'Заказчик ненадёжный', 'Высокая конкуренция', 'Не прошли квалификацию',
  'Заказчик отменил', 'Дублирует другой тендер', 'Слишком малый объём',
  'Требуются допуски', 'Невыгодные условия', 'Другое'
];

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
  // GET /api/tenders/tags - List all tender tags
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.get('/tags', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const result = await db.query(
      'SELECT id, name FROM tender_tags ORDER BY sort_order, name'
    );
    return { tags: result.rows };
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
      // tender_price is a direct DB column, no mapping needed
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
        'tender_status', 'period', 'docs_deadline', 'tender_price', 'tender_price_with_vat', 'vat_pct',
        'submission_price', 'submission_price_with_vat',
        'responsible_pm_id', 'group_tag', 'tag_id', 'purchase_url', 'comment_to', 'comment_dir',
        'reject_reason', 'created_by', 'created_at'
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

    // State machine — проверка перехода статуса
    if (data.tender_status && data.tender_status !== oldTender.tender_status) {
      // Валидация что статус из допустимого списка
      if (!VALID_TENDER_STATUSES.includes(data.tender_status) && request.user.role !== 'ADMIN') {
        return reply.code(400).send({ error: `Недопустимый статус: "${data.tender_status}"` });
      }
      // Валидация перехода
      if (!isValidTenderTransition(oldTender.tender_status, data.tender_status, request.user.role)) {
        return reply.code(400).send({
          error: `Недопустимый переход статуса: "${oldTender.tender_status}" → "${data.tender_status}"`,
          allowed: TENDER_TRANSITIONS[oldTender.tender_status] || []
        });
      }
      // «Проиграли» требует причину
      if (data.tender_status === 'Проиграли' && !data.reject_reason && !oldTender.reject_reason) {
        return reply.code(400).send({ error: 'Для статуса «Проиграли» обязательна причина отказа' });
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
      'tender_price', 'tender_price_with_vat', 'vat_pct',
      'submission_price', 'submission_price_with_vat',
      'responsible_pm_id', 'tag', 'group_tag', 'tag_id',
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
        idx++;
      }

      const stats = await db.query(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE tender_status = 'Выиграли') as won,
          COUNT(*) FILTER (WHERE tender_status = 'Проиграли') as lost,
          COUNT(*) FILTER (WHERE tender_status NOT IN ('Выиграли', 'Проиграли')) as active,
          COALESCE(SUM(tender_price), 0) as total_sum,
          COALESCE(SUM(tender_price) FILTER (WHERE tender_status = 'Выиграли'), 0) as won_sum
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
        COUNT(t.id) FILTER (WHERE t.tender_status = 'Выиграли') as won,
        COUNT(t.id) FILTER (WHERE t.tender_status = 'Проиграли') as lost,
        COUNT(t.id) FILTER (WHERE t.tender_status NOT IN ('Выиграли', 'Проиграли')) as active,
        COALESCE(SUM(t.tender_price) FILTER (WHERE t.tender_status = 'Выиграли'), 0) as won_sum,
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
        COUNT(*) FILTER (WHERE tender_status = 'Выиграли') as won,
        COUNT(*) FILTER (WHERE tender_status = 'Проиграли') as lost,
        COALESCE(SUM(tender_price) FILTER (WHERE tender_status = 'Выиграли'), 0) as won_sum,
        COALESCE(SUM(tender_price), 0) as total_sum
      FROM tenders t
      WHERE ${whereClause}
    `, params);

    // По статусам
    const byStatus = await db.query(`
      SELECT tender_status, COUNT(*) as count, COALESCE(SUM(tender_price), 0) as sum
      FROM tenders t WHERE ${whereClause}
      GROUP BY tender_status ORDER BY count DESC
    `, params);

    // По месяцам (динамика за последние 12 мес)
    const byMonth = await db.query(`
      SELECT
        TO_CHAR(created_at, 'YYYY-MM') as month,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE tender_status = 'Выиграли') as won,
        COALESCE(SUM(tender_price) FILTER (WHERE tender_status = 'Выиграли'), 0) as won_sum
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

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /api/tenders/:id/comments - Лента комментариев тендера
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.get('/:id/comments', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { id } = request.params;
    const result = await db.query(`
      SELECT tc.id, tc.text, tc.created_at,
             tc.user_id, u.name as user_name, u.role as user_role
      FROM tender_comments tc
      LEFT JOIN users u ON tc.user_id = u.id
      WHERE tc.tender_id = $1
      ORDER BY tc.created_at ASC
    `, [id]);
    return { comments: result.rows };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/tenders/:id/comments - Добавить комментарий
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.post('/:id/comments', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { text } = request.body || {};
    const user = request.user;

    if (!text || !text.trim()) {
      return reply.code(400).send({ error: 'Пустой комментарий' });
    }

    // Проверяем что тендер существует
    const tender = (await db.query('SELECT id, responsible_pm_id FROM tenders WHERE id = $1 AND archived_at IS NULL', [id])).rows[0];
    if (!tender) return reply.code(404).send({ error: 'Тендер не найден' });

    const result = await db.query(`
      INSERT INTO tender_comments (tender_id, user_id, text)
      VALUES ($1, $2, $3)
      RETURNING id, created_at
    `, [id, user.id, text.trim()]);

    const comment = result.rows[0];

    // SSE уведомление участникам
    try {
      if (tender.responsible_pm_id && tender.responsible_pm_id !== user.id) {
        sendToUser(tender.responsible_pm_id, 'tender_comment', {
          tender_id: Number(id), comment_id: comment.id,
          user_name: user.name, text: text.trim().slice(0, 100)
        });
      }
    } catch (_) {}

    return {
      id: comment.id,
      text: text.trim(),
      created_at: comment.created_at,
      user_id: user.id,
      user_name: user.name,
      user_role: user.role
    };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // DELETE /api/tenders/:id/comments/:commentId - Удалить свой комментарий (до 5 мин)
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.delete('/:id/comments/:commentId', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { commentId } = request.params;
    const user = request.user;

    const comment = (await db.query('SELECT * FROM tender_comments WHERE id = $1', [commentId])).rows[0];
    if (!comment) return reply.code(404).send({ error: 'Комментарий не найден' });

    // Можно удалить свой в течение 5 минут или если ADMIN
    const isOwn = comment.user_id === user.id;
    const age = Date.now() - new Date(comment.created_at).getTime();
    const withinLimit = age < 5 * 60 * 1000;

    if (!isOwn && user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Нельзя удалить чужой комментарий' });
    }
    if (isOwn && !withinLimit && user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Удаление доступно только в течение 5 минут' });
    }

    await db.query('DELETE FROM tender_comments WHERE id = $1', [commentId]);
    return { success: true };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // АРХИВ: POST /:id/archive — отсеять тендер (статус "Не подходит")
  // ═══════════════════════════════════════════════════════════════════════════
  const ARCHIVE_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_TO'];

  fastify.post('/:id/archive', {
    preHandler: [fastify.requireRoles(ARCHIVE_ROLES)]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const user = request.user;
    const { reason, comment } = request.body || {};

    if (!reason) return reply.code(400).send({ error: 'Укажите категорию отсева' });
    if (!comment || !comment.trim()) return reply.code(400).send({ error: 'Комментарий обязателен' });
    if (!ARCHIVE_REASONS.includes(reason)) return reply.code(400).send({ error: 'Недопустимая категория' });

    const { rows } = await db.query('SELECT id, tender_status FROM tenders WHERE id = $1', [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Тендер не найден' });
    if (rows[0].tender_status === 'Выиграли') return reply.code(400).send({ error: 'Нельзя отсеять выигранный тендер' });

    const oldStatus = rows[0].tender_status;
    await db.query(`
      UPDATE tenders SET
        tender_status = 'Не подходит', archived_at = NOW(), archived_by = $1,
        archive_reason = $2, archive_comment = $3, updated_at = NOW()
      WHERE id = $4
    `, [user.id, reason, comment.trim(), id]);

    await db.query(`
      INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, payload_json, created_at)
      VALUES ($1, 'tender', $2, 'archive', $3, NOW())
    `, [user.id, id, JSON.stringify({ from_status: oldStatus, to_status: 'Не подходит', reason, comment: comment.trim() })]);

    broadcast('tender:archived', { id, reason });
    return { success: true, status: 'Не подходит' };
  });

  // POST /:id/unarchive — вернуть из архива (Не подходит → Новый)
  fastify.post('/:id/unarchive', {
    preHandler: [fastify.requireRoles(ARCHIVE_ROLES)]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const user = request.user;
    const { comment } = request.body || {};

    if (!comment || !comment.trim()) return reply.code(400).send({ error: 'Укажите причину возврата' });

    const { rows } = await db.query('SELECT id, tender_status FROM tenders WHERE id = $1', [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Тендер не найден' });
    if (rows[0].tender_status !== 'Не подходит') return reply.code(400).send({ error: 'Тендер не в архиве' });

    await db.query(`
      UPDATE tenders SET tender_status = 'Новый', archived_at = NULL, archived_by = NULL,
        archive_reason = NULL, archive_comment = NULL, updated_at = NOW()
      WHERE id = $1
    `, [id]);

    await db.query(`
      INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, payload_json, created_at)
      VALUES ($1, 'tender', $2, 'unarchive', $3, NOW())
    `, [user.id, id, JSON.stringify({ comment: comment.trim() })]);

    broadcast('tender:unarchived', { id });
    return { success: true, status: 'Новый' };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // СМЕНА АВТОРА: PUT /:id/change-author
  // ═══════════════════════════════════════════════════════════════════════════
  fastify.put('/:id/change-author', {
    preHandler: [fastify.requireRoles(ARCHIVE_ROLES)]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const user = request.user;
    const { new_author_id, comment } = request.body || {};

    if (!new_author_id) return reply.code(400).send({ error: 'Укажите нового автора' });

    const { rows: [tender] } = await db.query('SELECT id, created_by_user_id, created_by FROM tenders WHERE id = $1', [id]);
    if (!tender) return reply.code(404).send({ error: 'Тендер не найден' });

    const { rows: [newAuthor] } = await db.query('SELECT id, name, role FROM users WHERE id = $1', [new_author_id]);
    if (!newAuthor) return reply.code(400).send({ error: 'Пользователь не найден' });

    const oldAuthorId = tender.created_by_user_id || tender.created_by;

    await db.query(`UPDATE tenders SET created_by_user_id = $1, created_by = $1, updated_at = NOW() WHERE id = $2`, [new_author_id, id]);

    // История смены автора
    await db.query(`
      INSERT INTO tender_author_history (tender_id, old_author_id, new_author_id, changed_by, comment, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
    `, [id, oldAuthorId, new_author_id, user.id, comment || null]);

    await db.query(`
      INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, payload_json, created_at)
      VALUES ($1, 'tender', $2, 'change_author', $3, NOW())
    `, [user.id, id, JSON.stringify({ old_author_id: oldAuthorId, new_author_id, new_author_name: newAuthor.name, comment })]);

    return { success: true, new_author: newAuthor.name };
  });

  // GET /:id/author-history — история смены авторов
  fastify.get('/:id/author-history', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { rows } = await db.query(`
      SELECT h.*,
        ou.name as old_author_name, ou.login as old_author_login,
        nu.name as new_author_name, nu.login as new_author_login,
        cu.name as changed_by_name
      FROM tender_author_history h
      LEFT JOIN users ou ON ou.id = h.old_author_id
      LEFT JOIN users nu ON nu.id = h.new_author_id
      LEFT JOIN users cu ON cu.id = h.changed_by
      WHERE h.tender_id = $1 ORDER BY h.created_at DESC
    `, [request.params.id]);
    return { history: rows };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /:id/send-to-pm — HEAD_TO отправляет тендер на просчёт РП
  // ═══════════════════════════════════════════════════════════════════════════
  fastify.post('/:id/send-to-pm', {
    preHandler: [fastify.requireRoles(['ADMIN', 'HEAD_TO'])]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const { pm_id } = request.body || {};
    const user = request.user;

    if (!pm_id) return reply.code(400).send({ error: 'Укажите ответственного РП' });

    const { rows: [tender] } = await db.query('SELECT * FROM tenders WHERE id = $1', [id]);
    if (!tender) return reply.code(404).send({ error: 'Тендер не найден' });
    if (tender.tender_status !== 'На анализе') {
      return reply.code(400).send({ error: `Тендер должен быть в статусе «На анализе», текущий: «${tender.tender_status}»` });
    }

    const { rows: [pm] } = await db.query('SELECT id, name, role FROM users WHERE id = $1 AND is_active = true', [pm_id]);
    if (!pm) return reply.code(400).send({ error: 'РП не найден или неактивен' });

    // Проверка лимита активных просчётов
    const appSettings = await db.query("SELECT value_json FROM settings WHERE key = 'app_settings'");
    let pmLimit = 0;
    try {
      const appS = typeof appSettings.rows[0]?.value_json === 'string'
        ? JSON.parse(appSettings.rows[0].value_json)
        : (appSettings.rows[0]?.value_json || {});
      pmLimit = Number(appS?.limits?.pm_active_calcs_limit ?? 0) || 0;
    } catch (_) {}

    if (pmLimit > 0) {
      const doneStatuses = ['Согласование ТКП', 'ТКП согласовано', 'Готово к отправке КП', 'Выиграли', 'Проиграли'];
      const { rows: [activeCount] } = await db.query(
        `SELECT COUNT(*) as cnt FROM tenders
         WHERE responsible_pm_id = $1 AND handoff_at IS NOT NULL
           AND tender_status NOT IN (${doneStatuses.map((_, i) => `$${i + 2}`).join(',')})
           AND id != $${doneStatuses.length + 2}`,
        [pm_id, ...doneStatuses, id]
      );
      if (parseInt(activeCount.cnt) >= pmLimit) {
        return reply.code(400).send({ error: `У РП «${pm.name}» уже ${activeCount.cnt}/${pmLimit} активных просчётов` });
      }
    }

    await db.query(`
      UPDATE tenders SET
        tender_status = 'Отправлено на просчёт',
        responsible_pm_id = $2,
        handoff_at = NOW(),
        handoff_by_user_id = $3,
        updated_at = NOW()
      WHERE id = $1
    `, [id, pm_id, user.id]);

    await db.query(`
      INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, payload_json, created_at)
      VALUES ($1, 'tender', $2, 'send_to_pm', $3, NOW())
    `, [user.id, id, JSON.stringify({ pm_id, pm_name: pm.name, from_status: 'На анализе' })]);

    createNotification(db, {
      user_id: pm_id,
      title: '📋 Тендер на просчёт',
      message: `${user.name || 'Рук. ТО'} назначил тендер: ${tender.customer_name || ''} — ${tender.tender_title || ''}`,
      type: 'tender',
      link: `#/pm-calcs`
    });

    broadcast('tender:updated', {
      id, customer_name: tender.customer_name || '',
      tender_status: 'Отправлено на просчёт',
      old_status: 'На анализе',
      responsible_pm_id: pm_id
    });

    const { rows: [updated] } = await db.query('SELECT * FROM tenders WHERE id = $1', [id]);
    return { success: true, tender: updated };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /:id/win — ТО/HEAD_TO/ADMIN отмечают «Выиграли» после «КП отправлено»
  // Работа НЕ создаётся сразу. Тендер появляется в win-assign panel у HEAD_TO
  // для назначения РП на выполнение работ (может быть другой РП).
  // ═══════════════════════════════════════════════════════════════════════════
  fastify.post('/:id/win', {
    preHandler: [fastify.requireRoles(['ADMIN', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'])]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const user = request.user;
    const { contract_value, win_comment } = request.body || {};

    const { rows: [tender] } = await db.query('SELECT * FROM tenders WHERE id = $1', [id]);
    if (!tender) return reply.code(404).send({ error: 'Тендер не найден' });
    if (tender.tender_status !== 'КП отправлено') {
      return reply.code(409).send({ error: `Перевод в «Выиграли» возможен только из статуса «КП отправлено», текущий: «${tender.tender_status}»` });
    }

    const finalPrice = (contract_value != null && contract_value !== '') ? Number(contract_value) : null;

    await db.query(`
      UPDATE tenders SET
        tender_status = 'Выиграли',
        won_at = NOW(),
        won_by_user_id = $2,
        tender_price = COALESCE($3, tender_price),
        updated_at = NOW()
      WHERE id = $1
    `, [id, user.id, finalPrice]);

    await db.query(
      `INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, payload_json, created_at)
       VALUES ($1, 'tender', $2, 'win', $3, NOW())`,
      [user.id, id, JSON.stringify({ from_status: 'КП отправлено', contract_value: finalPrice, comment: win_comment || null })]
    );

    // Уведомить HEAD_TO/директоров — назначить РП на работы
    const { rows: heads } = await db.query(
      "SELECT id FROM users WHERE role IN ('HEAD_TO','ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV') AND is_active = true"
    );
    for (const h of heads) {
      createNotification(db, {
        user_id: h.id,
        title: '🏆 Выиграли тендер — назначьте РП на работы',
        message: `${tender.customer_name || ''} — ${tender.tender_title || ''}${finalPrice ? ' · ' + finalPrice.toLocaleString('ru-RU') + ' ₽' : ''}`,
        type: 'tender',
        link: `#/tenders?id=${id}`
      });
    }

    broadcast('tender:updated', { id, tender_status: 'Выиграли', old_status: 'КП отправлено' });

    const { rows: [updated] } = await db.query('SELECT * FROM tenders WHERE id = $1', [id]);
    return { success: true, tender: updated };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /:id/lose — Проиграли. Требует reason (категория) + cover_letter
  // ═══════════════════════════════════════════════════════════════════════════
  fastify.post('/:id/lose', {
    preHandler: [fastify.requireRoles(['ADMIN', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'])]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const user = request.user;
    const { reject_reason, cover_letter, winner_name } = request.body || {};

    if (!reject_reason || !String(reject_reason).trim()) {
      return reply.code(400).send({ error: 'Укажите причину проигрыша' });
    }
    if (!cover_letter || !String(cover_letter).trim()) {
      return reply.code(400).send({ error: 'Заполните сопроводительное письмо (анализ для команды)' });
    }

    const { rows: [tender] } = await db.query('SELECT * FROM tenders WHERE id = $1', [id]);
    if (!tender) return reply.code(404).send({ error: 'Тендер не найден' });
    if (tender.tender_status === 'Выиграли' || tender.tender_status === 'Проиграли' || tender.tender_status === 'Не подходит') {
      return reply.code(409).send({ error: `Тендер уже в финальном статусе: «${tender.tender_status}»` });
    }
    if (tender.work_assigned_at) {
      return reply.code(409).send({ error: 'Работа по тендеру уже назначена — финальный статус изменять нельзя' });
    }

    await db.query(`
      UPDATE tenders SET
        tender_status = 'Проиграли',
        reject_reason = $2,
        lose_cover_letter = $3,
        winner_name = $4,
        lost_at = NOW(),
        lost_by_user_id = $5,
        updated_at = NOW()
      WHERE id = $1
    `, [id, String(reject_reason).trim(), String(cover_letter).trim(), winner_name || null, user.id]);

    await db.query(
      `INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, payload_json, created_at)
       VALUES ($1, 'tender', $2, 'lose', $3, NOW())`,
      [user.id, id, JSON.stringify({ from_status: tender.tender_status, reason: reject_reason, winner: winner_name || null })]
    );

    broadcast('tender:updated', { id, tender_status: 'Проиграли', old_status: tender.tender_status });
    const { rows: [updated] } = await db.query('SELECT * FROM tenders WHERE id = $1', [id]);
    return { success: true, tender: updated };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /:id/cancel — «Тендер отменён» (заказчиком). Только причина.
  // На бэке это статус «Не подходит» с пометкой cancel.
  // ═══════════════════════════════════════════════════════════════════════════
  fastify.post('/:id/cancel', {
    preHandler: [fastify.requireRoles(['ADMIN', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'])]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const user = request.user;
    const { cancel_reason } = request.body || {};

    if (!cancel_reason || !String(cancel_reason).trim()) {
      return reply.code(400).send({ error: 'Укажите причину отмены' });
    }

    const { rows: [tender] } = await db.query('SELECT * FROM tenders WHERE id = $1', [id]);
    if (!tender) return reply.code(404).send({ error: 'Тендер не найден' });
    if (tender.work_assigned_at) {
      return reply.code(409).send({ error: 'Работа по тендеру уже назначена — отменить нельзя' });
    }

    await db.query(`
      UPDATE tenders SET
        tender_status = 'Не подходит',
        archive_reason = 'Заказчик отменил',
        archive_comment = $2,
        archived_at = NOW(),
        archived_by_user_id = $3,
        updated_at = NOW()
      WHERE id = $1
    `, [id, String(cancel_reason).trim(), user.id]);

    await db.query(
      `INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, payload_json, created_at)
       VALUES ($1, 'tender', $2, 'cancel', $3, NOW())`,
      [user.id, id, JSON.stringify({ from_status: tender.tender_status, reason: cancel_reason })]
    );

    broadcast('tender:updated', { id, tender_status: 'Не подходит', old_status: tender.tender_status });
    const { rows: [updated] } = await db.query('SELECT * FROM tenders WHERE id = $1', [id]);
    return { success: true, tender: updated };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /:id/assign-work-pm — HEAD_TO назначает РП для ВЫПОЛНЕНИЯ работ
  // (после статуса «Выиграли»). РП может быть тот же или другой.
  // Создаёт запись в works, тендер уходит из win-panel.
  // ═══════════════════════════════════════════════════════════════════════════
  fastify.post('/:id/assign-work-pm', {
    preHandler: [fastify.requireRoles(['ADMIN', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'])]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const user = request.user;
    const { pm_id, work_comment } = request.body || {};

    if (!pm_id) return reply.code(400).send({ error: 'Укажите РП для выполнения работ' });

    const { rows: [tender] } = await db.query('SELECT * FROM tenders WHERE id = $1', [id]);
    if (!tender) return reply.code(404).send({ error: 'Тендер не найден' });
    if (tender.tender_status !== 'Выиграли') {
      return reply.code(409).send({ error: 'Назначение РП на работы доступно только для выигранных тендеров' });
    }

    const { rows: [pm] } = await db.query('SELECT id, name FROM users WHERE id = $1 AND is_active = true', [pm_id]);
    if (!pm) return reply.code(400).send({ error: 'РП не найден или неактивен' });

    // Идемпотентность: если работа по этому тендеру уже создана — не дублировать
    const { rows: existing } = await db.query('SELECT id FROM works WHERE tender_id = $1', [id]);
    if (existing.length > 0) {
      return reply.code(409).send({ error: `Работа по этому тендеру уже создана (id=${existing[0].id})` });
    }

    // Подтянуть согласованный просчёт для cost_plan
    const { rows: [estimate] } = await db.query(
      `SELECT cost_plan, price_tkp FROM estimates
       WHERE tender_id = $1 AND approval_status = 'approved'
       ORDER BY current_version_no DESC NULLS LAST, id DESC LIMIT 1`,
      [id]
    );

    const contractValue = tender.submission_price || tender.tender_price || estimate?.price_tkp || null;
    const costPlan = estimate?.cost_plan || null;

    const { rows: [work] } = await db.query(`
      INSERT INTO works (
        tender_id, pm_id, customer_name, work_title, work_status,
        start_in_work_date, end_plan, contract_value, cost_plan, comment,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'Подготовка', $5, $6, $7, $8, $9, NOW(), NOW())
      RETURNING id
    `, [id, pm_id, tender.customer_name, tender.tender_title,
        tender.work_start_plan || null, tender.work_end_plan || null,
        contractValue, costPlan, work_comment || null]);

    // Фиксируем что работа назначена — для блокировки повторного назначения
    await db.query(`
      UPDATE tenders SET
        work_assigned_pm_id = $2,
        work_assigned_at = NOW(),
        work_assigned_by_user_id = $3,
        updated_at = NOW()
      WHERE id = $1
    `, [id, pm_id, user.id]);

    await db.query(
      `INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, payload_json, created_at)
       VALUES ($1, 'tender', $2, 'assign_work_pm', $3, NOW())`,
      [user.id, id, JSON.stringify({ work_id: work.id, work_pm_id: pm_id, calc_pm_id: tender.responsible_pm_id })]
    );

    createNotification(db, {
      user_id: pm_id,
      title: '🔨 Работа назначена',
      message: `Тендер выигран: ${tender.customer_name || ''} — ${tender.tender_title || ''}`,
      type: 'work',
      link: `#/pm-works`
    });

    broadcast('tender:updated', { id, work_assigned_pm_id: pm_id });
    return { success: true, work_id: work.id };
  });

  // GET /win-pending — тендеры со статусом «Выиграли» БЕЗ назначенной работы
  // Для нового winPanel у HEAD_TO
  fastify.get('/win-pending', { preHandler: [fastify.authenticate] }, async (request) => {
    const role = request.user.role;
    if (!['HEAD_TO','ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'].includes(role)) {
      return { items: [] };
    }
    const { rows } = await db.query(`
      SELECT t.*, u.name AS calc_pm_name
      FROM tenders t
      LEFT JOIN users u ON u.id = t.responsible_pm_id
      WHERE t.tender_status = 'Выиграли'
        AND NOT EXISTS (SELECT 1 FROM works w WHERE w.tender_id = t.id)
      ORDER BY t.won_at DESC NULLS LAST, t.id DESC
    `);
    return { items: rows };
  });

  // GET /archive-reasons — список категорий для фронтенда
  fastify.get('/archive-reasons', { preHandler: [fastify.authenticate] }, async () => {
    return { reasons: ARCHIVE_REASONS };
  });

  // GET /transition-map — разрешённые переходы для роли пользователя
  fastify.get('/transition-map', { preHandler: [fastify.authenticate] }, async (request) => {
    const role = request.user.role;
    if (role === 'ADMIN' || ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(role)) {
      return { transitions: TENDER_TRANSITIONS, can_move: true };
    }
    if (role === 'HEAD_TO') {
      return { transitions: HEAD_TO_TRANSITIONS, can_move: true };
    }
    return { transitions: {}, can_move: false };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // АРХИВЫ: upload → preview → confirm/cancel
  // ═══════════════════════════════════════════════════════════════════════════
  const archiveExtractor = require('../services/archiveExtractor');
  const fsLib = require('fs');
  const pathLib = require('path');
  const crypto = require('crypto');
  const { pipeline } = require('stream/promises');

  const TMP_BASE = pathLib.join(process.env.UPLOAD_DIR || './uploads', 'archive-tmp');
  fsLib.mkdirSync(TMP_BASE, { recursive: true });

  // Чистка старых tmp-сессий старше 2 часов — каждые 30 минут
  setInterval(() => {
    try {
      const now = Date.now();
      const dirs = fsLib.readdirSync(TMP_BASE);
      for (const d of dirs) {
        const full = pathLib.join(TMP_BASE, d);
        try {
          const stat = fsLib.statSync(full);
          if (now - stat.mtimeMs > 2 * 3600 * 1000) {
            fsLib.rmSync(full, { recursive: true, force: true });
          }
        } catch (_) {}
      }
    } catch (_) {}
  }, 30 * 60 * 1000).unref();

  // POST /:id/upload-archive — приём + распаковка во временную папку
  // Multipart: одно поле "archive"
  // Ответ: { session_id, files: [{relPath, size, type, isJunk}], totalSize, archiveType, archiveName, archiveSize }
  fastify.post('/:id/upload-archive', {
    preHandler: [fastify.requireRoles(['ADMIN', 'TO', 'HEAD_TO', 'PM', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'])]
  }, async (request, reply) => {
    const tenderId = parseInt(request.params.id);
    if (!Number.isFinite(tenderId)) return reply.code(400).send({ error: 'Некорректный ID тендера' });

    // Проверим что тендер существует и пользователь имеет к нему доступ
    const { rows: [tender] } = await db.query('SELECT id, tender_status, responsible_pm_id, work_assigned_at FROM tenders WHERE id = $1', [tenderId]);
    if (!tender) return reply.code(404).send({ error: 'Тендер не найден' });
    // После назначения работы ТО не может прикреплять документы
    if (tender.work_assigned_at && ['TO', 'HEAD_TO'].includes(request.user.role)) {
      return reply.code(403).send({ error: 'Работа уже назначена — управление перешло к РП' });
    }

    let mpData;
    try {
      mpData = await request.file();
    } catch (e) {
      return reply.code(400).send({ error: { code: 'NO_FILE', message: 'Файл не передан или превышен лимит размера', hint: 'Лимит — 200 МБ. Большие архивы разделите на части' } });
    }
    if (!mpData) return reply.code(400).send({ error: { code: 'NO_FILE', message: 'Файл не передан', hint: 'Перетащите архив в зону загрузки' } });

    const originalName = mpData.filename || 'archive';

    // Создаём сессию
    const sessionId = crypto.randomBytes(8).toString('hex');
    const sessionDir = pathLib.join(TMP_BASE, `${tenderId}_${sessionId}`);
    const archivePath = pathLib.join(sessionDir, 'src_' + originalName.replace(/[^\w\.\-]/g, '_'));
    const extractDir = pathLib.join(sessionDir, 'extracted');
    fsLib.mkdirSync(sessionDir, { recursive: true });

    // Сохраняем архив на диск (stream)
    try {
      await pipeline(mpData.file, fsLib.createWriteStream(archivePath));
    } catch (e) {
      try { fsLib.rmSync(sessionDir, { recursive: true, force: true }); } catch (_) {}
      return reply.code(400).send({ error: { code: 'UPLOAD_FAILED', message: 'Не удалось сохранить файл', hint: e.message.slice(0, 200) } });
    }

    if (mpData.file.truncated) {
      try { fsLib.rmSync(sessionDir, { recursive: true, force: true }); } catch (_) {}
      return reply.code(413).send({ error: { code: 'FILE_TOO_LARGE', message: 'Файл больше 200 МБ', hint: 'Разделите архив на несколько частей' } });
    }

    const archiveSize = fsLib.statSync(archivePath).size;

    // Проверка — это вообще архив?
    if (!archiveExtractor.isArchive(originalName, mpData.mimetype)) {
      try { fsLib.rmSync(sessionDir, { recursive: true, force: true }); } catch (_) {}
      return reply.code(400).send({ error: { code: 'NOT_ARCHIVE', message: 'Это не архив', hint: 'Поддерживаются ZIP, RAR, 7Z, TAR. Обычные файлы загружайте через «📎 Файл»' } });
    }

    // Распаковка
    const result = await archiveExtractor.extractArchive(archivePath, originalName, extractDir);
    if (!result.ok) {
      try { fsLib.rmSync(sessionDir, { recursive: true, force: true }); } catch (_) {}
      return reply.code(400).send({ error: result.error });
    }

    // Сохраняем оригинальное имя архива для confirm-фазы
    fsLib.writeFileSync(pathLib.join(sessionDir, 'meta.json'), JSON.stringify({
      tender_id: tenderId,
      user_id: request.user.id,
      archive_name: originalName,
      archive_size: archiveSize,
      archive_type: result.archiveType,
      created_at: new Date().toISOString()
    }), 'utf-8');

    // Список файлов с относительными путями (без absPath — небезопасно отдавать клиенту)
    const files = result.files.map((f, idx) => ({
      idx,
      relPath: f.relPath,
      size: f.size,
      type: f.type,
      isJunk: f.isJunk
    }));

    return {
      session_id: sessionId,
      archive_name: originalName,
      archive_size: archiveSize,
      archive_type: result.archiveType,
      files,
      total_size: result.totalSize
    };
  });

  // POST /:id/archive/:sessionId/confirm — подтверждение, переносим выбранные файлы в documents
  // body: { selected_indices: [0, 1, 5] | null (=все), include_archive_too: boolean }
  fastify.post('/:id/archive/:sessionId/confirm', {
    preHandler: [fastify.requireRoles(['ADMIN', 'TO', 'HEAD_TO', 'PM', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'])]
  }, async (request, reply) => {
    const tenderId = parseInt(request.params.id);
    const sessionId = String(request.params.sessionId || '').replace(/[^a-f0-9]/g, '');
    if (!sessionId) return reply.code(400).send({ error: 'Bad session id' });

    const sessionDir = pathLib.join(TMP_BASE, `${tenderId}_${sessionId}`);
    if (!fsLib.existsSync(sessionDir)) {
      return reply.code(404).send({ error: 'Сессия истекла или не найдена. Загрузите архив заново' });
    }

    let meta;
    try { meta = JSON.parse(fsLib.readFileSync(pathLib.join(sessionDir, 'meta.json'), 'utf-8')); }
    catch { return reply.code(500).send({ error: 'Сессия повреждена' }); }

    if (meta.tender_id !== tenderId) return reply.code(403).send({ error: 'Сессия не подходит к этому тендеру' });
    // Только автор сессии или ADMIN могут подтвердить
    if (Number(meta.user_id) !== Number(request.user.id) && request.user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Эту загрузку начал другой пользователь' });
    }

    const { selected_indices, include_archive_too } = request.body || {};
    const extractDir = pathLib.join(sessionDir, 'extracted');
    const allFiles = archiveExtractor.extractArchive
      ? require('fs').readdirSync(extractDir, { withFileTypes: true }).filter(()=>true) && null  /* noop, нам нужен полный список */
      : null;

    // Перечитываем список файлов из extracted/ (тот же порядок что в upload-ответе)
    const listFiles = (dir, base = dir) => {
      const out = [];
      for (const e of fsLib.readdirSync(dir, { withFileTypes: true })) {
        const abs = pathLib.join(dir, e.name);
        if (e.isDirectory()) out.push(...listFiles(abs, base));
        else if (e.isFile()) out.push(abs);
      }
      return out;
    };
    const absFiles = listFiles(extractDir);
    const selected = Array.isArray(selected_indices) && selected_indices.length > 0
      ? absFiles.filter((_, i) => selected_indices.includes(i))
      : absFiles;

    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    const tenderDir = pathLib.join(uploadDir, 'tender_archives', String(tenderId));
    fsLib.mkdirSync(tenderDir, { recursive: true });

    const inserted = [];
    for (const absFile of selected) {
      const relPath = pathLib.relative(extractDir, absFile).replace(/\\/g, '/');
      const originalName = pathLib.basename(absFile);
      const safeName = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${originalName.replace(/[^\w\.\-]/g, '_')}`;
      const targetPath = pathLib.join(tenderDir, safeName);
      try {
        fsLib.renameSync(absFile, targetPath);
      } catch (e) {
        // Если rename через partition не работает — copy+unlink
        try {
          fsLib.copyFileSync(absFile, targetPath);
          fsLib.unlinkSync(absFile);
        } catch (e2) {
          console.error('[archive confirm] move failed:', e2.message);
          continue;
        }
      }
      const size = fsLib.statSync(targetPath).size;
      const mimeType = guessMimeType(originalName);
      const downloadUrl = `/uploads/tender_archives/${tenderId}/${safeName}`;
      const { rows: [doc] } = await db.query(`
        INSERT INTO documents (filename, original_name, mime_type, size, type, tender_id, uploaded_by, download_url, created_at)
        VALUES ($1, $2, $3, $4, 'archive-extracted', $5, $6, $7, NOW())
        RETURNING id, original_name, download_url
      `, [safeName, originalName, mimeType, size, tenderId, request.user.id, downloadUrl]);
      inserted.push(doc);
    }

    // Опционально — сам исходный архив прикрепить тоже
    if (include_archive_too) {
      const srcArchive = fsLib.readdirSync(sessionDir).find(n => n.startsWith('src_'));
      if (srcArchive) {
        const safeName = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${meta.archive_name.replace(/[^\w\.\-]/g, '_')}`;
        const targetPath = pathLib.join(tenderDir, safeName);
        try {
          fsLib.renameSync(pathLib.join(sessionDir, srcArchive), targetPath);
          const size = fsLib.statSync(targetPath).size;
          const mime = guessMimeType(meta.archive_name);
          const downloadUrl = `/uploads/tender_archives/${tenderId}/${safeName}`;
          const { rows: [doc] } = await db.query(`
            INSERT INTO documents (filename, original_name, mime_type, size, type, tender_id, uploaded_by, download_url, created_at)
            VALUES ($1, $2, $3, $4, 'archive', $5, $6, $7, NOW())
            RETURNING id, original_name, download_url
          `, [safeName, meta.archive_name, mime, size, tenderId, request.user.id, downloadUrl]);
          inserted.push(doc);
        } catch (_) {}
      }
    }

    // Чистим сессию
    try { fsLib.rmSync(sessionDir, { recursive: true, force: true }); } catch (_) {}

    return { success: true, attached: inserted.length, documents: inserted };
  });

  // POST /:id/archive/:sessionId/cancel — отмена, удаляет tmp
  fastify.post('/:id/archive/:sessionId/cancel', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const tenderId = parseInt(request.params.id);
    const sessionId = String(request.params.sessionId || '').replace(/[^a-f0-9]/g, '');
    const sessionDir = pathLib.join(TMP_BASE, `${tenderId}_${sessionId}`);
    if (fsLib.existsSync(sessionDir)) {
      try { fsLib.rmSync(sessionDir, { recursive: true, force: true }); } catch (_) {}
    }
    return { success: true };
  });

  function guessMimeType(filename) {
    const lower = (filename || '').toLowerCase();
    if (lower.endsWith('.pdf')) return 'application/pdf';
    if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (lower.endsWith('.doc')) return 'application/msword';
    if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
    if (lower.endsWith('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.txt')) return 'text/plain';
    if (lower.endsWith('.zip')) return 'application/zip';
    if (lower.endsWith('.rar')) return 'application/vnd.rar';
    if (lower.endsWith('.7z')) return 'application/x-7z-compressed';
    return 'application/octet-stream';
  }
}

module.exports = routes;