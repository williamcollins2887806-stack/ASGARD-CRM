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
const taskChat = require('../services/taskChat');

module.exports = async function(fastify) {
  const db = fastify.db;
  const uploadDir = process.env.UPLOAD_DIR || './uploads';

  const DIRECTOR_ROLES = ["ADMIN", "DIRECTOR_GEN", "DIRECTOR_COMM", "DIRECTOR_DEV"];
  const HEAD_ROLES = ["HEAD_PM", "HEAD_TO"];
  const ESCALATION_TARGET_ROLES = [...DIRECTOR_ROLES, ...HEAD_ROLES];
  const MAX_WATCHERS = 20;

  // Valid task statuses (used in state machine validation)
  const VALID_TASK_STATUSES = ["new","accepted","in_progress","done","cancelled","overdue","pending","completed","declined","redirected"];

  // ═══════════════════════════════════════════════════════════════
  // HELPER: Получить HEAD_* для отдела по роли исполнителя
  // ═══════════════════════════════════════════════════════════════
  async function findDepartmentHead(assigneeRole) {
    // Маппинг: для каждой «обычной» роли — кто HEAD
    const map = {
      'PM':            ['HEAD_PM'],
      'TO':            ['HEAD_TO'],
      'PROC':          ['DIRECTOR_COMM','ADMIN'],
      'BUH':           ['DIRECTOR_GEN','ADMIN'],
      'WAREHOUSE':     ['CHIEF_ENGINEER','DIRECTOR_GEN','ADMIN'],
      'HR':            ['HR_MANAGER','DIRECTOR_GEN','ADMIN'],
      'OFFICE_MANAGER':['DIRECTOR_GEN','ADMIN'],
      'CHIEF_ENGINEER':['DIRECTOR_GEN','ADMIN'],
      'HEAD_PM':       ['DIRECTOR_GEN','ADMIN'],
      'HEAD_TO':       ['DIRECTOR_GEN','ADMIN'],
      'HR_MANAGER':    ['DIRECTOR_GEN','ADMIN']
    };
    const targets = map[assigneeRole] || ['DIRECTOR_GEN','ADMIN'];
    const { rows } = await db.query(
      `SELECT id, name, role FROM users WHERE role = ANY($1::text[]) AND is_active = true
       ORDER BY array_position($1::text[], role), id LIMIT 1`,
      [targets]
    );
    return rows[0] || null;
  }

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
  // GET /api/tasks — root list (alias for /my)
  // ───────────────────────────────────────────────────────────────
  fastify.get('/', {
    preHandler: [fastify.requirePermission('tasks', 'read')]
  }, async (request) => {
    const { status, limit = 50, offset = 0 } = request.query;
    let sql = `
      SELECT t.*, u_creator.name as creator_name
      FROM tasks t
      LEFT JOIN users u_creator ON t.creator_id = u_creator.id
      WHERE t.assignee_id = $1
    `;
    const params = [request.user.id];
    let idx = 2;
    if (status) { sql += ` AND t.status = $${idx}`; params.push(status); idx++; }
    sql += ` ORDER BY t.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(parseInt(limit), parseInt(offset));
    const { rows } = await db.query(sql, params);
    return { tasks: rows };
  });

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
    preHandler: [fastify.requirePermission('tasks', 'read')]
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
      LEFT JOIN users u_creator ON t.creator_id = u_creator.id
      LEFT JOIN users u_assignee ON t.assignee_id = u_assignee.id
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
  // GET /api/tasks/help/inbox — задачи-помощь, назначенные мне
  // ───────────────────────────────────────────────────────────────
  fastify.get('/help/inbox', {
    preHandler: [fastify.requirePermission('tasks', 'read')]
  }, async (request) => {
    const { status, limit = 100, offset = 0 } = request.query;
    let sql = `
      SELECT t.*, uc.name AS creator_name, uc.role AS creator_role,
             (SELECT COUNT(*) FROM task_watchers WHERE task_id = t.id) AS watchers_count,
             (SELECT COUNT(*) FROM chat_messages WHERE chat_id = t.chat_id AND COALESCE(is_system,false) = false) AS messages_count
      FROM tasks t
      LEFT JOIN users uc ON uc.id = t.creator_id
      WHERE t.assignee_id = $1 AND t.task_kind = 'help' AND t.archived_at IS NULL
    `;
    const params = [request.user.id];
    let idx = 2;
    if (status) { sql += ` AND t.status = $${idx}`; params.push(status); idx++; }
    sql += ` ORDER BY
      CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
      t.deadline ASC NULLS LAST, t.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(parseInt(limit), parseInt(offset));
    const { rows } = await db.query(sql, params);
    return { tasks: rows };
  });

  // ───────────────────────────────────────────────────────────────
  // GET /api/tasks/help/outbox — задачи-помощь, созданные мной
  // ───────────────────────────────────────────────────────────────
  fastify.get('/help/outbox', {
    preHandler: [fastify.requirePermission('tasks', 'read')]
  }, async (request) => {
    const { status, limit = 100, offset = 0 } = request.query;
    let sql = `
      SELECT t.*, ua.name AS assignee_name, ua.role AS assignee_role,
             (SELECT COUNT(*) FROM task_watchers WHERE task_id = t.id) AS watchers_count,
             (SELECT COUNT(*) FROM chat_messages WHERE chat_id = t.chat_id AND COALESCE(is_system,false) = false) AS messages_count
      FROM tasks t
      LEFT JOIN users ua ON ua.id = t.assignee_id
      WHERE t.creator_id = $1 AND t.task_kind = 'help' AND t.archived_at IS NULL
    `;
    const params = [request.user.id];
    let idx = 2;
    if (status) { sql += ` AND t.status = $${idx}`; params.push(status); idx++; }
    sql += ` ORDER BY t.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(parseInt(limit), parseInt(offset));
    const { rows } = await db.query(sql, params);
    return { tasks: rows };
  });

  // ───────────────────────────────────────────────────────────────
  // GET /api/tasks/help/watching — задачи-помощь, где я наблюдатель
  // ───────────────────────────────────────────────────────────────
  fastify.get('/help/watching', {
    preHandler: [fastify.requirePermission('tasks', 'read')]
  }, async (request) => {
    const { rows } = await db.query(`
      SELECT t.*, uc.name AS creator_name, ua.name AS assignee_name
      FROM tasks t
      JOIN task_watchers w ON w.task_id = t.id AND w.user_id = $1
      LEFT JOIN users uc ON uc.id = t.creator_id
      LEFT JOIN users ua ON ua.id = t.assignee_id
      WHERE t.task_kind = 'help' AND t.archived_at IS NULL
      ORDER BY t.created_at DESC LIMIT 100
    `, [request.user.id]);
    return { tasks: rows };
  });

  // ───────────────────────────────────────────────────────────────
  // GET /api/tasks/help/stats — счётчики для бейджей
  // ───────────────────────────────────────────────────────────────
  fastify.get('/help/stats', {
    preHandler: [fastify.requirePermission('tasks', 'read')]
  }, async (request) => {
    const uid = request.user.id;
    const { rows } = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM tasks WHERE assignee_id=$1 AND task_kind='help' AND status='new')           AS inbox_new,
        (SELECT COUNT(*) FROM tasks WHERE assignee_id=$1 AND task_kind='help' AND status IN ('accepted','in_progress')) AS inbox_active,
        (SELECT COUNT(*) FROM tasks WHERE assignee_id=$1 AND task_kind='help' AND status IN ('new','accepted','in_progress')
          AND deadline IS NOT NULL AND deadline < NOW())                                                  AS inbox_overdue,
        (SELECT COUNT(*) FROM tasks WHERE creator_id=$1  AND task_kind='help' AND status='declined')      AS outbox_declined,
        (SELECT COUNT(*) FROM tasks WHERE creator_id=$1  AND task_kind='help' AND status IN ('new','accepted','in_progress')) AS outbox_active
    `, [uid]);
    return rows[0] || {};
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
        t.assignee_id as assignee_id, t.creator_id as creator_id,
        u_creator.name as creator_name, u_creator.role as creator_role,
        u_assignee.name as assignee_name, u_assignee.role as assignee_role
      FROM tasks t
      LEFT JOIN users u_creator ON t.creator_id = u_creator.id
      LEFT JOIN users u_assignee ON t.assignee_id = u_assignee.id
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
  // POST /api/tasks — Создать задачу
  //   task_kind='directive' (по умолч.) — только DIRECTOR_ROLES, как раньше
  //   task_kind='help' — любой авторизованный сотрудник любому, +чат в Хугинне, +watcher_ids
  //
  // ВАЖНО: preHandler — только authenticate (для help). Для directive проверяется
  // внутри (DIRECTOR_ROLES). Старая проверка requirePermission('tasks','write')
  // блокировала ролям без tasks:write (BUH, PROC, OFFICE_MANAGER в role_presets) —
  // но help должен быть доступен любому активному.
  // ───────────────────────────────────────────────────────────────
  fastify.post('/', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    let {
      assignee_id, title, description, deadline, priority, creator_comment,
      task_kind, watcher_ids, work_id, tender_id
    } = request.body || {};

    const kind = (task_kind === 'help') ? 'help' : 'directive';

    // RBAC: directive → только DIRECTOR_ROLES; help → любой авторизованный
    if (kind === 'directive' && !DIRECTOR_ROLES.includes(request.user.role)) {
      return reply.code(403).send({ error: 'Директивы создаёт только руководство' });
    }

    if (!assignee_id) return reply.code(400).send({ error: 'Укажите исполнителя' });
    if (!title || !title.trim()) return reply.code(400).send({ error: 'Укажите название задачи' });

    // Truncate title to prevent VARCHAR overflow (max 255 chars)
    if (title.length > 255) title = title.slice(0, 255);

    const assigneeIdInt = parseInt(assignee_id);
    if (kind === 'help' && assigneeIdInt === request.user.id) {
      return reply.code(400).send({ error: 'Нельзя просить помощи у самого себя' });
    }

    // watchers лимит/валидация
    let watchers = Array.isArray(watcher_ids) ? watcher_ids.map(x => parseInt(x)).filter(x => !isNaN(x) && x > 0) : [];
    watchers = [...new Set(watchers)].filter(uid => uid !== request.user.id && uid !== assigneeIdInt);
    if (watchers.length > MAX_WATCHERS) {
      return reply.code(400).send({ error: `Слишком много наблюдателей (макс. ${MAX_WATCHERS})` });
    }

    try {
      // Проверить исполнителя
      const { rows: [assignee] } = await db.query(
        'SELECT id, name, role FROM users WHERE id = $1 AND is_active = true', [assigneeIdInt]
      );
      if (!assignee) return reply.code(400).send({ error: 'Исполнитель не найден или не активен' });

      // Проверить watcher'ов
      if (watchers.length) {
        const { rows: validWatchers } = await db.query(
          'SELECT id FROM users WHERE id = ANY($1::int[]) AND is_active = true',
          [watchers]
        );
        if (validWatchers.length !== watchers.length) {
          return reply.code(400).send({ error: 'Некоторые наблюдатели не найдены или не активны' });
        }
      }

      const result = await db.query(`
        INSERT INTO tasks (creator_id, assignee_id, title, description, deadline, priority,
                           creator_comment, status, task_kind, work_id, tender_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'new', $8, $9, $10, NOW(), NOW())
        RETURNING *
      `, [
        request.user.id, assigneeIdInt, title.trim(), description || null,
        deadline || null, priority || 'normal', creator_comment || null, kind,
        work_id ? parseInt(work_id) : null,
        tender_id ? parseInt(tender_id) : null
      ]);
      const task = result.rows[0];

      // Watchers
      for (const wid of watchers) {
        await db.query(
          `INSERT INTO task_watchers (task_id, user_id, created_at)
           VALUES ($1, $2, NOW()) ON CONFLICT (task_id, user_id) DO NOTHING`,
          [task.id, wid]
        );
      }

      // Чат в Хугинне (для help — всегда; для directive — нет, чтобы не перегружать)
      let chat = null;
      if (kind === 'help') {
        try {
          const r = await taskChat.createTaskChat(db, task.id, request.user);
          chat = r.chat;
        } catch (e) {
          fastify.log.error({ err: e }, 'taskChat.createTaskChat failed');
        }
      }

      // Уведомления
      const creatorName = request.user.name || request.user.login;
      const deadlineStr = deadline ? new Date(deadline).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : 'не указан';
      const priorityLabel = ({ urgent:'🔥 Горит', high:'⚠️ Важно', normal:'Обычно', low:'Низкий' })[priority || 'normal'] || priority || 'normal';
      const link = kind === 'help' ? `#/help?id=${task.id}` : `#/tasks?id=${task.id}`;
      const headTitle = kind === 'help' ? '🤝 Просьба о помощи' : '📋 Новая задача';
      const verb = kind === 'help' ? 'попросил помощи' : 'назначил вам задачу';

      await notify(
        assigneeIdInt, headTitle,
        `${creatorName} ${verb}:\n«${title.trim()}»\nСрок: ${deadlineStr} · ${priorityLabel}`,
        link
      );
      for (const wid of watchers) {
        await notify(wid, '👁 Подключили к задаче',
          `${creatorName} добавил вас наблюдателем в задачу «${title.trim()}»`, link);
      }

      return { task: { ...task, chat_id: chat?.id || task.chat_id || null }, chat };
    } catch (err) {
      fastify.log.error({ err }, 'Task creation error');
      if (err.code === '22001') return reply.code(400).send({ error: 'Значение поля слишком длинное' });
      if (err.code === '23502') return reply.code(400).send({ error: `Обязательное поле не заполнено: ${err.column || err.message}` });
      if (err.code === '23503') return reply.code(400).send({ error: 'Ссылка на несуществующую запись' });
      return reply.code(400).send({ error: err.message || 'Ошибка создания задачи' });
    }
  });

  // ───────────────────────────────────────────────────────────────
  // POST /api/tasks/:id/files — Загрузить файлы к задаче
  // ───────────────────────────────────────────────────────────────
  fastify.post('/:id/files', {
    preHandler: [fastify.requirePermission('tasks', 'write')]
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
    preHandler: [
      async (request, reply) => {
        if (!request.headers.authorization && request.query.token) {
          request.headers.authorization = 'Bearer ' + request.query.token;
        }
      },
      fastify.authenticate
    ]
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
  // PUT /api/tasks/:id/status — Диспетчер смены статуса
  // Маппит русские названия статусов на существующие роуты
  // ───────────────────────────────────────────────────────────────
  fastify.put('/:id/status', {
    preHandler: [fastify.requirePermission('tasks', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const { status } = request.body || {};
    if (!status) return reply.code(400).send({ error: 'Не указан статус' });

    const STATUS_MAP = {
      'Новая': 'new', 'В работе': 'in_progress',
      'Выполнена': 'done', 'Закрыта': 'cancelled',
      'new': 'new', 'in_progress': 'in_progress',
      'done': 'done', 'cancelled': 'cancelled'
    };
    const mapped = STATUS_MAP[status];
    if (!mapped) return reply.code(400).send({ error: 'Неизвестный статус: ' + status });

    const { rows: [task] } = await db.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (!task) return reply.code(404).send({ error: 'Задача не найдена' });

    const userId = request.user.id;
    const isDirector = DIRECTOR_ROLES.includes(request.user.role);

    if (mapped === 'in_progress') {
      const canStart = task.assignee_id === userId || task.assignee_id === null || isDirector;
      if (!canStart) return reply.code(403).send({ error: 'Нет прав' });
      const updates = ['status = $1', 'accepted_at = COALESCE(accepted_at, NOW())', 'updated_at = NOW()'];
      const vals = ['in_progress'];
      if (!task.assignee_id) { updates.push('assignee_id = $2'); vals.push(userId); }
      vals.push(id);
      await db.query(`UPDATE tasks SET ${updates.join(', ')} WHERE id = $${vals.length}`, vals);
    } else if (mapped === 'done') {
      const canComplete = task.assignee_id === userId || isDirector;
      if (!canComplete) return reply.code(403).send({ error: 'Нет прав' });
      await db.query('UPDATE tasks SET status = $1, completed_at = NOW(), updated_at = NOW() WHERE id = $2', ['done', id]);
    } else if (mapped === 'cancelled') {
      const canClose = task.creator_id === userId || isDirector;
      if (!canClose) return reply.code(403).send({ error: 'Нет прав' });
      await db.query('UPDATE tasks SET status = $1, updated_at = NOW() WHERE id = $2', ['cancelled', id]);
    } else if (mapped === 'new') {
      if (!isDirector) return reply.code(403).send({ error: 'Нет прав' });
      await db.query('UPDATE tasks SET status = $1, updated_at = NOW() WHERE id = $2', ['new', id]);
    }

    return { success: true, status: mapped };
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /api/tasks/:id/accept — Исполнитель принимает задачу
  // ───────────────────────────────────────────────────────────────
  fastify.put('/:id/accept', {
    preHandler: [fastify.requirePermission('tasks', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);

    const { rows: [task] } = await db.query(
      'SELECT * FROM tasks WHERE id = $1 AND status = $2', [id, 'new']
    );
    if (!task) return reply.code(400).send({ error: 'Задача не найдена или не в статусе "Новая"' });
    // Принимает только assignee (или директор/ADMIN — для overrides)
    if (task.assignee_id !== request.user.id && !DIRECTOR_ROLES.includes(request.user.role)) {
      return reply.code(403).send({ error: 'Принимать может только исполнитель' });
    }

    await db.query(`
      UPDATE tasks SET status = 'accepted', accepted_at = NOW(), updated_at = NOW()
      WHERE id = $1
    `, [id]);

    // Чат: system msg + обновить карточку
    const actorName = request.user.name || request.user.login;
    if (task.chat_id) {
      try {
        await taskChat.postSystemMessage(db, id, `✓ ${actorName} принял задачу`, { userId: request.user.id });
        await taskChat.refreshTaskCard(db, id);
      } catch (e) { fastify.log.error({ err: e }, 'taskChat accept'); }
    }

    // Уведомить создателя
    const link = task.task_kind === 'help' ? `#/help?id=${id}` : `#/tasks-admin?id=${id}`;
    await notify(task.creator_id, '👍 Задача принята',
      `${actorName} принял задачу «${task.title}»`, link);

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
      'SELECT * FROM tasks WHERE id = $1 AND (assignee_id = $2 OR assignee_id IS NULL) AND status IN ($3, $4, $5)',
      [id, request.user.id, 'new', 'accepted', 'assigned']
    );
    if (!task) return reply.code(400).send({ error: 'Нельзя начать эту задачу' });

    // If task has no assignee, assign it to the user who starts it
    if (!task.assignee_id) {
      await db.query(`
        UPDATE tasks SET status = 'in_progress', assignee_id = $1, accepted_at = COALESCE(accepted_at, NOW()), updated_at = NOW()
        WHERE id = $2
      `, [request.user.id, id]);
    } else {
      await db.query(`
        UPDATE tasks SET status = 'in_progress', accepted_at = COALESCE(accepted_at, NOW()), updated_at = NOW()
        WHERE id = $1
      `, [id]);
    }

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
        'SELECT * FROM tasks WHERE id = $1 AND assignee_id = $2 AND status IN ($3, $4, $5, $6)',
        [id, request.user.id, 'new', 'accepted', 'in_progress', 'overdue']
      );
      task = t;
    }
    if (!task) return reply.code(400).send({ error: 'Нельзя завершить эту задачу' });

    await db.query(`
      UPDATE tasks SET status = 'done', assignee_comment = $1, completed_at = NOW(), updated_at = NOW()
      WHERE id = $2
    `, [comment || null, id]);

    // Чат: system msg + обновить карточку + архивировать (для help — сразу read-only)
    const actorName = request.user.name || request.user.login;
    if (task.chat_id) {
      try {
        await taskChat.postSystemMessage(db, id,
          `✅ ${actorName} завершил задачу${comment ? `:\n«${comment}»` : ''}`,
          { userId: request.user.id });
        await taskChat.refreshTaskCard(db, id);
        if (task.task_kind === 'help') {
          await taskChat.archiveTaskChat(db, id);
          await taskChat.postSystemMessage(db, id, '🗄 Чат архивирован (задача завершена)', { userId: request.user.id });
        }
      } catch (e) { fastify.log.error({ err: e }, 'taskChat complete'); }
    }

    // Уведомить создателя + всех наблюдателей
    const link = task.task_kind === 'help' ? `#/help?id=${id}` : `#/tasks-admin?id=${id}`;
    await notify(task.creator_id, '✅ Задача выполнена',
      `${actorName} выполнил задачу «${task.title}»${comment ? '\nКомментарий: ' + comment : ''}`, link);

    try {
      const { rows: watchers } = await db.query('SELECT user_id FROM task_watchers WHERE task_id = $1', [id]);
      for (const w of watchers) {
        if (w.user_id !== request.user.id && w.user_id !== task.creator_id) {
          await notify(w.user_id, '✅ Задача завершена',
            `${actorName} завершил задачу «${task.title}»`, link);
        }
      }
    } catch (_) {}

    return { success: true };
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /api/tasks/:id/decline — Исполнитель отказывается с причиной
  //   Возврат создателю (status='declined'), создатель сам решает дальше
  //   (reassign / escalate / cancel).
  // ───────────────────────────────────────────────────────────────
  fastify.put('/:id/decline', {
    preHandler: [fastify.requirePermission('tasks', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });
    const { reason } = request.body || {};
    if (!reason || !reason.trim() || reason.trim().length < 5) {
      return reply.code(400).send({ error: 'Укажите причину отказа (мин. 5 символов)' });
    }

    const { rows: [task] } = await db.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (!task) return reply.code(404).send({ error: 'Задача не найдена' });
    if (task.assignee_id !== request.user.id) {
      return reply.code(403).send({ error: 'Отказаться может только исполнитель' });
    }
    if (!['new','accepted','in_progress'].includes(task.status)) {
      return reply.code(400).send({ error: 'Нельзя отказаться от задачи в этом статусе' });
    }

    await db.query(`
      UPDATE tasks
      SET status = 'declined', declined_reason = $1, declined_at = NOW(), declined_by = $2, updated_at = NOW()
      WHERE id = $3
    `, [reason.trim(), request.user.id, id]);

    const actorName = request.user.name || request.user.login;
    if (task.chat_id) {
      try {
        await taskChat.postSystemMessage(db, id,
          `❌ ${actorName} отказался: «${reason.trim()}»`, { userId: request.user.id });
        await taskChat.refreshTaskCard(db, id);
      } catch (e) { fastify.log.error({ err: e }, 'taskChat decline'); }
    }

    const link = task.task_kind === 'help' ? `#/help?id=${id}` : `#/tasks-admin?id=${id}`;
    await notify(task.creator_id, '❌ Отказ от задачи',
      `${actorName} отказался от задачи «${task.title}»\nПричина: ${reason.trim()}`, link);

    return { success: true };
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /api/tasks/:id/redirect — Исполнитель перенаправляет другому
  //   Только 1 раз за всю жизнь задачи (redirected_once=true блокирует).
  //   Старый исполнитель → в watchers (видит чат).
  // ───────────────────────────────────────────────────────────────
  fastify.put('/:id/redirect', {
    preHandler: [fastify.requirePermission('tasks', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });
    const { new_assignee_id, reason } = request.body || {};
    const newId = parseInt(new_assignee_id);
    if (!newId) return reply.code(400).send({ error: 'Укажите нового исполнителя' });
    if (!reason || !reason.trim() || reason.trim().length < 5) {
      return reply.code(400).send({ error: 'Укажите причину перенаправления (мин. 5 символов)' });
    }

    const { rows: [task] } = await db.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (!task) return reply.code(404).send({ error: 'Задача не найдена' });
    if (task.assignee_id !== request.user.id) {
      return reply.code(403).send({ error: 'Перенаправить может только текущий исполнитель' });
    }
    if (task.redirected_once) {
      return reply.code(409).send({ error: 'Эту задачу уже перенаправляли. Повторное перенаправление невозможно — откажитесь, чтобы создатель сам перевыдал.' });
    }
    if (!['new','accepted','in_progress'].includes(task.status)) {
      return reply.code(400).send({ error: 'Нельзя перенаправить в этом статусе' });
    }
    if (newId === task.creator_id) {
      return reply.code(400).send({ error: 'Нельзя перенаправить создателю задачи' });
    }
    if (newId === request.user.id) {
      return reply.code(400).send({ error: 'Нельзя перенаправить самому себе' });
    }

    const { rows: [newAssignee] } = await db.query(
      'SELECT id, name, role FROM users WHERE id = $1 AND is_active = true', [newId]
    );
    if (!newAssignee) return reply.code(400).send({ error: 'Новый исполнитель не найден или не активен' });

    // Старый исполнитель — в watchers (чтобы остался в чате и видел задачу)
    const oldAssignee = request.user.id;
    await db.query(`
      INSERT INTO task_watchers (task_id, user_id, created_at)
      VALUES ($1, $2, NOW()) ON CONFLICT (task_id, user_id) DO NOTHING
    `, [id, oldAssignee]);

    await db.query(`
      UPDATE tasks
      SET assignee_id = $1, status = 'new', accepted_at = NULL,
          redirected_from = $2, redirected_at = NOW(),
          redirected_once = true, redirect_reason = $3, updated_at = NOW()
      WHERE id = $4
    `, [newId, oldAssignee, reason.trim(), id]);

    const actorName = request.user.name || request.user.login;
    if (task.chat_id) {
      try {
        await taskChat.addParticipant(db, id, newId, 'member');
        await taskChat.postSystemMessage(db, id,
          `↪️ ${actorName} перенаправил задачу → ${newAssignee.name}.\nПричина: «${reason.trim()}»`,
          { userId: request.user.id });
        await taskChat.refreshTaskCard(db, id);
      } catch (e) { fastify.log.error({ err: e }, 'taskChat redirect'); }
    }

    const link = task.task_kind === 'help' ? `#/help?id=${id}` : `#/tasks?id=${id}`;
    await notify(newId, '↪️ Перенаправлено вам',
      `${actorName} перенаправил вам задачу «${task.title}»\nПричина: ${reason.trim()}`, link);
    await notify(task.creator_id, '↪️ Задача перенаправлена',
      `${actorName} перенаправил задачу «${task.title}» → ${newAssignee.name}\nПричина: ${reason.trim()}`, link);

    return { success: true, new_assignee: newAssignee };
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /api/tasks/:id/reassign — Создатель назначает нового исполнителя
  //   Доступен только после отказа (status='declined') и только creator.
  // ───────────────────────────────────────────────────────────────
  fastify.put('/:id/reassign', {
    preHandler: [fastify.requirePermission('tasks', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });
    const { new_assignee_id } = request.body || {};
    const newId = parseInt(new_assignee_id);
    if (!newId) return reply.code(400).send({ error: 'Укажите нового исполнителя' });

    const { rows: [task] } = await db.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (!task) return reply.code(404).send({ error: 'Задача не найдена' });
    if (task.creator_id !== request.user.id && request.user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Переназначить может только создатель' });
    }
    if (task.status !== 'declined') {
      return reply.code(400).send({ error: 'Переназначение доступно только для отказанных задач' });
    }
    if (newId === request.user.id) {
      return reply.code(400).send({ error: 'Нельзя переназначить самому себе' });
    }

    const { rows: [newAssignee] } = await db.query(
      'SELECT id, name, role FROM users WHERE id = $1 AND is_active = true', [newId]
    );
    if (!newAssignee) return reply.code(400).send({ error: 'Исполнитель не найден или не активен' });

    const oldAssignee = task.assignee_id;
    await db.query(`
      UPDATE tasks
      SET assignee_id = $1, status = 'new', accepted_at = NULL,
          declined_reason = NULL, declined_at = NULL, declined_by = NULL,
          updated_at = NOW()
      WHERE id = $2
    `, [newId, id]);

    const actorName = request.user.name || request.user.login;
    if (task.chat_id) {
      try {
        await taskChat.addParticipant(db, id, newId, 'member');
        await taskChat.postSystemMessage(db, id,
          `🔄 ${actorName} переназначил задачу → ${newAssignee.name}`, { userId: request.user.id });
        await taskChat.refreshTaskCard(db, id);
      } catch (e) { fastify.log.error({ err: e }, 'taskChat reassign'); }
    }

    const link = task.task_kind === 'help' ? `#/help?id=${id}` : `#/tasks?id=${id}`;
    await notify(newId, '📋 Задача назначена',
      `${actorName} назначил вам задачу «${task.title}»`, link);
    if (oldAssignee && oldAssignee !== newId) {
      await notify(oldAssignee, 'ℹ️ Задача переназначена',
        `Задача «${task.title}» переназначена другому исполнителю`, link);
    }

    return { success: true, new_assignee: newAssignee };
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /api/tasks/:id/escalate — Эскалация руководителю отдела
  //   Только creator, только после declined. Находит HEAD_* для роли
  //   исходного исполнителя и переназначает на него.
  // ───────────────────────────────────────────────────────────────
  fastify.put('/:id/escalate', {
    preHandler: [fastify.requirePermission('tasks', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    const { rows: [task] } = await db.query(`
      SELECT t.*, ua.role AS assignee_role
      FROM tasks t LEFT JOIN users ua ON ua.id = t.assignee_id WHERE t.id = $1
    `, [id]);
    if (!task) return reply.code(404).send({ error: 'Задача не найдена' });
    if (task.creator_id !== request.user.id && request.user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Эскалировать может только создатель' });
    }
    if (task.status !== 'declined') {
      return reply.code(400).send({ error: 'Эскалация доступна только для отказанных задач' });
    }

    const head = await findDepartmentHead(task.assignee_role);
    if (!head) {
      return reply.code(422).send({ error: 'Не удалось найти руководителя отдела для эскалации' });
    }
    if (head.id === request.user.id) {
      return reply.code(400).send({ error: 'Вы и так руководитель этого отдела — переназначьте задачу вручную' });
    }

    const oldAssignee = task.assignee_id;
    await db.query(`
      UPDATE tasks
      SET assignee_id = $1, status = 'new', accepted_at = NULL,
          escalated_at = NOW(), escalated_to = $1, updated_at = NOW()
      WHERE id = $2
    `, [head.id, id]);

    const actorName = request.user.name || request.user.login;
    if (task.chat_id) {
      try {
        await taskChat.addParticipant(db, id, head.id, 'member');
        await taskChat.postSystemMessage(db, id,
          `🛡 Задача эскалирована руководителю отдела: ${head.name} (${head.role})`,
          { userId: request.user.id });
        await taskChat.refreshTaskCard(db, id);
      } catch (e) { fastify.log.error({ err: e }, 'taskChat escalate'); }
    }

    const link = task.task_kind === 'help' ? `#/help?id=${id}` : `#/tasks?id=${id}`;
    await notify(head.id, '🛡 Эскалация задачи',
      `${actorName} эскалировал вам задачу «${task.title}» (отказался исполнитель отдела)`, link);

    return { success: true, escalated_to: head };
  });

  // ───────────────────────────────────────────────────────────────
  // POST /api/tasks/:id/watchers/bulk — Массовое добавление наблюдателей
  // ───────────────────────────────────────────────────────────────
  fastify.post('/:id/watchers/bulk', {
    preHandler: [fastify.requirePermission('tasks', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });
    const { user_ids } = request.body || {};
    if (!Array.isArray(user_ids) || user_ids.length === 0) {
      return reply.code(400).send({ error: 'user_ids[] обязателен' });
    }

    const { rows: [task] } = await db.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (!task) return reply.code(404).send({ error: 'Задача не найдена' });

    // Право: creator, assignee, или директор/ADMIN
    const canEdit = task.creator_id === request.user.id
      || task.assignee_id === request.user.id
      || DIRECTOR_ROLES.includes(request.user.role);
    if (!canEdit) return reply.code(403).send({ error: 'Нет прав' });

    let uids = user_ids.map(x => parseInt(x)).filter(x => !isNaN(x) && x > 0);
    uids = [...new Set(uids)].filter(uid => uid !== task.creator_id && uid !== task.assignee_id);

    // Проверить общий лимит
    const { rows: [{ count: existing }] } = await db.query(
      'SELECT COUNT(*)::int AS count FROM task_watchers WHERE task_id = $1', [id]
    );
    if (existing + uids.length > MAX_WATCHERS) {
      return reply.code(400).send({ error: `Превышен лимит наблюдателей (макс. ${MAX_WATCHERS}, сейчас ${existing})` });
    }

    // Валидация активности
    const { rows: validUsers } = await db.query(
      'SELECT id, name FROM users WHERE id = ANY($1::int[]) AND is_active = true', [uids]
    );
    if (validUsers.length === 0) return reply.code(400).send({ error: 'Нет валидных пользователей' });

    for (const u of validUsers) {
      await db.query(`
        INSERT INTO task_watchers (task_id, user_id, created_at)
        VALUES ($1, $2, NOW()) ON CONFLICT (task_id, user_id) DO NOTHING
      `, [id, u.id]);
      if (task.chat_id) {
        try { await taskChat.addParticipant(db, id, u.id, 'member'); } catch(_) {}
      }
    }

    if (task.chat_id) {
      const names = validUsers.map(u => u.name).join(', ');
      try {
        await taskChat.postSystemMessage(db, id,
          `👁 ${request.user.name || request.user.login} добавил наблюдателей: ${names}`,
          { userId: request.user.id });
      } catch(_) {}
    }

    const link = task.task_kind === 'help' ? `#/help?id=${id}` : `#/tasks?id=${id}`;
    for (const u of validUsers) {
      await notify(u.id, '👁 Подключили к задаче',
        `${request.user.name || request.user.login} добавил вас наблюдателем в задачу «${task.title}»`, link);
    }

    return { success: true, added: validUsers.length, watchers: validUsers };
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /api/tasks/:id — Редактирование задачи (создателем)
  // ───────────────────────────────────────────────────────────────
  fastify.put('/:id', {
    preHandler: [fastify.requirePermission('tasks', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });
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
    preHandler: [fastify.requirePermission('tasks', 'write')]
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

  // ─── TEMPLATES ─ (moved BEFORE GET /:id to avoid id-shadowing) ───
  fastify.get('/help/templates', {
    preHandler: [fastify.requirePermission('tasks', 'read')]
  }, async (request) => {
    const uid = request.user.id;
    const { rows } = await db.query(`
      SELECT t.*, u.name AS default_assignee_name
      FROM help_templates t
      LEFT JOIN users u ON u.id = t.default_assignee_id
      WHERE t.owner_id = $1 OR t.is_global = true
      ORDER BY t.use_count DESC, t.created_at DESC
      LIMIT 100
    `, [uid]);
    return { templates: rows };
  });

  fastify.post('/help/templates', {
    preHandler: [fastify.requirePermission('tasks', 'write')]
  }, async (request, reply) => {
    const u = request.user;
    const b = request.body || {};
    if (!b.name || !b.name.trim()) return reply.code(400).send({ error: 'Укажите название шаблона' });
    if (b.is_global && !DIRECTOR_ROLES.includes(u.role)) {
      return reply.code(403).send({ error: 'Делать шаблоны общими могут только директора/ADMIN' });
    }
    const dh = b.deadline_hours ? parseInt(b.deadline_hours) : null;
    if (dh !== null && (isNaN(dh) || dh < 0 || dh > 720)) {
      return reply.code(400).send({ error: 'deadline_hours: 0..720' });
    }
    const { rows: [t] } = await db.query(`
      INSERT INTO help_templates (owner_id, is_global, name, emoji, default_assignee_role, default_assignee_id, title_pattern, description, priority, deadline_hours, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW()) RETURNING *
    `, [
      u.id, !!b.is_global, b.name.trim().slice(0, 120),
      (b.emoji || '🤝').slice(0, 8),
      b.default_assignee_role || null,
      b.default_assignee_id ? parseInt(b.default_assignee_id) : null,
      b.title_pattern?.trim() || null,
      b.description?.trim() || null,
      b.priority || 'normal',
      dh
    ]);
    return { template: t };
  });

  fastify.put('/help/templates/:id', {
    preHandler: [fastify.requirePermission('tasks', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const u = request.user;
    const { rows: [t] } = await db.query('SELECT * FROM help_templates WHERE id=$1', [id]);
    if (!t) return reply.code(404).send({ error: 'Шаблон не найден' });
    if (t.owner_id !== u.id && u.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Редактировать может только владелец или ADMIN' });
    }
    const b = request.body || {};
    if (b.is_global !== undefined && !DIRECTOR_ROLES.includes(u.role)) {
      return reply.code(403).send({ error: 'Менять флаг "общий" могут только директора/ADMIN' });
    }
    const fields = ['name','emoji','default_assignee_role','default_assignee_id','title_pattern','description','priority','deadline_hours','is_global'];
    const updates = []; const vals = []; let idx = 1;
    for (const f of fields) {
      if (b[f] !== undefined) {
        updates.push(`${f} = $${idx}`);
        vals.push(f === 'is_global' ? !!b[f]
                : ['default_assignee_id','deadline_hours'].includes(f) ? (b[f] ? parseInt(b[f]) : null)
                : (typeof b[f] === 'string' ? b[f].trim().slice(0, 600) : b[f]));
        idx++;
      }
    }
    if (!updates.length) return reply.code(400).send({ error: 'Нет данных для обновления' });
    updates.push('updated_at = NOW()');
    vals.push(id);
    await db.query(`UPDATE help_templates SET ${updates.join(', ')} WHERE id = $${vals.length}`, vals);
    return { success: true };
  });

  fastify.delete('/help/templates/:id', {
    preHandler: [fastify.requirePermission('tasks', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const u = request.user;
    const { rows: [t] } = await db.query('SELECT * FROM help_templates WHERE id=$1', [id]);
    if (!t) return reply.code(404).send({ error: 'Шаблон не найден' });
    if (t.owner_id !== u.id && u.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Удалить может только владелец или ADMIN' });
    }
    await db.query('DELETE FROM help_templates WHERE id=$1', [id]);
    return { success: true };
  });

  // POST /help/templates/:id/use — создать help-задачу из шаблона
  // (доп. overrides: assignee_id, title, description, deadline)
  fastify.post('/help/templates/:id/use', {
    preHandler: [fastify.requirePermission('tasks', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const u = request.user;
    const { rows: [t] } = await db.query(`
      SELECT * FROM help_templates WHERE id=$1 AND (owner_id=$2 OR is_global=true)
    `, [id, u.id]);
    if (!t) return reply.code(404).send({ error: 'Шаблон не найден или нет доступа' });
    const b = request.body || {};

    const assigneeId = b.assignee_id ? parseInt(b.assignee_id) : t.default_assignee_id;
    if (!assigneeId) return reply.code(400).send({ error: 'У шаблона не задан исполнитель, укажите assignee_id' });
    if (assigneeId === u.id) return reply.code(400).send({ error: 'Нельзя просить помощи у самого себя' });

    const { rows: [assignee] } = await db.query(
      'SELECT id, name FROM users WHERE id=$1 AND is_active=true', [assigneeId]
    );
    if (!assignee) return reply.code(400).send({ error: 'Исполнитель не найден или не активен' });

    // Применить title_pattern: {{work}} {{customer}} {{me}} {{date}}
    const today = new Date().toLocaleDateString('ru-RU');
    let title = b.title?.trim() || (t.title_pattern || t.name || 'Помощь')
      .replace(/\{\{work\}\}/g, b.work_title || '')
      .replace(/\{\{customer\}\}/g, b.customer || '')
      .replace(/\{\{me\}\}/g, u.name || u.login || '')
      .replace(/\{\{date\}\}/g, today)
      .trim();
    if (title.length > 255) title = title.slice(0, 255);
    if (!title) title = t.name;

    const description = b.description?.trim() || t.description || null;
    const priority = b.priority || t.priority || 'normal';
    const deadline = b.deadline
      ? new Date(b.deadline).toISOString()
      : (t.deadline_hours ? new Date(Date.now() + t.deadline_hours * 3600000).toISOString() : null);

    const { rows: [task] } = await db.query(`
      INSERT INTO tasks (creator_id, assignee_id, title, description, deadline, priority, status, task_kind, work_id, tender_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'new', 'help', $7, $8, NOW(), NOW()) RETURNING *
    `, [u.id, assigneeId, title, description, deadline, priority, b.work_id || null, b.tender_id || null]);

    // Чат
    let chat = null;
    try { const r = await taskChat.createTaskChat(db, task.id, u); chat = r.chat; }
    catch (e) { fastify.log.error({ err: e }, 'taskChat from template'); }

    // Использования
    await db.query('UPDATE help_templates SET use_count = use_count + 1 WHERE id=$1', [id]);

    // Уведомление
    await notify(
      assigneeId, '🤝 Просьба о помощи',
      `${u.name || u.login} ${t.emoji || '🤝'} «${title}»`,
      `#/help?id=${task.id}`
    );

    return { task: { ...task, chat_id: chat?.id || null }, template_used: t.id };
  });

  // ─── RATINGS ───────────────────────────────────────────────────
  // Creator оценивает завершённую задачу 1-5 звёзд + «спасибо».
  fastify.post('/:id/rate', {
    preHandler: [fastify.requirePermission('tasks', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const { stars, thanks_text } = request.body || {};
    const s = parseInt(stars);
    if (!Number.isInteger(s) || s < 1 || s > 5) {
      return reply.code(400).send({ error: 'stars: 1..5' });
    }
    const { rows: [task] } = await db.query('SELECT * FROM tasks WHERE id=$1', [id]);
    if (!task) return reply.code(404).send({ error: 'Задача не найдена' });
    if (task.creator_id !== request.user.id) {
      return reply.code(403).send({ error: 'Оценивать может только создатель задачи' });
    }
    if (task.status !== 'done') {
      return reply.code(400).send({ error: 'Оценка доступна только для завершённых задач' });
    }
    if (!task.assignee_id) return reply.code(400).send({ error: 'У задачи нет исполнителя' });

    try {
      await db.query(`
        INSERT INTO help_ratings (task_id, rater_id, rated_id, stars, thanks_text, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (task_id, rater_id) DO UPDATE
          SET stars = EXCLUDED.stars, thanks_text = EXCLUDED.thanks_text, created_at = NOW()
      `, [id, request.user.id, task.assignee_id, s, (thanks_text || '').slice(0, 500) || null]);
    } catch (e) {
      fastify.log.error({ err: e }, 'help rate');
      return reply.code(500).send({ error: 'Не удалось сохранить оценку' });
    }

    // System msg в чат + notify
    if (task.chat_id) {
      const stars5 = '⭐'.repeat(s) + '☆'.repeat(5 - s);
      try { await taskChat.postSystemMessage(db, id,
        `${stars5} ${request.user.name || request.user.login} оценил помощь${thanks_text ? `:\n«${thanks_text}»` : ''}`,
        { userId: request.user.id }); } catch (_) {}
    }
    await notify(
      task.assignee_id, '⭐ Получена оценка',
      `${request.user.name || request.user.login} оценил вашу помощь: ${s}/5${thanks_text ? `\n«${thanks_text}»` : ''}`,
      task.task_kind === 'help' ? `#/help?id=${id}` : `#/tasks?id=${id}`
    );

    return { success: true };
  });

  // GET /:id/rating — получить оценку задачи (если есть)
  fastify.get('/:id/rating', {
    preHandler: [fastify.requirePermission('tasks', 'read')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const r = await db.query('SELECT * FROM help_ratings WHERE task_id=$1 LIMIT 1', [id]);
    return { rating: r.rows[0] || null };
  });

  // ─── ANALYTICS ─────────────────────────────────────────────────
  // GET /help/analytics?period=30d → агрегаты «кто кому больше помогал»
  fastify.get('/help/analytics', {
    preHandler: [fastify.requirePermission('tasks', 'read')]
  }, async (request) => {
    const period = (request.query.period || '30d');
    const days = ({ '7d':7, '30d':30, '90d':90, 'all':3650 })[period] || 30;
    const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

    // Top помощников: сколько раз был исполнителем + средний рейтинг + кол-во звёзд
    const topHelpers = await db.query(`
      SELECT u.id, u.name, u.role,
        COUNT(t.id) FILTER (WHERE t.status = 'done')     AS done_count,
        COUNT(t.id) FILTER (WHERE t.status = 'declined') AS declined_count,
        COUNT(t.id) AS total_assigned,
        ROUND(AVG(r.stars)::numeric, 2) AS avg_rating,
        COUNT(r.id) AS rated_count
      FROM users u
      LEFT JOIN tasks t ON t.assignee_id = u.id AND t.task_kind = 'help' AND t.created_at >= $1
      LEFT JOIN help_ratings r ON r.task_id = t.id
      WHERE u.is_active = true
      GROUP BY u.id, u.name, u.role
      HAVING COUNT(t.id) > 0
      ORDER BY done_count DESC, avg_rating DESC NULLS LAST
      LIMIT 20
    `, [since]);

    // Top просящих: сколько раз были creator
    const topRequesters = await db.query(`
      SELECT u.id, u.name, u.role,
        COUNT(t.id) AS total_requested,
        COUNT(t.id) FILTER (WHERE t.status = 'done')     AS done_count,
        COUNT(t.id) FILTER (WHERE t.status = 'declined') AS declined_count
      FROM users u
      JOIN tasks t ON t.creator_id = u.id AND t.task_kind = 'help' AND t.created_at >= $1
      WHERE u.is_active = true
      GROUP BY u.id, u.name, u.role
      ORDER BY total_requested DESC
      LIMIT 20
    `, [since]);

    // Связи (пары): кто чаще кому пишет
    const pairs = await db.query(`
      SELECT
        c.id   AS from_id, c.name AS from_name, c.role AS from_role,
        a.id   AS to_id,   a.name AS to_name,   a.role AS to_role,
        COUNT(t.id) AS interactions
      FROM tasks t
      JOIN users c ON c.id = t.creator_id
      JOIN users a ON a.id = t.assignee_id
      WHERE t.task_kind = 'help' AND t.created_at >= $1
      GROUP BY c.id, c.name, c.role, a.id, a.name, a.role
      ORDER BY interactions DESC
      LIMIT 15
    `, [since]);

    // Сводка
    const summary = await db.query(`
      SELECT
        COUNT(*)                                                 AS total,
        COUNT(*) FILTER (WHERE status = 'done')                  AS done,
        COUNT(*) FILTER (WHERE status = 'declined')              AS declined,
        COUNT(*) FILTER (WHERE status IN ('new','accepted','in_progress')) AS active,
        COUNT(*) FILTER (WHERE redirected_once = true)           AS redirected,
        ROUND((AVG(EXTRACT(EPOCH FROM (completed_at - created_at))/3600.0)
               FILTER (WHERE status = 'done'))::numeric, 1)        AS avg_completion_hours
      FROM tasks WHERE task_kind = 'help' AND created_at >= $1
    `, [since]);

    return {
      period, days,
      summary: summary.rows[0] || {},
      top_helpers: topHelpers.rows,
      top_requesters: topRequesters.rows,
      top_pairs: pairs.rows
    };
  });

  // ─── AI-SUGGEST ─────────────────────────────────────────────────
  // POST /help/ai-suggest {description} → {suggested:[{user_id, name, role, reason}], dept_hint}
  // Без LLM (для скорости + без расхода токенов на простой задаче): match по ключевым словам
  // + статистика прошлых help-задач (popularity). Если хочется LLM — заменить эту функцию на
  // call к aiProvider.completeFast() с prompt + список юзеров — но это +задержка/+цена.
  fastify.post('/help/ai-suggest', {
    preHandler: [fastify.requirePermission('tasks', 'write')]
  }, async (request, reply) => {
    const text = String(request.body?.description || request.body?.title || '').toLowerCase();
    if (text.length < 5) return reply.code(400).send({ error: 'Слишком короткое описание' });

    // Простая эвристика: ключевые слова → отдел
    const KEYS = {
      TO:  ['тз','смет','просчёт','просчет','чертёж','чертеж','объект','оборудование','нормы','гэсн','работ','технич'],
      PROC:['закуп','счёт','счет','поставщик','счёт-фактур','счет-фактур','оплат','тендер','доставк','каталог','артикул'],
      BUH: ['акт','счёт-фактур','выписк','платёж','бухгалт','налог','финанс','ндс','декларац','выручк'],
      PM:  ['работ','проект','объект','подряд','бригад','график','мобилизац','рп'],
      HR:  ['кадр','собеседован','зарплат','штат','найм','увольн','декрет','отпуск'],
      OFFICE_MANAGER: ['офис','канцеляр','уборщ','чай','кофе','встреч','перегов','почт'],
      WAREHOUSE: ['склад','остатк','инвентар','выдача оборудован','наличи'],
      CHIEF_ENGINEER: ['инжен','технологи','авари','неисправ','ремонт']
    };
    const scored = [];
    for (const [role, kws] of Object.entries(KEYS)) {
      let score = 0;
      for (const kw of kws) if (text.includes(kw)) score++;
      if (score > 0) scored.push({ role, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const topDepts = scored.slice(0, 3).map(x => x.role);

    if (!topDepts.length) {
      return { suggested: [], dept_hint: null, reason: 'Не удалось определить отдел по описанию' };
    }

    // Поиск top-помощников из этих отделов за 90 дней (по done_count + avg_rating)
    const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
    const { rows: candidates } = await db.query(`
      SELECT u.id, u.name, u.role,
        COUNT(t.id) FILTER (WHERE t.status = 'done')     AS done_count,
        COUNT(t.id) FILTER (WHERE t.status = 'declined') AS declined_count,
        ROUND(AVG(r.stars)::numeric, 2) AS avg_rating
      FROM users u
      LEFT JOIN tasks t ON t.assignee_id = u.id AND t.task_kind = 'help' AND t.created_at >= $1
      LEFT JOIN help_ratings r ON r.task_id = t.id
      WHERE u.is_active = true AND u.role = ANY($2::text[]) AND u.id <> $3
      GROUP BY u.id, u.name, u.role
      ORDER BY done_count DESC NULLS LAST, avg_rating DESC NULLS LAST
      LIMIT 5
    `, [since, topDepts, request.user.id]);

    return {
      suggested: candidates.map(c => ({
        user_id: c.id, name: c.name, role: c.role,
        done_count: parseInt(c.done_count || 0),
        avg_rating: c.avg_rating ? parseFloat(c.avg_rating) : null,
        reason: `Опыт: ${c.done_count || 0} задач${c.avg_rating ? `, рейтинг ${c.avg_rating}/5` : ''}`
      })),
      dept_hint: topDepts[0],
      detected_depts: topDepts
    };
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
    preHandler: [fastify.requirePermission('tasks', 'read')]
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
    preHandler: [fastify.requirePermission('tasks', 'write')]
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
    preHandler: [fastify.requirePermission('tasks', 'write')]
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
    preHandler: [fastify.requirePermission('tasks', 'write')]
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
    preHandler: [fastify.requirePermission('tasks', 'write')]
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
    preHandler: [fastify.requirePermission('tasks', 'write')]
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
      JOIN users u_creator ON t.creator_id = u_creator.id
      JOIN users u_assignee ON t.assignee_id = u_assignee.id
      WHERE t.status != 'done' OR t.completed_at > NOW() - INTERVAL '7 days'
    `;
    const params = [];
    let idx = 1;

    // Фильтры
    if (!isDirector) {
      // Обычные пользователи видят только свои задачи или где они наблюдатели
      sql += ` AND (t.assignee_id = $${idx} OR t.creator_id = $${idx} OR EXISTS (SELECT 1 FROM task_watchers WHERE task_id = t.id AND user_id = $${idx}))`;
      params.push(userId);
      idx++;
    }

    if (assignee_id) { sql += ` AND t.assignee_id = $${idx}`; params.push(parseInt(assignee_id)); idx++; }
    if (creator_id) { sql += ` AND t.creator_id = $${idx}`; params.push(parseInt(creator_id)); idx++; }
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
    const canMove = task.assignee_id === userId
      || task.creator_id === userId
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
        task.creator_id,
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
      'SELECT * FROM tasks WHERE id = $1 AND assignee_id = $2',
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
      task.creator_id,
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
    const usersToNotify = new Set([task.creator_id, task.assignee_id]);

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

  // ═══════════════════════════════════════════════════════════════
  // ARCHIVE ENDPOINTS (Phase 3)
  // ═══════════════════════════════════════════════════════════════

  // ───────────────────────────────────────────────────────────────
  // POST /api/tasks/:id/archive — Архивировать завершённую задачу
  // ───────────────────────────────────────────────────────────────
  fastify.post('/:id/archive', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const userId = request.user.id;

    const task = (await db.query('SELECT * FROM tasks WHERE id = $1', [id])).rows[0];
    if (!task) return reply.code(404).send({ error: 'Задача не найдена' });

    if (task.status !== 'done' && task.status !== 'completed') {
      return reply.code(400).send({ error: 'Можно архивировать только завершённые задачи' });
    }

    if (task.archived_at) {
      return reply.code(400).send({ error: 'Задача уже в архиве' });
    }

    await db.query(
      'UPDATE tasks SET archived_at = NOW(), archived_by = $1 WHERE id = $2',
      [userId, id]
    );

    return { success: true, message: 'Задача перемещена в архив' };
  });

  // ───────────────────────────────────────────────────────────────
  // POST /api/tasks/:id/unarchive — Восстановить задачу из архива
  // ───────────────────────────────────────────────────────────────
  fastify.post('/:id/unarchive', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const task = (await db.query('SELECT * FROM tasks WHERE id = $1', [id])).rows[0];
    if (!task) return reply.code(404).send({ error: 'Задача не найдена' });

    if (!task.archived_at) {
      return reply.code(400).send({ error: 'Задача не в архиве' });
    }

    await db.query(
      'UPDATE tasks SET archived_at = NULL, archived_by = NULL WHERE id = $1',
      [id]
    );

    return { success: true, message: 'Задача восстановлена из архива' };
  });

  // ───────────────────────────────────────────────────────────────
  // GET /api/tasks/archived — Список архивных задач
  // ───────────────────────────────────────────────────────────────
  fastify.get('/archived', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const userId = request.user.id;
    const role = request.user.role;

    let query, params;
    if (DIRECTOR_ROLES.includes(role)) {
      query = `SELECT t.*, u1.name as creator_name, u2.name as assignee_name
               FROM tasks t
               LEFT JOIN users u1 ON t.creator_id = u1.id
               LEFT JOIN users u2 ON t.assignee_id = u2.id
               WHERE t.archived_at IS NOT NULL
               ORDER BY t.archived_at DESC`;
      params = [];
    } else {
      query = `SELECT t.*, u1.name as creator_name, u2.name as assignee_name
               FROM tasks t
               LEFT JOIN users u1 ON t.creator_id = u1.id
               LEFT JOIN users u2 ON t.assignee_id = u2.id
               WHERE t.archived_at IS NOT NULL AND (t.assignee_id = $1 OR t.creator_id = $1)
               ORDER BY t.archived_at DESC`;
      params = [userId];
    }

    const result = await db.query(query, params);
    return result.rows;
  });
};
