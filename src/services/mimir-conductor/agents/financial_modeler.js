/**
 * ASGARD CRM — Mimir Conductor: агент «Финмодель» (Сессия 7, Шаг 7.3)
 * ═══════════════════════════════════════════════════════════════════════════
 * Node считает кэш-флоу (cashflow.js): аванс, удержания, отсрочка, БГ, оборотка,
 * налог на прибыль, чистая прибыль. Opus 4.7 анализирует модель (ликвидность,
 * чувствительность к задержкам оплаты).
 *
 * Артефакт: financial_model
 *   { summary, key_findings[], cash_flow{...}, analysis{...}, bg_cost,
 *     retention_amount, working_capital_cost, profit_tax, net_profit }
 *
 * STUB-режим: модель считается Node-расчётом; анализ — детерминированный.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const aiProvider = require('../../ai-provider');
const cr = require('../conductor-run');
const db = require('../../db');
const { computeCashFlow } = require('../cashflow');
const { parseStrictJson, formatRub } = require('./_util');

const SYSTEM_PROMPT = `Ты — финансовый директор ООО «Асгард Сервис».
Анализируешь финмодель подрядного проекта: кассовый разрыв, требуемый рабочий
капитал, риск ликвидности, ROI после налогов, чувствительность к задержкам оплаты.

Верни СТРОГО JSON:
{ "roi_pct": число, "roi_after_tax_pct": число,
  "liquidity_risk": "low|medium|high",
  "key_findings": ["4-6 пунктов"],
  "recommendations": ["..."] }`;

/** Детерминированный анализ для stub. */
function buildStubAnalysis(cf) {
  const liquidity = cf.max_cash_gap > cf.contract_value * 0.4 ? 'high' : (cf.max_cash_gap > cf.contract_value * 0.2 ? 'medium' : 'low');
  return {
    roi_pct: cf.roi_pct,
    roi_after_tax_pct: cf.roi_after_tax_pct,
    liquidity_risk: liquidity,
    key_findings: [
      `Чистая прибыль: ${formatRub(cf.net_profit)} (маржа ${cf.net_margin_pct}%)`,
      `Кассовый разрыв: ${formatRub(cf.max_cash_gap)}`,
      `Стоимость оборотки: ${formatRub(cf.working_capital_cost)}`,
      `Банковская гарантия: ${formatRub(cf.bg_total_cost)}`,
      `Налог на прибыль: ${formatRub(cf.profit_tax)}`
    ],
    recommendations: liquidity === 'high'
      ? ['Высокий кассовый разрыв — запросить увеличение аванса или сократить отсрочку']
      : ['Финансовый профиль приемлемый при текущих условиях оплаты']
  };
}

/** Цена контракта: из run, иначе из tender, иначе из input. */
async function resolveContractValue(runId, input) {
  if (input && Number(input.contract_value)) return Number(input.contract_value);
  let run = null;
  try { run = await cr.getRun(runId); } catch (_) { /* noop */ }
  if (run && Number(run.contract_value)) return Number(run.contract_value);
  if (run && run.tender_id) {
    try {
      const t = await db.query('SELECT tender_price FROM tenders WHERE id = $1', [run.tender_id]);
      if (t.rows[0] && Number(t.rows[0].tender_price)) return Number(t.rows[0].tender_price);
    } catch (_) { /* noop */ }
  }
  return 0;
}

async function run({ requiredArtifacts, onThought, input, runId }) {
  const indirects = requiredArtifacts.indirects || {};
  const procurement = requiredArtifacts.procurement || {};
  const tz = requiredArtifacts.tz_summary || {};

  const totalCost = (Number(indirects.base_personnel_with_tax) || 0)
    + (Number(indirects.total_indirects) || 0)
    + (Number(procurement.total_purchase) || Number(procurement.total) || 0);
  const contractValue = await resolveContractValue(runId, input);
  const durationDays = Number(tz.timing && tz.timing.duration_days) || 30;

  onThought('Считаю кэш-флоу, БГ, удержания, налоги…');
  const cashFlow = computeCashFlow({
    contract_value: contractValue || totalCost * 2,
    total_cost: totalCost,
    duration_days: durationDays,
    advance_pct: 30,
    retention_pct: 5,
    payment_terms_days: 45,
    bg_required: contractValue > 30000000,
    bg_rate_annual: 0.04,
    working_capital_rate: 0.20,
    profit_tax_rate: 0.20
  });

  let analysis;
  if (aiProvider.isStubMode()) {
    onThought('stub-режим: детерминированный финансовый анализ');
    analysis = buildStubAnalysis(cashFlow);
  } else {
    onThought('Opus 4.7 анализирует финансовую модель…');
    try {
      const result = await aiProvider.completeWithStream({
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Модель:\n${JSON.stringify(cashFlow, null, 2)}\nТЗ:\n${JSON.stringify(tz)}` }],
        model: 'opus-4-7',
        onThought: (t) => onThought(t)
      });
      analysis = (result._stub || !result.text) ? buildStubAnalysis(cashFlow) : parseStrictJson(result.text);
    } catch (e) {
      onThought(`⚠ Opus недоступен (${e.message}) — детерминированный анализ`);
      analysis = buildStubAnalysis(cashFlow);
    }
  }

  return {
    summary: `ROI ${analysis.roi_pct}%, кассовый разрыв ${formatRub(cashFlow.max_cash_gap)}, чистая прибыль ${formatRub(cashFlow.net_profit)}`,
    key_findings: analysis.key_findings || [],
    cash_flow: cashFlow,
    analysis,
    bg_cost: cashFlow.bg_total_cost,
    retention_amount: cashFlow.retention_amount,
    working_capital_cost: cashFlow.working_capital_cost,
    profit_tax: cashFlow.profit_tax,
    net_profit: cashFlow.net_profit,
    clarifications: []
  };
}

module.exports = { run, buildStubAnalysis };
