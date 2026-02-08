'use strict';

/**
 * ASGARD CRM — Групповые чаты (M3)
 *
 * Функционал:
 * - Создание групповых чатов
 * - Управление участниками (добавить/удалить/роли)
 * - Сообщения с вложениями и ответами
 * - Мьют и архивирование
 * - Поиск по сообщениям
 */

const path = require('path');
const fs = require('fs').promises;
const { randomUUID } = require('crypto');

module.exports = async function(fastify) {
  const db = fastify.db;
  const uploadDir = process.env.UPLOAD_DIR || './uploads';

  // ═══════════════════════════════════════════════════════════════
  // HELPER: Проверка доступа к чату
  // ═══════════════════════════════════════════════════════════════
  async function getChatMembership(chatId, userId) {
    const { rows: [member] } = await db.query(
      'SELECT * FROM chat_group_members WHERE chat_id = $1 AND user_id = $2',
      [chatId, userId]
    );
    return member;
  }

  async function isGroupOwnerOrAdmin(chatId, userId) {
    const member = await getChatMembership(chatId, userId);
    return member && (member.role === 'owner' || member.role === 'admin');
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPER: Уведомление
  // ═══════════════════════════════════════════════════════════════
  async function notify(userId, title, message, link) {
    try {
      await db.query(`
        INSERT INTO notifications (user_id, title, message, type, link, is_read, created_at)
        VALUES ($1, $2, $3, 'chat', $4, false, NOW())
      `, [userId, title, message, link || '#/chat-groups']);
    } catch (e) {
      fastify.log.error('Chat notification error:', e.message);
    }
  }

  // ╔═══════════════════════════════════════════════════════════════╗
  // ║                    ГРУППОВЫЕ ЧАТЫ                            ║
  // ╚═══════════════════════════════════════════════════════════════╝

  // ───────────────────────────────────────────────────────────────
  // GET /api/chat-groups — Список чатов пользователя
  // ───────────────────────────────────────────────────────────────
  fastify.get('/', {
    preHandler: [fastify.requirePermission('chat_groups', 'read')]
  }, async (request) => {
    const userId = request.user.id;
    const { archived = 'false', search } = request.query;

    let sql = `
      SELECT c.*, m.role as my_role, m.muted_until, m.last_read_at,
        (SELECT COUNT(*) FROM chat_group_members WHERE chat_id = c.id) as member_count,
        (SELECT COUNT(*) FROM chat_messages
         WHERE chat_id = c.id AND created_at > COALESCE(m.last_read_at, '1970-01-01')) as unread_count
      FROM chats c
      JOIN chat_group_members m ON c.id = m.chat_id AND m.user_id = $1
      WHERE c.is_group = true
    `;
    const params = [userId];
    let idx = 2;

    if (archived === 'true') {
      sql += ` AND c.archived_at IS NOT NULL`;
    } else {
      sql += ` AND c.archived_at IS NULL`;
    }

    if (search) {
      sql += ` AND c.name ILIKE $${idx}`;
      params.push(`%${search}%`);
      idx++;
    }

    sql += ` ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC`;

    const { rows } = await db.query(sql, params);
    return { chats: rows };
  });

  // ───────────────────────────────────────────────────────────────
  // GET /api/chat-groups/:id — Детали чата
  // ───────────────────────────────────────────────────────────────
  fastify.get('/:id', {
    preHandler: [fastify.requirePermission('chat_groups', 'read')]
  }, async (request, reply) => {
    const chatId = parseInt(request.params.id);
    const userId = request.user.id;

    const member = await getChatMembership(chatId, userId);
    if (!member) return reply.code(403).send({ error: 'Нет доступа к чату' });

    const { rows: [chat] } = await db.query(`
      SELECT c.*, u.name as created_by_name
      FROM chats c
      LEFT JOIN users u ON c.created_by = u.id
      WHERE c.id = $1 AND c.is_group = true
    `, [chatId]);

    if (!chat) return reply.code(404).send({ error: 'Чат не найден' });

    // Получить участников
    const { rows: members } = await db.query(`
      SELECT m.*, u.name, u.role as user_role, u.is_active
      FROM chat_group_members m
      JOIN users u ON m.user_id = u.id
      WHERE m.chat_id = $1
      ORDER BY
        CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
        u.name
    `, [chatId]);

    return { chat, members, myRole: member.role };
  });

  // ───────────────────────────────────────────────────────────────
  // POST /api/chat-groups — Создать групповой чат
  // ───────────────────────────────────────────────────────────────
  fastify.post('/', {
    preHandler: [fastify.requirePermission('chat_groups', 'write')]
  }, async (request, reply) => {
    const { name, description, member_ids, is_readonly } = request.body;
    const creatorId = request.user.id;

    if (!name || !name.trim()) {
      return reply.code(400).send({ error: 'Укажите название чата' });
    }

    // Создать чат
    const { rows: [chat] } = await db.query(`
      INSERT INTO chats (name, description, chat_type, is_group, is_readonly, created_by, created_at, updated_at)
      VALUES ($1, $2, 'group', true, $3, $4, NOW(), NOW())
      RETURNING *
    `, [name.trim(), description || null, is_readonly === true, creatorId]);

    // Добавить создателя как владельца
    await db.query(`
      INSERT INTO chat_group_members (chat_id, user_id, role, joined_at)
      VALUES ($1, $2, 'owner', NOW())
    `, [chat.id, creatorId]);

    // Добавить участников
    if (Array.isArray(member_ids)) {
      for (const memberId of member_ids) {
        if (memberId !== creatorId) {
          await db.query(`
            INSERT INTO chat_group_members (chat_id, user_id, role, joined_at)
            VALUES ($1, $2, 'member', NOW())
            ON CONFLICT (chat_id, user_id) DO NOTHING
          `, [chat.id, memberId]);

          // Уведомить добавленного
          await notify(
            memberId,
            '💬 Вас добавили в чат',
            `Вы добавлены в групповой чат «${name.trim()}»`,
            `#/chat-groups/${chat.id}`
          );
        }
      }
    }

    return { chat };
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /api/chat-groups/:id — Обновить чат (только owner/admin)
  // ───────────────────────────────────────────────────────────────
  fastify.put('/:id', {
    preHandler: [fastify.requirePermission('chat_groups', 'write')]
  }, async (request, reply) => {
    const chatId = parseInt(request.params.id);
    const userId = request.user.id;

    if (!await isGroupOwnerOrAdmin(chatId, userId)) {
      return reply.code(403).send({ error: 'Только владелец или админ может редактировать' });
    }

    const { name, description, is_readonly } = request.body;
    const updates = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) { updates.push(`name = $${idx}`); values.push(name.trim()); idx++; }
    if (description !== undefined) { updates.push(`description = $${idx}`); values.push(description); idx++; }
    if (is_readonly !== undefined) { updates.push(`is_readonly = $${idx}`); values.push(is_readonly === true); idx++; }

    if (updates.length === 0) {
      return reply.code(400).send({ error: 'Нет данных для обновления' });
    }

    updates.push('updated_at = NOW()');
    values.push(chatId);

    await db.query(
      `UPDATE chats SET ${updates.join(', ')} WHERE id = $${idx}`,
      values
    );

    return { success: true };
  });

  // ───────────────────────────────────────────────────────────────
  // POST /api/chat-groups/:id/members — Добавить участника
  // ───────────────────────────────────────────────────────────────
  fastify.post('/:id/members', {
    preHandler: [fastify.requirePermission('chat_groups', 'write')]
  }, async (request, reply) => {
    const chatId = parseInt(request.params.id);
    const userId = request.user.id;
    const { user_id, role = 'member' } = request.body;

    if (!await isGroupOwnerOrAdmin(chatId, userId)) {
      return reply.code(403).send({ error: 'Нет прав на добавление участников' });
    }

    if (!user_id) return reply.code(400).send({ error: 'Укажите user_id' });

    // Проверить что пользователь существует
    const { rows: [targetUser] } = await db.query(
      'SELECT id, name FROM users WHERE id = $1 AND is_active = true',
      [parseInt(user_id)]
    );
    if (!targetUser) return reply.code(404).send({ error: 'Пользователь не найден' });

    // Добавить
    await db.query(`
      INSERT INTO chat_group_members (chat_id, user_id, role, joined_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (chat_id, user_id) DO UPDATE SET role = $3
    `, [chatId, parseInt(user_id), role === 'admin' ? 'admin' : 'member']);

    // Уведомить
    const { rows: [chat] } = await db.query('SELECT name FROM chats WHERE id = $1', [chatId]);
    await notify(
      parseInt(user_id),
      '💬 Вас добавили в чат',
      `Вы добавлены в групповой чат «${chat.name}»`,
      `#/chat-groups/${chatId}`
    );

    return { success: true };
  });

  // ───────────────────────────────────────────────────────────────
  // DELETE /api/chat-groups/:id/members/:userId — Удалить участника
  // ───────────────────────────────────────────────────────────────
  fastify.delete('/:id/members/:userId', {
    preHandler: [fastify.requirePermission('chat_groups', 'write')]
  }, async (request, reply) => {
    const chatId = parseInt(request.params.id);
    const targetUserId = parseInt(request.params.userId);
    const userId = request.user.id;

    // Можно удалить себя или если owner/admin
    const member = await getChatMembership(chatId, userId);
    if (!member) return reply.code(403).send({ error: 'Нет доступа' });

    const isSelf = targetUserId === userId;
    const canRemove = isSelf || member.role === 'owner' || member.role === 'admin';

    if (!canRemove) {
      return reply.code(403).send({ error: 'Нет прав на удаление участников' });
    }

    // Нельзя удалить единственного владельца
    if (!isSelf) {
      const { rows: [targetMember] } = await db.query(
        'SELECT role FROM chat_group_members WHERE chat_id = $1 AND user_id = $2',
        [chatId, targetUserId]
      );
      if (targetMember?.role === 'owner' && member.role !== 'owner') {
        return reply.code(403).send({ error: 'Нельзя удалить владельца' });
      }
    }

    await db.query(
      'DELETE FROM chat_group_members WHERE chat_id = $1 AND user_id = $2',
      [chatId, targetUserId]
    );

    return { success: true };
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /api/chat-groups/:id/members/:userId/role — Изменить роль
  // ───────────────────────────────────────────────────────────────
  fastify.put('/:id/members/:userId/role', {
    preHandler: [fastify.requirePermission('chat_groups', 'write')]
  }, async (request, reply) => {
    const chatId = parseInt(request.params.id);
    const targetUserId = parseInt(request.params.userId);
    const userId = request.user.id;
    const { role } = request.body;

    const member = await getChatMembership(chatId, userId);
    if (!member || member.role !== 'owner') {
      return reply.code(403).send({ error: 'Только владелец может менять роли' });
    }

    if (!['member', 'admin'].includes(role)) {
      return reply.code(400).send({ error: 'Роль может быть member или admin' });
    }

    await db.query(
      'UPDATE chat_group_members SET role = $1 WHERE chat_id = $2 AND user_id = $3',
      [role, chatId, targetUserId]
    );

    return { success: true };
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /api/chat-groups/:id/mute — Замьютить чат
  // ───────────────────────────────────────────────────────────────
  fastify.put('/:id/mute', {
    preHandler: [fastify.requirePermission('chat_groups', 'write')]
  }, async (request, reply) => {
    const chatId = parseInt(request.params.id);
    const userId = request.user.id;
    const { until } = request.body; // ISO date string or null to unmute

    await db.query(
      'UPDATE chat_group_members SET muted_until = $1 WHERE chat_id = $2 AND user_id = $3',
      [until || null, chatId, userId]
    );

    return { success: true };
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /api/chat-groups/:id/archive — Архивировать чат
  // ───────────────────────────────────────────────────────────────
  fastify.put('/:id/archive', {
    preHandler: [fastify.requirePermission('chat_groups', 'write')]
  }, async (request, reply) => {
    const chatId = parseInt(request.params.id);
    const userId = request.user.id;
    const { archive } = request.body;

    if (!await isGroupOwnerOrAdmin(chatId, userId)) {
      return reply.code(403).send({ error: 'Только владелец или админ' });
    }

    await db.query(
      'UPDATE chats SET archived_at = $1, updated_at = NOW() WHERE id = $2',
      [archive ? new Date().toISOString() : null, chatId]
    );

    return { success: true };
  });

  // ╔═══════════════════════════════════════════════════════════════╗
  // ║                    СООБЩЕНИЯ                                 ║
  // ╚═══════════════════════════════════════════════════════════════╝

  // ───────────────────────────────────────────────────────────────
  // GET /api/chat-groups/:id/messages — Получить сообщения
  // ───────────────────────────────────────────────────────────────
  fastify.get('/:id/messages', {
    preHandler: [fastify.requirePermission('chat_groups', 'read')]
  }, async (request, reply) => {
    const chatId = parseInt(request.params.id);
    const userId = request.user.id;
    const { limit = 50, before_id, search } = request.query;

    const member = await getChatMembership(chatId, userId);
    if (!member) return reply.code(403).send({ error: 'Нет доступа' });

    let sql = `
      SELECT m.*, u.name as user_name, u.role as user_role,
        rm.id as reply_id, rm.text as reply_text, ru.name as reply_user_name
      FROM chat_messages m
      JOIN users u ON m.user_id = u.id
      LEFT JOIN chat_messages rm ON m.reply_to_id = rm.id
      LEFT JOIN users ru ON rm.user_id = ru.id
      WHERE m.chat_id = $1 AND m.deleted_at IS NULL
    `;
    const params = [chatId];
    let idx = 2;

    if (before_id) {
      sql += ` AND m.id < $${idx}`;
      params.push(parseInt(before_id));
      idx++;
    }

    if (search) {
      sql += ` AND m.text ILIKE $${idx}`;
      params.push(`%${search}%`);
      idx++;
    }

    sql += ` ORDER BY m.created_at DESC LIMIT $${idx}`;
    params.push(parseInt(limit));

    const { rows } = await db.query(sql, params);

    // Обновить last_read_at
    await db.query(
      'UPDATE chat_group_members SET last_read_at = NOW() WHERE chat_id = $1 AND user_id = $2',
      [chatId, userId]
    );

    return { messages: rows.reverse() };
  });

  // ───────────────────────────────────────────────────────────────
  // POST /api/chat-groups/:id/messages — Отправить сообщение
  // ───────────────────────────────────────────────────────────────
  fastify.post('/:id/messages', {
    preHandler: [fastify.requirePermission('chat_groups', 'write')]
  }, async (request, reply) => {
    const chatId = parseInt(request.params.id);
    const userId = request.user.id;
    const { text, reply_to_id } = request.body;

    const member = await getChatMembership(chatId, userId);
    if (!member) return reply.code(403).send({ error: 'Нет доступа' });

    // Проверить readonly
    const { rows: [chat] } = await db.query('SELECT is_readonly, name FROM chats WHERE id = $1', [chatId]);
    if (chat.is_readonly && member.role === 'member') {
      return reply.code(403).send({ error: 'Чат только для чтения' });
    }

    if (!text || !text.trim()) {
      return reply.code(400).send({ error: 'Текст сообщения обязателен' });
    }

    // Создать сообщение
    const { rows: [message] } = await db.query(`
      INSERT INTO chat_messages (chat_id, user_id, user_name, user_role, text, reply_to_id, chat_type, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'group', NOW(), NOW())
      RETURNING *
    `, [
      chatId,
      userId,
      request.user.name || request.user.login,
      request.user.role,
      text.trim(),
      reply_to_id ? parseInt(reply_to_id) : null
    ]);

    // Обновить метаданные чата
    await db.query(`
      UPDATE chats SET last_message_at = NOW(), message_count = message_count + 1, updated_at = NOW()
      WHERE id = $1
    `, [chatId]);

    // Уведомить участников (кроме отправителя и замьюченных)
    const { rows: members } = await db.query(`
      SELECT user_id FROM chat_group_members
      WHERE chat_id = $1 AND user_id != $2
        AND (muted_until IS NULL OR muted_until < NOW())
    `, [chatId, userId]);

    const senderName = request.user.name || request.user.login;
    for (const m of members) {
      await notify(
        m.user_id,
        `💬 ${chat.name}`,
        `${senderName}: ${text.trim().substring(0, 100)}${text.length > 100 ? '...' : ''}`,
        `#/chat-groups/${chatId}`
      );
    }

    return { message };
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /api/chat-groups/:chatId/messages/:id — Редактировать
  // ───────────────────────────────────────────────────────────────
  fastify.put('/:chatId/messages/:id', {
    preHandler: [fastify.requirePermission('chat_groups', 'write')]
  }, async (request, reply) => {
    const chatId = parseInt(request.params.chatId);
    const messageId = parseInt(request.params.id);
    const userId = request.user.id;
    const { text } = request.body;

    if (!text || !text.trim()) {
      return reply.code(400).send({ error: 'Текст обязателен' });
    }

    // Проверить что это сообщение пользователя
    const { rows: [msg] } = await db.query(
      'SELECT * FROM chat_messages WHERE id = $1 AND chat_id = $2 AND user_id = $3 AND deleted_at IS NULL',
      [messageId, chatId, userId]
    );
    if (!msg) return reply.code(404).send({ error: 'Сообщение не найдено' });

    await db.query(`
      UPDATE chat_messages SET text = $1, edited_at = NOW(), updated_at = NOW()
      WHERE id = $2
    `, [text.trim(), messageId]);

    return { success: true };
  });

  // ───────────────────────────────────────────────────────────────
  // DELETE /api/chat-groups/:chatId/messages/:id — Удалить
  // ───────────────────────────────────────────────────────────────
  fastify.delete('/:chatId/messages/:id', {
    preHandler: [fastify.requirePermission('chat_groups', 'write')]
  }, async (request, reply) => {
    const chatId = parseInt(request.params.chatId);
    const messageId = parseInt(request.params.id);
    const userId = request.user.id;

    // Автор или админ чата может удалить
    const { rows: [msg] } = await db.query(
      'SELECT user_id FROM chat_messages WHERE id = $1 AND chat_id = $2 AND deleted_at IS NULL',
      [messageId, chatId]
    );
    if (!msg) return reply.code(404).send({ error: 'Сообщение не найдено' });

    const isAuthor = msg.user_id === userId;
    const isAdmin = await isGroupOwnerOrAdmin(chatId, userId);

    if (!isAuthor && !isAdmin) {
      return reply.code(403).send({ error: 'Нет прав на удаление' });
    }

    // Мягкое удаление
    await db.query(
      'UPDATE chat_messages SET deleted_at = NOW() WHERE id = $1',
      [messageId]
    );

    return { success: true };
  });

  // ───────────────────────────────────────────────────────────────
  // POST /api/chat-groups/:chatId/messages/:id/reaction — Реакция
  // ───────────────────────────────────────────────────────────────
  fastify.post('/:chatId/messages/:id/reaction', {
    preHandler: [fastify.requirePermission('chat_groups', 'write')]
  }, async (request, reply) => {
    const chatId = parseInt(request.params.chatId);
    const messageId = parseInt(request.params.id);
    const userId = request.user.id;
    const { emoji } = request.body;

    const member = await getChatMembership(chatId, userId);
    if (!member) return reply.code(403).send({ error: 'Нет доступа' });

    if (!emoji) return reply.code(400).send({ error: 'Укажите emoji' });

    // Получить текущие реакции
    const { rows: [msg] } = await db.query(
      'SELECT reactions FROM chat_messages WHERE id = $1 AND chat_id = $2',
      [messageId, chatId]
    );
    if (!msg) return reply.code(404).send({ error: 'Сообщение не найдено' });

    const reactions = msg.reactions || {};
    if (!reactions[emoji]) reactions[emoji] = [];

    // Toggle реакцию
    const userIndex = reactions[emoji].indexOf(userId);
    if (userIndex >= 0) {
      reactions[emoji].splice(userIndex, 1);
      if (reactions[emoji].length === 0) delete reactions[emoji];
    } else {
      reactions[emoji].push(userId);
    }

    await db.query(
      'UPDATE chat_messages SET reactions = $1 WHERE id = $2',
      [JSON.stringify(reactions), messageId]
    );

    return { reactions };
  });

  // ───────────────────────────────────────────────────────────────
  // DELETE /api/chat-groups/:id — Удалить чат (только owner)
  // ───────────────────────────────────────────────────────────────
  fastify.delete('/:id', {
    preHandler: [fastify.requirePermission('chat_groups', 'delete')]
  }, async (request, reply) => {
    const chatId = parseInt(request.params.id);
    const userId = request.user.id;

    const member = await getChatMembership(chatId, userId);
    if (!member || member.role !== 'owner') {
      return reply.code(403).send({ error: 'Только владелец может удалить чат' });
    }

    // Удалить все связанные данные
    await db.query('DELETE FROM chat_attachments WHERE message_id IN (SELECT id FROM chat_messages WHERE chat_id = $1)', [chatId]);
    await db.query('DELETE FROM chat_messages WHERE chat_id = $1', [chatId]);
    await db.query('DELETE FROM chat_group_members WHERE chat_id = $1', [chatId]);
    await db.query('DELETE FROM chats WHERE id = $1', [chatId]);

    return { success: true };
  });
};
