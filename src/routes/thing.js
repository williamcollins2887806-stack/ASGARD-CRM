'use strict';

/**
 * ASGARD CRM — Тинг (/api/thing)
 * Комнаты LiveKit, dial_code 6 цифр, protocol_enabled, guest token.
 */

const crypto = require('crypto');
const { isDialCode, isSlug } = require('../services/thing-codes');
const livekit = require('../services/thing-livekit');
const pipeline = require('../services/thing-pipeline');
const { createThingRoom, publicBaseUrl } = require('../services/thing-create');
const { createNotification } = require('../services/notify');

const DIRECTOR_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

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

  function pinRateKey(request) {
    const ip = (request.ip || request.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || 'unknown';
    return `pin:${ip}`;
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

  /** Уже в комнате (для admit / CRM token). Waiting не считаем — иначе admit deadlock ROOM_FULL. */
  async function countAdmittedParticipants(roomId) {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM thing_participants
       WHERE room_id = $1 AND left_at IS NULL AND lobby_status = 'admitted'`,
      [roomId]
    );
    return rows[0] ? rows[0].n : 0;
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
      `SELECT id, identity, user_id, display_name, text, created_at
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
      created_at: r.created_at
    }));
  }

  async function insertChat({ roomId, identity, userId, displayName, text }) {
    const { rows } = await db.query(
      `INSERT INTO thing_chat_messages (room_id, identity, user_id, display_name, text)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, identity, user_id, display_name, text, created_at`,
      [roomId, identity || null, userId || null, displayName, text]
    );
    const r = rows[0];
    return {
      id: r.id,
      identity: r.identity,
      user_id: r.user_id,
      display_name: r.display_name,
      author: r.display_name,
      text: r.text,
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
    const displayName = (request.body && request.body.display_name)
      || request.user.name || request.user.email || `Участник ${request.user.id}`;
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
    const needLobby = !!(room.lobby_enabled && !host && !alreadyAdmitted);
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
        poll_url: `/api/thing/public/${encodeURIComponent(room.slug)}/lobby-status?identity=${encodeURIComponent(identity)}&join_token=${encodeURIComponent(joinToken)}`,
        room: serializeRoom(room, { includeSecrets: false })
      };
    }

    try {
      await ensureRoomMediaName(room);
      const creds = await livekit.createAccessToken({
        roomName: room.livekit_room_name,
        identity,
        name: displayName,
        roomAdmin: host,
        canPublish: true
      });
      return {
        ...creds,
        lobby_status: 'admitted',
        join_token: joinToken,
        identity,
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
  fastify.post('/rooms/:id/start', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const room = await loadRoom(request.params.id);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (!isHost(room, request.user)) return reply.code(403).send({ error: 'Только инициатор' });
    if (room.status === 'ended') return reply.code(410).send({ error: 'Уже завершён' });
    const { rows } = await db.query(
      `UPDATE thing_rooms SET status = 'live', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [room.id]
    );
    return { room: serializeRoom(rows[0], { includeSecrets: true }) };
  });

  fastify.post('/rooms/:id/end', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const room = await loadRoom(request.params.id);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (!isHost(room, request.user)) return reply.code(403).send({ error: 'Только инициатор может завершить Тинг' });

    await livekit.deleteLiveKitRoom(room.livekit_room_name);
    const { rows } = await db.query(
      `UPDATE thing_rooms SET status = 'ended', ended_at = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [room.id]
    );
    const ended = rows[0];
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
  fastify.post('/rooms/:id/recording/start', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const room = await loadRoom(request.params.id);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (!isHost(room, request.user)) return reply.code(403).send({ error: 'Только инициатор' });
    if (room.recording_mode === 'off') return reply.code(400).send({ error: 'Запись отключена' });
    if (!livekit.isConfigured()) {
      return reply.code(503).send({ error: 'LiveKit не настроен', code: 'LIVEKIT_NOT_CONFIGURED' });
    }

    try {
      const filePath = `/var/lib/asgard-thing/recordings/${room.slug}/${room.id}-${Date.now()}.mp4`;
      const { egressId } = await livekit.startRoomEgress(room.livekit_room_name, filePath);
      const { rows } = await db.query(
        `INSERT INTO thing_recordings (room_id, egress_id, file_path, status, protocol_status, started_at)
         VALUES ($1, $2, $3, 'recording', 'skipped', NOW())
         RETURNING *`,
        [room.id, egressId, filePath]
      );
      return { recording: rows[0], consent_required: true };
    } catch (e) {
      fastify.log.error(e);
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
    return { recording: rows[0] };
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
      `SELECT id, status, model, created_at, completed_at, error_text
       FROM thing_protocol_runs
       WHERE recording_id = $1
       ORDER BY id DESC LIMIT 5`,
      [rec ? rec.id : 0]
    );
    return {
      protocol_enabled: true,
      protocol_status: rec ? rec.protocol_status : 'queued',
      protocol_error: rec ? rec.protocol_error : null,
      can_edit: false,
      meeting_id: room.meeting_id || null,
      recording: rec || null,
      runs,
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
    if (!isSlug(code)) return reply.code(400).send({ error: 'Некорректный код' });
    const { rows } = await db.query(`SELECT * FROM thing_rooms WHERE slug = $1`, [code]);
    const room = rows[0];
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (!room.allow_guests) return reply.code(403).send({ error: 'Гости не допущены' });
    return {
      title: room.title,
      status: room.status,
      lobby_enabled: room.lobby_enabled,
      pin_required: Boolean(room.pin_code),
      recording_mode: room.recording_mode || 'off',
      slug: room.slug
    };
  });

  fastify.post('/public/:code/guest-token', async (request, reply) => {
    const code = String(request.params.code || '').toLowerCase();
    const body = request.body || {};
    const name = String(body.name || '').trim();
    if (!name || name.length < 2) return reply.code(400).send({ error: 'Укажите имя' });
    if (!isSlug(code)) return reply.code(400).send({ error: 'Некорректный код' });

    const { rows } = await db.query(`SELECT * FROM thing_rooms WHERE slug = $1`, [code]);
    const room = rows[0];
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (room.status === 'ended' || room.status === 'cancelled') {
      return reply.code(410).send({ error: 'Тинг завершён' });
    }
    if (!room.allow_guests) return reply.code(403).send({ error: 'Гости не допущены' });

    const rateKey = pinRateKey(request);
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

    const active = await countOccupyingParticipants(room.id);
    const maxP = room.max_participants || 50;
    if (active >= maxP) {
      return reply.code(403).send({ error: 'Комната заполнена', code: 'ROOM_FULL' });
    }

    const identity = `guest_${crypto.randomBytes(8).toString('hex')}`;
    const { token: joinToken, hash: joinHash } = makeJoinToken();
    const lobby = room.lobby_enabled ? 'waiting' : 'admitted';
    const { rows: ins } = await db.query(
      `INSERT INTO thing_participants
         (room_id, guest_name, guest_email, role, display_name, identity, lobby_status, join_token_hash)
       VALUES ($1, $2, $3, 'guest', $2, $4, $5, $6) RETURNING id`,
      [room.id, name, body.email || null, identity, lobby, joinHash]
    );

    if (lobby === 'waiting') {
      return {
        lobby_status: 'waiting',
        participant_id: ins[0].id,
        identity,
        join_token: joinToken,
        message: 'Хост скоро пустит',
        poll_url: `/api/thing/public/${encodeURIComponent(room.slug)}/lobby-status?identity=${encodeURIComponent(identity)}&join_token=${encodeURIComponent(joinToken)}`
      };
    }

    if (!livekit.isConfigured()) {
      return reply.code(503).send({ error: 'LiveKit не настроен', code: 'LIVEKIT_NOT_CONFIGURED' });
    }

    try {
      await ensureRoomMediaName(room);
      const creds = await livekit.createAccessToken({
        roomName: room.livekit_room_name,
        identity,
        name,
        roomAdmin: false,
        canPublish: true
      });
      return {
        ...creds,
        lobby_status: 'admitted',
        identity,
        join_token: joinToken,
        room: { title: room.title, slug: room.slug, status: room.status }
      };
    } catch (err) {
      return mapLivekitError(reply, err, { slug: room.slug, userId: null });
    }
  });

  /** Гость поллит статус лобби → получает token когда admitted */
  fastify.get('/public/:code/lobby-status', async (request, reply) => {
    const code = String(request.params.code || '').toLowerCase();
    const identity = String(request.query.identity || '');
    const joinToken = String(request.query.join_token || '');
    if (!isSlug(code) || !identity) return reply.code(400).send({ error: 'slug + identity' });
    if (!joinToken) return reply.code(400).send({ error: 'Нужен join_token', code: 'JOIN_TOKEN_REQUIRED' });
    const { rows } = await db.query(`SELECT * FROM thing_rooms WHERE slug = $1`, [code]);
    const room = rows[0];
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
    if (p.lobby_status === 'rejected') return { lobby_status: 'rejected' };
    if (p.left_at) return { lobby_status: 'left' };
    if (p.lobby_status === 'waiting') return { lobby_status: 'waiting' };
    if (!livekit.isConfigured()) return reply.code(503).send({ error: 'LiveKit не настроен' });
    try {
      await ensureRoomMediaName(room);
      const creds = await livekit.createAccessToken({
        roomName: room.livekit_room_name,
        identity: p.identity,
        name: p.display_name,
        roomAdmin: false,
        canPublish: true
      });
      return { lobby_status: 'admitted', ...creds, room: { title: room.title, slug: room.slug } };
    } catch (err) {
      return mapLivekitError(reply, err, { slug: room.slug, userId: null });
    }
  });

  /** Публичный leave гостя — только left_at (не rejected) */
  fastify.post('/public/:code/leave', async (request, reply) => {
    const code = String(request.params.code || '').toLowerCase();
    const body = request.body || {};
    const identity = String(body.identity || '').trim();
    const joinToken = String(body.join_token || '').trim();
    if (!isSlug(code) || !identity) return reply.code(400).send({ error: 'slug + identity' });
    if (!joinToken) return reply.code(400).send({ error: 'Нужен join_token', code: 'JOIN_TOKEN_REQUIRED' });
    const { rows } = await db.query(`SELECT * FROM thing_rooms WHERE slug = $1`, [code]);
    const room = rows[0];
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
      `SELECT id, user_id, guest_name, role, display_name, identity, lobby_status, joined_at, left_at, created_at
       FROM thing_participants WHERE room_id = $1 ORDER BY id`,
      [room.id]
    );
    let live = [];
    try {
      live = await livekit.listLiveKitParticipants(room.livekit_room_name);
    } catch (e) {
      fastify.log.warn({ err: e }, 'thing: listLiveKitParticipants failed');
    }
    return {
      participants: rows,
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
    if (!isHost(room, request.user)) return reply.code(403).send({ error: 'Только хост' });
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
    await db.query(
      `UPDATE thing_participants SET left_at = NOW(), lobby_status = 'rejected'
       WHERE room_id = $1 AND identity = $2`,
      [room.id, identity]
    );
    return { ok: true, livekit_removed, livekit_error };
  });

  fastify.post('/rooms/:id/mute-all', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const room = await loadRoom(request.params.id);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (!isHost(room, request.user)) return reply.code(403).send({ error: 'Только хост' });
    try {
      const except = String((request.body || {}).except_identity || '');
      const r = await livekit.muteAllExcept(room.livekit_room_name, except || undefined);
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
    if (!text) return reply.code(400).send({ error: 'Пустое сообщение' });
    const displayName = String(body.display_name || request.user.name || request.user.email || 'Участник').slice(0, 80);
    const message = await insertChat({
      roomId: room.id,
      identity: `user_${request.user.id}`,
      userId: request.user.id,
      displayName,
      text
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

  fastify.get('/public/:code/chat', async (request, reply) => {
    const room = await loadRoom(request.params.code);
    if (!room) return reply.code(404).send({ error: 'Тинг не найден' });
    if (room.status === 'ended' || room.status === 'cancelled') {
      return reply.code(410).send({ error: 'Тинг завершён' });
    }
    const identity = String(request.query.identity || '').trim();
    const joinToken = String(request.query.join_token || '').trim();
    if (!identity) return reply.code(400).send({ error: 'Нужен identity' });
    if (!joinToken) return reply.code(400).send({ error: 'Нужен join_token', code: 'JOIN_TOKEN_REQUIRED' });
    const p = await assertGuestJoinToken(room.id, identity, joinToken);
    if (!p) return reply.code(403).send({ error: 'Нет доступа' });
    return { messages: await queryChat(room.id) };
  });

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
    if (!identity || !text) return reply.code(400).send({ error: 'Нужны identity и text' });
    if (!joinToken) return reply.code(400).send({ error: 'Нужен join_token', code: 'JOIN_TOKEN_REQUIRED' });
    const p = await assertGuestJoinToken(room.id, identity, joinToken);
    if (!p) return reply.code(403).send({ error: 'Нет доступа' });
    const displayName = String(body.display_name || p.display_name || p.guest_name || 'Гость').slice(0, 80);
    const message = await insertChat({
      roomId: room.id,
      identity,
      userId: null,
      displayName,
      text
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
    return {
      enabled: Boolean(enabled),
      number: number || null,
      instruction: 'Позвоните и введите 6 цифр кода Тинга'
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
       WHERE dial_code = $1 AND status IN ('scheduled', 'live')
       LIMIT 1`,
      [code]
    );
    if (!rows[0]) return reply.code(404).send({ error: 'Код не найден или Тинг не активен' });
    const room = rows[0];
    const pinRequired = Boolean(room.pin_code);
    if (pinRequired) {
      const rateKey = pinRateKey(request);
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
    return {
      room_id: room.id,
      slug: room.slug,
      livekit_room_name: room.livekit_room_name,
      title: room.title,
      status: room.status,
      pin_required: pinRequired
    };
  });

  // ─── Health ─────────────────────────────────────────────────
  fastify.get('/health', async () => ({
    ok: true,
    livekit: livekit.isConfigured(),
    ws_url: livekit.isConfigured() ? livekit.publicWsUrl() : null
  }));

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
