/**
 * ASGARD CRM — Mimir Conductor: Tool execution layer (Сессия 2, Шаг 2.5)
 * ═══════════════════════════════════════════════════════════════════════════
 * Выполняет инструменты, которые вызывает Conductor:
 *   call_<agent>             → запуск специализированного агента
 *   ask_pm / ask_customer    → поднять уточнение (clarification)
 *   read_artifact            → прочитать готовый артефакт
 *   request_devils_advocate_review → запустить адвоката дьявола
 *   call_agent_again         → перезапустить агента с доп. контекстом
 *   emit_final_estimate      → финал (обрабатывается в conductor.js)
 *
 * Каждый запуск агента: создаёт mimir_agent_run, подгружает требуемые
 * артефакты, вызывает реализацию (в Сессии 2 — мок), сохраняет артефакт,
 * пишет события для War Room и считает стоимость через models-config.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const db = require('../db');
const cr = require('./conductor-run');
const REGISTRY = require('./agents-registry');
const { getAgentImpl } = require('./agents');
const modelsConfig = require('./models-config');

/**
 * Запустить агента.
 * @param {string} agentName
 * @param {Object} input
 * @param {number} runId
 * @param {number|null} callerAgentRunId — agent_run_id вызвавшего (Conductor)
 * @returns {Promise<Object>} компактный результат для Conductor
 */
async function callAgent(agentName, input, runId, callerAgentRunId = null) {
  const spec = REGISTRY[agentName];
  if (!spec) throw new Error(`Unknown agent: ${agentName}`);

  const agentRunId = await cr.startAgentRun(runId, {
    agentName,
    model: spec.model_default,
    promptHash: '',
    parentAgentRunId: callerAgentRunId
  });
  cr.addEvent(runId, agentRunId, 'agent_started', { agent_name: agentName });

  const startedAt = Date.now();
  try {
    // Подгружаем требуемые артефакты
    const requiredArtifacts = {};
    for (const at of spec.requires_artifacts || []) {
      const art = await cr.getArtifact(runId, at);
      if (!art) {
        throw new Error(`Агент ${agentName} требует артефакт «${at}», которого ещё нет`);
      }
      requiredArtifacts[at] = art.content;
    }

    // Вызываем реализацию агента (Сессия 2 — мок)
    const impl = getAgentImpl(agentName);
    const artifact = await impl.run({
      input: input || {},
      requiredArtifacts,
      runId,
      agentRunId,
      agentName,
      onThought: (text) => cr.addEvent(runId, agentRunId, 'thought', { text }),
      onToolCall: (tool, inp) => cr.addEvent(runId, agentRunId, 'tool_call', { tool, input: inp }),
      onToolResult: (tool, out) => cr.addEvent(runId, agentRunId, 'tool_result', { tool, output_summary: out })
    });

    // Сохраняем артефакт (с дедупом по хешу)
    const { artifactId, deduped } = await cr.addArtifact(runId, agentRunId, spec.output_artifact_type, artifact);

    // Сигнал War Room: артефакт произведён (Сессия 3 UI его слушает)
    cr.addEvent(runId, agentRunId, 'artifact_emitted', {
      agent_name: agentName,
      artifact_id: artifactId,
      artifact_type: spec.output_artifact_type,
      deduped: !!deduped,
      summary: artifact.summary || null
    });

    // Поднимаем уточнения, если агент их вернул
    const raisedClarifications = [];
    for (const cl of artifact.clarifications || []) {
      const channel = (cl.channel || 'AUTO').toUpperCase();
      const res = await raiseClarification(runId, agentRunId, channel, cl);
      raisedClarifications.push(res);
    }

    const durationMs = Date.now() - startedAt;
    await cr.finishAgentRun(agentRunId, {
      status: 'SUCCESS',
      outputArtifactId: artifactId,
      outputSummary: artifact.summary || null,
      durationMs
    });

    return {
      success: true,
      agent_run_id: agentRunId,
      artifact_id: artifactId,
      artifact_type: spec.output_artifact_type,
      summary: artifact.summary,
      key_findings: artifact.key_findings || [],
      clarifications_raised: raisedClarifications
    };
  } catch (err) {
    await cr.finishAgentRun(agentRunId, {
      status: 'ERROR',
      errorText: err.message,
      durationMs: Date.now() - startedAt
    });
    cr.addEvent(runId, agentRunId, 'error', { text: err.message, agent_name: agentName });
    return { success: false, agent_run_id: agentRunId, error: err.message };
  }
}

/**
 * Перезапустить агента с дополнительным контекстом (call_agent_again).
 * Находит agent_name по предыдущему agent_run_id и запускает заново.
 */
async function rerunAgent(prevAgentRunId, additionalContext, runId, callerAgentRunId = null) {
  const res = await db.query('SELECT agent_name FROM mimir_agent_runs WHERE id = $1', [prevAgentRunId]);
  const agentName = res.rows[0]?.agent_name;
  if (!agentName) throw new Error(`agent_run ${prevAgentRunId} не найден для перезапуска`);
  return callAgent(agentName, { additional_instructions: additionalContext, _rerun_of: prevAgentRunId }, runId, callerAgentRunId);
}

/**
 * Поднять уточнение (clarification).
 * @param {number} runId
 * @param {number|null} agentRunId — кто поднял
 * @param {'PM'|'CUSTOMER'|'AUTO'} channel
 * @param {Object} input — { question, options, why, impact_rub, blocking, default_assumption, category, consequence }
 */
async function raiseClarification(runId, agentRunId, channel, input = {}) {
  const ch = (channel || 'AUTO').toUpperCase();
  const blocking = ch === 'CUSTOMER' ? (input.blocking !== false) : !!input.blocking;
  const status = ch === 'AUTO' ? 'RESOLVED' : 'OPEN';

  const res = await db.query(
    `INSERT INTO mimir_clarifications
       (conductor_run_id, raised_by_agent_run_id, channel, category,
        question_ru, why_we_ask, consequence, options_json, impact_rub,
        blocking, default_assumption, status, answer_source, answer_text, answered_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING id`,
    [
      runId, agentRunId, ch, input.category || null,
      input.question || input.question_ru || '', input.why || input.why_we_ask || null,
      input.consequence || null, JSON.stringify(input.options || input.options_json || []),
      input.impact_rub != null ? input.impact_rub : null,
      blocking, input.default_assumption || null, status,
      ch === 'AUTO' ? 'AUTO_ASSUMPTION' : null,
      ch === 'AUTO' ? (input.default_assumption || null) : null,
      ch === 'AUTO' ? new Date() : null
    ]
  );
  const clarId = res.rows[0].id;
  cr.addEvent(runId, agentRunId, 'clarification_raised', {
    clarification_id: clarId, channel: ch, question: input.question || input.question_ru || '', blocking
  });

  if (ch === 'PM') return { clarification_id: clarId, status: 'awaiting_pm_answer', blocking };
  if (ch === 'CUSTOMER') return { clarification_id: clarId, status: 'awaiting_customer_letter', blocking };
  return { clarification_id: clarId, status: 'auto_assumption_applied', assumption: input.default_assumption || null };
}

/**
 * Прочитать артефакт указанного типа.
 */
async function readArtifact(runId, artifactType) {
  const art = await cr.getArtifact(runId, artifactType);
  if (!art) return { found: false, artifact_type: artifactType };
  return { found: true, artifact_type: artifactType, content: art.content, content_hash: art.content_hash };
}

/**
 * Маршрутизация одного tool-вызова Conductor.
 * @param {{name:string, input:Object, id:string}} toolUse
 * @param {number} runId
 * @param {number|null} conductorRunId — agent_run_id самого Conductor
 */
async function executeTool(toolUse, runId, conductorRunId) {
  const { name, input = {} } = toolUse;

  if (name.startsWith('call_') && name !== 'call_agent_again') {
    const agentName = name.replace(/^call_/, '');
    return callAgent(agentName, input, runId, conductorRunId);
  }
  if (name === 'call_agent_again') {
    return rerunAgent(input.agent_run_id, input.additional_context, runId, conductorRunId);
  }
  if (name === 'ask_pm') return raiseClarification(runId, conductorRunId, 'PM', input);
  if (name === 'ask_customer') return raiseClarification(runId, conductorRunId, 'CUSTOMER', input);
  if (name === 'read_artifact') return readArtifact(runId, input.artifact_type);
  if (name === 'request_devils_advocate_review') return callAgent('devils_advocate', input, runId, conductorRunId);
  if (name === 'emit_final_estimate') return { acknowledged: true }; // финал обрабатывается в conductor.js

  throw new Error(`Unknown tool: ${name}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool-схемы для Conductor (tool use API)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Собрать массив tool-схем: агенты из регистра + служебные инструменты.
 * @param {Object} registry — REGISTRY
 * @param {string[]} [requiredAgents] — для подсветки обязательных в описаниях
 * @returns {Array<{name, description, input_schema}>}
 */
function buildToolSchemas(registry, requiredAgents = []) {
  const reqSet = new Set(requiredAgents);
  const agentTools = Object.entries(registry)
    .filter(([key]) => key !== 'agent') // 'agent' — это фабрика, не агент
    .map(([key, spec]) => {
      const t = spec.tool_schema;
      const mustHave = reqSet.has(key) ? ' [ОБЯЗАТЕЛЬНЫЙ по правилам]' : '';
      return { name: t.name, description: t.description + mustHave, input_schema: t.input_schema };
    });

  const serviceTools = [
    {
      name: 'ask_pm',
      description: 'Задать вопрос руководителю проекта (РП). Используй, когда ответ может дать внутренний РП (ресурсы, предпочтения). НЕ выдумывай.',
      input_schema: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'Вопрос на русском' },
          options: { type: 'array', items: { type: 'string' }, description: 'Варианты ответа (если есть)' },
          why: { type: 'string', description: 'Зачем нужен ответ' },
          impact_rub: { type: 'number', description: 'Влияние на стоимость, ₽' },
          blocking: { type: 'boolean', description: 'Блокирует ли финализацию' }
        },
        required: ['question']
      }
    },
    {
      name: 'ask_customer',
      description: 'Сформировать вопрос заказчику (объёмы, доступ, давальческое, согласования). По умолчанию блокирующий. НЕ выдумывай ответ.',
      input_schema: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          why: { type: 'string' },
          impact_rub: { type: 'number' },
          blocking: { type: 'boolean', description: 'По умолчанию true' }
        },
        required: ['question']
      }
    },
    {
      name: 'read_artifact',
      description: 'Прочитать готовый артефакт по типу (например tz_summary, resources).',
      input_schema: {
        type: 'object',
        properties: { artifact_type: { type: 'string' } },
        required: ['artifact_type']
      }
    },
    {
      name: 'request_devils_advocate_review',
      description: 'Запустить независимую критическую проверку (Адвокат дьявола). Обязательно для контрактов > 50M ₽ перед финалом.',
      input_schema: { type: 'object', properties: { focus: { type: 'string' } } }
    },
    {
      name: 'call_agent_again',
      description: 'Перезапустить ранее вызванного агента с дополнительным контекстом/уточнением.',
      input_schema: {
        type: 'object',
        properties: {
          agent_run_id: { type: 'integer' },
          additional_context: { type: 'string' }
        },
        required: ['agent_run_id', 'additional_context']
      }
    },
    {
      name: 'emit_final_estimate',
      description: 'Финализировать просчёт. Вызывать ТОЛЬКО когда все обязательные агенты завершены и нет открытых блокирующих уточнений.',
      input_schema: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Краткое инженерное резюме (3-5 предложений)' },
          decision_reasoning: { type: 'string', description: 'Почему именно такая цена' },
          recommendation: { type: 'string', enum: ['TAKE', 'THINK', 'DECLINE'] },
          key_assumptions: { type: 'array', items: { type: 'string' } }
        },
        required: ['summary', 'recommendation']
      }
    }
  ];

  return [...agentTools, ...serviceTools];
}

module.exports = {
  callAgent,
  rerunAgent,
  raiseClarification,
  readArtifact,
  executeTool,
  buildToolSchemas,
  _modelsConfig: modelsConfig // экспорт для тестов
};
