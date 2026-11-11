'use strict';
/**
 * Живая проверка пути «модель → инструмент → данные».
 *
 * Проверяет НЕ заглушку, а реальный вызов: склад через БД и веб-поиск через
 * провайдера. Без этого «веб-поиск починен» остаётся словом агента.
 *
 * Запуск:  node tests/web-search-live-path.test.js [--live]
 * Без --live проверяются только форма ответа и контракт ошибок.
 */

const path = require('path');
const td = require(path.join(__dirname, '..', 'src', 'services', 'tool-dispatcher'));

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS ' + name); }
  catch (e) { fail += 1; console.log('FAIL ' + name + ' — ' + e.message); }
}
async function checkAsync(name, fn) {
  try { await fn(); pass += 1; console.log('PASS ' + name); }
  catch (e) { fail += 1; console.log('FAIL ' + name + ' — ' + e.message); }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || '') + ` expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const LIVE = process.argv.includes('--live');

(async () => {
  // ── Контракт: инструменты объявлены ──────────────────────────────────────
  check('объявлены оба инструмента', () => {
    if (td.TOOL_NAMES.length !== 2) throw new Error('инструментов ' + td.TOOL_NAMES.length);
    if (!td.TOOL_NAMES.includes('search_warehouse')) throw new Error('нет search_warehouse');
    if (!td.TOOL_NAMES.includes('web_search')) throw new Error('нет web_search');
  });

  check('у каждого есть описание и схема', () => {
    for (const t of td.TOOLS) {
      if (!t.function.description || t.function.description.length < 20) {
        throw new Error(t.function.name + ': описание слишком короткое');
      }
      if (t.function.parameters.type !== 'object') throw new Error(t.function.name + ': нет схемы');
    }
  });

  // ── Склад: без БД не выдумывает ──────────────────────────────────────────
  await checkAsync('склад без БД возвращает пусто и причину', async () => {
    const r = await td.searchWarehouse(null, { query: 'насос' });
    if (r.items.length !== 0) throw new Error('выдумал ' + r.items.length + ' позиций');
    if (!r.note) throw new Error('нет причины');
  });

  await checkAsync('пустой запрос не делает полный дамп склада', async () => {
    let called = false;
    const fake = { query: async () => { called = true; return { rows: [] }; } };
    const r = await td.searchWarehouse(fake, { query: '' });
    if (called) throw new Error('запрос ушёл в БД при пустом query');
    if (!r.note) throw new Error('нет причины');
  });

  await checkAsync('лимит склада не больше 25', async () => {
    let gotLimit = null;
    const fake = {
      query: async (sql, params) => { gotLimit = params[0]; return { rows: [] }; }
    };
    await td.searchWarehouse(fake, { query: 'шланг', limit: 999 });
    if (gotLimit > td.WAREHOUSE_LIMIT) throw new Error('limit=' + gotLimit);
  });

  await checkAsync('слова запроса уходят как отдельные условия', async () => {
    const sqls = [];
    const fake = {
      query: async (sql) => { sqls.push(sql); return { rows: [] }; }
    };
    await td.searchWarehouse(fake, { query: 'шланг высокого давления' });
    const ands = (sqls[0].match(/AND lower\(e\.name\) LIKE/g) || []).length;
    if (ands < 2) throw new Error('слов склеено в одно условие: ' + ands);
  });

  await checkAsync('нет точного совпадения → откат на OR', async () => {
    const sqls = [];
    let call = 0;
    const fake = {
      query: async (sql) => {
        sqls.push(sql);
        call += 1;
        // Первый (AND) — пусто, второй (OR) — одна позиция.
        return call === 1 ? { rows: [] } : { rows: [{ name: 'Шланг РВД 20м', quantity: 3, unit: 'шт' }] };
      }
    };
    const r = await td.searchWarehouse(fake, { query: 'шланг высокого давления' });
    if (sqls.length !== 2) throw new Error('попыток ' + sqls.length + ', ожидалось 2');
    if (!r.total) throw new Error('широкий поиск не сработал');
    eq(r.broadened, true, 'должна быть пометка broadened');
  });

  await checkAsync('точное совпадение не делает лишний запрос', async () => {
    let calls = 0;
    const fake = {
      query: async () => { calls += 1; return { rows: [{ name: 'Шланг РВД', quantity: 2 }] }; }
    };
    const r = await td.searchWarehouse(fake, { query: 'шланг рвд' });
    eq(calls, 1, 'лишний запрос к БД');
    eq(r.broadened, false);
  });

  // ── Веб-поиск: контракт ошибок ───────────────────────────────────────────
  await checkAsync('веб-поиск с пустым запросом не тратит вызов', async () => {
    const r = await td.webSearch({ query: '' });
    if (r.answer) throw new Error('вернул ответ на пустой запрос');
    if (!r.note) throw new Error('нет причины');
  });

  await checkAsync('веб-поиск возвращает помеченную заглушку как stub', async () => {
    const r = await td.webSearch({ query: 'цена насоса' });
    // stub помечен — caller обязан его отбросить
    if (r.stub !== true && r.stub !== false) throw new Error('поле stub не булево');
  });

  // ── Живой вызов ──────────────────────────────────────────────────────────
  if (LIVE) {
    await checkAsync('ЖИВО: веб-поиск возвращает непустой ответ', async () => {
      const r = await td.webSearch({ query: 'цена насоса Karcher HD 10/25 2026' });
      if (r.stub) throw new Error('stub-режим: ' + r.note);
      if (!r.answer || r.answer.length < 40) throw new Error('ответ ' + (r.answer || '').length + ' символов');
      console.log('    ответ: ' + r.answer.slice(0, 160).replace(/\n/g, ' '));
    });

    await checkAsync('ЖИВО: склад отвечает по реальной БД', async () => {
      const { Pool } = require('pg');
      const pool = new Pool({
        host: process.env.DB_HOST || '127.0.0.1',
        user: process.env.DB_USER || 'asgard',
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'asgard_crm',
        max: 1
      });
      try {
        const r = await td.searchWarehouse(pool, { query: 'насос' });
        console.log('    склад: ' + r.total + ' позиций по «насос»');
        if (r.note && r.note.startsWith('ошибка')) throw new Error(r.note);
        if (r.total === 0) throw new Error('ничего не найдено — проверьте наполнение склада');
      } finally {
        await pool.end();
      }
    });
  }

  console.log('\nитог: ' + pass + ' PASS, ' + fail + ' FAIL' + (LIVE ? ' (живой режим)' : ' (без --live)'));
  process.exit(fail ? 1 : 0);
})();
