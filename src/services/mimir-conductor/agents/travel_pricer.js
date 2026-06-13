/**
 * ASGARD CRM — Mimir Conductor: агент «Билеты» (Сессия 6, Шаг 6.10)
 * ═══════════════════════════════════════════════════════════════════════════
 * По routing_plan ищет цены билетов (РЖД/авиа) на плечи маршрутов через
 * ai-provider.searchWeb (Perplexity Sonar). Берёт медиану по 3-5 предложениям.
 *
 * Артефакт: travel_cost
 *   { summary, key_findings[], legs:[{who,from,to,transport,price_per_ticket,source}],
 *     total_travel }
 *
 * STUB-режим: searchWeb замокан → используем справочные оценки по транспорту/
 * расстоянию (без расхода баланса).
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const aiProvider = require('../../ai-provider');
const { formatRub } = require('./_util');
const { resolveNorm } = require('./_norms');

// БЕЗ ХАРДКОДА. Ставки и минимумы — только из applicable_norms.travel_rates_rub_per_km/min.
// Если нет — null (caller знает что искать через searchWeb или blocking).

/** Цена за км из applicable_norms. Если нет — null. */
function estimatePrice(transport, distanceKm, requiredArtifacts) {
  const d = Number(distanceKm) || 0;
  const r = resolveNorm(requiredArtifacts || {}, `travel_rates_rub_per_km.${transport}`, null);
  const minR = resolveNorm(requiredArtifacts || {}, `travel_min_rub.${transport}`, null);
  if (r.value == null) return null;
  const ratePerKm = Number(r.value);
  const min = minR.value != null ? Number(minR.value) : 0;
  return { price: Math.max(min, Math.round(d * ratePerKm)), source: r.tier };
}

/** Медиана массива чисел. */
function median(arr) {
  const a = arr.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2);
}

function extractPrice(text) {
  const m = String(text || '').match(/(\d[\d\s.,]{2,})\s*(?:руб|₽|р\.)/i);
  if (!m) return null;
  const num = Number(m[1].replace(/[\s.]/g, '').replace(',', '.'));
  return Number.isFinite(num) ? num : null;
}

async function run({ requiredArtifacts, onThought }) {
  const routing = requiredArtifacts.routing_plan || {};
  const legs = Array.isArray(routing.legs) ? routing.legs : [];

  if (!legs.length) {
    onThought('Нет плеч маршрута — проезд не требуется');
    return { summary: 'Проезд не требуется', key_findings: [], legs: [], total_travel: 0, clarifications: [] };
  }

  const stub = aiProvider.isStubMode();
  const pricedLegs = [];
  const unresolved = [];

  for (const leg of legs) {
    let price = null;
    let source = null;
    // Шаг 1: AI web search (perplexity sonar) — реальная цена в интернете
    if (!stub) {
      try {
        const kind = leg.transport === 'plane' ? 'авиабилет'
          : leg.transport === 'train' ? 'РЖД билет купе'
          : leg.transport === 'auto' ? 'автомобиль ГСМ топливо' : 'трансфер';
        const result = await aiProvider.searchWeb({
          query: `${kind} ${leg.from} ${leg.to} 2026 цена`,
          model: 'sonar-opus', maxResults: 5
        });
        const prices = (result.citations || []).map((c) => extractPrice(c.snippet || c.title)).filter(Boolean);
        const med = median(prices);
        if (med) { price = med; source = 'web_search_median'; }
      } catch (e) {
        onThought(`⚠ поиск билетов не удался (${leg.from}→${leg.to}): ${e.message}`);
      }
    }
    // Шаг 2: applicable_norms (эталон) — ставка ₽/км
    if (price == null) {
      const est = estimatePrice(leg.transport, leg.distance_km, requiredArtifacts);
      if (est && est.price != null) { price = est.price; source = est.source; }
    }
    if (price == null) {
      unresolved.push(`${leg.from}→${leg.to} (${leg.transport})`);
    } else {
      pricedLegs.push({ ...leg, price_per_ticket: price, source });
    }
  }
  if (unresolved.length === legs.length) {
    // Структура: РП заполнит ставку ₽/км для типов транспорта (применится ко всем плечам этого типа)
    const transportsNeeded = [...new Set(legs.map((l) => l.transport))].filter(Boolean);
    const TRANS_LABELS = { plane: 'Авиа', train: 'РЖД (купе)', auto: 'Авто (ГСМ)', unknown: 'Трансфер' };
    const expected_inputs = transportsNeeded.map((t) => ({
      key: `rate_${t}`,
      label: `Ставка "${TRANS_LABELS[t] || t}" (₽/км)`,
      type: 'number', unit: '₽/км',
      hint: `Стоимость 1 км ${TRANS_LABELS[t] || t}. Например авиа ~4₽/км, РЖД ~3.5₽/км, авто ГСМ ~12₽/км. Сохранится в reference_norms.travel_rates_rub_per_km.${t}.`,
      target: `reference_norms.travel_rates_rub_per_km.${t}`
    }));
    return {
      summary: 'BLOCKED: цены билетов не найдены ни в эталонах, ни через web search',
      key_findings: unresolved.map((s) => `BLOCKER: цена не определена — ${s}`),
      legs: [], total_travel: 0,
      clarifications: [{
        channel: 'PM', category: 'travel', blocking: true,
        question_ru: `Не удалось определить цены билетов для плеч: ${unresolved.join('; ')}. Укажите ставки ₽/км.`,
        expected_inputs
      }]
    };
  }

  const totalTravel = pricedLegs.reduce((s, l) => s + (Number(l.price_per_ticket) || 0), 0);

  return {
    summary: `Проезд: ${pricedLegs.length} плеч, итого ${formatRub(totalTravel)}${stub ? ' (stub: цены из эталонов)' : ''}`,
    key_findings: pricedLegs.slice(0, 8).map((l) => `${l.who}: ${l.from}→${l.to} (${l.transport}) ${formatRub(l.price_per_ticket)} [${l.source}]`),
    legs: pricedLegs, total_travel: Math.round(totalTravel),
    clarifications: unresolved.length ? [{ channel: 'PM', category: 'travel', blocking: false,
      question_ru: `Часть плеч без цены: ${unresolved.join('; ')}. Проверьте веб-поиск или заполните applicable_norms.travel_rates_rub_per_km.` }] : []
  };
}

module.exports = { run, estimatePrice, median };
