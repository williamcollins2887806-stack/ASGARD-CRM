/**
 * ASGARD CRM — Сессия 6: расширенные агенты + RAG-нормы (stub, баланс НЕ тратится).
 * ═══════════════════════════════════════════════════════════════════════════
 * Проверяет, что 12 расширенных агентов реально подключены (REAL-мапа, не моки)
 * и каждый в stub-режиме производит валидный артефакт в правильном порядке
 * зависимостей. Работаем напрямую через сервисы (без HTTP) — как тест Сессии 5.
 *
 * Порядок (по requires_artifacts):
 *   document_parser → tz_analyst → resource_planner →
 *   crew_composer → labor_calculator → indirects_calculator →
 *   warehouse_matcher → market_search → procurement_analyzer →
 *   routing_planner → travel_pricer → permits_planner →
 *   gatekeeper, method_validator, site_conditions, drawings_reader.
 *
 * Проверки:
 *  • isStubMode() === true (предохранитель — баланс не тратим)
 *  • RAG: searchNorms возвращает ≥1 норму по «химическая промывка» (V139 засеян)
 *  • каждый из 12 агентов привязан в REAL (getAgentImpl !== mock)
 *  • каждый агент произвёл свой output_artifact_type (артефакт в БД)
 *  • ключевые числовые поля присутствуют (indirects.total_indirects, и т.д.)
 *
 * Чистит за собой (DELETE run, cascade).
 * Запуск: node tests/integration/mimir-conductor-extended.test.js
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

require('dotenv').config();

const db = require('../../src/services/db');
const aiProvider = require('../../src/services/ai-provider');
const cr = require('../../src/services/mimir-conductor/conductor-run');
const { callAgent } = require('../../src/services/mimir-conductor/tool-executor');
const { getAgentImpl, mock } = require('../../src/services/mimir-conductor/agents');
const norms = require('../../src/services/mimir-conductor/rag/norms-index');

const EXTENDED = [
  'drawings_reader', 'gatekeeper', 'resource_planner', 'method_validator',
  'site_conditions', 'warehouse_matcher', 'market_search', 'procurement_analyzer',
  'routing_planner', 'travel_pricer', 'permits_planner', 'indirects_calculator'
];

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

  // Предохранитель: только stub.
  await aiProvider.completeWithStream({ system: '', messages: [{ role: 'user', content: 'x' }], model: 'sonnet-4-6', onThought: () => {}, onText: () => {} });
  ok('isStubMode() === true (баланс не тратим)', aiProvider.isStubMode() === true);
  if (!aiProvider.isStubMode()) throw new Error('НЕ stub-режим: тест остановлен');

  // 12 расширенных агентов реально подключены (не мок).
  for (const a of EXTENDED) {
    ok(`агент ${a} в REAL-мапе (не мок)`, getAgentImpl(a) !== mock);
  }

  // RAG: индекс норм засеян (V139 + scripts/load-norms.js).
  const found = await norms.searchNorms('химическая промывка теплообменника', 3);
  ok('RAG: searchNorms нашёл ≥1 норму', Array.isArray(found) && found.length >= 1);

  const tenderId = await pickTenderId();
  const pmId = await pickPmId();
  ok('найден тендер в dev-БД', tenderId != null);

  const run = await cr.createRun({ tenderId, initiatedBy: pmId, profile: 'STANDARD', contractValue: 12000000 });
  const runId = run.runId;

  try {
    await cr.updateRunStatus(runId, 'RUNNING', {});

    // Прелюдия.
    await callAgent('document_parser', { documents: [] }, runId);
    await callAgent('tz_analyst', { documents: [], focus_areas: ['all'] }, runId);

    // Без приложенных документов stub-tz_summary пуст (main_works=[]). Чтобы
    // прогнать ресурсный/нормативный путь по-настоящему, подменяем tz_summary
    // правдоподобной сводкой с перечнем работ (как было бы из реального ТЗ).
    const tzAgentRun = await cr.startAgentRun(runId, { agentName: 'tz_analyst', model: 'sonnet-4-6', promptHash: 'seed' });
    await cr.addArtifact(runId, tzAgentRun, 'tz_summary', {
      summary: '[seed] Химическая промывка теплообменников на действующем НПЗ.',
      object: { name: 'Установка ЭЛОУ-АВТ-6', city: 'Саратов', type: 'НПЗ' },
      customer: { name: 'ПАО «Тестнефть»', requires_STO_compliance: true, STO_codes: ['СТО-2-3.5-454'] },
      scope: {
        main_works: [
          { type: 'химическая промывка', object: 'теплообменники Т-1..Т-8', volume: 8, volume_unit: 'шт' },
          { type: 'гидроиспытание', object: 'трубопроводы обвязки', volume: 1200, volume_unit: 'м' }
        ],
        method: ['химическая промывка', 'гидроиспытание'], deposit_type: null, has_subcontract_signals: false
      },
      conditions: { regime: '2_smena', has_OZP: true, has_hazardous: true, has_hot_work: false, operating_facility: true, weather_constraints: null, weight_limits: null },
      permits_required: ['ОТ и ТБ', 'работы на высоте', 'НАКС'],
      timing: { start: '2026-11-01', end: '2026-12-20', duration_days: 50, hard_deadline: true },
      equipment_mentioned_in_tz: [],
      materials_provided_by_customer: [],
      has_volumes: true,
      key_findings: ['[seed] перечень работ для проверки ресурсного пути'],
      clarifications: []
    });

    // Цепочка зависимостей расширенных агентов.
    const chain = [
      'resource_planner', 'crew_composer', 'labor_calculator', 'indirects_calculator',
      'warehouse_matcher', 'market_search', 'procurement_analyzer',
      'routing_planner', 'travel_pricer', 'permits_planner',
      'gatekeeper', 'method_validator', 'site_conditions', 'drawings_reader'
    ];
    for (const agentName of chain) {
      await callAgent(agentName, {}, runId);
    }

    // Проверяем, что каждый расширенный агент произвёл свой артефакт.
    const { REGISTRY } = require('../../src/services/mimir-conductor/agents-registry');
    for (const a of EXTENDED) {
      const type = REGISTRY[a].output_artifact_type;
      const art = await cr.getArtifact(runId, type);
      ok(`${a} → артефакт «${type}» создан`, art && art.content && typeof art.content === 'object');
    }

    // Точечные проверки содержимого ключевых артефактов.
    const indirects = (await cr.getArtifact(runId, 'indirects'))?.content || {};
    ok('indirects.total_indirects — число > 0', Number(indirects.total_indirects) > 0);

    const resources = (await cr.getArtifact(runId, 'resources'))?.content || {};
    ok('resources.resources — непустой массив', Array.isArray(resources.resources) && resources.resources.length > 0);

    const permits = (await cr.getArtifact(runId, 'permits_plan'))?.content || {};
    ok('permits_plan содержит have/to_train', Array.isArray(permits.have) && Array.isArray(permits.to_train));

    const routing = (await cr.getArtifact(runId, 'routing_plan'))?.content || {};
    ok('routing_plan.legs — массив', Array.isArray(routing.legs));

    const market = (await cr.getArtifact(runId, 'market_offers'))?.content || {};
    ok('market_offers содержит offers[]', Array.isArray(market.offers));

    // Никаких реальных трат: подтверждаем stub до сих пор.
    ok('isStubMode() остаётся true к концу прогона', aiProvider.isStubMode() === true);
  } finally {
    await db.query('DELETE FROM mimir_conductor_runs WHERE id = $1', [runId]);
  }

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
  describe('Mimir Conductor — расширенные агенты (stub)', () => {
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
