/**
 * ASGARD CRM — Mimir Conductor: агент «Монте-Карло / риск-квантификатор» (Сессия 7)
 * ═══════════════════════════════════════════════════════════════════════════
 * DeepSeek v4 генерирует сценарии «что может пойти не так», Node крутит Монте-
 * Карло (montecarlo.js) и считает P10/P50/P90 + вероятность убытка.
 *
 * Артефакт: risk_analysis
 *   { summary, key_findings[], simulation{...}, scenarios[], top_risks[] }
 *
 * STUB-режим: сценарии — детерминированный типовой набор; симуляция считается
 * по фиксированному seed (воспроизводимо). Баланс не тратится.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const aiProvider = require('../../ai-provider');
const cr = require('../conductor-run');
const { runMonteCarlo } = require('../montecarlo');
const { parseStrictJson, formatRub } = require('./_util');

const SYSTEM_PROMPT = `Ты — риск-менеджер подрядного проекта ООО «Асгард Сервис».
Генерируешь конкретные сценарии «что может пойти не так»: срыв сроков заказчиком,
рост цен на материалы, низкая производительность, погодные простои, переделки.

Верни СТРОГО JSON:
{ "scenarios": [ {"name":"...","probability":0.0-1.0,"cost_impact_rub":число,"category":"schedule|cost|productivity|weather|rework"} ],
  "top_risks": ["3-5 главных рисков строками"] }`;

/** Типовые сценарии для stub. */
function stubScenarios(baseCost) {
  return {
    scenarios: [
      { name: 'Задержка предоставления фронта работ заказчиком', probability: 0.35, cost_impact_rub: Math.round(baseCost * 0.08), category: 'schedule' },
      { name: 'Рост цен на материалы/реагенты', probability: 0.40, cost_impact_rub: Math.round(baseCost * 0.06), category: 'cost' },
      { name: 'Снижение производительности (стеснённость, допуски)', probability: 0.30, cost_impact_rub: Math.round(baseCost * 0.10), category: 'productivity' },
      { name: 'Погодные простои', probability: 0.25, cost_impact_rub: Math.round(baseCost * 0.04), category: 'weather' },
      { name: 'Переделки по замечаниям контроля качества', probability: 0.20, cost_impact_rub: Math.round(baseCost * 0.05), category: 'rework' }
    ],
    top_risks: [
      'Срыв сроков предоставления объекта заказчиком',
      'Удорожание материалов сверх заложенного',
      'Падение производительности в действующем производстве'
    ]
  };
}

async function run({ requiredArtifacts, onThought, input, runId }) {
  const indirects = requiredArtifacts.indirects || {};
  const baseCost = (Number(indirects.base_personnel_with_tax) || 0) + (Number(indirects.total_indirects) || 0);
  let contractValue = Number(input && input.contract_value) || 0;
  if (!contractValue && runId) {
    try { const run = await cr.getRun(runId); contractValue = Number(run && run.contract_value) || 0; } catch (_) { /* noop */ }
  }

  // 1. Сценарии: DeepSeek v4 (live) или типовой набор (stub/fallback).
  let scen;
  if (aiProvider.isStubMode()) {
    onThought('stub-режим: типовые сценарии рисков');
    scen = stubScenarios(baseCost);
  } else {
    onThought('DeepSeek v4 генерирует сценарии рисков…');
    try {
      const result = await aiProvider.complete({
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Себестоимость: ${baseCost}. Контракт: ${contractValue}. Сгенерируй 10-15 рисков.` }],
        model: 'deepseek-v4',
        maxTokens: 4000
      });
      scen = result._stub ? stubScenarios(baseCost) : parseStrictJson(result.text);
    } catch (e) {
      onThought(`⚠ DeepSeek недоступен (${e.message}) — типовые сценарии`);
      scen = stubScenarios(baseCost);
    }
  }

  // 2. Монте-Карло симуляция (детерминированный seed для воспроизводимости).
  onThought('Запускаю Монте-Карло симуляцию 5000 итераций…');
  const simulation = runMonteCarlo({
    base_cost: baseCost,
    contract_value: contractValue,
    iterations: 5000,
    seed: 20260531,
    variations: {
      labor: { dist: 'normal', mean: 1.0, sigma: 0.10 },
      procurement: { dist: 'lognormal', mean: 0, sigma: 0.15 },
      duration: { dist: 'triangle', min: 0.9, mode: 1.0, max: 1.3 },
      productivity: { dist: 'normal', mean: 1.0, sigma: 0.15 }
    }
  });

  const findings = [
    `Себестоимость P50: ${formatRub(simulation.p50)}`,
    `P10/P90: ${formatRub(simulation.p10)} / ${formatRub(simulation.p90)}`
  ];
  if (contractValue > 0) {
    findings.push(`Ожидаемая прибыль (P50): ${formatRub(simulation.expected_profit)}`);
    findings.push(`Худший сценарий (P90): ${formatRub(simulation.worst_case)}`);
    findings.push(`Вероятность убытка: ${(simulation.loss_probability * 100).toFixed(1)}%`);
  }
  for (const r of (scen.top_risks || []).slice(0, 5)) findings.push(r);

  const lossPart = contractValue > 0
    ? `, риск убытка ${(simulation.loss_probability * 100).toFixed(1)}%`
    : '';

  return {
    summary: `Риск-анализ: P50=${formatRub(simulation.p50)}, P90=${formatRub(simulation.p90)}${lossPart}`,
    key_findings: findings,
    simulation,
    scenarios: scen.scenarios || [],
    top_risks: scen.top_risks || [],
    clarifications: []
  };
}

module.exports = { run, stubScenarios };
