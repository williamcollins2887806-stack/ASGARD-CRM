'use strict';

/**
 * Per-Diem Cron — уведомления PM о необходимости выплатить суточные.
 *
 * Раз в день (09:30) проверяет:
 * - Все активные работы с field_checkins
 * - У каких рабочих есть смены за вчера/сегодня, но нет выплаченных суточных
 * - Отправляет уведомление PM проекта
 */

const cron = require('node-cron');
const { createNotification } = require('./notify');

let _task = null;

function start(db, log) {
  if (_task) return;

  // Каждый день в 09:30 (пн-сб)
  _task = cron.schedule('30 9 * * 1-6', () => checkPerDiem(db, log), {
    timezone: 'Europe/Moscow',
  });

  log.info('[per-diem-cron] Started — daily 09:30 MSK (Mon-Sat)');
}

function stop() {
  if (_task) { _task.stop(); _task = null; }
}

async function checkPerDiem(db, log) {
  try {
    log.info('[per-diem-cron] Checking per-diem payments...');

    // Находим работы с невыплаченными суточными:
    // Рабочие, у которых есть checkins за последние 3 дня,
    // но нет worker_payment per_diem со status='paid' за эти даты
    const { rows } = await db.query(`
      WITH active_works AS (
        SELECT DISTINCT w.id AS work_id, w.work_title, w.pm_id
        FROM works w
        WHERE w.work_status NOT IN ('Завершена', 'Закрыт')
          AND w.pm_id IS NOT NULL
      ),
      recent_checkins AS (
        SELECT
          fc.work_id,
          fc.employee_id,
          e.fio,
          COUNT(DISTINCT fc.date) AS shift_days,
          MIN(fc.date) AS first_date,
          MAX(fc.date) AS last_date
        FROM field_checkins fc
        JOIN employees e ON e.id = fc.employee_id
        JOIN active_works aw ON aw.work_id = fc.work_id
        WHERE fc.status IN ('completed', 'closed', 'confirmed')
          AND COALESCE(fc.amount_earned, 0) > 0
        GROUP BY fc.work_id, fc.employee_id, e.fio
      ),
      paid_per_diem AS (
        SELECT
          wp.work_id,
          wp.employee_id,
          SUM(wp.days) AS paid_days
        FROM worker_payments wp
        WHERE wp.type = 'per_diem'
          AND wp.status IN ('paid', 'confirmed')
        GROUP BY wp.work_id, wp.employee_id
      )
      SELECT
        rc.work_id,
        aw.work_title,
        aw.pm_id,
        COUNT(*) AS unpaid_workers,
        SUM(rc.shift_days - COALESCE(ppd.paid_days, 0)) AS unpaid_days,
        SUM((rc.shift_days - COALESCE(ppd.paid_days, 0)) * COALESCE(ea.per_diem, fps.per_diem, 1000)) AS unpaid_amount
      FROM recent_checkins rc
      JOIN active_works aw ON aw.work_id = rc.work_id
      LEFT JOIN paid_per_diem ppd ON ppd.work_id = rc.work_id AND ppd.employee_id = rc.employee_id
      LEFT JOIN employee_assignments ea ON ea.work_id = rc.work_id AND ea.employee_id = rc.employee_id AND ea.is_active = TRUE
      LEFT JOIN field_project_settings fps ON fps.work_id = rc.work_id
      WHERE rc.shift_days > COALESCE(ppd.paid_days, 0)
      GROUP BY rc.work_id, aw.work_title, aw.pm_id
      HAVING SUM(rc.shift_days - COALESCE(ppd.paid_days, 0)) > 0
      ORDER BY unpaid_amount DESC
    `);

    if (!rows.length) {
      log.info('[per-diem-cron] No unpaid per-diem found');
      return;
    }

    log.info(`[per-diem-cron] Found ${rows.length} works with unpaid per-diem`);

    for (const row of rows) {
      if (!row.pm_id) continue;

      const amount = Math.round(parseFloat(row.unpaid_amount) || 0);
      const days = parseInt(row.unpaid_days) || 0;
      const workers = parseInt(row.unpaid_workers) || 0;

      const title = '💰 Суточные — не выплачены';
      const message = `${row.work_title}: ${workers} чел., ${days} дн., ${amount.toLocaleString('ru-RU')} ₽ к выплате`;
      const link = `#/pm-works?highlight=${row.work_id}`;

      // Не спамить — проверяем что уведомление за сегодня ещё не отправлялось
      const { rows: existing } = await db.query(`
        SELECT id FROM notifications
        WHERE user_id = $1
          AND title = $2
          AND created_at >= CURRENT_DATE
        LIMIT 1
      `, [row.pm_id, title]);

      if (existing.length > 0) continue;

      await createNotification(db, {
        user_id: row.pm_id,
        title,
        message,
        type: 'warning',
        link,
      });

      log.info(`[per-diem-cron] Notified PM ${row.pm_id}: ${row.work_title} — ${amount}₽`);
    }
  } catch (err) {
    log.error('[per-diem-cron] Error:', err.message);
  }
}

module.exports = { start, stop };
