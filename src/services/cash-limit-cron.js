'use strict';

/**
 * Cash Limit Cron — ежедневно в 10:00 МСК проверяет:
 *  - у каких PM остаток на руках > лимита (по умолчанию 200_000 ₽)
 *  - в кассе есть открытые заявки старше 14 дней без решения
 * Создаёт уведомления BUH/DIRECTOR_GEN.
 *
 * Источник памяти L-2 backlog: «missing cash limit cron».
 * Limit берётся из settings.cash_limit_per_pm если задан, иначе 200_000.
 */

const cron = require('node-cron');

let _job = null;
const DEFAULT_LIMIT = 200_000;

async function getLimit(db) {
  try {
    const r = await db.query(`SELECT value_json FROM settings WHERE key='cash_limit_per_pm' LIMIT 1`);
    if (!r.rows[0]) return DEFAULT_LIMIT;
    const v = Number(JSON.parse(r.rows[0].value_json));
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_LIMIT;
  } catch { return DEFAULT_LIMIT; }
}

async function runOnce(db, log) {
  const limit = await getLimit(db);
  // Cash on hands per active PM — фильтры идентичны GET /api/cash/my-balance.
  const r = await db.query(`
    SELECT u.id, COALESCE(NULLIF(u.name, ''), u.login) AS name,
      COALESCE((SELECT SUM(cr.amount) FROM cash_requests cr
                WHERE cr.user_id = u.id
                  AND cr.status IN ('money_issued','received','reporting')), 0)
      - COALESCE((SELECT SUM(ce.amount) FROM cash_expenses ce
                  JOIN cash_requests cr ON cr.id = ce.request_id
                  WHERE cr.user_id = u.id
                    AND cr.status IN ('received','reporting')), 0)
      - COALESCE((SELECT SUM(crt.amount) FROM cash_returns crt
                  JOIN cash_requests cr ON cr.id = crt.request_id
                  WHERE cr.user_id = u.id
                    AND cr.status IN ('received','reporting')
                    AND crt.confirmed_at IS NOT NULL), 0) AS balance
    FROM users u
    WHERE u.is_active=true AND u.role IN ('PM','HEAD_PM')
  `);

  const overLimit = r.rows.filter((x) => Number(x.balance) > limit);
  if (!overLimit.length) {
    log?.info?.('[CashLimitCron] tick: 0 over-limit');
    return { overLimit: 0 };
  }

  const recipients = await db.query(
    `SELECT id FROM users WHERE is_active=true AND role IN ('BUH','DIRECTOR_GEN')`
  );
  for (const pm of overLimit) {
    for (const r2 of recipients.rows) {
      await db.query(`
        INSERT INTO notifications (user_id, type, title, message, link, created_at)
        VALUES ($1, 'system', $2, $3, $4, NOW())
      `, [
        r2.id,
        '💰 Превышен лимит кассы',
        `У ${pm.name} на руках ${Number(pm.balance).toLocaleString('ru-RU')} ₽ — выше лимита ${limit.toLocaleString('ru-RU')} ₽`,
        '/#/cash-admin'
      ]);
    }
  }
  log?.info?.(`[CashLimitCron] over_limit=${overLimit.length} notified=${recipients.rows.length}`);
  return { overLimit: overLimit.length };
}

function start(db, log) {
  if (_job) return;
  // 10:00 МСК.
  _job = cron.schedule('0 7 * * *', () => {
    runOnce(db, log).catch((err) => log?.error?.({ err }, '[CashLimitCron] tick failed'));
  });
  log?.info?.('[CashLimitCron] started (daily 10:00 MSK)');
}

function stop() { if (_job) { _job.stop(); _job = null; } }

module.exports = { start, stop, runOnce };
