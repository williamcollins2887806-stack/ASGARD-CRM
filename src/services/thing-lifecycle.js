'use strict';

/**
 * Тинг — жизненный цикл комнаты (Фаза 1).
 *
 * D10: без обработки egress_ended упавшая запись навсегда оставалась 'recording',
 *      а протокол не создавался.
 * D16/Q01/Q02: LiveKit webhook + sweeper — иначе комнаты «живут» вечно
 *      (room_finished приходил только для huginn_calls).
 *
 * Идемпотентность: каждый webhook-event пишется в thing_webhook_events по PK event.id,
 *   повторная доставка = no-op (официальная рекомендация LiveKit: assume at-least-once).
 */

const livekit = require('./thing-livekit');
const pipeline = require('./thing-pipeline');

/* ─── журнал ──────────────────────────────────────────────────── */

async function audit(db, { roomId, actorId, actorRole, action, target, payload, ip }) {
  try {
    await db.query(
      `INSERT INTO thing_audit_events (room_id, actor_id, actor_role, action, target, payload, ip)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [roomId || null, actorId || null, actorRole || null, action, target || null,
        JSON.stringify(payload || {}), ip || null]
    );
  } catch (e) {
    // журнал не должен ломать основной сценарий
    console.warn('[thing-lifecycle] audit failed', action, e && e.message);
  }
}

/* ─── egress → запись ─────────────────────────────────────────── */

async function applyEgressEnded(db, info, log) {
  const egressId = info && (info.egressId || info.egress_id);
  if (!egressId) return { skipped: 'no_egress_id' };

  const statusName = livekit.egressStatusName(info.status);
  const ok = statusName === 'complete';

  const errorText = info.error || info.errorCode || null;
  /* Размер лежит в fileResults[0].size (поле info.file в протоколе отсутствует). */
  const firstResult = (info.fileResults && info.fileResults[0]) || (info.file_results && info.file_results[0]) || null;
  const size = (firstResult && (firstResult.size || firstResult.sizeBytes))
    || (info.file && (info.file.size || info.file.sizeBytes))
    || null;

  const { rows } = await db.query(
    `UPDATE thing_recordings
        SET status = $2,
            egress_status = $3,
            error_text = COALESCE($4, error_text),
            size_bytes = COALESCE($5, size_bytes),
            ended_at = COALESCE(ended_at, NOW()),
            updated_at = NOW()
      WHERE egress_id = $1
      RETURNING *`,
    [egressId, ok ? 'ready' : 'failed', statusName,
      errorText, size ? String(size) : null]
  );

  const rec = rows[0];
  if (!rec) return { skipped: 'recording_not_found', egress_id: egressId };

  // Протокол должен стартовать и при падении egress — иначе «запись была, итога нет».
  let protocol = 'skipped';
  if (rec.status === 'ready') {
    try {
      const res = await pipeline.onRecordingReady(db, rec);
      protocol = res && res.protocol;
    } catch (e) {
      if (log) log.error({ err: e }, '[thing-lifecycle] onRecordingReady failed');
      protocol = 'error';
    }
  }
  return { recording_id: rec.id, status: rec.status, protocol };
}

async function applyEgressUpdated(db, info) {
  const egressId = info && (info.egressId || info.egress_id);
  if (!egressId) return { skipped: 'no_egress_id' };
  const firstResult = (info.fileResults && info.fileResults[0]) || (info.file_results && info.file_results[0]) || null;
  const size = (firstResult && (firstResult.size || firstResult.sizeBytes))
    || (info.file && (info.file.size || info.file.sizeBytes))
    || null;
  await db.query(
    `UPDATE thing_recordings
        SET egress_status = $2,
            size_bytes = COALESCE($3, size_bytes),
            updated_at = NOW()
      WHERE egress_id = $1`,
    [egressId, livekit.egressStatusName(info.status), size ? String(size) : null]
  );
  return { ok: true };
}

/* ─── комната завершилась на SFU ──────────────────────────────── */

/**
 * Закрыть комнату по факту room_finished / пустоты.
 * Не трогаем уже ended/cancelled: ручной /end мог прийти раньше webhook'а.
 */
async function closeRoom(db, roomId, { reason, log }) {
  const { rows } = await db.query(
    `UPDATE thing_rooms
        SET status = 'ended', ended_at = COALESCE(ended_at, NOW()), updated_at = NOW()
      WHERE id = $1 AND status IN ('open', 'scheduled', 'live')
      RETURNING *`,
    [roomId]
  );
  const room = rows[0];
  if (!room) return { skipped: 'already_closed' };

  // Все, кто не ушёл, получают left_at — иначе счётчик «залипает» и ROOM_FULL врёт.
  await db.query(
    `UPDATE thing_participants SET left_at = COALESCE(left_at, NOW())
      WHERE room_id = $1 AND left_at IS NULL`,
    [roomId]
  );

  // Активная запись: остановить и закрыть (иначе 'recording' навсегда).
  const { rows: recs } = await db.query(
    `SELECT * FROM thing_recordings WHERE room_id = $1 AND status = 'recording'`,
    [roomId]
  );
  for (const rec of recs) {
    if (rec.egress_id && livekit.isConfigured()) {
      try { await livekit.stopEgress(rec.egress_id); } catch (_) { /* */ }
    }
    await db.query(
      `UPDATE thing_recordings SET status = 'ready', ended_at = COALESCE(ended_at, NOW()),
              updated_at = NOW() WHERE id = $1`,
      [rec.id]
    );
  }

  await audit(db, { roomId, action: 'room_closed', payload: { reason } });

  try {
    const p = await pipeline.onRoomEnded(db, room);
    return { closed: true, room_id: roomId, protocol: p && p.protocol };
  } catch (e) {
    if (log) log.warn({ err: e }, '[thing-lifecycle] onRoomEnded failed');
    return { closed: true, room_id: roomId };
  }
}

/* ─── webhook ─────────────────────────────────────────────────── */

async function handleWebhook(db, { rawBody, authHeader, log }) {
  if (!livekit.isConfigured()) return { skipped: 'livekit_not_configured' };

  let event;
  try {
    event = await livekit.receiveWebhook(rawBody, authHeader);
  } catch (e) {
    return { error: 'bad_signature', message: e && e.message };
  }
  if (!event) return { skipped: 'no_event' };

  const eventId = event.id || event.eventId;
  const eventType = String(event.event || '');
  const room = event.room || {};
  const roomName = room.name || room.sid || '';

  // Идемпотентность: повторная доставка того же event.id — no-op.
  if (eventId) {
    const ins = await db.query(
      `INSERT INTO thing_webhook_events (event_id, event_type, room_name, payload)
       VALUES ($1,$2,$3,$4::jsonb)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [eventId, eventType, roomName, JSON.stringify(event)]
    );
    if (!ins.rows.length) return { duplicate: true, event_id: eventId };
  }

  const { rows: rooms } = roomName
    ? await db.query(
      `SELECT * FROM thing_rooms WHERE livekit_room_name = $1
        ORDER BY (status IN ('open','live','scheduled')) DESC, id DESC LIMIT 1`,
      [roomName]
    )
    : { rows: [] };
  const roomRow = rooms[0] || null;

  let result = { event_type: eventType };

  if (eventType === 'room_finished') {
    if (roomRow) {
      result = { ...result, ...(await closeRoom(db, roomRow.id, { reason: 'room_finished', log })) };
    } else {
      result.skipped = 'no_thing_room';
    }
  } else if (eventType === 'participant_left' || eventType === 'participant_connection_aborted') {
    if (roomRow) {
      const identity = (event.participant && (event.participant.identity || event.participant.sid)) || '';
      // SIP/телефонные identity тоже сюда попадают.
      await db.query(
        `UPDATE thing_participants SET left_at = COALESCE(left_at, NOW())
          WHERE room_id = $1 AND identity = $2`,
        [roomRow.id, identity]
      );
      // Первый вошедший переводит 'open' → 'live'.
      await db.query(
        `UPDATE thing_rooms SET status = 'live', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
          WHERE id = $1 AND status = 'open'`,
        [roomRow.id]
      );
      result.identity = identity;
    }
  } else if (eventType === 'participant_joined') {
    if (roomRow) {
      await db.query(
        `UPDATE thing_rooms SET status = 'live', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
          WHERE id = $1 AND status IN ('open', 'scheduled')`,
        [roomRow.id]
      );
    }
  } else if (eventType === 'egress_ended') {
    result = { ...result, ...(await applyEgressEnded(db, event.egressInfo || event.egress_info || {}, log)) };
  } else if (eventType === 'egress_updated') {
    result = { ...result, ...(await applyEgressUpdated(db, event.egressInfo || event.egress_info || {})) };
  } else {
    result.skipped = 'event_ignored';
  }

  if (eventId) {
    await db.query(`UPDATE thing_webhook_events SET processed_at = NOW() WHERE event_id = $1`, [eventId]);
  }
  return result;
}

/* ─── sweeper ─────────────────────────────────────────────────── */

/**
 * Q02: комнаты, которые «живут» без участников.
 * Опирается на LiveKit (источник истины), а не только на БД: гость мог закрыть
 * вкладку без /leave, и left_at остался NULL.
 */
async function sweepStaleRooms(db, { staleMinutes = 20, log } = {}) {
  const { rows } = await db.query(
    `SELECT r.* FROM thing_rooms r
      WHERE r.status IN ('open', 'live', 'scheduled')
        AND r.created_at < NOW() - ($1 || ' minutes')::interval
      ORDER BY r.id DESC
      LIMIT 100`,
    [String(staleMinutes)]
  );

  const closed = [];
  const SCHEDULED_GRACE_MS = 6 * 60 * 60 * 1000;
  for (const room of rows) {
    /* D-398: запланированную комнату нельзя закрывать сразу по наступлении
       времени. Раньше условие было «scheduled_at уже прошёл → закрываем»,
       поэтому встреча 14:00 закрывалась в 14:00-14:20, ещё до входа людей
       (в списке Тингов появлялось «Завершён» у сегодняшней встречи).
       Даём 6 часов после назначенного времени: не пришли — тогда закрываем. */
    if (room.status === 'scheduled') {
      const anchor = room.scheduled_at || room.created_at;
      const at = anchor ? new Date(anchor).getTime() : NaN;
      if (Number.isFinite(at) && Date.now() < at + SCHEDULED_GRACE_MS) continue;
    }
    let liveCount = null;
    if (livekit.isConfigured() && room.livekit_room_name) {
      try {
        const parts = await livekit.listLiveKitParticipants(room.livekit_room_name);
        liveCount = parts.length;
      } catch (_) { liveCount = null; }
    }
    if (liveCount === 0) {
      const r = await closeRoom(db, room.id, { reason: 'sweeper_empty', log });
      if (r && r.closed) closed.push(room.id);
      continue;
    }
    // SFU недоступен — падаем на БД-признак: нет участников, реально вошедших
    // (joined_at) и не ушедших. Строка хоста создаётся без joined_at — она не в счёт.
    if (liveCount === null) {
      const { rows: act } = await db.query(
        `SELECT COUNT(*)::int AS n FROM thing_participants
          WHERE room_id = $1 AND left_at IS NULL AND lobby_status = 'admitted'
            AND joined_at IS NOT NULL`,
        [room.id]
      );
      const waiting = await db.query(
        `SELECT COUNT(*)::int AS n FROM thing_participants
          WHERE room_id = $1 AND left_at IS NULL AND lobby_status = 'waiting'`,
        [room.id]
      );
      if (!act[0].n && !waiting.rows[0].n) {
        const r = await closeRoom(db, room.id, { reason: 'sweeper_no_participants', log });
        if (r && r.closed) closed.push(room.id);
      }
    }
  }
  return { checked: rows.length, closed };
}

/**
 * R02: retention — удаляем готовые записи старше N дней (по умолчанию 90).
 * Физический файл: локальный unlink или lifecycle S3; строка → status=deleted.
 */
async function sweepExpiredRecordings(db, { retainDays = 90, log } = {}) {
  const days = Math.max(7, parseInt(retainDays, 10) || 90);
  const { rows } = await db.query(
    `SELECT id, room_id, file_path FROM thing_recordings
      WHERE status = 'ready'
        AND COALESCE(ended_at, created_at) < NOW() - ($1 || ' days')::interval
      ORDER BY id ASC
      LIMIT 50`,
    [String(days)]
  );
  const fs = require('fs');
  const path = require('path');
  const deleted = [];
  for (const rec of rows) {
    const filePath = String(rec.file_path || '');
    if (/^s3:\/\//.test(filePath)) {
      try {
        const s3 = require('./thing-s3');
        await s3.removeObject(filePath);
      } catch (e) {
        if (log) log.warn('[thing-retention] s3: ' + e.message);
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
          SET status = 'failed', file_path = NULL, error_text = 'retention_expired', updated_at = NOW()
        WHERE id = $1`,
      [rec.id]
    );
    deleted.push(rec.id);
  }
  return { checked: rows.length, deleted };
}

module.exports = {
  audit,
  applyEgressEnded,
  applyEgressUpdated,
  closeRoom,
  handleWebhook,
  sweepStaleRooms,
  sweepExpiredRecordings
};
