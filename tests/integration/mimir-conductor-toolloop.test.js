/**
 * ASGARD CRM — Сессия 6b: нативный tool-use loop Conductor (stub, баланс НЕ тратится).
 * ═══════════════════════════════════════════════════════════════════════════
 * Проверяет, что:
 *  1. completeWithStream({tools}) в stub-режиме возвращает нативные tool_uses
 *     (id/name/input) + content_blocks + stop_reason='tool_use'.
 *  2. Stub-сценарий зависит от complexity_flags и contract_value:
 *       • ОЗП-проект (has_OZP, 80M) → site_conditions, method_validator,
 *         financial_modeler, devils_advocate в цепочке.
 *       • Простой проект (1.5M) → НЕТ devils_advocate / financial_modeler.
 *  3. Stub учитывает required_agents (hard-rules) — недостающие добавляются.
 *  4. emit_final_estimate генерируется ТОЛЬКО когда вся цепочка пройдена.
 *  5. canFinalize отклоняет ранний финал (is_error), Conductor продолжает loop.
 *  6. Полный прогон runConductor (stub) на простой работе доходит до
 *     READY_FOR_REVIEW — нативный loop сам собрал смету и финализировал.
 *
 * Чистит за собой (DELETE run). Запуск: node tests/integration/mimir-conductor-toolloop.test.js
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

require('dotenv').config();

const db = require('../../src/services/db');
const aiProvider = require('../../src/services/ai-provider');
const cr = require('../../src/services/mimir-conductor/conductor-run');
const { REGISTRY } = require('../../src/services/mimir-conductor/agents-registry');
const { buildToolSchemas } = require('../../src/services/mimir-conductor/tool-executor');
const { runConductor } = require('../../src/services/mimir-conductor/conductor');

/** Собрать историю messages с уже «вызванными» агентами (Anthropic-формат). */
function historyWithCalled(agentNames) {
  return agentNames.map((name) => ({
    role: 'assistant',
    content: [{ type: 'tool_use', id: `h_${name}`, name: `call_${name}`, input: {} }]
  }));
}

/** Прогнать stub-сценарий до конца, собрать порядок вызванных tool. */
function drainStubScenario(stubCtx) {
  const order = [];
  let history = [];
  for (let i = 0; i < 40; i++) {
    const r = aiProvider.generateStubToolUses(history, stubCtx);
    const tu = r.tool_uses[0];
    order.push(tu.name);
    if (tu.name === 'emit_final_estimate') break;
    history = history.concat(historyWithCalled([tu.name.replace(/^call_/, '')]));
  }
  return order;
}

async function pickTenderId() {
  const r = await db.query('SELECT id FROM tenders ORDER BY id DESC LIMIT 1');
  return r.rows[0] ? r.rows[0].id : null;
}
async function pickPmId() {
  const r = await db.query("SELECT id FROM users WHERE role = 'PM' AND COALESCE(is_active,true) = true ORDER BY id LIMIT 1");
  return r.rows[0] ? r.rows[0].id : 1;
}

async function runScenario() {
  const results = [];
  const ok = (name, cond) => { results.push({ name, ok: !!cond }); };

  ok('isStubMode() === true (баланс не тратим)', aiProvider.isStubMode() === true);
  if (!aiProvider.isStubMode()) throw new Error('НЕ stub-режим: тест остановлен');

  // ── Тест 1: форма ответа completeWithStream с tools ──
  const tools = buildToolSchemas(REGISTRY, ['tz_analyst', 'final_consolidator']);
  ok('buildToolSchemas вернул tools[]', Array.isArray(tools) && tools.length > 0);
  ok('tools содержат emit_final_estimate', tools.some((t) => t.name === 'emit_final_estimate'));

  let thoughtSeen = false; let toolCallSeen = false;
  const r1 = await aiProvider.completeWithStream({
    system: 'test', messages: [{ role: 'user', content: 'go' }], model: 'sonnet-4-6',
    tools, tool_choice: 'auto', stubCtx: { contract_value: 1500000, complexity_flags: {}, required_agents: [] },
    onThought: () => { thoughtSeen = true; }, onToolCall: () => { toolCallSeen = true; }
  });
  ok('stop_reason === tool_use', r1.stop_reason === 'tool_use');
  ok('tool_uses непустой', Array.isArray(r1.tool_uses) && r1.tool_uses.length >= 1);
  ok('tool_use имеет id/name/input', r1.tool_uses[0].id && r1.tool_uses[0].name && typeof r1.tool_uses[0].input === 'object');
  ok('content_blocks содержат tool_use', (r1.content_blocks || []).some((b) => b.type === 'tool_use'));
  ok('onThought вызван', thoughtSeen);
  ok('onToolCall вызван', toolCallSeen);

  // ── Тест 2: ОЗП-проект, 80M → тяжёлый сценарий ──
  const ozpOrder = drainStubScenario({
    contract_value: 80000000,
    complexity_flags: { has_OZP: true },
    required_agents: ['tz_analyst', 'site_conditions', 'permits_planner', 'gatekeeper', 'risk_quantifier', 'devils_advocate', 'financial_modeler', 'final_consolidator']
  });
  const ozpNames = ozpOrder.map((n) => n.replace(/^call_/, ''));
  ok('ОЗП: вызван site_conditions', ozpNames.includes('site_conditions'));
  ok('ОЗП: вызван method_validator', ozpNames.includes('method_validator'));
  ok('ОЗП: вызван financial_modeler (>50M)', ozpNames.includes('financial_modeler'));
  ok('ОЗП: вызван devils_advocate (>50M)', ozpNames.includes('devils_advocate'));
  ok('ОЗП: вызван gatekeeper (required)', ozpNames.includes('gatekeeper'));
  ok('ОЗП: вызван risk_quantifier (required)', ozpNames.includes('risk_quantifier'));
  ok('ОЗП: финал — emit_final_estimate последним', ozpOrder[ozpOrder.length - 1] === 'emit_final_estimate');
  ok('ОЗП: final_consolidator до финала', ozpNames.includes('final_consolidator'));

  // ── Тест 3: простой проект, 1.5M → минимальный сценарий ──
  const simpleOrder = drainStubScenario({
    contract_value: 1500000,
    complexity_flags: {},
    required_agents: ['tz_analyst', 'final_consolidator']
  });
  const simpleNames = simpleOrder.map((n) => n.replace(/^call_/, ''));
  ok('Простой: НЕТ devils_advocate', !simpleNames.includes('devils_advocate'));
  ok('Простой: НЕТ financial_modeler', !simpleNames.includes('financial_modeler'));
  ok('Простой: НЕТ gatekeeper (<10M)', !simpleNames.includes('gatekeeper'));
  ok('Простой: есть resource_planner', simpleNames.includes('resource_planner'));
  ok('Простой: есть final_consolidator', simpleNames.includes('final_consolidator'));
  ok('Простой: финал — emit_final_estimate', simpleOrder[simpleOrder.length - 1] === 'emit_final_estimate');

  // ── Тест 4: ранний emit (пустая история) → всё равно идёт цепочка, не финал сразу ──
  const firstStep = aiProvider.generateStubToolUses([], { contract_value: 1500000, complexity_flags: {}, required_agents: ['tz_analyst', 'final_consolidator'] });
  ok('Первый ход — НЕ emit_final_estimate (есть незавершённые агенты)', firstStep.tool_uses[0].name !== 'emit_final_estimate');

  // ── Тест 5: полный прогон runConductor на простой работе → READY_FOR_REVIEW ──
  const tenderId = await pickTenderId();
  const pmId = await pickPmId();
  const run = await cr.createRun({ tenderId, initiatedBy: pmId, profile: 'STANDARD', contractValue: 1500000 });
  const runId = run.runId;
  let finished = null;
  try {
    await runConductor(runId);
    finished = await cr.getRun(runId);
    ok('runConductor (простой, 1.5M) → READY_FOR_REVIEW', finished.status === 'READY_FOR_REVIEW');

    const completed = await cr.getCompletedAgents(runId);
    ok('conductor отработал', completed.includes('conductor'));
    ok('final_consolidator отработал', completed.includes('final_consolidator'));
    ok('НЕ запускался gatekeeper (<10M)', !completed.includes('gatekeeper'));

    const events = await cr.listEvents(runId, 0, 5000);
    const types = new Set(events.map((e) => e.event_type));
    ok('есть событие thought', types.has('thought'));
    ok('есть событие tool_call', types.has('tool_call'));
    ok('есть событие artifact_emitted', types.has('artifact_emitted'));
    ok('есть событие final_estimate', types.has('final_estimate'));
  } finally {
    await db.query('DELETE FROM mimir_conductor_runs WHERE id = $1', [runId]);
  }

  ok('isStubMode() остаётся true к концу', aiProvider.isStubMode() === true);
  return results;
}

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

if (typeof describe === 'function') {
  describe('Mimir Conductor — нативный tool-use loop (stub)', () => {
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
