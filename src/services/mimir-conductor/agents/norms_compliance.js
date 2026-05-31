/**
 * ASGARD CRM — Mimir Conductor: агент «Нормативы заказчика» (Сессия 7, Шаг 7.7)
 * ═══════════════════════════════════════════════════════════════════════════
 * Sonnet 4.6 + RAG по СТО заказчика. Триггерится для известных строгих компаний
 * (Газпром, Транснефть, Норникель, Лукойл, Роснефть). Проверяет смету на
 * соответствие нормативам заказчика, при нарушении — clarifications.
 *
 * Артефакт: norms_compliance
 *   { summary, key_findings[], customer, strict, checks[], issues[], clarifications[] }
 *
 * STUB-режим: проверки по детерминированному чек-листу строгого заказчика.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const aiProvider = require('../../ai-provider');
const { searchNorms } = require('../rag/norms-index');
const { parseStrictJson } = require('./_util');

const STRICT_CUSTOMERS = /газпром|транснефт|роснефт|норникел|лукойл|сибур|новатэк/i;

const SYSTEM_PROMPT = `Ты — инженер по нормоконтролю ООО «Асгард Сервис».
Проверяешь смету на соответствие СТО и внутренним нормативам заказчика.
Тебе дают сводку ТЗ и найденные пункты СТО. Выяви несоответствия.

Верни СТРОГО JSON:
{ "checks": [{"requirement":"...","status":"ok|violation|unknown","note":"..."}],
  "issues": ["..."],
  "key_findings": ["..."] }`;

/** Детерминированный чек-лист для известного строгого заказчика. */
function ruleCheck(tz, customerName) {
  const checks = [
    { requirement: 'Аттестация технологии сварки по СТО заказчика (НАКС)', status: 'unknown', note: 'Подтвердить наличие аттестованных НТД' },
    { requirement: 'Допуски персонала по корпоративным стандартам заказчика', status: 'unknown', note: 'Сверить список с СТО' },
    { requirement: 'Исполнительная документация по реестру СТО', status: 'ok', note: 'Расширенный комплект ИД заложен' },
    { requirement: 'Входной контроль материалов (сертификаты, паспорта)', status: 'ok', note: 'Учтён в плане качества' }
  ];
  const issues = [];
  const cond = tz.conditions || {};
  if (cond.operating_facility) {
    issues.push('Действующее производство — обязательны наряды-допуски и согласование ППР с заказчиком по его СТО.');
  }
  return {
    checks,
    issues,
    key_findings: [
      `Заказчик «${customerName}» — строгий, действуют корпоративные СТО`,
      `Проверок выполнено: ${checks.length}, открытых вопросов: ${checks.filter((c) => c.status === 'unknown').length}`
    ]
  };
}

async function run({ requiredArtifacts, onThought }) {
  const tz = requiredArtifacts.tz_summary || {};
  const customerName = (tz.customer && tz.customer.name) || '';
  const strict = STRICT_CUSTOMERS.test(customerName) || !!(tz.customer && tz.customer.strict);

  if (!strict) {
    onThought('Заказчик не из списка строгих — углублённый нормоконтроль не требуется');
    return {
      summary: `Нормоконтроль: заказчик «${customerName || 'н/д'}» не требует углублённой проверки СТО`,
      key_findings: ['Корпоративные СТО не выявлены — применяются общие нормы (ГЭСН/ФЕР/СНиП)'],
      customer: customerName, strict: false, checks: [], issues: [], clarifications: []
    };
  }

  onThought(`Проверяю соответствие СТО заказчика «${customerName}»…`);

  // RAG: ищем релевантные пункты СТО (best-effort, индекс может быть пуст).
  let normHits = [];
  try {
    normHits = await searchNorms(`СТО ${customerName} требования к подрядчику ${(tz.scope && tz.scope.method || []).join(' ')}`, 5);
  } catch (_) { normHits = []; }

  let report;
  if (aiProvider.isStubMode()) {
    onThought('stub-режим: чек-лист строгого заказчика');
    report = ruleCheck(tz, customerName);
  } else {
    try {
      const result = await aiProvider.completeWithStream({
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `ТЗ:\n${JSON.stringify(tz, null, 2)}\n\nНайденные пункты СТО:\n${JSON.stringify(normHits, null, 2)}` }],
        model: 'sonnet-4-6',
        onThought: (t) => onThought(t)
      });
      report = (result._stub || !result.text) ? ruleCheck(tz, customerName) : parseStrictJson(result.text);
    } catch (e) {
      onThought(`⚠ LLM недоступна (${e.message}) — чек-лист`);
      report = ruleCheck(tz, customerName);
    }
  }

  const issues = report.issues || [];
  const clarifications = issues.length ? [{
    channel: 'PM', category: 'compliance', blocking: false,
    question_ru: `Заказчик «${customerName}» применяет корпоративные СТО. Подтвердите наличие у бригады требуемых аттестаций/допусков и актуальной редакции СТО.`
  }] : [];

  return {
    summary: `Нормоконтроль СТО «${customerName}»: ${(report.checks || []).length} проверок, ${issues.length} замечаний`,
    key_findings: report.key_findings || [],
    customer: customerName,
    strict: true,
    checks: report.checks || [],
    issues,
    norm_hits: normHits.length,
    clarifications
  };
}

module.exports = { run, ruleCheck, STRICT_CUSTOMERS };
