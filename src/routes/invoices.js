/**
 * ASGARD CRM - Invoices Routes
 * Счета и оплаты
 */

async function invoicesRoutes(fastify, options) {
  const db = fastify.db;
  
  // Получить все счета
  fastify.get('/', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { work_id, customer_name, status, limit = 100 } = request.query;
    
    let sql = 'SELECT * FROM invoices WHERE 1=1';
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
    return { success: true, invoices: result.rows };
  });
  
  // Получить счёт по ID
  fastify.get('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const result = await db.query('SELECT * FROM invoices WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Счёт не найден' });
    }
    
    // Получаем платежи
    const payments = await db.query('SELECT * FROM invoice_payments WHERE invoice_id = $1 ORDER BY payment_date', [id]);
    
    return { 
      success: true, 
      invoice: result.rows[0],
      payments: payments.rows 
    };
  });
  
  // Создать счёт
  fastify.post('/', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const {
      invoice_number, invoice_date, invoice_type,
      status = 'draft', work_id, act_id,
      customer_name, customer_inn, description,
      amount, vat_pct = 20, total_amount,
      due_date, paid_amount = 0
    } = request.body;
    
    const result = await db.query(`
      INSERT INTO invoices (
        invoice_number, invoice_date, invoice_type,
        status, work_id, act_id,
        customer_name, customer_inn, description,
        amount, vat_pct, total_amount,
        due_date, paid_amount, created_by, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())
      RETURNING *
    `, [
      invoice_number, invoice_date, invoice_type,
      status, work_id, act_id,
      customer_name, customer_inn, description,
      amount, vat_pct, total_amount,
      due_date, paid_amount, request.user?.id
    ]);
    
    return { success: true, invoice: result.rows[0] };
  });
  
  // Обновить счёт
  fastify.put('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const {
      invoice_number, invoice_date, invoice_type,
      status, work_id, act_id,
      customer_name, customer_inn, description,
      amount, vat_pct, total_amount,
      due_date, paid_amount
    } = request.body;
    
    const result = await db.query(`
      UPDATE invoices SET
        invoice_number = COALESCE($1, invoice_number),
        invoice_date = COALESCE($2, invoice_date),
        invoice_type = COALESCE($3, invoice_type),
        status = COALESCE($4, status),
        work_id = COALESCE($5, work_id),
        act_id = $6,
        customer_name = COALESCE($7, customer_name),
        customer_inn = COALESCE($8, customer_inn),
        description = COALESCE($9, description),
        amount = COALESCE($10, amount),
        vat_pct = COALESCE($11, vat_pct),
        total_amount = COALESCE($12, total_amount),
        due_date = $13,
        paid_amount = COALESCE($14, paid_amount),
        updated_at = NOW()
      WHERE id = $15
      RETURNING *
    `, [
      invoice_number, invoice_date, invoice_type,
      status, work_id, act_id,
      customer_name, customer_inn, description,
      amount, vat_pct, total_amount,
      due_date, paid_amount, id
    ]);
    
    if (result.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Счёт не найден' });
    }
    
    return { success: true, invoice: result.rows[0] };
  });
  
  // Добавить оплату
  fastify.post('/:id/payments', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { amount, payment_date, comment } = request.body;
    
    // Проверяем существование счёта
    const invoice = await db.query('SELECT * FROM invoices WHERE id = $1', [id]);
    if (invoice.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Счёт не найден' });
    }
    
    // Добавляем платёж
    const payment = await db.query(`
      INSERT INTO invoice_payments (invoice_id, amount, payment_date, comment, created_by, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING *
    `, [id, amount, payment_date || new Date().toISOString().slice(0, 10), comment, request.user?.id]);
    
    // Обновляем сумму оплаты в счёте
    const newPaidAmount = parseFloat(invoice.rows[0].paid_amount || 0) + parseFloat(amount);
    const totalAmount = parseFloat(invoice.rows[0].total_amount || 0);
    
    let newStatus = invoice.rows[0].status;
    if (newPaidAmount >= totalAmount && totalAmount > 0) {
      newStatus = 'paid';
    } else if (newPaidAmount > 0) {
      newStatus = 'partial';
    }
    
    await db.query(`
      UPDATE invoices SET paid_amount = $1, status = $2, updated_at = NOW() WHERE id = $3
    `, [newPaidAmount, newStatus, id]);
    
    return { 
      success: true, 
      payment: payment.rows[0],
      new_paid_amount: newPaidAmount,
      new_status: newStatus
    };
  });
  
  // Удалить счёт
  fastify.delete('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    
    // Удаляем платежи
    await db.query('DELETE FROM invoice_payments WHERE invoice_id = $1', [id]);
    
    const result = await db.query('DELETE FROM invoices WHERE id = $1 RETURNING id', [id]);
    
    if (result.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Счёт не найден' });
    }
    
    return { success: true, deleted: true };
  });
  
  // Просроченные счета
  fastify.get('/overdue/list', {
    preHandler: [fastify.authenticate]
  }, async () => {
    const result = await db.query(`
      SELECT * FROM invoices 
      WHERE status NOT IN ('paid', 'cancelled') 
        AND due_date < CURRENT_DATE
      ORDER BY due_date ASC
    `);
    
    return { success: true, invoices: result.rows };
  });
  
  // Статистика
  fastify.get('/stats/summary', {
    preHandler: [fastify.authenticate]
  }, async () => {
    const result = await db.query(`
      SELECT 
        status,
        COUNT(*) as count,
        COALESCE(SUM(total_amount), 0) as total_sum,
        COALESCE(SUM(paid_amount), 0) as paid_sum
      FROM invoices
      GROUP BY status
    `);
    
    return { success: true, stats: result.rows };
  });
}

module.exports = invoicesRoutes;
