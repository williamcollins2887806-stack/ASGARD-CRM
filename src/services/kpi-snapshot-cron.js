'use strict';

/**
 * KPI Snapshot Cron — ежедневно в 00:30 МСК записывает суточный срез метрик.
 * Хранит в settings.kpi_snapshots (jsonb-массив 30 последних дней).
 *
 * Источник памяти L-2 backlog: «missing KPI cron».
 * Метрики собираем по существующим таблицам — works/tenders/cash_requests/returns/expenses —
 * без новых эндпоинтов. История нужна для трендов Big Screen / Дашборда директора.
 */

const cron = require('node-cron');

let _job = null;
const MAX_DAYS = 30;

async function takeSnapshot(db, log) {
  const [works, tenders, cash] = await Promise.all([
    db.query(`SELECT COUNT(*) AS total,
                     COUNT(*) FILTER (WHERE work_status NOT IN ('Закрыт','Закрыта','Закрыто','Работы сдали','Завершена','Отменена')) AS active,
                     COALESCE(SUM(contract_value),0) AS sum_contract
              FROM works WHERE deleted_at IS NULL`),
    db.query(`SELECT COUNT(*) AS total,
                     COUNT(*) FILTER (WHERE tender_status='Выиграли') AS won,
                     COUNT(*) FILTER (WHERE tender_status='Проиграли') AS lost
              FROM tenders WHERE deleted_at IS NULL`),
    db.query(`SELECT
                COALESCE((SELECT SUM(amount) FROM cash_requests
                          WHERE issued_at IS NOT NULL
                            AND issued_at >= CURRENT_DATE - INTERVAL '1 day'), 0) AS issued,
                COALESCE((SELECT SUM(amount) FROM cash_returns
                          WHERE confirmed_at >= CURRENT_DATE - INTERVAL '1 day'), 0) AS returned,
                COALESCE((SELECT SUM(amount) FROM cash_expenses
                          WHERE created_at >= CURRENT_DATE - INTERVAL '1 day'), 0) AS spent`)
  ]);

  const snap = {
    date: new Date().toISOString().slice(0, 10),
    works: works.rows[0],
    tenders: tenders.rows[0],
    cash: cash.rows[0]
  };

  // Сохраняем в settings.kpi_snapshots — массив последних MAX_DAYS дней.
  const existing = await db.query(`SELECT value_json FROM settings WHERE key='kpi_snapshots' LIMIT 1`);
  let arr = [];
  if (existing.rows[0]) {
    try { arr = JSON.parse(existing.rows[0].value_json) || []; } catch { arr = []; }
  }
  arr = arr.filter((x) => x.date !== snap.date); // защита от дубля
  arr.push(snap);
  arr = arr.slice(-MAX_DAYS);

  if (existing.rows[0]) {
    await db.query(`UPDATE settings SET value_json = $1, updated_at=NOW() WHERE key='kpi_snapshots'`, [JSON.stringify(arr)]);
  } else {
    await db.query(`INSERT INTO settings (key, value_json, updated_at) VALUES ('kpi_snapshots', $1, NOW())`, [JSON.stringify(arr)]);
  }
  log?.info?.(`[KpiSnapshotCron] snapshot saved (${arr.length} days kept)`);
  return snap;
}

function start(db, log) {
  if (_job) return;
  // 00:30 МСК = 21:30 UTC.
  _job = cron.schedule('30 21 * * *', () => {
    takeSnapshot(db, log).catch((err) => log?.error?.({ err }, '[KpiSnapshotCron] tick failed'));
  });
  log?.info?.('[KpiSnapshotCron] started (daily 00:30 MSK)');
}

function stop() { if (_job) { _job.stop(); _job = null; } }

module.exports = { start, stop, takeSnapshot };
