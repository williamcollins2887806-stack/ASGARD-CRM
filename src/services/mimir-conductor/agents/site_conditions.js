/**
 * ASGARD CRM — Mimir Conductor: агент «Особые условия» (Сессия 6, Шаг 6.5)
 * ═══════════════════════════════════════════════════════════════════════════
 * По tz_summary определяет коэффициенты на ФОТ и доплаты: ОЗП, вредность,
 * ночные смены, высота, стеснённость, СИЗ, медосмотры, наряды-допуски.
 *
 * Артефакт: site_conditions
 *   { summary, key_findings[], fot_multiplier, surcharges:[{name,pct|rub,base}],
 *     total_multiplier, notes[] }
 *
 * Opus 4.7. STUB-режим: детерминированный расчёт коэффициентов (без LLM).
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const aiProvider = require('../../ai-provider');
const { parseStrictJson, thoughtSink } = require('./_util');

const SYSTEM_PROMPT = `Ты — инженер по охране труда и нормированию ООО «Асгард Сервис».
По условиям работ определи коэффициенты к ФОТ и доплаты (ОЗП, вредность,
ночные, высота, стеснённость, СИЗ, медосмотры, наряды-допуски).

Верни СТРОГО JSON:
{ "fot_multiplier": 1.0,
  "surcharges": [ {"name":"...","pct":0,"reason":"..."} ],
  "key_findings": ["..."], "notes": ["..."] }`;

/** Детерминированный расчёт коэффициентов для stub. */
function ruleConditions(tz) {
  const cond = tz.conditions || {};
  const surcharges = [];

  if (cond.has_OZP) surcharges.push({ name: 'ОЗП (особо опасное производство)', pct: 30, reason: 'Коэффициент 1.2–1.4, принято 1.3 (+30%)' });
  if (cond.has_hazardous) surcharges.push({ name: 'Вредность (класс 3.x)', pct: 12, reason: 'Доплата за вредные условия труда' });
  if (cond.regime === '24_7' || cond.regime === '2_smena') surcharges.push({ name: 'Ночные смены', pct: 20, reason: '+20% за ночные часы' });
  if (cond.has_hot_work) surcharges.push({ name: 'Огневые работы / наряды-допуски', pct: 5, reason: 'Оформление нарядов-допусков, дежурство' });
  if (/высот/i.test(String(cond.weight_limits || '') + String(cond.weather_constraints || ''))) {
    surcharges.push({ name: 'Высотные работы', pct: 10, reason: '+10% за работу на высоте' });
  }
  if (cond.operating_facility) surcharges.push({ name: 'Стеснённость / действующее производство', pct: 10, reason: '+5–15% за стеснённые условия, принято 10%' });

  // СИЗ/медосмотры — фиксированный процент (упрощённо как доплата к ФОТ).
  surcharges.push({ name: 'СИЗ и медосмотры', pct: 3, reason: 'Спецодежда, СИЗ, периодические медосмотры' });

  const totalPct = surcharges.reduce((s, x) => s + (Number(x.pct) || 0), 0);
  const fotMultiplier = Math.round((1 + totalPct / 100) * 100) / 100;

  return {
    fot_multiplier: fotMultiplier,
    surcharges,
    key_findings: [
      `Суммарная надбавка к ФОТ: +${totalPct}% (коэффициент ${fotMultiplier})`,
      ...surcharges.map((x) => `${x.name}: +${x.pct}%`)
    ],
    notes: [
      cond.has_OZP ? 'Объект относится к ОЗП — обязательны наряды-допуски и аттестация.' : 'ОЗП не выявлено.',
      'Коэффициенты приняты по верхней типовой границе; уточняются по карте СОУТ объекта.'
    ]
  };
}

async function run({ requiredArtifacts, onThought }) {
  const tz = requiredArtifacts.tz_summary || {};

  onThought('Определяю коэффициенты на ФОТ и доплаты по условиям объекта…');

  let report;
  if (aiProvider.isStubMode()) {
    onThought('stub-режим: расчёт коэффициентов по правилам');
    report = ruleConditions(tz);
  } else {
    try {
      const userMessage = `Условия и сводка ТЗ:\n${JSON.stringify({ conditions: tz.conditions, scope: tz.scope, object: tz.object }, null, 2)}`;
      const result = await aiProvider.completeWithStream({
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        model: 'opus-4-7',
        onThought: (t) => onThought(t),
        onText: thoughtSink((t) => onThought(t))
      });
      report = result._stub ? ruleConditions(tz) : parseStrictJson(result.text);
    } catch (e) {
      onThought(`⚠ LLM недоступна (${e.message}) — расчёт по правилам`);
      report = ruleConditions(tz);
    }
  }

  const totalPct = (report.surcharges || []).reduce((s, x) => s + (Number(x.pct) || 0), 0);
  const fotMultiplier = report.fot_multiplier || Math.round((1 + totalPct / 100) * 100) / 100;

  return {
    summary: `Особые условия: коэффициент к ФОТ ${fotMultiplier} (+${totalPct}%)`,
    key_findings: report.key_findings || [],
    fot_multiplier: fotMultiplier,
    surcharges: report.surcharges || [],
    total_multiplier: fotMultiplier,
    notes: report.notes || [],
    clarifications: []
  };
}

module.exports = { run, ruleConditions };
