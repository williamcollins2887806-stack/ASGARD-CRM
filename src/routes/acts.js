/**
 * ASGARD CRM - Acts Routes
 * Акты выполненных работ
 */

async function actsRoutes(fastify, options) {
  const db = fastify.db;
  
  // Получить все акты
  fastify.get('/', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { work_id, customer_name, status, limit = 100 } = request.query;
    
    let sql = 'SELECT * FROM acts WHERE 1=1';
    const params = [];
    
    if (work_id) {
      params.push(work_id);
      sql += ` AND work_id = $${params.length}`;
    }
    
    if (customer_name) {
      params.push('%' + customer_name + '%');
      sql += ` AND customer_name ILIKE $${params.length}`;
    }
    
    if (status) {
      params.push(status);
      sql += ` AND status = $${params.length}`;
    }
    
    params.push(parseInt(limit));
    sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
    
    const result = await db.query(sql, params);
    return { success: true, acts: result.rows };
  });
  
  // Получить акт по ID
  fastify.get('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const result = await db.query('SELECT * FROM acts WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Акт не найден' });
    }
    
    return { success: true, act: result.rows[0] };
  });
  
  // Создать акт
  fastify.post('/', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const {
      act_number, act_date, status = 'draft',
      work_id, customer_name, customer_inn,
      description, amount, vat_pct = 20, total_amount,
      signed_date, paid_date
    } = request.body;
    
    const result = await db.query(`
      INSERT INTO acts (
        act_number, act_date, status, work_id,
        customer_name, customer_inn, description,
        amount, vat_pct, total_amount,
        signed_date, paid_date, created_by, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
      RETURNING *
    `, [
      act_number, act_date, status, work_id,
      customer_name, customer_inn, description,
      amount, vat_pct, total_amount,
      signed_date, paid_date, request.user?.id
    ]);
    
    return { success: true, act: result.rows[0] };
  });
  
  // Обновить акт
  fastify.put('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const {
      act_number, act_date, status,
      work_id, customer_name, customer_inn,
      description, amount, vat_pct, total_amount,
      signed_date, paid_date
    } = request.body;
    
    const result = await db.query(`
      UPDATE acts SET
        act_number = COALESCE($1, act_number),
        act_date = COALESCE($2, act_date),
        status = COALESCE($3, status),
        work_id = COALESCE($4, work_id),
        customer_name = COALESCE($5, customer_name),
        customer_inn = COALESCE($6, customer_inn),
        description = COALESCE($7, description),
        amount = COALESCE($8, amount),
        vat_pct = COALESCE($9, vat_pct),
        total_amount = COALESCE($10, total_amount),
        signed_date = $11,
        paid_date = $12,
        updated_at = NOW()
      WHERE id = $13
      RETURNING *
    `, [
      act_number, act_date, status, work_id,
      customer_name, customer_inn, description,
      amount, vat_pct, total_amount,
      signed_date, paid_date, id
    ]);
    
    if (result.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Акт не найден' });
    }
    
    return { success: true, act: result.rows[0] };
  });
  
  // Удалить акт
  fastify.delete('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    
    const result = await db.query('DELETE FROM acts WHERE id = $1 RETURNING id', [id]);
    
    if (result.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Акт не найден' });
    }
    
    return { success: true, deleted: true };
  });
  
  // Статистика
  fastify.get('/stats/summary', {
    preHandler: [fastify.authenticate]
  }, async () => {
    const result = await db.query(`
      SELECT 
        status,
        COUNT(*) as count,
        COALESCE(SUM(total_amount), 0) as total_sum
      FROM acts
      GROUP BY status
    `);
    
    return { success: true, stats: result.rows };
  });
}

module.exports = actsRoutes;
