/**
 * Incomes Routes
 */
async function routes(fastify, options) {
  const db = fastify.db;

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { work_id, type, date_from, date_to, limit = 100, offset = 0 } = request.query;
    let sql = 'SELECT i.*, w.work_number FROM incomes i LEFT JOIN works w ON i.work_id = w.id WHERE 1=1';
    const params = [];
    let idx = 1;
    if (work_id) { sql += ` AND i.work_id = $${idx}`; params.push(work_id); idx++; }
    if (type) { sql += ` AND i.type = $${idx}`; params.push(type); idx++; }
    if (date_from) { sql += ` AND i.date >= $${idx}`; params.push(date_from); idx++; }
    if (date_to) { sql += ` AND i.date <= $${idx}`; params.push(date_to); idx++; }
    sql += ` ORDER BY i.date DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);
    const result = await db.query(sql, params);
    return { incomes: result.rows };
  });

  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const data = { ...request.body, created_by: request.user.id, created_at: new Date().toISOString() };
    const keys = Object.keys(data);
    const values = Object.values(data);
    const sql = `INSERT INTO incomes (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`;
    const result = await db.query(sql, values);
    return { income: result.rows[0] };
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
    updates.push('updated_at = NOW()');
    values.push(id);
    const sql = `UPDATE incomes SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`;
    const result = await db.query(sql, values);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найден' });
    return { income: result.rows[0] };
  });

  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const result = await db.query('DELETE FROM incomes WHERE id = $1 RETURNING id', [request.params.id]);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найден' });
    return { message: 'Удалено' };
  });
}

module.exports = routes;
