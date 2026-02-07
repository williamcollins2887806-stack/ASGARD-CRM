/**
 * Works Routes
 */
async function routes(fastify, options) {
  const db = fastify.db;

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tender_id, pm_id, status, limit = 100, offset = 0 } = request.query;
    let sql = 'SELECT w.*, t.customer_name as customer, u.name as pm_name FROM works w LEFT JOIN tenders t ON w.tender_id = t.id LEFT JOIN users u ON w.pm_id = u.id WHERE 1=1';
    const params = [];
    let idx = 1;
    if (tender_id) { sql += ` AND w.tender_id = $${idx}`; params.push(tender_id); idx++; }
    if (pm_id) { sql += ` AND w.pm_id = $${idx}`; params.push(pm_id); idx++; }
    if (status) { sql += ` AND w.work_status = $${idx}`; params.push(status); idx++; }
    sql += ` ORDER BY w.id DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);
    const result = await db.query(sql, params);
    return { works: result.rows };
  });

  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const result = await db.query('SELECT * FROM works WHERE id = $1', [request.params.id]);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Работа не найдена' });
    const expenses = await db.query('SELECT * FROM work_expenses WHERE work_id = $1', [request.params.id]);
    return { work: result.rows[0], expenses: expenses.rows };
  });

  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const data = { ...request.body, created_by: request.user.id, created_at: new Date().toISOString() };
    const keys = Object.keys(data);
    const values = Object.values(data);
    const sql = `INSERT INTO works (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`;
    const result = await db.query(sql, values);
    return { work: result.rows[0] };
  });

  fastify.put('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const data = request.body;
    const updates = [];
    const values = [];
    let idx = 1;
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) { updates.push(`${key} = $${idx}`); values.push(value); idx++; }
    }
    if (!updates.length) return reply.code(400).send({ error: 'Нет данных' });
    updates.push('updated_at = NOW()');
    values.push(id);
    const sql = `UPDATE works SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`;
    const result = await db.query(sql, values);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найдена' });
    return { work: result.rows[0] };
  });

  fastify.delete('/:id', { preHandler: [fastify.requireRoles(['ADMIN'])] }, async (request, reply) => {
    const result = await db.query('DELETE FROM works WHERE id = $1 RETURNING id', [request.params.id]);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найдена' });
    return { message: 'Удалено' };
  });
}

  // ═══════════════════════════════════════════════════════════════
  // M15: Аналитика РП (для HEAD_PM)
  // ═══════════════════════════════════════════════════════════════

  fastify.get('/analytics/team', {
    preHandler: [fastify.requireRoles(['HEAD_PM', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'])]
  }, async (request, reply) => {
    const { year } = request.query;

    let whereClause = '1=1';
    const params = [];
    let idx = 1;

    if (year) {
      whereClause += ` AND EXTRACT(YEAR FROM w.created_at) = $${idx}`;
      params.push(parseInt(year));
      idx++;
    }

    // KPI по каждому РП
    const teamKpi = await db.query(`
      SELECT
        u.id,
        u.name,
        u.role,
        u.employment_date,
        COUNT(w.id) as total_works,
        COUNT(w.id) FILTER (WHERE w.work_status IN ('В работе', 'Мобилизация', 'Подготовка')) as active,
        COUNT(w.id) FILTER (WHERE w.work_status = 'Работы сдали') as completed,
        COUNT(w.id) FILTER (WHERE w.end_plan < NOW() AND w.work_status NOT IN ('Работы сдали', 'Закрыт')) as overdue,
        COALESCE(SUM(w.contract_value), 0) as total_contract,
        COALESCE(SUM(w.cost_plan), 0) as total_cost_plan,
        COALESCE(SUM(w.cost_fact), 0) as total_cost_fact,
        COALESCE(SUM(w.contract_value) - SUM(COALESCE(w.cost_fact, w.cost_plan, 0)), 0) as profit,
        COUNT(DISTINCT e.id) as active_estimates
      FROM users u
      LEFT JOIN works w ON w.pm_id = u.id AND ${whereClause.replace(/w\./g, '')}
      LEFT JOIN estimates e ON e.pm_id = u.id AND e.approval_status NOT IN ('rejected', 'closed')
      WHERE u.role IN ('PM', 'HEAD_PM') AND u.is_active = true
      GROUP BY u.id, u.name, u.role, u.employment_date
      ORDER BY total_contract DESC
    `, params);

    // Общая сводка
    const deptTotal = await db.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE work_status IN ('В работе', 'Мобилизация', 'Подготовка')) as active,
        COUNT(*) FILTER (WHERE work_status = 'Работы сдали') as completed,
        COUNT(*) FILTER (WHERE end_plan < NOW() AND work_status NOT IN ('Работы сдали', 'Закрыт')) as overdue,
        COALESCE(SUM(contract_value), 0) as total_contract,
        COALESCE(SUM(contract_value) - SUM(COALESCE(cost_fact, cost_plan, 0)), 0) as total_profit
      FROM works w
      WHERE ${whereClause.replace(/w\./g, '')}
    `, params);

    // По месяцам
    const byMonth = await db.query(`
      SELECT
        TO_CHAR(w.created_at, 'YYYY-MM') as month,
        COUNT(*) as total,
        COALESCE(SUM(contract_value), 0) as contract_sum,
        COUNT(*) FILTER (WHERE work_status = 'Работы сдали') as completed
      FROM works w
      WHERE w.created_at >= NOW() - INTERVAL '12 months'
      GROUP BY TO_CHAR(w.created_at, 'YYYY-MM')
      ORDER BY month
    `);

    return {
      team: teamKpi.rows,
      department: deptTotal.rows[0],
      byMonth: byMonth.rows
    };
  });
}

module.exports = routes;
