'use strict';

/**
 * Одна линия: перехват владения on_line и уведомление прежнего владельца.
 *
 * Инвариант держится partial-unique индексом uniq_pbx_operators_single_on_line
 * (см. migrations/V376__pbx_single_line.sql): в БД не может быть двух on_line=true.
 */

const PBX_CHANNEL = 'pbx_call_event';

/**
 * Взять линию себе: снять у прежнего владельца, поставить у нового.
 * @param {import('pg').Pool} db
 * @param {number} userId
 * @param {{receiveMode?: string}} [opts]
 * @returns {Promise<{ok: boolean, previousUserId: number|null, previousChannel: string|null}>}
 */
async function claimLine(db, userId, opts = {}) {
  const receiveMode = ['browser', 'mobile', 'both'].includes(opts.receiveMode)
    ? opts.receiveMode
    : undefined;

  const client = await db.connect();
  let previousUserId = null;
  try {
    await client.query('BEGIN');

    // Кто сейчас на линии (кроме нас).
    const { rows: cur } = await client.query(
      `SELECT user_id FROM pbx_operators WHERE on_line = true AND user_id <> $1 FOR UPDATE`,
      [userId]
    );
    previousUserId = cur[0]?.user_id ?? null;

    if (previousUserId) {
      await client.query(
        `UPDATE pbx_operators
            SET on_line = false, webrtc_registered = false, updated_at = NOW()
          WHERE user_id = $1`,
        [previousUserId]
      );
    }

    await client.query(
      `INSERT INTO pbx_operators (user_id, on_line, receive_mode, on_line_since, on_line_by, last_seen_at, updated_at)
       VALUES ($1, true, COALESCE($2, 'browser'), NOW(), $1, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         on_line = true,
         receive_mode = COALESCE($2, pbx_operators.receive_mode),
         on_line_since = NOW(),
         on_line_by = $1,
         last_seen_at = NOW(),
         updated_at = NOW()`,
      [userId, receiveMode || null]
    );

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  // Прежнему владельцу — уведомление, чтобы UI показал «линия перехвачена».
  if (previousUserId) {
    try {
      await db.query('SELECT pg_notify($1, $2)', [
        PBX_CHANNEL,
        JSON.stringify({
          event: 'call:line_taken',
          user_id: previousUserId,
          data: { by_user_id: userId, reason: 'line_claimed' },
        }),
      ]);
    } catch (_) { /* уведомление не критично для инварианта */ }
  }

  return { ok: true, previousUserId, previousChannel: null };
}

/**
 * Встать на линию (с перехватом у прежнего владельца).
 * @param {import('pg').Pool} db
 * @param {number} userId
 * @param {{receiveMode?: string}} [opts]
 */
async function goOnDuty(db, userId, opts = {}) {
  return claimLine(db, userId, opts);
}

module.exports = { claimLine, goOnDuty };
