'use strict';

/**
 * Birthday Push Cron — ежедневно в 09:00 МСК уведомляет:
 *  - именинника (с поздравлением)
 *  - всех активных юзеров (что у кого-то ДР)
 *
 * Источник памяти L-2 backlog: «missing birthdays push cron».
 * Виджет /api/birthdays на главной показывает список — теперь он подкрепляется
 * реальной push-волной (через notifications, Telegram, email если включены).
 */

const cron = require('node-cron');

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
    return { celebrated: 0, notified: 0 };
  }

  // Список активных получателей.
  const recipients = await db.query(`
    SELECT id FROM users WHERE is_active = true
  `);

  let notified = 0;
  for (const bd of today.rows) {
    // Самому имениннику — личное поздравление.
    await db.query(`
      INSERT INTO notifications (user_id, type, title, message, link, created_at)
      VALUES ($1, 'system', $2, $3, $4, NOW())
    `, [
      bd.id,
      '🎂 С Днём Рождения!',
      `Команда Асгард поздравляет тебя, ${bd.name}, с днём рождения. Пусть всё получится!`,
      '/#/home'
    ]);
    notified++;
    // Остальным — короткая открытка.
    for (const r of recipients.rows) {
      if (r.id === bd.id) continue;
      await db.query(`
        INSERT INTO notifications (user_id, type, title, message, link, created_at)
        VALUES ($1, 'system', $2, $3, $4, NOW())
      `, [
        r.id,
        '🎂 Сегодня день рождения',
        `Поздравь ${bd.name} с днём рождения!`,
        '/#/birthdays'
      ]);
      notified++;
    }
  }
  log?.info?.(`[BirthdayCron] celebrated=${today.rows.length} notifications=${notified}`);
  return { celebrated: today.rows.length, notified };
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
