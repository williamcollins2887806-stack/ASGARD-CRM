'use strict';

/**
 * Создание комнаты Тинга (общий путь: /api/thing и meetings.create_thing).
 */

const { allocateCodes } = require('./thing-codes');
const livekit = require('./thing-livekit');

function publicBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || process.env.APP_URL || 'https://asgard-crm.ru').replace(/\/$/, '');
}

async function createThingRoom(db, opts) {
  const title = String(opts.title || '').trim();
  if (!title) throw Object.assign(new Error('Укажите название Тинга'), { statusCode: 400 });
  if (!opts.hostUserId) throw Object.assign(new Error('hostUserId required'), { statusCode: 400 });

  const mode = opts.mode === 'scheduled' ? 'scheduled' : 'instant';
  const protocolEnabled = opts.protocol_enabled !== false && opts.protocol_enabled !== 'false';
  const meetingId = opts.meetingId ? parseInt(opts.meetingId, 10) : null;
  const pinCode = opts.pin_code ? String(opts.pin_code).replace(/\D/g, '').slice(0, 4) : null;
  if (pinCode && pinCode.length && pinCode.length !== 4) {
    throw Object.assign(new Error('PIN должен быть 4 цифры'), { statusCode: 400 });
  }

  const { slug, dialCode } = await allocateCodes(db);
  const { livekitRoomName, createdOnServer } = await livekit.ensureLiveKitRoom(slug, {
    maxParticipants: opts.max_participants || 50
  });

  const status = opts.status || (mode === 'instant' ? 'live' : 'scheduled');
  const { rows } = await db.query(
    `INSERT INTO thing_rooms (
       meeting_id, slug, dial_code, livekit_room_name, title, host_user_id,
       mode, status, pin_code, lobby_enabled, allow_guests, max_participants,
       max_video, recording_mode, protocol_enabled, started_at, created_at, updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8::varchar,$9,$10,$11,$12,$13,$14,$15,
       CASE WHEN $8::text = 'live' THEN NOW() ELSE NULL END,
       NOW(), NOW()
     ) RETURNING *`,
    [
      meetingId,
      slug,
      dialCode,
      livekitRoomName,
      title,
      opts.hostUserId,
      mode,
      status,
      pinCode || null,
      Boolean(opts.lobby_enabled),
      opts.allow_guests !== false,
      Math.min(200, parseInt(opts.max_participants, 10) || 50),
      Math.min(3, parseInt(opts.max_video, 10) || 3),
      ['off', 'manual', 'auto'].includes(opts.recording_mode) ? opts.recording_mode : 'manual',
      protocolEnabled
    ]
  );
  const room = rows[0];

  const displayName = opts.hostDisplayName || `user-${opts.hostUserId}`;
  await db.query(
    `INSERT INTO thing_participants (room_id, user_id, role, display_name, identity, lobby_status, joined_at)
     VALUES ($1, $2, 'host', $3, $4, 'admitted', NOW())`,
    [room.id, opts.hostUserId, displayName, `user_${opts.hostUserId}`]
  );

  const url = `${publicBaseUrl()}/ting/${slug}`;
  if (meetingId) {
    await db.query(
      `UPDATE meetings
       SET conference_url = CASE
             WHEN conference_url IS NULL OR conference_url = '' THEN $2
             WHEN $3::boolean THEN $2
             ELSE conference_url
           END,
           thing_room_id = $4,
           updated_at = NOW()
       WHERE id = $1`,
      [meetingId, url, Boolean(opts.overwrite_conference_url), room.id]
    );
  }

  return { room, url, livekit_created: createdOnServer };
}

module.exports = { createThingRoom, publicBaseUrl };
