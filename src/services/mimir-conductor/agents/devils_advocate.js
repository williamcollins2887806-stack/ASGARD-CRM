/**
 * ASGARD CRM — Mimir Conductor: агент «Адвокат дьявола» (Сессия 7, Шаг 7.4)
 * ═══════════════════════════════════════════════════════════════════════════
 * Opus 4.7 с ПРОТИВОПОЛОЖНЫМ промптом — пытается развалить смету. Читает ВСЕ
 * артефакты run (final_estimate обязателен) и ищет занижения, забытые статьи,
 * оптимистичные коэффициенты, проблемы маржи/compliance.
 *
 * Артефакт: devils_advocate
 *   { summary, key_findings[], vulnerabilities[], overall_verdict, verdict_reasoning }
 *
 * STUB-режим: детерминированные эвристики-проверки по собранным артефактам.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const aiProvider = require('../../ai-provider');
const cr = require('../conductor-run');
const { parseStrictJson, formatRub } = require('./_util');

const SYSTEM_PROMPT = `Ты — независимый аудитор-скептик ООО «Асгард Сервис».
Твоя задача — ПОПЫТАТЬСЯ РАЗВАЛИТЬ эту смету.

═══ КАК ТЫ ДУМАЕШЬ ═══
- НЕ верь ничему «потому что Мимир так посчитал»
- Ищи занижения объёмов, оптимистичные коэффициенты, забытые статьи
- Думай как заказчик при защите: где придерётся?
- Думай как РП на объекте: что не учли «бумажные» сметчики?
- Думай как бухгалтер: где налоги начислены не по той ставке?

═══ ЧТО ИЩЕШЬ ═══
1. Занижения объёмов работ — соответствует ли ТЗ?
2. Оптимистичные нормы выработки
3. Забытые статьи (СИЗ для сменности, обучение, мобилизация)
4. Неверные коэффициенты (вредность не учтена, ОЗП пропущен)
5. Пропущенные риски (заказчик опаздывает с остановом)
6. Завышенная маржа («не возьмут такую цену»)
7. Заниженная маржа («оставили деньги на столе»)
8. Несоответствия СНиП/СП

═══ ФОРМАТ ═══
Верни СТРОГО JSON:
{ "vulnerabilities": [ {"severity":"CRITICAL|HIGH|MEDIUM|LOW","category":"scope|cost|margin|compliance|risk","finding":"...","evidence":"...","potential_impact_rub":число,"recommendation":"..."} ],
  "overall_verdict": "ACCEPT|ACCEPT_WITH_FIXES|REJECT_REWORK",
  "verdict_reasoning": "..." }`;

/** Список типов артефактов, присутствующих в run. */
function presentTypes(all) {
  return new Set(all.map((a) => a.artifact_type));
}

function findContent(all, type) {
  const a = all.find((x) => x.artifact_type === type);
  return a ? a.content : null;
}

/** Детерминированный аудит для stub: проверяет наличие ключевых статей. */
function ruleAudit(all) {
  const types = presentTypes(all);
  const vulnerabilities = [];
  const tz = findContent(all, 'tz_summary') || {};
  const final = findContent(all, 'final_estimate') || {};
  const ssr = final.ssr || {};

  const cond = tz.conditions || {};
  // ОЗП/особые условия учтены?
  if ((cond.has_OZP || cond.operating_facility) && !types.has('site_conditions')) {
    vulnerabilities.push({ severity: 'HIGH', category: 'scope', finding: 'Особые условия (ОЗП/действующее производство) в ТЗ есть, но артефакт site_conditions отсутствует.', evidence: 'tz_summary.conditions', potential_impact_rub: Math.round((ssr.total_cost || 0) * 0.1), recommendation: 'Запустить site_conditions и учесть коэффициенты вредности/режима.' });
  }
  // Мобилизация учтена?
  if (!types.has('pre_mob_cost')) {
    vulnerabilities.push({ severity: 'MEDIUM', category: 'cost', finding: 'Не учтены затраты на мобилизацию/подготовку (pre_mob).', evidence: 'нет артефакта pre_mob_cost', potential_impact_rub: 80000, recommendation: 'Запустить pre_mob_calculator.' });
  }
  // Допуски учтены?
  if (!types.has('permits_plan')) {
    vulnerabilities.push({ severity: 'MEDIUM', category: 'compliance', finding: 'Не учтены допуски/обучение бригады.', evidence: 'нет артефакта permits_plan', potential_impact_rub: 50000, recommendation: 'Запустить permits_planner.' });
  }
  // Маржа в разумных пределах?
  if (ssr.margin_pct != null) {
    if (ssr.margin_pct < 30) vulnerabilities.push({ severity: 'HIGH', category: 'margin', finding: `Маржа ${ssr.margin_pct}% низкая — оставляем деньги на столе либо недооценили риски.`, evidence: 'final_estimate.ssr.margin_pct', potential_impact_rub: Math.round((ssr.total_cost || 0) * 0.2), recommendation: 'Проверить риски и поднять маржу.' });
    if (ssr.margin_pct > 120) vulnerabilities.push({ severity: 'MEDIUM', category: 'margin', finding: `Маржа ${ssr.margin_pct}% высокая — риск проиграть по цене.`, evidence: 'final_estimate.ssr.margin_pct', potential_impact_rub: 0, recommendation: 'Сверить с бюджетом тендера и аналогами.' });
  }
  // ФОТ не нулевой?
  if (ssr.subtotal_fot === 0) {
    vulnerabilities.push({ severity: 'CRITICAL', category: 'scope', finding: 'ФОТ = 0 — расчёт труда не дал данных, смета недостоверна.', evidence: 'final_estimate.ssr.subtotal_fot', potential_impact_rub: ssr.total_cost || 0, recommendation: 'Перезапустить crew_composer + labor_calculator.' });
  }

  const hasCritical = vulnerabilities.some((v) => v.severity === 'CRITICAL');
  const hasHigh = vulnerabilities.some((v) => v.severity === 'HIGH');
  const verdict = hasCritical ? 'REJECT_REWORK' : (hasHigh ? 'ACCEPT_WITH_FIXES' : 'ACCEPT');

  return {
    vulnerabilities,
    overall_verdict: verdict,
    verdict_reasoning: vulnerabilities.length
      ? `Найдено ${vulnerabilities.length} уязвимостей (${vulnerabilities.filter((v) => v.severity === 'CRITICAL' || v.severity === 'HIGH').length} серьёзных).`
      : 'Серьёзных уязвимостей не выявлено — смета выглядит полной.'
  };
}

async function run({ runId, onThought }) {
  onThought('Собираю все артефакты для критической проверки…');
  const all = await cr.getAllArtifacts(runId);

  let report;
  if (aiProvider.isStubMode()) {
    onThought('stub-режим: аудит по детерминированным правилам');
    report = ruleAudit(all);
  } else {
    onThought('Opus 4.7 атакует смету в роли скептика…');
    try {
      const result = await aiProvider.completeWithStream({
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Вот собранная смета и все артефакты. Найди слабые места.\n\n${JSON.stringify(all, null, 2)}` }],
        model: 'opus-4-7',
        onThought: (t) => onThought(t)
      });
      report = (result._stub || !result.text) ? ruleAudit(all) : parseStrictJson(result.text);
    } catch (e) {
      onThought(`⚠ Opus недоступен (${e.message}) — аудит по правилам`);
      report = ruleAudit(all);
    }
  }

  const vulns = report.vulnerabilities || [];
  const totalImpact = vulns.reduce((s, v) => s + (Number(v.potential_impact_rub) || 0), 0);

  return {
    summary: `Адвокат дьявола: ${vulns.length} уязвимостей, вердикт ${report.overall_verdict || 'ACCEPT'} (потенциал ${formatRub(totalImpact)})`,
    key_findings: vulns.slice(0, 8).map((v) => `[${v.severity}] ${v.finding}`),
    vulnerabilities: vulns,
    overall_verdict: report.overall_verdict || 'ACCEPT',
    verdict_reasoning: report.verdict_reasoning || null,
    total_potential_impact_rub: totalImpact,
    clarifications: []
  };
}

module.exports = { run, ruleAudit };
