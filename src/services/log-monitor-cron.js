'use strict';

const cron = require('node-cron');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

let _task = null;

const ERROR_RE = /\b(error|fatal|crash|exception|uncaught|unhandled rejection|ECONNREFUSED|ETIMEDOUT|Cannot find module|module not found|ERR_|SIGTERM|out of memory)\b/i;
const NOISE_RE  = /RecordingFetcher|TournamentCron|MimirCron|AcademyCron|PerDiem|ShiftAutocomplete|ReportScheduler|request completed/i;

async function checkAndNotify(db, log) {
  try {
    const { stdout } = await execAsync(
      'journalctl -u asgard-crm --since "3 hours ago" --no-pager -o short 2>/dev/null',
      { timeout: 15000 }
    );

    const lines   = stdout.split('\n').filter(Boolean);
    const errors  = lines.filter(l => ERROR_RE.test(l) && !NOISE_RE.test(l));

    if (errors.length === 0) {
      log.info('[LogMonitor] Check passed — no errors in last 3h');
      return;
    }

    // Получаем всех активных ADMIN
    const { rows: admins } = await db.query(
      "SELECT id FROM users WHERE role = 'ADMIN' AND is_active = true"
    );
    if (admins.length === 0) return;

    const { createNotification } = require('./notify');

    const preview = errors
      .slice(0, 5)
      .map(l => l.slice(l.indexOf('node[') > -1 ? l.indexOf(']: ') + 3 : 0).slice(0, 160))
      .join('\n');

    const title   = `Ошибки в логах: ${errors.length} за 3 часа`;
    const message = `Автомониторинг обнаружил ошибки.\n\n${preview}\n\nОткрой Панель сервера → Мимир для анализа.`;

    for (const admin of admins) {
      await createNotification(db, {
        user_id: admin.id,
        title,
        message,
        type:  'error',
        link:  '/system-panel',
      });
    }

    log.warn(`[LogMonitor] ${errors.length} errors found — notified ${admins.length} admin(s)`);
  } catch (e) {
    log.error('[LogMonitor] Check failed: ' + e.message);
  }
}

function start(db, log) {
  // Каждые 3 часа: 00:00, 03:00, 06:00 ... (по МСК = UTC+3, значит UTC: 21,0,3,6,9,12,15,18)
  _task = cron.schedule('0 0,3,6,9,12,15,18,21 * * *', () => {
    checkAndNotify(db, log);
  }, { timezone: 'Europe/Moscow' });

  log.info('[LogMonitor] Cron started — checks every 3 hours');
}

function stop() {
  if (_task) { _task.stop(); _task = null; }
}

module.exports = { start, stop, checkAndNotify };
