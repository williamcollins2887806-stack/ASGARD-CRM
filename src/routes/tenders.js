/**
 * Tenders Routes - CRUD for tenders
 * ═══════════════════════════════════════════════════════════════════════════
 */

async function routes(fastify, options) {
  const db = fastify.db;

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
      search,
      limit = 100, 
      offset = 0 
    } = request.query;

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
        LOWER(t.customer) LIKE $${idx} OR 
        LOWER(t.tender_number) LIKE $${idx} OR 
        LOWER(t.tag) LIKE $${idx}
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
        LOWER(t.customer) LIKE $${countIdx} OR
        LOWER(t.tender_number) LIKE $${countIdx} OR
        LOWER(t.tag) LIKE $${countIdx}
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
             c.name as customer_name
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
  fastify.post('/', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['customer'],
        properties: {
          customer: { type: 'string' },
          customer_inn: { type: 'string' },
          tender_number: { type: 'string' },
          tender_type: { type: 'string' },
          tender_status: { type: 'string' },
          period: { type: 'string' },
          deadline: { type: 'string' },
          estimated_sum: { type: 'number' },
          responsible_pm_id: { type: 'number' },
          tag: { type: 'string' },
          docs_link: { type: 'string' },
          comment_to: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const data = request.body;
    data.created_by = request.user.id;
    data.created_at = new Date().toISOString();

    // Auto-generate period if not provided
    if (!data.period) {
      const now = new Date();
      data.period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    // Set default status
    if (!data.tender_status) {
      data.tender_status = 'Новый';
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
    await db.query(`
      INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, details, created_at)
      VALUES ($1, 'tender', $2, 'create', $3, NOW())
    `, [request.user.id, result.rows[0].id, JSON.stringify({ tender: result.rows[0] })]);

    return { tender: result.rows[0] };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PUT /api/tenders/:id - Update tender
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.put('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const data = request.body;

    // Get current tender
    const current = await db.query('SELECT * FROM tenders WHERE id = $1', [id]);
    if (!current.rows[0]) {
      return reply.code(404).send({ error: 'Тендер не найден' });
    }

    // Build update query
    const updates = [];
    const values = [];
    let idx = 1;

    const allowedFields = [
      'customer', 'customer_inn', 'tender_number', 'tender_type', 'tender_status',
      'period', 'deadline', 'estimated_sum', 'responsible_pm_id', 'tag',
      'docs_link', 'comment_to', 'comment_dir', 'reject_reason'
    ];

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updates.push(`${field} = $${idx}`);
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

    return { tender: result.rows[0] };
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
    const { period, year } = request.query;

    let whereClause = '1=1';
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
        COALESCE(SUM(estimated_sum), 0) as total_sum,
        COALESCE(SUM(estimated_sum) FILTER (WHERE tender_status IN ('Выиграли', 'Контракт')), 0) as won_sum
      FROM tenders
      WHERE ${whereClause}
    `, params);

    const byStatus = await db.query(`
      SELECT tender_status, COUNT(*) as count, COALESCE(SUM(estimated_sum), 0) as sum
      FROM tenders
      WHERE ${whereClause}
      GROUP BY tender_status
      ORDER BY count DESC
    `, params);

    return {
      summary: stats.rows[0],
      byStatus: byStatus.rows
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // M15: Аналитика тендерного отдела (для HEAD_TO)
  // ═══════════════════════════════════════════════════════════════

  fastify.get('/analytics/team', {
    preHandler: [fastify.requireRoles(['HEAD_TO', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'])]
  }, async (request, reply) => {
    const { year, period } = request.query;

    let whereClause = '1=1';
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
        COALESCE(SUM(t.estimated_sum) FILTER (WHERE t.tender_status IN ('Выиграли', 'Контракт', 'Клиент согласился')), 0) as won_sum,
        COALESCE(SUM(t.estimated_sum), 0) as total_sum,
        COUNT(DISTINCT t.customer_inn) as unique_customers,
        MAX(t.created_at) as last_tender_at
      FROM users u
      LEFT JOIN tenders t ON (t.created_by = u.id) AND ${whereClause.replace(/t\./g, '')}
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
        COALESCE(SUM(estimated_sum) FILTER (WHERE tender_status IN ('Выиграли', 'Контракт', 'Клиент согласился')), 0) as won_sum,
        COALESCE(SUM(estimated_sum), 0) as total_sum
      FROM tenders
      WHERE ${whereClause.replace(/t\./g, '')}
    `, params);

    // По статусам
    const byStatus = await db.query(`
      SELECT tender_status, COUNT(*) as count, COALESCE(SUM(estimated_sum), 0) as sum
      FROM tenders WHERE ${whereClause.replace(/t\./g, '')}
      GROUP BY tender_status ORDER BY count DESC
    `, params);

    // По месяцам (динамика за последние 12 мес)
    const byMonth = await db.query(`
      SELECT
        TO_CHAR(created_at, 'YYYY-MM') as month,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE tender_status IN ('Выиграли', 'Контракт', 'Клиент согласился')) as won,
        COALESCE(SUM(estimated_sum) FILTER (WHERE tender_status IN ('Выиграли', 'Контракт', 'Клиент согласился')), 0) as won_sum
      FROM tenders
      WHERE created_at >= NOW() - INTERVAL '12 months'
      GROUP BY TO_CHAR(created_at, 'YYYY-MM')
      ORDER BY month
    `);

    return {
      team: teamKpi.rows,
      department: deptTotal.rows[0],
      byStatus: byStatus.rows,
      byMonth: byMonth.rows
    };
  });
}

module.exports = routes;
