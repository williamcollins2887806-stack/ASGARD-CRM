'use strict';

/**
 * ASGARD CRM — Mimir Conductor: чистильщик зависших прогонов (Сессия 08, fix #2)
 * ═══════════════════════════════════════════════════════════════════════════
 * Conductor-просчёт живёт в памяти процесса (runConductor — fire-and-forget).
 * Если процесс упадёт/перезагрузится во время RUNNING — запись в БД останется
 * RUNNING НАВСЕГДА: UI не покажет ошибку, юзер не сможет перезапустить.
 *
 *   • markOrphanedAsError() — на старте: всё RUNNING/CONSOLIDATING старше
 *     5 минут (по updated_at) → ERROR «Сервер был перезагружен во время просчёта».
 *     После рестарта эти прогоны мертвы по определению.
 *   • sweep() — раз в час: RUNNING/CONSOLIDATING без обновлений > 30 минут → ERROR
 *     (зависший loop, упавший агент без перехвата и т.п.).
 *
 * Паттерн модуля — как у остальных кронов: start(db, log) / stop().
 * ═══════════════════════════════════════════════════════════════════════════
 */

const STALE_STATUSES = ['RUNNING', 'CONSOLIDATING'];
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 час

let _interval = null;

/**
 * Пометить осиротевшие при рестарте прогоны как ERROR + записать событие.
 * @param {Object} db
 * @param {Object} [log]
 */
async function markOrphanedAsError(db, log) {
  try {
    const res = await db.query(
      `UPDATE mimir_conductor_runs
          SET status = 'ERROR',
              blocked_reason = 'Сервер был перезагружен во время просчёта',
              completed_at = NOW(),
              updated_at = NOW()
        WHERE status = ANY($1::text[])
          AND updated_at < NOW() - INTERVAL '5 minutes'
        RETURNING id`,
      [STALE_STATUSES]
    );
    if (res.rowCount > 0) {
      const ids = res.rows.map((r) => r.id);
      await _logStatusEvents(db, ids, 'server_restart');
      (log && log.warn ? log.warn.bind(log) : console.warn)(
        `[conductor-sweeper] startup: ${res.rowCount} осиротевших RUNNING помечены как ERROR (server_restart)`
      );
    }
  } catch (e) {
    (log && log.warn ? log.warn.bind(log) : console.warn)(
      `[conductor-sweeper] markOrphanedAsError error: ${e.message}`
    );
  }
}

/**
 * Периодическая чистка зависших RUNNING (нет обновлений > 30 минут).
 * @param {Object} db
 * @param {Object} [log]
 */
async function sweep(db, log) {
  try {
    const res = await db.query(
      `UPDATE mimir_conductor_runs
          SET status = 'ERROR',
              blocked_reason = COALESCE(blocked_reason, 'Таймаут: более 30 минут без обновлений'),
              completed_at = NOW(),
              updated_at = NOW()
        WHERE status = ANY($1::text[])
          AND updated_at < NOW() - INTERVAL '30 minutes'
        RETURNING id`,
      [STALE_STATUSES]
    );
    if (res.rowCount > 0) {
      const ids = res.rows.map((r) => r.id);
      await _logStatusEvents(db, ids, 'timeout');
      (log && log.info ? log.info.bind(log) : console.log)(
        `[conductor-sweeper] sweep: ${res.rowCount} зависших RUNNING помечено как ERROR (timeout)`
      );
    }
  } catch (e) {
    (log && log.warn ? log.warn.bind(log) : console.warn)(
      `[conductor-sweeper] sweep error: ${e.message}`
    );
  }
}

/** Записать status_change-события для пачки прогонов (best-effort). */
async function _logStatusEvents(db, runIds, reason) {
  for (const runId of runIds) {
    try {
      await db.query(
        `INSERT INTO mimir_agent_events (conductor_run_id, agent_run_id, event_type, payload)
         VALUES ($1, NULL, 'status_change', $2)`,
        [runId, JSON.stringify({ from: 'RUNNING', to: 'ERROR', reason })]
      );
    } catch (_) { /* noop — событие не критично */ }
  }
}

/**
 * Запуск: сразу чистим осиротевшие + ставим часовой sweep.
 * @param {Object} db — fastify.db
 * @param {Object} [log] — fastify.log
 */
function start(db, log) {
  if (_interval) return;
  markOrphanedAsError(db, log).catch(() => {});
  _interval = setInterval(() => sweep(db, log).catch(() => {}), SWEEP_INTERVAL_MS);
  (log && log.info ? log.info.bind(log) : console.log)('[conductor-sweeper] Started — hourly stale-run sweep');
}

function stop() {
  if (_interval) { clearInterval(_interval); _interval = null; }
}

module.exports = { start, stop, sweep, markOrphanedAsError };
