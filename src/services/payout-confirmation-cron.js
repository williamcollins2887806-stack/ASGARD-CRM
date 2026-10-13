'use strict';

/**
 * Cron: напоминания о неподтверждённых выплатах.
 * ═══════════════════════════════════════════════════════════════════════════
 * Правило ТЗ: у рабочего 72ч на подтверждение. Если не подтвердил — шлём
 * повторное уведомление (MAX/SMS), строка у Димы остаётся (жёлтая → красная).
 *
 * По образцу src/services/readiness-cron.js: node-cron + timezone Europe/Moscow,
 * гейт «не на тест-БД», advisory-lock от параллельных прогонов.
 */

const cron = require('node-cron');

let Task = null;
const LOCK_KEY = 7766001;

async function runReminders(db, log) {
  // advisory-lock: не запускать дважды параллельно
  const { rows: lock } = await db.query('SELECT pg_try_advisory_lock($1) AS got', [LOCK_KEY]);
  if (!lock || !lock[0] || !lock[0].got) return { skipped: 'locked' };
  try {
    // Выплаты, ожидающие подтверждения и ПРОСРОЧЕННЫЕ (дедлайн прошёл),
    // которым ещё не слали напоминание после дедлайна.
    const { rows } = await db.query(`
      SELECT wp.id, wp.employee_id, wp.amount
        FROM worker_payments wp
       WHERE wp.confirmation_status = 'awaiting'
         AND wp.confirmation_deadline IS NOT NULL
         AND wp.confirmation_deadline < NOW()
         AND (wp.reminder_sent_at IS NULL OR wp.reminder_sent_at < wp.confirmation_deadline)
       ORDER BY wp.confirmation_deadline
       LIMIT 200
    `);

    let sent = 0;
    for (const p of rows) {
      try {
        const { sendPayoutCode } = require('../lib/payout-notify');
        await sendPayoutCode({ log }, db, {
          paymentId: p.id, employeeId: p.employee_id, amount: p.amount,
        });
        await db.query(`UPDATE worker_payments SET reminder_sent_at = NOW() WHERE id = $1`, [p.id]);
        sent++;
      } catch (e) {
        log && log.warn && log.warn(`[payout-reminder] payment ${p.id} fail: ${e.message}`);
      }
    }
    return { checked: rows.length, sent };
  } finally {
    await db.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
  }
}

function start(db, log) {
  const dbName = process.env.DB_NAME || '';
  if (dbName && !/prod/i.test(dbName) && process.env.NODE_ENV !== 'production') {
    log && log.info && log.info(`[PayoutReminderCron] Skipped — non-prod DB (${dbName})`);
    return;
  }
  // Каждый час: подчистить просроченные неподтверждённые
  Task = cron.schedule('15 * * * *', () => {
    runReminders(db, log).catch((e) => log && log.error && log.error({ err: e }, '[payout-reminder] run failed'));
  }, { timezone: 'Europe/Moscow' });
  log && log.info && log.info('[PayoutReminderCron] Scheduled hourly at :15 MSK');
}

function stop() {
  if (Task) { Task.stop(); Task = null; }
}

module.exports = { start, stop, runReminders };
