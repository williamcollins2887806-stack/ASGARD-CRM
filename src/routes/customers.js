/**
 * Customers Routes
 */
async function routes(fastify, options) {
  const db = fastify.db;

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { search, limit = 100, offset = 0 } = request.query;
    let sql = 'SELECT * FROM customers WHERE 1=1';
    const params = [];
    let idx = 1;
    if (search) {
      sql += ` AND (LOWER(name) LIKE $${idx} OR inn LIKE $${idx})`;
      params.push(`%${search.toLowerCase()}%`);
      idx++;
    }
    sql += ` ORDER BY name ASC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);
    const result = await db.query(sql, params);
    return { customers: result.rows };
  });

  fastify.get('/:inn', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const result = await db.query('SELECT * FROM customers WHERE inn = $1', [request.params.inn]);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Контрагент не найден' });
    const tenders = await db.query('SELECT * FROM tenders WHERE customer_inn = $1 ORDER BY created_at DESC LIMIT 10', [request.params.inn]);
    return { customer: result.rows[0], tenders: tenders.rows };
  });

  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { inn, name, ...rest } = request.body;
    if (!inn || !name) return reply.code(400).send({ error: 'ИНН и наименование обязательны' });
    const existing = await db.query('SELECT inn FROM customers WHERE inn = $1', [inn]);
    if (existing.rows.length) return reply.code(409).send({ error: 'Контрагент с таким ИНН уже существует' });
    const data = { inn, name, ...rest, created_at: new Date().toISOString() };
    const keys = Object.keys(data);
    const values = Object.values(data);
    const sql = `INSERT INTO customers (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`;
    const result = await db.query(sql, values);
    return { customer: result.rows[0] };
  });

  fastify.put('/:inn', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { inn } = request.params;
    const data = request.body;
    const updates = [];
    const values = [];
    let idx = 1;
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && key !== 'inn') { updates.push(`${key} = $${idx}`); values.push(value); idx++; }
    }
    if (!updates.length) return reply.code(400).send({ error: 'Нет данных' });
    updates.push('updated_at = NOW()');
    values.push(inn);
    const sql = `UPDATE customers SET ${updates.join(', ')} WHERE inn = $${idx} RETURNING *`;
    const result = await db.query(sql, values);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найден' });
    return { customer: result.rows[0] };
  });

  fastify.delete('/:inn', { preHandler: [fastify.requireRoles(['ADMIN'])] }, async (request, reply) => {
    const result = await db.query('DELETE FROM customers WHERE inn = $1 RETURNING inn', [request.params.inn]);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найден' });
    return { message: 'Удалено' };
  });
}

module.exports = routes;
