/**
 * ASGARD CRM — Сессия 4: интеграционный прогон 5 ядерных агентов.
 * ═══════════════════════════════════════════════════════════════════════════
 * Запускает runConductor по реальному тендеру в stub-режиме (баланс НЕ
 * тратится) и проверяет, что цепочка ядерных агентов отработала end-to-end:
 *   document_parser → tz_analyst → (resource_planner mock) → crew_composer →
 *   labor_calculator → (indirects mock) → final_consolidator → READY_FOR_REVIEW
 *
 * Проверки:
 *  • isStubMode() === true (предохранитель: денег не тратим)
 *  • прогон дошёл до READY_FOR_REVIEW
 *  • завершены все 5 ядерных агентов (SUCCESS)
 *  • есть артефакты parsed_documents, tz_summary, crew_plan, labor_cost, final_estimate
 *  • final_estimate.content.ssr содержит total_with_vat (число > 0 при наличии ФОТ)
 *  • labor_cost даёт subtotal_fot и personnel[]
 *  • crew_plan даёт непустой состав
 *
 * Чистит за собой (DELETE FROM mimir_conductor_runs WHERE id=$1 — cascade).
 *
 * Запуск: node tests/integration/mimir-conductor-core-agents.test.js
 *         (есть и jest-обёртка ниже).
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

require('dotenv').config();

const db = require('../../src/services/db');
const aiProvider = require('../../src/services/ai-provider');
const cr = require('../../src/services/mimir-conductor/conductor-run');
const { runConductor } = require('../../src/services/mimir-conductor/conductor');

const CORE_AGENTS = ['document_parser', 'tz_analyst', 'crew_composer', 'labor_calculator', 'final_consolidator'];
const REQUIRED_ARTIFACTS = ['parsed_documents', 'tz_summary', 'crew_plan', 'labor_cost', 'final_estimate'];

async function pickTenderId() {
  const r = await db.query('SELECT id FROM tenders ORDER BY id DESC LIMIT 1');
  return r.rows[0] ? r.rows[0].id : null;
}

async function runScenario() {
  const results = [];
  const ok = (name, cond) => { results.push({ name, ok: !!cond }); };

  // Предохранитель: только stub-режим
  await aiProvider.completeWithStream({ system: '', messages: [{ role: 'user', content: 'x' }], model: 'sonnet-4-6', onThought: () => {}, onText: () => {} });
  ok('isStubMode() === true (баланс не тратим)', aiProvider.isStubMode() === true);
  if (!aiProvider.isStubMode()) {
    throw new Error('НЕ stub-режим: тест остановлен, чтобы не тратить баланс');
  }

  const tenderId = await pickTenderId();
  ok('найден тестовый тендер в dev-БД', tenderId != null);

  const run = await cr.createRun({
    tenderId,
    initiatedBy: 1,
    profile: 'STANDARD',
    contractValue: 8000000
  });
  const runId = run.runId;

  try {
    await runConductor(runId);

    const finalRun = await cr.getRun(runId);
    ok('прогон дошёл до READY_FOR_REVIEW', finalRun && finalRun.status === 'READY_FOR_REVIEW');

    const completed = await cr.getCompletedAgents(runId);
    for (const a of CORE_AGENTS) {
      ok(`агент ${a} завершён (SUCCESS)`, completed.includes(a));
    }

    for (const t of REQUIRED_ARTIFACTS) {
      const art = await cr.getArtifact(runId, t);
      ok(`артефакт ${t} создан`, !!art);
    }

    // Содержимое ключевых артефактов
    const crewArt = await cr.getArtifact(runId, 'crew_plan');
    ok('crew_plan: непустой состав', crewArt && Array.isArray(crewArt.content.crew) && crewArt.content.crew.length >= 1);

    const laborArt = await cr.getArtifact(runId, 'labor_cost');
    ok('labor_cost: есть personnel[] и subtotal_fot', laborArt && Array.isArray(laborArt.content.personnel) && laborArt.content.personnel.length >= 1 && typeof laborArt.content.subtotal_fot === 'number');

    const finalArt = await cr.getArtifact(runId, 'final_estimate');
    const ssr = finalArt && finalArt.content ? finalArt.content.ssr : null;
    ok('final_estimate: ssr.total_with_vat — число', ssr && typeof ssr.total_with_vat === 'number');
    ok('final_estimate: recommendation задан', finalArt && finalArt.content && !!finalArt.content.recommendation);
  } finally {
    await db.query('DELETE FROM mimir_conductor_runs WHERE id = $1', [runId]);
  }

  return results;
}

// ── Standalone node runner ───────────────────────────────────────────────────
async function main() {
  let results;
  try {
    results = await runScenario();
  } catch (e) {
    console.error('❌ Тест упал:', e.message);
    try { await db.end(); } catch (_) { /* noop */ }
    process.exit(1);
  }
  results.forEach((r) => console.log(`${r.ok ? '✅' : '❌'} ${r.name}`));
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `\n❌ ${failed.length} провалено` : `\n✅ Все ${results.length} проверок прошли`);
  try { await db.end(); } catch (_) { /* noop */ }
  process.exit(failed.length ? 1 : 0);
}

// ── Jest-обёртка (если запущено через jest) ──────────────────────────────────
if (typeof describe === 'function') {
  describe('Mimir Conductor — 5 ядерных агентов (stub)', () => {
    let results;
    beforeAll(async () => { results = await runScenario(); });
    afterAll(async () => { try { await db.end(); } catch (_) { /* noop */ } });
    test('все проверки прошли', () => {
      const failed = results.filter((r) => !r.ok).map((r) => r.name);
      expect(failed).toEqual([]);
    });
  });
} else {
  main();
}
