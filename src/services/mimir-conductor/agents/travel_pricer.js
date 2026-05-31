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

/** Справочная оценка цены билета по транспорту и расстоянию (₽, в одну сторону). */
function estimatePrice(transport, distanceKm) {
  const d = Number(distanceKm) || 0;
  if (transport === 'plane') return Math.max(6000, Math.round(d * 4));      // ~4 ₽/км, мин 6000
  if (transport === 'train') return Math.max(1500, Math.round(d * 3.5));    // купе ~3.5 ₽/км
  if (transport === 'auto') return Math.max(0, Math.round(d * 12));         // ГСМ ~12 ₽/км
  return 3000;
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

  for (const leg of legs) {
    if (leg.transport === 'auto' || leg.transport === 'unknown') {
      // Авто — ГСМ, не билет; оценим по справочнику.
      const price = estimatePrice(leg.transport, leg.distance_km);
      pricedLegs.push({ ...leg, price_per_ticket: price, source: 'оценка ГСМ' });
      continue;
    }

    let price = null;
    let source = 'оценка';
    if (!stub) {
      try {
        const kind = leg.transport === 'plane' ? 'авиабилет' : 'РЖД билет купе';
        const result = await aiProvider.searchWeb({
          query: `${kind} ${leg.from} ${leg.to} 2026 цена`,
          model: 'sonar-opus',
          maxResults: 5
        });
        const prices = (result.citations || []).map((c) => extractPrice(c.snippet || c.title)).filter(Boolean);
        const med = median(prices);
        if (med) { price = med; source = 'медиана по найденным'; }
      } catch (e) {
        onThought(`⚠ поиск билетов не удался (${leg.from}→${leg.to}): ${e.message}`);
      }
    }
    if (price == null) price = estimatePrice(leg.transport, leg.distance_km);
    pricedLegs.push({ ...leg, price_per_ticket: price, source });
  }

  const totalTravel = pricedLegs.reduce((s, l) => s + (Number(l.price_per_ticket) || 0), 0);

  return {
    summary: `Проезд: ${pricedLegs.length} плеч, итого ${formatRub(totalTravel)}${stub ? ' (stub: справочные оценки)' : ''}`,
    key_findings: pricedLegs.slice(0, 8).map((l) => `${l.who}: ${l.from}→${l.to} (${l.transport}) ${formatRub(l.price_per_ticket)}`),
    legs: pricedLegs,
    total_travel: Math.round(totalTravel),
    clarifications: []
  };
}

module.exports = { run, estimatePrice, median };
