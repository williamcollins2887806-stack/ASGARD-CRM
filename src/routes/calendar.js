/**
 * Calendar Routes
 */

// SECURITY: Allowlist of columns matching actual DB schema
const ALLOWED_COLS = new Set([
  'title', 'description', 'date', 'end_date',
  'user_id', 'type', 'created_at', 'updated_at'
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
    const { date_from, date_to, type, limit = 100 } = request.query;
    let sql = 'SELECT * FROM calendar_events WHERE 1=1';
    const params = [];
    let idx = 1;
    if (date_from) { sql += ` AND date >= $${idx}`; params.push(date_from); idx++; }
    if (date_to) { sql += ` AND date <= $${idx}`; params.push(date_to); idx++; }
    if (type) { sql += ` AND type = $${idx}`; params.push(type); idx++; }
    sql += ` ORDER BY date ASC LIMIT $${idx}`;
    params.push(limit);
    const result = await db.query(sql, params);
    return { events: result.rows };
  });

  // SECURITY: IDOR fix — check ownership
  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const result = await db.query(
      'SELECT * FROM calendar_events WHERE id = $1 AND user_id = $2',
      [request.params.id, request.user.id]
    );
    if (!result.rows[0]) return reply.code(404).send({ error: 'Событие не найдено' });
    return { event: result.rows[0] };
  });

  // SECURITY: SQL injection fix — filter keys; try/catch added
  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const body = request.body || {};
      if (!body.title || !body.date) {
        return reply.code(400).send({ error: 'Обязательные поля: title, date' });
      }
      if (isNaN(new Date(body.date).getTime())) {
        return reply.code(400).send({ error: 'Некорректный формат даты' });
      }
      const data = filterData({ ...body, user_id: request.user.id, created_at: new Date().toISOString() });
      const keys = Object.keys(data);
      if (!keys.length) return reply.code(400).send({ error: 'Нет данных' });
      const values = Object.values(data);
      const sql = `INSERT INTO calendar_events (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`;
      const result = await db.query(sql, values);
      return { event: result.rows[0] };
    } catch (err) {
      if (err.code === '22P02') return reply.code(400).send({ error: 'Некорректный формат данных (тип поля)' });
      if (err.code === '22003') return reply.code(400).send({ error: 'Числовое значение вне допустимого диапазона' });
      if (err.code === '23503') return reply.code(400).send({ error: 'Связанная запись не найдена' });
      fastify.log.error('Calendar POST error:', err);
      return reply.code(500).send({ error: 'Ошибка создания события' });
    }
  });

  // SECURITY: SQL injection + IDOR fix
  fastify.put('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
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
    values.push(id, request.user.id);
    const sql = `UPDATE calendar_events SET ${updates.join(', ')} WHERE id = $${idx} AND user_id = $${idx + 1} RETURNING *`;
    const result = await db.query(sql, values);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    return { event: result.rows[0] };
  });

  // SECURITY: IDOR fix — check ownership
  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const result = await db.query(
      'DELETE FROM calendar_events WHERE id = $1 AND user_id = $2 RETURNING id',
      [request.params.id, request.user.id]
    );
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    return { message: 'Удалено' };
  });

  // Check reminders — returns upcoming events for today
  fastify.get('/reminders/check', { preHandler: [fastify.authenticate] }, async (request) => {
    const result = await db.query(`
      SELECT * FROM calendar_events
      WHERE user_id = $1 AND date = CURRENT_DATE
      ORDER BY date ASC
    `, [request.user.id]);
    return { reminders: result.rows };
  });
}

module.exports = routes;
