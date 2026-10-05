'use strict';

/**
 * Huginn extensions mounted on the same Fastify instance as chat_groups
 * (prefix /api/chat-groups). Avoids editing src/index.js during Ting parallel.
 */

const crypto = require('crypto');
const huginnEvents = require('../services/huginn-events');
const chatVoiceStt = require('../services/chat-voice-stt');
const huginnFolders = require('../services/huginn-folders');
const huginnAiEditor = require('../services/huginn-ai-editor');
const { sendToUser, isUserOnline } = require('./sse');

function parsePositiveInt(value) {
  const raw = String(value || '').trim();
  if (!/^\d+$/.test(raw)) return null;
  return parseInt(raw, 10);
}

module.exports = async function registerHuginnExt(fastify, { db, uploadDir, getChatMembership, sseToMembers }) {
  // Start STT worker once
  try {
    chatVoiceStt.startWorker(db, { uploadDir: uploadDir || './uploads' });
  } catch (e) {
    fastify.log.warn('chat-voice-stt worker:', e.message);
  }

  // ── Catch-up after SSE reconnect ──────────────────────────────
  fastify.get('/events', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const since = parsePositiveInt(request.query.since) || 0;
    const events = await huginnEvents.catchUp(db, request.user.id, since);
    await huginnEvents.touchLastSeen(db, request.user.id);
    return { since, events, server_time: new Date().toISOString() };
  });

  // ── Presence heartbeat + lookup ───────────────────────────────
  fastify.post('/presence/ping', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    await huginnEvents.touchLastSeen(db, request.user.id);
    return { ok: true, online: true, ts: Date.now() };
  });

  fastify.get('/presence', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const raw = String(request.query.user_ids || '').trim();
    const ids = raw
      ? raw.split(',').map((s) => parsePositiveInt(s)).filter((n) => n != null)
      : [];
    if (!ids.length) return reply.code(400).send({ error: 'user_ids required' });
    const presence = await huginnEvents.getPresence(db, ids);
    return { presence };
  });

  // ── Enhanced read receipts (per-user rows + SSE) ──────────────
  fastify.post('/:id/read-receipts', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const chatId = parsePositiveInt(request.params.id);
    if (chatId == null) return reply.code(400).send({ error: 'bad chat id' });
    const member = await getChatMembership(chatId, request.user.id);
    if (!member) return reply.code(403).send({ error: 'Нет доступа' });

    const lastId = parsePositiveInt((request.body || {}).last_message_id);
    if (lastId == null) return reply.code(400).send({ error: 'last_message_id required' });

    await db.query(
      'UPDATE chat_group_members SET last_read_at = NOW() WHERE chat_id = $1 AND user_id = $2',
      [chatId, request.user.id]
    );

    await db.query(
      `INSERT INTO chat_message_reads (message_id, user_id, read_at)
       SELECT m.id, $2, NOW()
       FROM chat_messages m
       WHERE m.chat_id = $1 AND m.id <= $3 AND m.user_id <> $2 AND m.deleted_at IS NULL
       ON CONFLICT (message_id, user_id) DO UPDATE SET read_at = EXCLUDED.read_at`,
      [chatId, request.user.id, lastId]
    );

    await db.query(
      `UPDATE chat_messages SET is_read = true
       WHERE chat_id = $1 AND id <= $2 AND user_id != $3 AND is_read = false`,
      [chatId, lastId, request.user.id]
    );

    await huginnEvents.publishToChatMembers(db, {
      chatId,
      eventType: 'chat:read',
      payload: {
        chat_id: chatId,
        user_id: request.user.id,
        message_id: lastId
      },
      excludeUserId: request.user.id
    });

    return { success: true };
  });

  fastify.get('/:id/messages/:messageId/readers', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const chatId = parsePositiveInt(request.params.id);
    const messageId = parsePositiveInt(request.params.messageId);
    if (chatId == null || messageId == null) return reply.code(400).send({ error: 'bad id' });
    const member = await getChatMembership(chatId, request.user.id);
    if (!member) return reply.code(403).send({ error: 'Нет доступа' });

    const { rows } = await db.query(
      `SELECT r.user_id, r.read_at, u.name
       FROM chat_message_reads r
       JOIN users u ON u.id = r.user_id
       JOIN chat_messages m ON m.id = r.message_id
       WHERE r.message_id = $1 AND m.chat_id = $2
       ORDER BY r.read_at ASC`,
      [messageId, chatId]
    );
    return { readers: rows };
  });

  // ── Forward message ───────────────────────────────────────────
  fastify.post('/:id/messages/:messageId/forward', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const chatId = parsePositiveInt(request.params.id);
    const messageId = parsePositiveInt(request.params.messageId);
    const targetChatId = parsePositiveInt((request.body || {}).target_chat_id);
    if (chatId == null || messageId == null || targetChatId == null) {
      return reply.code(400).send({ error: 'chat / message / target_chat_id required' });
    }
    const srcMember = await getChatMembership(chatId, request.user.id);
    const dstMember = await getChatMembership(targetChatId, request.user.id);
    if (!srcMember || !dstMember) return reply.code(403).send({ error: 'Нет доступа' });

    const { rows: msgs } = await db.query(
      `SELECT * FROM chat_messages WHERE id = $1 AND chat_id = $2 AND deleted_at IS NULL`,
      [messageId, chatId]
    );
    const src = msgs[0];
    if (!src) return reply.code(404).send({ error: 'Сообщение не найдено' });

    const meta = typeof src.metadata === 'object' && src.metadata ? { ...src.metadata } : {};
    meta.forwarded_from = {
      chat_id: chatId,
      message_id: messageId,
      user_id: src.user_id
    };

    const { rows: inserted } = await db.query(
      `INSERT INTO chat_messages
         (chat_id, user_id, message, message_type, file_url, file_duration, waveform, metadata, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NOW())
       RETURNING *`,
      [
        targetChatId,
        request.user.id,
        src.message || '',
        src.message_type || 'text',
        src.file_url || null,
        src.file_duration || null,
        src.waveform ? JSON.stringify(src.waveform) : null,
        JSON.stringify(meta)
      ]
    );
    const msg = inserted[0];
    await db.query('UPDATE chats SET last_message_at = NOW() WHERE id = $1', [targetChatId]);

    const { rows: users } = await db.query('SELECT name FROM users WHERE id = $1', [request.user.id]);
    const full = { ...msg, user_name: users[0]?.name, attachments: [] };

    await huginnEvents.publishToChatMembers(db, {
      chatId: targetChatId,
      eventType: 'chat:new_message',
      payload: { chat_id: targetChatId, message: full },
      excludeUserId: request.user.id
    });

    return { message: full };
  });

  // ── Stickers ──────────────────────────────────────────────────
  fastify.get('/stickers', {
    preHandler: [fastify.authenticate]
  }, async () => {
    const { rows: packs } = await db.query(
      `SELECT id, slug, title FROM chat_sticker_packs WHERE is_active = true ORDER BY id`
    );
    const { rows: stickers } = await db.query(
      `SELECT id, pack_id, slug, image_url, emoji, sort_order
       FROM chat_stickers ORDER BY pack_id, sort_order, id`
    );
    return {
      packs: packs.map((p) => ({
        ...p,
        stickers: stickers.filter((s) => s.pack_id === p.id)
      }))
    };
  });

  fastify.post('/:id/stickers', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const chatId = parsePositiveInt(request.params.id);
    const stickerId = parsePositiveInt((request.body || {}).sticker_id);
    if (chatId == null || stickerId == null) return reply.code(400).send({ error: 'bad id' });
    const member = await getChatMembership(chatId, request.user.id);
    if (!member) return reply.code(403).send({ error: 'Нет доступа' });

    const { rows: stickers } = await db.query(
      `SELECT s.*, p.slug AS pack_slug FROM chat_stickers s
       JOIN chat_sticker_packs p ON p.id = s.pack_id
       WHERE s.id = $1`,
      [stickerId]
    );
    const st = stickers[0];
    if (!st) return reply.code(404).send({ error: 'Стикер не найден' });

    const meta = { sticker_id: st.id, pack: st.pack_slug, emoji: st.emoji };
    const { rows: inserted } = await db.query(
      `INSERT INTO chat_messages
         (chat_id, user_id, message, message_type, file_url, metadata, created_at)
       VALUES ($1,$2,$3,'sticker',$4,$5::jsonb,NOW())
       RETURNING *`,
      [chatId, request.user.id, st.emoji || 'sticker', st.image_url, JSON.stringify(meta)]
    );
    const msg = inserted[0];
    await db.query('UPDATE chats SET last_message_at = NOW() WHERE id = $1', [chatId]);
    const { rows: users } = await db.query('SELECT name FROM users WHERE id = $1', [request.user.id]);
    const full = { ...msg, user_name: users[0]?.name, attachments: [] };

    await huginnEvents.publishToChatMembers(db, {
      chatId,
      eventType: 'chat:new_message',
      payload: { chat_id: chatId, message: full },
      excludeUserId: request.user.id
    });
    return { message: full };
  });

  // ── Invites ───────────────────────────────────────────────────
  fastify.post('/invites', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const body = request.body || {};
    const phone = body.phone ? String(body.phone).trim() : null;
    const email = body.email ? String(body.email).trim().toLowerCase() : null;
    const displayName = body.display_name ? String(body.display_name).trim() : null;
    const chatId = body.chat_id != null ? parsePositiveInt(body.chat_id) : null;
    if (!phone && !email) return reply.code(400).send({ error: 'phone или email обязателен' });

    if (chatId != null) {
      const member = await getChatMembership(chatId, request.user.id);
      if (!member) return reply.code(403).send({ error: 'Нет доступа к чату' });
    }

    const token = crypto.randomBytes(24).toString('hex');
    const { rows } = await db.query(
      `INSERT INTO huginn_invites
         (token, inviter_user_id, phone, email, display_name, chat_id, status, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,'pending', NOW() + INTERVAL '7 days')
       RETURNING id, token, phone, email, display_name, chat_id, status, expires_at, created_at`,
      [token, request.user.id, phone, email, displayName, chatId]
    );
    const invite = rows[0];
    return {
      invite,
      invite_url: `/h/?invite=${encodeURIComponent(token)}`,
      accept_api: `/api/chat-groups/invites/${token}/accept`
    };
  });

  fastify.get('/invites/:token', async (request, reply) => {
    const token = String(request.params.token || '').trim();
    const { rows } = await db.query(
      `SELECT i.token, i.status, i.expires_at, i.display_name, i.phone, i.email,
              u.name AS inviter_name
       FROM huginn_invites i
       JOIN users u ON u.id = i.inviter_user_id
       WHERE i.token = $1`,
      [token]
    );
    const inv = rows[0];
    if (!inv) return reply.code(404).send({ error: 'Приглашение не найдено' });
    if (inv.status !== 'pending' || new Date(inv.expires_at) < new Date()) {
      return reply.code(410).send({ error: 'Приглашение недействительно', status: inv.status });
    }
    return {
      invite: {
        token: inv.token,
        inviter_name: inv.inviter_name,
        display_name: inv.display_name,
        expires_at: inv.expires_at
      }
    };
  });

  fastify.post('/invites/:token/accept', async (request, reply) => {
    const token = String(request.params.token || '').trim();
    const body = request.body || {};
    const name = String(body.name || body.display_name || '').trim();
    const phone = String(body.phone || '').trim();
    const password = String(body.password || '').trim();

    const { rows } = await db.query(
      `SELECT * FROM huginn_invites WHERE token = $1 FOR UPDATE`,
      [token]
    );
    const inv = rows[0];
    if (!inv) return reply.code(404).send({ error: 'Приглашение не найдено' });
    if (inv.status !== 'pending' || new Date(inv.expires_at) < new Date()) {
      return reply.code(410).send({ error: 'Приглашение недействительно' });
    }
    if (!name || name.length < 2) return reply.code(400).send({ error: 'Укажите имя' });
    if (!password || password.length < 6) return reply.code(400).send({ error: 'Пароль минимум 6 символов' });

    const loginPhone = phone || inv.phone || `guest_${inv.id}`;
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(password, 10);

    // Reuse ONLY existing huginn guests by phone — never overwrite CRM staff passwords
    let userId = null;
    if (inv.phone) {
      const existing = await db.query(
        `SELECT id, COALESCE(is_huginn_guest, false) AS is_huginn_guest, role, login
         FROM users WHERE phone = $1 OR login = $1 LIMIT 1`,
        [inv.phone]
      );
      if (existing.rows[0]) {
        const u = existing.rows[0];
        if (!u.is_huginn_guest) {
          return reply.code(409).send({
            error: 'Телефон уже привязан к учётной записи CRM. Войдите как сотрудник или используйте другой номер.'
          });
        }
        userId = u.id;
      }
    }

    if (!userId) {
      const login = 'hg_' + (loginPhone.replace(/\D/g, '') || String(inv.id));
      const { rows: created } = await db.query(
        `INSERT INTO users (name, login, password_hash, role, is_active, phone, created_at)
         VALUES ($1, $2, $3, 'FIELD_WORKER', true, $4, NOW())
         RETURNING id, name, login, role`,
        [name, login, hash, inv.phone || null]
      );
      userId = created[0].id;
      try {
        await db.query('UPDATE users SET is_huginn_guest = true WHERE id = $1', [userId]);
      } catch (_) { /* column before migrate */ }
    } else {
      await db.query(
        `UPDATE users SET password_hash = $2, name = COALESCE(NULLIF($3, ''), name), is_huginn_guest = true WHERE id = $1`,
        [userId, hash, name]
      );
    }

    await db.query(
      `UPDATE huginn_invites
       SET status = 'accepted', accepted_user_id = $2, accepted_at = NOW()
       WHERE id = $1`,
      [inv.id, userId]
    );

    // Ensure chat with inviter
    let chatId = inv.chat_id;
    if (!chatId) {
      const existingChat = await db.query(
        `SELECT c.id FROM chats c
         JOIN chat_group_members m1 ON m1.chat_id = c.id AND m1.user_id = $1
         JOIN chat_group_members m2 ON m2.chat_id = c.id AND m2.user_id = $2
         WHERE c.is_group = false
         LIMIT 1`,
        [inv.inviter_user_id, userId]
      );
      if (existingChat.rows[0]) {
        chatId = existingChat.rows[0].id;
      } else {
        const { rows: chats } = await db.query(
          `INSERT INTO chats (name, is_group, type, created_by, created_at, last_message_at)
           VALUES ($1, false, 'direct', $2, NOW(), NOW())
           RETURNING id`,
          [`Huginn`, inv.inviter_user_id]
        );
        chatId = chats[0].id;
        await db.query(
          `INSERT INTO chat_group_members (chat_id, user_id, role, joined_at)
           VALUES ($1,$2,'owner',NOW()), ($1,$3,'member',NOW())
           ON CONFLICT DO NOTHING`,
          [chatId, inv.inviter_user_id, userId]
        ).catch(async () => {
          await db.query(
            `INSERT INTO chat_group_members (chat_id, user_id, role) VALUES ($1,$2,'owner')`,
            [chatId, inv.inviter_user_id]
          );
          await db.query(
            `INSERT INTO chat_group_members (chat_id, user_id, role) VALUES ($1,$2,'member')`,
            [chatId, userId]
          );
        });
      }
    } else {
      await db.query(
        `INSERT INTO chat_group_members (chat_id, user_id, role)
         VALUES ($1, $2, 'member')
         ON CONFLICT DO NOTHING`,
        [chatId, userId]
      ).catch(() => {});
    }

    const huginnAcl = require('../services/huginn-acl');
    const jwtUser = huginnAcl.guestJwtClaims({
      id: userId,
      role: 'huginn_guest',
      name,
      login: 'hg_guest_' + userId
    });
    const tokenJwt = fastify.jwt.sign(jwtUser, { expiresIn: '30d' });

    await huginnEvents.publish(db, {
      userIds: [inv.inviter_user_id],
      eventType: 'huginn:invite_accepted',
      payload: { invite_id: inv.id, user_id: userId, chat_id: chatId, name },
      chatId
    });

    return { success: true, token: tokenJwt, user: jwtUser, chat_id: chatId };
  });

  fastify.post('/invites/:token/revoke', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const token = String(request.params.token || '').trim();
    const { rows } = await db.query(`SELECT * FROM huginn_invites WHERE token = $1`, [token]);
    const inv = rows[0];
    if (!inv) return reply.code(404).send({ error: 'not found' });
    if (inv.inviter_user_id !== request.user.id) {
      return reply.code(403).send({ error: 'Только пригласивший может отозвать' });
    }
    await db.query(`UPDATE huginn_invites SET status = 'revoked' WHERE id = $1`, [inv.id]);
    return { success: true };
  });

  // Story view mark (extends /api/stories)
  fastify.post('/stories/:storyId/view', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const storyId = parsePositiveInt(request.params.storyId);
    if (storyId == null) return reply.code(400).send({ error: 'bad id' });
    await db.query(
      `INSERT INTO chat_story_views (story_id, user_id, viewed_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (story_id, user_id) DO NOTHING`,
      [storyId, request.user.id]
    );
    return { success: true };
  });

  // Team stories feed with unread ring
  fastify.get('/stories/feed', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const uid = request.user.id;
    const { rows } = await db.query(
      `SELECT s.*, u.name AS user_name, u.avatar_url,
              EXISTS(
                SELECT 1 FROM chat_story_views v
                WHERE v.story_id = s.id AND v.user_id = $1
              ) AS viewed
       FROM user_stories s
       JOIN users u ON u.id = s.user_id
       WHERE s.expires_at > NOW()
       ORDER BY viewed ASC, s.created_at DESC`,
      [uid]
    );
    return { stories: rows };
  });

  // call_event helper used by dock/ting integration
  fastify.post('/:id/call-event', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const chatId = parsePositiveInt(request.params.id);
    if (chatId == null) return reply.code(400).send({ error: 'bad id' });
    const member = await getChatMembership(chatId, request.user.id);
    if (!member) return reply.code(403).send({ error: 'Нет доступа' });

    const body = request.body || {};
    const kind = body.kind === 'ting' ? 'ting' : 'audio';
    const status = ['missed', 'ended', 'canceled'].includes(body.status) ? body.status : 'ended';
    const duration = Number.isFinite(Number(body.duration_sec)) ? Number(body.duration_sec) : 0;
    const meta = {
      kind,
      direction: body.direction || 'outgoing',
      status,
      duration_sec: duration,
      room_id: body.room_id || null
    };
    const label = status === 'missed'
      ? 'Пропущенный звонок'
      : (kind === 'ting' ? `Тинг · ${duration}с` : `Звонок · ${duration}с`);

    const { rows } = await db.query(
      `INSERT INTO chat_messages
         (chat_id, user_id, message, message_type, metadata, is_system, created_at)
       VALUES ($1,$2,$3,'call_event',$4::jsonb,true,NOW())
       RETURNING *`,
      [chatId, request.user.id, label, JSON.stringify(meta)]
    );
    const msg = rows[0];
    await huginnEvents.publishToChatMembers(db, {
      chatId,
      eventType: 'chat:new_message',
      payload: { chat_id: chatId, message: msg }
    });
    return { message: msg };
  });

  // ── F10 Chat folders (per-user, no premium) ───────────────────
  fastify.get('/folders', {
    preHandler: [fastify.authenticate]
  }, async (request) => huginnFolders.listFolders(db, request.user.id));

  fastify.post('/folders', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const body = request.body || {};
      const folder = await huginnFolders.createFolder(db, request.user.id, {
        name: body.name,
        iconEmoji: body.icon_emoji || body.iconEmoji,
        sortOrder: body.sort_order
      });
      return { folder };
    } catch (e) {
      if (e.code === 'bad_request') return reply.code(400).send({ error: e.message });
      throw e;
    }
  });

  fastify.patch('/folders/:folderId', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const body = request.body || {};
      const folder = await huginnFolders.updateFolder(db, request.user.id, request.params.folderId, {
        name: body.name,
        iconEmoji: body.icon_emoji !== undefined ? body.icon_emoji : body.iconEmoji,
        sortOrder: body.sort_order
      });
      return { folder };
    } catch (e) {
      if (e.code === 'bad_request') return reply.code(400).send({ error: e.message });
      if (e.code === 'not_found') return reply.code(404).send({ error: e.message });
      throw e;
    }
  });

  fastify.delete('/folders/:folderId', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      return await huginnFolders.deleteFolder(db, request.user.id, request.params.folderId);
    } catch (e) {
      if (e.code === 'not_found') return reply.code(404).send({ error: e.message });
      throw e;
    }
  });

  fastify.put('/folders/reorder', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const ids = (request.body || {}).ids || (request.body || {}).folder_ids;
      return await huginnFolders.reorderFolders(db, request.user.id, ids);
    } catch (e) {
      if (e.code === 'bad_request') return reply.code(400).send({ error: e.message });
      throw e;
    }
  });

  fastify.put('/folders/active', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const folderId = (request.body || {}).folder_id;
      return await huginnFolders.setActiveFolder(db, request.user.id, folderId);
    } catch (e) {
      if (e.code === 'not_found') return reply.code(404).send({ error: e.message });
      throw e;
    }
  });

  fastify.put('/:id/folder', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const chatId = parsePositiveInt(request.params.id);
    if (chatId == null) return reply.code(400).send({ error: 'bad chat id' });
    const member = await getChatMembership(chatId, request.user.id);
    if (!member) return reply.code(403).send({ error: 'Нет доступа' });
    try {
      return await huginnFolders.assignChat(
        db,
        request.user.id,
        chatId,
        (request.body || {}).folder_id
      );
    } catch (e) {
      if (e.code === 'bad_request') return reply.code(400).send({ error: e.message });
      if (e.code === 'not_found') return reply.code(404).send({ error: e.message });
      throw e;
    }
  });

  // ── F11 AI Editor (corporate, all users, not Mimir stub) ──────
  fastify.post('/ai/rewrite', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const body = request.body || {};
    try {
      const result = await huginnAiEditor.rewrite(db, {
        userId: request.user.id,
        text: body.text,
        mode: body.mode,
        targetLang: body.target_lang || body.targetLang,
        styleId: body.style_id || body.styleId,
        emoji: body.emoji
      });
      return { ok: true, ...result };
    } catch (e) {
      if (e.code === 'text_required' || e.code === 'text_too_long' || e.code === 'bad_request') {
        return reply.code(400).send({ error: e.message, code: e.code, retryable: false });
      }
      if (e.code === 'rate_limit') {
        return reply.code(429).send({
          error: 'Слишком много запросов к ИИ-редактору. Подождите минуту.',
          code: 'rate_limit',
          retryable: true
        });
      }
      return reply.code(502).send({
        error: e.message || 'ИИ недоступен',
        code: e.code || 'ai_error',
        retryable: e.retryable !== false
      });
    }
  });

  fastify.get('/ai/styles', {
    preHandler: [fastify.authenticate]
  }, async (request) => huginnAiEditor.listStyles(db, request.user.id));

  fastify.post('/ai/styles', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const body = request.body || {};
      const style = await huginnAiEditor.createStyle(db, request.user.id, {
        name: body.name,
        iconEmoji: body.icon_emoji || body.iconEmoji,
        prompt: body.prompt
      });
      return { style };
    } catch (e) {
      if (e.code === 'bad_request') return reply.code(400).send({ error: e.message });
      throw e;
    }
  });

  fastify.post('/ai/styles/:styleId/share', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      return await huginnAiEditor.shareStyle(
        db,
        request.user.id,
        request.params.styleId,
        !!(request.body || {}).with_profile_link
      );
    } catch (e) {
      if (e.code === 'bad_request') return reply.code(400).send({ error: e.message });
      if (e.code === 'not_found') return reply.code(404).send({ error: e.message });
      throw e;
    }
  });

  // silence unused lint
  void sendToUser;
  void isUserOnline;
  void sseToMembers;
};
