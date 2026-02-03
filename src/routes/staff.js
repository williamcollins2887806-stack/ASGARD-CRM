/**
 * Staff Routes (employees, schedule, rating)
 */
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

  fastify.post('/employees', { preHandler: [fastify.authenticate] }, async (request) => {
    const data = { ...request.body, created_at: new Date().toISOString() };
    const keys = Object.keys(data);
    const values = Object.values(data);
    const sql = `INSERT INTO employees (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`;
    const result = await db.query(sql, values);
    return { employee: result.rows[0] };
  });

  fastify.put('/employees/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
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
    const sql = `UPDATE employees SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`;
    const result = await db.query(sql, values);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найден' });
    return { employee: result.rows[0] };
  });

  // Employee reviews
  fastify.post('/employees/:id/review', { preHandler: [fastify.authenticate] }, async (request) => {
    const { id } = request.params;
    const data = { 
      employee_id: id,
      ...request.body, 
      pm_id: request.user.id,
      created_at: new Date().toISOString() 
    };
    const keys = Object.keys(data);
    const values = Object.values(data);
    const sql = `INSERT INTO employee_reviews (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`;
    const result = await db.query(sql, values);
    
    // Update average rating
    const avgResult = await db.query('SELECT AVG(rating) as avg FROM employee_reviews WHERE employee_id = $1', [id]);
    await db.query('UPDATE employees SET rating_avg = $1, updated_at = NOW() WHERE id = $2', [avgResult.rows[0].avg, id]);
    
    return { review: result.rows[0] };
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

  fastify.post('/schedule', { preHandler: [fastify.authenticate] }, async (request) => {
    const data = { ...request.body, created_at: new Date().toISOString() };
    const keys = Object.keys(data);
    const values = Object.values(data);
    const sql = `INSERT INTO employee_plan (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`;
    const result = await db.query(sql, values);
    return { plan: result.rows[0] };
  });

  fastify.put('/schedule/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const data = request.body;
    const updates = [];
    const values = [];
    let idx = 1;
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) { updates.push(`${key} = $${idx}`); values.push(value); idx++; }
    }
    values.push(id);
    const sql = `UPDATE employee_plan SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`;
    const result = await db.query(sql, values);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    return { plan: result.rows[0] };
  });
}

module.exports = routes;
