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

module.exports = routes;
