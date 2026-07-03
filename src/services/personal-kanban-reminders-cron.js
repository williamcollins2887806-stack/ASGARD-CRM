'use strict';

/**
 * Personal Kanban Reminders Cron
 * Каждую минуту проверяет, нет ли напоминаний по картам с remind_at <= now()
 * и is_done=false / fired_at IS NULL → шлёт createNotification и проставляет fired_at.
 *
 * Стиль = src/services/per-diem-cron.js / birthday-push-cron.js.
 * См. PERSONAL_KANBAN_AND_INBOX_PIPELINE.md §2.7.
 */

const cron = require('node-cron');
const { dispatch } = require('./personal-kanban-reminder-notify');

let _task = null;

function start(db, log) {
  if (_task) return;
  const logger = (log && log.info) ? log : console;

  // Каждую минуту
  _task = cron.schedule('* * * * *', () => fireDueReminders(db, logger), {
    timezone: 'Europe/Moscow'
  });

  if (logger.info) logger.info('[personal-kanban-reminders-cron] Started — every minute');
  else logger.log('[personal-kanban-reminders-cron] Started — every minute');
}

function stop() {
  if (_task) { _task.stop(); _task = null; }
}

// B2 (Wave-2 fixer): advisory lock детерминированный — гарантия одного владельца тика
// между несколькими инстансами Node. Не блокирующий: если другой инстанс взял — skip.
const CRON_ADVISORY_LOCK_KEY = 7710013;

async function fireDueReminders(db, log) {
  // Берём advisory-lock на одном клиенте — pg session-level lock.
  // (pg_try_advisory_lock без xact => привязан к сессии клиента; lock+unlock на одном клиенте).
  let client = null;
  try {
    client = await db.pool.connect();
  } catch (e) {
    if (log.error) log.error({ err: e }, '[personal-kanban-reminders-cron] pool.connect failed');
    else log.error('[personal-kanban-reminders-cron] pool.connect failed:', e.message);
    return;
  }

  let lockHeld = false;
  try {
    const lockRes = await client.query('SELECT pg_try_advisory_lock($1) AS got', [CRON_ADVISORY_LOCK_KEY]);
    lockHeld = !!(lockRes.rows[0] && lockRes.rows[0].got);
    if (!lockHeld) {
      // Другой инстанс владеет lock — наш тик skip.
      return;
    }

    // H4 (Wave-2 fixer): атомарный батч.
    // 1) BEGIN; SELECT ... FOR UPDATE SKIP LOCKED LIMIT 100;
    // 2) UPDATE fired_at = now() для всех взятых;
    // 3) COMMIT;
    // 4) После commit — createNotification по каждой строке (на этом этапе дубликат
    //    невозможен; сбой push — потеря push-а, но не дубль; приемлемо по §9.3).
    let rows = [];
    try {
      await client.query('BEGIN');
      const sel = await client.query(`
        SELECT r.id, r.card_id, r.user_id, r.remind_at, r.message,
               r.reminder_kind, r.event_at, r.lead_minutes, r.channels,
               r.title, r.notify_status,
               c.current_main_status, c.entity_kind, c.entity_id
          FROM personal_kanban_card_reminders r
          JOIN personal_kanban_cards c ON c.id = r.card_id
         WHERE r.is_done = false
           AND r.fired_at IS NULL
           AND r.remind_at <= now()
         ORDER BY r.remind_at ASC
         LIMIT 100
         FOR UPDATE OF r SKIP LOCKED
      `);
      rows = sel.rows;

      if (rows.length) {
        const ids = rows.map(x => x.id);
        await client.query(
          `UPDATE personal_kanban_card_reminders
              SET fired_at = now()
            WHERE id = ANY($1::int[])`,
          [ids]
        );
      }
      await client.query('COMMIT');
    } catch (txErr) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      if (log.error) log.error({ err: txErr }, '[personal-kanban-reminders-cron] tx failed');
      else log.error('[personal-kanban-reminders-cron] tx failed:', txErr.message);
      return;
    }

    if (!rows.length) return;

    if (log.info) log.info(`[personal-kanban-reminders-cron] firing ${rows.length} reminders (after commit)`);
    else log.log(`[personal-kanban-reminders-cron] firing ${rows.length} reminders (after commit)`);

    // Уведомления — после COMMIT. Сбой одного канала — не блокирует остальные.
    for (const r of rows) {
      try {
        await dispatch(db, r, log);
      } catch (e) {
        if (log.error) log.error({ err: e, reminder_id: r.id }, '[personal-kanban-reminders-cron] dispatch failed (no retry — fired_at already set)');
        else log.error('[personal-kanban-reminders-cron] dispatch failed (no retry):', r.id, e.message);
      }
    }
  } catch (err) {
    if (log.error) log.error({ err }, '[personal-kanban-reminders-cron] Error');
    else log.error('[personal-kanban-reminders-cron] Error:', err.message);
  } finally {
    try {
      if (lockHeld) {
        await client.query('SELECT pg_advisory_unlock($1)', [CRON_ADVISORY_LOCK_KEY]);
      }
    } catch (_) { /* ignore */ }
    try { client.release(); } catch (_) {}
  }
}

module.exports = { start, stop, fireDueReminders };
