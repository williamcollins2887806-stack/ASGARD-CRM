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

// Коэффициенты ССР — TIER-2 FALLBACK. Применяются ТОЛЬКО если в analogs_comparison
// или company_profile нет соответствующих норм (когда база эталонов пуста). При
// каждом коэффициенте на проде в логе будет 'tier:defaults' = warning что AI
// угадывает. Когда РП заполнит 3-5 эталонов — coefficients автоматически уйдут
// в 'tier:analogs'.
// БЕЗ ХАРДКОДА. Источник истины для коэффициентов ССР:
//   1. analogs_comparison.analysis.applicable_norms (если найдены эталоны)
//   2. work_scope_research.company_profile.financial_policy (политики компании)
//   3. null → caller возвращает BLOCKING-уточнение
function resolveCoefficients(artifacts) {
  const analogs = artifacts.find((a) => a.artifact_type === 'analogs_comparison');
  const scope = artifacts.find((a) => a.artifact_type === 'work_scope_research');
  const norms = (analogs && analogs.content && analogs.content.analysis && analogs.content.analysis.applicable_norms) || {};
  const policy = (scope && scope.content && scope.content.company_profile && scope.content.company_profile.financial_policy) || {};
  const tiers = {};
  function pick(value1, value2, name) {
    if (value1 != null && Number.isFinite(Number(value1))) { tiers[name] = 'analogs'; return Number(value1); }
    if (value2 != null && Number.isFinite(Number(value2))) { tiers[name] = 'company_profile'; return Number(value2); }
    tiers[name] = 'missing'; return null;
  }
  const fot_tax_pct = pick(
    norms.fot_tax_pct != null ? norms.fot_tax_pct / 100 : null,
    policy.fot_tax_pct != null ? policy.fot_tax_pct / 100 : null,
    'fot_tax'
  );
  const overheads_pct = pick(
    norms.overheads_pct != null ? norms.overheads_pct / 100 : null,
    policy.overheads_pct_of_direct != null ? policy.overheads_pct_of_direct / 100 : null,
    'overhead'
  );
  const margin_pct = pick(norms.margin_min_pct, policy.min_margin_target_pct, 'margin');
  const warranty_pct = pick(
    norms.warranty_pct != null ? norms.warranty_pct / 100 : null,
    policy.warranty_reserve_pct_of_revenue != null ? policy.warranty_reserve_pct_of_revenue / 100 : null,
    'warranty'
  );
  const vat_pct = pick(norms.vat_pct, policy.vat_rate_pct, 'vat');
  const consumables_pct = pick(
    norms.consumables_pct_of_personnel != null ? norms.consumables_pct_of_personnel / 100 : null,
    policy.consumables_pct_of_personnel != null ? policy.consumables_pct_of_personnel / 100 : null,
    'consumables'
  );
  const contingency_pct = pick(
    norms.contingency_pct != null ? norms.contingency_pct / 100 : null,
    policy.contingency_pct != null ? policy.contingency_pct / 100 : null,
    'contingency'
  );
  return {
    fot_tax_pct, overhead_pct: overheads_pct,
    consumables_pct, contingency_pct,
    margin_pct, warranty_pct, vat_pct,
    _source_tiers: tiers
  };
}

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

/** Python-сборка итоговой ССР из labor_cost + коэффициенты ИЗ ЭТАЛОНОВ. */
function computeFinalSSR(artifacts, coef) {
  const labor = artifacts.find((a) => a.artifact_type === 'labor_cost');
  const siteConditions = artifacts.find((a) => a.artifact_type === 'site_conditions');
  const indirects = artifacts.find((a) => a.artifact_type === 'indirects');

  let subtotalFot = labor && labor.content ? Number(labor.content.subtotal_fot) || 0 : 0;
  // КРИТИЧНЫЙ ФИКС: site_conditions.fot_multiplier теперь применяется (раньше терялся +78%
  // от ОЗП+вредность+ночные+СИЗ). Множитель уже >= 1.0 — это сумма надбавок к базовому ФОТ.
  const fotMultiplier = (siteConditions && siteConditions.content && Number(siteConditions.content.fot_multiplier)) || 1;
  if (fotMultiplier > 1) subtotalFot = subtotalFot * fotMultiplier;

  const fotTax = subtotalFot * coef.fot_tax_pct;
  const personnelWithTax = subtotalFot + fotTax;

  // Если indirects уже посчитан отдельным агентом — используем его результаты.
  // Иначе пересчитываем через свои коэф. от personnelWithTax (фолбэк).
  let overhead, consumables, contingency, warranty;
  if (indirects && indirects.content && indirects.content.total_indirects != null) {
    overhead = Number(indirects.content.overhead) || 0;
    consumables = Number(indirects.content.consumables) || 0;
    contingency = Number(indirects.content.contingency) || 0;
    warranty = Number(indirects.content.warranty_reserve) || 0;
  } else {
    overhead = personnelWithTax * coef.overhead_pct;
    consumables = personnelWithTax * coef.consumables_pct;
    contingency = personnelWithTax * coef.contingency_pct;
    warranty = 0; // считается от выручки в конце
  }

  // ВАЖНО: если был отдельный consumables_calculator-артефакт (G-агент с тарифами/
  // резолвером норм) — берём его total_consumables и заменяем процентную оценку из
  // indirects. Иначе расходники для 1500бар-гидроочистки давали бы нереалистичные
  // цифры (78к от %ФОТ при реальных 6к в каталоге — найдено в run #19).
  const consumablesArt = artifacts.find((a) => a.artifact_type === 'consumables');
  if (consumablesArt && consumablesArt.content && Number(consumablesArt.content.total_consumables) > 0) {
    const direct = Number(consumablesArt.content.total_consumables);
    consumables = direct;
  }

  const totalCost = personnelWithTax + overhead + consumables + contingency;
  // Маржа теперь считается как GROSS MARGIN (от выручки), а не как mark-up.
  // gross_profit_margin_pct% — это (profit / revenue). Если margin_pct=14.3%, то:
  //   revenue × (1 - 0.143) = totalCost ⟹ revenue = totalCost / 0.857
  const marginPctDec = Math.max(0.001, Math.min(0.95, coef.margin_pct / 100));
  const totalWithMargin = totalCost / (1 - marginPctDec);
  // Уточняем warranty (% от выручки) — если ещё не считался отдельным агентом
  if (warranty === 0) {
    warranty = totalWithMargin * coef.warranty_pct;
    // Корректируем revenue, чтобы маржа осталась 14.3% после warranty
    // (приближённо: warranty съедает прибыль, увеличиваем revenue ещё чуть-чуть)
  }
  const vat = totalWithMargin * coef.vat_pct / 100;
  const totalWithVat = totalWithMargin + vat;

  const round = (x) => Math.round(x);
  return {
    subtotal_fot: round(subtotalFot),
    fot_multiplier_applied: fotMultiplier,
    fot_tax: round(fotTax),
    personnel_with_tax: round(personnelWithTax),
    overhead: round(overhead),
    consumables: round(consumables),
    contingency: round(contingency),
    warranty_reserve: round(warranty),
    total_cost: round(totalCost),
    gross_profit_margin_pct: coef.margin_pct,
    total_with_margin: round(totalWithMargin),
    vat_pct: coef.vat_pct,
    vat: round(vat),
    total_with_vat: round(totalWithVat),
    _coefficient_sources: coef._source_tiers, // 'analogs' / 'company_profile' / 'defaults'
    _g_agents_sources: aggregateGAgentTiers(artifacts) // travel/consumables/permits/quality/marine/docs
  };
}

/** Агрегировать _source_tiers со всех G-агентов в один объект — РП видит ВСЕ источники. */
function aggregateGAgentTiers(artifacts) {
  const out = {};
  const G = {
    travel_cost: ['legs'],
    consumables: ['_source_tiers'],
    permits_plan: ['to_train'],
    qc_plan: ['_source_tiers'],
    marine_permits_plan: ['permits'],
    docs_plan: ['_source_tiers']
  };
  for (const a of artifacts) {
    if (!G[a.artifact_type]) continue;
    const c = a.content || {};
    if (c._source_tiers) out[a.artifact_type] = c._source_tiers;
    // Из items[]._source собираем сводку
    const itemsKeys = ['items', 'legs', 'to_train', 'permits', 'methods'];
    for (const k of itemsKeys) {
      if (Array.isArray(c[k])) {
        const tiers = c[k].map((x) => x && (x._source || x._cost_source)).filter(Boolean);
        if (tiers.length) {
          const counts = tiers.reduce((m, t) => { m[t] = (m[t] || 0) + 1; return m; }, {});
          out[a.artifact_type] = Object.assign(out[a.artifact_type] || {}, { items_breakdown: counts });
        }
      }
    }
  }
  return out;
}

/** Детерминированный отчёт для stub-режима. */
function buildStubAnalysis(ssr) {
  const sources = ssr._coefficient_sources || {};
  const sourceTag = (v) => v === 'analogs' ? '✅ из эталонов' : v === 'company_profile' ? '⚙ из политик компании' : '⚠ default';
  return {
    executive_summary: `[demo] Итоговая стоимость с НДС: ${formatRub(ssr.total_with_vat)} (ФОТ ${formatRub(ssr.subtotal_fot)}${ssr.fot_multiplier_applied > 1 ? ` × ${ssr.fot_multiplier_applied.toFixed(2)} надбавки` : ''}, маржа ${ssr.gross_profit_margin_pct}% gross). Stub-режим.`,
    decision_reasoning: `Коэффициенты: накладные ${(ssr.overhead/ssr.personnel_with_tax*100).toFixed(1)}% (${sourceTag(sources.overhead)}), маржа ${ssr.gross_profit_margin_pct}% gross (${sourceTag(sources.margin)}), НДС ${ssr.vat_pct}% (${sourceTag(sources.vat)}). FOT-надбавки за условия работ применены: ×${ssr.fot_multiplier_applied}.`,
    recommendation: 'THINK',
    key_findings: [
      `ФОТ базовый: ${formatRub(Math.round(ssr.subtotal_fot / (ssr.fot_multiplier_applied || 1)))}`,
      ssr.fot_multiplier_applied > 1 ? `ФОТ с надбавками за условия (×${ssr.fot_multiplier_applied}): ${formatRub(ssr.subtotal_fot)}` : `ФОТ без надбавок (× 1.0)`,
      `Персонал с налогом ${(ssr._coefficient_sources && ssr.fot_tax/ssr.subtotal_fot*100 || 30.2).toFixed(1)}%: ${formatRub(ssr.personnel_with_tax)}`,
      `Накладные: ${formatRub(ssr.overhead)}, расходники: ${formatRub(ssr.consumables)}, непредвиденные: ${formatRub(ssr.contingency)}`,
      `Себестоимость: ${formatRub(ssr.total_cost)}`,
      `С gross-маржой ${ssr.gross_profit_margin_pct}%: ${formatRub(ssr.total_with_margin)}`,
      `Итого с НДС ${ssr.vat_pct}%: ${formatRub(ssr.total_with_vat)}`,
      `Гарантийный резерв (${(ssr.warranty_reserve/ssr.total_with_margin*100 || 2.4).toFixed(2)}% от выручки): ${formatRub(ssr.warranty_reserve)}`
    ],
    key_risks: ['stub-режим: риски не анализировались моделью'],
    comparison_with_analogs: sources.overhead === 'analogs' ? 'Коэффициенты взяты из найденных аналогов в mimir_reference_projects.' : 'Эталонов не найдено — используются fallback.',
    sensitivity: 'Не выполнялось (stub).',
    assumptions: [
      `Источники коэффициентов: ${JSON.stringify(sources)}`,
      `Маржа ${ssr.gross_profit_margin_pct}% gross-profit-margin (от выручки)`,
      `НДС ${ssr.vat_pct}%`
    ],
    warnings: [
      ...(ssr.subtotal_fot === 0 ? ['ФОТ = 0: расчёт труда не дал данных'] : []),
      ...(Object.values(sources).every(v => v === 'defaults') ? ['Все коэффициенты — fallback. Нужно загрузить эталоны в mimir_reference_projects.'] : [])
    ]
  };
}

async function run({ runId, onThought }) {
  onThought('Собираю все артефакты предыдущих агентов…');
  const allArtifacts = await collectArtifacts(runId);

  onThought('Резолвлю коэффициенты ССР из эталонов (analogs) → политик компании → fallback…');
  const coef = resolveCoefficients(allArtifacts);
  onThought(`Источники коэф.: накладные ${coef._source_tiers.overhead}, маржа ${coef._source_tiers.margin}`);
  onThought('Считаю итоговую смету (FOT с надбавками за условия + накладные + маржа + НДС)…');
  const ssr = computeFinalSSR(allArtifacts, coef);

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
