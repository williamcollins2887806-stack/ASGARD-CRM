/**
 * ASGARD CRM — Mimir Conductor: ДЕТЕРМИНИРОВАННЫЙ ОРКЕСТРАТОР
 * ═══════════════════════════════════════════════════════════════════════════
 * Идёт по фиксированной цепочке из 7 этапов. Заменяет LLM-loop Conductor.
 * Без вариативности → повторяемые прогоны → готов для production smoke-теста.
 *
 * UI видит чёткий прогресс: «Шаг X/N: agent_name» (event stage_step).
 *
 * Каждый шаг:
 *   • Проверяет зависимости (skip если артефакта-входа нет и required=false)
 *   • Вызывает агента через callAgent
 *   • Логирует stage/step/agent_name в war-room
 *   • На ERROR — если required=true, run → ERROR; если required=false, идём дальше
 *
 * Включается переменной MIMIR_DETERMINISTIC=true (или mode='deterministic' в start).
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

const db = require('../db');
const cr = require('./conductor-run');
const { callAgent } = require('./tool-executor');
const { RUN_SEMAPHORE } = require('./semaphore');

// Каноническая цепочка для production. Меняется только при добавлении агентов.
// Каждый шаг: { stage, step, agent, required, condition?(ctx)→bool }
const PIPELINE = [
  // ЭТАП 1: ПОНИМАНИЕ ТЗ (work_scope ДО tz_analyst, т.к. tz_analyst требует work_scope_research)
  { stage: 1, step: 1, agent: 'document_parser', required: true },
  { stage: 1, step: 2, agent: 'work_scope_researcher', required: true },
  { stage: 1, step: 3, agent: 'tz_analyst', required: true },

  // ЭТАП 2: ИССЛЕДОВАНИЕ
  { stage: 2, step: 4, agent: 'historical_comparator', required: true },
  { stage: 2, step: 5, agent: 'gatekeeper', required: false },

  // ЭТАП 3: РЕСУРСЫ
  { stage: 3, step: 6, agent: 'warehouse_matcher', required: false },
  { stage: 3, step: 7, agent: 'resource_planner', required: true },
  { stage: 3, step: 8, agent: 'crew_composer', required: true },

  // ЭТАП 4: ЗАКУПКИ + ЛОГИСТИКА
  { stage: 4, step: 9, agent: 'market_search', required: false },
  { stage: 4, step: 10, agent: 'procurement_analyzer', required: false },
  { stage: 4, step: 11, agent: 'routing_planner', required: false },
  { stage: 4, step: 12, agent: 'travel_pricer', required: false },

  // ЭТАП 5: ДОПУСКИ + УСЛОВИЯ
  { stage: 5, step: 13, agent: 'permits_planner', required: false },
  { stage: 5, step: 14, agent: 'marine_permits', required: false, condition: (ctx) => !!(ctx.complexity_flags && ctx.complexity_flags.has_MLSP) },
  { stage: 5, step: 15, agent: 'site_conditions', required: true },
  { stage: 5, step: 16, agent: 'norms_compliance', required: false },

  // ЭТАП 5b: РЕЗОЛВ СТАВОК (rates_researcher — 4 источника: каталог/эталоны/RAG/web)
  // Закрывает дыру, из-за которой labor/consumables упирались в BLOCKING
  { stage: 5, step: 16, agent: 'rates_researcher', required: false },

  // ЭТАП 6: РАСЧЁТ ССР
  { stage: 6, step: 17, agent: 'labor_calculator', required: true },
  { stage: 6, step: 18, agent: 'consumables_calculator', required: false },
  { stage: 6, step: 19, agent: 'quality_control_planner', required: false, condition: (ctx) => !!(ctx.complexity_flags && (ctx.complexity_flags.has_welding || ctx.complexity_flags.has_assembly)) },
  { stage: 6, step: 20, agent: 'executive_docs_planner', required: false },
  { stage: 6, step: 21, agent: 'indirects_calculator', required: true },
  { stage: 6, step: 22, agent: 'pre_mob_calculator', required: false },
  { stage: 6, step: 23, agent: 'standby_estimator', required: false },
  { stage: 6, step: 24, agent: 'warranty_reserve', required: false },

  // ЭТАП 7: КРИТИКА + ФИНАЛ
  { stage: 7, step: 25, agent: 'method_validator', required: false },
  { stage: 7, step: 26, agent: 'risk_quantifier', required: false, condition: (ctx) => Number(ctx.contract_value) > 30000000 },
  { stage: 7, step: 27, agent: 'financial_modeler', required: false, condition: (ctx) => Number(ctx.contract_value) > 50000000 },
  { stage: 7, step: 28, agent: 'devils_advocate', required: false, condition: (ctx) => Number(ctx.contract_value) > 50000000 },
  { stage: 7, step: 29, agent: 'final_consolidator', required: true }
];

const STAGE_NAMES = {
  1: 'Понимание ТЗ',
  2: 'Исследование рынка/методик',
  3: 'Подбор ресурсов',
  4: 'Закупки + логистика',
  5: 'Допуски + условия',
  6: 'Расчёт ССР',
  7: 'Критика + финал'
};

async function runDeterministic(runId, opts = {}) {
  if (RUN_SEMAPHORE.active >= RUN_SEMAPHORE.max) {
    const s = RUN_SEMAPHORE.status();
    await cr.updateRunStatus(runId, 'WAITING_FOR_SLOT', { reason: `Очередь: впереди ${s.active + s.queued} просчётов` });
    cr.addEvent(runId, null, 'queue_wait', { semaphore: s, message: 'Жду свободного слота' });
  }
  await RUN_SEMAPHORE.acquire();
  try {
    return await _runDeterministicCore(runId, opts);
  } finally {
    RUN_SEMAPHORE.release();
  }
}

async function _runDeterministicCore(runId, opts = {}) {
  const run = await cr.getRun(runId);
  if (!run) throw new Error(`ConductorRun ${runId} не найден`);

  // Контекст: contract_value + complexity_flags + work/tender
  const ctx = {
    contract_value: run.contract_value || 0,
    complexity_flags: run.complexity_flags || {}
  };

  await cr.updateRunStatus(runId, 'RUNNING', { conductorModel: 'deterministic' });
  cr.addEvent(runId, null, 'mode', {
    stub: false,
    conductor_model: 'deterministic',
    pipeline_steps: PIPELINE.length,
    contract_value: ctx.contract_value,
    complexity_flags: ctx.complexity_flags
  });

  const TOTAL_STEPS = PIPELINE.length;
  let successCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const node of PIPELINE) {
    // Условие пропуска по флагам
    if (node.condition && !node.condition(ctx)) {
      cr.addEvent(runId, null, 'stage_step', {
        stage: node.stage, stage_name: STAGE_NAMES[node.stage],
        step: node.step, total: TOTAL_STEPS,
        agent_name: node.agent, status: 'skipped_by_condition',
        message: `Пропущен (не подходит к контракту/флагам)`
      });
      skippedCount++;
      continue;
    }

    // Проверим — нужно ли вызывать. Берём из spec requires_artifacts, что должно быть.
    // Если зависимости нет — пропускаем (не блокируем).
    let canRun = true;
    let missingDep = null;
    try {
      const { REGISTRY } = require('./agents-registry');
      const spec = REGISTRY[node.agent];
      if (spec && Array.isArray(spec.requires_artifacts)) {
        for (const reqArt of spec.requires_artifacts) {
          const a = await cr.getArtifact(runId, reqArt);
          if (!a) { canRun = false; missingDep = reqArt; break; }
        }
      }
    } catch (_) { /* spec может быть не найден; продолжим */ }

    if (!canRun) {
      cr.addEvent(runId, null, 'stage_step', {
        stage: node.stage, stage_name: STAGE_NAMES[node.stage],
        step: node.step, total: TOTAL_STEPS,
        agent_name: node.agent, status: 'skipped_missing_dep',
        message: `Пропущен — нет артефакта-входа: ${missingDep}`
      });
      skippedCount++;
      if (node.required) {
        await cr.updateRunStatus(runId, 'ERROR', {
          blocked_reason: `Обязательный шаг ${node.step} (${node.agent}) пропущен — нет ${missingDep}`
        });
        return { ok: false, error: `required_step_missing_dep: ${node.agent} → ${missingDep}` };
      }
      continue;
    }

    cr.addEvent(runId, null, 'stage_step', {
      stage: node.stage, stage_name: STAGE_NAMES[node.stage],
      step: node.step, total: TOTAL_STEPS,
      agent_name: node.agent, status: 'starting',
      message: `Этап ${node.stage} «${STAGE_NAMES[node.stage]}» — Шаг ${node.step}/${TOTAL_STEPS}: ${node.agent}`
    });

    // Hard-timeout: 14 мин для required, 4 мин для опциональных (травел/сайт_акцесс — не блокируют ССР).
    // Без этого pipeline зависает на Promise если sweeper пометил БД но fetch ждёт.
    const AGENT_HARD_TIMEOUT_MS = node.required ? 14 * 60 * 1000 : 4 * 60 * 1000;
    let res;
    try {
      res = await Promise.race([
        callAgent(node.agent, {}, runId, null),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`agent_hard_timeout_${AGENT_HARD_TIMEOUT_MS / 60000}min`)), AGENT_HARD_TIMEOUT_MS))
      ]);
    } catch (e) {
      res = { success: false, error: e.message };
    }

    if (res && res.success) {
      successCount++;
      cr.addEvent(runId, null, 'stage_step', {
        stage: node.stage, stage_name: STAGE_NAMES[node.stage],
        step: node.step, total: TOTAL_STEPS,
        agent_name: node.agent, status: 'success',
        artifact_id: res.artifact_id, summary: res.summary
      });
    } else {
      errorCount++;
      cr.addEvent(runId, null, 'stage_step', {
        stage: node.stage, stage_name: STAGE_NAMES[node.stage],
        step: node.step, total: TOTAL_STEPS,
        agent_name: node.agent, status: 'error',
        error: res ? res.error : 'unknown'
      });
      if (node.required) {
        await cr.updateRunStatus(runId, 'ERROR', {
          blocked_reason: `Обязательный шаг ${node.step} (${node.agent}) упал: ${res ? res.error : 'unknown'}`
        });
        return { ok: false, error: `required_step_failed: ${node.agent}` };
      }
      // optional — продолжаем
    }
  }

  // Финал: проверяем что у нас есть final_estimate
  const finalArt = await cr.getArtifact(runId, 'final_estimate');
  if (finalArt) {
    await cr.updateRunStatus(runId, 'READY_FOR_REVIEW', {});
    cr.addEvent(runId, null, 'mode', {
      message: `Pipeline завершён: success=${successCount}, skipped=${skippedCount}, errors=${errorCount}/${TOTAL_STEPS}`,
      final_estimate_artifact_id: finalArt.id
    });
    // Опус-фикс 20.06.2026: в LLM-режиме генерация смет+отчёта вызывается из finalizeRun;
    // в детерминированном — её не было. Добавляем здесь, иначе manual_documents
    // не пополняются и фронт не показывает сметы/отчёты Conductor.
    try {
      const { _generateConductorArtifacts } = require('./conductor');
      const final = (finalArt.content && (finalArt.content.ssr || finalArt.content)) || {};
      const finalData = {
        summary: final.summary || final.executive_summary || null,
        decision_reasoning: final.decision_reasoning || null,
        recommendation: final.recommendation || 'THINK',
        key_assumptions: final.key_assumptions || []
      };
      await _generateConductorArtifacts(runId, finalData);
      cr.addEvent(runId, null, 'mode', { message: 'Артефакты (смета+отчёт) сохранены в manual_documents' });
    } catch (e) {
      console.warn(`[deterministic-conductor] generateArtifacts failed for run ${runId}: ${e.message}`);
      cr.addEvent(runId, null, 'warning', { text: `Артефакты не сгенерировались: ${e.message}` });
    }
    return { ok: true, success: successCount, skipped: skippedCount, errors: errorCount, total: TOTAL_STEPS };
  } else {
    await cr.updateRunStatus(runId, 'ERROR', { blocked_reason: 'Pipeline завершён, но final_estimate не создан' });
    return { ok: false, error: 'no_final_estimate' };
  }
}

module.exports = { runDeterministic, PIPELINE, STAGE_NAMES };
