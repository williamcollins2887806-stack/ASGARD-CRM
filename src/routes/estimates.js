/**
 * Estimates Routes
 */

// SECURITY: Allowlist of columns for estimates
const ALLOWED_COLS = new Set([
  'tender_id', 'pm_id', 'title', 'description', 'approval_status',
  'amount', 'cost', 'margin', 'notes', 'customer', 'object_name',
  'work_type', 'priority', 'deadline', 'created_by', 'created_at', 'updated_at'
]);

function filterData(data) {
  const filtered = {};
  for (const [k, v] of Object.entries(data)) {
    if (ALLOWED_COLS.has(k) && v !== undefined) filtered[k] = v;
  }
  return filtered;
}

async function routes(fastify, options) {
  const db = fastify.db;

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tender_id, pm_id, status, limit = 100, offset = 0 } = request.query;
    let sql = 'SELECT e.*, t.customer, u.name as pm_name FROM estimates e LEFT JOIN tenders t ON e.tender_id = t.id LEFT JOIN users u ON e.pm_id = u.id WHERE 1=1';
    const params = [];
    let idx = 1;
    if (tender_id) { sql += ` AND e.tender_id = $${idx}`; params.push(tender_id); idx++; }
    if (pm_id) { sql += ` AND e.pm_id = $${idx}`; params.push(pm_id); idx++; }
    if (status) { sql += ` AND e.approval_status = $${idx}`; params.push(status); idx++; }
    sql += ` ORDER BY e.id DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);
    const result = await db.query(sql, params);
    return { estimates: result.rows };
  });

  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const result = await db.query('SELECT * FROM estimates WHERE id = $1', [request.params.id]);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Расчёт не найден' });
    return { estimate: result.rows[0] };
  });

  // SECURITY: SQL injection fix + B3 role check
  fastify.post('/', { preHandler: [fastify.requireRoles(['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN'])] }, async (request, reply) => {
    try {
      const body = request.body || {};
      if (!body.title) {
        return reply.code(400).send({ error: 'Обязательное поле: title' });
      }
      const data = filterData({ ...body, created_by: request.user.id, created_at: new Date().toISOString() });
      const keys = Object.keys(data);
      if (!keys.length) return reply.code(400).send({ error: 'Нет данных' });
      const values = Object.values(data);
      const sql = `INSERT INTO estimates (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`;
      const result = await db.query(sql, values);
      return { estimate: result.rows[0] };
    } catch (err) {
      if (err.code === '22003') return reply.code(400).send({ error: 'Числовое значение вне допустимого диапазона (numeric field overflow)' });
      if (err.code === '23503') return reply.code(400).send({ error: 'Связанная запись не найдена (FK violation)' });
      if (err.code === '23505') return reply.code(409).send({ error: 'Запись уже существует' });
      return reply.code(500).send({ error: 'Ошибка создания расчёта' });
    }
  });

  // SECURITY: SQL injection fix + B3 role check
  fastify.put('/:id', { preHandler: [fastify.requireRoles(['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN'])] }, async (request, reply) => {
    const { id } = request.params;
    const data = filterData(request.body);
    const updates = [];
    const values = [];
    let idx = 1;
    for (const [key, value] of Object.entries(data)) {
      updates.push(`${key} = $${idx}`); values.push(value); idx++;
    }
    if (!updates.length) return reply.code(400).send({ error: 'Нет данных' });
    updates.push('updated_at = NOW()');
    values.push(id);
    const sql = `UPDATE estimates SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`;
    const result = await db.query(sql, values);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найден' });
    return { estimate: result.rows[0] };
  });

  fastify.delete('/:id', { preHandler: [fastify.requireRoles(['ADMIN'])] }, async (request, reply) => {
    const result = await db.query('DELETE FROM estimates WHERE id = $1 RETURNING id', [request.params.id]);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найден' });
    return { message: 'Удалено' };
  });
}

module.exports = routes;
