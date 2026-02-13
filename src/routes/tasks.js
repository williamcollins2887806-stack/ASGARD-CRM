/**
 * Tasks Routes - CRUD + status flow
 * Новая → В работе → Выполнена → Закрыта
 */
async function routes(fastify, options) {
  const db = fastify.db;

  // GET /api/tasks - Все задачи (с фильтрацией)
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { status, assigned_to, created_by, limit = 200, offset = 0 } = request.query;
    let sql = 'SELECT * FROM tasks WHERE 1=1';
    const params = [];
    let idx = 1;

    if (status) {
      sql += ` AND status = $${idx}`;
      params.push(status);
      idx++;
    }
    if (assigned_to) {
      sql += ` AND assigned_to = $${idx}`;
      params.push(parseInt(assigned_to));
      idx++;
    }
    if (created_by) {
      sql += ` AND created_by = $${idx}`;
      params.push(parseInt(created_by));
      idx++;
    }

    // Не-админы видят только свои задачи
    if (request.user.role !== 'ADMIN' && !['DIRECTOR_COMM', 'DIRECTOR_GEN', 'DIRECTOR_DEV'].includes(request.user.role)) {
      sql += ` AND (assigned_to = $${idx} OR created_by = $${idx})`;
      params.push(request.user.id);
      idx++;
    }

    sql += ` ORDER BY CASE WHEN status = 'Новая' THEN 1 WHEN status = 'В работе' THEN 2 WHEN status = 'Выполнена' THEN 3 ELSE 4 END, created_at DESC`;
    sql += ` LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await db.query(sql, params);
    const countResult = await db.query('SELECT COUNT(*) as total FROM tasks');

    return {
      tasks: result.rows,
      total: parseInt(countResult.rows[0].total)
    };
  });

  // GET /api/tasks/:id
  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const result = await db.query('SELECT * FROM tasks WHERE id = $1', [request.params.id]);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Задача не найдена' });
    return { task: result.rows[0] };
  });

  // POST /api/tasks - Создать задачу
  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { title, description, assignee_id, priority, due_date } = request.body;

    const result = await db.query(`
      INSERT INTO tasks (title, description, status, created_by, assigned_to, priority, due_date, created_at, updated_at)
      VALUES ($1, $2, 'Новая', $3, $4, $5, $6, NOW(), NOW())
      RETURNING *
    `, [title, description || '', request.user.id, assignee_id || null, priority || 'medium', due_date || null]);

    const task = result.rows[0];

    // Уведомление исполнителю
    if (task.assigned_to && task.assigned_to !== request.user.id) {
      await createNotification(db, {
        user_id: task.assigned_to,
        title: '📋 Новая задача',
        message: `${request.user.name} назначил вам задачу: ${title}`,
        type: 'task',
        link_hash: `#/tasks?id=${task.id}`
      });
    }

    return { success: true, task };
  });

  // PUT /api/tasks/:id - Обновить задачу
  fastify.put('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { title, description, assignee_id, priority, due_date } = request.body;

    const result = await db.query(`
      UPDATE tasks SET title = $1, description = $2, assigned_to = $3, priority = $4, due_date = $5, updated_at = NOW()
      WHERE id = $6 RETURNING *
    `, [title, description, assignee_id, priority, due_date, request.params.id]);

    if (!result.rows[0]) return reply.code(404).send({ error: 'Задача не найдена' });
    return { success: true, task: result.rows[0] };
  });

  // PUT /api/tasks/:id/status - Изменить статус
  fastify.put('/:id/status', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { status } = request.body;
    const validStatuses = ['Новая', 'В работе', 'Выполнена', 'Закрыта'];
    if (!validStatuses.includes(status)) {
      return reply.code(400).send({ error: `Недопустимый статус. Допустимы: ${validStatuses.join(', ')}` });
    }

    const existing = await db.query('SELECT * FROM tasks WHERE id = $1', [request.params.id]);
    if (!existing.rows[0]) return reply.code(404).send({ error: 'Задача не найдена' });

    const task = existing.rows[0];

    let updateSql = 'UPDATE tasks SET status = $1, updated_at = NOW()';
    if (status === 'Выполнена') updateSql += ', completed_at = NOW()';
    if (status === 'В работе') updateSql += ', accepted_at = NOW()';
    updateSql += ' WHERE id = $2 RETURNING *';

    const result = await db.query(updateSql, [status, request.params.id]);

    // Уведомления при смене статуса
    const notifyUserId = task.created_by !== request.user.id ? task.created_by : task.assigned_to;
    if (notifyUserId && notifyUserId !== request.user.id) {
      const statusMessages = {
        'В работе': `${request.user.name} взял задачу в работу: ${task.title}`,
        'Выполнена': `${request.user.name} выполнил задачу: ${task.title}`,
        'Закрыта': `${request.user.name} закрыл задачу: ${task.title}`
      };
      if (statusMessages[status]) {
        await createNotification(db, {
          user_id: notifyUserId,
          title: `📋 Задача: ${status}`,
          message: statusMessages[status],
          type: 'task',
          link_hash: `#/tasks?id=${task.id}`
        });
      }
    }

    return { success: true, task: result.rows[0] };
  });

  // DELETE /api/tasks/:id
  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const result = await db.query('DELETE FROM tasks WHERE id = $1 RETURNING id', [request.params.id]);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Задача не найдена' });
    return { success: true, deleted: true };
  });
}

async function createNotification(db, { user_id, title, message, type, link_hash }) {
  try {
    await db.query(`
      INSERT INTO notifications (user_id, title, message, type, link_hash, is_read, created_at)
      VALUES ($1, $2, $3, $4, $5, false, NOW())
    `, [user_id, title, message, type || 'info', link_hash || null]);

    try {
      const telegram = require('../services/telegram');
      await telegram.sendNotification(user_id, `🔔 *${title}*\n\n${message}`);
    } catch (e) {}
  } catch (e) {
    console.error('createNotification error:', e.message);
  }
}

module.exports = routes;
