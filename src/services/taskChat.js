'use strict';

/**
 * ASGARD CRM — Сервис чата для задач-помощи (модуль «Помощь коллеги»).
 * Каждая help-задача = автоматический чат в Хугинне с участниками
 * (создатель + исполнитель + наблюдатели). При завершении — архивируется.
 *
 * Паттерн из estimateChat.js / workChat.js. См. также:
 *   src/routes/tasks.js — вызовы при create/decline/redirect/complete/reassign/escalate
 *   migrations/V212__tasks_help_extension.sql — колонка tasks.chat_id
 */

let sendToUser;
try { sendToUser = require('../routes/sse').sendToUser; } catch (e) { sendToUser = () => {}; }

/**
 * Создать чат для задачи (если ещё не существует).
 * Возвращает {chat, created:boolean}.
 */
async function createTaskChat(db, taskId, actor) {
  // 1. Если чат уже привязан — возвращаем
  const taskRes = await db.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
  const task = taskRes.rows[0];
  if (!task) return { chat: null, created: false };

  if (task.chat_id) {
    const existing = await db.query('SELECT * FROM chats WHERE id = $1', [task.chat_id]);
    if (existing.rows[0]) return { chat: existing.rows[0], created: false };
  }

  // 2. Защита от гонки — проверка по entity_type+entity_id
  const dup = await db.query(
    "SELECT * FROM chats WHERE entity_type = 'task' AND entity_id = $1",
    [taskId]
  );
  if (dup.rows[0]) {
    await db.query('UPDATE tasks SET chat_id = $1 WHERE id = $2', [dup.rows[0].id, taskId]);
    return { chat: dup.rows[0], created: false };
  }

  // 3. Участники: creator + assignee + watchers
  const participants = new Set();
  if (task.creator_id)  participants.add(task.creator_id);
  if (task.assignee_id) participants.add(task.assignee_id);

  const watchers = await db.query('SELECT user_id FROM task_watchers WHERE task_id = $1', [taskId]);
  for (const w of watchers.rows) participants.add(w.user_id);

  // 4. Имена для метаданных
  const userRes = await db.query(
    "SELECT id, name, role FROM users WHERE id = ANY($1::int[])",
    [[task.creator_id, task.assignee_id]]
  );
  const userMap = Object.fromEntries(userRes.rows.map(u => [u.id, u]));
  const creator  = userMap[task.creator_id]  || { name: 'Создатель' };
  const assignee = userMap[task.assignee_id] || { name: 'Исполнитель' };

  // 5. Создать чат
  const titleTrim = (task.title || 'Без названия').slice(0, 120);
  const chatName = `🤝 ${titleTrim}`;
  const { rows: [chat] } = await db.query(`
    INSERT INTO chats (name, type, is_group, entity_type, entity_id, auto_created, created_at, updated_at, last_message_at)
    VALUES ($1, 'task', true, 'task', $2, true, NOW(), NOW(), NOW())
    RETURNING *
  `, [chatName, taskId]);

  // 6. Участники
  const memberArr = [...participants];
  for (const uid of memberArr) {
    const role = uid === task.creator_id ? 'owner' : 'member';
    await db.query(
      `INSERT INTO chat_group_members (chat_id, user_id, role, joined_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (chat_id, user_id) DO NOTHING`,
      [chat.id, uid, role]
    );
  }

  // 7. Pinned task_card
  const cardMetadata = {
    task_id: taskId,
    task_kind: task.task_kind || 'help',
    status: task.status,
    title: task.title,
    description: task.description,
    priority: task.priority || 'normal',
    deadline: task.deadline,
    creator_id: task.creator_id,
    creator_name: creator.name,
    creator_role: creator.role,
    assignee_id: task.assignee_id,
    assignee_name: assignee.name,
    assignee_role: assignee.role,
    work_id: task.work_id,
    tender_id: task.tender_id,
    files_count: Array.isArray(task.files) ? task.files.length : 0
  };

  const { rows: [cardMsg] } = await db.query(`
    INSERT INTO chat_messages (chat_id, user_id, message, message_type, metadata, is_system, created_at, updated_at)
    VALUES ($1, $2, $3, 'task_card', $4::jsonb, false, NOW(), NOW())
    RETURNING *
  `, [chat.id, task.creator_id, `🤝 Задача #${taskId}: ${titleTrim}`, JSON.stringify(cardMetadata)]);

  // pinned_messages может не существовать — попытка
  try {
    await db.query(
      `INSERT INTO pinned_messages (chat_id, message_id, pinned_by, pinned_at)
       VALUES ($1, $2, $3, NOW()) ON CONFLICT DO NOTHING`,
      [chat.id, cardMsg.id, task.creator_id]
    );
  } catch (e) { /* table optional */ }

  // 8. Системное сообщение
  const actorName = (actor && actor.name) || creator.name || 'Создатель';
  const deadlineStr = task.deadline
    ? new Date(task.deadline).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
    : 'не указан';
  const priorityLabel = ({ urgent:'🔥 Горит', high:'⚠️ Важно', normal:'Обычно', low:'Низкий' })[task.priority] || task.priority;
  await db.query(`
    INSERT INTO chat_messages (chat_id, user_id, message, message_type, is_system, created_at, updated_at)
    VALUES ($1, $2, $3, 'system', true, NOW(), NOW())
  `, [chat.id, task.creator_id,
      `🤝 ${actorName} попросил помощи у ${assignee.name}.\nСрок: ${deadlineStr} · Приоритет: ${priorityLabel}`]);

  // 9. Каунтер сообщений
  await db.query(
    'UPDATE chats SET message_count = 2, last_message_at = NOW() WHERE id = $1',
    [chat.id]
  );

  // 10. Привязка к задаче
  await db.query('UPDATE tasks SET chat_id = $1, updated_at = NOW() WHERE id = $2', [chat.id, taskId]);

  // 11. SSE
  for (const uid of memberArr) {
    if (uid !== task.creator_id) {
      try { sendToUser(uid, 'chat:new_chat', { chat_id: chat.id, chat_name: chatName, entity_type: 'task', entity_id: taskId }); } catch(_) {}
    }
  }

  return { chat, created: true };
}

/**
 * Системное сообщение в чат задачи.
 * Если чата нет — пропускает молча.
 */
async function postSystemMessage(db, taskId, text, opts = {}) {
  const r = await db.query('SELECT chat_id, creator_id FROM tasks WHERE id = $1', [taskId]);
  const task = r.rows[0];
  if (!task || !task.chat_id) return null;

  const userId = opts.userId || task.creator_id;
  const messageType = opts.messageType || 'system';

  const { rows: [msg] } = await db.query(`
    INSERT INTO chat_messages (chat_id, user_id, message, message_type, is_system, created_at, updated_at)
    VALUES ($1, $2, $3, $4, true, NOW(), NOW())
    RETURNING *
  `, [task.chat_id, userId, text, messageType]);

  await db.query(
    'UPDATE chats SET message_count = COALESCE(message_count,0) + 1, last_message_at = NOW() WHERE id = $1',
    [task.chat_id]
  );
  return msg;
}

/**
 * Добавить участника в чат задачи (idempotent).
 */
async function addParticipant(db, taskId, userId, role = 'member') {
  const r = await db.query('SELECT chat_id FROM tasks WHERE id = $1', [taskId]);
  const chatId = r.rows[0]?.chat_id;
  if (!chatId) return false;
  await db.query(
    `INSERT INTO chat_group_members (chat_id, user_id, role, joined_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (chat_id, user_id) DO NOTHING`,
    [chatId, userId, role]
  );
  try { sendToUser(userId, 'chat:added_to_chat', { chat_id: chatId }); } catch(_) {}
  return true;
}

/**
 * Удалить участника из чата задачи (мягко: остаётся как watcher только если нужно).
 */
async function removeParticipant(db, taskId, userId) {
  const r = await db.query('SELECT chat_id FROM tasks WHERE id = $1', [taskId]);
  const chatId = r.rows[0]?.chat_id;
  if (!chatId) return false;
  await db.query('DELETE FROM chat_group_members WHERE chat_id = $1 AND user_id = $2', [chatId, userId]);
  return true;
}

/**
 * Архивировать чат задачи (read-only). Не удаляет историю.
 */
async function archiveTaskChat(db, taskId) {
  const r = await db.query('SELECT chat_id FROM tasks WHERE id = $1', [taskId]);
  const chatId = r.rows[0]?.chat_id;
  if (!chatId) return false;
  await db.query(
    'UPDATE chats SET archived_at = NOW(), is_readonly = true, updated_at = NOW() WHERE id = $1 AND archived_at IS NULL',
    [chatId]
  );
  return true;
}

/**
 * Расархивировать (если creator/assignee решил продолжить обсуждение).
 */
async function unarchiveTaskChat(db, taskId) {
  const r = await db.query('SELECT chat_id FROM tasks WHERE id = $1', [taskId]);
  const chatId = r.rows[0]?.chat_id;
  if (!chatId) return false;
  await db.query(
    'UPDATE chats SET archived_at = NULL, is_readonly = false, updated_at = NOW() WHERE id = $1',
    [chatId]
  );
  return true;
}

/**
 * Обновить pinned task_card после изменения задачи (статус/исполнитель/дедлайн).
 */
async function refreshTaskCard(db, taskId) {
  const tr = await db.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
  const task = tr.rows[0];
  if (!task || !task.chat_id) return false;

  const userRes = await db.query(
    "SELECT id, name, role FROM users WHERE id = ANY($1::int[])",
    [[task.creator_id, task.assignee_id]]
  );
  const userMap = Object.fromEntries(userRes.rows.map(u => [u.id, u]));
  const creator  = userMap[task.creator_id]  || {};
  const assignee = userMap[task.assignee_id] || {};

  const cardMetadata = {
    task_id: task.id,
    task_kind: task.task_kind,
    status: task.status,
    title: task.title,
    description: task.description,
    priority: task.priority,
    deadline: task.deadline,
    creator_id: task.creator_id,
    creator_name: creator.name,
    creator_role: creator.role,
    assignee_id: task.assignee_id,
    assignee_name: assignee.name,
    assignee_role: assignee.role,
    work_id: task.work_id,
    tender_id: task.tender_id,
    declined_reason: task.declined_reason,
    redirected_once: task.redirected_once
  };

  await db.query(
    `UPDATE chat_messages
     SET metadata = $1::jsonb, updated_at = NOW()
     WHERE chat_id = $2 AND message_type = 'task_card'`,
    [JSON.stringify(cardMetadata), task.chat_id]
  );
  return true;
}

module.exports = {
  createTaskChat,
  postSystemMessage,
  addParticipant,
  removeParticipant,
  archiveTaskChat,
  unarchiveTaskChat,
  refreshTaskCard
};
