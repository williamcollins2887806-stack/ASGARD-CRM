/**
 * Expenses Routes (work_expenses + office_expenses)
 */
async function routes(fastify, options) {
  const db = fastify.db;

  // Work expenses
  fastify.get('/work', { preHandler: [fastify.authenticate] }, async (request) => {
    const { work_id, category, date_from, date_to, limit = 100, offset = 0 } = request.query;
    let sql = 'SELECT e.*, w.work_number FROM work_expenses e LEFT JOIN works w ON e.work_id = w.id WHERE 1=1';
    const params = [];
    let idx = 1;
    if (work_id) { sql += ` AND e.work_id = $${idx}`; params.push(work_id); idx++; }
    if (category) { sql += ` AND e.category = $${idx}`; params.push(category); idx++; }
    if (date_from) { sql += ` AND e.date >= $${idx}`; params.push(date_from); idx++; }
    if (date_to) { sql += ` AND e.date <= $${idx}`; params.push(date_to); idx++; }
    sql += ` ORDER BY e.date DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);
    const result = await db.query(sql, params);
    return { expenses: result.rows };
  });

  fastify.post('/work', { preHandler: [fastify.authenticate] }, async (request) => {
    const data = { ...request.body, created_by: request.user.id, created_at: new Date().toISOString() };
    const keys = Object.keys(data);
    const values = Object.values(data);
    const sql = `INSERT INTO work_expenses (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`;
    const result = await db.query(sql, values);
    return { expense: result.rows[0] };
  });

  // Office expenses
  fastify.get('/office', { preHandler: [fastify.authenticate] }, async (request) => {
    const { category, status, date_from, date_to, limit = 100, offset = 0 } = request.query;
    let sql = 'SELECT * FROM office_expenses WHERE 1=1';
    const params = [];
    let idx = 1;
    if (category) { sql += ` AND category = $${idx}`; params.push(category); idx++; }
    if (status) { sql += ` AND status = $${idx}`; params.push(status); idx++; }
    if (date_from) { sql += ` AND date >= $${idx}`; params.push(date_from); idx++; }
    if (date_to) { sql += ` AND date <= $${idx}`; params.push(date_to); idx++; }
    sql += ` ORDER BY date DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);
    const result = await db.query(sql, params);
    return { expenses: result.rows };
  });

  fastify.post('/office', { preHandler: [fastify.authenticate] }, async (request) => {
    const data = { ...request.body, created_by: request.user.id, created_at: new Date().toISOString(), status: 'pending' };
    const keys = Object.keys(data);
    const values = Object.values(data);
    const sql = `INSERT INTO office_expenses (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`;
    const result = await db.query(sql, values);
    return { expense: result.rows[0] };
  });

  // Generic update/delete
  fastify.put('/:type/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { type, id } = request.params;
    const table = type === 'work' ? 'work_expenses' : 'office_expenses';
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
    const sql = `UPDATE ${table} SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`;
    const result = await db.query(sql, values);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найден' });
    return { expense: result.rows[0] };
  });

  fastify.delete('/:type/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { type, id } = request.params;
    const table = type === 'work' ? 'work_expenses' : 'office_expenses';
    const result = await db.query(`DELETE FROM ${table} WHERE id = $1 RETURNING id`, [id]);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найден' });
    return { message: 'Удалено' };
  });
}

module.exports = routes;
