/**
 * Calendar Routes
 */

// SECURITY: Allowlist of columns for calendar_events
const ALLOWED_COLS = new Set([
  'title', 'description', 'date', 'time', 'end_date', 'end_time',
  'type', 'color', 'reminder_minutes', 'reminder_sent', 'participants',
  'location', 'tender_id', 'work_id', 'is_all_day', 'recurrence',
  'created_by', 'created_at', 'updated_at'
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
    sql += ` ORDER BY date ASC, time ASC LIMIT $${idx}`;
    params.push(limit);
    const result = await db.query(sql, params);
    return { events: result.rows };
  });

  // SECURITY: IDOR fix — check ownership
  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const result = await db.query(
      'SELECT * FROM calendar_events WHERE id = $1 AND created_by = $2',
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
      const data = filterData({ ...body, created_by: request.user.id, created_at: new Date().toISOString() });
      const keys = Object.keys(data);
      if (!keys.length) return reply.code(400).send({ error: 'Нет данных' });
      const values = Object.values(data);
      const sql = `INSERT INTO calendar_events (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`;
      const result = await db.query(sql, values);
      return { event: result.rows[0] };
    } catch (err) {
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
    const sql = `UPDATE calendar_events SET ${updates.join(', ')} WHERE id = $${idx} AND created_by = $${idx + 1} RETURNING *`;
    const result = await db.query(sql, values);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    return { event: result.rows[0] };
  });

  // SECURITY: IDOR fix — check ownership
  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const result = await db.query(
      'DELETE FROM calendar_events WHERE id = $1 AND created_by = $2 RETURNING id',
      [request.params.id, request.user.id]
    );
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
