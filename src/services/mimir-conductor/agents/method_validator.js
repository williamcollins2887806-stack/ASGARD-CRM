/**
 * ASGARD CRM — Mimir Conductor: агент «Инженер-технолог» (Сессия 6, Шаг 6.4)
 * ═══════════════════════════════════════════════════════════════════════════
 * Проверяет физическую исполнимость метода производства работ по tz_summary +
 * resources. Несовместимость (метод vs условия, реагенты vs материал труб,
 * работа в действующем производстве) → clarification к заказчику/РП.
 *
 * Артефакт: method_validation
 *   { summary, key_findings[], issues:[{severity,text,suggestion}], method_ok,
 *     clarifications[] }
 *
 * Opus 4.7. STUB-режим: детерминированные эвристики совместимости (без LLM).
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const aiProvider = require('../../ai-provider');
const { parseStrictJson, thoughtSink } = require('./_util');

const SYSTEM_PROMPT = `Ты — главный технолог ООО «Асгард Сервис».
Проверяешь технологическую исполнимость метода работ: совместимость с условиями
(температура, действующее производство), совместимость реагентов с материалами,
соответствие СНиП/СП. При несоответствии предлагай альтернативу.

Между шагами: "THOUGHT: <одно предложение>".

Верни СТРОГО JSON:
{ "method_ok": true|false,
  "issues": [ {"severity":"high|medium|low","text":"...","suggestion":"..."} ],
  "key_findings": ["..."],
  "clarifications": [ {"channel":"CUSTOMER|PM","question_ru":"...","blocking":true|false} ] }`;

/** Детерминированные эвристики совместимости для stub. */
function ruleValidate(tz) {
  const issues = [];
  const clarifications = [];
  const cond = tz.conditions || {};
  const method = (tz.scope && tz.scope.method) || [];
  const methodArr = Array.isArray(method) ? method : [method];
  const methodStr = methodArr.join(' ').toLowerCase();

  // АВД при морозе без обогрева.
  if (/авд|высоко.?давл|гидродинам/.test(methodStr) && /зим|мороз|-\d/.test(String(cond.weather_constraints || ''))) {
    issues.push({ severity: 'high', text: 'АВД/гидродинамическая очистка при отрицательных температурах требует обогрева воды и защиты от обмерзания.', suggestion: 'Заложить тепловые пушки и тёплое укрытие или сместить сроки.' });
  }
  // Работа в действующем производстве.
  if (cond.operating_facility) {
    issues.push({ severity: 'medium', text: 'Работы в действующем производстве — требуется согласование останова/режима и наряды-допуски.', suggestion: 'Уточнить у заказчика окно останова.' });
    clarifications.push({ channel: 'CUSTOMER', category: 'method', question_ru: 'Предоставляется ли останов оборудования на период работ, и на какое окно? Это влияет на технологию и сроки.', blocking: false });
  }
  // Химия без указания материала труб.
  if (/хим|кислот|реаген/.test(methodStr)) {
    issues.push({ severity: 'medium', text: 'Химическая промывка: необходимо подтвердить материал труб/оборудования для подбора ингибитора (латунь/медь чувствительны к ряду кислот).', suggestion: 'Запросить материал контура.' });
    clarifications.push({ channel: 'CUSTOMER', category: 'method', question_ru: 'Уточните материал промываемого контура (сталь/нержавейка/латунь/медь) — от этого зависит выбор реагента и ингибитора.', blocking: false });
  }

  return {
    method_ok: !issues.some((i) => i.severity === 'high'),
    issues,
    key_findings: issues.length ? issues.map((i) => `[${i.severity}] ${i.text}`) : ['Метод производства работ технологически исполним'],
    clarifications
  };
}

async function run({ requiredArtifacts, onThought }) {
  const tz = requiredArtifacts.tz_summary || {};
  const resources = requiredArtifacts.resources || {};

  onThought('Проверяю технологическую исполнимость метода…');

  let report;
  if (aiProvider.isStubMode()) {
    onThought('stub-режим: проверка совместимости по правилам');
    report = ruleValidate(tz);
  } else {
    try {
      const userMessage = `Сводка ТЗ:\n${JSON.stringify(tz, null, 2)}\n\nРесурсы:\n${JSON.stringify(resources, null, 2)}`;
      const result = await aiProvider.completeWithStream({
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        model: 'opus-4-7',
        onThought: (t) => onThought(t),
        onText: thoughtSink((t) => onThought(t))
      });
      report = result._stub ? ruleValidate(tz) : parseStrictJson(result.text);
    } catch (e) {
      onThought(`⚠ LLM недоступна (${e.message}) — проверка по правилам`);
      report = ruleValidate(tz);
    }
  }

  return {
    summary: `Технологический контроль: ${(report.issues || []).length} замечаний, метод ${report.method_ok !== false ? 'исполним' : 'требует пересмотра'}`,
    key_findings: report.key_findings || [],
    method_ok: report.method_ok !== false,
    issues: report.issues || [],
    clarifications: report.clarifications || []
  };
}

module.exports = { run, ruleValidate };
