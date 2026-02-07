'use strict';

/**
 * Задачи от руководства + Todo-список (M3)
 *
 * Задачи (tasks):
 *   Directors создают → назначают сотруднику → дедлайн + описание + файлы
 *   Сотрудник: принять → в работе → выполнил (с комментарием)
 *   При приближении дедлайна — уведомление
 *
 * Todo (todo_items):
 *   Личный список: создать → отметить выполненным (зачёркивание) → автоудаление через 48ч
 */

const path = require('path');
const fs = require('fs').promises;
const { randomUUID } = require('crypto');

module.exports = async function(fastify) {
  const db = fastify.db;
  const uploadDir = process.env.UPLOAD_DIR || './uploads';

  const DIRECTOR_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

  // ═══════════════════════════════════════════════════════════════
  // HELPER: Уведомление
  // ═══════════════════════════════════════════════════════════════
  async function notify(userId, title, message, link) {
    try {
      await db.query(`
        INSERT INTO notifications (user_id, title, message, type, link, is_read, created_at)
        VALUES ($1, $2, $3, 'task', $4, false, NOW())
      `, [userId, title, message, link || '#/tasks']);

      // Telegram notification (optional)
      try {
        const telegram = require('../services/telegram');
        if (telegram && telegram.sendNotification) {
          await telegram.sendNotification(userId, `🔔 *${title}*\n\n${message}`);
        }
      } catch (e) {
        // Telegram may not be configured
      }
    } catch (e) {
      fastify.log.error('Task notification error:', e.message);
    }
  }

  // ╔═══════════════════════════════════════════════════════════════╗
  // ║                    ЗАДАЧИ (tasks)                            ║
  // ╚═══════════════════════════════════════════════════════════════╝

  // ───────────────────────────────────────────────────────────────
  // GET /api/tasks/my — Мои задачи (назначенные мне)
  // ───────────────────────────────────────────────────────────────
  fastify.get('/my', {
    preHandler: [fastify.requirePermission('tasks', 'read')]
  }, async (request) => {
    const { status, limit = 50, offset = 0 } = request.query;
    let sql = `
      SELECT t.*, u_creator.name as creator_name, u_creator.role as creator_role
      FROM tasks t
      JOIN users u_creator ON t.creator_id = u_creator.id
      WHERE t.assignee_id = $1
    `;
    const params = [request.user.id];
    let idx = 2;

    if (status) {
      sql += ` AND t.status = $${idx}`;
      params.push(status);
      idx++;
    }

    sql += ` ORDER BY
      CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
      t.deadline ASC NULLS LAST,
      t.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(parseInt(limit), parseInt(offset));

    const { rows } = await db.query(sql, params);
    return { tasks: rows };
  });

  // ───────────────────────────────────────────────────────────────
  // GET /api/tasks/created — Задачи которые я создал (для директоров)
  // ───────────────────────────────────────────────────────────────
  fastify.get('/created', {
    preHandler: [fastify.requirePermission('tasks_admin', 'read')]
  }, async (request) => {
    const { status, assignee_id, limit = 100, offset = 0 } = request.query;
    let sql = `
      SELECT t.*, u_assignee.name as assignee_name, u_assignee.role as assignee_role
      FROM tasks t
      JOIN users u_assignee ON t.assignee_id = u_assignee.id
      WHERE t.creator_id = $1
    `;
    const params = [request.user.id];
    let idx = 2;

    if (status) {
      sql += ` AND t.status = $${idx}`;
      params.push(status);
      idx++;
    }
    if (assignee_id) {
      sql += ` AND t.assignee_id = $${idx}`;
      params.push(parseInt(assignee_id));
      idx++;
    }

    sql += ` ORDER BY t.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(parseInt(limit), parseInt(offset));

    const { rows } = await db.query(sql, params);
    return { tasks: rows };
  });

  // ───────────────────────────────────────────────────────────────
  // GET /api/tasks/all — Все задачи (для директоров — обзорная панель)
  // ───────────────────────────────────────────────────────────────
  fastify.get('/all', {
    preHandler: [fastify.requirePermission('tasks_admin', 'read')]
  }, async (request) => {
    const { status, assignee_id, creator_id, limit = 100, offset = 0 } = request.query;
    let sql = `
      SELECT t.*,
        u_creator.name as creator_name,
        u_assignee.name as assignee_name, u_assignee.role as assignee_role
      FROM tasks t
      JOIN users u_creator ON t.creator_id = u_creator.id
      JOIN users u_assignee ON t.assignee_id = u_assignee.id
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;

    if (status) { sql += ` AND t.status = $${idx}`; params.push(status); idx++; }
    if (assignee_id) { sql += ` AND t.assignee_id = $${idx}`; params.push(parseInt(assignee_id)); idx++; }
    if (creator_id) { sql += ` AND t.creator_id = $${idx}`; params.push(parseInt(creator_id)); idx++; }

    sql += ` ORDER BY t.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(parseInt(limit), parseInt(offset));

    const { rows } = await db.query(sql, params);
    return { tasks: rows };
  });

  // ───────────────────────────────────────────────────────────────
  // GET /api/tasks/stats — Статистика задач (для виджета на главной)
  // ───────────────────────────────────────────────────────────────
  fastify.get('/stats', {
    preHandler: [fastify.requirePermission('tasks', 'read')]
  }, async (request) => {
    const userId = request.user.id;

    const { rows } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('new','accepted','in_progress')) as active,
        COUNT(*) FILTER (WHERE status = 'new') as new_count,
        COUNT(*) FILTER (WHERE status = 'done') as done_count,
        COUNT(*) FILTER (WHERE status IN ('new','accepted','in_progress')
          AND deadline IS NOT NULL AND deadline < NOW()) as overdue
      FROM tasks WHERE assignee_id = $1
    `, [userId]);

    return rows[0] || { active: 0, new_count: 0, done_count: 0, overdue: 0 };
  });

  // ───────────────────────────────────────────────────────────────
  // GET /api/tasks/:id — Детали задачи
  // ───────────────────────────────────────────────────────────────
  fastify.get('/:id', {
    preHandler: [fastify.requirePermission('tasks', 'read')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    const { rows: [task] } = await db.query(`
      SELECT t.*,
        u_creator.name as creator_name, u_creator.role as creator_role,
        u_assignee.name as assignee_name, u_assignee.role as assignee_role
      FROM tasks t
      JOIN users u_creator ON t.creator_id = u_creator.id
      JOIN users u_assignee ON t.assignee_id = u_assignee.id
      WHERE t.id = $1
    `, [id]);

    if (!task) return reply.code(404).send({ error: 'Задача не найдена' });

    // Доступ: создатель, исполнитель или ADMIN/директор
    const canAccess = task.creator_id === request.user.id
      || task.assignee_id === request.user.id
      || DIRECTOR_ROLES.includes(request.user.role);

    if (!canAccess) return reply.code(403).send({ error: 'Нет доступа' });

    return { task };
  });

  // ───────────────────────────────────────────────────────────────
  // POST /api/tasks — Создать задачу (директора)
  // ───────────────────────────────────────────────────────────────
  fastify.post('/', {
    preHandler: [fastify.requirePermission('tasks_admin', 'write')]
  }, async (request, reply) => {
    const { assignee_id, title, description, deadline, priority, creator_comment } = request.body;

    if (!assignee_id) return reply.code(400).send({ error: 'Укажите исполнителя' });
    if (!title || !title.trim()) return reply.code(400).send({ error: 'Укажите название задачи' });

    // Проверить что исполнитель существует
    const { rows: [assignee] } = await db.query(
      'SELECT id, name FROM users WHERE id = $1 AND is_active = true', [parseInt(assignee_id)]
    );
    if (!assignee) return reply.code(400).send({ error: 'Исполнитель не найден' });

    const result = await db.query(`
      INSERT INTO tasks (creator_id, assignee_id, title, description, deadline, priority, creator_comment, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'new', NOW(), NOW())
      RETURNING *
    `, [
      request.user.id,
      parseInt(assignee_id),
      title.trim(),
      description || null,
      deadline || null,
      priority || 'normal',
      creator_comment || null
    ]);

    const task = result.rows[0];

    // Уведомить исполнителя
    const creatorName = request.user.name || request.user.login;
    const deadlineStr = deadline ? new Date(deadline).toLocaleDateString('ru-RU') : 'не указан';
    await notify(
      parseInt(assignee_id),
      '📋 Новая задача',
      `${creatorName} назначил вам задачу:\n«${title.trim()}»\nДедлайн: ${deadlineStr}\nПриоритет: ${priority || 'normal'}`,
      `#/tasks?id=${task.id}`
    );

    return { task };
  });

  // ───────────────────────────────────────────────────────────────
  // POST /api/tasks/:id/files — Загрузить файлы к задаче
  // ───────────────────────────────────────────────────────────────
  fastify.post('/:id/files', {
    preHandler: [fastify.requirePermission('tasks_admin', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);

    const { rows: [task] } = await db.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (!task) return reply.code(404).send({ error: 'Задача не найдена' });

    // Только создатель или ADMIN могут прикладывать файлы
    if (task.creator_id !== request.user.id && request.user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Только создатель может прикладывать файлы' });
    }

    const parts = request.parts();
    const newFiles = [];

    for await (const part of parts) {
      if (part.file) {
        const ext = path.extname(part.filename) || '';
        const savedName = `task_${randomUUID()}${ext}`;
        await fs.mkdir(uploadDir, { recursive: true });
        const buffer = await part.toBuffer();
        await fs.writeFile(path.join(uploadDir, savedName), buffer);
        newFiles.push({
          filename: savedName,
          original_name: part.filename,
          size: buffer.length,
          uploaded_at: new Date().toISOString()
        });
      }
    }

    if (newFiles.length === 0) return reply.code(400).send({ error: 'Файлы не переданы' });

    // Добавить к существующим файлам
    const existingFiles = Array.isArray(task.files) ? task.files : [];
    const allFiles = [...existingFiles, ...newFiles];

    await db.query('UPDATE tasks SET files = $1, updated_at = NOW() WHERE id = $2', [
      JSON.stringify(allFiles), id
    ]);

    return { files: allFiles };
  });

  // ───────────────────────────────────────────────────────────────
  // GET /api/tasks/:id/file/:filename — Скачать файл задачи
  // ───────────────────────────────────────────────────────────────
  fastify.get('/:id/file/:filename', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const filename = request.params.filename;

    const { rows: [task] } = await db.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (!task) return reply.code(404).send({ error: 'Задача не найдена' });

    // Доступ: создатель, исполнитель или директор
    const canAccess = task.creator_id === request.user.id
      || task.assignee_id === request.user.id
      || DIRECTOR_ROLES.includes(request.user.role);

    if (!canAccess) return reply.code(403).send({ error: 'Нет доступа' });

    // Проверить что файл принадлежит задаче
    const files = Array.isArray(task.files) ? task.files : [];
    const fileInfo = files.find(f => f.filename === filename);
    if (!fileInfo) return reply.code(404).send({ error: 'Файл не найден' });

    const filepath = path.join(uploadDir, filename);
    try {
      const stat = await fs.stat(filepath);
      const file = await fs.readFile(filepath);

      const ext = path.extname(filename).toLowerCase();
      const mimeTypes = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.gif': 'image/gif', '.pdf': 'application/pdf', '.webp': 'image/webp',
        '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      };

      reply.header('Content-Type', mimeTypes[ext] || 'application/octet-stream');
      reply.header('Content-Length', stat.size);
      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(fileInfo.original_name || filename)}"`);
      return reply.send(file);
    } catch (e) {
      return reply.code(404).send({ error: 'Файл не найден' });
    }
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /api/tasks/:id/accept — Исполнитель принимает задачу
  // ───────────────────────────────────────────────────────────────
  fastify.put('/:id/accept', {
    preHandler: [fastify.requirePermission('tasks', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);

    const { rows: [task] } = await db.query(
      'SELECT * FROM tasks WHERE id = $1 AND assignee_id = $2 AND status = $3',
      [id, request.user.id, 'new']
    );
    if (!task) return reply.code(400).send({ error: 'Задача не найдена или не в статусе "Новая"' });

    await db.query(`
      UPDATE tasks SET status = 'accepted', accepted_at = NOW(), updated_at = NOW()
      WHERE id = $1
    `, [id]);

    // Уведомить создателя
    await notify(
      task.creator_id,
      '👍 Задача принята',
      `${request.user.name || request.user.login} принял задачу «${task.title}»`,
      `#/tasks-admin?id=${id}`
    );

    return { success: true };
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /api/tasks/:id/start — Исполнитель начинает работу
  // ───────────────────────────────────────────────────────────────
  fastify.put('/:id/start', {
    preHandler: [fastify.requirePermission('tasks', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);

    const { rows: [task] } = await db.query(
      'SELECT * FROM tasks WHERE id = $1 AND assignee_id = $2 AND status IN ($3, $4)',
      [id, request.user.id, 'new', 'accepted']
    );
    if (!task) return reply.code(400).send({ error: 'Нельзя начать эту задачу' });

    await db.query(`
      UPDATE tasks SET status = 'in_progress', accepted_at = COALESCE(accepted_at, NOW()), updated_at = NOW()
      WHERE id = $1
    `, [id]);

    return { success: true };
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /api/tasks/:id/complete — Исполнитель завершает задачу
  // ───────────────────────────────────────────────────────────────
  fastify.put('/:id/complete', {
    preHandler: [fastify.requirePermission('tasks', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const { comment } = request.body || {};

    const { rows: [task] } = await db.query(
      'SELECT * FROM tasks WHERE id = $1 AND assignee_id = $2 AND status IN ($3, $4, $5, $6)',
      [id, request.user.id, 'new', 'accepted', 'in_progress', 'overdue']
    );
    if (!task) return reply.code(400).send({ error: 'Нельзя завершить эту задачу' });

    await db.query(`
      UPDATE tasks SET status = 'done', assignee_comment = $1, completed_at = NOW(), updated_at = NOW()
      WHERE id = $2
    `, [comment || null, id]);

    // Уведомить создателя
    await notify(
      task.creator_id,
      '✅ Задача выполнена',
      `${request.user.name || request.user.login} выполнил задачу «${task.title}»${comment ? '\nКомментарий: ' + comment : ''}`,
      `#/tasks-admin?id=${id}`
    );

    return { success: true };
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /api/tasks/:id — Редактирование задачи (создателем)
  // ───────────────────────────────────────────────────────────────
  fastify.put('/:id', {
    preHandler: [fastify.requirePermission('tasks_admin', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const { title, description, deadline, priority, creator_comment } = request.body;

    const { rows: [task] } = await db.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (!task) return reply.code(404).send({ error: 'Задача не найдена' });

    // Только создатель или ADMIN может редактировать
    if (task.creator_id !== request.user.id && request.user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Только создатель может редактировать' });
    }

    const updates = [];
    const values = [];
    let idx = 1;

    if (title !== undefined) { updates.push(`title = $${idx}`); values.push(title.trim()); idx++; }
    if (description !== undefined) { updates.push(`description = $${idx}`); values.push(description); idx++; }
    if (deadline !== undefined) { updates.push(`deadline = $${idx}`); values.push(deadline || null); idx++; }
    if (priority !== undefined) { updates.push(`priority = $${idx}`); values.push(priority); idx++; }
    if (creator_comment !== undefined) { updates.push(`creator_comment = $${idx}`); values.push(creator_comment); idx++; }

    if (updates.length === 0) return reply.code(400).send({ error: 'Нет данных для обновления' });

    updates.push('updated_at = NOW()');
    values.push(id);

    await db.query(
      `UPDATE tasks SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    return { success: true };
  });

  // ───────────────────────────────────────────────────────────────
  // DELETE /api/tasks/:id — Удаление задачи (создателем или ADMIN)
  // ───────────────────────────────────────────────────────────────
  fastify.delete('/:id', {
    preHandler: [fastify.requirePermission('tasks_admin', 'delete')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);

    const { rows: [task] } = await db.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (!task) return reply.code(404).send({ error: 'Задача не найдена' });

    if (task.creator_id !== request.user.id && request.user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Только создатель или ADMIN' });
    }

    // Удалить файлы с диска
    if (Array.isArray(task.files)) {
      for (const f of task.files) {
        try { await fs.unlink(path.join(uploadDir, f.filename)); } catch(e) {}
      }
    }

    await db.query('DELETE FROM tasks WHERE id = $1', [id]);
    return { success: true };
  });

  // ───────────────────────────────────────────────────────────────
  // GET /api/tasks/check-deadlines — Проверка просроченных
  // ───────────────────────────────────────────────────────────────
  fastify.get('/check-deadlines', {
    preHandler: [fastify.authenticate]
  }, async () => {
    // Найти задачи с дедлайном через 24 часа или менее, ещё не выполненные
    const { rows: upcoming } = await db.query(`
      SELECT t.*, u.name as assignee_name
      FROM tasks t JOIN users u ON t.assignee_id = u.id
      WHERE t.status IN ('new', 'accepted', 'in_progress')
        AND t.deadline IS NOT NULL
        AND t.deadline BETWEEN NOW() AND NOW() + INTERVAL '24 hours'
    `);

    // Отправить напоминания
    for (const task of upcoming) {
      const hoursLeft = Math.max(0, Math.round((new Date(task.deadline) - Date.now()) / 3600000));
      await notify(
        task.assignee_id,
        '⏰ Дедлайн приближается',
        `Задача «${task.title}» — осталось ${hoursLeft} ч.\nДедлайн: ${new Date(task.deadline).toLocaleString('ru-RU')}`,
        `#/tasks?id=${task.id}`
      );
    }

    // Пометить просроченные
    await db.query(`
      UPDATE tasks SET status = 'overdue', updated_at = NOW()
      WHERE status IN ('new', 'accepted', 'in_progress')
        AND deadline IS NOT NULL AND deadline < NOW()
    `);

    return { reminded: upcoming.length };
  });

  // ╔═══════════════════════════════════════════════════════════════╗
  // ║                   TODO-СПИСОК                                ║
  // ╚═══════════════════════════════════════════════════════════════╝

  // ───────────────────────────────────────────────────────────────
  // GET /api/tasks/todo — Мой todo-список
  // ───────────────────────────────────────────────────────────────
  fastify.get('/todo', {
    preHandler: [fastify.requirePermission('todo', 'read')]
  }, async (request) => {
    // Сначала удалить протухшие (done + время прошло)
    await db.query(`
      DELETE FROM todo_items
      WHERE user_id = $1 AND done = true
        AND done_at IS NOT NULL
        AND done_at + (auto_delete_hours || ' hours')::interval < NOW()
    `, [request.user.id]);

    const { rows } = await db.query(
      'SELECT * FROM todo_items WHERE user_id = $1 ORDER BY done ASC, sort_order ASC, created_at ASC',
      [request.user.id]
    );
    return { items: rows };
  });

  // ───────────────────────────────────────────────────────────────
  // POST /api/tasks/todo — Добавить пункт
  // ───────────────────────────────────────────────────────────────
  fastify.post('/todo', {
    preHandler: [fastify.requirePermission('todo', 'write')]
  }, async (request, reply) => {
    const { text } = request.body;
    if (!text || !text.trim()) return reply.code(400).send({ error: 'Текст обязателен' });

    // Определить sort_order: последний + 1
    const { rows: [maxRow] } = await db.query(
      'SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order FROM todo_items WHERE user_id = $1',
      [request.user.id]
    );

    const result = await db.query(`
      INSERT INTO todo_items (user_id, text, sort_order, created_at)
      VALUES ($1, $2, $3, NOW()) RETURNING *
    `, [request.user.id, text.trim(), maxRow.next_order]);

    return { item: result.rows[0] };
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /api/tasks/todo/:id/toggle — Отметить выполненным / снять отметку
  // ───────────────────────────────────────────────────────────────
  fastify.put('/todo/:id/toggle', {
    preHandler: [fastify.requirePermission('todo', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);

    const { rows: [item] } = await db.query(
      'SELECT * FROM todo_items WHERE id = $1 AND user_id = $2',
      [id, request.user.id]
    );
    if (!item) return reply.code(404).send({ error: 'Не найдено' });

    const newDone = !item.done;
    await db.query(`
      UPDATE todo_items SET done = $1, done_at = $2 WHERE id = $3
    `, [newDone, newDone ? new Date().toISOString() : null, id]);

    return { success: true, done: newDone };
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /api/tasks/todo/:id — Редактировать текст
  // ───────────────────────────────────────────────────────────────
  fastify.put('/todo/:id', {
    preHandler: [fastify.requirePermission('todo', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const { text } = request.body;
    if (!text || !text.trim()) return reply.code(400).send({ error: 'Текст обязателен' });

    const result = await db.query(
      'UPDATE todo_items SET text = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
      [text.trim(), id, request.user.id]
    );
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найдено' });

    return { item: result.rows[0] };
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /api/tasks/todo/reorder — Пересортировать список
  // ───────────────────────────────────────────────────────────────
  fastify.put('/todo/reorder', {
    preHandler: [fastify.requirePermission('todo', 'write')]
  }, async (request, reply) => {
    const { order } = request.body; // [{id: 5, sort_order: 0}, ...]
    if (!Array.isArray(order)) return reply.code(400).send({ error: 'order array required' });

    for (const item of order) {
      await db.query(
        'UPDATE todo_items SET sort_order = $1 WHERE id = $2 AND user_id = $3',
        [item.sort_order, item.id, request.user.id]
      );
    }

    return { success: true };
  });

  // ───────────────────────────────────────────────────────────────
  // DELETE /api/tasks/todo/:id — Удалить пункт
  // ───────────────────────────────────────────────────────────────
  fastify.delete('/todo/:id', {
    preHandler: [fastify.requirePermission('todo', 'delete')]
  }, async (request, reply) => {
    const result = await db.query(
      'DELETE FROM todo_items WHERE id = $1 AND user_id = $2 RETURNING id',
      [parseInt(request.params.id), request.user.id]
    );
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    return { success: true };
  });
};
