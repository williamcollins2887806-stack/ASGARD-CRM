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
      JOIN users u_creator ON t.created_by = u_creator.id
      WHERE t.assigned_to = $1
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
      JOIN users u_assignee ON t.assigned_to = u_assignee.id
      WHERE t.created_by = $1
    `;
    const params = [request.user.id];
    let idx = 2;

    if (status) {
      sql += ` AND t.status = $${idx}`;
      params.push(status);
      idx++;
    }
    if (assignee_id) {
      sql += ` AND t.assigned_to = $${idx}`;
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
      LEFT JOIN users u_creator ON t.created_by = u_creator.id
      LEFT JOIN users u_assignee ON t.assigned_to = u_assignee.id
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;

    if (status) { sql += ` AND t.status = $${idx}`; params.push(status); idx++; }
    if (assignee_id) { sql += ` AND t.assigned_to = $${idx}`; params.push(parseInt(assignee_id)); idx++; }
    if (creator_id) { sql += ` AND t.created_by = $${idx}`; params.push(parseInt(creator_id)); idx++; }

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
      FROM tasks WHERE assigned_to = $1
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
        t.assigned_to as assignee_id, t.created_by as creator_id,
        u_creator.name as creator_name, u_creator.role as creator_role,
        u_assignee.name as assignee_name, u_assignee.role as assignee_role
      FROM tasks t
      LEFT JOIN users u_creator ON t.created_by = u_creator.id
      LEFT JOIN users u_assignee ON t.assigned_to = u_assignee.id
      WHERE t.id = $1
    `, [id]);

    if (!task) return reply.code(404).send({ error: 'Задача не найдена' });

    // Доступ: создатель, исполнитель или ADMIN/директор
    const canAccess = task.created_by === request.user.id
      || task.assigned_to === request.user.id
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
      INSERT INTO tasks (created_by, assigned_to, title, description, deadline, priority, creator_comment, status, created_at, updated_at)
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
    if (task.created_by !== request.user.id && request.user.role !== 'ADMIN') {
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
    const canAccess = task.created_by === request.user.id
      || task.assigned_to === request.user.id
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

    // ADMIN/Director может принять любую задачу; исполнитель — только свою
    let task;
    if (DIRECTOR_ROLES.includes(request.user.role)) {
      const { rows: [t] } = await db.query(
        'SELECT * FROM tasks WHERE id = $1 AND status = $2', [id, 'new']
      );
      task = t;
    } else {
      const { rows: [t] } = await db.query(
        'SELECT * FROM tasks WHERE id = $1 AND assigned_to = $2 AND status = $3',
        [id, request.user.id, 'new']
      );
      task = t;
    }
    if (!task) return reply.code(400).send({ error: 'Задача не найдена или не в статусе "Новая"' });

    await db.query(`
      UPDATE tasks SET status = 'accepted', accepted_at = NOW(), updated_at = NOW()
      WHERE id = $1
    `, [id]);

    // Уведомить создателя
    await notify(
      task.created_by,
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
      'SELECT * FROM tasks WHERE id = $1 AND assigned_to = $2 AND status IN ($3, $4)',
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

    // ADMIN/Director может завершить любую задачу; исполнитель — только свою
    let task;
    if (DIRECTOR_ROLES.includes(request.user.role)) {
      const { rows: [t] } = await db.query(
        'SELECT * FROM tasks WHERE id = $1 AND status IN ($2, $3, $4, $5)',
        [id, 'new', 'accepted', 'in_progress', 'overdue']
      );
      task = t;
    } else {
      const { rows: [t] } = await db.query(
        'SELECT * FROM tasks WHERE id = $1 AND assigned_to = $2 AND status IN ($3, $4, $5, $6)',
        [id, request.user.id, 'new', 'accepted', 'in_progress', 'overdue']
      );
      task = t;
    }
    if (!task) return reply.code(400).send({ error: 'Нельзя завершить эту задачу' });

    await db.query(`
      UPDATE tasks SET status = 'done', assignee_comment = $1, completed_at = NOW(), updated_at = NOW()
      WHERE id = $2
    `, [comment || null, id]);

    // Уведомить создателя
    await notify(
      task.created_by,
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
    if (task.created_by !== request.user.id && request.user.role !== 'ADMIN') {
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

    if (task.created_by !== request.user.id && request.user.role !== 'ADMIN') {
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
      FROM tasks t JOIN users u ON t.assigned_to = u.id
      WHERE t.status IN ('new', 'accepted', 'in_progress')
        AND t.deadline IS NOT NULL
        AND t.deadline BETWEEN NOW() AND NOW() + INTERVAL '24 hours'
    `);

    // Отправить напоминания
    for (const task of upcoming) {
      const hoursLeft = Math.max(0, Math.round((new Date(task.deadline) - Date.now()) / 3600000));
      await notify(
        task.assigned_to,
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

  // ╔═══════════════════════════════════════════════════════════════╗
  // ║                    КАНБАН-ДОСКА (M4)                         ║
  // ╚═══════════════════════════════════════════════════════════════╝

  const KANBAN_COLUMNS = ['new', 'in_progress', 'review', 'done'];

  // ───────────────────────────────────────────────────────────────
  // GET /api/tasks/kanban — Получить задачи для Канбан-доски
  // ───────────────────────────────────────────────────────────────
  fastify.get('/kanban', {
    preHandler: [fastify.requirePermission('tasks', 'read')]
  }, async (request) => {
    const userId = request.user.id;
    const { assignee_id, creator_id, priority, work_id, tender_id } = request.query;
    const isDirector = DIRECTOR_ROLES.includes(request.user.role);

    let sql = `
      SELECT t.*,
        u_creator.name as creator_name,
        u_assignee.name as assignee_name, u_assignee.role as assignee_role,
        (SELECT COUNT(*) FROM task_comments WHERE task_id = t.id) as comment_count
      FROM tasks t
      JOIN users u_creator ON t.created_by = u_creator.id
      JOIN users u_assignee ON t.assigned_to = u_assignee.id
      WHERE t.status != 'done' OR t.completed_at > NOW() - INTERVAL '7 days'
    `;
    const params = [];
    let idx = 1;

    // Фильтры
    if (!isDirector) {
      // Обычные пользователи видят только свои задачи или где они наблюдатели
      sql += ` AND (t.assigned_to = $${idx} OR t.created_by = $${idx} OR EXISTS (SELECT 1 FROM task_watchers WHERE task_id = t.id AND user_id = $${idx}))`;
      params.push(userId);
      idx++;
    }

    if (assignee_id) { sql += ` AND t.assigned_to = $${idx}`; params.push(parseInt(assignee_id)); idx++; }
    if (creator_id) { sql += ` AND t.created_by = $${idx}`; params.push(parseInt(creator_id)); idx++; }
    if (priority) { sql += ` AND t.priority = $${idx}`; params.push(priority); idx++; }
    if (work_id) { sql += ` AND t.work_id = $${idx}`; params.push(parseInt(work_id)); idx++; }
    if (tender_id) { sql += ` AND t.tender_id = $${idx}`; params.push(parseInt(tender_id)); idx++; }

    sql += ` ORDER BY t.kanban_position ASC, t.created_at DESC`;

    const { rows } = await db.query(sql, params);

    // Группировка по колонкам
    const columns = {};
    for (const col of KANBAN_COLUMNS) {
      columns[col] = [];
    }
    for (const task of rows) {
      const col = KANBAN_COLUMNS.includes(task.kanban_column) ? task.kanban_column : 'new';
      columns[col].push(task);
    }

    return { columns, tasks: rows };
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /api/tasks/:id/move — Переместить задачу в другую колонку
  // ───────────────────────────────────────────────────────────────
  fastify.put('/:id/move', {
    preHandler: [fastify.requirePermission('tasks', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const { column, position } = request.body;
    const userId = request.user.id;

    if (!KANBAN_COLUMNS.includes(column)) {
      return reply.code(400).send({ error: 'Недопустимая колонка' });
    }

    const { rows: [task] } = await db.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (!task) return reply.code(404).send({ error: 'Задача не найдена' });

    // Проверить права: исполнитель, создатель или директор
    const canMove = task.assigned_to === userId
      || task.created_by === userId
      || DIRECTOR_ROLES.includes(request.user.role);

    if (!canMove) {
      return reply.code(403).send({ error: 'Нет прав на перемещение' });
    }

    const oldColumn = task.kanban_column;
    const oldStatus = task.status;

    // Маппинг колонки → статус
    const columnToStatus = {
      'new': 'new',
      'in_progress': 'in_progress',
      'review': 'in_progress',
      'done': 'done'
    };

    const newStatus = columnToStatus[column];
    const updates = [
      'kanban_column = $1',
      'kanban_position = $2',
      'status = $3',
      'updated_at = NOW()'
    ];
    const values = [column, position || 0, newStatus];
    let paramIdx = 4;

    // Автоматическое проставление дат
    if (column === 'in_progress' && !task.accepted_at) {
      updates.push(`accepted_at = NOW()`);
    }
    if (column === 'done' && !task.completed_at) {
      updates.push(`completed_at = NOW()`);
    }

    values.push(id);
    await db.query(
      `UPDATE tasks SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
      values
    );

    // Добавить системный комментарий
    if (oldColumn !== column) {
      const columnNames = { new: 'Новые', in_progress: 'В работе', review: 'На проверке', done: 'Готово' };
      await db.query(`
        INSERT INTO task_comments (task_id, user_id, text, is_system, created_at, updated_at)
        VALUES ($1, $2, $3, true, NOW(), NOW())
      `, [id, userId, `Перемещено: ${columnNames[oldColumn] || oldColumn} → ${columnNames[column]}`]);
    }

    // Уведомления
    if (column === 'done' && oldStatus !== 'done') {
      await notify(
        task.created_by,
        '✅ Задача выполнена',
        `${request.user.name || request.user.login} завершил задачу «${task.title}»`,
        `#/kanban?id=${id}`
      );
    }

    return { success: true, newStatus };
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /api/tasks/:id/acknowledge — Подтвердить ознакомление
  // ───────────────────────────────────────────────────────────────
  fastify.put('/:id/acknowledge', {
    preHandler: [fastify.requirePermission('tasks', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const userId = request.user.id;

    const { rows: [task] } = await db.query(
      'SELECT * FROM tasks WHERE id = $1 AND assigned_to = $2',
      [id, userId]
    );
    if (!task) return reply.code(404).send({ error: 'Задача не найдена' });

    if (task.acknowledged_at) {
      return reply.code(400).send({ error: 'Уже подтверждено' });
    }

    await db.query(`
      UPDATE tasks SET acknowledged_at = NOW(), acknowledged_by = $1, updated_at = NOW()
      WHERE id = $2
    `, [userId, id]);

    // Уведомить создателя
    await notify(
      task.created_by,
      '👁️ Задача просмотрена',
      `${request.user.name || request.user.login} ознакомился с задачей «${task.title}»`,
      `#/kanban?id=${id}`
    );

    return { success: true };
  });

  // ╔═══════════════════════════════════════════════════════════════╗
  // ║                    КОММЕНТАРИИ К ЗАДАЧАМ                     ║
  // ╚═══════════════════════════════════════════════════════════════╝

  // ───────────────────────────────────────────────────────────────
  // GET /api/tasks/:id/comments — Получить комментарии
  // ───────────────────────────────────────────────────────────────
  fastify.get('/:id/comments', {
    preHandler: [fastify.requirePermission('tasks', 'read')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);

    const { rows: [task] } = await db.query('SELECT id FROM tasks WHERE id = $1', [id]);
    if (!task) return reply.code(404).send({ error: 'Задача не найдена' });

    const { rows } = await db.query(`
      SELECT c.*, u.name as user_name, u.role as user_role
      FROM task_comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.task_id = $1
      ORDER BY c.created_at ASC
    `, [id]);

    return { comments: rows };
  });

  // ───────────────────────────────────────────────────────────────
  // POST /api/tasks/:id/comments — Добавить комментарий
  // ───────────────────────────────────────────────────────────────
  fastify.post('/:id/comments', {
    preHandler: [fastify.requirePermission('tasks', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const userId = request.user.id;
    const { text } = request.body;

    if (!text || !text.trim()) {
      return reply.code(400).send({ error: 'Текст обязателен' });
    }

    const { rows: [task] } = await db.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (!task) return reply.code(404).send({ error: 'Задача не найдена' });

    const { rows: [comment] } = await db.query(`
      INSERT INTO task_comments (task_id, user_id, text, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      RETURNING *
    `, [id, userId, text.trim()]);

    // Уведомить участников (создателя, исполнителя, наблюдателей)
    const usersToNotify = new Set([task.created_by, task.assigned_to]);

    // task_watchers — если таблица существует
    try {
      const { rows: watchers } = await db.query('SELECT user_id FROM task_watchers WHERE task_id = $1', [id]);
      for (const w of watchers) usersToNotify.add(w.user_id);
    } catch (_) { /* table may not exist yet */ }

    usersToNotify.delete(userId); // Не уведомлять автора комментария

    const userName = request.user.name || request.user.login;
    for (const uid of usersToNotify) {
      await notify(
        uid,
        '💬 Новый комментарий',
        `${userName} прокомментировал задачу «${task.title}»:\n${text.trim().substring(0, 100)}`,
        `#/kanban?id=${id}`
      );
    }

    return { comment };
  });

  // ╔═══════════════════════════════════════════════════════════════╗
  // ║                    НАБЛЮДАТЕЛИ                               ║
  // ╚═══════════════════════════════════════════════════════════════╝

  // ───────────────────────────────────────────────────────────────
  // GET /api/tasks/:id/watchers — Получить наблюдателей
  // ───────────────────────────────────────────────────────────────
  fastify.get('/:id/watchers', {
    preHandler: [fastify.requirePermission('tasks', 'read')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);

    const { rows } = await db.query(`
      SELECT w.*, u.name, u.role
      FROM task_watchers w
      JOIN users u ON w.user_id = u.id
      WHERE w.task_id = $1
    `, [id]);

    return { watchers: rows };
  });

  // ───────────────────────────────────────────────────────────────
  // POST /api/tasks/:id/watchers — Добавить наблюдателя
  // ───────────────────────────────────────────────────────────────
  fastify.post('/:id/watchers', {
    preHandler: [fastify.requirePermission('tasks', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Некорректный ID задачи' });
    const { user_id } = request.body;

    if (!user_id) return reply.code(400).send({ error: 'user_id обязателен' });

    try {
      await db.query(`
        INSERT INTO task_watchers (task_id, user_id, created_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (task_id, user_id) DO NOTHING
      `, [id, parseInt(user_id)]);

      return { success: true };
    } catch (err) {
      if (err.code === '23503') {
        return reply.code(400).send({ error: 'Задача или пользователь не найдены' });
      }
      throw err;
    }
  });

  // ───────────────────────────────────────────────────────────────
  // DELETE /api/tasks/:id/watchers/:userId — Удалить наблюдателя
  // ───────────────────────────────────────────────────────────────
  fastify.delete('/:id/watchers/:userId', {
    preHandler: [fastify.requirePermission('tasks', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const watcherId = parseInt(request.params.userId);

    await db.query(
      'DELETE FROM task_watchers WHERE task_id = $1 AND user_id = $2',
      [id, watcherId]
    );

    return { success: true };
  });

  // ───────────────────────────────────────────────────────────────
  // POST /api/tasks/:id/watch — Подписаться на задачу (самому)
  // ───────────────────────────────────────────────────────────────
  fastify.post('/:id/watch', {
    preHandler: [fastify.requirePermission('tasks', 'read')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const userId = request.user.id;

    await db.query(`
      INSERT INTO task_watchers (task_id, user_id, created_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (task_id, user_id) DO NOTHING
    `, [id, userId]);

    return { success: true };
  });

  // ───────────────────────────────────────────────────────────────
  // DELETE /api/tasks/:id/watch — Отписаться от задачи
  // ───────────────────────────────────────────────────────────────
  fastify.delete('/:id/watch', {
    preHandler: [fastify.requirePermission('tasks', 'read')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const userId = request.user.id;

    await db.query(
      'DELETE FROM task_watchers WHERE task_id = $1 AND user_id = $2',
      [id, userId]
    );

    return { success: true };
  });
};
