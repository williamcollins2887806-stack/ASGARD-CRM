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

  async function loadRoom(idOrCode) {
    const key = String(idOrCode || '').trim();
    if (!key) return null;
    if (/^\d+$/.test(key) && !isDialCode(key)) {
      const { rows } = await db.query(`SELECT * FROM thing_rooms WHERE id = $1`, [parseInt(key, 10)]);
      return rows[0] || null;
    }
    if (isDialCode(key)) {
      // dial_code не резолвим в URL-роутах комнаты — только через /dial-in lookup
      return null;
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
      `SELECT 1 FROM thing_participants WHERE room_id = $1 AND user_id = $2 LIMIT 1`,
      [room.id, user.id]
    );
    return p.length > 0;
  }

  function isHost(room, user) {
    return room && user && (room.host_user_id === user.id || DIRECTOR_ROLES.includes(user.role));
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
      dial_code: room.dial_code,
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
      out.livekit_room_name = room.livekit_room_name;
      out.pin_code = room.pin_code;
    }
    return out;
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
         SELECT room_id FROM thing_participants WHERE user_id = $1
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
    const host = isHost(room, request.user);
    const creds = await livekit.createAccessToken({
      roomName: room.livekit_room_name,
      identity: `user_${request.user.id}`,
      name: request.user.name || request.user.email || `Участник ${request.user.id}`,
      roomAdmin: host,
      canPublish: true
    });
    return { ...creds, room: serializeRoom(room) };
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
    } catch (_) { /* ignore */ }

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
    // протокол видит только initiator
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
        // protocol_status скрыт от не-инициатора
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
      return { protocol_enabled: false, protocol_status: 'skipped' };
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
      slug: room.slug
      // dial_code не светим публично без auth — только на карточке хоста
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
    if (room.pin_code) {
      const pin = String(body.pin || '').replace(/\D/g, '');
      if (pin !== room.pin_code) return reply.code(403).send({ error: 'Неверный PIN' });
    }
    if (!livekit.isConfigured()) {
      return reply.code(503).send({ error: 'LiveKit не настроен', code: 'LIVEKIT_NOT_CONFIGURED' });
    }

    const identity = `guest_${crypto.randomBytes(8).toString('hex')}`;
    const lobby = room.lobby_enabled ? 'waiting' : 'admitted';
    await db.query(
      `INSERT INTO thing_participants (room_id, guest_name, guest_email, role, display_name, identity, lobby_status)
       VALUES ($1, $2, $3, 'guest', $2, $4, $5)`,
      [room.id, name, body.email || null, identity, lobby]
    );

    if (lobby === 'waiting') {
      return { lobby_status: 'waiting', message: 'Хост скоро пустит' };
    }

    const creds = await livekit.createAccessToken({
      roomName: room.livekit_room_name,
      identity,
      name,
      roomAdmin: false,
      canPublish: true
    });
    return { ...creds, lobby_status: 'admitted', room: { title: room.title, slug: room.slug, status: room.status } };
  });

  // ─── DIAL-IN info + lookup ──────────────────────────────────
  async function getDialInInfo(dbConn) {
    const { rows } = await dbConn.query(
      `SELECT key, value_json FROM settings WHERE key IN ('thing_dialin_enabled', 'thing_dialin_number')`
    );
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value_json]));
    let enabled = false;
    let number = '';
    try { enabled = JSON.parse(map.thing_dialin_enabled || 'false'); } catch (_) { /* */ }
    try { number = JSON.parse(map.thing_dialin_number || '""'); } catch (_) { number = map.thing_dialin_number || ''; }
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
    const code = String((request.body || {}).dial_code || '').replace(/\D/g, '');
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
    return {
      room_id: room.id,
      slug: room.slug,
      livekit_room_name: room.livekit_room_name,
      title: room.title,
      status: room.status,
      pin_required: Boolean(room.pin_code)
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
