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
const livekit = require('../services/thing-livekit');
const { sendIncomingCallPush } = require('../services/notify');
const { sendToUser } = require('./sse');

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
    const baseUrl = (process.env.PUBLIC_BASE_URL || 'https://asgard-crm.ru').replace(/\/+$/, '');
    const inviteUrl = `/h/?invite=${encodeURIComponent(token)}`;
    const fullUrl = baseUrl + inviteUrl;

    // Optional delivery: channel = 'email' | 'sms' | 'none' (link only).
    const channel = ['email', 'sms'].includes(String(body.channel || '')) ? String(body.channel) : 'none';
    const who = displayName || 'коллега';
    let delivery = { channel: 'none', sent: false };
    const msgText = `${who}, вас приглашают в мессенджер АСГАРД Хугинн. Установите приложение или откройте ссылку: ${fullUrl} (действует 7 дней)`;

    if (channel === 'email' && email) {
      try {
        const { sendCrmEmail } = require('../services/crm-mailer');
        const html = `<p>Здравствуйте${displayName ? ', ' + displayName : ''}!</p>
<p>${request.user.name || 'Коллега'} приглашает вас в корпоративный мессенджер <b>АСГАРД Хугинн</b>.</p>
<p>Откройте ссылку с телефона — приложение установится на экран «Домой» и откроет чат:</p>
<p><a href="${fullUrl}">${fullUrl}</a></p>
<p>Ссылка действует 7 дней.</p>`;
        await sendCrmEmail(db, request.user.id, {
          to: email,
          subject: 'Приглашение в АСГАРД Хугинн',
          text: msgText,
          html,
          skipBcc: true
        });
        delivery = { channel: 'email', sent: true, to: email };
      } catch (e) {
        delivery = { channel: 'email', sent: false, error: e.message };
      }
    } else if (channel === 'sms' && phone) {
      try {
        const MangoService = require('../services/mango');
        const client = new MangoService();
        const digits = String(phone).replace(/\D/g, '');
        await client.sendSms(process.env.MANGO_SMS_FROM || '', digits, `ASGARD: ${msgText}`, process.env.MANGO_SMS_SENDER || '');
        delivery = { channel: 'sms', sent: true, to: phone };
      } catch (e) {
        delivery = { channel: 'sms', sent: false, error: e.message };
      }
    }

    return {
      invite,
      invite_url: inviteUrl,
      accept_api: `/api/chat-groups/invites/${token}/accept`,
      full_url: fullUrl,
      delivery
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
    // Passwordless guests: an invite does not force a password anymore. If one is
    // supplied we honour it (legacy/dev flows); otherwise we store a random secret
    // nobody knows, so login happens only via SMS code / email link.
    const password = String(body.password || '').trim();
    if (password && password.length < 6) {
      return reply.code(400).send({ error: 'Пароль минимум 6 символов' });
    }

    const loginPhone = phone || inv.phone || '';
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(password || crypto.randomBytes(24).toString('hex'), 10);

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
      // Login must be the phone itself: the /h/ login screen asks for a phone, and
      // auth lookup is by login/email. Store it normalized so SMS login finds the guest.
      const digits = String(loginPhone).replace(/\D/g, '');
      const login = digits || ('hg_guest_' + inv.id);
      const { rows: created } = await db.query(
        `INSERT INTO users (name, login, password_hash, role, is_active, phone, email, created_at)
         VALUES ($1, $2, $3, 'FIELD_WORKER', true, $4, $5, NOW())
         RETURNING id, name, login, role`,
        [name, login, hash, inv.phone || null, inv.email || null]
      );
      userId = created[0].id;
      try {
        await db.query('UPDATE users SET is_huginn_guest = true WHERE id = $1', [userId]);
      } catch (_) { /* column before migrate */ }
    } else {
      await db.query(
        `UPDATE users
            SET password_hash = $2,
                name = COALESCE(NULLIF($3, ''), name),
                phone = COALESCE($4, phone),
                email = COALESCE($5, email),
                is_huginn_guest = true
          WHERE id = $1`,
        [userId, hash, name, inv.phone || null, inv.email || null]
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
          `INSERT INTO chats (name, is_group, type, created_at, last_message_at)
           VALUES ($1, false, 'direct', NOW(), NOW())
           RETURNING id`,
          [`Huginn`]
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

  // ═══════════════════════════════════════════════════════════════
  // 1:1 calls (LiveKit) — direct chats only, exactly two humans
  // ═══════════════════════════════════════════════════════════════

  async function getDirectPairForCall(chatId) {
    const { rows: [chat] } = await db.query(
      'SELECT id, name, type, is_group, is_mimir FROM chats WHERE id = $1',
      [chatId]
    );
    if (!chat) return { error: 'not_found' };
    if (chat.is_group || chat.type !== 'direct' || chat.is_mimir) return { error: 'not_direct' };
    const { rows: members } = await db.query(
      `SELECT m.user_id, u.name, u.role
         FROM chat_group_members m
         JOIN users u ON u.id = m.user_id
        WHERE m.chat_id = $1
        ORDER BY m.user_id`,
      [chatId]
    );
    if (members.length !== 2) return { error: 'not_pair' };
    return { chat, members };
  }

  async function getActiveCallForUser(userId) {
    // Expire stale rows so a dead call can never block the user forever:
    // - ringing that nobody answered;
    // - active that outlived any plausible call (token TTL is 2h).
    await db.query(
      `UPDATE huginn_calls SET status = 'canceled', ended_at = NOW()
        WHERE status = 'ringing' AND created_at < NOW() - INTERVAL '2 minutes'`
    ).catch(() => {});
    await db.query(
      `UPDATE huginn_calls SET status = 'ended', ended_at = NOW(),
              duration_sec = CASE WHEN answered_at IS NULL THEN 0
                                  ELSE GREATEST(0, EXTRACT(EPOCH FROM (NOW() - answered_at))::int) END
        WHERE status = 'active' AND created_at < NOW() - INTERVAL '4 hours'`
    ).catch(() => {});
    const { rows: [row] } = await db.query(
      `SELECT * FROM huginn_calls
        WHERE status IN ('ringing', 'active')
          AND (caller_id = $1 OR callee_id = $1)
        ORDER BY created_at DESC
        LIMIT 1`,
      [userId]
    );
    return row || null;
  }

  /** End a live call and notify both sides (single entry point for webhook/sweeper/end). */
  async function finalizeCall(call, reason, opts = {}) {
    // Default terminal status keeps decline distinguishable from a hangup.
    const terminal = opts.status === 'declined' ? 'declined'
      : opts.status === 'canceled' ? 'canceled' : null;
    const { rows: [updated] } = await db.query(
      `UPDATE huginn_calls
          SET status = COALESCE($2, CASE WHEN answered_at IS NULL THEN 'canceled' ELSE 'ended' END),
              ended_at = NOW(),
              duration_sec = CASE WHEN answered_at IS NULL THEN 0
                                  ELSE GREATEST(0, EXTRACT(EPOCH FROM (NOW() - answered_at))::int) END
        WHERE id = $1 AND status IN ('ringing', 'active') RETURNING *`,
      [call.id, terminal]
    );
    if (!updated) return null;
    const payload = { ...callPublicShape(updated), room: updated.livekit_room, reason: reason || updated.status };
    for (const uid of [Number(updated.caller_id), Number(updated.callee_id)]) {
      try {
        await huginnEvents.publish(db, { userIds: [uid], eventType: 'call:ended', payload });
      } catch (_) {}
      sendToUser(uid, 'call:ended', payload);
    }
    try { await livekit.deleteLiveKitRoom(updated.livekit_room); } catch (_) {}
    return updated;
  }

  /**
   * Reap 'active' calls whose LiveKit room is empty (backend crash, closed tab,
   * lost network). Without this a dead room would keep the user "busy" forever.
   */
  async function sweepStaleCalls() {
    if (!livekit.isConfigured()) return { swept: 0, checked: 0 };
    const { rows } = await db.query(
      `SELECT * FROM huginn_calls
        WHERE status = 'active' AND created_at > NOW() - INTERVAL '4 hours'
        ORDER BY created_at ASC LIMIT 25`
    ).catch(() => ({ rows: [] }));
    let swept = 0;
    for (const call of rows) {
      try {
        const parts = await livekit.listLiveKitParticipants(call.livekit_room);
        if (!parts || parts.length === 0) {
          // Grace: room may be empty only for a moment right after accept.
          const ageSec = (Date.now() - new Date(call.answered_at || call.created_at).getTime()) / 1000;
          if (ageSec < 45) continue;
          await finalizeCall(call, 'room_empty');
          swept++;
        }
      } catch (e) {
        // Room already gone on the SFU side — treat as finished.
        if (/not found|does not exist|no room/i.test(String(e.message || e))) {
          try { await finalizeCall(call, 'room_missing'); swept++; } catch (_) {}
        }
      }
    }
    return { swept, checked: rows.length };
  }

  function identityForCall(userId) {
    return 'user-' + userId;
  }

  async function tokenForCall(call, userId) {
    try {
      const out = await livekit.createAccessToken({
        roomName: call.livekit_room,
        identity: identityForCall(userId),
        name: String(userId),
        ttlSec: 2 * 60 * 60
      });
      return { token: out.token, ws_url: out.url };
    } catch (e) {
      return { token: null, ws_url: livekit.publicWsUrl(), error: e.message };
    }
  }

  function callPublicShape(call, extra) {
    return Object.assign({
      id: call.id,
      chat_id: call.chat_id,
      caller_id: call.caller_id,
      callee_id: call.callee_id,
      kind: call.kind,
      status: call.status,
      created_at: call.created_at,
      answered_at: call.answered_at,
      ended_at: call.ended_at,
      duration_sec: call.duration_sec
    }, extra || {});
  }

  /** Peer display name relative to a viewer (for the call window title). */
  async function peerNameForCall(call, viewerId) {
    const peerId = Number(call.caller_id) === Number(viewerId) ? call.callee_id : call.caller_id;
    const { rows: [u] } = await db.query('SELECT name FROM users WHERE id = $1', [peerId]);
    return u ? u.name : 'Сотрудник';
  }

  // POST /calls — start ringing a 1:1 call
  fastify.post('/calls', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const body = request.body || {};
    const chatId = parsePositiveInt(body.chat_id);
    const kind = body.kind === 'video' ? 'video' : 'audio';
    if (chatId == null) return reply.code(400).send({ error: 'chat_id required' });

    const pair = await getDirectPairForCall(chatId);
    if (pair.error === 'not_found') return reply.code(404).send({ error: 'Чат не найден' });
    if (pair.error === 'not_direct') return reply.code(400).send({ error: 'Звонок доступен только в личном чате' });
    if (pair.error === 'not_pair') return reply.code(409).send({ error: 'В этом чате не двое участников' });

    const me = Number(request.user.id);
    const other = pair.members.find((m) => Number(m.user_id) !== me);
    if (!other) return reply.code(403).send({ error: 'Вы не участник чата' });

    const myActive = await getActiveCallForUser(me);
    if (myActive) return reply.code(409).send({ error: 'У вас уже есть активный звонок', busy: true });
    const peerActive = await getActiveCallForUser(Number(other.user_id));
    if (peerActive) return reply.code(409).send({ error: 'Собеседник сейчас говорит по другому звонку', busy: true });

    const { rows: [call] } = await db.query(
      `INSERT INTO huginn_calls (chat_id, caller_id, callee_id, kind, status, livekit_room)
       VALUES ($1, $2, $3, $4, 'ringing', $5)
       RETURNING *`,
      [chatId, me, Number(other.user_id), kind, 'pending']
    ).catch((err) => {
      // uniq_huginn_calls_live_chat: someone already has a live call in this chat
      if (err && err.code === '23505') return { rows: [] };
      throw err;
    });
    if (!call) {
      return reply.code(409).send({ error: 'В этом чате уже идёт звонок', busy: true });
    }
    const room = 'huginn-call-' + call.id;
    await db.query('UPDATE huginn_calls SET livekit_room = $1 WHERE id = $2', [room, call.id]);
    call.livekit_room = room;

    if (livekit.isConfigured()) {
      try {
        await livekit.ensureLiveKitRoom(room, { maxParticipants: 2, emptyTimeout: 120 });
      } catch (e) {
        fastify.log.warn('ensureLiveKitRoom:', e.message);
      }
    }

    const callerName = request.user.name || 'Сотрудник';
    // Ring the callee: durable SSE (works across tabs) + web-push (works closed)
    try {
      await huginnEvents.publish(db, {
        userIds: [Number(other.user_id)],
        eventType: 'call:incoming',
        payload: { ...callPublicShape(call), from_name: callerName, peer_name: callerName, room }
      });
    } catch (_) {}
    sendToUser(Number(other.user_id), 'call:incoming', { ...callPublicShape(call), from_name: callerName, peer_name: callerName, room });
    sendIncomingCallPush(db, Number(other.user_id), {
      title: kind === 'video' ? 'Видеозвонок' : 'Звонок',
      body: callerName,
      from: callerName,
      tag: 'call-' + call.id,
      type: 'call',
      call_id: call.id,
      kind
    }).catch(() => {});

    const mine = await tokenForCall(call, me);
    return {
      call: callPublicShape(call, { peer_name: other.name }),
      room,
      ws_url: mine.ws_url,
      token: mine.token,
      livekit_ready: livekit.isConfigured(),
      // Anti-stub: without LiveKit there is no media, so the client must not
      // pretend a call is up — it shows the honest "calls unavailable" state.
      media_ok: !!mine.token
    };
  });

  // GET /calls/active — my current ring/active call (reconnect after reload)
  fastify.get('/calls/active', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const call = await getActiveCallForUser(Number(request.user.id));
    if (!call) return { call: null };
    const { rows: [row] } = await db.query(
      `SELECT id, name, type, is_group, is_mimir,
              (SELECT u.name FROM chat_group_members m JOIN users u ON u.id = m.user_id
                WHERE m.chat_id = c.id AND m.user_id <> $2 LIMIT 1) AS peer_name
         FROM chats c WHERE c.id = $1`,
      [call.chat_id, Number(request.user.id)]
    );
    return {
      call: callPublicShape(call, { peer_name: (row && row.peer_name) || 'Сотрудник' }),
      room: call.livekit_room,
      ws_url: livekit.publicWsUrl(),
      chat: row || null,
      incoming: Number(call.callee_id) === Number(request.user.id) && call.status === 'ringing'
    };
  });

  // GET /calls/history — читаемый журнал звонков пользователя.
  fastify.get('/calls/history', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const me = Number(request.user.id);
    const limitRaw = parsePositiveInt(request.query.limit);
    const limit = Math.min(Math.max(limitRaw || 50, 1), 100);
    const { rows } = await db.query(`
      SELECT c.id, c.chat_id, c.caller_id, c.callee_id, c.kind, c.status,
             c.created_at, c.answered_at, c.ended_at, c.duration_sec,
             CASE WHEN c.caller_id = $1 THEN c.callee_id ELSE c.caller_id END AS peer_id,
             (SELECT u.name FROM users u
               WHERE u.id = CASE WHEN c.caller_id = $1 THEN c.callee_id ELSE c.caller_id END) AS peer_name
        FROM huginn_calls c
       WHERE c.caller_id = $1 OR c.callee_id = $1
       ORDER BY c.created_at DESC
       LIMIT $2
    `, [me, limit]);
    return {
      calls: rows.map((r) => ({
        id: r.id,
        chat_id: r.chat_id,
        kind: r.kind,
        status: r.status,
        direction: Number(r.caller_id) === me ? 'out' : 'in',
        peer_id: r.peer_id,
        peer_name: r.peer_name || 'Сотрудник',
        created_at: r.created_at,
        duration_sec: r.duration_sec || 0,
        missed: r.status === 'missed' || r.status === 'declined' || r.status === 'canceled'
          || (r.status === 'ended' && !r.answered_at)
      }))
    };
  });

  // GET /calls/:id — status (poll fallback)
  fastify.get('/calls/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const id = parsePositiveInt(request.params.id);
    if (id == null) return reply.code(400).send({ error: 'bad id' });
    const { rows: [call] } = await db.query('SELECT * FROM huginn_calls WHERE id = $1', [id]);
    if (!call) return reply.code(404).send({ error: 'Звонок не найден' });
    const me = Number(request.user.id);
    if (Number(call.caller_id) !== me && Number(call.callee_id) !== me) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }
    return { call: callPublicShape(call), room: call.livekit_room };
  });

  // POST /calls/:id/token — (re)issue media token while the call is alive
  fastify.post('/calls/:id/token', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const id = parsePositiveInt(request.params.id);
    if (id == null) return reply.code(400).send({ error: 'bad id' });
    const { rows: [call] } = await db.query('SELECT * FROM huginn_calls WHERE id = $1', [id]);
    if (!call) return reply.code(404).send({ error: 'Звонок не найден' });
    const me = Number(request.user.id);
    if (Number(call.caller_id) !== me && Number(call.callee_id) !== me) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }
    if (!['ringing', 'active'].includes(call.status)) {
      return reply.code(409).send({ error: 'Звонок завершён' });
    }
    const out = await tokenForCall(call, me);
    return { call: callPublicShape(call), room: call.livekit_room, ws_url: out.ws_url, token: out.token };
  });

  // POST /calls/:id/answer — callee accepts
  fastify.post('/calls/:id/answer', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const id = parsePositiveInt(request.params.id);
    const me = Number(request.user.id);
    const { rows: [call] } = await db.query('SELECT * FROM huginn_calls WHERE id = $1', [id]);
    if (!call) return reply.code(404).send({ error: 'Звонок не найден' });
    if (Number(call.callee_id) !== me) return reply.code(403).send({ error: 'Не ваш звонок' });
    if (call.status !== 'ringing') return reply.code(409).send({ error: 'Звонок уже не звонит' });

    const { rows: [updated] } = await db.query(
      `UPDATE huginn_calls SET status = 'active', answered_at = NOW()
        WHERE id = $1 AND status = 'ringing' RETURNING *`,
      [id]
    );
    if (!updated) return reply.code(409).send({ error: 'Звонок уже не звонит' });

    const payload = { ...callPublicShape(updated), room: updated.livekit_room };
    try {
      await huginnEvents.publish(db, {
        userIds: [Number(updated.caller_id)],
        eventType: 'call:accepted',
        payload
      });
    } catch (_) {}
    sendToUser(Number(updated.caller_id), 'call:accepted', payload);

    const mine = await tokenForCall(updated, me);
    const peerName = await peerNameForCall(updated, me);
    return {
      call: callPublicShape(updated, { peer_name: peerName }),
      room: updated.livekit_room,
      ws_url: mine.ws_url,
      token: mine.token
    };
  });

  // POST /calls/:id/decline — callee rejects
  fastify.post('/calls/:id/decline', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const id = parsePositiveInt(request.params.id);
    const me = Number(request.user.id);
    const { rows: [call] } = await db.query('SELECT * FROM huginn_calls WHERE id = $1', [id]);
    if (!call) return reply.code(404).send({ error: 'Звонок не найден' });
    if (Number(call.callee_id) !== me) return reply.code(403).send({ error: 'Не ваш звонок' });

    // Single entry point keeps status 'declined' while still closing the room.
    const updated = await finalizeCall(call, 'declined', { status: 'declined' });
    if (!updated) return reply.code(409).send({ error: 'Звонок уже завершён' });

    const payload = { ...callPublicShape(updated), room: updated.livekit_room, reason: 'declined' };
    try {
      await huginnEvents.publish(db, {
        userIds: [Number(updated.caller_id)],
        eventType: 'call:declined',
        payload
      });
    } catch (_) {}
    sendToUser(Number(updated.caller_id), 'call:declined', payload);
    await writeCallEvent(updated, 'missed', Number(updated.caller_id));
    return { call: callPublicShape(updated) };
  });

  // POST /calls/:id/end — either side hangs up
  fastify.post('/calls/:id/end', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const id = parsePositiveInt(request.params.id);
    const me = Number(request.user.id);
    const { rows: [call] } = await db.query('SELECT * FROM huginn_calls WHERE id = $1', [id]);
    if (!call) return reply.code(404).send({ error: 'Звонок не найден' });
    if (Number(call.caller_id) !== me && Number(call.callee_id) !== me) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }
    // Single entry point: flip the row, notify BOTH sides, tear down the room.
    const updated = await finalizeCall(call, 'ended');
    if (!updated) return { call: callPublicShape(call), already: true };
    await writeCallEvent(updated, updated.status, me);
    return { call: callPublicShape(updated) };
  });

  /** System chat bubble about a finished call (reuses the call_event message type). */
  async function writeCallEvent(call, status, actorId) {
    try {
      const label = status === 'missed'
        ? 'Пропущенный звонок'
        : `Звонок · ${Number(call.duration_sec) || 0}с`;
      const meta = {
        kind: call.kind === 'video' ? 'video' : 'audio',
        direction: Number(call.caller_id) === Number(actorId) ? 'outgoing' : 'incoming',
        status: status === 'canceled' ? 'canceled' : status,
        duration_sec: Number(call.duration_sec) || 0,
        call_id: call.id
      };
      const { rows: [msg] } = await db.query(
        `INSERT INTO chat_messages
           (chat_id, user_id, message, message_type, metadata, is_system, created_at)
         VALUES ($1,$2,$3,'call_event',$4::jsonb,true,NOW())
         RETURNING *`,
        [call.chat_id, actorId, label, JSON.stringify(meta)]
      );
      await huginnEvents.publishToChatMembers(db, {
        chatId: call.chat_id,
        eventType: 'chat:new_message',
        payload: { chat_id: call.chat_id, message: msg }
      });
      return msg;
    } catch (e) {
      fastify.log.warn('writeCallEvent:', e.message);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Presence map (all) + Huginn directory
  // ═══════════════════════════════════════════════════════════════

  fastify.get('/presence/all', {
    preHandler: [fastify.authenticate]
  }, async () => {
    // Freshness > socket presence: a tab can hold a dead SSE socket open (phone
    // in pocket, laptop asleep) and would show as online forever. The client
    // pings /presence/ping every 25s, so last_seen_at is the honest signal.
    const { rows } = await db.query(
      `SELECT id AS user_id, name, last_seen_at,
              (last_seen_at IS NOT NULL AND last_seen_at > NOW() - INTERVAL '2 minutes') AS fresh
         FROM users
        WHERE is_active = true AND COALESCE(is_blocked, false) = false
        ORDER BY name`
    );
    return {
      presence: rows.map((r) => ({
        user_id: r.user_id,
        name: r.name,
        last_seen_at: r.last_seen_at,
        online: !!r.fresh
      }))
    };
  });

  fastify.get('/directory', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const me = Number(request.user.id);
    const { rows } = await db.query(
      `SELECT u.id AS user_id, u.name, u.role, u.last_seen_at,
              (u.last_seen_at IS NOT NULL AND u.last_seen_at > NOW() - INTERVAL '2 minutes') AS fresh,
              COALESCE(u.is_huginn_guest, false) AS is_huginn_guest,
              (SELECT c.id
                 FROM chats c
                 JOIN chat_group_members m1 ON m1.chat_id = c.id AND m1.user_id = $1
                 JOIN chat_group_members m2 ON m2.chat_id = c.id AND m2.user_id = u.id
                WHERE c.type = 'direct' AND COALESCE(c.is_group, false) = false
                  AND COALESCE(c.is_mimir, false) = false
                LIMIT 1) AS chat_id
         FROM users u
        WHERE u.id <> $1
          AND u.is_active = true
          AND COALESCE(u.is_blocked, false) = false
        ORDER BY u.name`,
      [me]
    );
    return {
      users: rows.map((r) => ({
        user_id: r.user_id,
        name: r.name,
        role: r.role,
        is_huginn_guest: r.is_huginn_guest,
        online: !!r.fresh,
        last_seen_at: r.last_seen_at,
        chat_id: r.chat_id || null
      }))
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // Clear chat history
  // ═══════════════════════════════════════════════════════════════

  fastify.delete('/:id/messages', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const chatId = parsePositiveInt(request.params.id);
    if (chatId == null) return reply.code(400).send({ error: 'bad chat id' });
    const member = await getChatMembership(chatId, request.user.id);
    if (!member) return reply.code(403).send({ error: 'Нет доступа' });
    if (member.role !== 'owner' && member.role !== 'admin') {
      return reply.code(403).send({ error: 'Очистить историю может владелец чата' });
    }
    await db.query(
      'UPDATE chat_messages SET deleted_at = NOW() WHERE chat_id = $1 AND deleted_at IS NULL',
      [chatId]
    );
    await sseToMembers(chatId, request.user.id, 'chat:cleared', { chat_id: chatId });
    return { success: true };
  });

  /**
   * LiveKit webhook: when the SFU reports the room finished, close the call row
   * so nobody stays "busy". Public endpoint, signature-verified only, and a
   * no-op unless the LiveKit keys are set.
   *
   * Fastify 4 has no built-in `rawBody`, and LiveKit posts
   * `application/webhook+json`, so we register a Buffer parser for that exact
   * type. Body-based JSON cannot be verified (no raw bytes), so it is refused
   * with 415 instead of being trusted.
   */
  const LIVEKIT_WEBHOOK_CT = 'application/webhook+json';
  fastify.addContentTypeParser(LIVEKIT_WEBHOOK_CT, { parseAs: 'buffer' }, (req, body, done) => done(null, body));
  fastify.post('/calls/webhook', async (request, reply) => {
    let Receiver;
    try {
      ({ WebhookReceiver: Receiver } = require('livekit-server-sdk'));
    } catch (_) {
      return reply.code(503).send({ error: 'livekit sdk unavailable' });
    }
    // WebhookReceiver(apiKey, apiSecret) — both are required, not one secret.
    const apiKey = String(process.env.LIVEKIT_API_KEY || '').trim();
    const apiSecret = String(process.env.LIVEKIT_WEBHOOK_SECRET || process.env.LIVEKIT_API_SECRET || '').trim();
    if (!Receiver || !apiKey || !apiSecret) {
      // Anti-stub: without keys we cannot verify the signature, so refuse.
      return reply.code(503).send({ error: 'webhook not configured' });
    }

    const ctype = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (ctype !== LIVEKIT_WEBHOOK_CT) {
      // Only the raw-body type can be signature-verified.
      return reply.code(415).send({ error: 'unsupported content-type' });
    }
    const raw = Buffer.isBuffer(request.body)
      ? request.body.toString('utf8')
      : (typeof request.body === 'string' ? request.body : null);
    if (raw == null) return reply.code(400).send({ error: 'raw body required' });

    let event;
    try {
      const receiver = new Receiver(apiKey, apiSecret);
      event = await receiver.receive(raw, String(request.headers.authorization || ''));
    } catch (e) {
      return reply.code(401).send({ error: 'invalid signature' });
    }
    const ev = String(event && event.event || '');
    const roomName = String((event && event.room && event.room.name) || '');
    if (!roomName || !/room_finished|participant_left|room_started/.test(ev)) {
      return { ok: true, ignored: ev || 'unknown' };
    }
    const { rows } = await db.query(
      `SELECT * FROM huginn_calls WHERE livekit_room = $1 AND status IN ('ringing','active') LIMIT 1`,
      [roomName]
    ).catch(() => ({ rows: [] }));
    const call = rows[0];
    if (!call) return { ok: true, ignored: 'no live call for room' };

    if (ev === 'room_finished') {
      await finalizeCall(call, 'room_finished');
      return { ok: true, ended: call.id };
    }
    if (ev === 'participant_left') {
      // One side dropped: end only if nobody is left in the room.
      try {
        const parts = await livekit.listLiveKitParticipants(roomName);
        if (!parts || parts.length === 0) {
          await finalizeCall(call, 'participant_left');
          return { ok: true, ended: call.id };
        }
      } catch (_) {
        await finalizeCall(call, 'participant_left');
        return { ok: true, ended: call.id };
      }
      return { ok: true, remaining: true };
    }
    return { ok: true, event: ev };
  });

  // ═══════════════════════════════════════════════════════════════
  // Guest (passwordless) login — SMS code + email magic link
  // ═══════════════════════════════════════════════════════════════

  const LOGIN_CODE_TTL_MIN = 15;
  const LOGIN_MAX_ATTEMPTS = 5;
  const LOGIN_COOLDOWN_SEC = 45;
  // Per-IP guard for the public code/link endpoints: without it anyone could
  // trigger paid SMS to arbitrary numbers.
  const LOGIN_IP_WINDOW_MS = 10 * 60 * 1000;
  const LOGIN_IP_MAX_PER_WINDOW = 8;
  const loginIpHits = new Map();

  function loginIpAllowed(ip) {
    const key = String(ip || 'unknown');
    const now = Date.now();
    const arr = (loginIpHits.get(key) || []).filter((t) => now - t < LOGIN_IP_WINDOW_MS);
    if (arr.length >= LOGIN_IP_MAX_PER_WINDOW) {
      loginIpHits.set(key, arr);
      return false;
    }
    arr.push(now);
    loginIpHits.set(key, arr);
    if (loginIpHits.size > 5000) {
      for (const [k, v] of loginIpHits) {
        if (!v.length || now - v[v.length - 1] > LOGIN_IP_WINDOW_MS) loginIpHits.delete(k);
      }
    }
    return true;
  }

  function normPhone(raw) {
    try {
      const m = require('../services/mango');
      const n = (m.normalizePhone || (m.default && m.default.normalizePhone));
      if (typeof n === 'function') return n(String(raw || ''));
    } catch (_) {}
    return String(raw || '').replace(/\D/g, '');
  }

  function publicBaseUrl() {
    return String(process.env.PUBLIC_BASE_URL || 'https://asgard-crm.ru').replace(/\/+$/, '');
  }

  function issueGuestToken(user) {
    const huginnAcl = require('../services/huginn-acl');
    const claims = huginnAcl.guestJwtClaims({
      id: user.id,
      role: 'huginn_guest',
      name: user.name,
      login: 'hg_guest_' + user.id
    });
    // Honest last-seen: guest login is activity. Without this, guests (and old
    // NULL rows) read as «не в сети» forever until their first presence ping.
    db.query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [user.id]).catch(() => {});
    return { token: fastify.jwt.sign(claims, { expiresIn: '30d' }), user: claims };
  }

  async function findGuestByContact({ phone, email }) {
    const digits = phone ? normPhone(phone).replace(/\D/g, '') : '';
    const mail = email ? String(email).trim().toLowerCase() : '';
    if (!digits && !mail) return null;
    const { rows } = await db.query(
      `SELECT id, name, login, phone, email, role, COALESCE(is_huginn_guest,false) AS is_huginn_guest
         FROM users
        WHERE (COALESCE(is_huginn_guest,false) = true OR role IN ('huginn_guest','HUGINN_GUEST'))
          AND (
            ($1 <> '' AND RIGHT(REGEXP_REPLACE(COALESCE(phone,''), '\\D', '', 'g'), 10) = RIGHT($1, 10))
            OR ($2 <> '' AND LOWER(COALESCE(email,'')) = $2)
          )
        ORDER BY id DESC LIMIT 1`,
      [digits, mail]
    );
    return rows[0] || null;
  }

  // POST /auth/request-code  { phone } — 4-digit code via SMS/Max
  fastify.post('/auth/request-code', async (request, reply) => {
    if (!loginIpAllowed(request.ip)) {
      return reply.code(429).send({ error: 'Слишком много запросов. Попробуйте позже' });
    }
    const body = request.body || {};
    const rawPhone = String(body.phone || '').trim();
    if (!rawPhone) return reply.code(400).send({ error: 'Укажите телефон' });
    const phone = normPhone(rawPhone);
    if (String(phone).replace(/\D/g, '').length < 11) {
      return reply.code(400).send({ error: 'Некорректный номер телефона' });
    }
    await db.query('DELETE FROM huginn_login_codes WHERE expires_at < NOW() - INTERVAL \'1 day\'').catch(() => {});

    const recent = await db.query(
      `SELECT id FROM huginn_login_codes
        WHERE phone = $1 AND kind = 'sms' AND used = false
          AND created_at > NOW() - ($2 || ' seconds')::interval LIMIT 1`,
      [phone, String(LOGIN_COOLDOWN_SEC)]
    ).catch(() => ({ rows: [] }));
    if (recent.rows && recent.rows.length) {
      return reply.code(429).send({ error: 'Код уже отправлен. Подождите минуту' });
    }

    const code = String(crypto.randomInt(1000, 10000));
    const codeHash = await require('bcryptjs').hash(code, 8);
    await db.query(
      `INSERT INTO huginn_login_codes (phone, code_hash, kind, expires_at)
       VALUES ($1, $2, 'sms', NOW() + ($3 || ' minutes')::interval)`,
      [phone, codeHash, String(LOGIN_CODE_TTL_MIN)]
    );

    let sent = false;
    let sendError = null;
    try {
      const MangoService = require('../services/mango');
      const client = new MangoService();
      const digits = String(phone).replace(/\D/g, '');
      await client.sendSms(
        process.env.MANGO_SMS_EXTENSION || process.env.MANGO_SMS_FROM || '101',
        digits,
        `Kod vhoda Huginn: ${code}`,
        process.env.MANGO_SMS_SENDER || ''
      );
      sent = true;
    } catch (e) {
      sendError = e.message;
    }

    // A guest who is already known gets a Max/Telegram-free path too: the code is
    // never returned in the response, only the delivery status.
    return {
      ok: true,
      sent,
      channel: 'sms',
      expires_in: LOGIN_CODE_TTL_MIN * 60,
      error: sent ? undefined : (sendError || 'Не удалось отправить SMS')
    };
  });

  // POST /auth/request-link  { email } — magic link (always 200: no user enumeration)
  fastify.post('/auth/request-link', async (request, reply) => {
    if (!loginIpAllowed(request.ip)) {
      return reply.code(429).send({ error: 'Слишком много запросов. Попробуйте позже' });
    }
    const body = request.body || {};
    const email = String(body.email || '').trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return reply.code(400).send({ error: 'Некорректный email' });
    }
    const token = crypto.randomBytes(24).toString('hex');
    await db.query(
      `INSERT INTO huginn_login_codes (email, token, kind, expires_at)
       VALUES ($1, $2, 'email', NOW() + ($3 || ' minutes')::interval)`,
      [email, token, String(LOGIN_CODE_TTL_MIN)]
    );
    const link = publicBaseUrl() + '/h/?login=' + token;
    let sent = false;
    let sendError = null;
    try {
      const { sendCrmEmail } = require('../services/crm-mailer');
      await sendCrmEmail(db, null, {
        to: email,
        subject: 'Вход в АСГАРД Хугинн',
        text: `Ссылка для входа в Хугинн (действует ${LOGIN_CODE_TTL_MIN} мин): ${link}`,
        html: `<p>Ссылка для входа в <b>АСГАРД Хугинн</b>:</p><p><a href="${link}">${link}</a></p><p>Ссылка действует ${LOGIN_CODE_TTL_MIN} минут.</p>`,
        skipBcc: true
      });
      sent = true;
    } catch (e) {
      sendError = e.message;
    }
    return { ok: true, sent, channel: 'email', error: sent ? undefined : (sendError || 'Не удалось отправить письмо') };
  });

  // POST /auth/verify  { phone, code } | { token } — issue guest JWT
  fastify.post('/auth/verify', async (request, reply) => {
    const body = request.body || {};
    const tokenRaw = String(body.token || '').trim();

    if (tokenRaw) {
      const { rows: [row] } = await db.query(
        `SELECT * FROM huginn_login_codes
          WHERE token = $1 AND kind = 'email' AND used = false AND expires_at > NOW() LIMIT 1`,
        [tokenRaw]
      );
      if (!row) return reply.code(401).send({ error: 'Ссылка недействительна или истекла' });
      const guest = await findGuestByContact({ email: row.email });
      if (!guest) {
        return reply.code(404).send({
          error: 'Аккаунт не найден. Примите приглашение по ссылке из письма или запросите новое.'
        });
      }
      await db.query('UPDATE huginn_login_codes SET used = true WHERE id = $1', [row.id]);
      const { token, user } = issueGuestToken(guest);
      return { success: true, token, user };
    }

    const rawPhone = String(body.phone || '').trim();
    const entered = String(body.code || '').replace(/\D/g, '');
    if (!rawPhone || entered.length < 4) {
      return reply.code(400).send({ error: 'Укажите телефон и код' });
    }
    const phone = normPhone(rawPhone);
    const { rows: codes } = await db.query(
      `SELECT * FROM huginn_login_codes
        WHERE phone = $1 AND kind = 'sms' AND used = false AND expires_at > NOW()
        ORDER BY created_at DESC`,
      [phone]
    );
    if (!codes.length) return reply.code(401).send({ error: 'Код не найден или истёк. Запросите новый' });

    const bcryptjs = require('bcryptjs');
    let match = null;
    for (const c of codes) {
      if (c.attempts >= LOGIN_MAX_ATTEMPTS) continue;
      // eslint-disable-next-line no-await-in-loop
      if (await bcryptjs.compare(entered, c.code_hash || '')) { match = c; break; }
    }
    if (!match) {
      const latest = codes[0];
      await db.query('UPDATE huginn_login_codes SET attempts = attempts + 1 WHERE id = $1', [latest.id]);
      return reply.code(401).send({ error: 'Неверный код' });
    }
    await db.query('UPDATE huginn_login_codes SET used = true WHERE id = $1', [match.id]);

    const guest = await findGuestByContact({ phone });
    if (!guest) {
      return reply.code(404).send({
        error: 'Аккаунт не найден. Примите приглашение по ссылке или попросите новое.'
      });
    }
    // Make the guest reachable by phone next time even if the invite came by email.
    await db.query(
      'UPDATE users SET phone = COALESCE(NULLIF($2, \'\'), phone), is_huginn_guest = true WHERE id = $1',
      [guest.id, phone]
    ).catch(() => {});
    const { token, user } = issueGuestToken(guest);
    return { success: true, token, user };
  });

  // GET /auth/check?phone=... — does a guest exist for this phone (no enumeration of CRM staff)
  fastify.get('/auth/check', async (request) => {
    const guest = await findGuestByContact({ phone: request.query.phone });
    return { guest: !!guest, name: guest ? guest.name : null };
  });

  // Periodic sweep of dead LiveKit rooms (safe no-op without LiveKit).
  try {
    const SWEEP_MS = 5 * 60 * 1000;
    const t = setInterval(() => { sweepStaleCalls().catch(() => {}); }, SWEEP_MS);
    if (t.unref) t.unref();
  } catch (_) {}
};
