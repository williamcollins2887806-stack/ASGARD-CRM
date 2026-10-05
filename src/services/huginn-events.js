'use strict';

/**
 * Huginn event outbox — durable SSE catch-up without patching sse.js hub.
 * Write path: publish → DB row + sendToUser (if online).
 * Read path: GET /api/chat-groups/events?since=
 */

const { sendToUser, isUserOnline } = require('../routes/sse');

async function publish(db, { userIds, eventType, payload, chatId = null, excludeUserId = null }) {
  const ids = [...new Set((userIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  const filtered = excludeUserId == null ? ids : ids.filter((id) => id !== Number(excludeUserId));
  if (!filtered.length) return [];

  const body = payload && typeof payload === 'object' ? payload : {};
  const inserted = [];

  for (const userId of filtered) {
    const { rows } = await db.query(
      `INSERT INTO huginn_events (user_id, event_type, payload, chat_id)
       VALUES ($1, $2, $3::jsonb, $4)
       RETURNING id, user_id, event_type, payload, chat_id, created_at`,
      [userId, eventType, JSON.stringify(body), chatId]
    );
    const row = rows[0];
    inserted.push(row);
    try {
      sendToUser(userId, eventType, { ...body, _eid: Number(row.id), chat_id: chatId });
    } catch (_) { /* online delivery best-effort */ }
  }
  return inserted;
}

async function publishToChatMembers(db, { chatId, eventType, payload, excludeUserId = null }) {
  const { rows } = await db.query(
    'SELECT user_id FROM chat_group_members WHERE chat_id = $1',
    [chatId]
  );
  return publish(db, {
    userIds: rows.map((r) => r.user_id),
    eventType,
    payload,
    chatId,
    excludeUserId
  });
}

async function catchUp(db, userId, sinceId, { limit = 200 } = {}) {
  const since = Number(sinceId) || 0;
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const { rows } = await db.query(
    `SELECT id, event_type, payload, chat_id, created_at
     FROM huginn_events
     WHERE user_id = $1 AND id > $2
     ORDER BY id ASC
     LIMIT $3`,
    [userId, since, lim]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    event: r.event_type,
    data: typeof r.payload === 'string' ? JSON.parse(r.payload) : (r.payload || {}),
    chat_id: r.chat_id,
    created_at: r.created_at
  }));
}

async function touchLastSeen(db, userId) {
  await db.query(
    'UPDATE users SET last_seen_at = NOW() WHERE id = $1',
    [userId]
  );
}

async function getPresence(db, userIds) {
  const ids = [...new Set((userIds || []).map(Number).filter((n) => n > 0))];
  if (!ids.length) return [];
  const { rows } = await db.query(
    `SELECT id AS user_id, last_seen_at, name
     FROM users WHERE id = ANY($1::int[])`,
    [ids]
  );
  return rows.map((r) => ({
    user_id: r.user_id,
    name: r.name,
    last_seen_at: r.last_seen_at,
    online: isUserOnline(r.user_id)
  }));
}

module.exports = {
  publish,
  publishToChatMembers,
  catchUp,
  touchLastSeen,
  getPresence
};
