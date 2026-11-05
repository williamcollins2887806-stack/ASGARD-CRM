'use strict';

/**
 * ASGARD CRM — Тинг (/api/thing)
 * Комнаты LiveKit, dial_code 6 цифр, protocol_enabled, guest token.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isDialCode, isSlug } = require('../services/thing-codes');
const livekit = require('../services/thing-livekit');
const pipeline = require('../services/thing-pipeline');
const lifecycle = require('../services/thing-lifecycle');
const { createThingRoom, publicBaseUrl } = require('../services/thing-create');
const { createNotification } = require('../services/notify');

const DIRECTOR_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

const CRM_ROLE_TITLE = {
  ADMIN: 'администратор',
  DIRECTOR_GEN: 'генеральный директор',
  DIRECTOR_COMM: 'коммерческий директор',
  DIRECTOR_DEV: 'директор по развитию',
  PM: 'руководитель проекта',
  HEAD_PM: 'руководитель проектов',
  TO: 'технический отдел',
  HEAD_TO: 'руководитель ТО',
  BUH: 'бухгалтер',
  HR: 'HR',
  HR_MANAGER: 'руководитель HR',
  OM: 'офис-менеджер'
};

function roleTitle(role) {
  return CRM_ROLE_TITLE[role] || '';
}

/** Клиент иногда шлёт заглушку «Участник» — не перекрываем ею ФИО из CRM. */
function isPlaceholderDisplayName(name) {
  const s = String(name || '').trim();
  if (!s) return true;
  if (/^участник(\s+\d+)?$/i.test(s)) return true;
  if (/^user_\d+$/i.test(s)) return true;
  if (/^(гость|вы)$/i.test(s)) return true;
  return false;
}

function roomPublicUrl(slug) {
  return `${publicBaseUrl()}/ting/${slug}`;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

module.exports = async function thingRoutes(fastify) {
  const db = fastify.db;

  /** PIN fail rate-limit: 5 fails / 10 min per IP (in-memory). */
  const pinFailMap = new Map();
  const PIN_WINDOW_MS = 10 * 60 * 1000;
  const PIN_MAX_FAILS = 5;

  /**
   * D6: ключ лимита брался из ПЕРВОГО элемента X-Forwarded-For, который клиент
   * подставляет сам, — 4-значный PIN перебирался сменой заголовка.
   * Правильно: последний адрес в цепочке = тот, что добавил наш nginx
   * ($proxy_add_x_forwarded_for дописывает реальный peer в конец).
   */
  function clientIp(request) {
    const raw = String(request.headers['x-forwarded-for'] || '').trim();
    if (raw) {
      const list = raw.split(',').map(s => s.trim()).filter(Boolean);
      if (list.length) return list[list.length - 1];
    }
    return String(request.ip || request.socket?.remoteAddress || 'unknown');
  }

  function pinRateKey(request, roomId) {
    /* Ключ по IP + комната: иначе 5 неудач в чужой комнате блокировали вход в свою. */
    return roomId ? `pin:${roomId}:${clientIp(request)}` : `pin:${clientIp(request)}`;
  }

  function pinRateCheck(key) {
    const now = Date.now();
    const e = pinFailMap.get(key);
    if (!e || now > e.resetAt) return { ok: true };
    if (e.count >= PIN_MAX_FAILS) return { ok: false };
    return { ok: true };
  }

  function pinRateFail(key) {
    const now = Date.now();
    let e = pinFailMap.get(key);
    if (!e || now > e.resetAt) e = { count: 0, resetAt: now + PIN_WINDOW_MS };
    e.count += 1;
    pinFailMap.set(key, e);
    return e.count;
  }

  function makeJoinToken() {
    const token = crypto.randomBytes(32).toString('hex');
    return { token, hash: hashToken(token) };
  }

  /** Persist LiveKit room name if missing (legacy / failed create). */
  async function ensureRoomMediaName(room) {
    if (room.livekit_room_name) return room;
    const { livekitRoomName } = await livekit.ensureLiveKitRoom(room.slug, {
      maxParticipants: room.max_participants || 50
    });
    await db.query(
      `UPDATE thing_rooms SET livekit_room_name = $2, updated_at = NOW() WHERE id = $1`,
      [room.id, livekitRoomName]
    );
    room.livekit_room_name = livekitRoomName;
    return room;
  }

  function mapLivekitError(reply, err, ctx) {
    const msg = (err && err.message) ? String(err.message) : 'LiveKit error';
    const code = (err && err.code) || (/не настроен/i.test(msg) ? 'LIVEKIT_NOT_CONFIGURED' : 'LIVEKIT_TOKEN_FAILED');
    const status = code === 'LIVEKIT_NOT_CONFIGURED' ? 503
      : (code === 'LIVEKIT_ROOM_MISSING' || code === 'LIVEKIT_IDENTITY_MISSING') ? 502
        : 502;
    fastify.log.error({ err, slug: ctx && ctx.slug, userId: ctx && ctx.userId, code }, '[thing] token failed');
    return reply.code(status).send({ error: msg, code });
  }

  /**
   * C04/C05: режимы конференции.
   * 'webinar' — зрители не публикуют вообще;
   * 'podium'  — публикуют только модераторы и первые N «спикеров»;
   * 'meeting' — все равны (по умолчанию).
   * Возвращает canPublishSources или null (без ограничений).
   */
  async function publishPolicyFor(room, { isModerator, participantsCount }) {
    const mode = String(room.conference_mode || 'meeting');
    if (isModerator || mode === 'meeting') return { canPublish: true, sources: null, role: 'speaker' };

    if (mode === 'webinar') {
      // Зритель: слышит и видит, но не публикует (можно поднять руку через data-channel).
      return { canPublish: false, sources: [], role: 'audience' };
    }
    if (mode === 'podium') {
      const slots = Math.max(1, parseInt(room.speaker_slots, 10) || 4);
      // Считаем уже выступающих на SFU (enum приходят числами — нормализуем).
      let speakers = 0;
      if (livekit.isConfigured() && room.livekit_room_name) {
        try {
          const parts = await livekit.listLiveKitParticipants(room.livekit_room_name);
          speakers = (parts || []).filter(p => (p.tracks || []).some(t => {
            const src = livekit.trackSourceName(t);
            return livekit.isAudioSource(src) || livekit.isCameraSource(src);
          })).length;
        } catch (_) { speakers = participantsCount || 0; }
      } else {
        speakers = participantsCount || 0;
      }
      if (speakers < slots) return { canPublish: true, sources: null, role: 'speaker' };
      return { canPublish: false, sources: [], role: 'audience' };
    }

    return { canPublish: true, sources: null, role: 'speaker' };
  }

  /** Уже в комнате (для admit / CRM token). Waiting не считаем — иначе admit deadlock ROOM_FULL. */
  async function countAdmittedParticipants(roomId) {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM thing_participants
       WHERE room_id = $1 AND left_at IS NULL AND lobby_status = 'admitted'`,
      [roomId]
    );
    return rows[0] ? rows[0].n : 0;
  }

  /**
   * D3: max_video раньше писался в БД и нигде не применялся.
   * Считаем, сколько участников уже публикуют камеру на SFU; если слоты кончились,
   * новый участник входит с audio-only (canPublishSources = микрофон).
   */
  async function videoSlotsAvailable(room) {
    const maxVideo = Math.max(1, parseInt(room.max_video, 10) || 3);
    if (!livekit.isConfigured()) return { allowed: true, used: 0, max: maxVideo };
    try {
      const parts = await livekit.listLiveKitParticipants(room.livekit_room_name);
      let used = 0;
      for (const p of parts || []) {
        /* SDK отдаёт source числом (CAMERA=1) — сравнение строками не работало. */
        const hasCam = (p.tracks || []).some(t => livekit.isCameraSource(livekit.trackSourceName(t)));
        if (hasCam) used++;
      }
      return { allowed: used < maxVideo, used, max: maxVideo };
    } catch (_) {
      return { allowed: true, used: 0, max: maxVideo };
    }
  }

  /** Очередь + в комнате (лимит на guest-token, чтобы не забить waiting). */
  async function countOccupyingParticipants(roomId) {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM thing_participants
       WHERE room_id = $1 AND left_at IS NULL AND lobby_status IN ('admitted', 'waiting')`,
      [roomId]
    );
    return rows[0] ? rows[0].n : 0;
  }

  /** Numeric id всегда по PK. Dial-code lookup — только в /dial-in/resolve. */
  async function loadRoom(idOrCode) {
    const key = String(idOrCode || '').trim();
    if (!key) return null;
    if (/^\d+$/.test(key)) {
      const { rows } = await db.query(`SELECT * FROM thing_rooms WHERE id = $1`, [parseInt(key, 10)]);
      return rows[0] || null;
    }
    if (isSlug(key)) {
      const { rows } = await db.query(`SELECT * FROM thing_rooms WHERE slug = $1`, [key.toLowerCase()]);
      return rows[0] || null;
    }
    const { rows } = await db.query(`SELECT * FROM thing_rooms WHERE slug = $1 OR livekit_room_name = $1`, [key]);
    return rows[0] || null;
  }

  /**
   * Публичный вход: slug ИЛИ dial_code (6 цифр с карточки / ТВ / телефона).
   * Раньше TV слал 333141 как slug → «Тинг не найден», хотя dial_code живой.
   */
  async function loadPublicRoomByCode(code) {
    const key = String(code || '').trim().toLowerCase();
    if (!key) return null;
    if (isDialCode(key)) {
      const { rows } = await db.query(
        `SELECT * FROM thing_rooms
          WHERE dial_code = $1 AND status IN ('open', 'scheduled', 'live')
          ORDER BY id DESC LIMIT 1`,
        [key]
      );
      return rows[0] || null;
    }
    if (!isSlug(key)) return null;
    const { rows } = await db.query(`SELECT * FROM thing_rooms WHERE slug = $1`, [key]);
    return rows[0] || null;
  }

  async function canAccessRoom(room, user) {
    if (!room || !user) return false;
    if (DIRECTOR_ROLES.includes(user.role)) return true;
    if (room.host_user_id === user.id) return true;
    if (room.meeting_id) {
      const { rows } = await db.query(
        `SELECT 1 FROM meetings WHERE id = $1 AND organizer_id = $2
         UNION
         SELECT 1 FROM meeting_participants WHERE meeting_id = $1 AND user_id = $2
         LIMIT 1`,
        [room.meeting_id, user.id]
      );
      if (rows.length) return true;
    }
    const { rows: p } = await db.query(
      `SELECT 1 FROM thing_participants
       WHERE room_id = $1 AND user_id = $2
         AND left_at IS NULL
         AND lobby_status NOT IN ('rejected')
       LIMIT 1`,
      [room.id, user.id]
    );
    return p.length > 0;
  }

  /** Хост комнаты — только host_user_id (roomAdmin / moderation). Директора — через canAccessRoom. */
  function isHost(room, user) {
    return !!(room && user && room.host_user_id === user.id);
  }

  /**
   * D: раньше любое действие модерации требовало isHost, поэтому директор видел
   * комнату, но не мог управлять. Теперь хост, соорганизатор (co_host/moderator)
   * и директора CRM.
   */
  function canModerate(room, user) {
    if (!room || !user) return false;
    if (room.host_user_id === user.id) return true;
    if (DIRECTOR_ROLES.includes(user.role)) return true;
    return false;
  }

  /** Проверка co_host из БД (назначается в середине встречи, без переподключения). */
  async function isCoHost(roomId, userId) {
    if (!userId) return false;
    const { rows } = await db.query(
      `SELECT 1 FROM thing_participants
        WHERE room_id = $1 AND user_id = $2 AND role IN ('co_host', 'moderator')
          AND lobby_status <> 'rejected'
        LIMIT 1`,
      [roomId, userId]
    );
    return rows.length > 0;
  }

  async function canModerateAsync(room, user) {
    if (canModerate(room, user)) return true;
    return isCoHost(room.id, user && user.id);
  }

  /** Протокол v1 — строго инициатор (host_user_id), даже директор-нехост не видит */
  function isProtocolOwner(room, user) {
    return room && user && room.host_user_id === user.id;
  }

  function serializeRoom(room, { includeSecrets = false } = {}) {
    if (!room) return null;
    const out = {
      id: room.id,
      meeting_id: room.meeting_id,
      slug: room.slug,
      title: room.title,
      host_user_id: room.host_user_id,
      mode: room.mode,
      status: room.status,
      lobby_enabled: room.lobby_enabled,
      allow_guests: room.allow_guests,
      max_participants: room.max_participants,
      max_video: room.max_video,
      recording_mode: room.recording_mode,
      protocol_enabled: room.protocol_enabled,
      locked: Boolean(room.locked),
      lobby_policy: room.lobby_policy || 'all',
      conference_mode: room.conference_mode || 'meeting',
      speaker_slots: room.speaker_slots || 4,
      forced_layout: room.forced_layout || null,
      scheduled_at: room.scheduled_at || null,
      pin_required: Boolean(room.pin_code),
      url: roomPublicUrl(room.slug),
      started_at: room.started_at,
      ended_at: room.ended_at,
      created_at: room.created_at,
      livekit_configured: livekit.isConfigured()
    };
    if (includeSecrets) {
      out.dial_code = room.dial_code;
      out.livekit_room_name = room.livekit_room_name;
      out.pin_code = room.pin_code;
    }
    return out;
  }

  async function queryChat(roomId) {
    const { rows } = await db.query(
      `SELECT id, identity, user_id, display_name, text,
              file_url, file_name, file_size, mime_type, created_at
       FROM thing_chat_messages
       WHERE room_id = $1
       ORDER BY id DESC
       LIMIT 100`,
      [roomId]
    );
    return rows.reverse().map((r) => ({
      id: r.id,
      identity: r.identity,
      user_id: r.user_id,
      display_name: r.display_name,
      author: r.display_name,
      text: r.text,
      file_url: r.file_url || null,
      file_name: r.file_name || null,
      file_size: r.file_size || null,
      mime_type: r.mime_type || null,
      created_at: r.created_at
    }));
  }

  async function insertChat({ roomId, identity, userId, displayName, text, fileUrl, fileName, fileSize, mimeType }) {
    const { rows } = await db.query(
      `INSERT INTO thing_chat_messages
         (room_id, identity, user_id, display_name, text, file_url, file_name, file_size, mime_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, identity, user_id, display_name, text, file_url, file_name, file_size, mime_type, created_at`,
      [roomId, identity || null, userId || null, displayName, text,
        fileUrl || null, fileName || null, fileSize || null, mimeType || null]
    );
    const r = rows[0];
    return {
      id: r.id,
      identity: r.identity,
      user_id: r.user_id,
      display_name: r.display_name,
      author: r.display_name,
      text: r.text,
      file_url: r.file_url || null,
      file_name: r.file_name || null,
      file_size: r.file_size || null,
      mime_type: r.mime_type || null,
      created_at: r.created_at
    };
  }

  async function findAdmittedParticipant(roomId, identity) {
    const { rows } = await db.query(
      `SELECT * FROM thing_participants
       WHERE room_id = $1 AND identity = $2
         AND lobby_status = 'admitted' AND left_at IS NULL
       LIMIT 1`,
      [roomId, identity]
    );
    return rows[0] || null;
  }

  // ─── CREATE ─────────────────────────────────────────────────
  fastify.post('/rooms', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const body = request.body || {};
    try {
      if (body.meeting_id) {
        const meetingId = parseInt(body.meeting_id, 10);
        const { rows: m } = await db.query(`SELECT id, organizer_id FROM meetings WHERE id = $1`, [meetingId]);
        if (!m[0]) return reply.code(404).send({ error: 'Совещание не найдено' });
        if (m[0].organizer_id !== request.user.id && !DIRECTOR_ROLES.includes(request.user.role)) {
          return reply.code(403).send({ error: 'Только организатор может привязать Тинг' });
        }
      }
      const { room, livekit_created } = await createThingRoom(db, {
        title: body.title,
        hostUserId: request.user.id,
        hostDisplayName: request.user.name || request.user.email || `user-${request.user.id}`,
        meetingId: body.meeting_id,
        mode: body.mode,
        protocol_enabled: body.protocol_enabled,
        pin_code: body.pin_code,
        lobby_enabled: body.lobby_enabled,
        allow_guests: body.allow_guests,
        max_participants: body.max_participants,
        max_video: body.max_video,
        recording_mode: body.recording_mode,
        overwrite_conference_url: body.overwrite_conference_url
      });
      return reply.code(201).send({
        room: serializeRoom(room, { includeSecrets: true }),
        livekit_created,
        dial_in: await getDialInInfo(db)
      });
    } catch (e) {
      const code = e.statusCode || 500;
      return reply.code(code).send({ error: e.message || 'Ошибка создания Тинга' });
    }
  });

  // ─── LIST mine ──────────────────────────────────────────────
  fastify.get('/rooms', { preHandler: [fastify.authenticate] }, async (request) => {
    const { rows } = await db.query(
      `SELECT * FROM thing_rooms
       WHERE host_user_id = $1 OR id IN (
         SELECT room_id FROM thing_participants
         WHERE user_id = $1 AND left_at IS NULL AND lobby_status NOT IN ('rejected')
       )
       ORDER BY created_at DESC
       LIMIT 50`,
      [request.user.id]
    );
    return { rooms: rows.map((r) => serializeRoom(r)) };
  });

  // ─── GET room ───────────────────────────────────────────────
  fastify.get('/rooms/:idOrCode', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const room = await loadRoom(request.params.idOrCode);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (!(await canAccessRoom(room, request.user))) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }
    return { room: serializeRoom(room, { includeSecrets: isHost(room, request.user) }) };
  });

  // ─── TOKEN (CRM user) ───────────────────────────────────────
  fastify.post('/rooms/:id/token', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const room = await loadRoom(request.params.id);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (room.status === 'ended' || room.status === 'cancelled') {
      return reply.code(410).send({ error: 'Тинг завершён' });
    }
    if (!(await canAccessRoom(room, request.user))) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }
    if (!livekit.isConfigured()) {
      return reply.code(503).send({
        error: 'LiveKit ещё не развёрнут на сервере (P1)',
        code: 'LIVEKIT_NOT_CONFIGURED'
      });
    }

    const identity = `user_${request.user.id}`;
    const bodyName = request.body && String(request.body.display_name || '').trim();
    let displayName = request.user.name || request.user.email || `Участник ${request.user.id}`;
    let jobTitle = roleTitle(request.user.role);
    try {
      const { rows: urows } = await db.query(
        `SELECT name, role FROM users WHERE id = $1 LIMIT 1`,
        [request.user.id]
      );
      if (urows[0]) {
        // ФИО из CRM — источник истины; body.display_name только если это не заглушка
        if (urows[0].name) displayName = urows[0].name;
        jobTitle = roleTitle(urows[0].role) || jobTitle;
      }
    } catch (_) { /* */ }
    if (bodyName && !isPlaceholderDisplayName(bodyName)) {
      displayName = bodyName.slice(0, 80);
    }
    displayName = String(displayName || `Участник ${request.user.id}`).slice(0, 80);
    const host = isHost(room, request.user);
    const role = host ? 'host' : 'member';

    const { rows: existing } = await db.query(
      `SELECT lobby_status, left_at FROM thing_participants
       WHERE room_id = $1 AND identity = $2 LIMIT 1`,
      [room.id, identity]
    );
    if (existing[0] && existing[0].lobby_status === 'rejected') {
      return reply.code(403).send({ error: 'Доступ в комнату отклонён', code: 'LOBBY_REJECTED' });
    }
    const alreadyAdmitted = existing[0] && !existing[0].left_at && existing[0].lobby_status === 'admitted';
    /* C01: CRM-сотрудник при политике 'guests' не сидит в лобби (как в Телемосте/TrueConf). */
    const invitedCrm = Boolean(request.user && !host);
    const lobbyPolicy = String(room.lobby_policy || 'all');
    const lobbyApplies = room.lobby_enabled
      && !host
      && !(lobbyPolicy === 'guests' && invitedCrm);
    const needLobby = !!(lobbyApplies && !alreadyAdmitted);
    if (!alreadyAdmitted && !host && !needLobby) {
      const active = await countAdmittedParticipants(room.id);
      const maxP = room.max_participants || 50;
      if (active >= maxP) {
        return reply.code(403).send({ error: 'Комната заполнена', code: 'ROOM_FULL' });
      }
    }
    if (needLobby) {
      const occupying = await countOccupyingParticipants(room.id);
      const maxP = room.max_participants || 50;
      if (occupying >= maxP && !(existing[0] && !existing[0].left_at && existing[0].lobby_status === 'waiting')) {
        return reply.code(403).send({ error: 'Комната заполнена', code: 'ROOM_FULL' });
      }
    }
    const { token: joinToken, hash: joinHash } = makeJoinToken();
    const lobbyStatus = needLobby ? 'waiting' : 'admitted';
    try {
      if (existing[0] && existing[0].left_at && existing[0].lobby_status !== 'rejected') {
        await db.query(
          `UPDATE thing_participants
           SET left_at = NULL, lobby_status = $6::text,
               display_name = $3, role = $4, user_id = $5,
               join_token_hash = $7,
               joined_at = CASE WHEN $6::text = 'admitted' THEN COALESCE(joined_at, NOW()) ELSE joined_at END
           WHERE room_id = $1 AND identity = $2`,
          [room.id, identity, displayName, role, request.user.id, lobbyStatus, joinHash]
        );
      } else if (existing[0] && existing[0].lobby_status === 'waiting' && needLobby) {
        await db.query(
          `UPDATE thing_participants
           SET display_name = $3, role = $4, user_id = $5, join_token_hash = $6, left_at = NULL
           WHERE room_id = $1 AND identity = $2`,
          [room.id, identity, displayName, role, request.user.id, joinHash]
        );
      } else {
        await db.query(
          `INSERT INTO thing_participants
             (room_id, user_id, role, display_name, identity, lobby_status, left_at, joined_at, join_token_hash)
           VALUES ($1, $2, $3, $4, $5, $6::text, NULL, CASE WHEN $6::text = 'admitted' THEN NOW() ELSE NULL END, $7)
           ON CONFLICT (room_id, identity) DO UPDATE SET
             user_id = EXCLUDED.user_id,
             role = EXCLUDED.role,
             display_name = EXCLUDED.display_name,
             join_token_hash = EXCLUDED.join_token_hash,
             lobby_status = CASE
               WHEN thing_participants.lobby_status = 'rejected' THEN thing_participants.lobby_status
               WHEN thing_participants.lobby_status = 'admitted' AND thing_participants.left_at IS NULL
                 THEN 'admitted'
               ELSE EXCLUDED.lobby_status
             END,
             left_at = CASE
               WHEN thing_participants.lobby_status = 'rejected' THEN thing_participants.left_at
               ELSE NULL
             END,
             joined_at = CASE
               WHEN EXCLUDED.lobby_status = 'admitted'
                 THEN COALESCE(thing_participants.joined_at, NOW())
               ELSE thing_participants.joined_at
             END`,
          [room.id, request.user.id, role, displayName, identity, lobbyStatus, joinHash]
        );
      }
    } catch (err) {
      fastify.log.error({ err, slug: room.slug, userId: request.user.id }, '[thing] participant upsert failed');
      return reply.code(502).send({
        error: err.message || 'Не удалось зарегистрировать участника',
        code: 'PARTICIPANT_UPSERT_FAILED'
      });
    }

    if (needLobby) {
      return {
        lobby_status: 'waiting',
        identity,
        join_token: joinToken,
        message: 'Хост скоро пустит',
        /* D5: join_token больше не в query — передаётся телом/заголовком в lobby-status. */
        poll_url: `/api/thing/public/${encodeURIComponent(room.slug)}/lobby-status`,
        room: serializeRoom(room, { includeSecrets: false })
      };
    }

    try {
      await ensureRoomMediaName(room);
      /* D3: если видео-слоты кончились — входим audio-only, а не молча ломаем max_video. */
      const slots = await videoSlotsAvailable(room);
      /* C04/C05: режим конференции может запретить публикацию (webinar/podium). */
      const policy = await publishPolicyFor(room, {
        isModerator: host,
        participantsCount: await countAdmittedParticipants(room.id)
      });
      const creds = await livekit.createAccessToken({
        roomName: room.livekit_room_name,
        identity,
        name: displayName,
        roomAdmin: host || await isCoHost(room.id, request.user.id),
        canPublish: policy.canPublish,
        canPublishSources: policy.sources || (slots.allowed ? undefined : ['microphone', 'microphone_scan']),
        ttlSec: 4 * 60 * 60
      });
      return {
        ...creds,
        lobby_status: 'admitted',
        join_token: joinToken,
        identity,
        display_name: displayName,
        video_allowed: slots.allowed,
        video_slots: { used: slots.used, max: slots.max },
        conference_mode: room.conference_mode || 'meeting',
        audience: policy.role === 'audience',
        job_title: jobTitle || null,
        role,
        room: serializeRoom(room, { includeSecrets: host })
      };
    } catch (err) {
      return mapLivekitError(reply, err, { slug: room.slug, userId: request.user.id });
    }
  });

  // ─── LEAVE (self) — only left_at; rejected = kick/reject only ───
  fastify.post('/rooms/:id/leave', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const room = await loadRoom(request.params.id);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    const identity = `user_${request.user.id}`;
    await db.query(
      `UPDATE thing_participants
       SET left_at = NOW()
       WHERE room_id = $1 AND identity = $2 AND lobby_status <> 'rejected'`,
      [room.id, identity]
    );
    return { ok: true };
  });

  // ─── START / END ────────────────────────────────────────────
  // ─── START (notify participants) ────────────────────────────
  fastify.post('/rooms/:id/start', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const room = await loadRoom(request.params.id);
      if (!room) return reply.code(404).send({ error: 'Комната не найдена' });
      if (room.host_user_id !== request.user.id && !DIRECTOR_ROLES.includes(request.user.role)) {
        return reply.code(403).send({ error: 'Только организатор может начать Тинг' });
      }
      const { rows: [updated] } = await db.query(
        `UPDATE thing_rooms SET status = 'live', started_at = COALESCE(started_at, NOW()) WHERE id = $1 RETURNING *`,
        [room.id]
      );
      // Push everyone who will join: without this a Ting start is silent.
      const { rows: people } = await db.query(
        `SELECT DISTINCT user_id FROM thing_participants
          WHERE room_id = $1 AND user_id IS NOT NULL
            AND COALESCE(lobby_status, '') NOT IN ('rejected')
          UNION
         SELECT user_id FROM meeting_participants WHERE meeting_id = $2 AND user_id IS NOT NULL`,
        [room.id, room.meeting_id]
      ).catch(() => ({ rows: [] }));
      const host = request.user.name || 'Коллега';
      for (const p of people) {
        if (Number(p.user_id) === Number(request.user.id)) continue;
        // eslint-disable-next-line no-await-in-loop
        await createNotification(db, {
          user_id: p.user_id,
          type: 'ting',
          title: 'Тинг начался',
          message: `${host}: ${room.title || 'видеовстреча'}`,
          link: `/ting/?room=${room.slug || room.id}`
        }).catch(() => {});
      }
      return { success: true, room: serializeRoom(updated || room), notified: people.length };
    } catch (e) {
      return reply.code(500).send({ error: e.message || 'Ошибка старта' });
    }
  });

  fastify.post('/rooms/:id/end', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const room = await loadRoom(request.params.id);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (!isHost(room, request.user)) return reply.code(403).send({ error: 'Только инициатор может завершить Тинг' });

    // Сначала закрываем активную запись: иначе egress продолжает писать в удалённую
    // комнату, а строка записи остаётся в 'recording' и протокол никогда не соберётся.
    const { rows: recs } = await db.query(
      `SELECT * FROM thing_recordings WHERE room_id = $1 AND status = 'recording' ORDER BY id DESC LIMIT 1`,
      [room.id]
    );
    const activeRec = recs[0];
    if (activeRec) {
      if (activeRec.egress_id && livekit.isConfigured()) {
        try { await livekit.stopEgress(activeRec.egress_id); } catch (e) {
          fastify.log.warn('[thing] end stopEgress: ' + e.message);
        }
      }
      await db.query(
        `UPDATE thing_recordings SET status = 'ready', ended_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [activeRec.id]
      );
    }

    await livekit.deleteLiveKitRoom(room.livekit_room_name);
    const { rows } = await db.query(
      `UPDATE thing_rooms SET status = 'ended', ended_at = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [room.id]
    );
    const ended = rows[0];
    /* Журнал: закрытие комнаты — критичное действие (остановка записи, протокол). */
    await lifecycle.audit(db, {
      roomId: room.id,
      actorId: request.user.id,
      actorRole: request.user.role,
      action: 'room_ended',
      payload: { protocol_enabled: ended.protocol_enabled, recording_closed: Boolean(activeRec) },
      ip: request.ip
    });
    const protocol = await pipeline.onRoomEnded(db, ended);

    try {
      await createNotification(db, {
        user_id: ended.host_user_id,
        title: 'Тинг завершён',
        message: ended.protocol_enabled
          ? 'ИИ готовит протокол — статус появится в карточке'
          : 'Протокол не заказывался',
        type: 'thing',
        link: `#/ting/${ended.slug}`
      });
    } catch (e) {
      const log = request.log || fastify.log;
      log.warn({ err: e }, '[thing] end notify failed');
    }

    return { room: serializeRoom(ended, { includeSecrets: true }), protocol };
  });

  // ─── RECORDING ──────────────────────────────────────────────
  /** D9: не запускаем второй egress, если запись уже идёт (это деньги и битые файлы). */
  async function hasActiveRecording(roomId) {
    const { rows } = await db.query(
      `SELECT id, egress_id FROM thing_recordings
        WHERE room_id = $1 AND status = 'recording' ORDER BY id DESC LIMIT 1`,
      [roomId]
    );
    return rows[0] || null;
  }

  fastify.post('/rooms/:id/recording/start', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const room = await loadRoom(request.params.id);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (!(await canModerateAsync(room, request.user))) {
      return reply.code(403).send({ error: 'Только модератор' });
    }
    if (room.recording_mode === 'off') return reply.code(400).send({ error: 'Запись отключена' });
    if (!livekit.isConfigured()) {
      return reply.code(503).send({ error: 'LiveKit не настроен', code: 'LIVEKIT_NOT_CONFIGURED' });
    }

    const existing = await hasActiveRecording(room.id);
    if (existing) {
      const { rows } = await db.query(`SELECT * FROM thing_recordings WHERE id = $1`, [existing.id]);
      return { recording: rows[0], already_recording: true, consent_required: true };
    }

    /* Также проверяем SFU: если egress уже идёт, второй не стартуем.
       SDK отдаёт status ЧИСЛОМ — раньше String(3) не совпадал с /COMPLETE/,
       и завершённая запись принималась за активную. */
    try {
      const list = await livekit.listEgress(room.livekit_room_name);
      const active = (list || []).find(e => !livekit.isEgressTerminal(livekit.egressStatusName(e.status)));
      if (active) {
        const egressId = active.egressId || active.egress_id;
        const { rows } = await db.query(
          `INSERT INTO thing_recordings (room_id, egress_id, file_path, status, protocol_status, started_at)
           VALUES ($1, $2, NULL, 'recording', 'skipped', NOW()) RETURNING *`,
          [room.id, egressId]
        );
        return { recording: rows[0], adopted_egress: true, consent_required: true };
      }
    } catch (e) {
      fastify.log.warn('[thing] listEgress check skipped: ' + e.message);
    }

    try {
      const filePath = `/var/lib/asgard-thing/recordings/${room.slug}/${room.id}-${Date.now()}.mp4`;
      /* D22: при заданном S3 пишем в объектное хранилище, не на локальный диск. */
      const s3Key = `recordings/${room.slug}/${room.id}-${Date.now()}.mp4`;
      const started = await livekit.startRoomEgress(room.livekit_room_name, filePath, { s3Key });
      const egressId = started.egressId;
      const storedPath = started.storage === 's3' ? `s3://${process.env.S3_BUCKET}/${s3Key}` : filePath;
      const { rows } = await db.query(
        `INSERT INTO thing_recordings (room_id, egress_id, file_path, status, protocol_status, started_at)
         VALUES ($1, $2, $3, 'recording', 'skipped', NOW())
         RETURNING *`,
        [room.id, egressId, storedPath]
      );

      await lifecycle.audit(db, {
        roomId: room.id,
        actorId: request.user.id,
        actorRole: request.user.role,
        action: 'recording_started',
        payload: { egress_id: egressId, recording_id: rows[0].id },
        ip: request.ip
      });

      // D7: уведомляем всех по факту старта, а не по конфигу.
      try {
        const { rows: parts } = await db.query(
          `SELECT DISTINCT user_id FROM thing_participants
            WHERE room_id = $1 AND user_id IS NOT NULL AND left_at IS NULL`,
          [room.id]
        );
        for (const p of parts) {
          await createNotification(db, {
            user_id: p.user_id,
            type: 'ting',
            title: 'Идёт запись',
            message: `Запись встречи включена: ${room.title || 'видеовстреча'}`,
            link: `#/ting/${room.slug}`
          }).catch(() => {});
        }
      } catch (_) { /* */ }

      return { recording: rows[0], consent_required: true, recording_active: true };
    } catch (e) {
      fastify.log.error({
        err: e,
        room_id: room.id,
        livekit_room: room.livekit_room_name,
        code: e && e.code,
      }, '[thing] recording/start EGRESS_FAILED');
      return reply.code(503).send({
        error: 'Не удалось стартовать запись: ' + (e.message || e),
        code: 'EGRESS_FAILED'
      });
    }
  });

  fastify.post('/rooms/:id/recording/stop', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const room = await loadRoom(request.params.id);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (!isHost(room, request.user)) return reply.code(403).send({ error: 'Только инициатор' });

    const { rows: recs } = await db.query(
      `SELECT * FROM thing_recordings WHERE room_id = $1 AND status = 'recording' ORDER BY id DESC LIMIT 1`,
      [room.id]
    );
    const rec = recs[0];
    if (!rec) return reply.code(404).send({ error: 'Активная запись не найдена' });
    if (rec.egress_id && livekit.isConfigured()) {
      try { await livekit.stopEgress(rec.egress_id); } catch (e) {
        fastify.log.warn('[thing] stopEgress: ' + e.message);
      }
    }
    const { rows } = await db.query(
      `UPDATE thing_recordings SET status = 'ready', ended_at = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [rec.id]
    );
    // Остановка записи и есть момент, когда можно расшифровывать: ставим в очередь сразу,
    // не дожидаясь закрытия комнаты (иначе egress останавливали — и конвейер не стартовал).
    let protocol = 'skipped';
    try {
      const res = await pipeline.onRecordingReady(db, { ...rows[0], room_id: room.id });
      protocol = res.protocol;
    } catch (e) {
      fastify.log.error({ err: e }, '[thing] onRecordingReady failed');
      protocol = 'error';
    }
    return { recording: rows[0], protocol };
  });

  fastify.get('/rooms/:id/recording', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const room = await loadRoom(request.params.id);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (!(await canAccessRoom(room, request.user))) return reply.code(403).send({ error: 'Нет доступа' });
    const { rows } = await db.query(
      `SELECT * FROM thing_recordings WHERE room_id = $1 ORDER BY id DESC LIMIT 5`,
      [room.id]
    );
    const host = isHost(room, request.user);
    const recordings = rows.map((r) => {
      if (host) return r;
      return {
        id: r.id,
        room_id: r.room_id,
        status: r.status,
        duration_sec: r.duration_sec,
        started_at: r.started_at,
        ended_at: r.ended_at
      };
    });
    return { recordings };
  });

  // ─── PROTOCOL (initiator only) ──────────────────────────────
  fastify.get('/rooms/:id/protocol', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const room = await loadRoom(request.params.id);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (!isProtocolOwner(room, request.user)) {
      return reply.code(403).send({ error: 'Протокол видит только инициатор' });
    }
    if (!room.protocol_enabled) {
      return { protocol_enabled: false, protocol_status: 'skipped', can_edit: false, minutes: [] };
    }
    // Записи нет — честно говорим почему, а не показываем вечное «Протокол пуст».
    {
      const { rows: any } = await db.query(
        `SELECT 1 FROM thing_recordings WHERE room_id = $1 LIMIT 1`,
        [room.id]
      );
      if (!any.length) {
        return {
          protocol_enabled: true,
          protocol_status: 'no_recording',
          protocol_error: 'Запись не велась — протоколировать нечего. Включите «Запись» (или «AI-протокол») при создании Тинга.',
          can_edit: false,
          meeting_id: room.meeting_id || null,
          recording: null,
          runs: [],
          raw: {},
          summary: '',
          participants: [],
          minutes: [],
          status_labels: {
            no_recording: 'Запись не велась',
            queued: 'Запись получена, протокол в очереди…',
            transcribing: 'Разбираем речь…',
            generating: 'ИИ составляет протокол…',
            ready: 'Протокол готов',
            failed: 'Не удалось собрать протокол',
            skipped: 'Протокол не заказывался'
          }
        };
      }
    }
    const { rows: recs } = await db.query(
      `SELECT id, protocol_status, protocol_error, transcript_status, status, updated_at
       FROM thing_recordings WHERE room_id = $1 ORDER BY id DESC LIMIT 1`,
      [room.id]
    );
    const rec = recs[0];
    let minutes = [];
    if (room.meeting_id) {
      const { rows: m } = await db.query(
        `SELECT * FROM meeting_minutes WHERE meeting_id = $1 ORDER BY item_order`,
        [room.meeting_id]
      );
      minutes = m;
    }
    const { rows: runs } = await db.query(
      `SELECT id, status, model, raw_json, created_at, completed_at, error_text
       FROM thing_protocol_runs
       WHERE recording_id = $1
       ORDER BY id DESC LIMIT 5`,
      [rec ? rec.id : 0]
    );
    // Протокол живёт в raw_json последнего успешного прогона. Отдаём его клиенту,
    // даже если Тинг не привязан к совещанию (иначе UI показывает «Протокол пуст»).
    const readyRun = runs.find((r) => r.status === 'ready' && r.raw_json) || null;
    const rawJson = (readyRun && readyRun.raw_json) || {};
    const { rows: parts } = await db.query(
      `SELECT display_name, role FROM thing_participants WHERE room_id = $1 ORDER BY id`,
      [room.id]
    );
    const summary = rawJson.summary
      || (room.meeting_id ? ((minutes.find((m) => m.item_type === 'summary') || {}).content || '') : '')
      || '';
    return {
      protocol_enabled: true,
      protocol_status: rec ? rec.protocol_status : 'queued',
      protocol_error: rec ? rec.protocol_error : null,
      can_edit: false,
      meeting_id: room.meeting_id || null,
      recording: rec || null,
      runs,
      raw: rawJson,
      summary,
      participants: parts.map((p) => ({ display_name: p.display_name, role: p.role })),
      minutes,
      status_labels: {
        queued: 'Запись получена, протокол в очереди…',
        transcribing: 'Разбираем речь и кто говорил…',
        generating: 'ИИ составляет протокол (решения и поручения)…',
        ready: 'Протокол готов',
        failed: 'Не удалось собрать протокол',
        skipped: 'Протокол не заказывался'
      }
    };
  });

  fastify.post('/rooms/:id/protocol/generate', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const room = await loadRoom(request.params.id);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (!isProtocolOwner(room, request.user)) return reply.code(403).send({ error: 'Только инициатор' });
    if (!room.protocol_enabled) return reply.code(400).send({ error: 'Протокол отключён при создании' });

    const { rows: recs } = await db.query(
      `SELECT * FROM thing_recordings WHERE room_id = $1 ORDER BY id DESC LIMIT 1`,
      [room.id]
    );
    if (!recs[0]) return reply.code(400).send({ error: 'Нет записи для протокола' });
    await pipeline.setRecordingProtocolStatus(db, recs[0].id, 'queued');
    await pipeline.enqueueJob(db, {
      jobType: 'thing_transcribe',
      roomId: room.id,
      recordingId: recs[0].id,
      payload: { meeting_id: room.meeting_id, retry: true }
    });
    return { ok: true, protocol_status: 'queued' };
  });

  // ─── PUBLIC guest ───────────────────────────────────────────
  fastify.get('/public/:code', async (request, reply) => {
    const code = String(request.params.code || '').toLowerCase();
    if (!isSlug(code) && !isDialCode(code)) {
      return reply.code(400).send({ error: 'Некорректный код' });
    }
    const room = await loadPublicRoomByCode(code);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (!room.allow_guests) return reply.code(403).send({ error: 'Гости не допущены' });

    /* D7: врать в обе стороны нельзя — сообщаем ФАКТ записи. */
    let recordingActive = false;
    try {
      const { rows: rec } = await db.query(
        `SELECT 1 FROM thing_recordings WHERE room_id = $1 AND status = 'recording' LIMIT 1`,
        [room.id]
      );
      recordingActive = rec.length > 0;
    } catch (_) { /* */ }

    return {
      title: room.title,
      status: room.status,
      lobby_enabled: room.lobby_enabled,
      pin_required: Boolean(room.pin_code),
      recording_mode: room.recording_mode || 'off',
      recording_active: recordingActive,
      locked: Boolean(room.locked),
      conference_mode: room.conference_mode || 'meeting',
      slug: room.slug,
      dial_code: room.dial_code || null
    };
  });

  fastify.post('/public/:code/guest-token', async (request, reply) => {
    const code = String(request.params.code || '').toLowerCase();
    const body = request.body || {};
    const name = String(body.name || '').trim();
    if (!name || name.length < 2) return reply.code(400).send({ error: 'Укажите имя' });
    if (!isSlug(code) && !isDialCode(code)) {
      return reply.code(400).send({ error: 'Некорректный код' });
    }

    const room = await loadPublicRoomByCode(code);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (room.status === 'ended' || room.status === 'cancelled') {
      return reply.code(410).send({ error: 'Тинг завершён' });
    }
    if (room.locked) return reply.code(403).send({ error: 'Вход в комнату закрыт организатором', code: 'ROOM_LOCKED' });
    if (!room.allow_guests) return reply.code(403).send({ error: 'Гости не допущены' });

    const rateKey = pinRateKey(request, room.id);
    if (room.pin_code) {
      const rate = pinRateCheck(rateKey);
      if (!rate.ok) {
        return reply.code(429).send({ error: 'Слишком много попыток PIN. Подождите 10 минут.', code: 'PIN_RATE_LIMIT' });
      }
      const pin = String(body.pin || '').replace(/\D/g, '');
      if (pin !== room.pin_code) {
        pinRateFail(rateKey);
        return reply.code(403).send({ error: 'Неверный PIN' });
      }
    }

    /* D4: стабильный ключ гостя. Раньше identity был случайным на каждый вход,
       поэтому кик обходился обновлением страницы.
       Фронт обязан прислать guest_key (устойчивый идентификатор браузера);
       если его нет — используем email, затем IP как последний резерв. */
    const guestKey = String(
      body.guest_key || body.email || ''
    ).trim().toLowerCase().slice(0, 128) || (request.ip ? `ip:${clientIp(request)}` : null);
    if (guestKey) {
      const { rows: banned } = await db.query(
        `SELECT 1 FROM thing_participants
          WHERE room_id = $1 AND guest_key = $2 AND banned_until IS NOT NULL AND banned_until > NOW()
          LIMIT 1`,
        [room.id, guestKey]
      );
      if (banned.length) {
        return reply.code(403).send({ error: 'Вас удалили из этой комнаты', code: 'BANNED' });
      }
    }

    const active = await countOccupyingParticipants(room.id);
    const maxP = room.max_participants || 50;
    if (active >= maxP) {
      return reply.code(403).send({ error: 'Комната заполнена', code: 'ROOM_FULL' });
    }

    const identity = `guest_${crypto.randomBytes(8).toString('hex')}`;
    const { token: joinToken, hash: joinHash } = makeJoinToken();
    /* C01: категории лобби. Раньше был один boolean на всю комнату.
       'guests'     — в лобби только внешние гости (CRM-сотрудники входят сразу);
       'uninvited'  — все, кого не пригласили явно;
       'all'        — все, кроме хоста/соцорганизатора. */
    const policy = String(room.lobby_policy || 'all');
    /* 'guests' — в лобби только внешние; остальные политики держат всех гостей. */
    const lobby = room.lobby_enabled && policy !== 'none' ? 'waiting' : 'admitted';
    const { rows: ins } = await db.query(
      `INSERT INTO thing_participants
         (room_id, guest_name, guest_email, role, display_name, identity, lobby_status, join_token_hash,
          guest_key, client_ip)
       VALUES ($1, $2, $3, 'guest', $2, $4, $5, $6, $7, $8) RETURNING id`,
      [room.id, name, body.email || null, identity, lobby, joinHash, guestKey,
        request.ip || null]
    );

    if (lobby === 'waiting') {
      // Tell the host somebody is waiting in the lobby — otherwise guests sit silently.
      if (room.host_user_id) {
        await createNotification(db, {
          user_id: room.host_user_id,
          type: 'ting',
          title: 'Гость в лобби Тинга',
          message: `${name} ждёт допуска: ${room.title || 'видеовстреча'}`,
          link: `/ting/?room=${room.id}`
        }).catch(() => {});
      }
      return {
        lobby_status: 'waiting',
        participant_id: ins[0].id,
        identity,
        join_token: joinToken,
        message: 'Хост скоро пустит',
        poll_url: `/api/thing/public/${encodeURIComponent(room.slug)}/lobby-status`,
        poll_method: 'POST',
        poll_body: { identity, join_token: joinToken }
      };
    }

    if (!livekit.isConfigured()) {
      return reply.code(503).send({ error: 'LiveKit не настроен', code: 'LIVEKIT_NOT_CONFIGURED' });
    }

    try {
      await ensureRoomMediaName(room);
      /* C04/C05: гость тоже подчиняется режиму конференции.
         Раньше здесь всегда стояло canPublish: true — вебинар не работал для гостей. */
      const guestPolicy = await publishPolicyFor(room, {
        isModerator: false,
        participantsCount: await countAdmittedParticipants(room.id)
      });
      /* T31: первичный вход гостя ≤ 30 мин; дальше — refresh через lobby-status. */
      const creds = await livekit.createAccessToken({
        roomName: room.livekit_room_name,
        identity,
        name,
        roomAdmin: false,
        canPublish: guestPolicy.canPublish,
        canPublishSources: guestPolicy.sources || undefined,
        ttlSec: 30 * 60
      });
      return {
        ...creds,
        lobby_status: 'admitted',
        identity,
        join_token: joinToken,
        conference_mode: room.conference_mode || 'meeting',
        audience: guestPolicy.role === 'audience',
        room: { title: room.title, slug: room.slug, status: room.status }
      };
    } catch (err) {
      return mapLivekitError(reply, err, { slug: room.slug, userId: null });
    }
  });

  /**
   * Гость поллит статус лобби → получает token когда admitted.
   * D5: join_token больше не принимается из query (утекал в access-логи, Referer,
   * историю). Допускаем POST с телом или заголовок X-Ting-Join-Token.
   */
  async function lobbyStatusHandler(request, reply) {
    const code = String(request.params.code || '').toLowerCase();
    const src = Object.assign({}, request.query, request.body || {});
    const identity = String(src.identity || request.headers['x-ting-identity'] || '');
    const joinToken = String(src.join_token || request.headers['x-ting-join-token'] || '');
    if ((!isSlug(code) && !isDialCode(code)) || !identity) {
      return reply.code(400).send({ error: 'slug/dial + identity' });
    }
    if (!joinToken) return reply.code(400).send({ error: 'Нужен join_token', code: 'JOIN_TOKEN_REQUIRED' });
    const room = await loadPublicRoomByCode(code);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (room.status === 'ended' || room.status === 'cancelled') {
      return { lobby_status: 'ended' };
    }
    const { rows: parts } = await db.query(
      `SELECT * FROM thing_participants WHERE room_id = $1 AND identity = $2`,
      [room.id, identity]
    );
    const p = parts[0];
    if (!p) return reply.code(404).send({ error: 'Участник не найден' });
    if (!p.join_token_hash || p.join_token_hash !== hashToken(joinToken)) {
      return reply.code(403).send({ error: 'Неверный join_token', code: 'JOIN_TOKEN_INVALID' });
    }
    if (p.banned_until && new Date(p.banned_until) > new Date()) {
      return { lobby_status: 'rejected', banned: true };
    }
    if (p.lobby_status === 'rejected') return { lobby_status: 'rejected' };
    if (p.left_at) return { lobby_status: 'left' };
    if (p.lobby_status === 'waiting') return { lobby_status: 'waiting' };
    if (!livekit.isConfigured()) return reply.code(503).send({ error: 'LiveKit не настроен' });
    try {
      await ensureRoomMediaName(room);
      const slots = await videoSlotsAvailable(room);
      /* Refresh медиа-токена гостя: 4 ч (уже в комнате), не 30 мин первичного входа. */
      const creds = await livekit.createAccessToken({
        roomName: room.livekit_room_name,
        identity: p.identity,
        name: !isPlaceholderDisplayName(p.display_name) ? p.display_name : (p.guest_name || p.identity),
        roomAdmin: false,
        canPublish: true,
        canPublishSources: slots.allowed ? undefined : ['microphone', 'microphone_scan'],
        ttlSec: 4 * 60 * 60
      });
      return {
        lobby_status: 'admitted',
        ...creds,
        video_allowed: slots.allowed,
        room: { title: room.title, slug: room.slug }
      };
    } catch (err) {
      return mapLivekitError(reply, err, { slug: room.slug, userId: null });
    }
  }

  fastify.post('/public/:code/lobby-status', lobbyStatusHandler);
  /* GET оставлен для старых клиентов, но только с заголовком (не с токеном в URL). */
  fastify.get('/public/:code/lobby-status', lobbyStatusHandler);

  /** Публичный leave гостя — только left_at (не rejected) */
  fastify.post('/public/:code/leave', async (request, reply) => {
    const code = String(request.params.code || '').toLowerCase();
    const body = request.body || {};
    const identity = String(body.identity || '').trim();
    const joinToken = String(body.join_token || '').trim();
    if ((!isSlug(code) && !isDialCode(code)) || !identity) {
      return reply.code(400).send({ error: 'slug/dial + identity' });
    }
    if (!joinToken) return reply.code(400).send({ error: 'Нужен join_token', code: 'JOIN_TOKEN_REQUIRED' });
    const room = await loadPublicRoomByCode(code);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    const { rows: parts } = await db.query(
      `SELECT * FROM thing_participants WHERE room_id = $1 AND identity = $2`,
      [room.id, identity]
    );
    const p = parts[0];
    if (!p || !p.join_token_hash || p.join_token_hash !== hashToken(joinToken)) {
      return reply.code(403).send({ error: 'Неверный join_token', code: 'JOIN_TOKEN_INVALID' });
    }
    await db.query(
      `UPDATE thing_participants
       SET left_at = NOW()
       WHERE room_id = $1 AND identity = $2 AND lobby_status <> 'rejected'`,
      [room.id, identity]
    );
    return { ok: true };
  });

  // ─── PARTICIPANTS / LOBBY / MODERATION ───────────────────────
  fastify.get('/rooms/:id/participants', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const room = await loadRoom(request.params.id);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (!(await canAccessRoom(room, request.user))) return reply.code(403).send({ error: 'Нет доступа' });
    const { rows } = await db.query(
      `SELECT tp.id, tp.user_id, tp.guest_name, tp.role, tp.display_name, tp.identity,
              tp.lobby_status, tp.joined_at, tp.left_at, tp.created_at,
              u.role AS crm_role, u.name AS user_name
       FROM thing_participants tp
       LEFT JOIN users u ON u.id = tp.user_id
       WHERE tp.room_id = $1 ORDER BY tp.id`,
      [room.id]
    );
    let live = [];
    try {
      live = await livekit.listLiveKitParticipants(room.livekit_room_name);
    } catch (e) {
      fastify.log.warn({ err: e }, 'thing: listLiveKitParticipants failed');
    }
    const participants = rows.map((r) => {
      const job = roleTitle(r.crm_role);
      // Старые строки (до фикса ФИО) хранят заглушку «Участник» — отдаём ФИО из users,
      // чтобы ростер/плитки были верными и для уже созданных комнат.
      const name = !isPlaceholderDisplayName(r.display_name)
        ? r.display_name
        : (r.user_name || r.guest_name || r.identity);
      return {
        id: r.id,
        user_id: r.user_id,
        guest_name: r.guest_name,
        role: r.role,
        display_name: name,
        job_title: job || null,
        label: job ? `${name} · ${job}` : name,
        identity: r.identity,
        lobby_status: r.lobby_status,
        joined_at: r.joined_at,
        left_at: r.left_at,
        created_at: r.created_at,
        crm_role: r.crm_role || null
      };
    });
    return {
      participants,
      live: live.map((p) => ({
        identity: p.identity,
        name: p.name || p.identity,
        state: p.state,
        tracks: (p.tracks || []).map((t) => ({ sid: t.sid, source: t.source, muted: t.muted }))
      })),
      is_host: isHost(room, request.user)
    };
  });

  fastify.post('/rooms/:id/lobby/:participantId/admit', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const room = await loadRoom(request.params.id);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (!isHost(room, request.user)) return reply.code(403).send({ error: 'Только хост' });
    const active = await countAdmittedParticipants(room.id);
    const maxP = room.max_participants || 50;
    if (active >= maxP) {
      return reply.code(403).send({ error: 'Комната заполнена', code: 'ROOM_FULL' });
    }
    const pid = parseInt(request.params.participantId, 10);
    const { rows } = await db.query(
      `UPDATE thing_participants SET lobby_status = 'admitted', joined_at = COALESCE(joined_at, NOW()), left_at = NULL
       WHERE id = $1 AND room_id = $2 AND lobby_status = 'waiting'
       RETURNING *`,
      [pid, room.id]
    );
    if (!rows[0]) return reply.code(404).send({ error: 'Ожидающий не найден' });
    return { ok: true, participant: rows[0] };
  });

  fastify.post('/rooms/:id/lobby/:participantId/reject', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const room = await loadRoom(request.params.id);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (!isHost(room, request.user)) return reply.code(403).send({ error: 'Только хост' });
    const pid = parseInt(request.params.participantId, 10);
    const { rows } = await db.query(
      `UPDATE thing_participants SET lobby_status = 'rejected', left_at = NOW()
       WHERE id = $1 AND room_id = $2 RETURNING *`,
      [pid, room.id]
    );
    if (!rows[0]) return reply.code(404).send({ error: 'Участник не найден' });
    return { ok: true, participant: rows[0] };
  });

  fastify.post('/rooms/:id/participants/:identity/remove', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const room = await loadRoom(request.params.id);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (!canModerate(room, request.user)) return reply.code(403).send({ error: 'Только хост или соорганизатор' });
    const identity = decodeURIComponent(request.params.identity);
    let livekit_removed = false;
    let livekit_error = null;
    try {
      if (livekit.isConfigured()) {
        await livekit.removeLiveKitParticipant(room.livekit_room_name, identity);
        livekit_removed = true;
      }
    } catch (e) {
      livekit_error = e.message || 'LiveKit remove failed';
    }

    /* D4: у гостя identity рандомный на каждый вход, поэтому кик обходился F5.
       Баним по guest_key (email или стабильный client key), а не по identity. */
    const { rows: kicked } = await db.query(
      `UPDATE thing_participants SET left_at = NOW(), lobby_status = 'rejected',
              banned_until = NOW() + INTERVAL '24 hours'
       WHERE room_id = $1 AND identity = $2
       RETURNING guest_key`,
      [room.id, identity]
    );
    const guestKey = kicked[0] && kicked[0].guest_key;
    if (guestKey) {
      await db.query(
        `UPDATE thing_participants SET lobby_status = 'rejected',
                banned_until = NOW() + INTERVAL '24 hours'
         WHERE room_id = $1 AND guest_key = $2`,
        [room.id, guestKey]
      );
    }

    await lifecycle.audit(db, {
      roomId: room.id,
      actorId: request.user.id,
      actorRole: request.user.role,
      action: 'participant_removed',
      target: identity,
      payload: { guest_key: guestKey || null, livekit_removed },
      ip: request.ip
    });

    return { ok: true, livekit_removed, livekit_error, banned_for_hours: guestKey ? 24 : 0 };
  });

  fastify.post('/rooms/:id/mute-all', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const room = await loadRoom(request.params.id);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (!(await canModerateAsync(room, request.user))) {
      return reply.code(403).send({ error: 'Только модератор' });
    }
    try {
      const except = String((request.body || {}).except_identity || '');
      const r = await livekit.muteAllExcept(room.livekit_room_name, except || undefined);
      await lifecycle.audit(db, {
        roomId: room.id,
        actorId: request.user.id,
        actorRole: request.user.role,
        action: 'mute_all',
        payload: r,
        ip: request.ip
      });
      return { ok: true, ...r };
    } catch (e) {
      return reply.code(502).send({ error: e.message || 'mute failed' });
    }
  });

  // ─── CHAT (thing_chat_messages) ─────────────────────────────
  fastify.get('/rooms/:id/chat', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const room = await loadRoom(request.params.id);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (!(await canAccessRoom(room, request.user))) return reply.code(403).send({ error: 'Нет доступа' });
    return { messages: await queryChat(room.id) };
  });

  fastify.post('/rooms/:id/chat', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const room = await loadRoom(request.params.id);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (!(await canAccessRoom(room, request.user))) return reply.code(403).send({ error: 'Нет доступа' });
    if (room.status === 'ended' || room.status === 'cancelled') {
      return reply.code(410).send({ error: 'Тинг завершён' });
    }
    const body = request.body || {};
    const text = String(body.text || '').trim().slice(0, 2000);
    /* T20: вложение без текста — валидное сообщение (как в Телемосте). */
    const fileUrl = body.file_url ? String(body.file_url).slice(0, 1000) : null;
    if (!text && !fileUrl) return reply.code(400).send({ error: 'Пустое сообщение' });
    const displayName = String(body.display_name || request.user.name || request.user.email || 'Участник').slice(0, 80);
    const message = await insertChat({
      roomId: room.id,
      identity: `user_${request.user.id}`,
      userId: request.user.id,
      displayName,
      text: text || (body.file_name ? String(body.file_name).slice(0, 200) : ''),
      fileUrl,
      fileName: body.file_name ? String(body.file_name).slice(0, 300) : null,
      fileSize: body.file_size ? parseInt(body.file_size, 10) || null : null,
      mimeType: body.mime_type ? String(body.mime_type).slice(0, 120) : null
    });
    return { ok: true, message };
  });

  /** Публичный чат гостя — только admitted + not left, комната не ended */
  async function assertGuestJoinToken(roomId, identity, joinToken) {
    if (!identity || !joinToken) return null;
    const { rows } = await db.query(
      `SELECT * FROM thing_participants
       WHERE room_id = $1 AND identity = $2 AND left_at IS NULL AND lobby_status = 'admitted'`,
      [roomId, identity]
    );
    const p = rows[0];
    if (!p || !p.join_token_hash || p.join_token_hash !== hashToken(joinToken)) return null;
    return p;
  }

  async function guestChatGet(request, reply) {
    const room = await loadRoom(request.params.code);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (room.status === 'ended' || room.status === 'cancelled') {
      return reply.code(410).send({ error: 'Тинг завершён' });
    }
    /* D5: токен — из тела или заголовка, не из query. */
    const src = Object.assign({}, request.query, request.body || {});
    const identity = String(src.identity || request.headers['x-ting-identity'] || '').trim();
    const joinToken = String(src.join_token || request.headers['x-ting-join-token'] || '').trim();
    if (!identity) return reply.code(400).send({ error: 'Нужен identity' });
    if (!joinToken) return reply.code(400).send({ error: 'Нужен join_token', code: 'JOIN_TOKEN_REQUIRED' });
    const p = await assertGuestJoinToken(room.id, identity, joinToken);
    if (!p) return reply.code(403).send({ error: 'Нет доступа' });
    return { messages: await queryChat(room.id) };
  }

  fastify.post('/public/:code/chat/list', guestChatGet);
  fastify.get('/public/:code/chat', guestChatGet);

  fastify.post('/public/:code/chat', async (request, reply) => {
    const room = await loadRoom(request.params.code);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (room.status === 'ended' || room.status === 'cancelled') {
      return reply.code(410).send({ error: 'Тинг завершён' });
    }
    const body = request.body || {};
    const identity = String(body.identity || '').trim();
    const joinToken = String(body.join_token || '').trim();
    const text = String(body.text || '').trim().slice(0, 2000);
    const fileUrl = body.file_url ? String(body.file_url).slice(0, 1000) : null;
    if (!identity || (!text && !fileUrl)) return reply.code(400).send({ error: 'Нужны identity и text' });
    if (!joinToken) return reply.code(400).send({ error: 'Нужен join_token', code: 'JOIN_TOKEN_REQUIRED' });
    const p = await assertGuestJoinToken(room.id, identity, joinToken);
    if (!p) return reply.code(403).send({ error: 'Нет доступа' });
    const displayName = String(body.display_name || p.display_name || p.guest_name || 'Гость').slice(0, 80);
    const message = await insertChat({
      roomId: room.id,
      identity,
      userId: null,
      displayName,
      text: text || (body.file_name ? String(body.file_name).slice(0, 200) : ''),
      fileUrl,
      fileName: body.file_name ? String(body.file_name).slice(0, 300) : null,
      fileSize: body.file_size ? parseInt(body.file_size, 10) || null : null,
      mimeType: body.mime_type ? String(body.mime_type).slice(0, 120) : null
    });
    return { ok: true, message };
  });

  // ─── DIAL-IN info + lookup ──────────────────────────────────
  async function getDialInInfo(dbConn) {
    const { rows } = await dbConn.query(
      `SELECT key, value_json FROM settings WHERE key IN ('thing_dialin_enabled', 'thing_dialin_number')`
    );
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value_json]));
    let enabled = false;
    let number = '';
    try {
      enabled = JSON.parse(map.thing_dialin_enabled || 'false');
    } catch (e) {
      fastify.log.warn({ err: e }, 'thing: parse thing_dialin_enabled');
    }
    try {
      number = JSON.parse(map.thing_dialin_number || '""');
    } catch (e) {
      number = map.thing_dialin_number || '';
      fastify.log.warn({ err: e }, 'thing: parse thing_dialin_number');
    }
    /* Env — запасной канал, если в settings ещё не прописали DID */
    if (!number) {
      number = String(process.env.THING_DIALIN_NUMBER || process.env.TING_DIALIN_PHONE || '').trim();
    }
    if (process.env.THING_DIALIN_ENABLED === '1' || process.env.THING_DIALIN_ENABLED === 'true') {
      enabled = true;
    }
    const hasNumber = Boolean(number);
    return {
      enabled: Boolean(enabled) && hasNumber,
      number: hasNumber ? number : null,
      configured: hasNumber,
      instruction: hasNumber
        ? 'Позвоните и введите 6 цифр кода Тинга'
        : 'Телефонный вход не настроен: нужен DID в settings.thing_dialin_number или THING_DIALIN_NUMBER'
    };
  }

  fastify.get('/dial-in', async () => getDialInInfo(db));

  /** Внутренний lookup для Asterisk AGI / P5 — только с shared secret */
  fastify.post('/dial-in/resolve', async (request, reply) => {
    const secret = String(process.env.THING_DIALIN_SECRET || '').trim();
    if (!secret) {
      return reply.code(503).send({ error: 'Dial-in resolve не настроен (THING_DIALIN_SECRET)' });
    }
    if (request.headers['x-thing-dialin-secret'] !== secret) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    const body = request.body || {};
    const code = String(body.dial_code || '').replace(/\D/g, '');
    if (!isDialCode(code)) return reply.code(400).send({ error: 'Нужно ровно 6 цифр' });
    const { rows } = await db.query(
      `SELECT id, slug, livekit_room_name, status, pin_code, title
       FROM thing_rooms
       WHERE dial_code = $1 AND status IN ('open', 'scheduled', 'live')
       LIMIT 1`,
      [code]
    );
    if (!rows[0]) return reply.code(404).send({ error: 'Код не найден или Тинг не активен' });
    const room = rows[0];
    const pinRequired = Boolean(room.pin_code);
    if (pinRequired) {
      const rateKey = pinRateKey(request, room.id);
      const rate = pinRateCheck(rateKey);
      if (!rate.ok) {
        return reply.code(429).send({ error: 'Слишком много попыток PIN. Подождите 10 минут.', code: 'PIN_RATE_LIMIT' });
      }
      const pin = String(body.pin || '').replace(/\D/g, '');
      if (!pin) {
        return reply.code(403).send({ error: 'Требуется PIN', code: 'pin_required', pin_required: true });
      }
      if (pin !== room.pin_code) {
        pinRateFail(rateKey);
        return reply.code(403).send({ error: 'Неверный PIN', pin_required: true });
      }
    }

    /* D19: телефонный участник раньше не создавал строку в thing_participants —
       его не было в ростере, и он не попадал в протокол (участники берутся из БД).
       Создаём строку с ролью 'phone' по номеру звонящего. */
    const caller = String(body.caller || request.body && request.body.from || '').replace(/[^\d+]/g, '');
    if (caller) {
      const identity = `phone_${caller.replace(/\D/g, '').slice(-10)}`;
      try {
        await db.query(
          `INSERT INTO thing_participants
             (room_id, guest_name, role, display_name, identity, lobby_status, joined_at)
           VALUES ($1, $2, 'phone', $2, $3, 'admitted', NOW())
           ON CONFLICT (room_id, identity) DO UPDATE
             SET left_at = NULL, joined_at = COALESCE(thing_participants.joined_at, NOW()),
                 lobby_status = 'admitted'`,
          [room.id, 'Телефон ' + caller.slice(-4), identity]
        );
      } catch (e) {
        fastify.log.warn('[thing] dial-in participant upsert failed: ' + e.message);
      }
    }

    return {
      room_id: room.id,
      slug: room.slug,
      livekit_room_name: room.livekit_room_name,
      title: room.title,
      status: room.status,
      pin_required: pinRequired
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // PATCH /rooms/:id — D1: без него нельзя было менять PIN, лимиты,
  // лобби, режим записи и lock после создания комнаты.
  // ═══════════════════════════════════════════════════════════════
  fastify.patch('/rooms/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const room = await loadRoom(request.params.id);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (!(await canModerateAsync(room, request.user))) {
      return reply.code(403).send({ error: 'Только организатор или соорганизатор' });
    }
    const body = request.body || {};
    const sets = [];
    const vals = [];
    const changed = {};

    function push(sql, val, key) {
      vals.push(val);
      sets.push(`${sql} = $${vals.length}`);
      changed[key] = val;
    }

    if (body.title !== undefined) {
      const t = String(body.title).trim().slice(0, 500);
      if (!t) return reply.code(400).send({ error: 'Пустое название' });
      push('title', t, 'title');
    }
    if (body.pin_code !== undefined) {
      const raw = body.pin_code == null ? '' : String(body.pin_code).replace(/\D/g, '').slice(0, 4);
      if (raw && raw.length !== 4) return reply.code(400).send({ error: 'PIN должен быть 4 цифры' });
      push('pin_code', raw || null, 'pin_code');
    }
    if (body.lobby_enabled !== undefined) push('lobby_enabled', Boolean(body.lobby_enabled), 'lobby_enabled');
    if (body.lobby_policy !== undefined) {
      const p = String(body.lobby_policy);
      if (!['all', 'guests', 'uninvited'].includes(p)) return reply.code(400).send({ error: 'Некорректная политика лобби' });
      push('lobby_policy', p, 'lobby_policy');
    }
    if (body.allow_guests !== undefined) push('allow_guests', Boolean(body.allow_guests), 'allow_guests');
    if (body.locked !== undefined) push('locked', Boolean(body.locked), 'locked');
    if (body.max_participants !== undefined) {
      const n = parseInt(body.max_participants, 10);
      if (!(n >= 2 && n <= 200)) return reply.code(400).send({ error: 'Лимит участников 2..200' });
      push('max_participants', n, 'max_participants');
    }
    if (body.max_video !== undefined) {
      const n = parseInt(body.max_video, 10);
      if (!(n >= 1 && n <= 12)) return reply.code(400).send({ error: 'Лимит видео 1..12' });
      push('max_video', n, 'max_video');
    }
    if (body.recording_mode !== undefined) {
      if (!['off', 'manual', 'auto'].includes(body.recording_mode)) {
        return reply.code(400).send({ error: 'Некорректный режим записи' });
      }
      push('recording_mode', body.recording_mode, 'recording_mode');
    }
    if (body.recording_consent_mode !== undefined) {
      if (!['host_only', 'all'].includes(body.recording_consent_mode)) {
        return reply.code(400).send({ error: 'Некорректный режим согласия' });
      }
      push('recording_consent_mode', body.recording_consent_mode, 'recording_consent_mode');
    }
    if (body.protocol_enabled !== undefined) push('protocol_enabled', Boolean(body.protocol_enabled), 'protocol_enabled');
    /* C04/C05: режимы конференции и принудительная раскладка (C14). */
    if (body.conference_mode !== undefined) {
      if (!['meeting', 'podium', 'webinar'].includes(body.conference_mode)) {
        return reply.code(400).send({ error: 'Режим: meeting | podium | webinar' });
      }
      push('conference_mode', body.conference_mode, 'conference_mode');
    }
    if (body.speaker_slots !== undefined) {
      const n = parseInt(body.speaker_slots, 10);
      if (!(n >= 1 && n <= 50)) return reply.code(400).send({ error: 'Спикеров 1..50' });
      push('speaker_slots', n, 'speaker_slots');
    }
    if (body.forced_layout !== undefined) {
      const v = body.forced_layout === null || body.forced_layout === '' ? null : String(body.forced_layout);
      if (v && !['speaker', 'grid'].includes(v)) {
        return reply.code(400).send({ error: 'Раскладка: speaker | grid' });
      }
      push('forced_layout', v, 'forced_layout');
    }
    if (body.scheduled_at !== undefined) {
      let iso = null;
      if (body.scheduled_at) {
        const d = new Date(body.scheduled_at);
        if (Number.isNaN(d.getTime())) return reply.code(400).send({ error: 'Некорректное время' });
        iso = d.toISOString();
      }
      push('scheduled_at', iso, 'scheduled_at');
    }

    if (!sets.length) return reply.code(400).send({ error: 'Нет полей для изменения' });

    vals.push(request.user.id);
    const sql = `UPDATE thing_rooms SET ${sets.join(', ')},
                   updated_by = $${vals.length}, updated_at = NOW()
                 WHERE id = $${vals.length + 1} RETURNING *`;
    vals.push(room.id);
    const { rows } = await db.query(sql, vals);

    // Смена лимитов на SFU: createRoom фиксирует max_participants один раз.
    if (changed.max_participants !== undefined && livekit.isConfigured() && room.livekit_room_name) {
      try {
        const { RoomServiceClient } = require('livekit-server-sdk');
        const svc = new RoomServiceClient(
          process.env.LIVEKIT_URL, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET
        );
        await svc.updateRoomMetadata(
          room.livekit_room_name,
          JSON.stringify({ max_video: changed.max_video || room.max_video })
        );
      } catch (e) {
        fastify.log.warn('[thing] patch: SFU metadata update skipped: ' + e.message);
      }
    }

    await lifecycle.audit(db, {
      roomId: room.id,
      actorId: request.user.id,
      actorRole: request.user.role,
      action: 'room_updated',
      /* PIN в журнал не пишем: он секрет хоста, а не диагностическая информация. */
      payload: Object.fromEntries(Object.entries(changed).filter(([k]) => k !== 'pin_code')),
      ip: request.ip
    });

    // PIN не отдаём в лог-пейлоад, но хосту в ответе — можно.
    return { room: serializeRoom(rows[0], { includeSecrets: isHost(room, request.user) }) };
  });

  // ═══════════════════════════════════════════════════════════════
  // Роли: назначить/снять соорганизатора в середине встречи.
  // JWT roomAdmin вшит при входе, поэтому co-host — через БД + серверные вызовы.
  // ═══════════════════════════════════════════════════════════════
  fastify.post('/rooms/:id/roles', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const room = await loadRoom(request.params.id);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (!isHost(room, request.user)) return reply.code(403).send({ error: 'Только организатор назначает роли' });

    const body = request.body || {};
    const role = String(body.role || '');
    if (!['co_host', 'moderator', 'member'].includes(role)) {
      return reply.code(400).send({ error: 'Роль: co_host | moderator | member' });
    }
    const userId = body.user_id ? parseInt(body.user_id, 10) : null;
    const identity = body.identity ? String(body.identity) : null;
    if (!userId && !identity) return reply.code(400).send({ error: 'Нужен user_id или identity' });
    if (userId && userId === room.host_user_id) {
      return reply.code(400).send({ error: 'Хост уже имеет полные права' });
    }

    const { rows } = await db.query(
      `UPDATE thing_participants SET role = $3
        WHERE room_id = $1 AND (($2::int IS NOT NULL AND user_id = $2) OR ($4::text IS NOT NULL AND identity = $4))
        RETURNING id, user_id, identity, role, display_name`,
      [room.id, userId, role, identity]
    );
    if (!rows[0]) return reply.code(404).send({ error: 'Участник не найден в комнате' });

    await lifecycle.audit(db, {
      roomId: room.id,
      actorId: request.user.id,
      actorRole: request.user.role,
      action: 'role_changed',
      target: rows[0].identity,
      payload: { role, user_id: userId },
      ip: request.ip
    });

    return { ok: true, participant: rows[0] };
  });

  // ═══════════════════════════════════════════════════════════════
  // Модерация: mute конкретного участника (mic или camera) и lower hand.
  // Раньше был только mute-all по audio.
  // ═══════════════════════════════════════════════════════════════
  fastify.post('/rooms/:id/participants/:identity/mute', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const room = await loadRoom(request.params.id);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (!(await canModerateAsync(room, request.user))) {
      return reply.code(403).send({ error: 'Только модератор' });
    }
    const identity = decodeURIComponent(request.params.identity);
    const kind = String((request.body && request.body.kind) || 'audio');
    if (!['audio', 'video', 'screen'].includes(kind)) {
      return reply.code(400).send({ error: 'kind: audio | video | screen' });
    }
    if (!livekit.isConfigured()) {
      return reply.code(503).send({ error: 'LiveKit не настроен', code: 'LIVEKIT_NOT_CONFIGURED' });
    }

    let muted = 0;
    try {
      const parts = await livekit.listLiveKitParticipants(room.livekit_room_name);
      const p = parts.find(x => x.identity === identity);
      if (!p) return reply.code(404).send({ error: 'Участник не в комнате' });
      for (const t of (p.tracks || [])) {
        const src = livekit.trackSourceName(t);
        const sid = t.sid || t.trackSid;
        if (!sid) continue;
        const match = kind === 'audio' ? livekit.isAudioSource(src)
          : kind === 'video' ? livekit.isCameraSource(src)
            : livekit.isScreenSource(src);
        if (match) {
          await livekit.muteLiveKitTrack(room.livekit_room_name, identity, sid, true);
          muted++;
        }
      }
    } catch (e) {
      return reply.code(502).send({ error: e.message || 'mute failed' });
    }

    await lifecycle.audit(db, {
      roomId: room.id,
      actorId: request.user.id,
      actorRole: request.user.role,
      action: 'participant_muted',
      target: identity,
      payload: { kind, tracks: muted },
      ip: request.ip
    });

    return { ok: true, kind, muted_tracks: muted };
  });

  /* T09: опустить руку участнику. Рука живёт в data-channel клиента;
     сервер фиксирует действие и шлёт data-пакет через LiveKit RoomService. */
  fastify.post('/rooms/:id/participants/:identity/lower-hand', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const room = await loadRoom(request.params.id);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (!(await canModerateAsync(room, request.user))) {
      return reply.code(403).send({ error: 'Только модератор' });
    }
    const identity = decodeURIComponent(request.params.identity);
    if (!livekit.isConfigured()) {
      return reply.code(503).send({ error: 'LiveKit не настроен', code: 'LIVEKIT_NOT_CONFIGURED' });
    }
    try {
      if (typeof livekit.sendData === 'function') {
        await livekit.sendData(room.livekit_room_name, {
          type: 'hand_force_lower',
          identity,
          by: `user_${request.user.id}`
        }, { destinationIdentities: [identity] });
      }
    } catch (e) {
      fastify.log.warn('[thing] lower-hand sendData: ' + (e.message || e));
    }
    await lifecycle.audit(db, {
      roomId: room.id,
      actorId: request.user.id,
      actorRole: request.user.role,
      action: 'hand_lowered',
      target: identity,
      ip: request.ip
    });
    return { ok: true, identity, action: 'hand_force_lower' };
  });

  // ═══════════════════════════════════════════════════════════════
  // Запись: библиотека + скачивание (D11).
  // Раньше файл лежал вне public/ и отдавался только строкой пути.
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/rooms/:id/recordings', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const room = await loadRoom(request.params.id);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (!(await canAccessRoom(room, request.user))) return reply.code(403).send({ error: 'Нет доступа' });
    const host = isHost(room, request.user);

    const { rows } = await db.query(
      `SELECT id, room_id, status, egress_status, duration_sec, size_bytes,
              transcript_status, protocol_status, started_at, ended_at, created_at,
              ${host ? 'file_path,' : ''} error_text
         FROM thing_recordings
        WHERE room_id = $1
        ORDER BY id DESC`,
      [room.id]
    );
    return {
      recordings: rows.map(r => ({
        ...r,
        download_url: r.status === 'ready' ? `/api/thing/rooms/${room.id}/recordings/${r.id}/download` : null
      }))
    };
  });

  fastify.get('/rooms/:id/recordings/:recId/download', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const room = await loadRoom(request.params.id);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (!(await canAccessRoom(room, request.user))) return reply.code(403).send({ error: 'Нет доступа' });

    const { rows } = await db.query(
      `SELECT * FROM thing_recordings WHERE id = $1 AND room_id = $2`,
      [parseInt(request.params.recId, 10), room.id]
    );
    const rec = rows[0];
    if (!rec) return reply.code(404).send({ error: 'Запись не найдена' });
    if (rec.status !== 'ready') return reply.code(409).send({ error: 'Запись ещё не готова', status: rec.status });

    // S3-запись: отдаём presigned URL, локальный файл не нужен.
    const filePath = String(rec.file_path || '');
    if (/^s3:\/\//.test(filePath)) {
      try {
        const s3 = require('../services/thing-s3');
        const url = await s3.presignGet(filePath);
        if (url) {
          await lifecycle.audit(db, {
            roomId: room.id,
            actorId: request.user.id,
            actorRole: request.user.role,
            action: 'recording_downloaded',
            target: String(rec.id),
            payload: { storage: 's3' },
            ip: request.ip
          });
          return reply.redirect(302, url);
        }
      } catch (e) {
        fastify.log.warn('[thing] s3 presign failed: ' + e.message);
      }
      return reply.code(503).send({ error: 'Хранилище записей недоступно' });
    }

    // Только внутри разрешённого корня — защита от traversal.
    const ROOT = '/var/lib/asgard-thing/recordings/';
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(ROOT)) {
      return reply.code(403).send({ error: 'Недопустимый путь записи' });
    }
    if (!fs.existsSync(resolved)) return reply.code(404).send({ error: 'Файл записи отсутствует на диске' });

    await lifecycle.audit(db, {
      roomId: room.id,
      actorId: request.user.id,
      actorRole: request.user.role,
      action: 'recording_downloaded',
      target: String(rec.id),
      ip: request.ip
    });

    const name = `ting-${room.slug}-${rec.id}.mp4`;
    return reply
      .header('Content-Type', 'video/mp4')
      .header('Content-Disposition', `attachment; filename="${name}"`)
      .send(fs.createReadStream(resolved));
  });

  /* R02: удаление записи организатором (retention / отзыв согласия). */
  fastify.delete('/rooms/:id/recordings/:recId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const room = await loadRoom(request.params.id);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (!(await canModerateAsync(room, request.user))) {
      return reply.code(403).send({ error: 'Только модератор' });
    }
    const { rows } = await db.query(
      `SELECT * FROM thing_recordings WHERE id = $1 AND room_id = $2`,
      [parseInt(request.params.recId, 10), room.id]
    );
    const rec = rows[0];
    if (!rec) return reply.code(404).send({ error: 'Запись не найдена' });

    const filePath = String(rec.file_path || '');
    if (/^s3:\/\//.test(filePath)) {
      try {
        const s3 = require('../services/thing-s3');
        await s3.removeObject(filePath);
      } catch (e) {
        fastify.log.warn('[thing] s3 delete: ' + e.message);
      }
    } else if (filePath) {
      const ROOT = '/var/lib/asgard-thing/recordings/';
      const resolved = path.resolve(filePath);
      if (resolved.startsWith(ROOT) && fs.existsSync(resolved)) {
        try { fs.unlinkSync(resolved); } catch (_) { /* */ }
      }
    }

    await db.query(
      `UPDATE thing_recordings
          SET status = 'failed', file_path = NULL, error_text = 'deleted_by_user', updated_at = NOW()
        WHERE id = $1`,
      [rec.id]
    );
    await lifecycle.audit(db, {
      roomId: room.id,
      actorId: request.user.id,
      actorRole: request.user.role,
      action: 'recording_deleted',
      target: String(rec.id),
      ip: request.ip
    });
    return { ok: true, id: rec.id, status: 'failed', deleted: true };
  });

  // ═══════════════════════════════════════════════════════════════
  // LIVEKIT WEBHOOK — Q01: комната закрывается по факту SFU, а не только вручную.
  // Идемпотентность по event.id (LiveKit доставляет at-least-once).
  // LiveKit шлёт application/webhook+json — подпись проверяется по сырым байтам.
  // ═══════════════════════════════════════════════════════════════
  const LIVEKIT_WEBHOOK_CT = 'application/webhook+json';
  if (!fastify.hasContentTypeParser(LIVEKIT_WEBHOOK_CT)) {
    fastify.addContentTypeParser(LIVEKIT_WEBHOOK_CT, { parseAs: 'buffer' }, (req, body, done) => done(null, body));
  }
  fastify.post('/livekit/webhook', async (request, reply) => {
    const raw = Buffer.isBuffer(request.body)
      ? request.body.toString('utf8')
      : (typeof request.body === 'string' ? request.body : JSON.stringify(request.body || {}));
    const auth = request.headers.authorization || request.headers.Authorization || '';
    let result;
    try {
      result = await lifecycle.handleWebhook(db, {
        rawBody: raw,
        authHeader: auth,
        log: fastify.log
      });
    } catch (e) {
      fastify.log.error({ err: e }, '[thing] webhook failed');
      // 200 всё равно: иначе LiveKit будет ретраить и завалит очередь.
      return { ok: false, error: e.message };
    }
    if (result && result.error === 'bad_signature') {
      return reply.code(401).send({ ok: false, error: 'bad_signature' });
    }
    return { ok: true, ...result };
  });

  // Ручной запуск sweeper (админ/cron). Идемпотентен.
  fastify.post('/sweep', { preHandler: [fastify.requireRoles(['ADMIN'])] }, async (request) => {
    const minutes = parseInt((request.body && request.body.stale_minutes), 10) || 20;
    return lifecycle.sweepStaleRooms(db, { staleMinutes: minutes, log: fastify.log });
  });

  // ═══════════════════════════════════════════════════════════════
  // ОПРОСЫ (T21) — паритет с Телемостом: создать / проголосовать / результаты.
  // ═══════════════════════════════════════════════════════════════
  async function pollResults(pollId) {
    const { rows: votes } = await db.query(
      `SELECT choices, anonymous FROM thing_poll_votes v
         JOIN thing_polls p ON p.id = v.poll_id
        WHERE v.poll_id = $1`,
      [pollId]
    );
    const counts = {};
    votes.forEach(v => {
      let arr = v.choices;
      if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch (_) { arr = []; } }
      (Array.isArray(arr) ? arr : []).forEach(c => { counts[c] = (counts[c] || 0) + 1; });
    });
    return { counts, total: votes.length };
  }

  fastify.get('/rooms/:id/polls', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const room = await loadRoom(request.params.id);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (!(await canAccessRoom(room, request.user))) return reply.code(403).send({ error: 'Нет доступа' });
    const { rows } = await db.query(
      `SELECT * FROM thing_polls WHERE room_id = $1 ORDER BY id DESC LIMIT 20`,
      [room.id]
    );
    const { rows: allVotes } = await db.query(
      `SELECT v.poll_id, v.identity, v.choices FROM thing_poll_votes v
         JOIN thing_polls p ON p.id = v.poll_id
        WHERE p.room_id = $1`,
      [room.id]
    );
    const out = [];
    for (const p of rows) {
      out.push({
        ...p,
        votes: allVotes
          .filter(v => Number(v.poll_id) === Number(p.id))
          .map(v => ({ identity: p.anonymous ? null : v.identity, choices: v.choices })),
        results: await pollResults(p.id)
      });
    }
    return { polls: out };
  });

  fastify.post('/rooms/:id/polls', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const room = await loadRoom(request.params.id);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (!(await canModerateAsync(room, request.user))) {
      return reply.code(403).send({ error: 'Опрос создаёт организатор' });
    }
    const body = request.body || {};
    const question = String(body.question || '').trim().slice(0, 300);
    const options = Array.isArray(body.options)
      ? body.options.map(o => String(o || '').trim().slice(0, 120)).filter(Boolean).slice(0, 10)
      : [];
    if (!question) return reply.code(400).send({ error: 'Нужен вопрос' });
    if (options.length < 2) return reply.code(400).send({ error: 'Минимум два варианта' });

    const { rows } = await db.query(
      `INSERT INTO thing_polls (room_id, question, options, multiple, anonymous, created_by)
       VALUES ($1,$2,$3::jsonb,$4,$5,$6) RETURNING *`,
      [room.id, question, JSON.stringify(options), Boolean(body.multiple), Boolean(body.anonymous), request.user.id]
    );

    await lifecycle.audit(db, {
      roomId: room.id,
      actorId: request.user.id,
      actorRole: request.user.role,
      action: 'poll_created',
      target: String(rows[0].id),
      payload: { question, options: options.length },
      ip: request.ip
    });

    return { poll: { ...rows[0], results: { counts: {}, total: 0 } } };
  });

  fastify.post('/rooms/:id/polls/:pollId/vote', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const room = await loadRoom(request.params.id);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (!(await canAccessRoom(room, request.user))) return reply.code(403).send({ error: 'Нет доступа' });
    const pollId = parseInt(request.params.pollId, 10);

    const { rows: polls } = await db.query(
      `SELECT * FROM thing_polls WHERE id = $1 AND room_id = $2`,
      [pollId, room.id]
    );
    const poll = polls[0];
    if (!poll) return reply.code(404).send({ error: 'Опрос не найден' });
    if (poll.status !== 'open') return reply.code(409).send({ error: 'Опрос закрыт' });

    const choices = Array.isArray((request.body || {}).choices)
      ? request.body.choices.map(c => parseInt(c, 10)).filter(n => !Number.isNaN(n))
      : [];
    if (!choices.length) return reply.code(400).send({ error: 'Выберите вариант' });
    if (!poll.multiple && choices.length > 1) {
      return reply.code(400).send({ error: 'Можно выбрать только один вариант' });
    }

    const identity = `user_${request.user.id}`;
    await db.query(
      `INSERT INTO thing_poll_votes (poll_id, identity, user_id, choices)
       VALUES ($1,$2,$3,$4::jsonb)
       ON CONFLICT (poll_id, identity)
       DO UPDATE SET choices = EXCLUDED.choices, created_at = NOW()`,
      [pollId, identity, request.user.id, JSON.stringify(choices)]
    );

    return { ok: true, poll_id: pollId, results: await pollResults(pollId) };
  });

  fastify.post('/rooms/:id/polls/:pollId/close', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const room = await loadRoom(request.params.id);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (!(await canModerateAsync(room, request.user))) return reply.code(403).send({ error: 'Только модератор' });
    const pollId = parseInt(request.params.pollId, 10);
    const { rows } = await db.query(
      `UPDATE thing_polls SET status = 'closed', closed_at = NOW()
        WHERE id = $1 AND room_id = $2 RETURNING *`,
      [pollId, room.id]
    );
    if (!rows[0]) return reply.code(404).send({ error: 'Опрос не найден' });
    return { ok: true, poll: { ...rows[0], results: await pollResults(pollId) } };
  });

  // ═══════════════════════════════════════════════════════════════
  // СОГЛАСИЕ НА ЗАПИСЬ (Q09) — раньше consent_required был константой.
  // ═══════════════════════════════════════════════════════════════
  fastify.post('/rooms/:id/consent', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const room = await loadRoom(request.params.id);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (!(await canAccessRoom(room, request.user))) return reply.code(403).send({ error: 'Нет доступа' });
    const revoked = Boolean((request.body || {}).revoked);
    const identity = `user_${request.user.id}`;

    await db.query(
      `UPDATE thing_participants SET consent_at = $3
        WHERE room_id = $1 AND identity = $2`,
      [room.id, identity, revoked ? null : new Date()]
    );
    await db.query(
      `INSERT INTO thing_recording_consents (room_id, identity, user_id, granted_at, revoked_at, ip)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [room.id, identity, request.user.id, revoked ? null : new Date(), revoked ? new Date() : null,
        request.ip || null]
    );

    await lifecycle.audit(db, {
      roomId: room.id,
      actorId: request.user.id,
      actorRole: request.user.role,
      action: revoked ? 'recording_consent_revoked' : 'recording_consent_granted',
      target: identity,
      ip: request.ip
    });

    return { ok: true, consented: !revoked };
  });

  // ═══════════════════════════════════════════════════════════════
  // АНАЛИТИКА (C10) — участники, подключения, чат + CSV.
  // Образец TrueConf: организатор видит, кто зашёл/вышел и о чём писали.
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/rooms/:id/analytics', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const room = await loadRoom(request.params.id);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (!(await canModerateAsync(room, request.user))) {
      return reply.code(403).send({ error: 'Аналитика доступна модератору' });
    }

    const { rows: parts } = await db.query(
      `SELECT id, user_id, guest_name, guest_email, role, display_name, identity,
              lobby_status, joined_at, left_at, consent_at
         FROM thing_participants WHERE room_id = $1 ORDER BY id`,
      [room.id]
    );
    const { rows: chats } = await db.query(
      `SELECT id, display_name, text, file_name, created_at
         FROM thing_chat_messages WHERE room_id = $1 ORDER BY id`,
      [room.id]
    );
    const { rows: recs } = await db.query(
      `SELECT id, status, duration_sec, size_bytes, started_at, ended_at
         FROM thing_recordings WHERE room_id = $1 ORDER BY id DESC`,
      [room.id]
    );
    const { rows: auditRows } = await db.query(
      `SELECT action, actor_role, target, created_at FROM thing_audit_events
        WHERE room_id = $1 ORDER BY id DESC LIMIT 500`,
      [room.id]
    );

    const data = {
      room: {
        id: room.id, slug: room.slug, title: room.title,
        status: room.status, created_at: room.created_at, ended_at: room.ended_at
      },
      participants: parts.map(p => ({
        ...p,
        duration_sec: p.joined_at
          ? Math.max(0, Math.round(((p.left_at ? new Date(p.left_at) : new Date()) - new Date(p.joined_at)) / 1000))
          : null
      })),
      chat: chats,
      recordings: recs,
      audit: auditRows,
      totals: {
        participants: parts.length,
        joined: parts.filter(p => p.joined_at).length,
        left_without_join: parts.filter(p => !p.joined_at).length,
        chat_messages: chats.length,
        recordings: recs.length
      }
    };

    if (String(request.query.format || '') === 'csv') {
      const esc = (v) => {
        let s = v == null ? '' : String(v);
        /* CSV injection: Excel исполняет значения, начинающиеся с = + - @ как формулы. */
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
        return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const lines = [
        'metric;value',
        `room_slug;${esc(room.slug)}`,
        `title;${esc(room.title)}`,
        `participants;${data.totals.participants}`,
        `joined;${data.totals.joined}`,
        `chat_messages;${data.totals.chat_messages}`,
        `recordings;${data.totals.recordings}`,
        '',
        'name;role;identity;joined_at;left_at;duration_sec',
        ...data.participants.map(p => [
          esc(p.display_name || p.guest_name), esc(p.role), esc(p.identity),
          esc(p.joined_at), esc(p.left_at), esc(p.duration_sec)
        ].join(';')),
        '',
        'time;author;text',
        ...data.chat.map(c => [esc(c.created_at), esc(c.display_name), esc(c.text)].join(';'))
      ];
      return reply
        .type('text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="ting-${room.slug}.csv"`)
        .send('\uFEFF' + lines.join('\n'));
    }

    return data;
  });

  // ─── Health ─────────────────────────────────────────────────
  // Q14: раньше отдавали только {ok, livekit}. Теперь — БД, активные комнаты,
  // идущие записи и свободное место под записи (egress падает на переполнении).
  fastify.get('/health', async () => {
    const out = {
      ok: true,
      livekit: livekit.isConfigured(),
      ws_url: livekit.isConfigured() ? livekit.publicWsUrl() : null,
      db: false,
      rooms: { open: 0, live: 0, scheduled: 0 },
      recordings_active: 0,
      egress_path: '/var/lib/asgard-thing/recordings',
      disk: null
    };
    try {
      await db.query('SELECT 1');
      out.db = true;
    } catch (_) { out.ok = false; }
    try {
      const { rows } = await db.query(
        `SELECT status, COUNT(*)::int AS n FROM thing_rooms
          WHERE status IN ('open','live','scheduled') GROUP BY status`
      );
      for (const r of rows) out.rooms[r.status] = r.n;
      const rec = await db.query(`SELECT COUNT(*)::int AS n FROM thing_recordings WHERE status = 'recording'`);
      out.recordings_active = rec.rows[0] ? rec.rows[0].n : 0;

      /* R05: метрики продукта за 24 часа — воронка входа и причины отказов. */
      const funnel = await db.query(
        `SELECT
           COUNT(*) FILTER (WHERE role IN ('guest','phone'))::int AS guests,
           COUNT(*) FILTER (WHERE joined_at IS NOT NULL)::int AS joined,
           COUNT(*) FILTER (WHERE lobby_status = 'waiting')::int AS waiting_now,
           COUNT(*) FILTER (WHERE lobby_status = 'rejected')::int AS rejected,
           COUNT(*) FILTER (WHERE left_at IS NULL AND joined_at IS NOT NULL)::int AS in_room_now
         FROM thing_participants
         WHERE created_at > NOW() - INTERVAL '24 hours'`
      );
      out.funnel_24h = funnel.rows[0] || null;
      const recs = await db.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
           FROM thing_recordings WHERE started_at > NOW() - INTERVAL '24 hours'`
      );
      out.recordings_24h = recs.rows[0] || null;
    } catch (_) { /* */ }
    try {
      const disk = await new Promise((resolve) => {
        require('child_process').execFile('df', ['-k', '/var/lib/asgard-thing/recordings'], (err, stdout) => {
          if (err) return resolve(null);
          const line = String(stdout).split('\n')[1] || '';
          const parts = line.trim().split(/\s+/);
          if (parts.length < 4) return resolve(null);
          resolve({ total_mb: Math.round(Number(parts[1]) / 1024), used_mb: Math.round(Number(parts[2]) / 1024), free_mb: Math.round(Number(parts[3]) / 1024) });
        });
      });
      out.disk = disk;
    } catch (_) { /* */ }
    return out;
  });

  // ─── QR (self-hosted, без внешнего api.qrserver.com) ────────
  fastify.get('/qr', async (request, reply) => {
    const data = String(request.query.data || '').slice(0, 1024);
    if (!data) return reply.code(400).send({ error: 'data required' });
    try {
      const QRCode = require('qrcode');
      const svg = await QRCode.toString(data, {
        type: 'svg',
        margin: 1,
        width: Math.min(1024, Math.max(96, parseInt(request.query.size, 10) || 220)),
        errorCorrectionLevel: 'M'
      });
      return reply.type('image/svg+xml')
        .header('Cache-Control', 'public, max-age=86400')
        .send(svg);
    } catch (e) {
      return reply.code(500).send({ error: 'qr_failed' });
    }
  });

  // SIP trunk bootstrap (admin)
  fastify.post('/sip/ensure', { preHandler: [fastify.requireRoles(['ADMIN'])] }, async (request, reply) => {
    try {
      const { ensureSipDialIn } = require('../services/thing-sip');
      const r = await ensureSipDialIn();
      return r;
    } catch (e) {
      return reply.code(500).send({ ok: false, error: e.message });
    }
  });
};
