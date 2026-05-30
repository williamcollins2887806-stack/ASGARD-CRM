/**
 * ASGARD CRM — Mimir Conductor: ядро agent loop (Сессия 6b — нативный tool-use)
 * ═══════════════════════════════════════════════════════════════════════════
 * Главный мозг просчёта. Запускается в фоне после POST /conductor/start.
 *
 * НАТИВНЫЙ TOOL-USE LOOP (Сессия 6b): Conductor сам решает каких агентов и в
 * каком порядке вызывать. На каждой итерации completeWithStream({tools}) возвращает
 * tool_uses; conductor.js их исполняет (executeTool), возвращает tool_results в
 * историю и продолжает loop, пока модель не вызовет emit_final_estimate.
 *
 *  • STUB (dev, по умолчанию): completeWithStream отдаёт детерминированный сценарий
 *    tool_uses (generateStubToolUses) — баланс не тратится. Логика loop одна и та же.
 *  • LIVE (живые ключи): реальный Claude через routerai сам выбирает инструменты.
 *
 * Hard-rules остаются ТОЛЬКО safety floor: canFinalize() проверяет полноту перед
 * emit_final_estimate. Они НЕ оркеструют вызовы — это делает Conductor.
 *
 * Fallback: при process.env.MIMIR_FORCE_DETERMINISTIC=true используется старый
 * детерминированный путь Сессии 2 (для дебага). UI/SSE одинаков в обоих режимах.
 *
 * Стейт живёт в БД (mimir_conductor_runs / agent_runs / artifacts / events),
 * переживает рестарты. Async: при ask_customer(blocking) run переходит в
 * BLOCKED_BY_CUSTOMER и Conductor завершает фоновую работу (продолжится позже).
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const db = require('../db');
const aiProvider = require('../ai-provider');
const cr = require('./conductor-run');
const REGISTRY = require('./agents-registry');
const hardRules = require('./hard-rules');
const { callAgent, executeTool, buildToolSchemas } = require('./tool-executor');
const { buildConductorSystemPrompt } = require('./prompts/conductor');
const { pickConductorModel } = require('./models-config');

const MAX_ITERATIONS = 30;
const MAX_RUN_COST_RUB = 800; // потолок стоимости одного просчёта (Сессия 6b)

/**
 * Собрать стартовый контекст: работа + метаданные документов.
 */
async function buildInitialContext(run) {
  let work = {};
  let documents = [];
  if (run.work_id) {
    const wr = await db.query(
      `SELECT id, work_title, customer_name, customer_inn, object_name, object_address,
              city, address, start_plan, end_plan, contract_value, tender_id, estimate_id, pm_id
       FROM works WHERE id = $1`,
      [run.work_id]
    );
    work = wr.rows[0] || {};
    // Метаданные документов работы/тендера (без содержимого — его читает парсер)
    try {
      const dr = await db.query(
        `SELECT id, file_name, file_type FROM documents
         WHERE (work_id = $1 OR tender_id = $2) AND (deleted_at IS NULL)
         ORDER BY id ASC LIMIT 200`,
        [run.work_id, work.tender_id || run.tender_id || null]
      );
      documents = dr.rows;
    } catch (_) { documents = []; }
  }

  const contractValue = run.contract_value != null
    ? Number(run.contract_value)
    : (work.contract_value != null ? Number(work.contract_value) : 0);

  return { work, documents, contract_value: contractValue };
}

/**
 * Грубая классификация сложности по tz_summary и контексту.
 * В Сессии 2 — простые эвристики; реальная классификация — в сессии 4.
 */
function classifyComplexity(tzSummary, ctx, runFlags = {}) {
  const flags = { ...(runFlags || {}) };
  const v = Number(ctx.contract_value) || 0;
  if (v >= 1000000) flags.risk_medium_plus = true;
  if ((ctx.documents || []).length > 0 && flags.has_drawings == null) {
    flags.has_drawings = (ctx.documents || []).some((d) => /чертеж|drawing|\.dwg/i.test(d.file_name || ''));
  }
  // tz_summary-сигналы (когда агент уже отработал и вернул содержимое)
  const s = tzSummary || {};
  if (s.has_volumes != null) flags.has_volumes = s.has_volumes;
  if (s.method) flags.method = s.method;
  return flags;
}

/**
 * Финализация просчёта.
 */
async function finalizeRun(runId, input = {}) {
  const finalData = {
    summary: input.executive_summary || input.summary || null,
    decision_reasoning: input.decision_reasoning || null,
    recommendation: input.recommendation || 'THINK',
    key_assumptions: input.key_assumptions || []
  };
  cr.addEvent(runId, null, 'final_estimate', finalData);
  await cr.updateRunStatus(runId, 'READY_FOR_REVIEW', { finalEstimateData: finalData, completedAt: true });
}

/**
 * Пауза в ожидании заказчика.
 */
async function pauseRunForCustomer(runId, clarificationResult) {
  cr.addEvent(runId, null, 'paused', { reason: 'awaiting_customer', clarification: clarificationResult });
  await cr.updateRunStatus(runId, 'BLOCKED_BY_CUSTOMER', {
    blockedReason: 'Ожидание ответа заказчика на блокирующее уточнение'
  });
}

/**
 * Главный прогон Conductor — нативный tool-use agent loop (Сессия 6b).
 *
 * Claude (или stub-сценарий) сам выбирает каких агентов и в каком порядке звать.
 * Hard-rules проверяются только перед emit_final_estimate (safety floor).
 *
 * @param {number} runId
 * @param {Object} [opts]
 */
async function runConductor(runId, opts = {}) {
  // Дебаг-fallback: старый детерминированный путь Сессии 2.
  if (process.env.MIMIR_FORCE_DETERMINISTIC === 'true') {
    return runConductorDeterministic(runId, opts);
  }

  const run = await cr.getRun(runId);
  if (!run) throw new Error(`ConductorRun ${runId} не найден`);

  const ctx = await buildInitialContext(run);

  // 1. Прелюдия: парсер документов + аналитик ТЗ (Conductor не работает без tz_summary).
  await cr.updateRunStatus(runId, 'RUNNING', {});
  await callAgent('document_parser', { documents: (ctx.documents || []).map((d) => d.id) }, runId);
  await callAgent('tz_analyst', { documents: (ctx.documents || []).map((d) => d.id), focus_areas: ['all'] }, runId);

  const tzArt = await cr.getArtifact(runId, 'tz_summary');
  const tzSummary = tzArt ? tzArt.content : null;

  // 2. Классификация сложности + выбор модели Conductor.
  const complexityFlags = classifyComplexity(tzSummary, ctx, run.complexity_flags);
  const conductorModel = pickConductorModel(ctx.contract_value);
  await cr.updateRunStatus(runId, 'RUNNING', { conductorModel });
  await db.query('UPDATE mimir_conductor_runs SET complexity_flags = $2 WHERE id = $1', [runId, JSON.stringify(complexityFlags)]);

  // 3. Agent_run для самого Conductor.
  const conductorAgentRunId = await cr.startAgentRun(runId, {
    agentName: 'conductor', model: conductorModel, promptHash: ''
  });

  // 4. Системный промпт + tools + stub-контекст.
  const required = hardRules.getRequiredAgents(tzSummary, ctx.contract_value, complexityFlags);
  const systemPrompt = buildConductorSystemPrompt(ctx, tzSummary, complexityFlags);
  const tools = buildToolSchemas(REGISTRY, required);
  const stubCtx = { complexity_flags: complexityFlags, contract_value: ctx.contract_value, required_agents: required };

  cr.addEvent(runId, conductorAgentRunId, 'mode', {
    stub: aiProvider.isStubMode(), conductor_model: conductorModel, required_agents: required
  });

  // 5. История диалога (Anthropic-формат: content-блоки).
  const messages = [{
    role: 'user',
    content: 'Начни работу по сборке сметы. Используй инструменты для вызова агентов. ' +
      'Перед emit_final_estimate убедись, что завершены обязательные агенты: ' +
      (required.length ? required.join(', ') : '(жёстких требований нет — действуй по ситуации)') + '.'
  }];

  // 6. Native tool-use loop.
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const result = await aiProvider.completeWithStream({
      system: systemPrompt,
      messages,
      model: conductorModel,
      tools,
      tool_choice: 'auto',
      stubCtx,
      onThought: (text) => cr.addEvent(runId, conductorAgentRunId, 'thought', { text }),
      onText: (text) => cr.addEvent(runId, conductorAgentRunId, 'conductor_message', { text }),
      onToolCall: (tu) => cr.addEvent(runId, conductorAgentRunId, 'tool_call', { tool: tu.name, input: tu.input })
    });

    // Записываем полный assistant-ответ (text + tool_use блоки) в историю.
    messages.push({ role: 'assistant', content: result.content_blocks || [] });

    const toolUses = result.tool_uses || [];

    // Conductor завершил без вызова инструмента — аномалия: подталкиваем к явному emit.
    if (result.stop_reason !== 'tool_use' || !toolUses.length) {
      messages.push({
        role: 'user',
        content: 'Ты завершил ход без вызова инструмента. Либо вызови нужного агента, ' +
          'либо emit_final_estimate (если все обязательные готовы).'
      });
      continue;
    }

    // Исполняем все tool_uses (параллельно — independent-агенты ускоряются).
    const toolResults = await Promise.all(
      toolUses.map((tu) => _runOneTool(tu, runId, conductorAgentRunId))
    );

    // ── Особый случай: ask_customer + blocking → пауза прогона.
    const blockingIdx = toolUses.findIndex(
      (tu) => tu.name === 'ask_customer' && tu.input && tu.input.blocking !== false
    );
    if (blockingIdx !== -1) {
      await pauseRunForCustomer(runId, toolResults[blockingIdx].raw);
      await cr.finishAgentRun(conductorAgentRunId, { status: 'SUCCESS', outputSummary: 'Пауза: ожидание заказчика' });
      return;
    }
    // Агент мог поднять блокирующее уточнение к заказчику сам (внутри callAgent).
    const agentBlocked = toolResults.find((tr) => tr.blockingCustomer);
    if (agentBlocked) {
      await pauseRunForCustomer(runId, agentBlocked.blockingCustomer);
      await cr.finishAgentRun(conductorAgentRunId, { status: 'SUCCESS', outputSummary: 'Пауза: ожидание заказчика' });
      return;
    }

    // ── Особый случай: emit_final_estimate → проверка canFinalize.
    const emitIdx = toolUses.findIndex((tu) => tu.name === 'emit_final_estimate');
    if (emitIdx !== -1) {
      const canFin = await hardRules.canFinalize(runId, ctx.contract_value, complexityFlags);
      if (canFin.ok) {
        await finalizeRun(runId, toolUses[emitIdx].input || {});
        await cr.finishAgentRun(conductorAgentRunId, {
          status: 'SUCCESS', outputSummary: 'Просчёт финализирован', durationMs: null
        });
        return;
      }
      // Hard-rules отклонили финал — возвращаем is_error, Conductor продолжит loop.
      toolResults[emitIdx] = {
        tool_use_id: toolUses[emitIdx].id,
        content: `ОТКАЗ финализации: ${canFin.reason}. Запусти недостающих агентов и попробуй снова.`,
        is_error: true
      };
      cr.addEvent(runId, conductorAgentRunId, 'warning', { text: `emit_final_estimate отклонён: ${canFin.reason}` });
    }

    // Возвращаем tool_results в историю.
    messages.push({
      role: 'user',
      content: toolResults.map((tr) => ({
        type: 'tool_result',
        tool_use_id: tr.tool_use_id,
        content: typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content),
        is_error: !!tr.is_error
      }))
    });

    // Safety: лимит стоимости.
    const totalCost = await cr.getTotalCost(runId);
    if (totalCost > MAX_RUN_COST_RUB) {
      cr.addEvent(runId, conductorAgentRunId, 'error', { text: `Лимит стоимости ${MAX_RUN_COST_RUB}₽ достигнут` });
      await cr.finishAgentRun(conductorAgentRunId, { status: 'ERROR', errorText: 'Cost limit exceeded' });
      throw new Error('Cost limit exceeded');
    }
  }

  await cr.finishAgentRun(conductorAgentRunId, { status: 'ERROR', errorText: `MAX_ITERATIONS=${MAX_ITERATIONS}` });
  throw new Error(`Conductor превысил MAX_ITERATIONS (${MAX_ITERATIONS})`);
}

/**
 * Исполнить один tool_use и привести результат к форме tool_result.
 * Возвращает { tool_use_id, content, is_error?, raw?, blockingCustomer? }.
 */
async function _runOneTool(toolUse, runId, conductorAgentRunId) {
  // emit_final_estimate обрабатывается в loop (canFinalize) — здесь только ack.
  if (toolUse.name === 'emit_final_estimate') {
    return { tool_use_id: toolUse.id, content: 'acknowledged', raw: { acknowledged: true } };
  }
  try {
    const res = await executeTool(toolUse, runId, conductorAgentRunId);
    // Блокирующее уточнение к заказчику, поднятое самим агентом.
    const blockingCustomer = (res.clarifications_raised || []).find(
      (c) => c.status === 'awaiting_customer_letter' && c.blocking
    );
    // Компактная сводка для модели (не весь артефакт).
    const summary = res.success === false
      ? `Ошибка: ${res.error}`
      : (res.summary || res.content || res.status || 'готово');
    return {
      tool_use_id: toolUse.id,
      content: typeof summary === 'string' ? summary : JSON.stringify(summary),
      is_error: res.success === false,
      raw: res,
      blockingCustomer: blockingCustomer || null
    };
  } catch (e) {
    return { tool_use_id: toolUse.id, content: `Ошибка инструмента: ${e.message}`, is_error: true };
  }
}

/**
 * СТАРЫЙ детерминированный путь (Сессия 2). Сохранён как fallback за env-флагом
 * MIMIR_FORCE_DETERMINISTIC=true для дебага. Не оркеструет через Claude — гоняет
 * обязательных агентов по hard-rules последовательно.
 */
async function runConductorDeterministic(runId, opts = {}) {
  const run = await cr.getRun(runId);
  if (!run) throw new Error(`ConductorRun ${runId} не найден`);

  const ctx = await buildInitialContext(run);

  await cr.updateRunStatus(runId, 'RUNNING', {});
  await callAgent('document_parser', { documents: (ctx.documents || []).map((d) => d.id) }, runId);
  await callAgent('tz_analyst', { documents: (ctx.documents || []).map((d) => d.id), focus_areas: ['all'] }, runId);

  const tzArt = await cr.getArtifact(runId, 'tz_summary');
  const tzSummary = tzArt ? tzArt.content : null;

  const complexityFlags = classifyComplexity(tzSummary, ctx, run.complexity_flags);
  const conductorModel = pickConductorModel(ctx.contract_value);
  await cr.updateRunStatus(runId, 'RUNNING', { conductorModel });
  await db.query('UPDATE mimir_conductor_runs SET complexity_flags = $2 WHERE id = $1', [runId, JSON.stringify(complexityFlags)]);

  const conductorAgentRunId = await cr.startAgentRun(runId, {
    agentName: 'conductor', model: conductorModel, promptHash: ''
  });

  const required = hardRules.getRequiredAgents(tzSummary, ctx.contract_value, complexityFlags);
  cr.addEvent(runId, conductorAgentRunId, 'mode', { stub: aiProvider.isStubMode(), conductor_model: conductorModel, required_agents: required, deterministic: true });

  let iteration = 0;
  const done = new Set(await cr.getCompletedAgents(runId));
  const queue = required.filter((a) => !done.has(a) && a !== 'tz_analyst');

  for (const agentName of queue) {
    if (++iteration > MAX_ITERATIONS) throw new Error(`Conductor превысил MAX_ITERATIONS (${MAX_ITERATIONS})`);
    await ensureDependencies(agentName, runId, conductorAgentRunId);
    const res = await executeTool({ name: `call_${agentName}`, input: {}, id: `auto-${agentName}` }, runId, conductorAgentRunId);
    const blockingCustomer = (res.clarifications_raised || []).find((c) => c.status === 'awaiting_customer_letter' && c.blocking);
    if (blockingCustomer) {
      await pauseRunForCustomer(runId, blockingCustomer);
      await cr.finishAgentRun(conductorAgentRunId, { status: 'SUCCESS', outputSummary: 'Пауза: ожидание заказчика' });
      return;
    }
    const totalCost = await cr.getTotalCost(runId);
    if (totalCost > MAX_RUN_COST_RUB) {
      cr.addEvent(runId, conductorAgentRunId, 'error', { text: `Лимит стоимости ${MAX_RUN_COST_RUB}₽ достигнут` });
      throw new Error('Cost limit exceeded');
    }
  }

  const finalCheck = await hardRules.canFinalize(runId, ctx.contract_value, complexityFlags);
  if (!finalCheck.ok) {
    cr.addEvent(runId, conductorAgentRunId, 'warning', { text: `Не готов к финалу: ${finalCheck.reason}` });
    await cr.updateRunStatus(runId, 'BLOCKED_BY_PM', { blockedReason: finalCheck.reason });
    await cr.finishAgentRun(conductorAgentRunId, { status: 'SUCCESS', outputSummary: finalCheck.reason });
    return;
  }

  const finalArt = await cr.getArtifact(runId, 'final_estimate');
  await finalizeRun(runId, {
    summary: finalArt?.content?.summary || 'Просчёт собран (детерминированный режим).',
    decision_reasoning: 'Детерминированная сборка обязательных артефактов по hard-rules.',
    recommendation: 'THINK',
    key_assumptions: ['Детерминированный fallback-режим.']
  });
  await cr.finishAgentRun(conductorAgentRunId, { status: 'SUCCESS', outputSummary: 'Просчёт финализирован' });
}

/**
 * Упрощённый разрешитель зависимостей: дотягивает недостающие requires_artifacts
 * агента, рекурсивно запуская их провайдеров. Только для Сессии 2 (моки).
 */
async function ensureDependencies(agentName, runId, conductorAgentRunId, depth = 0) {
  if (depth > 6) return; // защита от циклов
  const spec = REGISTRY[agentName];
  if (!spec) return;
  for (const at of spec.requires_artifacts || []) {
    const existing = await cr.getArtifact(runId, at);
    if (existing) continue;
    // Найти агента, который производит этот артефакт
    const providerName = Object.keys(REGISTRY).find(
      (k) => k !== 'agent' && REGISTRY[k].output_artifact_type === at
    );
    if (!providerName) continue;
    await ensureDependencies(providerName, runId, conductorAgentRunId, depth + 1);
    await executeTool({ name: `call_${providerName}`, input: {}, id: `dep-${providerName}` }, runId, conductorAgentRunId);
  }
}

module.exports = {
  runConductor,
  runConductorDeterministic,
  buildInitialContext,
  classifyComplexity,
  finalizeRun,
  pauseRunForCustomer,
  ensureDependencies,
  MAX_ITERATIONS,
  MAX_RUN_COST_RUB
};
