'use strict';
/**
 * mtr-pipeline.js — МТР после разбора ДВ.
 *
 * ── Почему отдельный шаг ──────────────────────────────────────────────────
 * МТР приходил нулевым не потому, что модели нечем ответить, а потому что
 * его никто не спрашивал системно: разбор ДВ отдавал позиции объёмов, и на
 * этом заканчивался. Здесь отдельный проход: по видам работ собранного ДВ
 * определяем, что нужно физически, сверяем со СКЛАДОМ и, если позиции нет,
 * ищем цену в интернете.
 *
 * ── Агрегация, а не позиция в позицию ─────────────────────────────────────
 * 603 позиции ДВ не должны дать 603 строки МТР. Шланг на 219 аппаратов — это
 * одна потребность с количеством, а не 219 строк. Группируем по нормализован-
 * ному имени, суммируем количество, оставляем первую ссылку на ДВ.
 *
 * ── Что попадает в смету ──────────────────────────────────────────────────
 *   warehouse → раздел B (есть в наличии, цена = 0, только количество)
 *   purchase  → раздел G (закупка, цена из поиска)
 * Если цена не подтверждена (stub-поиск, нет результата) — строка помечается
 * `price_confirmed: false` и НЕ уходит в итог молча: РП должен увидеть пробел.
 */

const td = require('./tool-dispatcher');

/** Какие ресурсы нужны по виду работ. Ключ — подстрока в названии/методе. */
const RESOURCE_HINTS = [
  {
    match: /гидро|гидрод|гидроструйн|рвд|высок\w*\s+давлен/i,
    items: [
      { name: 'шланг высокого давления (РВД)', unit: 'шт', qty_per: 0.02, note: 'износ и обрыв на аппарат' },
      { name: 'форсунка гидроструйная', unit: 'шт', qty_per: 0.01, note: 'износ сопла' },
      { name: 'сальник / уплотнение насоса', unit: 'компл', qty_per: 0.02, note: 'ремкомплект насоса' }
    ]
  },
  {
    match: /химическ|кислотн|щелочн|промывк\w*\s+реагент|ингибитор|пассивац/i,
    items: [
      { name: 'ингибитор коррозии', unit: 'кг', qty_per: 0.05, note: 'на объём промывки' },
      { name: 'кислота техническая', unit: 'кг', qty_per: 0.25, note: 'рабочий раствор' },
      { name: 'нейтрализатор', unit: 'кг', qty_per: 0.08, note: 'слив после промывки' }
    ]
  },
  {
    match: /сварк|сварочн|наплавк|резк|накс/i,
    items: [
      { name: 'электроды сварочные', unit: 'кг', qty_per: 0.15, note: 'на стык' },
      { name: 'круг отрезной', unit: 'шт', qty_per: 0.05, note: 'зачистка' }
    ]
  },
  {
    match: /изоляц|теплоизол|минват|скорлуп/i,
    items: [
      { name: 'изоляция (минвата/скорлупа)', unit: 'м', qty_per: 0.3, note: 'на погонный метр' },
      { name: 'лента армированная', unit: 'рул', qty_per: 0.02, note: 'обмотка' }
    ]
  },
  {
    match: /монтаж|демонтаж|установк|замен/i,
    items: [
      { name: 'крепёж (болты, гайки, шпильки)', unit: 'компл', qty_per: 0.1, note: 'на узел' },
      { name: 'прокладка уплотнительная', unit: 'шт', qty_per: 0.1, note: 'на фланец' }
    ]
  },
  {
    match: /чистк|очистк|мойк|промыв/i,
    items: [
      { name: 'моющее средство техническое', unit: 'кг', qty_per: 0.02, note: 'на аппарат' },
      { name: 'ветошь обтирочная', unit: 'кг', qty_per: 0.01, note: 'уборка' }
    ]
  }
];

/** Всегда нужные позиции — СИЗ и расходники идут отдельно в смете, но в
 *  списке МТР должны быть, чтобы РП видел полную потребность. */
const BASE_ITEMS = [
  { name: 'перчатки защитные', unit: 'пар', qty_per_man: 1, note: 'на человека на выезд' }
];

/** Нормализует имя для группировки. */
function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[«»"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Определяет, какие ресурсы нужны, по ДВ.
 *
 * @param {object} p
 * @param {Array} p.positions — нормализованные позиции ДВ
 * @param {number} [p.people] — людей в смене (для СИЗ)
 * @param {number} [p.trips=1]
 * @returns {Array<{name:string, unit:string, qty:number, note:string, basis:string}>}
 */
function deriveNeeds(p) {
  const o = p || {};
  const positions = Array.isArray(o.positions) ? o.positions : [];
  const trips = Math.max(1, Number(o.trips) || 1);

  // Считаем «единицы объёма» по каждому виду: сколько аппаратов/тонн/метров.
  const buckets = new Map(); // ключ ресурса → { qty, unit, note, hits }

  const addNeed = (item, volumeUnits, basis) => {
    const key = normalizeName(item.name) + '|' + item.unit;
    const cur = buckets.get(key) || {
      name: item.name,
      unit: item.unit,
      qty: 0,
      note: item.note,
      basis,
      hits: 0
    };
    const q = Number(item.qty_per) > 0 ? Number(item.qty_per) * volumeUnits : 0;
    cur.qty += q;
    cur.hits += 1;
    buckets.set(key, cur);
  };

  if (!positions.length) {
    // ДВ пуст — не выдумываем потребность. Отдаём только базу по людям.
    const people = Math.max(0, Number(o.people) || 0);
    if (people > 0) {
      for (const it of BASE_ITEMS) {
        buckets.set(normalizeName(it.name) + '|' + it.unit, {
          name: it.name,
          unit: it.unit,
          qty: Math.ceil(people * (Number(it.qty_per_man) || 1) * trips),
          note: it.note,
          basis: 'люди',
          hits: 1
        });
      }
    }
    return [...buckets.values()];
  }

  for (const pos of positions) {
    const hay = [pos.name, pos.tech_equip, pos.method_name, pos.category_name]
      .filter(Boolean).join(' ');
    if (!hay) continue;

    // Объём позиции: сколько аппаратов/штук. У чистки трубок это `objects`,
    // у остальных — 1 (одна позиция = один узел).
    const units = Number(pos.objects) > 0 ? Number(pos.objects)
      : (Number(pos.volume) > 0 ? 1 : 1);

    let matched = false;
    for (const hint of RESOURCE_HINTS) {
      if (!hint.match.test(hay)) continue;
      matched = true;
      for (const item of hint.items) addNeed(item, units, pos.category_name || 'по видам работ');
    }
    if (!matched) {
      // Вид работ не распознан — берём самый общий расходник, но помечаем.
      addNeed(
        { name: 'расходные материалы (уточнить)', unit: 'компл', qty_per: 0.01, note: 'вид работ не распознан' },
        units,
        'не распознано'
      );
    }
  }

  // СИЗ по людям — отдельной строкой, если люди известны.
  const people = Math.max(0, Number(o.people) || 0);
  if (people > 0) {
    for (const it of BASE_ITEMS) {
      const key = normalizeName(it.name) + '|' + it.unit;
      const cur = buckets.get(key);
      const q = Math.ceil(people * (Number(it.qty_per_man) || 1) * trips);
      if (cur) cur.qty = Math.max(cur.qty, q);
      else {
        buckets.set(key, {
          name: it.name, unit: it.unit, qty: q, note: it.note, basis: 'люди', hits: 1
        });
      }
    }
  }

  // Округляем вверх: «0.02 шланга» бессмысленно, нужно целое.
  return [...buckets.values()]
    .map((x) => Object.assign({}, x, { qty: Math.max(0, Math.ceil(x.qty)) }))
    .filter((x) => x.qty > 0)
    .sort((a, b) => b.hits - a.hits);
}

/**
 * Сверяет потребности со складом и ищет цены для отсутствующего.
 *
 * @param {object} p
 * @param {object} p.db
 * @param {Array} p.needs — из deriveNeeds
 * @param {boolean} [p.allowWeb=true]
 * @returns {Promise<Array>} строки МТР
 */
async function resolveMtr(p) {
  const o = p || {};
  const needs = Array.isArray(o.needs) ? o.needs : [];
  const allowWeb = o.allowWeb !== false;
  const out = [];

  for (const need of needs) {
    const wh = await td.searchWarehouse(o.db, { query: need.name, limit: 5 });

    if (wh.total > 0) {
      // Берём лучшую позицию по количеству и совпадению имени.
      const best = wh.items[0];
      out.push({
        name: best.name,
        unit: best.unit || need.unit,
        qty: need.qty,
        source: 'warehouse',
        stock_qty: best.qty,
        stock_enough: best.qty >= need.qty,
        price: 0,                     // со склада — уже наше
        price_confirmed: true,
        basis: need.basis,
        note: need.note,
        // Если на складе меньше нужного, разницу докупаем.
        shortfall: Math.max(0, need.qty - best.qty)
      });
      continue;
    }

    // На складе нет — ищем цену. Без подтверждения цена остаётся null.
    let price = null;
    let confirmed = false;
    let cite = null;
    if (allowWeb) {
      const w = await td.webSearch({ query: 'цена ' + need.name + ' купить' });
      if (!w.stub && w.answer) {
        // Ищем первое РАЗУМНОЕ число рублей в ответе. Не берём «2026» (год)
        // и не берём числа больше 10 млн — это опечатки и оптовые партии.
        const nums = (w.answer.match(/(\d[\d\s]{2,9})(?:\s*(?:руб|₽|р\.))/gi) || [])
          .map((s) => Number(s.replace(/[^\d]/g, '')))
          .filter((n) => n >= 50 && n <= 10_000_000);
        if (nums.length) {
          price = nums[0];
          confirmed = true;
          cite = (w.citations && w.citations[0] && w.citations[0].url) || null;
        }
      }
    }

    out.push({
      name: need.name,
      unit: need.unit,
      qty: need.qty,
      source: 'purchase',
      stock_qty: 0,
      stock_enough: false,
      price,
      price_confirmed: confirmed,
      price_citation: cite,
      basis: need.basis,
      note: need.note,
      // Неподтверждённая цена — это пробел, который должен видеть РП.
      gap: confirmed ? null : 'цена не подтверждена — уточните у снабжения'
    });
  }

  return out;
}

/**
 * Раскладывает МТР по разделам сметы.
 *
 * @param {Array} rows — из resolveMtr
 * @returns {{section_b:Array, section_g:Array, gaps:Array, totals:object}}
 */
function splitForSmeta(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const sectionB = list.filter((r) => r.source === 'warehouse');
  const sectionG = list.filter((r) => r.source === 'purchase');
  const gaps = list.filter((r) => r.gap);

  const gSum = sectionG.reduce((s, r) => s + (Number(r.price) || 0) * (Number(r.qty) || 0), 0);

  return {
    section_b: sectionB,
    section_g: sectionG,
    gaps,
    totals: {
      warehouse_items: sectionB.length,
      purchase_items: sectionG.length,
      purchase_sum: Math.round(gSum * 100) / 100,
      unconfirmed: gaps.length
    }
  };
}

/**
 * Полный проход: ДВ → потребности → склад/поиск → разделы сметы.
 *
 * @param {object} p
 * @returns {Promise<object>}
 */
async function buildMtr(p) {
  const o = p || {};
  const needs = deriveNeeds({
    positions: o.positions,
    people: o.people,
    trips: o.trips
  });
  if (!needs.length) {
    return {
      needs: [],
      rows: [],
      section_b: [],
      section_g: [],
      gaps: [],
      totals: { warehouse_items: 0, purchase_items: 0, purchase_sum: 0, unconfirmed: 0 },
      note: 'МТР не определён: нет ни позиций ДВ, ни данных о людях'
    };
  }
  const rows = await resolveMtr({ db: o.db, needs, allowWeb: o.allowWeb });
  return Object.assign({ needs, rows }, splitForSmeta(rows));
}

module.exports = {
  RESOURCE_HINTS,
  BASE_ITEMS,
  normalizeName,
  deriveNeeds,
  resolveMtr,
  splitForSmeta,
  buildMtr
};
