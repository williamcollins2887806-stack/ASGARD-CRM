/**
 * ASGARD CRM — Mimir Conductor: агент «Главный контролёр» (Сессия 4, Шаг 4.5)
 * ═══════════════════════════════════════════════════════════════════════════
 * Самый важный агент. Собирает ВСЕ артефакты, считает итоговую ССР (Python:
 * налог на ФОТ, накладные, расходные, непредвиденные, маржа, НДС) и готовит
 * директорский отчёт (Opus 4.7 + extended thinking на живых ключах).
 *
 * Артефакт: final_estimate
 *   { summary, key_findings[], ssr{...}, analysis{...}, assumptions[], warnings[],
 *     recommendation }
 *
 * STUB-режим: Opus не вызывается реально (completeWithStream возвращает
 * синтетический текст) → отчёт собирается детерминированно из ССР. Поток мыслей
 * прогоняется через completeWithStream для War Room.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const aiProvider = require('../../ai-provider');
const cr = require('../conductor-run');
const { parseStrictJson, thoughtSink, formatRub } = require('./_util');

// Коэффициенты ССР (МДС-подобные, как в плане Сессии 4).
const FOT_TAX_PCT = 0.55;       // налог на ФОТ 55%
const OVERHEAD_PCT = 0.15;      // накладные 15%
const CONSUMABLES_PCT = 0.03;   // расходные 3%
const CONTINGENCY_PCT = 0.12;   // непредвиденные 12%
const DEFAULT_MARKUP = 2.0;     // маржа ×2.0
const DEFAULT_VAT_PCT = 22;     // НДС 22%

const FINAL_SYSTEM_PROMPT = `Ты — главный контролёр-сметчик ООО «Асгард Сервис».
Тебе дали собранную ССР и артефакты агентов. Проверь логику, обоснуй цену,
дай рекомендацию (TAKE/THINK/DECLINE).

Между шагами выдавай "THOUGHT: <одно предложение на русском>".

Верни СТРОГО JSON:
{
  "executive_summary": "3-5 предложений инженерного резюме",
  "decision_reasoning": "почему именно такая цена",
  "recommendation": "TAKE|THINK|DECLINE",
  "key_findings": ["5-8 пунктов"],
  "key_risks": ["..."],
  "comparison_with_analogs": "...",
  "sensitivity": "...",
  "assumptions": ["..."],
  "warnings": ["..."]
}`;

/** Собрать все артефакты run в массив { artifact_type, content }. */
async function collectArtifacts(runId) {
  const details = await cr.getFullRunDetails(runId);
  const types = [...new Set((details.artifacts || []).map((a) => a.artifact_type))];
  const out = [];
  for (const t of types) {
    const art = await cr.getArtifact(runId, t);
    if (art) out.push({ artifact_type: t, content: art.content });
  }
  return out;
}

/** Python-сборка итоговой ССР из labor_cost (и доп. косвенных, если есть). */
function computeFinalSSR(artifacts) {
  const labor = artifacts.find((a) => a.artifact_type === 'labor_cost');
  const subtotalFot = labor && labor.content ? Number(labor.content.subtotal_fot) || 0 : 0;

  const fotTax = subtotalFot * FOT_TAX_PCT;
  const personnelWithTax = subtotalFot + fotTax;

  const overhead = personnelWithTax * OVERHEAD_PCT;
  const consumables = personnelWithTax * CONSUMABLES_PCT;
  const contingency = personnelWithTax * CONTINGENCY_PCT;

  const totalCost = personnelWithTax + overhead + consumables + contingency;

  const markup = DEFAULT_MARKUP;
  const totalWithMargin = totalCost * markup;

  const vat = totalWithMargin * DEFAULT_VAT_PCT / 100;
  const totalWithVat = totalWithMargin + vat;

  const round = (x) => Math.round(x);
  return {
    subtotal_fot: round(subtotalFot),
    fot_tax: round(fotTax),
    personnel_with_tax: round(personnelWithTax),
    overhead: round(overhead),
    consumables: round(consumables),
    contingency: round(contingency),
    total_cost: round(totalCost),
    markup,
    total_with_margin: round(totalWithMargin),
    vat_pct: DEFAULT_VAT_PCT,
    vat: round(vat),
    total_with_vat: round(totalWithVat),
    margin_pct: (markup - 1) * 100
  };
}

/** Детерминированный отчёт для stub-режима. */
function buildStubAnalysis(ssr) {
  return {
    executive_summary: `[demo] Итоговая стоимость с НДС: ${formatRub(ssr.total_with_vat)} (ФОТ ${formatRub(ssr.subtotal_fot)}, маржа ${ssr.margin_pct}%). Собрано в stub-режиме без вызова Opus.`,
    decision_reasoning: 'Цена сформирована по стандартным коэффициентам ССР (налог ФОТ 55%, накладные 15%, расходные 3%, непредвиденные 12%, маржа ×2.0, НДС 22%).',
    recommendation: 'THINK',
    key_findings: [
      `ФОТ без налога: ${formatRub(ssr.subtotal_fot)}`,
      `Персонал с налогом: ${formatRub(ssr.personnel_with_tax)}`,
      `Себестоимость: ${formatRub(ssr.total_cost)}`,
      `С маржой: ${formatRub(ssr.total_with_margin)}`,
      `Итого с НДС: ${formatRub(ssr.total_with_vat)}`
    ],
    key_risks: ['stub-режим: риски не анализировались моделью'],
    comparison_with_analogs: 'Не выполнялось (stub).',
    sensitivity: 'Не выполнялось (stub).',
    assumptions: ['Коэффициенты ССР приняты по умолчанию', 'Маржа ×2.0, НДС 22%'],
    warnings: ssr.subtotal_fot === 0 ? ['ФОТ = 0: расчёт труда не дал данных'] : []
  };
}

async function run({ runId, onThought }) {
  onThought('Собираю все артефакты предыдущих агентов…');
  const allArtifacts = await collectArtifacts(runId);

  onThought('Считаю итоговую смету с накладными и НДС…');
  const ssr = computeFinalSSR(allArtifacts);

  onThought('Opus 4.7 готовит инженерное обоснование…');
  const userMessage = `Собрал смету. Проверь и обоснуй.\n\n${JSON.stringify({ ssr, artifacts: allArtifacts }, null, 2)}`;

  const result = await aiProvider.completeWithStream({
    system: FINAL_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    model: 'opus-4-7',
    onThought: (t) => onThought(t),
    onText: thoughtSink((t) => onThought(t))
  });

  let analysis;
  if (result._stub || aiProvider.isStubMode()) {
    onThought('stub-режим: собираю детерминированный директорский отчёт');
    analysis = buildStubAnalysis(ssr);
  } else {
    analysis = parseStrictJson(result.text);
  }

  return {
    summary: analysis.executive_summary || `Итого с НДС: ${formatRub(ssr.total_with_vat)}`,
    key_findings: analysis.key_findings || [],
    ssr,
    analysis: {
      decision_reasoning: analysis.decision_reasoning || null,
      recommendation: analysis.recommendation || 'THINK',
      key_risks: analysis.key_risks || [],
      comparison_with_analogs: analysis.comparison_with_analogs || null,
      sensitivity: analysis.sensitivity || null
    },
    recommendation: analysis.recommendation || 'THINK',
    assumptions: analysis.assumptions || [],
    warnings: analysis.warnings || [],
    clarifications: []
  };
}

module.exports = { run };
