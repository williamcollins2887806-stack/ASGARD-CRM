/**
 * Контракт AsgardRuMasks для телефона (public/assets/js/ru_masks.js).
 * Регрессия: двойная семёрка +7(798)-… при вводе 9… / 7987…
 *
 * Usage: node tests/ui/ru-masks-phone.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '../..');
globalThis.window = globalThis;
eval(fs.readFileSync(path.join(ROOT, 'public/assets/js/ru_masks.js'), 'utf8'));
const M = window.AsgardRuMasks;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  OK', name);
  } catch (e) {
    console.error('  FAIL', name, e.message);
    process.exitCode = 1;
  }
}

console.log('ru-masks-phone');

test('первая «9» не съедается', () => {
  assert.strictEqual(M.formatRuPhoneDisplay('9'), '+7(9');
  assert.strictEqual(M.normalizeRuPhoneDigits('9'), '79');
});

test('10 цифр с ведущей 7 не получают вторую 7', () => {
  assert.strictEqual(M.normalizeRuPhoneDigits('7987019723'), '7987019723');
  assert.strictEqual(M.formatRuPhoneDisplay('7987019723'), '+7(987)-019-72-3');
  assert.ok(!M.formatRuPhoneDisplay('7987019723').startsWith('+7(798)'));
});

test('полный мобильный 9XXXXXXXXX', () => {
  assert.strictEqual(M.normalizeRuPhoneDigits('9870197234'), '79870197234');
  assert.strictEqual(M.formatRuPhoneDisplay('9870197234'), '+7(987)-019-72-34');
});

test('8XXXXXXXXXX → 7…', () => {
  assert.strictEqual(M.normalizeRuPhoneDigits('89870197234'), '79870197234');
});

test('посимвольный ввод 9870197234', () => {
  let v = '';
  for (const ch of '9870197234') v = M.formatRuPhoneDisplay(v + ch);
  assert.strictEqual(v, '+7(987)-019-72-34');
});

test('посимвольный ввод с кодом страны 79870197234', () => {
  let v = '';
  for (const ch of '79870197234') v = M.formatRuPhoneDisplay(v + ch);
  assert.strictEqual(v, '+7(987)-019-72-34');
});

console.log(process.exitCode ? 'FAILED' : `passed ${passed}`);
