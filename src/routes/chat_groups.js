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
const { sendToUser } = require('./sse');
const aiProvider = require('../services/ai-provider');
const mimirData = require('../services/mimir-data');

module.exports = async function(fastify) {
  const db = fastify.db;
  const uploadDir = process.env.UPLOAD_DIR || './uploads';
  const uploadRootDir = path.resolve(uploadDir);
  const chatUploadDir = path.resolve(uploadRootDir, 'chat');

  // ── In-memory typing state (chatId → Map(userId → {name, ts})) ──
  const _typingState = new Map();
  const TYPING_TTL = 4000; // 4 сек

  // ── Members cache (chatId → { members[], expires }) ──
  const _membersCache = new Map();
  const MEMBERS_CACHE_TTL = 60000; // 60 сек

  async function getChatMembers(chatId) {
    const cached = _membersCache.get(chatId);
    if (cached && cached.expires > Date.now()) return cached.members;
    const { rows } = await db.query('SELECT user_id FROM chat_group_members WHERE chat_id = $1', [chatId]);
    _membersCache.set(chatId, { members: rows, expires: Date.now() + MEMBERS_CACHE_TTL });
    return rows;
  }

  function invalidateMembersCache(chatId) {
    _membersCache.delete(chatId);
  }

  function parsePositiveInt(value) {
    const rawValue = String(value || '').trim();
    if (!/^\d+$/.test(rawValue)) return null;
    return parseInt(rawValue, 10);
  }

  function getSafeChatStoredFilename(filePath) {
    if (typeof filePath !== 'string') return null;

    const trimmed = filePath.trim();
    if (!trimmed || trimmed.includes('\0')) return null;
    if (/^(null|undefined|#)$/i.test(trimmed)) return null;

    const normalized = trimmed.replace(/\\/g, '/');
    let filename = null;

    if (/^\/uploads\/chat\/[^/]+$/i.test(normalized)) {
      filename = path.posix.basename(normalized);
    } else if (/^chat\/[^/]+$/i.test(normalized)) {
      filename = path.posix.basename(normalized);
    } else if (normalized === path.posix.basename(normalized)) {
      filename = normalized;
    } else {
      return null;
    }

    if (!filename || filename !== path.basename(filename)) return null;
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) return null;

    return filename;
  }

  function getSafeChatFilePath(filePath) {
    const storedFilename = getSafeChatStoredFilename(filePath);
    if (!storedFilename) return null;

    const resolvedPath = path.resolve(chatUploadDir, storedFilename);
    const relativePath = path.relative(chatUploadDir, resolvedPath);

    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return null;
    }

    return resolvedPath;
  }

  function serializeAttachment(row) {
    if (!row) return null;

    return {
      id: row.id,
      file_name: typeof row.file_name === 'string' ? row.file_name.trim() : '',
      file_path: typeof row.file_path === 'string' ? row.file_path.trim() : '',
      file_size: Number.isFinite(Number(row.file_size)) ? Number(row.file_size) : 0,
      mime_type: row.mime_type || 'application/octet-stream'
    };
  }

  function buildSafeContentDisposition(filename) {
    const preferredName = (filename || '').trim() || 'download';
    const fallbackName = preferredName
      .replace(/[\r\n\"]/g, '_')
      .replace(/[^\w.()\- ]+/g, '_')
      .trim() || 'download';
    const encodedName = encodeURIComponent(preferredName)
      .replace(/['()]/g, escape)
      .replace(/\*/g, '%2A');

    return `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`;
  }

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
      const chatLink = link || '#/chat';

      // 1. Push notification (web-push to all devices)
      try {
        const NotificationService = require('../services/NotificationService');
        await NotificationService.send(db, {
          user_id: userId,
          type: 'chat_message',
          title: title,
          body: message,
          url: chatLink,
          tag: 'chat-' + (link || '').split('/').pop()
        });
      } catch (pushErr) {
        // Push may fail silently — still save DB notification below
        fastify.log.warn('Chat push error:', pushErr.message);
        // Fallback: just insert DB notification
        await db.query(`
          INSERT INTO notifications (user_id, title, message, type, link, is_read, created_at)
          VALUES ($1, $2, $3, 'chat', $4, false, NOW())
        `, [userId, title, message, chatLink]);
      }

      // 2. Telegram notification
      try {
        const telegram = require('../services/telegram');
        if (telegram && telegram.sendNotification) {
          await telegram.sendNotification(userId, `💬 *${title}*\n\n${message}`);
        }
      } catch (tgErr) {
        // Telegram may not be configured
      }
    } catch (e) {
      fastify.log.error('Chat notification error:', e.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPER: SSE broadcast to chat members
  // ═══════════════════════════════════════════════════════════════
  async function sseToMembers(chatId, senderUserId, event, data) {
    try {
      const members = await getChatMembers(chatId);
      for (const m of members) {
        if (m.user_id !== senderUserId) sendToUser(m.user_id, event, data);
      }
    } catch (e) {
      fastify.log.warn('SSE broadcast error:', e.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Direct Chat — find or create 1-to-1 chat
  // ═══════════════════════════════════════════════════════════════
  fastify.post('/direct', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const body = request.body || {};
      const user_id = body.user_id ? parseInt(body.user_id) : null;
      const myId = request.user.id;

      if (!user_id || user_id === myId) {
        return reply.code(400).send({ error: 'Некорректный пользователь' });
      }

      // Find existing direct chat between these two users
      const existing = await db.query(`
        SELECT c.* FROM chats c
        JOIN chat_group_members m1 ON m1.chat_id = c.id AND m1.user_id = $1
        JOIN chat_group_members m2 ON m2.chat_id = c.id AND m2.user_id = $2
        WHERE c.is_group = false AND c.type = 'direct'
        LIMIT 1
      `, [myId, user_id]);

      if (existing.rows.length > 0) {
        return { chat: existing.rows[0] };
      }

      // Create new direct chat
      const otherUser = await db.query('SELECT id, name FROM users WHERE id = $1', [user_id]);
      if (otherUser.rows.length === 0) {
        return reply.code(404).send({ error: 'Пользователь не найден' });
      }

      const myUser = await db.query('SELECT id, name FROM users WHERE id = $1', [myId]);
      const chatName = `${myUser.rows[0].name} — ${otherUser.rows[0].name}`;

      const result = await db.query(`
        INSERT INTO chats (name, type, is_group, created_at, last_message_at)
        VALUES ($1, 'direct', false, NOW(), NOW())
        RETURNING *
      `, [chatName]);

      const chat = result.rows[0];

      // Add both members
      await db.query(`
        INSERT INTO chat_group_members (chat_id, user_id, role, joined_at)
        VALUES ($1, $2, 'owner', NOW()), ($1, $3, 'member', NOW())
      `, [chat.id, myId, user_id]);

      return { chat, created: true };
    } catch (err) {
      fastify.log.error('Direct chat error:', err.message);
      return reply.code(500).send({ error: 'Ошибка создания чата: ' + err.message });
    }
  });

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
      SELECT c.*,
        m.role as my_role,
        m.muted_until,
        m.last_read_at,
        (SELECT COUNT(*) FROM chat_group_members WHERE chat_id = c.id) as member_count,
        (SELECT COUNT(*) FROM chat_messages
         WHERE chat_id = c.id AND created_at > COALESCE(m.last_read_at, '1970-01-01')
         AND deleted_at IS NULL) as unread_count,
        -- Last message preview
        (SELECT lm.message FROM chat_messages lm
         WHERE lm.chat_id = c.id AND lm.deleted_at IS NULL
         ORDER BY lm.created_at DESC LIMIT 1) as last_message_text,
        (SELECT u2.name FROM chat_messages lm2
         JOIN users u2 ON u2.id = lm2.user_id
         WHERE lm2.chat_id = c.id AND lm2.deleted_at IS NULL
         ORDER BY lm2.created_at DESC LIMIT 1) as last_message_sender,
        (SELECT lm3.message_type FROM chat_messages lm3
         WHERE lm3.chat_id = c.id AND lm3.deleted_at IS NULL
         ORDER BY lm3.created_at DESC LIMIT 1) as last_message_type,
        (SELECT lm4.user_id FROM chat_messages lm4
         WHERE lm4.chat_id = c.id AND lm4.deleted_at IS NULL
         ORDER BY lm4.created_at DESC LIMIT 1) as last_message_user_id,
        -- For direct chats, get the OTHER user's name
        CASE WHEN c.is_group = false THEN (
          SELECT u.name FROM chat_group_members cm
          JOIN users u ON u.id = cm.user_id
          WHERE cm.chat_id = c.id AND cm.user_id != $1
          LIMIT 1
        ) ELSE NULL END as direct_user_name,
        CASE WHEN c.is_group = false THEN (
          SELECT cm.user_id FROM chat_group_members cm
          WHERE cm.chat_id = c.id AND cm.user_id != $1
          LIMIT 1
        ) ELSE NULL END as direct_user_id,
        CASE WHEN c.is_group = false THEN (
          SELECT u.last_login_at FROM chat_group_members cm
          JOIN users u ON u.id = cm.user_id
          WHERE cm.chat_id = c.id AND cm.user_id != $1
          LIMIT 1
        ) ELSE NULL END as direct_user_last_login
      FROM chats c
      JOIN chat_group_members m ON m.chat_id = c.id AND m.user_id = $1
      WHERE 1=1
    `;
    const params = [userId];
    let idx = 2;

    if (archived === 'true') {
      sql += ` AND c.archived_at IS NOT NULL`;
    } else {
      sql += ` AND c.archived_at IS NULL`;
    }

    // Мимир-чаты показываются отдельно (специальная строка)
    sql += ` AND COALESCE(c.is_mimir, false) = false`;

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
    if (isNaN(chatId)) return reply.code(400).send({ error: 'Некорректный ID чата' });
    const userId = request.user.id;

    const member = await getChatMembership(chatId, userId);
    if (!member) return reply.code(403).send({ error: 'Нет доступа к чату' });

    const { rows: [chat] } = await db.query(`
      SELECT c.*
      FROM chats c
      WHERE c.id = $1
    `, [chatId]);

    if (!chat) return reply.code(404).send({ error: 'Чат не найден' });

    // Получить участников
    const { rows: members } = await db.query(`
      SELECT m.*, u.name, u.role as user_role, u.is_active, u.last_login_at
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

    let chat;
    try {
      // Создать чат
      const { rows: [row] } = await db.query(`
        INSERT INTO chats (name, description, type, is_group, created_at, updated_at)
        VALUES ($1, $2, 'group', true, NOW(), NOW())
        RETURNING *
      `, [name.trim(), description || null]);
      chat = row;
    } catch (e) {
      if (e.code === '23503') {
        return reply.code(400).send({ error: 'Пользователь не найден в системе' });
      }
      throw e;
    }

    // Добавить создателя как владельца
    try {
      await db.query(`
        INSERT INTO chat_group_members (chat_id, user_id, role, joined_at)
        VALUES ($1, $2, 'owner', NOW())
      `, [chat.id, creatorId]);
    } catch (e) {
      if (e.code === '23503') {
        // Cleanup orphan chat
        await db.query('DELETE FROM chats WHERE id = $1', [chat.id]);
        return reply.code(400).send({ error: 'Пользователь не найден в системе' });
      }
      throw e;
    }

    // Добавить участников
    if (Array.isArray(member_ids)) {
      for (const memberId of member_ids) {
        if (memberId !== creatorId) {
          try {
            await db.query(`
              INSERT INTO chat_group_members (chat_id, user_id, role, joined_at)
              VALUES ($1, $2, 'member', NOW())
              ON CONFLICT (chat_id, user_id) DO NOTHING
            `, [chat.id, memberId]);
          } catch (e) {
            if (e.code === '23503') continue; // skip non-existent users
            throw e;
          }

          // Уведомить добавленного
          await notify(
            memberId,
            '💬 Вас добавили в чат',
            `Вы добавлены в групповой чат «${name.trim()}»`,
            `#/messenger?id=${chat.id}`
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
    if (isNaN(chatId)) return reply.code(400).send({ error: 'Некорректный ID чата' });
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
    if (isNaN(chatId)) return reply.code(400).send({ error: 'Некорректный ID чата' });
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
    invalidateMembersCache(chatId);

    // Уведомить
    const { rows: [chat] } = await db.query('SELECT name FROM chats WHERE id = $1', [chatId]);
    await notify(
      parseInt(user_id),
      '💬 Вас добавили в чат',
      `Вы добавлены в групповой чат «${chat.name}»`,
      `#/messenger?id=${chatId}`
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
    if (isNaN(chatId) || isNaN(targetUserId)) return reply.code(400).send({ error: 'Некорректный ID' });
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
    invalidateMembersCache(chatId);

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
    if (isNaN(chatId) || isNaN(targetUserId)) return reply.code(400).send({ error: 'Некорректный ID' });
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
    if (isNaN(chatId)) return reply.code(400).send({ error: 'Некорректный ID чата' });
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
    if (isNaN(chatId)) return reply.code(400).send({ error: 'Некорректный ID чата' });
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
    if (isNaN(chatId)) return reply.code(400).send({ error: 'Некорректный ID чата' });
    const userId = request.user.id;
    const { limit = 50, before_id, after_id, search } = request.query;

    const member = await getChatMembership(chatId, userId);
    if (!member) return reply.code(403).send({ error: 'Нет доступа' });

    let sql = `
      SELECT m.*, COALESCE(u.name, 'Мимир') as user_name, u.role as user_role,
        rm.id as reply_id, rm.message as reply_text, ru.name as reply_user_name
      FROM chat_messages m
      LEFT JOIN users u ON m.user_id = u.id
      LEFT JOIN chat_messages rm ON m.reply_to = rm.id
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

    if (after_id) {
      sql += ` AND m.id > $${idx}`;
      params.push(parseInt(after_id));
      idx++;
    }

    if (search) {
      sql += ` AND m.message ILIKE $${idx}`;
      params.push(`%${search}%`);
      idx++;
    }

    sql += ` ORDER BY m.created_at DESC LIMIT $${idx}`;
    params.push(parseInt(limit));

        const { rows } = await db.query(sql, params);
    const orderedMessages = rows.reverse();
    const attachmentsByMessageId = new Map();

    if (orderedMessages.length > 0) {
      const messageIds = orderedMessages.map((row) => row.id);
      const attachmentResult = await db.query(`
        SELECT id, message_id, file_name, file_path, file_size, mime_type, created_at
        FROM chat_attachments
        WHERE message_id = ANY($1::int[])
        ORDER BY id ASC
      `, [messageIds]);

      for (const attachment of attachmentResult.rows) {
        const serializedAttachment = serializeAttachment(attachment);
        if (!attachmentsByMessageId.has(attachment.message_id)) {
          attachmentsByMessageId.set(attachment.message_id, []);
        }
        attachmentsByMessageId.get(attachment.message_id).push(serializedAttachment);
      }
    }

    // Update last_read_at
    await db.query(
      'UPDATE chat_group_members SET last_read_at = NOW() WHERE chat_id = $1 AND user_id = $2',
      [chatId, userId]
    );

    return {
      messages: orderedMessages.map((row) => ({
        ...row,
        attachments: attachmentsByMessageId.get(row.id) || []
      }))
    };
  });

  // ───────────────────────────────────────────────────────────────
  // POST /api/chat-groups/:id/messages — Отправить сообщение
  // ───────────────────────────────────────────────────────────────
  fastify.post('/:id/messages', {
    preHandler: [fastify.requirePermission('chat_groups', 'write')]
  }, async (request, reply) => {
    const chatId = parseInt(request.params.id);
    if (isNaN(chatId)) return reply.code(400).send({ error: 'Некорректный ID чата' });
    const userId = request.user.id;
    const { text, reply_to_id, message_type, file_url, file_duration, waveform } = request.body;

    const member = await getChatMembership(chatId, userId);
    if (!member) return reply.code(403).send({ error: 'Нет доступа' });

    // Получить данные чата
    const { rows: [chat] } = await db.query('SELECT name FROM chats WHERE id = $1', [chatId]);

    if ((!text || !text.trim()) && !file_url) {
      return reply.code(400).send({ error: 'Текст сообщения обязателен' });
    }

    // Создать сообщение (includes waveform for voice messages)
    const { rows: [message] } = await db.query(`
      INSERT INTO chat_messages (chat_id, user_id, message, is_read, reply_to, message_type, file_url, file_duration, waveform, created_at)
      VALUES ($1, $2, $3, false, $4, $5, $6, $7, $8, NOW())
      RETURNING *
    `, [
      chatId,
      userId,
      (text || '').trim() || (message_type === 'voice' ? '🎤 Голосовое сообщение' : message_type === 'video' ? '🎬 Видеосообщение' : ''),
      reply_to_id ? parseInt(reply_to_id) : null,
      message_type || 'text',
      file_url || null,
      file_duration ? parseInt(file_duration) : null,
      waveform ? JSON.stringify(waveform) : null
    ]);

    // Обновить метаданные чата (message_count + last_message_at)
    await db.query(`
      UPDATE chats SET message_count = COALESCE(message_count, 0) + 1, last_message_at = NOW(), updated_at = NOW()
      WHERE id = $1
    `, [chatId]);

    // Уведомить участников (кроме отправителя и замьюченных)
    const { rows: members } = await db.query(`
      SELECT user_id FROM chat_group_members
      WHERE chat_id = $1 AND user_id != $2
        AND (muted_until IS NULL OR muted_until < NOW())
    `, [chatId, userId]);

    const senderName = request.user.name || request.user.login;
    // Batch notifications (non-blocking)
    Promise.allSettled(members.map(m =>
      notify(m.user_id, `💬 ${chat.name}`, `${senderName}: ${text.trim().substring(0, 100)}${text.length > 100 ? '...' : ''}`, `#/messenger?id=${chatId}`)
    )).catch(() => {});

    // SSE broadcast new message
    sseToMembers(chatId, userId, 'chat:new_message', {
      chat_id: chatId,
      message: { ...message, user_name: senderName }
    });

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
    if (isNaN(chatId) || isNaN(messageId)) return reply.code(400).send({ error: 'Некорректный ID' });
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

    const { rows: [updated] } = await db.query(`
      UPDATE chat_messages SET message = $1, edited_at = NOW()
      WHERE id = $2 RETURNING edited_at
    `, [text.trim(), messageId]);

    // SSE broadcast edit
    sseToMembers(chatId, userId, 'chat:message_edited', {
      chat_id: chatId, message_id: messageId,
      text: text.trim(), edited_at: updated.edited_at
    });

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
    if (isNaN(chatId) || isNaN(messageId)) return reply.code(400).send({ error: 'Некорректный ID' });
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

    // SSE broadcast delete
    sseToMembers(chatId, userId, 'chat:message_deleted', {
      chat_id: chatId, message_id: messageId
    });

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
    if (isNaN(chatId) || isNaN(messageId)) return reply.code(400).send({ error: 'Некорректный ID' });
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

    // SSE broadcast reaction
    sseToMembers(chatId, userId, 'chat:reaction', {
      chat_id: chatId, message_id: messageId, reactions: reactions
    });

    return { reactions };
  });

  // ───────────────────────────────────────────────────────────────
  // POST /api/chat-groups/:chatId/typing — Сигнал "печатает"
  // ───────────────────────────────────────────────────────────────
  fastify.post('/:chatId/typing', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const chatId = parseInt(request.params.chatId);
    const userId = request.user.id;
    const userName = request.user.name || '';

    if (!_typingState.has(chatId)) _typingState.set(chatId, new Map());
    _typingState.get(chatId).set(userId, { name: userName, ts: Date.now() });

    // SSE broadcast typing
    sseToMembers(chatId, userId, 'chat:typing', {
      chat_id: chatId, user_id: userId, user_name: userName
    });

    // Auto-cleanup через TYPING_TTL
    setTimeout(() => {
      const chatMap = _typingState.get(chatId);
      if (chatMap) {
        const entry = chatMap.get(userId);
        if (entry && Date.now() - entry.ts >= TYPING_TTL) chatMap.delete(userId);
        if (chatMap.size === 0) _typingState.delete(chatId);
      }
    }, TYPING_TTL + 100);

    return { success: true };
  });

  // ───────────────────────────────────────────────────────────────
  // GET /api/chat-groups/:chatId/typing — Кто сейчас печатает
  // ───────────────────────────────────────────────────────────────
  fastify.get('/:chatId/typing', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const chatId = parseInt(request.params.chatId);
    const userId = request.user.id;
    const now = Date.now();
    const chatMap = _typingState.get(chatId);
    if (!chatMap) return { typing: [] };

    const typing = [];
    for (const [uid, entry] of chatMap) {
      if (uid !== userId && now - entry.ts < TYPING_TTL) {
        typing.push({ user_id: uid, name: entry.name });
      }
    }
    return { typing };
  });

  // ───────────────────────────────────────────────────────────────
  // POST /api/chat-groups/:id/upload — Загрузка файла в чат
  // ───────────────────────────────────────────────────────────────
  fastify.post('/:id/upload', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const chatId = parsePositiveInt(request.params.id);
    if (chatId === null) return reply.code(400).send({ error: 'Invalid chat ID' });

    const member = await db.query(
      'SELECT 1 FROM chat_group_members WHERE chat_id = $1 AND user_id = $2',
      [chatId, request.user.id]
    );
    if (member.rows.length === 0) {
      return reply.code(403).send({ error: 'Not a chat member' });
    }

    const body = request.body || {};
    const fileName = typeof body.file_name === 'string' ? body.file_name.trim() : '';
    const filePath = typeof body.file_path === 'string' ? body.file_path.trim() : '';
    const fileSize = Number.isFinite(Number(body.file_size)) && Number(body.file_size) > 0
      ? Number(body.file_size)
      : 0;
    const mimeType = typeof body.mime_type === 'string' && body.mime_type.trim()
      ? body.mime_type.trim()
      : 'application/octet-stream';
    const messageText = typeof body.message_text === 'string' ? body.message_text : '';

    const msgResult = await db.query(`
      INSERT INTO chat_messages (chat_id, user_id, message, created_at)
      VALUES ($1, $2, $3, NOW())
      RETURNING *
    `, [chatId, request.user.id, messageText || '']);

    const msg = msgResult.rows[0];
    let attachment = null;

    if (fileName) {
      const attachmentResult = await db.query(`
        INSERT INTO chat_attachments (message_id, file_name, file_path, file_size, mime_type, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING id, message_id, file_name, file_path, file_size, mime_type, created_at
      `, [msg.id, fileName, filePath, fileSize, mimeType]);
      attachment = serializeAttachment(attachmentResult.rows[0]);
    }

    await db.query('UPDATE chats SET last_message_at = NOW() WHERE id = $1', [chatId]);

    const user = await db.query('SELECT name FROM users WHERE id = $1', [request.user.id]);

    const fullMsg = {
      ...msg,
      user_name: user.rows[0]?.name,
      attachments: attachment ? [attachment] : []
    };

    // SSE broadcast upload message
    sseToMembers(chatId, request.user.id, 'chat:new_message', {
      chat_id: chatId, message: fullMsg
    });

    return { message: fullMsg, attachment };
  });

  // ---------------------------------------------------------------
  // POST /api/chat-groups/:id/upload-file - multipart upload
  // ---------------------------------------------------------------
  fastify.post('/:id/upload-file', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const chatId = parsePositiveInt(request.params.id);
    if (chatId === null) return reply.code(400).send({ error: 'Invalid chat ID' });

    const member = await db.query(
      'SELECT 1 FROM chat_group_members WHERE chat_id = $1 AND user_id = $2',
      [chatId, request.user.id]
    );
    if (member.rows.length === 0) {
      return reply.code(403).send({ error: 'Not a chat member' });
    }

    try {
      const data = await request.file();
      if (!data) {
        return reply.code(400).send({ error: 'File not found' });
      }

      await fs.mkdir(chatUploadDir, { recursive: true });

      const originalName = (data.filename || '').trim() || 'attachment';
      const ext = path.extname(originalName);
      const safeName = Date.now() + '_' + Math.random().toString(36).substring(2, 8) + ext;
      const filePath = path.resolve(chatUploadDir, safeName);
      const storedFilePath = `chat/${safeName}`;
      const messageText = typeof data.fields?.message_text?.value === 'string'
        ? data.fields.message_text.value
        : '';

      const chunks = [];
      for await (const chunk of data.file) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      if (buffer.length > 50 * 1024 * 1024) {
        return reply.code(413).send({ error: 'Файл слишком большой (макс. 50 МБ)' });
      }
      await fs.writeFile(filePath, buffer);

      const msgResult = await db.query(`
        INSERT INTO chat_messages (chat_id, user_id, message, created_at)
        VALUES ($1, $2, $3, NOW())
        RETURNING *
      `, [chatId, request.user.id, messageText || '']);

      const msg = msgResult.rows[0];
      const attachmentResult = await db.query(`
        INSERT INTO chat_attachments (message_id, file_name, file_path, file_size, mime_type, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING id, message_id, file_name, file_path, file_size, mime_type, created_at
      `, [msg.id, originalName, storedFilePath, buffer.length, data.mimetype || 'application/octet-stream']);

      await db.query('UPDATE chats SET last_message_at = NOW() WHERE id = $1', [chatId]);

      const user = await db.query('SELECT name FROM users WHERE id = $1', [request.user.id]);
      const attachment = serializeAttachment(attachmentResult.rows[0]);

      const fullMsg = {
        ...msg,
        user_name: user.rows[0]?.name,
        attachments: attachment ? [attachment] : []
      };

      // SSE broadcast upload-file message
      sseToMembers(chatId, request.user.id, 'chat:new_message', {
        chat_id: chatId, message: fullMsg
      });

      return { message: fullMsg, attachment };
    } catch (e) {
      fastify.log.error('Chat file upload error:', e.message || e);
      return reply.code(500).send({ error: 'File upload failed' });
    }
  });

  // ---------------------------------------------------------------
  // GET /api/chat-groups/:id/files/:filename — скачивание файлов из чата
  // ---------------------------------------------------------------
  fastify.get('/:id/files/:filename', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const chatId = parsePositiveInt(request.params.id);
    const storedFilename = getSafeChatStoredFilename(request.params.filename);

    if (chatId === null || !storedFilename) {
      return reply.code(400).send({ error: 'Invalid chat file' });
    }

    const member = await getChatMembership(chatId, request.user.id);
    if (!member) {
      return reply.code(403).send({ error: 'No chat access' });
    }

    const legacyPublicPath = `/uploads/chat/${storedFilename}`;
    const legacyRelativePath = `chat/${storedFilename}`;
    const attachmentResult = await db.query(`
      SELECT a.file_name, a.file_path, a.mime_type
      FROM chat_attachments a
      JOIN chat_messages m ON m.id = a.message_id
      WHERE m.chat_id = $1
        AND (a.file_path = $2 OR a.file_path = $3 OR a.file_path = $4)
      ORDER BY a.id DESC
      LIMIT 1
    `, [chatId, storedFilename, legacyRelativePath, legacyPublicPath]);
    const attachment = attachmentResult.rows[0];

    const legacyMessageResult = await db.query(`
      SELECT id
      FROM chat_messages
      WHERE chat_id = $1
        AND deleted_at IS NULL
        AND message LIKE $2
      ORDER BY id DESC
      LIMIT 1
    `, [chatId, `%(${legacyPublicPath})%`]);

    if (!attachment && legacyMessageResult.rows.length === 0) {
      return reply.code(404).send({ error: 'File not found' });
    }

    const filePath = getSafeChatFilePath(attachment?.file_path || storedFilename);
    if (!filePath) {
      return reply.code(404).send({ error: 'File not found' });
    }

    try {
      await fs.access(filePath);
    } catch (e) {
      return reply.code(404).send({ error: 'File not found' });
    }

    const fileBuffer = await fs.readFile(filePath);

    reply
      .header('Content-Type', attachment?.mime_type || 'application/octet-stream')
      .header('Content-Disposition', buildSafeContentDisposition(attachment?.file_name || storedFilename))
      .send(fileBuffer);
  });

  fastify.get('/:id/settings', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const chatId = parseInt(request.params.id);
    if (isNaN(chatId)) return reply.code(400).send({ error: 'Некорректный ID чата' });
    const member = await db.query(
      'SELECT role, muted_until, last_read_at FROM chat_group_members WHERE chat_id = $1 AND user_id = $2',
      [chatId, request.user.id]
    );
    if (member.rows.length === 0) {
      return reply.code(403).send({ error: 'Не участник' });
    }
    return { settings: member.rows[0] };
  });

  // ───────────────────────────────────────────────────────────────
  // POST /api/chat-groups/:id/read — Mark messages as read
  // ───────────────────────────────────────────────────────────────
  fastify.post('/:id/read', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const chatId = parseInt(request.params.id);
    if (isNaN(chatId)) return reply.code(400).send({ error: 'Некорректный ID' });

    const member = await getChatMembership(chatId, request.user.id);
    if (!member) return reply.code(403).send({ error: 'Нет доступа' });

    const { last_message_id } = request.body || {};
    if (!last_message_id) return reply.code(400).send({ error: 'last_message_id required' });

    // Update last_read_at and mark individual messages
    await db.query(
      'UPDATE chat_group_members SET last_read_at = NOW() WHERE chat_id = $1 AND user_id = $2',
      [chatId, request.user.id]
    );

    // Mark messages as read
    await db.query(
      'UPDATE chat_messages SET is_read = true WHERE chat_id = $1 AND id <= $2 AND user_id != $3 AND is_read = false',
      [chatId, last_message_id, request.user.id]
    );

    // Broadcast read receipt via SSE to message senders
    sseToMembers(chatId, request.user.id, 'chat:read', {
      chat_id: chatId,
      user_id: request.user.id,
      message_id: last_message_id
    });

    return { success: true };
  });

  // ───────────────────────────────────────────────────────────────
  // GET /api/chat-groups/:id/files-list — Список файлов чата
  // ───────────────────────────────────────────────────────────────
  fastify.get('/:id/files-list', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const chatId = parseInt(request.params.id);
    if (isNaN(chatId)) return reply.code(400).send({ error: 'Некорректный ID' });
    const member = await getChatMembership(chatId, request.user.id);
    if (!member) return reply.code(403).send({ error: 'Нет доступа' });

    const { rows } = await db.query(`
      SELECT a.id, a.file_name, a.file_path, a.file_size, a.mime_type, a.created_at,
        u.name as user_name
      FROM chat_attachments a
      JOIN chat_messages m ON m.id = a.message_id
      JOIN users u ON u.id = m.user_id
      WHERE m.chat_id = $1 AND m.deleted_at IS NULL
      ORDER BY a.created_at DESC
    `, [chatId]);

    return { files: rows };
  });

  // ───────────────────────────────────────────────────────────────
  // Pinned messages — CRUD
  // ───────────────────────────────────────────────────────────────
  // Ensure table exists
  await db.query(`
    CREATE TABLE IF NOT EXISTS pinned_messages (
      chat_id INT NOT NULL,
      message_id INT NOT NULL,
      pinned_by INT,
      pinned_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (chat_id, message_id)
    )
  `);

  // GET /api/chat-groups/:id/pins
  fastify.get('/:id/pins', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const chatId = parseInt(request.params.id);
    if (isNaN(chatId)) return reply.code(400).send({ error: 'Некорректный ID' });
    const member = await getChatMembership(chatId, request.user.id);
    if (!member) return reply.code(403).send({ error: 'Нет доступа' });

    const { rows } = await db.query(`
      SELECT p.message_id, p.pinned_at, p.pinned_by,
        m.message, m.user_id, u.name as user_name, m.created_at as message_created_at
      FROM pinned_messages p
      JOIN chat_messages m ON m.id = p.message_id
      JOIN users u ON u.id = m.user_id
      WHERE p.chat_id = $1 AND m.deleted_at IS NULL
      ORDER BY p.pinned_at DESC
    `, [chatId]);

    return { pins: rows };
  });

  // POST /api/chat-groups/:id/pin/:messageId
  fastify.post('/:id/pin/:messageId', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const chatId = parseInt(request.params.id);
    const messageId = parseInt(request.params.messageId);
    if (isNaN(chatId) || isNaN(messageId)) return reply.code(400).send({ error: 'Некорректный ID' });

    const member = await getChatMembership(chatId, request.user.id);
    if (!member) return reply.code(403).send({ error: 'Нет доступа' });

    // Verify message belongs to chat
    const msgCheck = await db.query('SELECT id FROM chat_messages WHERE id = $1 AND chat_id = $2 AND deleted_at IS NULL', [messageId, chatId]);
    if (!msgCheck.rows.length) return reply.code(404).send({ error: 'Сообщение не найдено' });

    await db.query(`
      INSERT INTO pinned_messages (chat_id, message_id, pinned_by)
      VALUES ($1, $2, $3)
      ON CONFLICT (chat_id, message_id) DO NOTHING
    `, [chatId, messageId, request.user.id]);

    // Broadcast pin event via SSE
    sseToMembers(chatId, request.user.id, 'pin', { chat_id: chatId, message_id: messageId, pinned_by: request.user.id });

    return { success: true };
  });

  // DELETE /api/chat-groups/:id/pin/:messageId
  fastify.delete('/:id/pin/:messageId', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const chatId = parseInt(request.params.id);
    const messageId = parseInt(request.params.messageId);
    if (isNaN(chatId) || isNaN(messageId)) return reply.code(400).send({ error: 'Некорректный ID' });

    const member = await getChatMembership(chatId, request.user.id);
    if (!member) return reply.code(403).send({ error: 'Нет доступа' });

    await db.query('DELETE FROM pinned_messages WHERE chat_id = $1 AND message_id = $2', [chatId, messageId]);

    sseToMembers(chatId, request.user.id, 'unpin', { chat_id: chatId, message_id: messageId });

    return { success: true };
  });

  // ───────────────────────────────────────────────────────────────
  // DELETE /api/chat-groups/:id — Удалить чат (только owner)
  // ───────────────────────────────────────────────────────────────
  fastify.delete('/:id', {
    preHandler: [fastify.requirePermission('chat_groups', 'delete')]
  }, async (request, reply) => {
    const chatId = parseInt(request.params.id);
    if (isNaN(chatId)) return reply.code(400).send({ error: 'Некорректный ID чата' });
    const userId = request.user.id;

    const member = await getChatMembership(chatId, userId);
    if (!member || member.role !== 'owner') {
      return reply.code(403).send({ error: 'Только владелец может удалить чат' });
    }

    // Мимир-чаты нельзя удалять
    const { rows: [chatInfo] } = await db.query('SELECT is_mimir FROM chats WHERE id = $1', [chatId]);
    if (chatInfo && chatInfo.is_mimir) {
      return reply.code(403).send({ error: 'Чат с Мимиром нельзя удалить' });
    }

    // Удалить все связанные данные
    await db.query('DELETE FROM chat_attachments WHERE message_id IN (SELECT id FROM chat_messages WHERE chat_id = $1)', [chatId]);
    await db.query('DELETE FROM chat_messages WHERE chat_id = $1', [chatId]);
    await db.query('DELETE FROM chat_group_members WHERE chat_id = $1', [chatId]);
    await db.query('DELETE FROM chats WHERE id = $1', [chatId]);

    return { success: true };
  });

  // ═══════════════════════════════════════════════════════════════
  // МИМИР AI-БОТ В ХУГИННЕ (С9)
  // ═══════════════════════════════════════════════════════════════

  // ───────────────────────────────────────────────────────────────
  // GET /api/chat-groups/mimir — Получить или создать Мимир-чат
  // ───────────────────────────────────────────────────────────────
  fastify.get('/mimir', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const userId = request.user.id;

    // Найти существующий Мимир-чат пользователя
    const { rows: [existing] } = await db.query(`
      SELECT c.id, c.name FROM chats c
      JOIN chat_group_members m ON m.chat_id = c.id
      WHERE c.is_mimir = true AND m.user_id = $1
      LIMIT 1
    `, [userId]);

    if (existing) {
      return { chat_id: existing.id };
    }

    // Создать Мимир-чат
    const { rows: [newChat] } = await db.query(`
      INSERT INTO chats (name, type, is_group, is_mimir, created_at, updated_at, last_message_at)
      VALUES ('Мимир', 'mimir', false, true, NOW(), NOW(), NOW())
      RETURNING id
    `);

    await db.query(`
      INSERT INTO chat_group_members (chat_id, user_id, role, joined_at)
      VALUES ($1, $2, 'owner', NOW())
    `, [newChat.id, userId]);

    // Добавить приветственное сообщение от Мимира
    await db.query(`
      INSERT INTO chat_messages (chat_id, user_id, message, message_type, is_system, created_at)
      VALUES ($1, 0, $2, 'text', true, NOW())
    `, [newChat.id, '⚡ Привет! Я **Мимир** — AI-помощник ASGARD CRM.\n\nСпрашивай о тендерах, проектах, задачах, финансах и сотрудниках. Я знаю всё о вашей CRM.\n\nНабери `/help` чтобы увидеть быстрые команды.']);

    return { chat_id: newChat.id };
  });

  // ───────────────────────────────────────────────────────────────
  // POST /api/chat-groups/:id/mimir — Отправить сообщение Мимиру
  // ───────────────────────────────────────────────────────────────
  fastify.post('/:id/mimir', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const chatId = parseInt(request.params.id);
    if (isNaN(chatId)) return reply.code(400).send({ error: 'Некорректный ID чата' });
    const userId = request.user.id;
    const user = request.user;
    const { message } = request.body;

    if (!message || !message.trim()) {
      return reply.code(400).send({ error: 'Пустое сообщение' });
    }

    // Проверить что это Мимир-чат и пользователь имеет доступ
    const { rows: [chat] } = await db.query('SELECT id, is_mimir FROM chats WHERE id = $1', [chatId]);
    if (!chat || !chat.is_mimir) {
      return reply.code(400).send({ error: 'Это не Мимир-чат' });
    }
    const member = await getChatMembership(chatId, userId);
    if (!member) return reply.code(403).send({ error: 'Нет доступа' });

    const text = message.trim();
    const senderName = user.name || user.login;
    const startTime = Date.now();

    // 1. Сохранить сообщение пользователя в chat_messages
    const { rows: [userMsg] } = await db.query(`
      INSERT INTO chat_messages (chat_id, user_id, message, message_type, created_at)
      VALUES ($1, $2, $3, 'text', NOW())
      RETURNING *
    `, [chatId, userId, text]);

    // SSE: пользовательское сообщение (для синхронизации между вкладками)
    sseToMembers(chatId, 0, 'chat:new_message', {
      chat_id: chatId,
      message: { ...userMsg, user_name: senderName }
    });

    // 2. Собрать контекст (последние 20 сообщений) + вложения
    const { rows: history } = await db.query(`
      SELECT m.id, m.user_id, m.message, m.created_at FROM chat_messages m
      WHERE m.chat_id = $1 AND m.deleted_at IS NULL
      ORDER BY m.created_at DESC LIMIT 20
    `, [chatId]);
    history.reverse();

    // Подтянуть вложения для сообщений из истории
    const histMsgIds = history.map(m => m.id);
    let attachMap = new Map();
    if (histMsgIds.length > 0) {
      const { rows: atts } = await db.query(`
        SELECT message_id, file_name, file_path, mime_type FROM chat_attachments
        WHERE message_id = ANY($1::int[])
      `, [histMsgIds]);
      for (const a of atts) {
        if (!attachMap.has(a.message_id)) attachMap.set(a.message_id, []);
        attachMap.get(a.message_id).push(a);
      }
    }

    // Извлечь содержимое файлов для AI контекста
    const fileContents = [];
    for (const [msgId, atts] of attachMap) {
      for (const att of atts) {
        try {
          const ext = path.extname(att.file_name || '').toLowerCase();
          const safeName = path.basename(att.file_path || att.file_name || '');
          const filePath = path.resolve(chatUploadDir, safeName);
          const buf = await fs.readFile(filePath);

          let content = '';
          if (ext === '.pdf') {
            const pdfParse = require('pdf-parse');
            const data = await pdfParse(buf);
            content = data.text.substring(0, 50000);
          } else if (ext === '.docx') {
            const mammoth = require('mammoth');
            const result = await mammoth.extractRawText({ buffer: buf });
            content = result.value.substring(0, 50000);
          } else if (['.xlsx', '.xls'].includes(ext)) {
            const ExcelJS = require('exceljs');
            const wb = new ExcelJS.Workbook();
            await wb.xlsx.load(buf);
            let txt = '';
            wb.eachSheet((sheet) => {
              txt += `\n=== Лист: ${sheet.name} ===\n`;
              sheet.eachRow((row) => {
                const vals = [];
                row.eachCell((cell) => vals.push(String(cell.value ?? '')));
                txt += vals.join(' | ') + '\n';
              });
            });
            content = txt.substring(0, 50000);
          } else if (['.csv', '.txt', '.json', '.xml', '.md'].includes(ext)) {
            content = buf.toString('utf8').substring(0, 50000);
          }

          if (content) {
            fileContents.push(`\n📎 Файл «${att.file_name}»:\n${content}`);
          }
        } catch (e) {
          // Файл не найден или не читается — пропускаем
        }
      }
    }

    const aiMessages = history.map(m => ({
      role: m.user_id === 0 ? 'assistant' : 'user',
      content: m.message
    }));

    // Добавить содержимое файлов к контексту (перед последним сообщением)
    if (fileContents.length > 0) {
      const filesContext = fileContents.join('\n');
      // Вставить как системное сообщение с файлами перед user-сообщениями
      aiMessages.unshift({ role: 'user', content: `[Вложенные файлы в чате]${filesContext}` });
      aiMessages.splice(1, 0, { role: 'assistant', content: 'Понял, я вижу загруженные файлы. Готов ответить на вопросы по ним.' });
    }

    // 3. Построить system prompt через mimir-data
    let systemPrompt;
    try {
      systemPrompt = await mimirData.buildSystemPrompt(db, user);
    } catch (e) {
      systemPrompt = `Ты — Мимир, AI-помощник ASGARD CRM. Помогаешь с проектами, тендерами, CRM. Отвечай развёрнуто, используй markdown.\nПользователь: ${senderName} (${user.role})`;
    }

    // Дополнить системный промпт для Хугинна
    systemPrompt += '\n\nТы отвечаешь в мессенджере Хугинн. Будь более разговорным и дружелюбным чем в FAB-режиме. Используй markdown: **bold**, _italic_, `code`, ```блоки кода```, списки (-), заголовки (##). Отвечай подробно и развёрнуто.';

    // 4. Обработка быстрых команд
    let processedMessage = text;
    const cmdMatch = text.match(/^\/(help|tasks|tender|project|who)\s*(.*)?$/i);
    if (cmdMatch) {
      const cmd = cmdMatch[1].toLowerCase();
      const arg = (cmdMatch[2] || '').trim();
      switch (cmd) {
        case 'help':
          processedMessage = 'Покажи список доступных команд: /help, /tasks, /tender [номер], /project [название], /who [имя]. Объясни каждую кратко.';
          break;
        case 'tasks':
          processedMessage = 'Покажи мои текущие задачи: активные, просроченные, ближайшие дедлайны.';
          break;
        case 'tender':
          processedMessage = arg ? `Найди информацию о тендере ${arg}: статус, заказчик, сумма, сроки.` : 'Покажи активные тендеры: статус, суммы, дедлайны.';
          break;
        case 'project':
          processedMessage = arg ? `Найди информацию о проекте "${arg}": статус, бюджет, участники.` : 'Покажи активные проекты: статус, прогресс, бюджет.';
          break;
        case 'who':
          processedMessage = arg ? `Найди сотрудника "${arg}": должность, контакты, текущие задачи.` : 'Покажи список сотрудников с должностями.';
          break;
      }
    }

    // Заменить последнее сообщение в aiMessages обработанной версией
    if (aiMessages.length > 0) {
      aiMessages[aiMessages.length - 1].content = processedMessage;
    }

    // 5. SSE typing indicator для клиента
    sendToUser(userId, 'chat:typing', {
      chat_id: chatId,
      user_id: 0,
      user_name: 'Мимир'
    });

    // 6. Вызвать AI
    let aiResponse;
    try {
      const aiResult = await aiProvider.complete({
        system: systemPrompt,
        messages: aiMessages,
        maxTokens: 8000,
        temperature: 0.6
      });
      aiResponse = aiResult.content || aiResult.text || 'Не удалось получить ответ';
    } catch (aiErr) {
      fastify.log.error(aiErr, 'Mimir AI error in Huginn');
      aiResponse = '⚠️ Один из воронов заблудился... Попробуйте ещё раз через минуту.';
    }

    const durationMs = Date.now() - startTime;

    // 7. Сохранить ответ Мимира в chat_messages (user_id = 0 для бота)
    const { rows: [mimirMsg] } = await db.query(`
      INSERT INTO chat_messages (chat_id, user_id, message, message_type, created_at)
      VALUES ($1, 0, $2, 'text', NOW())
      RETURNING *
    `, [chatId, aiResponse]);

    // 8. Обновить метаданные чата
    await db.query(`
      UPDATE chats SET message_count = COALESCE(message_count, 0) + 2, last_message_at = NOW(), updated_at = NOW()
      WHERE id = $1
    `, [chatId]);

    // 9. SSE: ответ Мимира
    sendToUser(userId, 'chat:new_message', {
      chat_id: chatId,
      message: { ...mimirMsg, user_name: 'Мимир', is_mimir_bot: true }
    });

    return {
      success: true,
      user_message: userMsg,
      mimir_message: mimirMsg,
      duration_ms: durationMs
    };
  });

  // ───────────────────────────────────────────────────────────────
  // POST /api/chat-groups/:id/mimir-stream — Стриминг ответа Мимира
  // ───────────────────────────────────────────────────────────────
  fastify.post('/:id/mimir-stream', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const chatId = parseInt(request.params.id);
    if (isNaN(chatId)) return reply.code(400).send({ error: 'Некорректный ID чата' });
    const userId = request.user.id;
    const user = request.user;
    const { message } = request.body;

    if (!message || !message.trim()) {
      return reply.code(400).send({ error: 'Пустое сообщение' });
    }

    const { rows: [chat] } = await db.query('SELECT id, is_mimir FROM chats WHERE id = $1', [chatId]);
    if (!chat || !chat.is_mimir) return reply.code(400).send({ error: 'Это не Мимир-чат' });

    const member = await getChatMembership(chatId, userId);
    if (!member) return reply.code(403).send({ error: 'Нет доступа' });

    const text = message.trim();
    const senderName = user.name || user.login;

    // Сохранить сообщение пользователя
    const { rows: [userMsg] } = await db.query(`
      INSERT INTO chat_messages (chat_id, user_id, message, message_type, created_at)
      VALUES ($1, $2, $3, 'text', NOW())
      RETURNING *
    `, [chatId, userId, text]);

    // Контекст
    const { rows: history } = await db.query(`
      SELECT user_id, message, created_at FROM chat_messages
      WHERE chat_id = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC LIMIT 20
    `, [chatId]);

    const aiMessages = history.reverse().map(m => ({
      role: m.user_id === 0 ? 'assistant' : 'user',
      content: m.message
    }));

    let systemPrompt;
    try {
      systemPrompt = await mimirData.buildSystemPrompt(db, user);
    } catch (e) {
      systemPrompt = `Ты — Мимир, AI-помощник ASGARD CRM.\nПользователь: ${senderName} (${user.role})`;
    }
    systemPrompt += '\n\nТы отвечаешь в мессенджере Хугинн. Будь разговорным и дружелюбным. Используй markdown.';

    // Обработка быстрых команд
    const cmdMatch = text.match(/^\/(help|tasks|tender|project|who)\s*(.*)?$/i);
    if (cmdMatch) {
      const cmd = cmdMatch[1].toLowerCase();
      const arg = (cmdMatch[2] || '').trim();
      const cmdMap = {
        help: 'Покажи список доступных команд: /help, /tasks, /tender [номер], /project [название], /who [имя]. Объясни каждую кратко.',
        tasks: 'Покажи мои текущие задачи: активные, просроченные, ближайшие дедлайны.',
        tender: arg ? `Найди информацию о тендере ${arg}` : 'Покажи активные тендеры.',
        project: arg ? `Найди информацию о проекте "${arg}"` : 'Покажи активные проекты.',
        who: arg ? `Найди сотрудника "${arg}"` : 'Покажи список сотрудников.',
      };
      if (aiMessages.length > 0) aiMessages[aiMessages.length - 1].content = cmdMap[cmd];
    }

    // SSE streaming
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    reply.raw.write(`data: ${JSON.stringify({ type: 'start', user_message: userMsg })}\n\n`);

    let fullResponse = '';
    try {
      const streamResponse = await aiProvider.stream({
        system: systemPrompt,
        messages: aiMessages,
        maxTokens: 8000,
        temperature: 0.6
      });

      const streamParser = aiProvider.parseStream(streamResponse, aiProvider.getProvider());
      for await (const event of streamParser) {
        if (event.type === 'text' && event.content) {
          fullResponse += event.content;
          reply.raw.write(`data: ${JSON.stringify({ type: 'text', text: event.content })}\n\n`);
        }
      }
    } catch (streamErr) {
      fastify.log.error(streamErr, 'Mimir stream error');
      fullResponse = '⚠️ Один из воронов заблудился...';
      reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: fullResponse })}\n\n`);
    }

    // Сохранить ответ Мимира
    const { rows: [mimirMsg] } = await db.query(`
      INSERT INTO chat_messages (chat_id, user_id, message, message_type, created_at)
      VALUES ($1, 0, $2, 'text', NOW())
      RETURNING *
    `, [chatId, fullResponse]);

    await db.query(`
      UPDATE chats SET message_count = COALESCE(message_count, 0) + 2, last_message_at = NOW(), updated_at = NOW()
      WHERE id = $1
    `, [chatId]);

    // SSE notify для других вкладок
    sendToUser(userId, 'chat:new_message', {
      chat_id: chatId,
      message: { ...mimirMsg, user_name: 'Мимир', is_mimir_bot: true }
    });

    reply.raw.write(`data: ${JSON.stringify({ type: 'done', mimir_message: mimirMsg })}\n\n`);
    reply.raw.end();
  });

  // ═══ H1: Estimate Chat Integration ═══

  /**
   * POST /api/chat-groups/from-estimate
   * Создать чат при отправке просчёта на согласование.
   * Body: { estimate_id }
   */
  fastify.post('/from-estimate', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { estimate_id } = request.body || {};
    if (!estimate_id) return reply.code(400).send({ error: 'estimate_id required' });

    // 1. Проверить что чат для этого estimate ещё не существует
    const existing = await db.query(
      "SELECT id FROM chats WHERE entity_type = 'estimate' AND entity_id = $1", [estimate_id]
    );
    if (existing.rows[0]) {
      return reply.send({ chat: existing.rows[0], already_existed: true });
    }

    // 2. Получить estimate + tender
    const estResult = await db.query('SELECT * FROM estimates WHERE id = $1', [estimate_id]);
    const estimate = estResult.rows[0];
    if (!estimate) return reply.code(404).send({ error: 'Просчёт не найден' });

    // 3. Собрать участников: PM + ТО (из тендера) + директоры + mimir_bot
    const pmId = estimate.pm_id || estimate.created_by || request.user.id;
    const participantIds = new Set([pmId]);

    // ТО из тендера
    if (estimate.tender_id) {
      const tenderResult = await db.query('SELECT created_by FROM tenders WHERE id = $1', [estimate.tender_id]);
      if (tenderResult.rows[0]?.created_by) participantIds.add(tenderResult.rows[0].created_by);
    }

    // Директоры
    const directors = await db.query(
      "SELECT id FROM users WHERE role IN ('DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV') AND is_active = true"
    );
    for (const d of directors.rows) participantIds.add(d.id);

    // Мимир-бот
    const mimirBot = await db.query("SELECT id FROM users WHERE login = 'mimir_bot' LIMIT 1");
    const mimirBotId = mimirBot.rows[0]?.id;
    if (mimirBotId) participantIds.add(mimirBotId);

    // 4. Создать чат
    const chatName = `📊 Просчёт #${estimate_id} — ${estimate.title || estimate.object_name || 'Без названия'}`;
    const { rows: [chat] } = await db.query(`
      INSERT INTO chats (name, type, is_group, entity_type, entity_id, auto_created, created_at, updated_at)
      VALUES ($1, 'group', true, 'estimate', $2, true, NOW(), NOW())
      RETURNING *
    `, [chatName, estimate_id]);

    // 5. Добавить участников
    const memberArr = [...participantIds];
    for (let i = 0; i < memberArr.length; i++) {
      const role = memberArr[i] === pmId ? 'owner' : 'member';
      await db.query(
        'INSERT INTO chat_group_members (chat_id, user_id, role, joined_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT DO NOTHING',
        [chat.id, memberArr[i], role]
      );
    }

    // 6. Получить расчёт для pinned card
    let calcData = null;
    try {
      const calcResult = await db.query(
        'SELECT * FROM estimate_calculation_data WHERE estimate_id = $1 ORDER BY version_no DESC LIMIT 1',
        [estimate_id]
      );
      calcData = calcResult.rows[0] || null;
    } catch (e) { /* no calculation yet */ }

    // 7. Pinned estimate_card сообщение
    const cardMetadata = {
      estimate_id,
      status: estimate.approval_status || 'sent',
      title: estimate.title || estimate.object_name,
      customer: estimate.customer,
      total_cost: calcData?.total_cost || null,
      total_with_margin: calcData?.total_with_margin || null,
      margin_pct: calcData?.margin_pct || null,
      version_no: calcData?.version_no || 1
    };
    const { rows: [cardMsg] } = await db.query(`
      INSERT INTO chat_messages (chat_id, user_id, message, message_type, metadata, is_system, created_at)
      VALUES ($1, $2, $3, 'estimate_card', $4, false, NOW()) RETURNING *
    `, [chat.id, pmId, `📊 Просчёт #${estimate_id}`, JSON.stringify(cardMetadata)]);

    // Pin the card
    await db.query(
      'INSERT INTO pinned_messages (chat_id, message_id, pinned_by, pinned_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT DO NOTHING',
      [chat.id, cardMsg.id, pmId]
    );

    // 8. Системное сообщение
    const actorName = request.user.name || 'РП';
    await db.query(`
      INSERT INTO chat_messages (chat_id, user_id, message, message_type, is_system, created_at)
      VALUES ($1, $2, $3, 'system', true, NOW())
    `, [chat.id, pmId, `${actorName} отправил просчёт на согласование`]);

    // Update message_count
    await db.query('UPDATE chats SET message_count = 2, last_message_at = NOW() WHERE id = $1', [chat.id]);

    // 9. SSE notify
    for (const uid of memberArr) {
      if (uid !== pmId) {
        sendToUser(uid, 'chat:new_chat', { chat_id: chat.id, chat_name: chatName, entity_type: 'estimate', entity_id: estimate_id });
      }
    }

    return reply.send({ chat, participants: memberArr, card_message_id: cardMsg.id });
  });

  /**
   * GET /api/chat-groups/by-entity?type=estimate&id=123
   * Найти чат по привязанной сущности.
   */
  fastify.get('/by-entity', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { type, id } = request.query;
    if (!type || !id) return reply.code(400).send({ error: 'type and id required' });

    const result = await db.query(
      'SELECT * FROM chats WHERE entity_type = $1 AND entity_id = $2 LIMIT 1',
      [type, parseInt(id)]
    );
    return reply.send({ chat: result.rows[0] || null });
  });

  /**
   * PUT /api/chat-groups/:chatId/update-estimate-card
   * Обновить pinned-карточку просчёта в чате.
   * Body: { estimate_id }
   */
  fastify.put('/:chatId/update-estimate-card', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const chatId = parseInt(request.params.chatId);
    const { estimate_id } = request.body || {};
    if (!estimate_id) return reply.code(400).send({ error: 'estimate_id required' });

    // 1. Найти pinned message с message_type='estimate_card'
    const pinnedResult = await db.query(`
      SELECT cm.* FROM chat_messages cm
      JOIN pinned_messages pm ON pm.message_id = cm.id AND pm.chat_id = cm.chat_id
      WHERE cm.chat_id = $1 AND cm.message_type = 'estimate_card'
      ORDER BY cm.id DESC LIMIT 1
    `, [chatId]);

    // 2. Получить актуальные данные
    const estResult = await db.query('SELECT * FROM estimates WHERE id = $1', [estimate_id]);
    const estimate = estResult.rows[0];
    if (!estimate) return reply.code(404).send({ error: 'Просчёт не найден' });

    let calcData = null;
    try {
      const calcResult = await db.query(
        'SELECT * FROM estimate_calculation_data WHERE estimate_id = $1 ORDER BY version_no DESC LIMIT 1',
        [estimate_id]
      );
      calcData = calcResult.rows[0] || null;
    } catch (e) { /* ok */ }

    const newMetadata = {
      estimate_id,
      status: estimate.approval_status || 'draft',
      title: estimate.title || estimate.object_name,
      customer: estimate.customer,
      total_cost: calcData?.total_cost || null,
      total_with_margin: calcData?.total_with_margin || null,
      margin_pct: calcData?.margin_pct || null,
      version_no: calcData?.version_no || 1
    };

    // 3. Обновить metadata pinned card
    if (pinnedResult.rows[0]) {
      await db.query(
        'UPDATE chat_messages SET metadata = $1, updated_at = NOW() WHERE id = $2',
        [JSON.stringify(newMetadata), pinnedResult.rows[0].id]
      );
    }

    // 4. Системное сообщение об обновлении
    const versionNo = calcData?.version_no || 1;
    const actorName = request.user.name || 'Пользователь';
    await db.query(`
      INSERT INTO chat_messages (chat_id, user_id, message, message_type, metadata, is_system, created_at)
      VALUES ($1, $2, $3, 'estimate_update', $4, true, NOW())
    `, [chatId, request.user.id, `${actorName} обновил расчёт (v.${versionNo})`, JSON.stringify(newMetadata)]);

    await db.query('UPDATE chats SET message_count = COALESCE(message_count,0)+1, last_message_at = NOW(), updated_at = NOW() WHERE id = $1', [chatId]);

    // SSE notify
    await sseToMembers(chatId, request.user.id, 'chat:estimate_updated', {
      chat_id: chatId, estimate_id, metadata: newMetadata
    });

    return reply.send({ success: true, metadata: newMetadata });
  });

  // ═══ S12: Link Preview (Open Graph) ═══
  const _linkPreviewCache = new Map();
  const LINK_CACHE_TTL = 3600000; // 1 hour

  fastify.get('/link-preview', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { url } = request.query;
    if (!url) return reply.code(400).send({ error: 'url required' });

    // Validate URL
    let parsed;
    try { parsed = new URL(url); } catch (_) { return reply.code(400).send({ error: 'invalid url' }); }
    if (!['http:', 'https:'].includes(parsed.protocol)) return reply.code(400).send({ error: 'invalid protocol' });

    // Check cache
    const cached = _linkPreviewCache.get(url);
    if (cached && Date.now() - cached.ts < LINK_CACHE_TTL) {
      return reply.send(cached.data);
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'AsgardBot/1.0 (Link Preview)' },
        redirect: 'follow',
      });
      clearTimeout(timeout);

      if (!resp.ok) return reply.send({ title: parsed.hostname, domain: parsed.hostname });

      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) {
        return reply.send({ title: parsed.hostname, domain: parsed.hostname });
      }

      const html = await resp.text();
      const ogTitle = (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
                       html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i) || [])[1];
      const ogDesc = (html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
                      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i) || [])[1];
      const ogImage = (html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
                       html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) || [])[1];
      const htmlTitle = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1];

      const data = {
        title: ogTitle || htmlTitle || parsed.hostname,
        description: ogDesc || '',
        image: ogImage || '',
        domain: parsed.hostname,
      };

      _linkPreviewCache.set(url, { data, ts: Date.now() });
      // Cleanup old entries
      if (_linkPreviewCache.size > 500) {
        const oldest = [..._linkPreviewCache.entries()].sort((a, b) => a[1].ts - b[1].ts).slice(0, 100);
        oldest.forEach(([k]) => _linkPreviewCache.delete(k));
      }

      return reply.send(data);
    } catch (e) {
      return reply.send({ title: parsed.hostname, domain: parsed.hostname });
    }
  });
};
