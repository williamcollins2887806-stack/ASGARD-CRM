#!/usr/bin/env node
'use strict';
/**
 * Проверка контракта «нет нормы → фолбэк → создание нормы → расчёт по справочнику».
 * Без БД проверяет чистые функции; с БД (--db) — полный цикл на клоне.
 */
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'unit-test-no-connection';
const assert = require('assert');
const w = require('../src/services/work-norms');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

check('isMissingNormError: «Укажите объём» — это не отсутствие нормы', () => {
  assert.strictEqual(w.isMissingNormError('Укажите объём контура, м³'), false);
  assert.strictEqual(w.isMissingNormError('Укажите число стыков'), false);
});

check('isMissingNormError: «нет нормы» — отсутствие нормы', () => {
  assert.strictEqual(w.isMissingNormError('Нет нормы для этой категории/метода'), true);
  assert.strictEqual(w.isMissingNormError('Норма не заполнена (rate_default пустой)'), true);
});

check('buildFallbackPreview: честная пометка и сроки', () => {
  const fb = w.buildFallbackPreview({
    category_code: 'repair_weld', method_code: 'weld',
    inputs: { joints: 10 }, workDays: 3, crew: { master: 1, exec: 2 }, reason: 'нет нормы'
  });
  assert.strictEqual(fb.ok, true);
  assert.strictEqual(fb.fallback, true);
  assert.strictEqual(fb.results.work_days, 3);
  assert.ok(fb.trace.join(' ').includes('НЕ ПО СПРАВОЧНИКУ') || fb.trace.join(' ').includes('НЕТ'));
});

check('buildFallbackPreview: без work_days — не выдумывает', () => {
  const fb = w.buildFallbackPreview({ category_code: 'x', method_code: 'y', inputs: {}, workDays: null });
  assert.strictEqual(fb.ok, false);
  assert.strictEqual(fb.fallback, true);
});

check('normPreviewToMarkdown: фолбэк прямо говорит «не по справочнику»', () => {
  const fb = w.buildFallbackPreview({ category_code: 'a', method_code: 'b', inputs: {}, workDays: 2 });
  const md = w.normPreviewToMarkdown(fb, { error: 'нормы нет' });
  assert.ok(/НЕ ПО СПРАВОЧНИКУ|НОРМЫ В СПРАВОЧНИКЕ НЕТ/.test(md), md);
});

check('normPreviewToMarkdown: нехватка объёма — запрет выдумывать', () => {
  const md = w.normPreviewToMarkdown({ ok: false, needs_input: true, error: 'Укажите объём' }, {});
  assert.ok(/СЧИТАТЬ НЕЛЬЗЯ/.test(md), md);
  assert.ok(/Не выдумывай/.test(md), md);
});

check('inferCalcKindForNewRate: по единице объёма', () => {
  assert.strictEqual(w.inferCalcKindForNewRate('a', 'b', { cycles: 2 }).calc_kind, 'hours_per_cycle');
  assert.strictEqual(w.inferCalcKindForNewRate('a', 'b', { tubes: 100 }).unit, 'труб/смену');
  assert.strictEqual(w.inferCalcKindForNewRate('a', 'b', { qty: 1 }).calc_kind, 'days_per_unit');
  assert.strictEqual(w.inferCalcKindForNewRate('x', 'y', {}).calc_kind, 'fixed_days');
});

check('buildNormTrace: без нормы даёт fallback-след, а не null', () => {
  const t = w.buildNormTrace({ norm_inputs: { category_code: 'a', method_code: 'b' } }, null, { estimate: { work_days: 4 } });
  assert.ok(t && t.fallback === true);
  assert.strictEqual(t.work_days, 4);
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
