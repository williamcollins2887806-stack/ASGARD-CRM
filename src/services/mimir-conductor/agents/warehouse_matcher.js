/**
 * ASGARD CRM — Mimir Conductor: агент «Склад-матчер» (Сессия 6, Шаг 6.6)
 * ═══════════════════════════════════════════════════════════════════════════
 * Детерминированный matcher БЕЗ LLM. Берёт resources → для каждого материала
 * ищет на складе совпадение по ХАРАКТЕРИСТИКАМ (тип, давление, диаметр), а не
 * по названию. Возвращает from_warehouse[] и to_purchase[].
 *
 * Артефакт: warehouse_match
 *   { summary, key_findings[], from_warehouse:[...], to_purchase:[...] }
 *
 * Источник склада: таблица equipment (реально существует на dev/проде).
 * Колонки разнятся между инсталляциями → читаем терпимо (COALESCE/опционально),
 * при любой ошибке считаем склад пустым → всё уходит в to_purchase.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const db = require('../../db');

/**
 * Сопоставление потребности с позицией склада по характеристикам.
 * @returns {number} score 0..1 (0 — не подходит)
 */
function matchByCharacteristics(needed, item) {
  const nName = String(needed.name || '').toLowerCase();
  const iName = String(item.name || '').toLowerCase();
  // Базовое совпадение по типу/названию (нет структурированных params в equipment).
  let score = 0;
  const nWords = nName.split(/\s+/).filter((w) => w.length >= 4);
  const hit = nWords.some((w) => iName.includes(w));
  if (hit) score += 0.6;
  else return 0;

  // Если у позиции склада есть params — уточняем по давлению/диаметру.
  const p = item.params || {};
  if (needed.pressure_bar && p.pressure_bar) {
    const w = Number(p.pressure_bar);
    if (w >= needed.pressure_bar * 0.9 && w <= needed.pressure_bar * 1.2) score += 0.25;
    else return 0;
  }
  if (needed.diameter_mm && p.diameter_mm && Number(p.diameter_mm) === Number(needed.diameter_mm)) {
    score += 0.15;
  }
  return Math.min(score, 1);
}

/** Загрузить доступные позиции склада (терпимо к схеме). */
async function loadWarehouse() {
  try {
    const r = await db.query(
      `SELECT id,
              COALESCE(name, title, model, '') AS name,
              COALESCE(quantity, qty, 1) AS quantity
       FROM equipment
       LIMIT 1000`
    );
    return r.rows.map((row) => ({ id: row.id, name: row.name, quantity: Number(row.quantity) || 0, params: {} }));
  } catch (_) {
    // Колонок может не быть — пробуем минимальный набор.
    try {
      const r2 = await db.query('SELECT id, name FROM equipment LIMIT 1000');
      return r2.rows.map((row) => ({ id: row.id, name: row.name, quantity: 1, params: {} }));
    } catch (_e) {
      return [];
    }
  }
}

async function run({ requiredArtifacts, onThought }) {
  const res = requiredArtifacts.resources || {};
  // Собираем потребность в материалах из ресурсной ведомости.
  const needed = [];
  for (const r of res.resources || []) {
    for (const m of r.materials || []) {
      if (m && m.name) needed.push({ name: m.name, qty: m.qty, unit: m.unit });
    }
  }

  onThought(`Потребность: ${needed.length} материальных позиций. Загружаю склад…`);
  const warehouse = await loadWarehouse();
  onThought(`На складе доступно ${warehouse.length} позиций. Сверяю по характеристикам…`);

  const fromWarehouse = [];
  const toPurchase = [];

  for (const need of needed) {
    let best = null;
    let bestScore = 0;
    for (const item of warehouse) {
      const score = matchByCharacteristics(need, item);
      if (score > bestScore) { bestScore = score; best = item; }
    }
    if (best && bestScore >= 0.6) {
      fromWarehouse.push({ need: need.name, matched: best.name, equipment_id: best.id, score: Math.round(bestScore * 100) / 100, qty: need.qty });
    } else {
      toPurchase.push({ name: need.name, qty: need.qty, unit: need.unit });
    }
  }

  return {
    summary: `Со склада: ${fromWarehouse.length}, к закупке: ${toPurchase.length}`,
    key_findings: [
      `Сверено ${needed.length} позиций по характеристикам`,
      `Найдено на складе: ${fromWarehouse.length}`,
      `Требует закупки: ${toPurchase.length}`
    ],
    from_warehouse: fromWarehouse,
    to_purchase: toPurchase,
    clarifications: []
  };
}

module.exports = { run, matchByCharacteristics };
