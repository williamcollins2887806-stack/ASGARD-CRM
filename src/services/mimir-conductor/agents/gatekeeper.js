/**
 * ASGARD CRM — Mimir Conductor: агент «Входной контроль» (Сессия 6, Шаг 6.2)
 * ═══════════════════════════════════════════════════════════════════════════
 * Берёт tz_summary (+ drawings_summary при наличии) → проверяет полноту и
 * корректность исходных данных ДО начала просчёта. Выявляет красные флаги:
 * отсутствующие приложения, неактуальные ревизии, отсутствие штампов РВП,
 * требования СТО заказчика.
 *
 * Артефакт: gatekeeper_report
 *   { summary, key_findings[], violations:[{severity,text}], completeness_ok,
 *     clarifications:[{channel,question_ru,...}] }
 *
 * Sonnet 4.6. STUB-режим: детерминированная проверка по правилам (без LLM).
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const aiProvider = require('../../ai-provider');
const { parseStrictJson, thoughtSink } = require('./_util');

const SYSTEM_PROMPT = `Ты — инженер входного контроля ООО «Асгард Сервис».
Проверяешь комплектность и корректность исходных данных проекта ПЕРЕД просчётом.
Ищи: отсутствующие приложения (упомянуты, но не приложены), устаревшие ревизии,
отсутствие штампов «В производство работ», несоответствие СТО заказчика.

Между шагами: "THOUGHT: <одно предложение>".

Верни СТРОГО JSON:
{ "completeness_ok": true|false,
  "violations": [ {"severity":"red|yellow", "text":"..."} ],
  "key_findings": ["..."],
  "clarifications": [ {"channel":"CUSTOMER|PM","question_ru":"...","why_we_ask":"...","blocking":true|false} ] }`;

/** Детерминированная проверка для stub. */
function ruleCheck(tz, drawings) {
  const violations = [];
  const clarifications = [];

  if (tz.customer && tz.customer.requires_STO_compliance) {
    const codes = (tz.customer.STO_codes || []).join(', ');
    const codesPart = codes ? ` (${codes})` : '';
    violations.push({ severity: 'yellow', text: `Требуется соответствие СТО заказчика${codesPart} — проверить шифры в каталоге.` });
  }
  if (!tz.has_volumes) {
    violations.push({ severity: 'red', text: 'В ТЗ не определены объёмы работ — просчёт без объёмов недостоверен.' });
    clarifications.push({ channel: 'CUSTOMER', category: 'scope', question_ru: 'Просим предоставить ведомость объёмов работ (ВОР) или уточнить объёмы по позициям.', why_we_ask: 'Без объёмов невозможно нормирование ресурсов.', blocking: true });
  }
  if (drawings && Array.isArray(drawings.drawings) && drawings.drawings.length) {
    const noStamp = drawings.drawings.filter((d) => d && d.in_production_stamp === false);
    if (noStamp.length) {
      violations.push({ severity: 'yellow', text: `${noStamp.length} чертеж(ей) без штампа «В производство работ».` });
    }
  }
  const timing = tz.timing || {};
  if (!timing.start && !timing.duration_days) {
    violations.push({ severity: 'yellow', text: 'Сроки выполнения не заданы — длительность будет принята по умолчанию.' });
  }

  return {
    completeness_ok: !violations.some((v) => v.severity === 'red'),
    violations,
    key_findings: violations.length ? violations.map((v) => `[${v.severity}] ${v.text}`) : ['Грубых нарушений комплектности не выявлено'],
    clarifications
  };
}

async function run({ requiredArtifacts, onThought }) {
  const tz = requiredArtifacts.tz_summary || {};
  const drawings = requiredArtifacts.drawings_summary || null;

  onThought('Проверяю комплектность исходных данных…');

  let report;
  if (aiProvider.isStubMode()) {
    onThought('stub-режим: проверка по детерминированным правилам');
    report = ruleCheck(tz, drawings);
  } else {
    try {
      const userMessage = `Сводка ТЗ:\n${JSON.stringify(tz, null, 2)}\n\nЧертежи:\n${JSON.stringify(drawings, null, 2)}`;
      const result = await aiProvider.completeWithStream({
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        model: 'sonnet-4-6',
        onThought: (t) => onThought(t),
        onText: thoughtSink((t) => onThought(t))
      });
      report = result._stub ? ruleCheck(tz, drawings) : parseStrictJson(result.text);
    } catch (e) {
      onThought(`⚠ LLM недоступна (${e.message}) — проверка по правилам`);
      report = ruleCheck(tz, drawings);
    }
  }

  const redCount = (report.violations || []).filter((v) => v.severity === 'red').length;
  return {
    summary: `Входной контроль: ${(report.violations || []).length} замечаний (${redCount} критич.)`,
    key_findings: report.key_findings || [],
    completeness_ok: report.completeness_ok !== false,
    violations: report.violations || [],
    clarifications: report.clarifications || []
  };
}

module.exports = { run, ruleCheck };
