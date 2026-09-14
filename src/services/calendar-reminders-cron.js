'use strict';

/**
 * Calendar / meetings reminders cron — every minute.
 * Fires createNotification for due meeting + personal calendar reminders.
 */

const cron = require('node-cron');
const { createNotification } = require('./notify');

let _task = null;
const CRON_ADVISORY_LOCK_KEY = 7710021;

function start(db, log) {
  if (_task) return;
  const logger = (log && log.info) ? log : console;
  _task = cron.schedule('* * * * *', () => fireDue(db, logger), {
    timezone: 'Europe/Moscow'
  });
  if (logger.info) logger.info('[calendar-reminders-cron] Started — every minute');
  else logger.log('[calendar-reminders-cron] Started — every minute');
}

function stop() {
  if (_task) { _task.stop(); _task = null; }
}

async function fireDue(db, log) {
  let client = null;
  try {
    client = await db.pool.connect();
  } catch (e) {
    return;
  }

  let lockHeld = false;
  try {
    const lockRes = await client.query('SELECT pg_try_advisory_lock($1) AS got', [CRON_ADVISORY_LOCK_KEY]);
    lockHeld = !!(lockRes.rows[0] && lockRes.rows[0].got);
    if (!lockHeld) return;

    // Meetings
    try {
      const { rows: upcoming } = await client.query(`
        SELECT m.id, m.title, m.start_time, m.notify_before_minutes, mp.user_id
        FROM meetings m
        JOIN meeting_participants mp ON mp.meeting_id = m.id
        WHERE m.status = 'scheduled'
          AND m.start_time > NOW()
          AND m.start_time <= NOW() + make_interval(mins => COALESCE(m.notify_before_minutes, 15))
          AND mp.reminder_sent_at IS NULL
          AND COALESCE(mp.rsvp_status, 'pending') <> 'declined'
        LIMIT 100
      `);

      for (const row of upcoming) {
        await createNotification(db, {
          user_id: row.user_id,
          title: '⏰ Напоминание о встрече',
          message: `«${row.title}» начнётся в ${new Date(row.start_time).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' })}`,
          type: 'meeting',
          link: '#/calendar'
        });
        await client.query(
          'UPDATE meeting_participants SET reminder_sent_at = NOW() WHERE meeting_id = $1 AND user_id = $2',
          [row.id, row.user_id]
        );
      }
    } catch (e) {
      if (log.warn) log.warn('[calendar-reminders-cron] meetings: ' + e.message);
    }

    // Personal calendar_events
    try {
      const { rows: events } = await client.query(`
        SELECT id, title, date, time, reminder_minutes, created_by, participants
        FROM calendar_events
        WHERE COALESCE(reminder_sent, false) = false
          AND COALESCE(reminder_minutes, 0) > 0
          AND created_by IS NOT NULL
          AND date BETWEEN CURRENT_DATE - 1 AND CURRENT_DATE + 2
        LIMIT 100
      `);

      const now = Date.now();
      for (const ev of events) {
        const t = String(ev.time || '00:00').slice(0, 5);
        const eventAt = new Date(`${String(ev.date).slice(0, 10)}T${t}:00+03:00`).getTime();
        if (Number.isNaN(eventAt)) continue;
        const remindAt = eventAt - (Number(ev.reminder_minutes) || 0) * 60 * 1000;
        if (now >= remindAt && now < eventAt) {
          await createNotification(db, {
            user_id: ev.created_by,
            title: `Напоминание: ${ev.title}`,
            message: `Через ${ev.reminder_minutes} мин: ${ev.title}`,
            type: 'calendar_reminder',
            link: '#/calendar'
          });
          await client.query(
            'UPDATE calendar_events SET reminder_sent = true WHERE id = $1',
            [ev.id]
          );
        }
      }
    } catch (e) {
      if (log.warn) log.warn('[calendar-reminders-cron] events: ' + e.message);
    }
  } finally {
    try {
      if (lockHeld) await client.query('SELECT pg_advisory_unlock($1)', [CRON_ADVISORY_LOCK_KEY]);
    } catch (_) { /* ignore */ }
    client.release();
  }
}

module.exports = { start, stop, fireDue };
