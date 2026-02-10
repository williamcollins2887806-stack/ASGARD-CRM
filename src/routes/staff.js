/**
 * Staff Routes (employees, schedule, rating)
 */

// SECURITY: Allowlist of columns
const EMPLOYEE_COLS = new Set([
  'fio', 'role_tag', 'phone', 'email', 'passport', 'inn', 'snils',
  'bank_account', 'bank_name', 'address', 'birth_date', 'employment_date',
  'dismissal_date', 'position', 'department', 'salary', 'is_active',
  'notes', 'photo_url', 'rating_avg', 'created_at', 'updated_at'
]);
const REVIEW_COLS = new Set([
  'employee_id', 'rating', 'comment', 'work_id', 'pm_id', 'created_at'
]);
const SCHEDULE_COLS = new Set([
  'employee_id', 'date', 'work_id', 'object_name', 'shift_type',
  'hours', 'notes', 'status', 'created_at'
]);

function filterData(data, allowedSet) {
  const filtered = {};
  for (const [k, v] of Object.entries(data)) {
    if (allowedSet.has(k) && v !== undefined) filtered[k] = v;
  }
  return filtered;
}

async function routes(fastify, options) {
  const db = fastify.db;

  // Employees
  fastify.get('/employees', { preHandler: [fastify.authenticate] }, async (request) => {
    const { role_tag, search, limit = 100, offset = 0 } = request.query;
    let sql = 'SELECT * FROM employees WHERE 1=1';
    const params = [];
    let idx = 1;
    if (role_tag) { sql += ` AND role_tag = $${idx}`; params.push(role_tag); idx++; }
    if (search) { sql += ` AND LOWER(fio) LIKE $${idx}`; params.push(`%${search.toLowerCase()}%`); idx++; }
    sql += ` ORDER BY fio ASC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);
    const result = await db.query(sql, params);
    return { employees: result.rows };
  });

  fastify.get('/employees/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const result = await db.query('SELECT * FROM employees WHERE id = $1', [request.params.id]);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Сотрудник не найден' });
    const reviews = await db.query('SELECT * FROM employee_reviews WHERE employee_id = $1 ORDER BY created_at DESC LIMIT 10', [request.params.id]);
    return { employee: result.rows[0], reviews: reviews.rows };
  });

  // SECURITY: SQL injection fix + B3 role check
  fastify.post('/employees', { preHandler: [fastify.requireRoles(['ADMIN', 'HR', 'HR_MANAGER', 'DIRECTOR_GEN'])] }, async (request, reply) => {
    const body = request.body || {};
    if (!body.fio || !String(body.fio).trim()) {
      return reply.code(400).send({ error: 'Обязательное поле: fio' });
    }
    const data = filterData({ ...body, created_at: new Date().toISOString() }, EMPLOYEE_COLS);
    const keys = Object.keys(data);
    const values = Object.values(data);
    const sql = `INSERT INTO employees (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`;
    const result = await db.query(sql, values);
    return { employee: result.rows[0] };
  });

  // SECURITY: SQL injection fix + B3 role check
  fastify.put('/employees/:id', { preHandler: [fastify.requireRoles(['ADMIN', 'HR', 'HR_MANAGER', 'DIRECTOR_GEN'])] }, async (request, reply) => {
    const { id } = request.params;
    const data = filterData(request.body, EMPLOYEE_COLS);
    const updates = [];
    const values = [];
    let idx = 1;
    for (const [key, value] of Object.entries(data)) {
      updates.push(`${key} = $${idx}`); values.push(value); idx++;
    }
    if (!updates.length) return reply.code(400).send({ error: 'Нет данных' });
    updates.push('updated_at = NOW()');
    values.push(id);
    const sql = `UPDATE employees SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`;
    const result = await db.query(sql, values);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найден' });
    return { employee: result.rows[0] };
  });

  // Employee reviews — SECURITY: SQL injection fix — filter keys
  fastify.post('/employees/:id/review', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const data = filterData({
        employee_id: id,
        ...request.body,
        pm_id: request.user.id,
        created_at: new Date().toISOString()
      }, REVIEW_COLS);
      const keys = Object.keys(data);
      const values = Object.values(data);
      const sql = `INSERT INTO employee_reviews (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`;
      const result = await db.query(sql, values);

      // Update average rating
      try {
        const avgResult = await db.query('SELECT AVG(rating) as avg FROM employee_reviews WHERE employee_id = $1', [id]);
        await db.query('UPDATE employees SET rating_avg = $1, updated_at = NOW() WHERE id = $2', [avgResult.rows[0].avg, id]);
      } catch (avgErr) {
        fastify.log.warn('Rating avg update failed:', avgErr.message);
      }

      return { review: result.rows[0] };
    } catch (err) {
      return reply.code(500).send({ error: 'Ошибка создания отзыва', detail: err.message });
    }
  });

  // Schedule
  fastify.get('/schedule', { preHandler: [fastify.authenticate] }, async (request) => {
    const { employee_id, date_from, date_to } = request.query;
    let sql = 'SELECT p.*, e.fio FROM employee_plan p LEFT JOIN employees e ON p.employee_id = e.id WHERE 1=1';
    const params = [];
    let idx = 1;
    if (employee_id) { sql += ` AND p.employee_id = $${idx}`; params.push(employee_id); idx++; }
    if (date_from) { sql += ` AND p.date >= $${idx}`; params.push(date_from); idx++; }
    if (date_to) { sql += ` AND p.date <= $${idx}`; params.push(date_to); idx++; }
    sql += ' ORDER BY p.date ASC';
    const result = await db.query(sql, params);
    return { schedule: result.rows };
  });

  // SECURITY: SQL injection fix — filter keys
  fastify.post('/schedule', { preHandler: [fastify.authenticate] }, async (request) => {
    const data = filterData({ ...request.body, created_at: new Date().toISOString() }, SCHEDULE_COLS);
    const keys = Object.keys(data);
    const values = Object.values(data);
    const sql = `INSERT INTO employee_plan (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`;
    const result = await db.query(sql, values);
    return { plan: result.rows[0] };
  });

  // SECURITY: SQL injection fix — filter keys
  fastify.put('/schedule/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const data = filterData(request.body, SCHEDULE_COLS);
    const updates = [];
    const values = [];
    let idx = 1;
    for (const [key, value] of Object.entries(data)) {
      updates.push(`${key} = $${idx}`); values.push(value); idx++;
    }
    if (!updates.length) return reply.code(400).send({ error: 'Нет данных' });
    values.push(id);
    const sql = `UPDATE employee_plan SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`;
    const result = await db.query(sql, values);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    return { plan: result.rows[0] };
  });
}

module.exports = routes;
