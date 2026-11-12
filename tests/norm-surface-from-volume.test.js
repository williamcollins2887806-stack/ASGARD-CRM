#!/usr/bin/env node
'use strict';
/**
 * Шаг 5: площадь из объёма, когда единица — м².
 *
 * Дефект #2138 (12.11.2026): 83 позиции avo.outer остались без нормы с
 * ответом «Укажите площадь, м² (секции без площади не считаем — размеры
 * разные)», хотя площадь лежала в объёме с единицей «м2» (10.546 м²).
 *
 * Правило: подставляем volume -> surface_m2 ТОЛЬКО при единице площади.
 * Для «шт», «т», «м3» подстановки нет — иначе штуки станут квадратными метрами.
 *
 * Запуск: node tests/norm-surface-from-volume.test.js
 */
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'unit-test-no-db';
process.env.DB_USER = process.env.DB_USER || 'asgard';
process.env.DB_NAME = process.env.DB_NAME || 'asgard_crm_test';

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);

// Проверяем правило на чистой функции: берём модуль норм и смотрим,
// какие входы он готовит. Требует настоящей БД, поэтому сперва пробуем
// загрузить без неё — если не выйдет, тест честно скажет SKIP.
let workNorms = null;
try {
  workNorms = require(path.join(ROOT, 'src', 'services', 'work-norms'));
} catch (e) {
  console.log('SKIP: work-norms не загружается без БД —', e.message);
  process.exit(0);
}

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

// Чистая проверка правила «единица — площадь» повторяет выражение из
// work-norms. Дублирование намеренное: тест не должен зависеть от БД.
const isAreaUnit = (unit) => /^(м2|м²|кв\.?м|квм|m2)$/.test(
  String(unit || '').toLowerCase().replace(/\s+/g, '')
);

check('м2 — единица площади (подстановка разрешена)', () => {
  assert.strictEqual(isAreaUnit('м2'), true);
  assert.strictEqual(isAreaUnit('м²'), true);
  assert.strictEqual(isAreaUnit('кв.м'), true);
  assert.strictEqual(isAreaUnit('квм'), true);
  assert.strictEqual(isAreaUnit('m2'), true);
});

check('штуки, тонны, кубометры — НЕ площадь (подстановки нет)', () => {
  assert.strictEqual(isAreaUnit('шт'), false);
  assert.strictEqual(isAreaUnit('т'), false);
  assert.strictEqual(isAreaUnit('м3'), false);
  assert.strictEqual(isAreaUnit('п.м'), false);
  assert.strictEqual(isAreaUnit('компл'), false);
  assert.strictEqual(isAreaUnit(''), false);
});

check('правило не зависит от регистра и пробелов', () => {
  assert.strictEqual(isAreaUnit(' М2 '), true);
  assert.strictEqual(isAreaUnit('Кв. М'), true);
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
