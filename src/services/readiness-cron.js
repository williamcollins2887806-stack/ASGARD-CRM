'use strict';

/**
 * Readiness Cron — управление статусами готовности рабочих.
 *
 * 3 задачи:
 * 1. Ежемесячная (1-е число, 09:00 МСК): напоминание рабочим обновить статус
 *    → MAX-мессенджер, fallback SMS через Mango
 * 2. Ежедневная (06:00 МСК): авто-архив если последняя активность > 6 месяцев
 * 3. Ежедневная (07:00 МСК): departure_date = вчера → readiness_status = 'not_ready'
 */

const cron = require('node-cron');

let _monthlyTask = null;
let _archiveTask = null;
let _departureTask = null;

function start(db, log) {
  if (_monthlyTask) return;

  // 1. Ежемесячное напоминание — 1-е число, 09:00 МСК
  _monthlyTask = cron.schedule('0 9 1 * *', () => sendReadinessReminders(db, log), {
    timezone: 'Europe/Moscow',
  });

  // 2. Авто-архив — ежедневно 06:00 МСК
  _archiveTask = cron.schedule('0 6 * * *', () => autoArchive(db, log), {
    timezone: 'Europe/Moscow',
  });

  // 3. Departure → not_ready — ежедневно 07:00 МСК
  _departureTask = cron.schedule('0 7 * * *', () => handleDepartures(db, log), {
    timezone: 'Europe/Moscow',
  });

  log.info('[readiness-cron] Started — monthly reminder (1st 09:00), daily archive (06:00), daily departure (07:00) MSK');
}

function stop() {
  if (_monthlyTask) { _monthlyTask.stop(); _monthlyTask = null; }
  if (_archiveTask) { _archiveTask.stop(); _archiveTask = null; }
  if (_departureTask) { _departureTask.stop(); _departureTask = null; }
}

/**
 * 1. Ежемесячное напоминание — отправить в MAX, fallback SMS
 */
async function sendReadinessReminders(db, log) {
  try {
    log.info('[readiness-cron] Sending monthly readiness reminders...');

    // Рабочие которым нужно обновить статус
    const { rows } = await db.query(`
      SELECT e.id, e.fio, e.phone, e.readiness_status,
             u.id AS user_id, u.max_user_id
      FROM employees e
      LEFT JOIN users u ON u.id = e.user_id
      WHERE e.is_active = true
        AND e.readiness_status NOT IN ('ready', 'on_site', 'archive')
    `);

    if (rows.length === 0) {
      log.info('[readiness-cron] No workers need readiness reminder');
      return;
    }

    log.info(`[readiness-cron] ${rows.length} workers need readiness update`);

    let maxSent = 0;
    let smsSent = 0;
    let failed = 0;

    // Try MAX messenger first
    let maxMessenger = null;
    try {
      maxMessenger = require('./max-messenger');
    } catch { /* MAX not available */ }

    // Try Mango SMS
    let mangoService = null;
    try {
      const { getMangoService } = require('./mango');
      mangoService = getMangoService();
    } catch { /* Mango not available */ }

    const maxMessage = '⚔️ Воин, готов к новому походу? Обнови статус в приложении АСГАРД → кнопка "Готовность"';
    const smsMessage = 'АСГАРД: готов на объект? Зайди в приложение и обнови статус';

    for (const worker of rows) {
      try {
        // Try MAX first
        if (maxMessenger && maxMessenger.isEnabled() && worker.max_user_id) {
          try {
            await maxMessenger.sendMessage(worker.max_user_id, maxMessage);
            maxSent++;
            continue;
          } catch (e) {
            log.warn(`[readiness-cron] MAX failed for ${worker.fio}: ${e.message}`);
          }
        }

        // Fallback: SMS via Mango
        if (mangoService && worker.phone) {
          try {
            await mangoService.sendSms(null, worker.phone, smsMessage);
            smsSent++;
          } catch (e) {
            log.warn(`[readiness-cron] SMS failed for ${worker.fio}: ${e.message}`);
            failed++;
          }
        } else {
          failed++;
        }
      } catch (e) {
        log.error(`[readiness-cron] Error for worker ${worker.id}: ${e.message}`);
        failed++;
      }
    }

    log.info(`[readiness-cron] Reminders sent: MAX=${maxSent}, SMS=${smsSent}, failed=${failed}`);
  } catch (e) {
    log.error(`[readiness-cron] Monthly reminder error: ${e.message}`);
  }
}

/**
 * 2. Авто-архив — последняя активность > 6 месяцев
 */
async function autoArchive(db, log) {
  try {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    // Находим рабочих без активности > 6 месяцев
    const { rows } = await db.query(`
      UPDATE employees
      SET readiness_status = 'archive',
          readiness_updated_at = NOW()
      WHERE is_active = true
        AND readiness_status NOT IN ('ready', 'on_site', 'archive')
        AND id NOT IN (
          SELECT DISTINCT employee_id FROM field_checkins
          WHERE date >= $1::date
        )
        AND id NOT IN (
          SELECT DISTINCT employee_id FROM employee_assignments
          WHERE is_active = true
        )
        AND (readiness_updated_at IS NULL OR readiness_updated_at < $1)
      RETURNING id, fio
    `, [sixMonthsAgo.toISOString().slice(0, 10)]);

    if (rows.length > 0) {
      log.info(`[readiness-cron] Auto-archived ${rows.length} workers: ${rows.map(r => r.fio).join(', ')}`);

      // Log each archive
      for (const worker of rows) {
        await db.query(`
          INSERT INTO worker_readiness_log (employee_id, old_status, new_status, source, created_at)
          VALUES ($1, 'unknown', 'archive', 'auto', NOW())
        `, [worker.id]);
      }
    } else {
      log.info('[readiness-cron] No workers to auto-archive');
    }
  } catch (e) {
    log.error(`[readiness-cron] Auto-archive error: ${e.message}`);
  }
}

/**
 * 3. Departure → not_ready
 * Рабочие у которых departure_date = вчера И is_active=true → readiness_status = 'not_ready'
 */
async function handleDepartures(db, log) {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    const { rows } = await db.query(`
      UPDATE employees e
      SET readiness_status = 'not_ready',
          readiness_updated_at = NOW()
      FROM employee_assignments ea
      WHERE ea.employee_id = e.id
        AND ea.departure_date = $1
        AND e.is_active = true
        AND e.readiness_status IN ('on_site', 'unknown')
        AND NOT EXISTS (
          SELECT 1 FROM employee_assignments ea2
          WHERE ea2.employee_id = e.id
            AND ea2.is_active = true
            AND ea2.departure_date IS NULL
        )
      RETURNING e.id, e.fio
    `, [yesterdayStr]);

    if (rows.length > 0) {
      log.info(`[readiness-cron] Departure → not_ready: ${rows.length} workers: ${rows.map(r => r.fio).join(', ')}`);

      for (const worker of rows) {
        await db.query(`
          INSERT INTO worker_readiness_log (employee_id, old_status, new_status, reason, source, created_at)
          VALUES ($1, 'on_site', 'not_ready', 'departure', 'auto', NOW())
        `, [worker.id]);
      }
    } else {
      log.info('[readiness-cron] No departures to process');
    }
  } catch (e) {
    log.error(`[readiness-cron] Departure handler error: ${e.message}`);
  }
}

module.exports = { start, stop };
