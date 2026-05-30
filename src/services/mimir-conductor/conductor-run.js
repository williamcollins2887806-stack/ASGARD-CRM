/**
 * ASGARD CRM — Mimir Conductor: ConductorRun service (Сессия 1, Шаг 1.4)
 * ═══════════════════════════════════════════════════════════════════════════
 * Простые обёртки над БД для жизненного цикла одного просчёта.
 * Без бизнес-логики — она придёт в сессии 2 (Conductor) и 4 (агенты).
 *
 * Таблицы: mimir_conductor_runs, mimir_agent_runs, mimir_artifacts,
 *          mimir_agent_events, mimir_clarifications, mimir_customer_letters
 *
 * ВАЖНО (hotfix 30.05.2026): фича-флагов НЕТ. Никаких проверок
 * MIMIR_CONDUCTOR_ENABLED / ALLOWED_USERS здесь и нигде в коде. Доступ к
 * Conductor решается ролями на уровне роутов.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const crypto = require('crypto');
const db = require('../db');

/**
 * Стабильный sha256-хеш JSON-контента.
 * Ключи сортируются рекурсивно, чтобы одинаковый по смыслу объект давал
 * одинаковый хеш независимо от порядка полей (для дедупликации артефактов).
 */
function hashContent(content) {
  const canonical = _canonicalize(content);
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function _canonicalize(v) {
  if (Array.isArray(v)) return v.map(_canonicalize);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = _canonicalize(v[k]);
    return out;
  }
  return v;
}

// ─────────────────────────────────────────────────────────────────────────────
// Runs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Создать новый ConductorRun.
 * @param {Object} p
 * @param {number} [p.workId]
 * @param {number} [p.tenderId]
 * @param {number} [p.estimateId]
 * @param {number} [p.initiatedBy] — user_id
 * @param {string} [p.profile='STANDARD']
 * @param {number} [p.contractValue]
 * @param {Object} [p.complexityFlags={}]
 * @returns {Promise<{runId:number, status:string}>}
 */
async function createRun(p = {}) {
  const {
    workId = null, tenderId = null, estimateId = null,
    initiatedBy = null, profile = 'STANDARD',
    contractValue = null, complexityFlags = {}
  } = p;

  const res = await db.query(
    `INSERT INTO mimir_conductor_runs
       (work_id, tender_id, estimate_id, initiated_by, status, profile, contract_value, complexity_flags)
     VALUES ($1,$2,$3,$4,'DRAFT',$5,$6,$7)
     RETURNING id, status`,
    [workId, tenderId, estimateId, initiatedBy, profile, contractValue, JSON.stringify(complexityFlags)]
  );
  const row = res.rows[0];
  await addEvent(row.id, null, 'status_change', { from: null, to: 'DRAFT' });
  return { runId: row.id, status: row.status };
}

/** Получить run по id (или null). */
async function getRun(runId) {
  const res = await db.query('SELECT * FROM mimir_conductor_runs WHERE id = $1', [runId]);
  return res.rows[0] || null;
}

/**
 * Атомарно обновить статус run + записать событие status_change.
 * @param {number} runId
 * @param {string} status
 * @param {Object} [opts] — { blockedReason, blockedSince, conductorModel, completedAt:boolean,
 *                            finalArtifactHash, finalEstimateData }
 */
async function updateRunStatus(runId, status, opts = {}) {
  return db.transaction(async (client) => {
    const cur = await client.query('SELECT status FROM mimir_conductor_runs WHERE id = $1 FOR UPDATE', [runId]);
    if (!cur.rows[0]) throw new Error(`ConductorRun ${runId} not found`);
    const from = cur.rows[0].status;

    const sets = ['status = $2', 'updated_at = NOW()'];
    const vals = [runId, status];
    let i = 3;
    if (opts.blockedReason !== undefined) { sets.push(`blocked_reason = $${i++}`); vals.push(opts.blockedReason); }
    if (opts.blockedSince !== undefined) { sets.push(`blocked_since = $${i++}`); vals.push(opts.blockedSince); }
    if (opts.conductorModel !== undefined) { sets.push(`conductor_model = $${i++}`); vals.push(opts.conductorModel); }
    if (opts.finalArtifactHash !== undefined) { sets.push(`final_artifact_hash = $${i++}`); vals.push(opts.finalArtifactHash); }
    if (opts.finalEstimateData !== undefined) { sets.push(`final_estimate_data = $${i++}`); vals.push(JSON.stringify(opts.finalEstimateData)); }
    if (opts.completedAt) { sets.push('completed_at = NOW()'); }
    if (status && status.startsWith('BLOCKED_') && opts.blockedSince === undefined) { sets.push('blocked_since = NOW()'); }

    await client.query(`UPDATE mimir_conductor_runs SET ${sets.join(', ')} WHERE id = $1`, vals);
    // событие status_change — в той же транзакции
    await client.query(
      `INSERT INTO mimir_agent_events (conductor_run_id, agent_run_id, event_type, payload)
       VALUES ($1, NULL, 'status_change', $2)`,
      [runId, JSON.stringify({ from, to: status })]
    );
    return { runId, from, to: status };
  });
}

/** Прибавить метрики к run (токены, стоимость, длительность). */
async function bumpRunMetrics(runId, { inputTokens = 0, outputTokens = 0, costRub = 0, durationMs = 0 } = {}) {
  await db.query(
    `UPDATE mimir_conductor_runs
       SET total_input_tokens = total_input_tokens + $2,
           total_output_tokens = total_output_tokens + $3,
           total_cost_rub = total_cost_rub + $4,
           total_duration_ms = total_duration_ms + $5,
           updated_at = NOW()
     WHERE id = $1`,
    [runId, inputTokens, outputTokens, costRub, durationMs]
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent runs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Создать запись пробега агента.
 * @returns {Promise<number>} agentRunId
 */
async function startAgentRun(runId, { agentName, model, promptHash, agentVersion = 'v1', parentAgentRunId = null, inputArtifactHashes = [], inputExtra = null } = {}) {
  const res = await db.query(
    `INSERT INTO mimir_agent_runs
       (conductor_run_id, agent_name, agent_version, parent_agent_run_id, model, prompt_hash,
        input_artifact_hashes, input_extra, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'RUNNING')
     RETURNING id`,
    [runId, agentName, agentVersion, parentAgentRunId, model, promptHash || '',
     JSON.stringify(inputArtifactHashes), inputExtra ? JSON.stringify(inputExtra) : null]
  );
  return res.rows[0].id;
}

/** Завершить пробег агента (успех/ошибка) с метриками. */
async function finishAgentRun(agentRunId, { status = 'SUCCESS', outputArtifactId = null, outputSummary = null, errorText = null, errorCode = null, inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0, costRub = 0, durationMs = 0, iterations = 0 } = {}) {
  await db.query(
    `UPDATE mimir_agent_runs
       SET status=$2, output_artifact_id=$3, output_summary=$4, error_text=$5, error_code=$6,
           input_tokens=$7, output_tokens=$8, cache_read_tokens=$9, cache_write_tokens=$10,
           cost_rub=$11, duration_ms=$12, iterations=$13, completed_at=NOW()
     WHERE id=$1`,
    [agentRunId, status, outputArtifactId, outputSummary, errorText, errorCode,
     inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costRub, durationMs, iterations]
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Artifacts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Добавить артефакт. Хеширует content. При совпадении хеша с уже существующим
 * не-superseded артефактом того же типа — возвращает существующий (дедупликация).
 * @returns {Promise<{artifactId:number, contentHash:string, deduped:boolean}>}
 */
async function addArtifact(runId, agentRunId, type, content, schemaVersion = 'v1') {
  const contentHash = hashContent(content);

  // дедуп: тот же run + тот же hash
  const existing = await db.query(
    `SELECT id FROM mimir_artifacts WHERE conductor_run_id = $1 AND content_hash = $2 AND superseded_by IS NULL LIMIT 1`,
    [runId, contentHash]
  );
  if (existing.rows[0]) {
    return { artifactId: existing.rows[0].id, contentHash, deduped: true };
  }

  const res = await db.query(
    `INSERT INTO mimir_artifacts
       (conductor_run_id, created_by_agent_run_id, artifact_type, content, content_hash, schema_version)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id`,
    [runId, agentRunId, type, JSON.stringify(content), contentHash, schemaVersion]
  );
  const artifactId = res.rows[0].id;
  await addEvent(runId, agentRunId, 'artifact_emitted', { artifact_id: artifactId, artifact_type: type, content_hash: contentHash });
  return { artifactId, contentHash, deduped: false };
}

/**
 * Получить последний НЕ-superseded артефакт указанного типа для run (или null).
 */
async function getArtifact(runId, type) {
  const res = await db.query(
    `SELECT * FROM mimir_artifacts
     WHERE conductor_run_id = $1 AND artifact_type = $2 AND superseded_by IS NULL
     ORDER BY id DESC LIMIT 1`,
    [runId, type]
  );
  return res.rows[0] || null;
}

/** Пометить артефакт устаревшим (заменён новым). */
async function supersedeArtifact(oldArtifactId, newArtifactId) {
  await db.query('UPDATE mimir_artifacts SET superseded_by = $2 WHERE id = $1', [oldArtifactId, newArtifactId]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Events (append-only) — стримятся в War Room UI
// ─────────────────────────────────────────────────────────────────────────────

/** Записать событие (append-only). @returns {Promise<number>} eventId */
async function addEvent(runId, agentRunId, type, payload) {
  const res = await db.query(
    `INSERT INTO mimir_agent_events (conductor_run_id, agent_run_id, event_type, payload)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [runId, agentRunId, type, JSON.stringify(payload || {})]
  );
  return res.rows[0].id;
}

/**
 * Список событий run в порядке возрастания id.
 * @param {number} runId
 * @param {number} [sinceEventId=0] — вернуть события с id > sinceEventId (для SSE catch-up)
 * @param {number} [limit=1000]
 */
async function listEvents(runId, sinceEventId = 0, limit = 1000) {
  const res = await db.query(
    `SELECT id, conductor_run_id, agent_run_id, event_type, payload, ts
     FROM mimir_agent_events
     WHERE conductor_run_id = $1 AND id > $2
     ORDER BY id ASC LIMIT $3`,
    [runId, sinceEventId, limit]
  );
  return res.rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Запросы-агрегаты (Сессия 2): для hard-rules, лимитов и API
// ─────────────────────────────────────────────────────────────────────────────

/** Уникальные имена успешно завершённых агентов run. */
async function getCompletedAgents(runId) {
  const res = await db.query(
    `SELECT DISTINCT agent_name FROM mimir_agent_runs
     WHERE conductor_run_id = $1 AND status = 'SUCCESS'`,
    [runId]
  );
  return res.rows.map((r) => r.agent_name);
}

/** Текущая суммарная стоимость run в рублях (из агрегата на runs). */
async function getTotalCost(runId) {
  const res = await db.query('SELECT total_cost_rub FROM mimir_conductor_runs WHERE id = $1', [runId]);
  return Number(res.rows[0]?.total_cost_rub) || 0;
}

/** Открытые блокирующие уточнения run. */
async function getBlockingClarifications(runId) {
  const res = await db.query(
    `SELECT * FROM mimir_clarifications
     WHERE conductor_run_id = $1 AND blocking = TRUE AND status = 'OPEN'
     ORDER BY id ASC`,
    [runId]
  );
  return res.rows;
}

/** Полные детали run: сам run + дочерние agent_runs, artifacts, счётчик событий. */
async function getFullRunDetails(runId) {
  const run = await getRun(runId);
  if (!run) return null;
  const [agentRuns, artifacts, eventCount, clarifications] = await Promise.all([
    db.query('SELECT * FROM mimir_agent_runs WHERE conductor_run_id = $1 ORDER BY id ASC', [runId]),
    db.query('SELECT id, artifact_type, content_hash, superseded_by, created_at FROM mimir_artifacts WHERE conductor_run_id = $1 ORDER BY id ASC', [runId]),
    db.query('SELECT COUNT(*)::int AS n FROM mimir_agent_events WHERE conductor_run_id = $1', [runId]),
    db.query('SELECT * FROM mimir_clarifications WHERE conductor_run_id = $1 ORDER BY id ASC', [runId])
  ]);
  return {
    run,
    agent_runs: agentRuns.rows,
    artifacts: artifacts.rows,
    event_count: eventCount.rows[0]?.n || 0,
    clarifications: clarifications.rows
  };
}

/** Один артефакт по id (с полным content). */
async function getArtifactById(artifactId) {
  const res = await db.query('SELECT * FROM mimir_artifacts WHERE id = $1', [artifactId]);
  return res.rows[0] || null;
}

/**
 * Все актуальные (не superseded) артефакты run с полным content.
 * @returns {Promise<Array<{artifact_type, content, content_hash}>>}
 */
async function getAllArtifacts(runId) {
  const res = await db.query(
    `SELECT id, artifact_type, content, content_hash FROM mimir_artifacts
     WHERE conductor_run_id = $1 AND superseded_by IS NULL
     ORDER BY id ASC`,
    [runId]
  );
  return res.rows;
}

module.exports = {
  hashContent,
  // runs
  createRun, getRun, updateRunStatus, bumpRunMetrics,
  // agent runs
  startAgentRun, finishAgentRun,
  // artifacts
  addArtifact, getArtifact, supersedeArtifact, getArtifactById, getAllArtifacts,
  // events
  addEvent, listEvents,
  // aggregates (Сессия 2)
  getCompletedAgents, getTotalCost, getBlockingClarifications, getFullRunDetails
};
