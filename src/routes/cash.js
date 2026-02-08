'use strict';

/**
 * Cash Routes — Модуль "Касса" (M2)
 *
 * Авансовые отчёты и расчёты с РП:
 * - РП создаёт заявку на выдачу наличных
 * - Директор согласовывает / отклоняет / задаёт вопрос
 * - РП подтверждает получение
 * - РП прикладывает чеки расходов
 * - РП возвращает остаток
 * - Директор закрывает заявку
 */

const path = require('path');
const fs = require('fs').promises;
const { randomUUID } = require('crypto');

module.exports = async function(fastify) {
  const db = fastify.db;

  // ─────────────────────────────────────────────────────────────────
  // Хелперы
  // ─────────────────────────────────────────────────────────────────
  const DIRECTOR_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

  function isDirector(role) {
    return DIRECTOR_ROLES.includes(role);
  }

  // Подсчёт баланса заявки
  async function calcRequestBalance(requestId) {
    const req = await db.query('SELECT amount FROM cash_requests WHERE id = $1', [requestId]);
    if (!req.rows[0]) return null;

    const approved = parseFloat(req.rows[0].amount) || 0;

    const exp = await db.query(
      'SELECT COALESCE(SUM(amount), 0) as total FROM cash_expenses WHERE request_id = $1',
      [requestId]
    );
    const spent = parseFloat(exp.rows[0].total) || 0;

    const ret = await db.query(
      'SELECT COALESCE(SUM(amount), 0) as total FROM cash_returns WHERE request_id = $1',
      [requestId]
    );
    const returned = parseFloat(ret.rows[0].total) || 0;

    return {
      approved,
      spent,
      returned,
      remainder: approved - spent - returned
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // GET /api/cash/my — Мои заявки (для РП)
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/my', {
    preHandler: [fastify.requirePermission('cash', 'read')]
  }, async (request) => {
    const userId = request.user.id;

    const { rows } = await db.query(`
      SELECT cr.*,
             w.work_title,
             u.name as director_name
      FROM cash_requests cr
      LEFT JOIN works w ON w.id = cr.work_id
      LEFT JOIN users u ON u.id = cr.director_id
      WHERE cr.user_id = $1
      ORDER BY cr.created_at DESC
    `, [userId]);

    // Добавим баланс к каждой заявке
    for (const row of rows) {
      const bal = await calcRequestBalance(row.id);
      row.balance = bal;
    }

    return rows;
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /api/cash/all — Все заявки (для директоров)
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/all', {
    preHandler: [fastify.requirePermission('cash_admin', 'read')]
  }, async (request) => {
    const { status, user_id } = request.query;

    let sql = `
      SELECT cr.*,
             w.work_title,
             u.name as user_name,
             u.role as user_role,
             d.name as director_name
      FROM cash_requests cr
      LEFT JOIN works w ON w.id = cr.work_id
      LEFT JOIN users u ON u.id = cr.user_id
      LEFT JOIN users d ON d.id = cr.director_id
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;

    if (status) {
      sql += ` AND cr.status = $${idx++}`;
      params.push(status);
    }
    if (user_id) {
      sql += ` AND cr.user_id = $${idx++}`;
      params.push(parseInt(user_id));
    }

    sql += ' ORDER BY cr.created_at DESC';

    const { rows } = await db.query(sql, params);

    for (const row of rows) {
      const bal = await calcRequestBalance(row.id);
      row.balance = bal;
    }

    return rows;
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /api/cash/summary — Сводка по всем пользователям (для директоров)
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/summary', {
    preHandler: [fastify.requirePermission('cash_admin', 'read')]
  }, async () => {
    // Суммы по пользователям: выдано, потрачено, возвращено, остаток
    const { rows } = await db.query(`
      SELECT
        u.id as user_id,
        u.name as user_name,
        u.role as user_role,
        COALESCE(SUM(cr.amount) FILTER (WHERE cr.status IN ('received', 'reporting', 'closed')), 0) as total_issued,
        COALESCE((
          SELECT SUM(ce.amount) FROM cash_expenses ce
          JOIN cash_requests cr2 ON cr2.id = ce.request_id
          WHERE cr2.user_id = u.id
        ), 0) as total_spent,
        COALESCE((
          SELECT SUM(cret.amount) FROM cash_returns cret
          JOIN cash_requests cr3 ON cr3.id = cret.request_id
          WHERE cr3.user_id = u.id AND cret.confirmed_at IS NOT NULL
        ), 0) as total_returned
      FROM users u
      LEFT JOIN cash_requests cr ON cr.user_id = u.id
      WHERE u.is_active = true
      GROUP BY u.id, u.name, u.role
      HAVING COALESCE(SUM(cr.amount) FILTER (WHERE cr.status IN ('received', 'reporting', 'closed')), 0) > 0
         OR EXISTS (SELECT 1 FROM cash_requests WHERE user_id = u.id)
      ORDER BY u.name
    `);

    return rows.map(r => ({
      ...r,
      total_issued: parseFloat(r.total_issued) || 0,
      total_spent: parseFloat(r.total_spent) || 0,
      total_returned: parseFloat(r.total_returned) || 0,
      balance: (parseFloat(r.total_issued) || 0) - (parseFloat(r.total_spent) || 0) - (parseFloat(r.total_returned) || 0)
    }));
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /api/cash/my-balance — Мой текущий баланс (для виджета)
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/my-balance', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const userId = request.user.id;

    // Сумма по активным заявкам (received, reporting)
    const issued = await db.query(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM cash_requests
      WHERE user_id = $1 AND status IN ('received', 'reporting')
    `, [userId]);

    const spent = await db.query(`
      SELECT COALESCE(SUM(ce.amount), 0) as total
      FROM cash_expenses ce
      JOIN cash_requests cr ON cr.id = ce.request_id
      WHERE cr.user_id = $1 AND cr.status IN ('received', 'reporting')
    `, [userId]);

    const returned = await db.query(`
      SELECT COALESCE(SUM(cret.amount), 0) as total
      FROM cash_returns cret
      JOIN cash_requests cr ON cr.id = cret.request_id
      WHERE cr.user_id = $1 AND cr.status IN ('received', 'reporting') AND cret.confirmed_at IS NOT NULL
    `, [userId]);

    const totalIssued = parseFloat(issued.rows[0].total) || 0;
    const totalSpent = parseFloat(spent.rows[0].total) || 0;
    const totalReturned = parseFloat(returned.rows[0].total) || 0;

    // Количество активных заявок
    const active = await db.query(`
      SELECT COUNT(*) as cnt FROM cash_requests
      WHERE user_id = $1 AND status NOT IN ('closed', 'rejected')
    `, [userId]);

    return {
      issued: totalIssued,
      spent: totalSpent,
      returned: totalReturned,
      balance: totalIssued - totalSpent - totalReturned,
      active_requests: parseInt(active.rows[0].cnt) || 0
    };
  });

  // ─────────────────────────────────────────────────────────────────
  // POST /api/cash — Создать заявку на выдачу
  // ─────────────────────────────────────────────────────────────────
  fastify.post('/', {
    preHandler: [fastify.requirePermission('cash', 'write')]
  }, async (request, reply) => {
    const { work_id, type = 'advance', amount, purpose, cover_letter } = request.body;
    const userId = request.user.id;

    if (!amount || amount <= 0) {
      return reply.code(400).send({ error: 'Сумма должна быть больше 0' });
    }
    if (!purpose || !purpose.trim()) {
      return reply.code(400).send({ error: 'Укажите цель' });
    }

    // Если advance — work_id обязателен
    if (type === 'advance' && !work_id) {
      return reply.code(400).send({ error: 'Для аванса укажите проект' });
    }

    const { rows } = await db.query(`
      INSERT INTO cash_requests (user_id, work_id, type, amount, purpose, cover_letter, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'requested')
      RETURNING *
    `, [userId, work_id || null, type, amount, purpose.trim(), cover_letter || null]);

    return rows[0];
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /api/cash/:id — Детали заявки
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    const { rows } = await db.query(`
      SELECT cr.*,
             w.work_title,
             u.name as user_name,
             u.role as user_role,
             d.name as director_name
      FROM cash_requests cr
      LEFT JOIN works w ON w.id = cr.work_id
      LEFT JOIN users u ON u.id = cr.user_id
      LEFT JOIN users d ON d.id = cr.director_id
      WHERE cr.id = $1
    `, [id]);

    if (!rows[0]) {
      return reply.code(404).send({ error: 'Заявка не найдена' });
    }

    const req = rows[0];

    // IDOR: только владелец или директор может смотреть
    if (req.user_id !== request.user.id && !isDirector(request.user.role)) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }

    // Расходы
    const expenses = await db.query(
      'SELECT * FROM cash_expenses WHERE request_id = $1 ORDER BY expense_date, id',
      [id]
    );
    req.expenses = expenses.rows;

    // Возвраты
    const returns = await db.query(`
      SELECT cret.*, u.name as confirmed_by_name
      FROM cash_returns cret
      LEFT JOIN users u ON u.id = cret.confirmed_by
      WHERE cret.request_id = $1
      ORDER BY cret.created_at
    `, [id]);
    req.returns = returns.rows;

    // Сообщения
    const messages = await db.query(`
      SELECT cm.*, u.name as user_name, u.role as user_role
      FROM cash_messages cm
      LEFT JOIN users u ON u.id = cm.user_id
      WHERE cm.request_id = $1
      ORDER BY cm.created_at
    `, [id]);
    req.messages = messages.rows;

    // Баланс
    req.balance = await calcRequestBalance(id);

    return req;
  });

  // ─────────────────────────────────────────────────────────────────
  // PUT /api/cash/:id/approve — Директор согласовывает
  // ─────────────────────────────────────────────────────────────────
  fastify.put('/:id/approve', {
    preHandler: [fastify.requirePermission('cash_admin', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    const { comment } = request.body || {};

    const check = await db.query('SELECT status FROM cash_requests WHERE id = $1', [id]);
    if (!check.rows[0]) return reply.code(404).send({ error: 'Заявка не найдена' });
    if (check.rows[0].status !== 'requested') {
      return reply.code(400).send({ error: 'Заявку можно согласовать только в статусе "requested"' });
    }

    await db.query(`
      UPDATE cash_requests
      SET status = 'approved',
          director_id = $1,
          director_comment = $2,
          updated_at = NOW()
      WHERE id = $3
    `, [request.user.id, comment || null, id]);

    return { success: true, message: 'Заявка согласована' };
  });

  // ─────────────────────────────────────────────────────────────────
  // PUT /api/cash/:id/reject — Директор отклоняет
  // ─────────────────────────────────────────────────────────────────
  fastify.put('/:id/reject', {
    preHandler: [fastify.requirePermission('cash_admin', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    const { comment } = request.body || {};
    if (!comment || !comment.trim()) {
      return reply.code(400).send({ error: 'Укажите причину отклонения' });
    }

    const check = await db.query('SELECT status FROM cash_requests WHERE id = $1', [id]);
    if (!check.rows[0]) return reply.code(404).send({ error: 'Заявка не найдена' });
    if (!['requested', 'approved'].includes(check.rows[0].status)) {
      return reply.code(400).send({ error: 'Заявку нельзя отклонить в текущем статусе' });
    }

    await db.query(`
      UPDATE cash_requests
      SET status = 'rejected',
          director_id = $1,
          director_comment = $2,
          updated_at = NOW()
      WHERE id = $3
    `, [request.user.id, comment.trim(), id]);

    return { success: true, message: 'Заявка отклонена' };
  });

  // ─────────────────────────────────────────────────────────────────
  // PUT /api/cash/:id/question — Директор задаёт вопрос
  // ─────────────────────────────────────────────────────────────────
  fastify.put('/:id/question', {
    preHandler: [fastify.requirePermission('cash_admin', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    const { message } = request.body || {};
    if (!message || !message.trim()) {
      return reply.code(400).send({ error: 'Напишите вопрос' });
    }

    const check = await db.query('SELECT status FROM cash_requests WHERE id = $1', [id]);
    if (!check.rows[0]) return reply.code(404).send({ error: 'Заявка не найдена' });

    // Переводим в статус question и добавляем сообщение
    await db.query(`
      UPDATE cash_requests
      SET status = 'question',
          director_id = $1,
          updated_at = NOW()
      WHERE id = $2
    `, [request.user.id, id]);

    await db.query(`
      INSERT INTO cash_messages (request_id, user_id, message)
      VALUES ($1, $2, $3)
    `, [id, request.user.id, message.trim()]);

    return { success: true, message: 'Вопрос отправлен' };
  });

  // ─────────────────────────────────────────────────────────────────
  // POST /api/cash/:id/reply — РП отвечает на вопрос
  // ─────────────────────────────────────────────────────────────────
  fastify.post('/:id/reply', {
    preHandler: [fastify.requirePermission('cash', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    const { message } = request.body || {};
    if (!message || !message.trim()) {
      return reply.code(400).send({ error: 'Напишите ответ' });
    }

    const check = await db.query('SELECT user_id, status FROM cash_requests WHERE id = $1', [id]);
    if (!check.rows[0]) return reply.code(404).send({ error: 'Заявка не найдена' });

    // IDOR: только владелец
    if (check.rows[0].user_id !== request.user.id) {
      return reply.code(403).send({ error: 'Это не ваша заявка' });
    }

    // Добавляем сообщение и возвращаем в requested
    await db.query(`
      INSERT INTO cash_messages (request_id, user_id, message)
      VALUES ($1, $2, $3)
    `, [id, request.user.id, message.trim()]);

    if (check.rows[0].status === 'question') {
      await db.query(`
        UPDATE cash_requests SET status = 'requested', updated_at = NOW() WHERE id = $1
      `, [id]);
    }

    return { success: true, message: 'Ответ отправлен' };
  });

  // ─────────────────────────────────────────────────────────────────
  // PUT /api/cash/:id/receive — РП подтверждает получение денег
  // ─────────────────────────────────────────────────────────────────
  fastify.put('/:id/receive', {
    preHandler: [fastify.requirePermission('cash', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    const check = await db.query('SELECT user_id, status FROM cash_requests WHERE id = $1', [id]);
    if (!check.rows[0]) return reply.code(404).send({ error: 'Заявка не найдена' });

    if (check.rows[0].user_id !== request.user.id) {
      return reply.code(403).send({ error: 'Это не ваша заявка' });
    }

    if (check.rows[0].status !== 'approved') {
      return reply.code(400).send({ error: 'Подтвердить получение можно только после согласования' });
    }

    await db.query(`
      UPDATE cash_requests
      SET status = 'received',
          received_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
    `, [id]);

    return { success: true, message: 'Получение подтверждено' };
  });

  // ─────────────────────────────────────────────────────────────────
  // POST /api/cash/:id/expense — Добавить расход (с чеком)
  // ─────────────────────────────────────────────────────────────────
  fastify.post('/:id/expense', {
    preHandler: [fastify.requirePermission('cash', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    // Проверка заявки
    const check = await db.query('SELECT user_id, status FROM cash_requests WHERE id = $1', [id]);
    if (!check.rows[0]) return reply.code(404).send({ error: 'Заявка не найдена' });

    if (check.rows[0].user_id !== request.user.id) {
      return reply.code(403).send({ error: 'Это не ваша заявка' });
    }

    if (!['received', 'reporting'].includes(check.rows[0].status)) {
      return reply.code(400).send({ error: 'Добавлять расходы можно только после получения денег' });
    }

    // Парсим multipart
    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: 'Загрузите чек' });
    }

    const fields = {};
    for (const [key, val] of Object.entries(data.fields)) {
      fields[key] = val.value;
    }

    const amount = parseFloat(fields.amount);
    const description = fields.description;
    const expense_date = fields.expense_date || null;

    if (!amount || amount <= 0) {
      return reply.code(400).send({ error: 'Сумма должна быть больше 0' });
    }
    if (!description || !description.trim()) {
      return reply.code(400).send({ error: 'Укажите описание расхода' });
    }

    // Сохраняем файл
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    const ext = path.extname(data.filename) || '.jpg';
    const filename = `receipt_${randomUUID()}${ext}`;
    const filepath = path.join(uploadDir, filename);

    await fs.mkdir(uploadDir, { recursive: true });
    const buffer = await data.toBuffer();
    await fs.writeFile(filepath, buffer);

    // Записываем в БД
    const { rows } = await db.query(`
      INSERT INTO cash_expenses (request_id, amount, description, receipt_file, receipt_original_name, expense_date)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [id, amount, description.trim(), filename, data.filename, expense_date]);

    // Переводим в reporting если был received
    if (check.rows[0].status === 'received') {
      await db.query(`UPDATE cash_requests SET status = 'reporting', updated_at = NOW() WHERE id = $1`, [id]);
    }

    return rows[0];
  });

  // ─────────────────────────────────────────────────────────────────
  // DELETE /api/cash/:id/expense/:expenseId — Удалить расход
  // ─────────────────────────────────────────────────────────────────
  fastify.delete('/:id/expense/:expenseId', {
    preHandler: [fastify.requirePermission('cash', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const expenseId = parseInt(request.params.expenseId);
    if (isNaN(id) || isNaN(expenseId)) return reply.code(400).send({ error: 'Invalid id' });

    const check = await db.query('SELECT user_id, status FROM cash_requests WHERE id = $1', [id]);
    if (!check.rows[0]) return reply.code(404).send({ error: 'Заявка не найдена' });

    if (check.rows[0].user_id !== request.user.id && !isDirector(request.user.role)) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }

    if (!['received', 'reporting'].includes(check.rows[0].status)) {
      return reply.code(400).send({ error: 'Удалять расходы можно только в статусах received/reporting' });
    }

    // Получаем файл для удаления
    const exp = await db.query('SELECT receipt_file FROM cash_expenses WHERE id = $1 AND request_id = $2', [expenseId, id]);
    if (!exp.rows[0]) return reply.code(404).send({ error: 'Расход не найден' });

    // Удаляем файл
    if (exp.rows[0].receipt_file) {
      const uploadDir = process.env.UPLOAD_DIR || './uploads';
      const filepath = path.join(uploadDir, exp.rows[0].receipt_file);
      try {
        await fs.unlink(filepath);
      } catch (e) {
        // Файл мог быть удалён ранее
      }
    }

    await db.query('DELETE FROM cash_expenses WHERE id = $1', [expenseId]);

    return { success: true, message: 'Расход удалён' };
  });

  // ─────────────────────────────────────────────────────────────────
  // POST /api/cash/:id/return — РП возвращает остаток
  // ─────────────────────────────────────────────────────────────────
  fastify.post('/:id/return', {
    preHandler: [fastify.requirePermission('cash', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    const { amount, note } = request.body || {};

    if (!amount || amount <= 0) {
      return reply.code(400).send({ error: 'Сумма возврата должна быть больше 0' });
    }

    const check = await db.query('SELECT user_id, status FROM cash_requests WHERE id = $1', [id]);
    if (!check.rows[0]) return reply.code(404).send({ error: 'Заявка не найдена' });

    if (check.rows[0].user_id !== request.user.id) {
      return reply.code(403).send({ error: 'Это не ваша заявка' });
    }

    if (!['received', 'reporting'].includes(check.rows[0].status)) {
      return reply.code(400).send({ error: 'Возврат возможен только после получения денег' });
    }

    // Проверяем что не возвращаем больше чем остаток
    const balance = await calcRequestBalance(id);
    if (amount > balance.remainder) {
      return reply.code(400).send({ error: `Остаток: ${balance.remainder}. Нельзя вернуть больше.` });
    }

    const { rows } = await db.query(`
      INSERT INTO cash_returns (request_id, amount, note)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [id, amount, note || null]);

    return rows[0];
  });

  // ─────────────────────────────────────────────────────────────────
  // PUT /api/cash/:id/return/:returnId/confirm — Директор подтверждает возврат
  // ─────────────────────────────────────────────────────────────────
  fastify.put('/:id/return/:returnId/confirm', {
    preHandler: [fastify.requirePermission('cash_admin', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const returnId = parseInt(request.params.returnId);
    if (isNaN(id) || isNaN(returnId)) return reply.code(400).send({ error: 'Invalid id' });

    const ret = await db.query(
      'SELECT * FROM cash_returns WHERE id = $1 AND request_id = $2',
      [returnId, id]
    );
    if (!ret.rows[0]) return reply.code(404).send({ error: 'Возврат не найден' });

    if (ret.rows[0].confirmed_at) {
      return reply.code(400).send({ error: 'Возврат уже подтверждён' });
    }

    await db.query(`
      UPDATE cash_returns
      SET confirmed_by = $1, confirmed_at = NOW()
      WHERE id = $2
    `, [request.user.id, returnId]);

    return { success: true, message: 'Возврат подтверждён' };
  });

  // ─────────────────────────────────────────────────────────────────
  // PUT /api/cash/:id/close — Директор закрывает заявку
  // ─────────────────────────────────────────────────────────────────
  fastify.put('/:id/close', {
    preHandler: [fastify.requirePermission('cash_admin', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    const { comment, force } = request.body || {};

    const check = await db.query('SELECT status FROM cash_requests WHERE id = $1', [id]);
    if (!check.rows[0]) return reply.code(404).send({ error: 'Заявка не найдена' });

    if (!['received', 'reporting'].includes(check.rows[0].status)) {
      return reply.code(400).send({ error: 'Закрыть можно только заявки в статусе received/reporting' });
    }

    // Проверяем баланс
    const balance = await calcRequestBalance(id);
    if (balance.remainder > 0 && !force) {
      return reply.code(400).send({
        error: `Остаток ${balance.remainder}. Используйте force=true для принудительного закрытия.`,
        remainder: balance.remainder
      });
    }

    await db.query(`
      UPDATE cash_requests
      SET status = 'closed',
          director_id = $1,
          director_comment = COALESCE(director_comment, '') || $2,
          closed_at = NOW(),
          updated_at = NOW()
      WHERE id = $3
    `, [request.user.id, comment ? '\n' + comment : '', id]);

    return { success: true, message: 'Заявка закрыта' };
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /api/cash/:id/receipt/:filename — Получить файл чека
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/:id/receipt/:filename', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const filename = request.params.filename;

    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    // Проверяем доступ
    const check = await db.query('SELECT user_id FROM cash_requests WHERE id = $1', [id]);
    if (!check.rows[0]) return reply.code(404).send({ error: 'Заявка не найдена' });

    if (check.rows[0].user_id !== request.user.id && !isDirector(request.user.role)) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }

    // Проверяем что файл принадлежит этой заявке
    const exp = await db.query(
      'SELECT receipt_file FROM cash_expenses WHERE request_id = $1 AND receipt_file = $2',
      [id, filename]
    );
    if (!exp.rows[0]) return reply.code(404).send({ error: 'Файл не найден' });

    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    const filepath = path.join(uploadDir, filename);

    try {
      const stat = await fs.stat(filepath);
      const file = await fs.readFile(filepath);

      const ext = path.extname(filename).toLowerCase();
      const mimeTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.pdf': 'application/pdf',
        '.webp': 'image/webp'
      };

      reply.header('Content-Type', mimeTypes[ext] || 'application/octet-stream');
      reply.header('Content-Length', stat.size);
      return reply.send(file);
    } catch (e) {
      return reply.code(404).send({ error: 'Файл не найден' });
    }
  });
};
