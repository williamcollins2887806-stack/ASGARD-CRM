'use strict';

/**
 * Клик по номеру в журнале звонков панели «Телефон» должен предлагать действие
 * (Позвонить / Набрать / Скопировать), а не молча открывать журнал.
 *
 * Usage: node tests/pbx/phone-number-tap.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
let passed = 0;
let failed = 0;

function test(id, name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${id} ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${id} ${name}: ${e.message}`); }
}

const ui = fs.readFileSync(path.join(ROOT, 'public/assets/js/phone_ui.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'public/assets/css/phone.css'), 'utf8');

console.log('phone-number-tap');

test('N1', 'номер в строке журнала кликабелен (data-ph-call)', () => {
  const row = ui.slice(ui.indexOf('function callRowHtml'), ui.indexOf('function fmtWhen'));
  assert.ok(/ph-dp-row-main" data-ph-call=/.test(row), 'имя/номер не кликабельны');
  assert.ok(/class="ph-ios-call" data-ph-call=/.test(row), 'нет кнопки-трубки с data-ph-call');
});

test('N2', 'клик по номеру открывает выбор действия, а не журнал', () => {
  const h = ui.slice(ui.indexOf("var callBtn = t.closest('[data-ph-call]')"), ui.indexOf("var b = t.closest('[data-ph-dp]')"));
  assert.ok(/openNumberActions\(/.test(h), 'клик не ведёт в openNumberActions');
  assert.ok(!/location\.hash/.test(h), 'клик по номеру всё ещё уходит в журнал');
  assert.ok(/e\.stopPropagation\(\)/.test(h), 'нет stopPropagation — клик провалится в строку');
});

test('N3', 'модалка предлагает Позвонить / Набрать / Скопировать', () => {
  const fn = ui.slice(ui.indexOf('function openNumberActions'), ui.indexOf('function openDialPad'));
  assert.ok(/id="phNumCall"/.test(fn), 'нет «Позвонить»');
  assert.ok(/id="phNumDial"/.test(fn), 'нет «Набрать вручную»');
  assert.ok(/id="phNumCopy"/.test(fn), 'нет «Скопировать номер»');
});

test('N4', '«Позвонить» вызывает AsgardPhone.outbound', () => {
  const fn = ui.slice(ui.indexOf('function openNumberActions'), ui.indexOf('function openDialPad'));
  assert.ok(/P\.outbound\(digits\)/.test(fn), 'кнопка не звонит через outbound');
});

test('N5', '«Набрать вручную» открывает dialpad с номером', () => {
  const fn = ui.slice(ui.indexOf('function openNumberActions'), ui.indexOf('function openDialPad'));
  assert.ok(/openDialPad\(digits\)/.test(fn), 'не открывает dialpad с prefilled номером');
});

test('N6', 'есть иконка call (кнопка-трубка)', () => {
  assert.ok(/call: SVG_FILL/.test(ui), 'в ICON нет call');
});

test('N7', 'CSS для кнопки перезвона и модалки номера', () => {
  assert.ok(/\.ph-ios-call/.test(css), 'нет стиля .ph-ios-call');
  assert.ok(/\.ph-num-actions/.test(css), 'нет стиля .ph-num-actions');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
