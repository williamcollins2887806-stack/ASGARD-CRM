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
const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 минут — чтобы РП не ждал час до автоочистки

// Опус-архитектура (19.06.2026): тайминги переведены в env-конфигурируемые мс,
// а UI-таблицы (минуты) выводятся как Math.round из этих констант.
//   AGENT_TIMEOUT_MS — таймаут одного агента (по умолчанию 5 мин).
//   RUN_TIMEOUT_MS   — таймаут всего run (по умолчанию 30 мин).
const AGENT_TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS) || (5 * 60 * 1000);
const RUN_TIMEOUT_MS = Number(process.env.RUN_TIMEOUT_MS) || (30 * 60 * 1000);
const STALE_AGENT_MIN = Math.max(1, Math.round(AGENT_TIMEOUT_MS / 60000));
const STALE_RUN_MIN = Math.max(1, Math.round(RUN_TIMEOUT_MS / 60000));

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
  // 1. Зависшие agent_runs (одиночный агент висит без прогресса > AGENT_TIMEOUT_MS).
  //    Эти агенты блокируют дальнейшую работу Conductor — нужно очистить.
  //    Записываем КОНКРЕТНО какой агент повис и сколько он работал.
  try {
    const res = await db.query(
      `UPDATE mimir_agent_runs
          SET status = 'ERROR',
              error_text = COALESCE(error_text, 'Таймаут агента (>${STALE_AGENT_MIN} мин без завершения)'),
              error_code = COALESCE(error_code, 'TIMEOUT'),
              completed_at = NOW()
        WHERE status = 'RUNNING'
          AND started_at < NOW() - INTERVAL '${STALE_AGENT_MIN} minutes'
        RETURNING id, conductor_run_id, agent_name, started_at,
                  EXTRACT(EPOCH FROM (NOW() - started_at))::int AS ran_seconds`,
      []
    );
    if (res.rowCount > 0) {
      const tags = res.rows
        .map((r) => `#${r.conductor_run_id}/${r.agent_name}(${Math.round((r.ran_seconds || 0) / 60)}мин)`)
        .join(', ');
      (log && log.info ? log.info.bind(log) : console.log)(
        `[conductor-sweeper] agent-timeout: ${res.rowCount} зависших агентов помечено как ERROR (${tags})`
      );
      // Событие в run для UI — сколько именно работал, кто, почему
      for (const r of res.rows) {
        try {
          await db.query(
            `INSERT INTO mimir_agent_events (conductor_run_id, agent_run_id, event_type, payload)
             VALUES ($1, $2, 'error', $3::jsonb)`,
            [r.conductor_run_id, r.id, JSON.stringify({
              text: `Агент ${r.agent_name} прерван по таймауту >${STALE_AGENT_MIN} мин (фактически работал ${Math.round((r.ran_seconds || 0) / 60)} мин)`,
              agent_name: r.agent_name,
              code: 'TIMEOUT',
              ran_seconds: r.ran_seconds,
              ran_minutes: Math.round((r.ran_seconds || 0) / 60),
              limit_minutes: STALE_AGENT_MIN
            })]
          );
        } catch (_) { /* noop */ }
      }
    }
  } catch (e) {
    (log && log.warn ? log.warn.bind(log) : console.warn)(`[conductor-sweeper] agent-sweep error: ${e.message}`);
  }

  // 2. Зависшие conductor_runs (нет обновлений > RUN_TIMEOUT_MS).
  try {
    const res = await db.query(
      `UPDATE mimir_conductor_runs
          SET status = 'ERROR',
              blocked_reason = COALESCE(blocked_reason, 'Таймаут: более ${STALE_RUN_MIN} минут без обновлений'),
              completed_at = NOW(),
              updated_at = NOW()
        WHERE status = ANY($1::text[])
          AND updated_at < NOW() - INTERVAL '${STALE_RUN_MIN} minutes'
        RETURNING id`,
      [STALE_STATUSES]
    );
    if (res.rowCount > 0) {
      const ids = res.rows.map((r) => r.id);
      // Для каждого канселимого run пробуем найти, на каком агенте он завис
      // (последний RUNNING/ERROR agent_run) — это попадёт в status_change event.
      const hangInfo = [];
      for (const id of ids) {
        try {
          const ag = await db.query(
            `SELECT agent_name, status,
                    EXTRACT(EPOCH FROM (NOW() - started_at))::int AS ran_seconds
               FROM mimir_agent_runs
              WHERE conductor_run_id = $1
              ORDER BY started_at DESC NULLS LAST
              LIMIT 1`,
            [id]
          );
          const r = ag.rows[0];
          if (r) hangInfo.push({ runId: id, last_agent: r.agent_name, last_agent_status: r.status, ran_minutes: Math.round((r.ran_seconds || 0) / 60) });
          else hangInfo.push({ runId: id });
        } catch (_) { hangInfo.push({ runId: id }); }
      }
      await _logStatusEvents(db, ids, 'timeout', hangInfo);
      const tags = hangInfo.map((h) => h.last_agent ? `#${h.runId}@${h.last_agent}(${h.ran_minutes}мин)` : `#${h.runId}`).join(', ');
      (log && log.info ? log.info.bind(log) : console.log)(
        `[conductor-sweeper] run-sweep: ${res.rowCount} зависших RUNNING помечено как ERROR (timeout): ${tags}`
      );
    }
  } catch (e) {
    (log && log.warn ? log.warn.bind(log) : console.warn)(`[conductor-sweeper] run-sweep error: ${e.message}`);
  }
}

/** Записать status_change-события для пачки прогонов (best-effort).
 *  hangInfo: [{ runId, last_agent?, last_agent_status?, ran_minutes? }, ...] */
async function _logStatusEvents(db, runIds, reason, hangInfo) {
  const byRun = new Map();
  if (Array.isArray(hangInfo)) {
    for (const h of hangInfo) if (h && h.runId != null) byRun.set(h.runId, h);
  }
  for (const runId of runIds) {
    try {
      const extra = byRun.get(runId) || {};
      await db.query(
        `INSERT INTO mimir_agent_events (conductor_run_id, agent_run_id, event_type, payload)
         VALUES ($1, NULL, 'status_change', $2)`,
        [runId, JSON.stringify({
          from: 'RUNNING', to: 'ERROR', reason,
          last_agent: extra.last_agent || null,
          last_agent_status: extra.last_agent_status || null,
          ran_minutes: extra.ran_minutes != null ? extra.ran_minutes : null
        })]
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
  (log && log.info ? log.info.bind(log) : console.log)(`[conductor-sweeper] Started — sweep каждые 5 мин (run ${STALE_RUN_MIN}мин / agent ${STALE_AGENT_MIN}мин)`);
}

function stop() {
  if (_interval) { clearInterval(_interval); _interval = null; }
}

module.exports = {
  start, stop, sweep, markOrphanedAsError,
  // Опус-конфигурируемые константы — экспортируем чтобы агенты/тесты могли свериться.
  AGENT_TIMEOUT_MS, RUN_TIMEOUT_MS, STALE_AGENT_MIN, STALE_RUN_MIN
};
