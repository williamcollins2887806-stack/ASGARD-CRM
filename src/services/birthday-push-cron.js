'use strict';

/**
 * Birthday Push Cron — ежедневно в 09:00 МСК:
 *  - официальное поздравление имениннику (Max→SMS + email + in-app)
 *  - in-app коллегам: «сегодня ДР у …»
 */

const cron = require('node-cron');
const { ensureAndDeliverAsgardWish } = require('./birthday-asgard-wish');

let _job = null;

async function runOnce(db, log) {
  const today = await db.query(`
    SELECT u.id, COALESCE(NULLIF(u.name, ''), u.login) AS name
    FROM users u
    WHERE u.is_active = true
      AND u.birth_date IS NOT NULL
      AND to_char(u.birth_date, 'MM-DD') = to_char(CURRENT_DATE, 'MM-DD')
  `);
  if (!today.rows.length) {
    log?.info?.('[BirthdayCron] today: 0 birthdays');
    return { celebrated: 0, notified: 0, asgard: 0 };
  }

  const recipients = await db.query(`
    SELECT id FROM users WHERE is_active = true
  `);

  let notified = 0;
  let asgard = 0;

  for (const bd of today.rows) {
    try {
      const delivered = await ensureAndDeliverAsgardWish(db, bd.id, log);
      if (delivered && delivered.ok) asgard += 1;
    } catch (err) {
      log?.error?.({ err }, `[BirthdayCron] asgard wish failed user=${bd.id}`);
    }

    await db.query(`
      INSERT INTO notifications (user_id, type, title, message, link, created_at)
      VALUES ($1, 'birthday_asgard', $2, $3, $4, NOW())
    `, [
      bd.id,
      'День воина',
      `Команда Асгарда поздравляет тебя, ${bd.name}. Загляни в CRM — коллеги могли оставить дары.`,
      '/#/home?bd_reveal=1'
    ]);
    notified++;

    for (const r of recipients.rows) {
      if (r.id === bd.id) continue;
      await db.query(`
        INSERT INTO notifications (user_id, type, title, message, link, created_at)
        VALUES ($1, 'birthday_notice', $2, $3, $4, NOW())
      `, [
        r.id,
        'Сегодня день рождения',
        `Поздравь ${bd.name} — оставь дар в CRM.`,
        '/#/birthdays'
      ]);
      notified++;
    }
  }

  log?.info?.(`[BirthdayCron] celebrated=${today.rows.length} asgard=${asgard} notifications=${notified}`);
  return { celebrated: today.rows.length, notified, asgard };
}

function start(db, log) {
  if (_job) return;
  // 09:00 МСК = 06:00 UTC.
  _job = cron.schedule('0 6 * * *', () => {
    runOnce(db, log).catch((err) => log?.error?.({ err }, '[BirthdayCron] tick failed'));
  });
  log?.info?.('[BirthdayCron] started (daily 09:00 MSK)');
}

function stop() { if (_job) { _job.stop(); _job = null; } }

module.exports = { start, stop, runOnce };
