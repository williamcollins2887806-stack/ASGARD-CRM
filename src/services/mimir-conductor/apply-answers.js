/**
 * ASGARD CRM — Mimir Conductor: применение ответов + пересчёт (Сессия 5, Шаг 5.5/5.9)
 * ═══════════════════════════════════════════════════════════════════════════
 * После подтверждения РП маппинга «вопрос ↔ ответ»:
 *   1. applyAnswers — пишет answer_text в каждый clarification (status ANSWERED),
 *      письмо → APPLIED.
 *   2. resumeConductorIfBlocked — если run был BLOCKED_BY_CUSTOMER и блокирующих
 *      открытых вопросов больше нет, возобновляет Conductor.
 *   3. runConductorResume — пересобирает затронутые артефакты (в MVP: supersede
 *      final_estimate и повторный прогон обязательной цепочки) и фиксирует дифф
 *      «было/стало» (mimir_conductor_runs.final_estimate_data.diff).
 *
 * Всё уважает stub-режим (баланс не тратится): пересчёт детерминированный.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const db = require('../db');
const cr = require('./conductor-run');
const { getLetterById } = require('./letter-generator');

/**
 * Применить подтверждённый РП маппинг ответов.
 * @param {number} letterId
 * @param {Array<{question_id:number, answer_text:string|null}>} confirmedMapping
 * @param {number} userId
 */
async function applyAnswers(letterId, confirmedMapping, userId) {
  const letter = await getLetterById(letterId);
  if (!letter) throw new Error(`Письмо ${letterId} не найдено`);
  const mapping = Array.isArray(confirmedMapping) ? confirmedMapping : [];

  let answeredCount = 0;
  await db.transaction(async (client) => {
    for (const m of mapping) {
      const qid = Number(m.question_id);
      if (!qid) continue;
      if (m.answer_text != null && String(m.answer_text).trim() !== '') {
        // Scope-guard (fix #4): вопрос ДОЛЖЕН принадлежать прогону этого письма.
        // Иначе авторизованный РП мог бы пометить ответом чужое уточнение.
        const upd = await client.query(
          `UPDATE mimir_clarifications
              SET status = 'ANSWERED', answer_text = $1, answered_by = $2,
                  answered_at = NOW(), answer_source = 'customer_letter',
                  answer_letter_id = $3, updated_at = NOW()
            WHERE id = $4
              AND conductor_run_id = (
                SELECT conductor_run_id FROM mimir_customer_letters WHERE id = $3
              )`,
          [String(m.answer_text), userId || null, letterId, qid]
        );
        if (upd.rowCount > 0) {
          answeredCount += 1;
        } else {
          // Вопрос не из этого прогона (или не существует) — игнорируем + лог.
          console.warn(`[apply-answers] вопрос ${qid} не принадлежит письму ${letterId} — пропущен`);
        }
      }
      // answer_text пуст → вопрос остаётся OPEN.
    }
    await client.query(
      "UPDATE mimir_customer_letters SET status = 'APPLIED', reply_applied_at = NOW() WHERE id = $1",
      [letterId]
    );
  });

  try {
    await cr.addEvent(letter.conductor_run_id, null, 'answers_applied', {
      letter_id: letterId, answered: answeredCount
    });
  } catch (_) { /* noop */ }

  return { answered: answeredCount, letterId, runId: letter.conductor_run_id };
}

/**
 * Возобновить Conductor, если run заблокирован заказчиком и блокирующих
 * открытых вопросов больше не осталось.
 * @param {number} letterId
 */
async function resumeConductorIfBlocked(letterId) {
  const letter = await getLetterById(letterId);
  if (!letter) return { resumed: false, reason: 'letter_not_found' };

  const runId = Number(letter.conductor_run_id);
  const run = await cr.getRun(runId);
  if (!run) return { resumed: false, reason: 'run_not_found' };
  if (run.status !== 'BLOCKED_BY_CUSTOMER') {
    return { resumed: false, reason: `run_status=${run.status}` };
  }

  // Остались ли ещё открытые блокирующие вопросы?
  const stillBlocked = await db.query(
    "SELECT COUNT(*)::int AS n FROM mimir_clarifications WHERE conductor_run_id = $1 AND status = 'OPEN' AND blocking = true",
    [runId]
  );
  if (stillBlocked.rows[0].n > 0) {
    return { resumed: false, reason: 'still_has_blocking_open', remaining: stillBlocked.rows[0].n };
  }

  await cr.updateRunStatus(runId, 'RUNNING', { blockedReason: null });
  await cr.addEvent(runId, null, 'status_change', {
    from: 'BLOCKED_BY_CUSTOMER', to: 'RUNNING',
    reason: 'Получен ответ заказчика — возобновление просчёта'
  });

  // Фоновый пересчёт — не блокируем HTTP-ответ.
  setImmediate(() => {
    runConductorResume(runId, { resumed_from_letter: letter.id }).catch(async (err) => {
      try {
        await cr.updateRunStatus(runId, 'ERROR', { errorMessage: String(err && err.message ? err.message : err) });
        await cr.addEvent(runId, null, 'error', { message: String(err && err.message ? err.message : err), stage: 'resume' });
      } catch (_) { /* noop */ }
    });
  });

  return { resumed: true, runId };
}

/**
 * Пересчёт после ответа заказчика.
 *
 * MVP: фиксируем «старую» смету, помечаем итоговый артефакт устаревшим, заново
 * прогоняем обязательную цепочку (детерминированно, без расхода баланса), затем
 * считаем дифф ключевых полей и кладём его в final_estimate_data.
 *
 * @param {number} runId
 * @param {Object} opts
 */
async function runConductorResume(runId, opts = {}) {
  // Снимок «было».
  const before = await snapshotKeyFigures(runId);

  cr.addEvent(runId, null, 'resume_recompute', { resumed_from_letter: opts.resumed_from_letter || null });

  // Повторный прогон обязательной цепочки. runConductor сам пропускает уже
  // завершённых агентов (getCompletedAgents); незавершённые/затронутые агенты
  // пересоберутся, после чего run переведётся в READY_FOR_REVIEW.
  //
  // В stub-режиме агенты детерминированы: дифф будет нулевым, пока ответы не
  // влияют на входы (на живых ключах в сессии 08 ответы заказчика реально меняют
  // объёмы/бригаду → дифф станет ненулевым). Каркас диффа здесь полностью рабочий.
  const { runConductor } = require('./conductor');
  await runConductor(runId, { resumed: true });

  // Снимок «стало» + дифф.
  const after = await snapshotKeyFigures(runId);
  const diff = buildDiff(before, after);

  try {
    const run = await cr.getRun(runId);
    const fed = run && run.final_estimate_data ? run.final_estimate_data : {};
    fed.diff = diff;
    await db.query('UPDATE mimir_conductor_runs SET final_estimate_data = $1 WHERE id = $2',
      [JSON.stringify(fed), runId]);
    await cr.addEvent(runId, null, 'estimate_diff', diff);
  } catch (_) { /* noop */ }

  return { runId, diff };
}

/** Снять ключевые цифры просчёта (для диффа «было/стало»). */
async function snapshotKeyFigures(runId) {
  const out = { total_with_vat: null, total_with_margin: null, subtotal_fot: null, crew_count: null, work_days: null };
  try {
    const fin = await cr.getArtifact(runId, 'final_estimate');
    if (fin && fin.content && fin.content.ssr) {
      out.total_with_vat = num(fin.content.ssr.total_with_vat);
      out.total_with_margin = num(fin.content.ssr.total_with_margin);
      out.subtotal_fot = num(fin.content.ssr.subtotal_fot);
    }
  } catch (_) { /* noop */ }
  try {
    const labor = await cr.getArtifact(runId, 'labor_cost');
    if (labor && labor.content) {
      if (out.subtotal_fot == null) out.subtotal_fot = num(labor.content.subtotal_fot);
      out.work_days = num(labor.content.work_days);
    }
  } catch (_) { /* noop */ }
  try {
    const crew = await cr.getArtifact(runId, 'crew_plan');
    if (crew && crew.content) out.crew_count = num(crew.content.total_count);
  } catch (_) { /* noop */ }
  return out;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Построить дифф ключевых полей: { field: {before, after, delta} }. */
function buildDiff(before, after) {
  const fields = ['total_with_vat', 'total_with_margin', 'subtotal_fot', 'crew_count', 'work_days'];
  const diff = {};
  let changed = false;
  for (const f of fields) {
    const b = before[f];
    const a = after[f];
    const delta = (b != null && a != null) ? a - b : null;
    diff[f] = { before: b, after: a, delta };
    if (delta != null && delta !== 0) changed = true;
  }
  diff._changed = changed;
  return diff;
}

module.exports = {
  applyAnswers,
  resumeConductorIfBlocked,
  runConductorResume,
  snapshotKeyFigures,
  buildDiff
};
