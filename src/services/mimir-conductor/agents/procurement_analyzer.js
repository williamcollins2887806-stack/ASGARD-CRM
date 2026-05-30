/**
 * ASGARD CRM — Mimir Conductor: агент «Закупки — анализ» (Сессия 6, Шаг 6.8)
 * ═══════════════════════════════════════════════════════════════════════════
 * По market_offers выбирает оптимального поставщика для каждой позиции и считает
 * закупочную стоимость. Sonnet 4.6 (выбор по цене/надёжности).
 *
 * Артефакт: procurement
 *   { summary, key_findings[], selected:[{item,supplier,price,qty,total,url}],
 *     total_procurement }
 *
 * STUB-режим: детерминированный выбор минимальной валидной цены (без LLM); если
 * цен нет (stub-поиск) — оценочная цена-плейсхолдер с пометкой.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const aiProvider = require('../../ai-provider');
const { parseStrictJson, thoughtSink, formatRub } = require('./_util');

const SYSTEM_PROMPT = `Ты — специалист по закупкам ООО «Асгард Сервис».
По найденным предложениям выбери оптимального поставщика для каждой позиции
(баланс цены, надёжности, сроков). Посчитай закупочную стоимость.

Верни СТРОГО JSON:
{ "selected": [ {"item":"...","supplier":"...","price":0,"qty":0,"total":0,"url":"...","reason":"..."} ],
  "key_findings": ["..."] }`;

const PLACEHOLDER_UNIT_PRICE = 5000; // оценочная цена позиции, если рынок не дал цифр (stub)

/** Детерминированный выбор для stub: минимальная валидная цена по позиции. */
function ruleSelect(offers) {
  const selected = [];
  let estimatedCount = 0;
  for (const o of offers || []) {
    const priced = (o.results || []).filter((r) => r.price && r.price > 0);
    const qty = Number(o.qty) || 1;
    let chosen;
    if (priced.length) {
      chosen = priced.reduce((min, r) => (r.price < min.price ? r : min), priced[0]);
    } else {
      estimatedCount++;
      chosen = { supplier: '(оценка)', price: PLACEHOLDER_UNIT_PRICE, url: null };
    }
    const total = chosen.price * qty;
    selected.push({
      item: o.item, supplier: chosen.supplier, price: chosen.price, qty, total, url: chosen.url || null,
      reason: priced.length ? 'минимальная валидная цена из найденных' : 'цена не найдена — оценочный плейсхолдер'
    });
  }
  return { selected, _estimated_count: estimatedCount };
}

async function run({ requiredArtifacts, onThought }) {
  const market = requiredArtifacts.market_offers || {};
  const offers = Array.isArray(market.offers) ? market.offers : [];

  if (!offers.length) {
    onThought('Нет предложений для анализа — закупка не требуется');
    return { summary: 'Закупка не требуется', key_findings: [], selected: [], total_procurement: 0, clarifications: [] };
  }

  onThought('Анализирую предложения и выбираю поставщиков…');

  let report;
  if (aiProvider.isStubMode()) {
    onThought('stub-режим: выбираю минимальную валидную цену детерминированно');
    report = ruleSelect(offers);
  } else {
    try {
      const userMessage = `Найденные предложения:\n${JSON.stringify(offers, null, 2)}`;
      const result = await aiProvider.completeWithStream({
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        model: 'sonnet-4-6',
        onThought: (t) => onThought(t),
        onText: thoughtSink((t) => onThought(t))
      });
      report = result._stub ? ruleSelect(offers) : parseStrictJson(result.text);
    } catch (e) {
      onThought(`⚠ LLM недоступна (${e.message}) — выбор по правилам`);
      report = ruleSelect(offers);
    }
  }

  const selected = report.selected || [];
  const totalProcurement = selected.reduce((s, x) => s + (Number(x.total) || 0), 0);
  const estimated = report._estimated_count || selected.filter((s) => /оценоч|оценка/i.test(s.reason || '')).length;

  return {
    summary: `Закупка: ${selected.length} позиций на ${formatRub(totalProcurement)}${estimated ? ' (' + estimated + ' оценочно)' : ''}`,
    key_findings: report.key_findings || selected.slice(0, 8).map((s) => `${s.item}: ${s.supplier} — ${formatRub(s.total)}`),
    selected,
    total_procurement: Math.round(totalProcurement),
    clarifications: []
  };
}

module.exports = { run, ruleSelect };
