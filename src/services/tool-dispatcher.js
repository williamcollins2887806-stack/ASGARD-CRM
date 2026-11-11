'use strict';
/**
 * tool-dispatcher.js — единая точка выполнения инструментов модели.
 *
 * ── Зачем ─────────────────────────────────────────────────────────────────
 * Инструменты были разбросаны: в `mimir-agent.js` свой switch (web_search там
 * возвращал «недоступен на сервере»), в разборе ДВ — ничего. В результате
 * модель на анализе не могла НИ посмотреть склад, НИ поискать аналоги, и
 * отдавала `mtr = 0`, даже когда позиции были в наличии.
 *
 * Здесь два инструмента с одной реализацией на все контуры:
 *   search_warehouse(query)  — что есть на складе (с фильтром по названию)
 *   web_search(query)        — цены и характеристики из интернета
 *
 * ── Без хардкода ──────────────────────────────────────────────────────────
 * Склад НЕ вываливается в промпт списком: 1229 позиций — это ~60 тыс. токенов
 * на каждый вызов. Модель запрашивает по своему запросу, получает 20 строк.
 * Так же и поиск: запрос формулирует модель, а не наш код.
 *
 * ── Защита от выдумок ─────────────────────────────────────────────────────
 * Stub-режим (`_stub`) возвращается как есть, с явной пометкой. Caller обязан
 * снять такие результаты с расчёта: цена из заглушки в смету не попадает.
 */

const aiProvider = require('./ai-provider');

/** Сколько позиций склада максимум отдать за один запрос. */
const WAREHOUSE_LIMIT = 25;

/** Описания инструментов в формате OpenAI. */
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_warehouse',
      description:
        'Проверить склад: есть ли в наличии оборудование, инструмент, химия, СИЗ. '
        + 'Принимает поисковый запрос. Возвращает позиции с количеством и статусом. '
        + 'Используй ПЕРЕД тем как предлагать закупку.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Что ищем: «шланг высокого давления», «насос», «ингибитор»' },
          limit: { type: 'integer', description: 'Сколько позиций вернуть (по умолчанию 15)' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Найти в интернете цены, технические характеристики, аналоги оборудования. '
        + 'Используй когда нужного нет на складе, чтобы не выдумывать цену.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Поисковый запрос на русском' }
        },
        required: ['query']
      }
    }
  }
];

/** Имена инструментов — для проверки и логов. */
const TOOL_NAMES = TOOLS.map((t) => t.function.name);

/**
 * Поиск по складу через SQL с нечётким совпадением.
 *
 * @param {object} db
 * @param {object} args — { query, limit }
 * @returns {Promise<object>} { items, total, query, note }
 */
async function searchWarehouse(db, args) {
  const a = args || {};
  const query = String(a.query || '').trim();
  const limit = Math.min(WAREHOUSE_LIMIT, Math.max(1, Number(a.limit) || 15));

  if (!db || typeof db.query !== 'function') {
    return { items: [], total: 0, query, note: 'нет доступа к БД' };
  }
  if (!query) {
    return { items: [], total: 0, query, note: 'пустой запрос — укажите что искать' };
  }

  // Разбиваем на слова: «шланг высокого давления» → LIKE по каждому слову.
  //
  // Две попытки: сначала ВСЕ слова (точно), потом ХОТЯ БЫ ОДНО (широко).
  // Без второй попытки «шланг высокого давления» даёт 0, хотя на складе лежит
  // «Шланг РВД 20м» — проверено на проде: AND по трём словам = пусто.
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length >= 3).slice(0, 4);
  const params = [limit].concat(words.map((w) => '%' + w + '%'));

  const runQuery = async (join) => {
    const conds = words.map((_, i) => `lower(e.name) LIKE $${i + 2}`).join(' ' + join + ' ');
    return db.query(
      `SELECT e.name, e.quantity, e.unit, e.status, e.brand, e.model,
              c.name AS category_name
         FROM equipment e
         LEFT JOIN equipment_categories c ON c.id = e.category_id
        WHERE COALESCE(e.is_active, true) = true
          AND COALESCE(e.deleted_at::text, '') = ''
          AND COALESCE(e.status, 'available') NOT IN ('written_off', 'disposed', 'lost')
          AND COALESCE(e.quantity, 0) > 0
          ${conds ? 'AND (' + conds + ')' : ''}
        ORDER BY e.quantity DESC
        LIMIT $1`,
      params
    );
  };

  try {
    let r = await runQuery('AND');
    let broadened = false;
    if ((r.rows || []).length === 0 && words.length > 1) {
      r = await runQuery('OR');
      broadened = true;
    }
    const items = (r.rows || []).map((x) => ({
      name: x.name,
      qty: Number(x.quantity) || 0,
      unit: x.unit || null,
      status: x.status || null,
      category: x.category_name || null,
      brand: x.brand || null,
      model: x.model || null
    }));
    return {
      items,
      total: items.length,
      query,
      // Пометка: нашли не по всем словам — модель должна это учитывать
      // и не считать найденный шланг «тем самым».
      broadened,
      note: items.length
        ? (broadened ? 'точного совпадения нет, показаны частичные' : null)
        : 'на складе не найдено — нужна закупка или аналог'
    };
  } catch (e) {
    // Колонки deleted_at может не быть в старой схеме — не валим весь разбор.
    return { items: [], total: 0, query, note: 'ошибка запроса склада: ' + e.message };
  }
}

/**
 * Веб-поиск с явной пометкой заглушки.
 * @param {object} args — { query }
 * @returns {Promise<object>}
 */
async function webSearch(args) {
  const a = args || {};
  const query = String(a.query || '').trim();
  if (!query) return { answer: '', citations: [], query, note: 'пустой запрос' };

  try {
    const r = await aiProvider.searchWeb({ query, maxResults: 5 });
    return {
      answer: String((r && r.answer) || '').slice(0, 4000),
      citations: Array.isArray(r && r.citations) ? r.citations.slice(0, 5) : [],
      query,
      // Заглушку помечаем явно: caller не должен брать из неё цену.
      stub: !!(r && r._stub),
      note: r && r._stub ? 'поиск в stub-режиме — цены не подтверждены' : null
    };
  } catch (e) {
    return { answer: '', citations: [], query, note: 'ошибка поиска: ' + e.message };
  }
}

/**
 * Выполняет инструмент по имени.
 *
 * @param {object} p
 * @param {object} p.db
 * @param {string} p.name
 * @param {object} p.args
 * @returns {Promise<{ok:boolean, result:object}>}
 */
async function dispatch(p) {
  const o = p || {};
  const name = String(o.name || '');
  const args = o.args || {};

  if (name === 'search_warehouse') {
    const result = await searchWarehouse(o.db, args);
    return { ok: result.total > 0, result };
  }
  if (name === 'web_search') {
    const result = await webSearch(args);
    return { ok: !result.stub && !!result.answer, result };
  }
  return { ok: false, result: { error: 'неизвестный инструмент: ' + name } };
}

/**
 * Выполняет ВСЕ запрошенные моделью tool_calls и возвращает сообщения для
 * следующего круга диалога.
 *
 * @param {object} p
 * @param {object} p.db
 * @param {Array} p.toolCalls — из ответа модели
 * @returns {Promise<Array>} сообщения role:'tool'
 */
async function executeToolCalls(p) {
  const o = p || {};
  const calls = Array.isArray(o.toolCalls) ? o.toolCalls : [];
  const out = [];
  for (const c of calls) {
    const fn = (c && c.function) || {};
    let args = {};
    try { args = fn.arguments ? JSON.parse(fn.arguments) : {}; } catch (_) { args = {}; }
    const r = await dispatch({ db: o.db, name: fn.name, args });
    out.push({
      role: 'tool',
      tool_call_id: c.id,
      content: JSON.stringify(r.result)
    });
  }
  return out;
}

module.exports = {
  TOOLS,
  TOOL_NAMES,
  WAREHOUSE_LIMIT,
  searchWarehouse,
  webSearch,
  dispatch,
  executeToolCalls
};
