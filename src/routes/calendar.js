/**
 * Calendar Routes
 */
async function routes(fastify, options) {
  const db = fastify.db;

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { date_from, date_to, type, limit = 100 } = request.query;
    let sql = 'SELECT * FROM calendar_events WHERE 1=1';
    const params = [];
    let idx = 1;
    if (date_from) { sql += ` AND date >= $${idx}`; params.push(date_from); idx++; }
    if (date_to) { sql += ` AND date <= $${idx}`; params.push(date_to); idx++; }
    if (type) { sql += ` AND type = $${idx}`; params.push(type); idx++; }
    sql += ` ORDER BY date ASC, time ASC LIMIT $${idx}`;
    params.push(limit);
    const result = await db.query(sql, params);
    return { events: result.rows };
  });

  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const result = await db.query('SELECT * FROM calendar_events WHERE id = $1', [request.params.id]);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Событие не найдено' });
    return { event: result.rows[0] };
  });

  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const data = { ...request.body, created_by: request.user.id, created_at: new Date().toISOString() };
    const keys = Object.keys(data);
    const values = Object.values(data);
    const sql = `INSERT INTO calendar_events (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`;
    const result = await db.query(sql, values);
    return { event: result.rows[0] };
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
    const sql = `UPDATE calendar_events SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`;
    const result = await db.query(sql, values);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    return { event: result.rows[0] };
  });

  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const result = await db.query('DELETE FROM calendar_events WHERE id = $1 RETURNING id', [request.params.id]);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    return { message: 'Удалено' };
  });

  // Check reminders
  fastify.get('/reminders/check', { preHandler: [fastify.authenticate] }, async (request) => {
    const now = new Date();
    const result = await db.query(`
      SELECT * FROM calendar_events 
      WHERE reminder_sent = false 
        AND reminder_minutes > 0
        AND (date || ' ' || COALESCE(time, '00:00'))::timestamp - (reminder_minutes || ' minutes')::interval <= $1
        AND (date || ' ' || COALESCE(time, '00:00'))::timestamp > $1
    `, [now.toISOString()]);
    return { reminders: result.rows };
  });
}

module.exports = routes;
