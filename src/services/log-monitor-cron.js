'use strict';

/**
 * LogMonitor — авто-уведомления администраторам о реальных ошибках в логах.
 *
 * D-312 (20.10.2026): монитор был СЛЕП. Он читал
 *   journalctl -u asgard-crm --since "3 hours ago" -p warning
 * а pino пишет ВСЕ свои строки в journal с PRIORITY=6 (info), включая
 * `"level":50`. Замер на проде: за 3 часа `-p warning` отдал «No entries»,
 * за 7 дней — 4 строки (все systemd про SIGKILL). 1 362 ошибки приложения
 * за неделю монитор не видел вообще.
 *
 * Теперь читаем без `-p` и фильтруем по `"level":40|50` в теле pino-строки.
 * Плюс отдельно берём systemd-строки (они идут без JSON и без level).
 */

const cron = require('node-cron');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

let _task = null;

/** Уровни pino, которые считаются дефектом: 40=warn, 50=error, 60=fatal. */
const LEVEL_RE = /"level":(40|50|60)\b/;

/** Текстовые признаки ошибки для строк БЕЗ pino-уровня (systemd, стектрейсы). */
const ERROR_RE = /\b(fatal|crash|uncaught|unhandled rejection|ECONNREFUSED|ETIMEDOUT|Cannot find module|module not found|SIGTERM|out of memory|OOM|Failed with result|status=9\/KILL)\b/i;

/**
 * Известный шум. Каждая запись — обоснование, а не «чтобы не мешало»:
 *  - RecordingFetcher: webhook — основной путь записей, фетчер страховка;
 *  - *Cron / ReportScheduler / ShiftAutocomplete: фоновые задачи, пишут warn при
 *    штатных «нет данных»;
 *  - request completed: access-лог Fastify;
 *  - [client-error]: ошибки БРАУЗЕРА, не сервера. Их разбирают по source/dev-хосту,
 *    админу в 3 часа ночи они не нужны;
 *  - Reply was already sent / ERR_HTTP_HEADERS_SENT: до D-307 это был массовый
 *    шум (1 100 событий/неделю), после фикса должен исчезнуть — но если вернётся,
 *    его поймает деплой-гейт, а не ночное уведомление;
 *  - [LogMonitor]: сам себя не уведомляем.
 */
const NOISE_RE = new RegExp([
  'RecordingFetcher',
  'TournamentCron', 'MimirCron', 'AcademyCron', 'PerDiem',
  'ShiftAutocomplete', 'ReportScheduler',
  'request completed',
  '\\[IMAP-AI\\] Diagnostic:',
  'failed_ai=',
  '\\[client-error\\]',
  '\\[LogMonitor\\]',
  'Reply was already sent',
  // НЕ добавлять сюда ERR_HTTP_HEADERS_SENT: это серверная ошибка, её надо
  // видеть. До D-307 она была массовой — но именно поэтому, а не «шум».
].join('|'), 'i');

/** Разбор одной строки журнала. Возвращает 'error' | 'ignore'. */
function classify(line) {
  if (!line) return 'ignore';
  if (NOISE_RE.test(line)) return 'ignore';
  const m = LEVEL_RE.exec(line);
  if (m) return Number(m[1]) >= 40 ? 'error' : 'ignore';
  // Строки без pino (systemd/ядро) — только явные сигналы падения.
  return ERROR_RE.test(line) ? 'error' : 'ignore';
}

/** Чистим строку для превью: убираем системный префикс journald и JSON-мусор. */
function prettify(line) {
  let s = line;
  const nodeIdx = s.indexOf(']: ');
  if (nodeIdx > -1) s = s.slice(nodeIdx + 3);
  // pino-строка → msg
  try {
    const i = s.indexOf('{');
    if (i > -1) {
      const o = JSON.parse(s.slice(i));
      if (o.msg) s = (o.level >= 50 ? '[error] ' : '[warn] ') + o.msg;
    }
  } catch (_) { /* не JSON — оставляем как есть */ }
  return s.slice(0, 160);
}

async function checkAndNotify(db, log) {
  try {
    // D-312: БЕЗ `-p warning` — pino пишет в journal с PRIORITY=6.
    const { stdout } = await execAsync(
      'journalctl -u asgard-crm --since "3 hours ago" --no-pager -o short 2>/dev/null | tail -n 20000',
      { timeout: 30000, maxBuffer: 80 * 1024 * 1024 }
    );

    const lines = stdout.split('\n').filter(Boolean);
    const errors = lines.filter((l) => classify(l) === 'error');

    // Само-диагностика: если строк много, а ошибок ноль — это подозрительно.
    if (lines.length === 0) {
      log.warn('[LogMonitor] журнал пуст за 3 часа — проверьте journalctl/права');
      return;
    }

    if (errors.length === 0) {
      log.info(`[LogMonitor] Check passed — 0 ошибок из ${lines.length} строк за 3ч`);
      return;
    }

    const { rows: admins } = await db.query(
      "SELECT id FROM users WHERE role = 'ADMIN' AND is_active = true"
    );
    if (admins.length === 0) return;

    const { createNotification } = require('./notify');

    // Группируем по тексту: 900 одинаковых строк не должны занимать 5 слотов.
    const counts = new Map();
    for (const line of errors) {
      const key = prettify(line);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const preview = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([text, n]) => (n > 1 ? `${text} (×${n})` : text))
      .join('\n');

    const kinds = counts.size;
    const title = `Ошибки в логах: ${errors.length} за 3 часа (${kinds} вид.)`;
    const message = `Автомониторинг обнаружил ошибки.\n\n${preview}\n\nОткрой Панель сервера → Мимир для анализа.`;

    for (const admin of admins) {
      await createNotification(db, {
        user_id: admin.id,
        title,
        message,
        type: 'error',
        link: '/system-panel',
      });
    }

    log.warn(`[LogMonitor] ${errors.length} errors (${kinds} kinds) — notified ${admins.length} admin(s)`);
  } catch (e) {
    log.error('[LogMonitor] Check failed: ' + e.message);
  }
}

function start(db, log) {
  // Каждые 3 часа: 00:00, 03:00, 06:00 ... (МСК)
  _task = cron.schedule('0 0,3,6,9,12,15,18,21 * * *', () => {
    checkAndNotify(db, log);
  }, { timezone: 'Europe/Moscow' });

  log.info('[LogMonitor] Cron started — checks every 3 hours (pino level 40/50/60)');
}

function stop() {
  if (_task) { _task.stop(); _task = null; }
}

module.exports = { start, stop, checkAndNotify, classify, prettify, LEVEL_RE, ERROR_RE, NOISE_RE };
