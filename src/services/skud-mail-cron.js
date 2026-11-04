'use strict';

/**
 * skud-mail-cron — страховка автоматического приёма отчёта СКУД.
 *
 * Зачем нужен, если есть хук в imap.js. Хук срабатывает в момент прихода письма
 * и может не сработать по внешним причинам:
 *   • сервис был перезапущен и письмо попало в паузу;
 *   • вложение не сохранилось (диск, права);
 *   • письмо пришло раньше, чем накатили миграцию.
 * Тогда раз в сутки cron перебирает письма за последние 14 дней, у которых есть
 * подходящее вложение, и импортирует то, что ещё не импортировано. Повторного
 * импорта не будет: sha256 и период отсекаются в skud-import.js.
 *
 * Паттерн модуля — как у vacation-reminders-cron: start(db, log) / stop(),
 * node-cron, advisory-lock (в двух процессах не крутится), graceful stop.
 */

const cron = require('node-cron');

let _task = null;
let _db = null;
let _log = null;

/** В двух инстансах cron не должен дублироваться. */
const LOCK_KEY = 7766311;
const LOOKBACK_DAYS = 14;

function pickLogger(log) {
  return (log && typeof log.info === 'function') ? log : console;
}

/**
 * Один проход: найти письма-кандидаты и попробовать импорт.
 * Отдельная функция — её же зовём из API «проверить сейчас».
 */
async function scanOnce(db, log, opts = {}) {
  const logger = pickLogger(log);
  const lookback = opts.lookbackDays || LOOKBACK_DAYS;
  const skudIntake = require('./skud-mail-intake');

  const { rows } = await db.query(
    `SELECT e.id, e.subject, e.from_email, e.email_date, e.created_at
       FROM emails e
      WHERE COALESCE(e.is_deleted, false) = false
        AND COALESCE(e.has_attachments, false) = true
        AND COALESCE(e.email_date, e.created_at) >= NOW() - ($1 || ' days')::interval
        AND EXISTS (
          SELECT 1 FROM email_attachments a
           WHERE a.email_id = e.id
             AND (a.filename ILIKE '%.xls' OR a.filename ILIKE '%.xlsx' OR a.filename ILIKE '%.zip')
             AND COALESCE(a.is_inline, false) = false
        )
      ORDER BY e.id DESC
      LIMIT 200`,
    [String(lookback)]
  );

  const results = [];
  for (const email of rows) {
    try {
      const res = await skudIntake.intakeEmail(db, email);
      if (res.touched) results.push({ emailId: email.id, imports: res.imports });
    } catch (e) {
      logger.warn(`[SkudMailCron] письмо #${email.id}: ${e.message}`);
      results.push({ emailId: email.id, error: e.message });
    }
  }

  const imported = results.reduce((n, r) => n + (r.imports || []).filter((i) => i.importId && !i.skipped).length, 0);
  if (imported) logger.info(`[SkudMailCron] импортировано отчётов: ${imported}`);
  return { scanned: rows.length, touched: results.length, imported, results };
}

function start(db, log) {
  _db = db;
  _log = log;
  if (_task) return;

  // 06:10 MSK ежедневно: отчёт за прошлый день уже пришёл к этому времени,
  // а утренний поток людей ещё не начался — импорт не конкурирует за БД.
  _task = cron.schedule('10 6 * * *', async () => {
    if (!_db) return;
    const logger = pickLogger(_log);
    let client = null;
    try {
      client = _db.pool ? await _db.pool.connect() : _db;
      await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
      await scanOnce(_db, logger);
    } catch (e) {
      logger.warn('[SkudMailCron] проход пропущен: ' + e.message);
    } finally {
      if (client) {
        try { await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]); } catch (_) {}
        if (client.release) client.release();
      }
    }
  }, { timezone: 'Europe/Moscow' });

  pickLogger(log).info('[SkudMailCron] страховочный разбор писем СКУД запущен (06:10 MSK)');
}

function stop() {
  if (_task) {
    _task.stop();
    _task = null;
  }
}

module.exports = { start, stop, scanOnce, LOOKBACK_DAYS };
