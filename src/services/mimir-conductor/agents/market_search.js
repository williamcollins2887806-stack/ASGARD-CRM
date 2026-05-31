/**
 * ASGARD CRM — Mimir Conductor: агент «Закупки — поиск рынка» (Сессия 6, Шаг 6.7)
 * ═══════════════════════════════════════════════════════════════════════════
 * Запускается, если warehouse_match.to_purchase непустой. Для каждой позиции
 * ищет актуальные цены 2026 у российских поставщиков через ai-provider.searchWeb
 * (Perplexity Sonar Opus через routerai).
 *
 * Артефакт: market_offers
 *   { summary, key_findings[], offers:[{item, results:[{supplier,price,url,snippet}], citations}] }
 *
 * STUB-режим: searchWeb возвращает замоканный ответ → offers со stub-источником,
 * цены не запрашиваются (баланс не тратится).
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const aiProvider = require('../../ai-provider');

/** Грубое извлечение цены из текста (₽). */
function extractPrice(text) {
  const m = String(text || '').match(/(\d[\d\s.,]{2,})\s*(?:руб|₽|р\.)/i);
  if (!m) return null;
  const num = Number(m[1].replace(/[\s.]/g, '').replace(',', '.'));
  return Number.isFinite(num) ? num : null;
}

/** Грубое извлечение поставщика из URL. */
function extractSupplier(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (_) {
    return null;
  }
}

async function run({ requiredArtifacts, onThought }) {
  const wh = requiredArtifacts.warehouse_match || {};
  const toPurchase = Array.isArray(wh.to_purchase) ? wh.to_purchase : [];

  if (!toPurchase.length) {
    onThought('Нечего закупать — все позиции со склада');
    return { summary: 'Закупка не требуется (всё со склада)', key_findings: [], offers: [], clarifications: [] };
  }

  const stub = aiProvider.isStubMode();
  const offers = [];

  // Ограничиваем число запросов, чтобы не плодить вызовы (и в live экономить).
  const MAX_ITEMS = 12;
  for (const item of toPurchase.slice(0, MAX_ITEMS)) {
    onThought(`Ищу цены: ${item.name}`);
    let result;
    try {
      result = await aiProvider.searchWeb({
        query: `купить ${item.name} ${item.qty || ''} ${item.unit || ''} 2026 цена Россия`,
        model: 'sonar-opus',
        maxResults: 5
      });
    } catch (e) {
      onThought(`⚠ поиск не удался для «${item.name}»: ${e.message}`);
      result = { answer: '', citations: [], _stub: stub };
    }

    const results = (result.citations || []).map((c) => ({
      supplier: extractSupplier(c.url),
      price: extractPrice(c.snippet || c.title || result.answer),
      url: c.url,
      snippet: c.snippet || ''
    }));

    offers.push({
      item: item.name,
      qty: item.qty,
      unit: item.unit,
      results,
      citations: result.citations || [],
      _stub: !!result._stub
    });
  }

  return {
    summary: `Поиск цен для ${toPurchase.length} позиций${stub ? ' (stub: реальные цены не запрашивались)' : ''}`,
    key_findings: offers.slice(0, 8).map((o) => `${o.item}: ${o.results.length} предложений`),
    offers,
    clarifications: []
  };
}

module.exports = { run, extractPrice, extractSupplier };
