'use strict';

/**
 * ASGARD CRM — Mimir Conductor: напоминания по письмам заказчику (Сессия 5, Шаг 5.7)
 * ═══════════════════════════════════════════════════════════════════════════
 * Раз в сутки (утром) проверяет отправленные письма-запросы заказчику, на
 * которые до сих пор нет ответа:
 *   • > 5 дней без ответа и без свежего напоминания → напоминаем РП (sent_by);
 *   • > 10 дней → эскалация на HEAD_PM.
 *
 * Паттерн модуля — как у остальных кронов: start(db, log) / stop(), node-cron.
 * Уведомления — через общий notify.createNotification.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const cron = require('node-cron');
const { createNotification } = require('./notify');

let _task = null;

const REMIND_AFTER_DAYS = 5;
const REMIND_COOLDOWN_DAYS = 3;
const ESCALATE_AFTER_DAYS = 10;

function start(db, log) {
  if (_task) return;
  // Каждый день в 09:07 МСК (минута не круглая — рекомендация по нагрузке).
  _task = cron.schedule('7 9 * * *', () => checkStalledLetters(db, log), {
    timezone: 'Europe/Moscow'
  });
  log.info('[mimir-letter-reminders] Started — daily 09:07 MSK');
}

function stop() {
  if (_task) { _task.stop(); _task = null; }
}

async function checkStalledLetters(db, log) {
  try {
    const { rows } = await db.query(
      `SELECT l.*, EXTRACT(EPOCH FROM (NOW() - l.sent_at)) / 86400 AS days_waiting
         FROM mimir_customer_letters l
        WHERE l.status = 'SENT'
          AND l.reply_received_at IS NULL
          AND l.sent_at IS NOT NULL
          AND l.sent_at < NOW() - ($1 || ' days')::interval
          AND (l.last_reminder_at IS NULL OR l.last_reminder_at < NOW() - ($2 || ' days')::interval)`,
      [REMIND_AFTER_DAYS, REMIND_COOLDOWN_DAYS]
    );

    if (!rows.length) {
      log.info('[mimir-letter-reminders] Нет писем, требующих напоминания');
      return;
    }
    log.info(`[mimir-letter-reminders] Писем без ответа: ${rows.length}`);

    for (const letter of rows) {
      const days = Math.floor(Number(letter.days_waiting) || 0);

      // Напоминание РП (автор отправки)
      if (letter.sent_by) {
        await createNotification(db, {
          user_id: letter.sent_by,
          title: '📭 Заказчик не ответил на запрос',
          message: `Письмо ${letter.letter_number} отправлено ${days} дн. назад, ответа нет. Напомнить заказчику?`,
          type: 'warning',
          link: '/awaiting-customer.html'
        });
      }

      // Эскалация на HEAD_PM на 10+ дней
      if (days >= ESCALATE_AFTER_DAYS) {
        try {
          const heads = await db.query("SELECT id FROM users WHERE role = 'HEAD_PM' AND COALESCE(is_active, true) = true");
          for (const h of heads.rows) {
            await createNotification(db, {
              user_id: h.id,
              title: '⏰ Эскалация: нет ответа заказчика 10+ дней',
              message: `Письмо ${letter.letter_number} без ответа ${days} дн. Требуется вмешательство.`,
              type: 'error',
              link: '/awaiting-customer.html'
            });
          }
        } catch (e) {
          log.warn(`[mimir-letter-reminders] эскалация HEAD_PM не удалась: ${e.message}`);
        }
      }

      await db.query(
        'UPDATE mimir_customer_letters SET last_reminder_at = NOW(), reminders_sent_count = COALESCE(reminders_sent_count,0) + 1 WHERE id = $1',
        [letter.id]
      );
    }
  } catch (err) {
    log.error({ err }, '[mimir-letter-reminders] Error');
  }
}

module.exports = { start, stop, checkStalledLetters };
