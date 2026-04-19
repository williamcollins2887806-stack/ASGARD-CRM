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

    // Находим рабочих у которых запас суточных <= 2 дня
    // запас = оплаченные_дни - отработанные_дни
    const WARN_DAYS = 2; // предупреждать когда запас <= 2 дней

    const { rows } = await db.query(`
      WITH active_works AS (
        SELECT DISTINCT w.id AS work_id, w.work_title, w.pm_id
        FROM works w
        WHERE w.work_status NOT IN ('Завершена', 'Закрыт')
          AND w.pm_id IS NOT NULL
      ),
      checkin_days AS (
        SELECT fc.work_id, fc.employee_id, COUNT(DISTINCT fc.date) AS worked_days
        FROM field_checkins fc
        JOIN active_works aw ON aw.work_id = fc.work_id
        WHERE fc.status IN ('completed', 'closed', 'confirmed')
          AND COALESCE(fc.amount_earned, 0) > 0
        GROUP BY fc.work_id, fc.employee_id
      ),
      paid AS (
        SELECT wp.work_id, wp.employee_id,
               FLOOR(SUM(wp.amount) / GREATEST(COALESCE(
                 (SELECT ea2.per_diem FROM employee_assignments ea2
                  WHERE ea2.work_id = wp.work_id AND ea2.employee_id = wp.employee_id
                    AND ea2.is_active = TRUE LIMIT 1), 1000), 1))::int AS paid_days
        FROM worker_payments wp
        WHERE wp.type = 'per_diem' AND wp.status IN ('paid', 'confirmed')
        GROUP BY wp.work_id, wp.employee_id
      )
      SELECT
        cd.work_id,
        aw.work_title,
        aw.pm_id,
        e.fio,
        cd.worked_days,
        COALESCE(p.paid_days, 0) AS paid_days,
        (COALESCE(p.paid_days, 0) - cd.worked_days) AS days_left
      FROM checkin_days cd
      JOIN active_works aw ON aw.work_id = cd.work_id
      JOIN employees e ON e.id = cd.employee_id
      LEFT JOIN paid p ON p.work_id = cd.work_id AND p.employee_id = cd.employee_id
      WHERE (COALESCE(p.paid_days, 0) - cd.worked_days) <= $1
      ORDER BY (COALESCE(p.paid_days, 0) - cd.worked_days) ASC, e.fio
    `, [WARN_DAYS]);

    if (!rows.length) {
      log.info('[per-diem-cron] No per-diem warnings');
      return;
    }

    // Группируем по work_id + pm_id
    const byWork = {};
    for (const r of rows) {
      const key = r.work_id + ':' + r.pm_id;
      if (!byWork[key]) byWork[key] = { work_id: r.work_id, work_title: r.work_title, pm_id: r.pm_id, people: [] };
      byWork[key].people.push({ fio: r.fio, days_left: parseInt(r.days_left), worked: parseInt(r.worked_days), paid: parseInt(r.paid_days) });
    }

    log.info(`[per-diem-cron] Found ${rows.length} workers with per-diem running low`);

    for (const row of Object.values(byWork)) {
      if (!row.pm_id) continue;

      // Формируем список поимённо
      const urgent = row.people.filter(p => p.days_left <= 0);
      const warning = row.people.filter(p => p.days_left > 0 && p.days_left <= WARN_DAYS);

      let message = `${row.work_title}:\n`;
      if (urgent.length) {
        message += `🔴 Закончились: ${urgent.map(p => p.fio + ' (' + p.days_left + ' дн.)').join(', ')}\n`;
      }
      if (warning.length) {
        message += `🟡 Скоро: ${warning.map(p => p.fio + ' (осталось ' + p.days_left + ' дн.)').join(', ')}`;
      }

      const title = urgent.length ? '🔴 Суточные закончились!' : '🟡 Суточные заканчиваются';
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
