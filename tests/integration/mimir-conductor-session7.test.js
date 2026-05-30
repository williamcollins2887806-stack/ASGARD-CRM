/**
 * ASGARD CRM — Сессия 7: финмодель, риски, адвокат, аналоги, нормоконтроль,
 * расширенные python-агенты + директорский отчёт (stub, баланс НЕ тратится).
 * ═══════════════════════════════════════════════════════════════════════════
 * Проверяет, что 13 агентов Сессии 7 реально подключены (REAL-мапа, не моки)
 * и каждый в stub-режиме производит валидный артефакт по своим зависимостям;
 * что хелперы Монте-Карло и cashflow считают разумные числа; и что
 * generateDirectorReport собирает PDF и пишет путь в БД.
 *
 * Работаем напрямую через сервисы (без HTTP), как тесты Сессий 5–6.
 *
 * Проверки:
 *  • isStubMode() === true (предохранитель — баланс не тратим)
 *  • каждый из 13 агентов привязан в REAL (getAgentImpl !== mock)
 *  • montecarlo: p10 ≤ p50 ≤ p90, loss_probability ∈ [0,1]
 *  • cashflow: net_profit число, roi_pct число
 *  • каждый агент произвёл свой output_artifact_type (артефакт в БД)
 *  • risk_analysis содержит monte_carlo с p50; financial_model — cashflow;
 *    devils_advocate — verdict/findings; analogs_comparison — analogs[]
 *  • generateDirectorReport → PDF на диске + director_report_path в run
 *
 * Чистит за собой (DELETE run cascade + удаляет PDF).
 * Запуск: node tests/integration/mimir-conductor-session7.test.js
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

require('dotenv').config();

const fs = require('fs');
const db = require('../../src/services/db');
const aiProvider = require('../../src/services/ai-provider');
const cr = require('../../src/services/mimir-conductor/conductor-run');
const { callAgent } = require('../../src/services/mimir-conductor/tool-executor');
const { getAgentImpl, mock } = require('../../src/services/mimir-conductor/agents');
const { runMonteCarlo } = require('../../src/services/mimir-conductor/montecarlo');
const { computeCashFlow } = require('../../src/services/mimir-conductor/cashflow');
const { generateDirectorReport } = require('../../src/services/mimir-conductor/director-report');
const REGISTRY = require('../../src/services/mimir-conductor/agents-registry');

// Все 13 агентов Сессии 7.
const SESSION7 = [
  'contract_decomposer', 'historical_comparator', 'norms_compliance',
  'pre_mob_calculator', 'consumables_calculator', 'standby_estimator',
  'quality_control_planner', 'executive_docs_planner', 'warranty_reserve',
  'marine_permits', 'risk_quantifier', 'financial_modeler', 'devils_advocate'
];

async function pickTenderId() {
  const r = await db.query('SELECT id FROM tenders ORDER BY id DESC LIMIT 1');
  return r.rows[0] ? r.rows[0].id : null;
}
async function pickPmId() {
  const r = await db.query("SELECT id FROM users WHERE role = 'PM' AND COALESCE(is_active,true) = true ORDER BY id LIMIT 1");
  return r.rows[0] ? r.rows[0].id : 1;
}

/** Засеять артефакт от имени технического agent_run (как будто агент отработал). */
async function seedArtifact(runId, agentName, type, content) {
  const ar = await cr.startAgentRun(runId, { agentName, model: 'sonnet-4-6', promptHash: 'seed' });
  await cr.addArtifact(runId, ar, type, content);
}

async function runScenario() {
  const results = [];
  const ok = (name, cond) => { results.push({ name, ok: !!cond }); };

  // Предохранитель: только stub.
  await aiProvider.completeWithStream({ system: '', messages: [{ role: 'user', content: 'x' }], model: 'sonnet-4-6', onThought: () => {}, onText: () => {} });
  ok('isStubMode() === true (баланс не тратим)', aiProvider.isStubMode() === true);
  if (!aiProvider.isStubMode()) throw new Error('НЕ stub-режим: тест остановлен');

  // 13 агентов Сессии 7 реально подключены (не мок).
  for (const a of SESSION7) {
    ok(`агент ${a} в REAL-мапе (не мок)`, getAgentImpl(a) !== mock);
  }

  // ── Хелпер: Монте-Карло ────────────────────────────────────────────────
  const mc = runMonteCarlo({
    base_cost: 10000000,
    variations: {
      labor: { dist: 'triangle', min: 0.9, mode: 1.0, max: 1.2 },
      materials: { dist: 'normal', mean: 1.0, std: 0.08 }
    },
    iterations: 3000,
    contract_value: 14000000,
    seed: 20260531
  });
  ok('montecarlo: p10 ≤ p50 ≤ p90', mc.p10 <= mc.p50 && mc.p50 <= mc.p90);
  ok('montecarlo: loss_probability ∈ [0,1]', mc.loss_probability >= 0 && mc.loss_probability <= 1);
  ok('montecarlo: mean — конечное число', Number.isFinite(mc.mean) && mc.mean > 0);

  // ── Хелпер: cashflow ───────────────────────────────────────────────────
  const cf = computeCashFlow({ contract_value: 14000000, total_cost: 10000000, duration_days: 60 });
  ok('cashflow: net_profit — конечное число', Number.isFinite(cf.net_profit));
  ok('cashflow: roi_pct — конечное число', Number.isFinite(cf.roi_pct));
  ok('cashflow: max_cash_gap определён', Number.isFinite(cf.max_cash_gap));

  // ── Прогон агентов на реальном run с засеянными зависимостями ───────────
  const tenderId = await pickTenderId();
  const pmId = await pickPmId();
  ok('найден тендер в dev-БД', tenderId != null);

  // Контракт > 50M, чтобы хард-правила требовали risk/advocate/financial.
  const run = await cr.createRun({ tenderId, initiatedBy: pmId, profile: 'STANDARD', contractValue: 60000000 });
  const runId = run.runId;
  let pdfPath = null;

  try {
    await cr.updateRunStatus(runId, 'RUNNING', {});

    // Засеиваем апстрим-артефакты, от которых зависят агенты Сессии 7.
    await seedArtifact(runId, 'tz_analyst', 'tz_summary', {
      summary: '[seed] Химпромывка + сварные работы на действующем НПЗ.',
      object: { name: 'Установка АВТ-6', city: 'Саратов', type: 'НПЗ', on_water: false },
      customer: { name: 'ПАО «Газпром нефтехим»', requires_STO_compliance: true },
      scope: {
        main_works: [
          { type: 'химическая промывка', object: 'теплообменники', volume: 8, volume_unit: 'шт' },
          { type: 'сварка', object: 'трубопроводы', volume: 120, volume_unit: 'стык' }
        ],
        method: ['химическая промывка', 'сварка'], has_subcontract_signals: true, has_welding: true
      },
      conditions: { operating_facility: true, has_OZP: true, has_hazardous: true },
      timing: { start: '2026-11-01', end: '2026-12-30', duration_days: 60, warranty_months: 24 },
      has_volumes: true, key_findings: ['[seed]'], clarifications: []
    });
    await seedArtifact(runId, 'resource_planner', 'resources', {
      summary: '[seed] ресурсная ведомость', resources: [
        { name: 'Реагент кислотный', qty: 2000, unit: 'кг' },
        { name: 'Сопла', qty: 40, unit: 'шт' }
      ], total_volume: 8
    });
    await seedArtifact(runId, 'crew_composer', 'crew_plan', {
      summary: '[seed] бригада', crew: [{ role: 'Сварщик', count: 4 }, { role: 'Монтажник', count: 6 }],
      headcount: 10, itr: 2
    });
    await seedArtifact(runId, 'labor_calculator', 'labor_cost', {
      summary: '[seed] ФОТ', total_fot: 4500000, man_days: 600, headcount: 10
    });
    await seedArtifact(runId, 'procurement_analyzer', 'procurement', {
      summary: '[seed] закупка', total_procurement: 3000000, items: []
    });
    await seedArtifact(runId, 'indirects_calculator', 'indirects', {
      summary: '[seed] косвенные', total_indirects: 1800000, total_cost: 38000000,
      base_cost: 38000000, breakdown: {}
    });

    // Запускаем 13 агентов Сессии 7 в порядке зависимостей.
    // (final_estimate для адвоката создаём через final_consolidator.)
    const order = [
      'contract_decomposer', 'historical_comparator', 'norms_compliance',
      'pre_mob_calculator', 'consumables_calculator', 'standby_estimator',
      'quality_control_planner', 'executive_docs_planner', 'warranty_reserve',
      'marine_permits', 'risk_quantifier', 'financial_modeler',
      'final_consolidator', 'devils_advocate'
    ];
    for (const agentName of order) {
      await callAgent(agentName, {}, runId);
    }

    // Каждый агент Сессии 7 произвёл свой артефакт.
    for (const a of SESSION7) {
      const type = REGISTRY[a].output_artifact_type;
      const art = await cr.getArtifact(runId, type);
      ok(`${a} → артефакт «${type}» создан`, art && art.content && typeof art.content === 'object');
    }

    // Точечные проверки содержимого.
    const risk = (await cr.getArtifact(runId, 'risk_analysis'))?.content || {};
    ok('risk_analysis содержит simulation с p50', risk.simulation && Number.isFinite(Number(risk.simulation.p50)));

    const fin = (await cr.getArtifact(runId, 'financial_model'))?.content || {};
    ok('financial_model содержит cash_flow + net_profit', !!fin.cash_flow && Number.isFinite(Number(fin.net_profit)));

    const adv = (await cr.getArtifact(runId, 'devils_advocate'))?.content || {};
    ok('devils_advocate содержит findings[]', Array.isArray(adv.findings) || Array.isArray(adv.key_findings));

    const analogs = (await cr.getArtifact(runId, 'analogs_comparison'))?.content || {};
    ok('analogs_comparison содержит analogs[]', Array.isArray(analogs.analogs));

    const norms = (await cr.getArtifact(runId, 'norms_compliance'))?.content || {};
    ok('norms_compliance: строгий заказчик распознан', norms.strict === true);

    const premob = (await cr.getArtifact(runId, 'pre_mob_cost'))?.content || {};
    ok('pre_mob_cost содержит total_pre_mob > 0', Number(premob.total_pre_mob) > 0);

    // ── Директорский отчёт ─────────────────────────────────────────────────
    await cr.updateRunStatus(runId, 'READY_FOR_REVIEW', {});
    const rep = await generateDirectorReport(runId);
    pdfPath = rep.pdfPath;
    ok('директорский отчёт: PDF создан на диске', pdfPath && fs.existsSync(pdfPath));
    ok('директорский отчёт: размер PDF > 1 КБ', pdfPath && fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 1024);

    const after = await cr.getRun(runId);
    ok('директорский отчёт: путь записан в run', after && after.director_report_path === pdfPath);

    ok('isStubMode() остаётся true к концу прогона', aiProvider.isStubMode() === true);
  } finally {
    await db.query('DELETE FROM mimir_conductor_runs WHERE id = $1', [runId]);
    if (pdfPath && fs.existsSync(pdfPath)) { try { fs.unlinkSync(pdfPath); } catch (_) { /* noop */ } }
  }

  return results;
}

async function main() {
  let results;
  try {
    results = await runScenario();
  } catch (e) {
    console.error('❌ Тест упал:', e.message);
    console.error(e.stack);
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
  describe('Mimir Conductor — Сессия 7 (финмодель, риски, адвокат, отчёт)', () => {
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
