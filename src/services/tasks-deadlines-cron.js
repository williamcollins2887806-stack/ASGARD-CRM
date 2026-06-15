'use strict';

/**
 * Tasks Deadlines Cron — каждые 10 минут проверяет:
 *   1. Задачи с дедлайном в ближайшие 60 минут — пуш assignee + watchers (1h warning, single-shot).
 *   2. Задачи с дедлайном в ближайшие 24 часа — пуш assignee (24h warning, single-shot за сутки).
 *   3. Просроченные new/accepted/in_progress → status='overdue' + пуш creator+assignee.
 *
 * Single-shot гарантируется проверкой существующей записи в notifications с
 * соответствующим type + entity_id (без дополнительной колонки).
 *
 * Используется taskChat.postSystemMessage для дублирования в чат (help-задачи только).
 */
const cron = require('node-cron');
const taskChat = require('./taskChat');

let _job = null;

async function notify(db, userId, type, title, message, link, entityId) {
  try {
    await db.query(`
      INSERT INTO notifications (user_id, title, message, type, link, entity_id, is_read, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, false, NOW())
    `, [userId, title, message, type, link, entityId]);
    try {
      const telegram = require('./telegram');
      if (telegram?.sendNotification) {
        await telegram.sendNotification(userId, `🔔 *${title}*\n\n${message}`);
      }
    } catch (e) {}
  } catch (e) { /* swallow */ }
}

async function alreadySent(db, type, entityId, userId, windowHours = 24) {
  const r = await db.query(`
    SELECT 1 FROM notifications
    WHERE type = $1 AND entity_id = $2 AND user_id = $3
      AND created_at > NOW() - ($4 || ' hours')::interval
    LIMIT 1
  `, [type, entityId, userId, windowHours]);
  return r.rows.length > 0;
}

async function runOnce(db, log) {
  // ── 1. 1-hour warning ─────────────────────────────────────────
  const upcoming1h = await db.query(`
    SELECT t.*, ua.name AS assignee_name, uc.name AS creator_name
    FROM tasks t
    LEFT JOIN users ua ON ua.id = t.assignee_id
    LEFT JOIN users uc ON uc.id = t.creator_id
    WHERE t.status IN ('new','accepted','in_progress')
      AND t.deadline IS NOT NULL
      AND t.deadline BETWEEN NOW() AND NOW() + INTERVAL '60 minutes'
      AND t.archived_at IS NULL
  `).catch(() => ({ rows: [] }));

  for (const task of upcoming1h.rows) {
    const link = task.task_kind === 'help' ? `#/help?id=${task.id}` : `#/tasks?id=${task.id}`;
    const min = Math.max(1, Math.floor((new Date(task.deadline) - Date.now()) / 60000));
    const title = '⏰ Дедлайн через час';
    const message = `«${task.title}» — осталось ${min} мин.\nДедлайн: ${new Date(task.deadline).toLocaleString('ru-RU')}`;

    // Assignee
    if (task.assignee_id && !(await alreadySent(db, 'task_deadline_1h', task.id, task.assignee_id, 2))) {
      await notify(db, task.assignee_id, 'task_deadline_1h', title, message, link, task.id);
    }
    // Watchers (только для help — для директив наблюдатели обычно не критичны)
    if (task.task_kind === 'help') {
      try {
        const watchers = await db.query('SELECT user_id FROM task_watchers WHERE task_id=$1', [task.id]);
        for (const w of watchers.rows) {
          if (w.user_id !== task.assignee_id && !(await alreadySent(db, 'task_deadline_1h', task.id, w.user_id, 2))) {
            await notify(db, w.user_id, 'task_deadline_1h', title, message, link, task.id);
          }
        }
      } catch (_) {}
      // System msg в чат (один раз)
      if (task.chat_id && !(await alreadySent(db, 'task_deadline_1h', task.id, task.creator_id, 2))) {
        try { await taskChat.postSystemMessage(db, task.id, `⏰ До дедлайна ${min} мин.`, { userId: task.creator_id }); } catch (_) {}
      }
    }
  }

  // ── 2. 24-hour warning (раз в сутки) ──────────────────────────
  const upcoming24h = await db.query(`
    SELECT t.*, ua.name AS assignee_name, uc.name AS creator_name
    FROM tasks t
    LEFT JOIN users ua ON ua.id = t.assignee_id
    LEFT JOIN users uc ON uc.id = t.creator_id
    WHERE t.status IN ('new','accepted','in_progress')
      AND t.deadline IS NOT NULL
      AND t.deadline BETWEEN NOW() + INTERVAL '60 minutes' AND NOW() + INTERVAL '24 hours'
      AND t.archived_at IS NULL
  `).catch(() => ({ rows: [] }));

  for (const task of upcoming24h.rows) {
    if (!task.assignee_id) continue;
    if (await alreadySent(db, 'task_deadline_24h', task.id, task.assignee_id, 22)) continue;
    const link = task.task_kind === 'help' ? `#/help?id=${task.id}` : `#/tasks?id=${task.id}`;
    const h = Math.max(1, Math.round((new Date(task.deadline) - Date.now()) / 3600000));
    await notify(
      db, task.assignee_id,
      'task_deadline_24h',
      '📅 Дедлайн завтра',
      `«${task.title}» — осталось ${h} ч.\nДедлайн: ${new Date(task.deadline).toLocaleString('ru-RU')}`,
      link, task.id
    );
  }

  // ── 3. Просроченные ────────────────────────────────────────────
  const overdueRaw = await db.query(`
    SELECT id, title, task_kind, chat_id, creator_id, assignee_id
    FROM tasks
    WHERE status IN ('new','accepted','in_progress')
      AND deadline IS NOT NULL AND deadline < NOW()
      AND archived_at IS NULL
  `).catch(() => ({ rows: [] }));

  for (const t of overdueRaw.rows) {
    await db.query(`UPDATE tasks SET status='overdue', updated_at=NOW() WHERE id=$1`, [t.id]);
    const link = t.task_kind === 'help' ? `#/help?id=${t.id}` : `#/tasks?id=${t.id}`;
    if (t.assignee_id && !(await alreadySent(db, 'task_overdue', t.id, t.assignee_id, 24))) {
      await notify(db, t.assignee_id, 'task_overdue', '⏰ Задача просрочена', `«${t.title}» — дедлайн истёк`, link, t.id);
    }
    if (t.creator_id && t.creator_id !== t.assignee_id && !(await alreadySent(db, 'task_overdue', t.id, t.creator_id, 24))) {
      await notify(db, t.creator_id, 'task_overdue', '⏰ Задача просрочена', `«${t.title}» — исполнитель не успел`, link, t.id);
    }
    if (t.task_kind === 'help' && t.chat_id) {
      try { await taskChat.postSystemMessage(db, t.id, '⏰ Дедлайн истёк — задача просрочена', { userId: t.creator_id }); } catch (_) {}
    }
  }

  log?.info?.({
    upcoming_1h: upcoming1h.rows.length,
    upcoming_24h: upcoming24h.rows.length,
    overdue_marked: overdueRaw.rows.length
  }, '[TasksDeadlinesCron] tick');
}

function start(db, log) {
  if (_job) return;
  // Каждые 10 минут (00, 10, 20, …)
  _job = cron.schedule('*/10 * * * *', async () => {
    try { await runOnce(db, log); }
    catch (e) { log?.error?.({ err: e }, '[TasksDeadlinesCron] tick failed'); }
  }, { scheduled: true, timezone: 'Europe/Moscow' });
  log?.info?.('[TasksDeadlinesCron] started (every 10 min)');
}

function stop() {
  if (_job) { _job.stop(); _job = null; }
}

module.exports = { start, stop, runOnce };
