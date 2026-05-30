/**
 * ASGARD CRM — Mimir Conductor: ядро agent loop (Сессия 2, Шаг 2.3)
 * ═══════════════════════════════════════════════════════════════════════════
 * Главный мозг просчёта. Запускается в фоне после POST /conductor/start.
 *
 * ДВА ПУТИ (по ai-provider.isStubMode()):
 *  • STUB (dev, по умолчанию — баланс не тратится): Conductor детерминированно
 *    оркеструет агентов по hard-rules (прелюдия → обязательные агенты → финал),
 *    параллельно прогоняя completeWithStream для генерации потока «мыслей» в
 *    War Room. Это рабочий dev-режим Сессии 2 — НЕ заглушка вместо логики.
 *  • LIVE (живые ключи, включается в сессии 08): тот же детерминированный
 *    safety-каркас + поток мыслей реальной модели. Полноценный самостоятельный
 *    tool-use loop (модель сама выбирает инструменты) — TODO сессии 08, когда
 *    completeWithStream научится возвращать tool_use блоки и пополнят баланс.
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

const MAX_ITERATIONS = 20;
const MAX_RUN_COST_RUB = 5000; // потолок стоимости одного просчёта

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
async function finalizeRun(runId, input) {
  const finalData = {
    summary: input.summary || null,
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
 * Главный прогон Conductor.
 * @param {number} runId
 * @param {Object} [opts]
 */
async function runConductor(runId, opts = {}) {
  const run = await cr.getRun(runId);
  if (!run) throw new Error(`ConductorRun ${runId} не найден`);

  const ctx = await buildInitialContext(run);

  // 1. Прелюдия: парсер документов + аналитик ТЗ (без Conductor — ему нужен tz_summary)
  await cr.updateRunStatus(runId, 'RUNNING', {});
  await callAgent('document_parser', { documents: (ctx.documents || []).map((d) => d.id) }, runId);
  await callAgent('tz_analyst', { documents: (ctx.documents || []).map((d) => d.id), focus_areas: ['all'] }, runId);

  const tzArt = await cr.getArtifact(runId, 'tz_summary');
  const tzSummary = tzArt ? tzArt.content : null;

  // 2. Классификация сложности + выбор модели Conductor
  const complexityFlags = classifyComplexity(tzSummary, ctx, run.complexity_flags);
  const conductorModel = pickConductorModel(ctx.contract_value);
  await cr.updateRunStatus(runId, 'RUNNING', { conductorModel });
  await db.query('UPDATE mimir_conductor_runs SET complexity_flags = $2 WHERE id = $1', [runId, JSON.stringify(complexityFlags)]);

  // 3. Создаём agent_run для самого Conductor
  const conductorAgentRunId = await cr.startAgentRun(runId, {
    agentName: 'conductor', model: conductorModel, promptHash: ''
  });

  // 4. Системный промпт + tools
  const required = hardRules.getRequiredAgents(tzSummary, ctx.contract_value, complexityFlags);
  const systemPrompt = buildConductorSystemPrompt(ctx, tzSummary, complexityFlags);
  const tools = buildToolSchemas(REGISTRY, required);

  // Поток «мыслей» Conductor в War Room (в stub — синтетический; на живых ключах — реальный)
  const emitThoughts = async (userMessage) => {
    try {
      await aiProvider.completeWithStream({
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        model: conductorModel,
        tools,
        onThought: (text) => cr.addEvent(runId, conductorAgentRunId, 'thought', { text }),
        onText: (text) => cr.addEvent(runId, conductorAgentRunId, 'conductor_message', { text })
      });
    } catch (e) {
      // Поток мыслей не критичен для оркестрации — логируем, но не валим прогон
      cr.addEvent(runId, conductorAgentRunId, 'warning', { text: `Поток мыслей недоступен: ${e.message}` });
    }
  };

  await emitThoughts('Начни работу по сборке сметы. Опиши план: каких агентов и в каком порядке запустишь.');

  // 5. Оркестрация. Safety-каркас детерминирован (hard-rules) в ОБОИХ режимах.
  //    Самостоятельный tool-use loop модели — TODO сессии 08 (нужен tool_use в
  //    completeWithStream + баланс). Сейчас Conductor как главный инженер
  //    последовательно выполняет обязательную программу агентов.
  const stub = aiProvider.isStubMode();
  cr.addEvent(runId, conductorAgentRunId, 'mode', { stub, conductor_model: conductorModel, required_agents: required });

  let iteration = 0;
  // Очередь обязательных агентов, исключая уже отработавшую прелюдию
  const done = new Set(await cr.getCompletedAgents(runId));
  const queue = required.filter((a) => !done.has(a) && a !== 'tz_analyst');

  for (const agentName of queue) {
    if (++iteration > MAX_ITERATIONS) {
      throw new Error(`Conductor превысил MAX_ITERATIONS (${MAX_ITERATIONS})`);
    }

    // Проверяем зависимости агента: если не хватает требуемых артефактов —
    // дотягиваем их (упрощённый разрешитель зависимостей для Сессии 2).
    await ensureDependencies(agentName, runId, conductorAgentRunId);

    const toolUse = { name: `call_${agentName}`, input: {}, id: `auto-${agentName}` };
    const res = await executeTool(toolUse, runId, conductorAgentRunId);

    // Если агент поднял блокирующее уточнение к заказчику — пауза
    const blockingCustomer = (res.clarifications_raised || []).find(
      (c) => c.status === 'awaiting_customer_letter' && c.blocking
    );
    if (blockingCustomer) {
      await pauseRunForCustomer(runId, blockingCustomer);
      await cr.finishAgentRun(conductorAgentRunId, { status: 'SUCCESS', outputSummary: 'Пауза: ожидание заказчика' });
      return;
    }

    // Safety: лимит стоимости
    const totalCost = await cr.getTotalCost(runId);
    if (totalCost > MAX_RUN_COST_RUB) {
      cr.addEvent(runId, conductorAgentRunId, 'error', { text: `Лимит стоимости ${MAX_RUN_COST_RUB}₽ достигнут` });
      throw new Error('Cost limit exceeded');
    }
  }

  // 6. Проверка готовности к финалу
  const finalCheck = await hardRules.canFinalize(runId, ctx.contract_value, complexityFlags);
  if (!finalCheck.ok) {
    cr.addEvent(runId, conductorAgentRunId, 'warning', { text: `Не готов к финалу: ${finalCheck.reason}` });
    // В Сессии 2 (моки уточнений не поднимают) этого не должно случиться; если
    // случилось — фиксируем как блокировку, а не падаем.
    await cr.updateRunStatus(runId, 'BLOCKED_BY_PM', { blockedReason: finalCheck.reason });
    await cr.finishAgentRun(conductorAgentRunId, { status: 'SUCCESS', outputSummary: finalCheck.reason });
    return;
  }

  await emitThoughts('Все обязательные агенты завершены. Сформулируй финальное резюме и рекомендацию.');

  // 7. Финал
  const finalArt = await cr.getArtifact(runId, 'final_estimate');
  await finalizeRun(runId, {
    summary: finalArt?.content?.summary || 'Просчёт собран (stub-режим, агенты — моки).',
    decision_reasoning: 'Автоматическая сборка обязательных артефактов по hard-rules.',
    recommendation: 'THINK',
    key_assumptions: ['Сессия 2: агенты заменены моками, цифры демонстрационные.']
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
  buildInitialContext,
  classifyComplexity,
  finalizeRun,
  pauseRunForCustomer,
  ensureDependencies,
  MAX_ITERATIONS,
  MAX_RUN_COST_RUB
};
