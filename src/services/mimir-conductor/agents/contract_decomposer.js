/**
 * ASGARD CRM — Mimir Conductor: агент «Декомпозитор договора» (Сессия 7, Шаг 7.6)
 * ═══════════════════════════════════════════════════════════════════════════
 * Opus 4.7 — разделяет работы по способу исполнения: свои силы / субподряд /
 * давальческие материалы заказчика. Триггерится при субподрядных сигналах.
 *
 * Артефакт: scope_breakdown
 *   { summary, key_findings[], own_works[], subcontract_works[],
 *     customer_supplied[], clarifications[] }
 *
 * STUB-режим: эвристическое разделение по ключевым словам метода/работ.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const aiProvider = require('../../ai-provider');
const { parseStrictJson } = require('./_util');

const SYSTEM_PROMPT = `Ты — юрист-сметчик ООО «Асгард Сервис». Анализируешь договор
и ТЗ, разделяешь работы по способу исполнения: что делаем сами, что отдаём
субподрядчикам, что является давальческими материалами заказчика.

Верни СТРОГО JSON:
{ "own_works": [{"work":"...","reason":"..."}],
  "subcontract_works": [{"work":"...","reason":"...","est_pct":число}],
  "customer_supplied": [{"item":"...","note":"..."}],
  "key_findings": ["..."] }`;

// Работы, которые обычно отдают на субподряд.
const SUBCONTRACT_HINTS = /рентген|радиограф|узк|неразрушающ|изоляц|антикоррозион|геодез|лаборатор|вышк|кран|спецтехник|водолаз/i;
const CUSTOMER_SUPPLIED_HINTS = /давальческ|материал заказчика|поставка заказчика|реагент заказчик/i;

/** Эвристическое разделение для stub. */
function ruleDecompose(tz) {
  const works = (tz.scope && tz.scope.main_works) || [];
  const ownWorks = [];
  const subWorks = [];
  for (const w of works) {
    const name = (typeof w === 'string' ? w : (w.type || w.name || '')).toString();
    if (SUBCONTRACT_HINTS.test(name)) {
      subWorks.push({ work: name, reason: 'Специализированный вид работ — типично на субподряд', est_pct: 10 });
    } else {
      ownWorks.push({ work: name, reason: 'Профильная работа Асгарда — своими силами' });
    }
  }
  const text = JSON.stringify(tz).toLowerCase();
  const customerSupplied = [];
  if (CUSTOMER_SUPPLIED_HINTS.test(text)) {
    customerSupplied.push({ item: 'Давальческие материалы/реагенты заказчика', note: 'Признаки давальческой схемы в ТЗ' });
  }
  return {
    own_works: ownWorks,
    subcontract_works: subWorks,
    customer_supplied: customerSupplied,
    key_findings: [
      `Своими силами: ${ownWorks.length} видов работ`,
      `На субподряд: ${subWorks.length} видов работ`,
      customerSupplied.length ? 'Выявлена давальческая схема — уточнить перечень' : 'Давальческие материалы не выявлены'
    ]
  };
}

async function run({ requiredArtifacts, onThought }) {
  const tz = requiredArtifacts.tz_summary || {};

  onThought('Разделяю работы: свои силы / субподряд / давальческое…');

  let report;
  if (aiProvider.isStubMode()) {
    onThought('stub-режим: эвристическое разделение');
    report = ruleDecompose(tz);
  } else {
    try {
      const result = await aiProvider.completeWithStream({
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Сводка ТЗ:\n${JSON.stringify(tz, null, 2)}` }],
        model: 'opus-4-7',
        onThought: (t) => onThought(t)
      });
      report = (result._stub || !result.text) ? ruleDecompose(tz) : parseStrictJson(result.text);
    } catch (e) {
      onThought(`⚠ Opus недоступен (${e.message}) — эвристика`);
      report = ruleDecompose(tz);
    }
  }

  const subWorks = report.subcontract_works || [];
  const clarifications = [];
  if ((report.customer_supplied || []).length) {
    clarifications.push({
      channel: 'CUSTOMER', category: 'scope', blocking: false,
      question_ru: 'Подтвердите перечень давальческих материалов/оборудования заказчика и порядок их передачи — это влияет на стоимость и ответственность.'
    });
  }

  return {
    summary: `Декомпозиция: ${(report.own_works || []).length} своими силами, ${subWorks.length} на субподряд`,
    key_findings: report.key_findings || [],
    own_works: report.own_works || [],
    subcontract_works: subWorks,
    customer_supplied: report.customer_supplied || [],
    clarifications
  };
}

module.exports = { run, ruleDecompose };
