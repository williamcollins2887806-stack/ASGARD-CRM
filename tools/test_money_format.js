'use strict';
/**
 * D-359: проверка денежного форматирования БЕЗ браузера.
 * Повторяем ровно те же функции, что в doc-hub.js, и сверяем поведение.
 */
const assert = require('assert');

function moneyInputValue(n) {
  const x = Number(String(n).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(x) ? x : 0;
}
function moneyDisplay(n) {
  const x = moneyInputValue(n);
  if (!x) return '';
  return x.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';
}
function moneyParse(s) {
  const t = String(s || '').replace(/[^\d,.\-]/g, '').replace(/\s/g, '').replace(',', '.');
  if (!t) return null;
  const x = Number(t);
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : null;
}
// toLocaleString('ru-RU') разделяет разряды НЕРАЗРЫВНЫМ пробелом (U+00A0).
// В браузере это визуально тот же пробел — в тестах нормализуем.
function norm(s) { return String(s).replace(/\u00a0/g, ' '); }

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`PASS  ${name}`); pass++; }
  catch (e) { console.log(`FAIL  ${name}\n      ${e.message}`); fail++; }
}

console.log('=== 1. Отображение денег ===');
t('130000 → «130 000,00 ₽»', () => assert.strictEqual(norm(moneyDisplay(130000)), '130 000,00 ₽'));
t('23442.62 → «23 442,62 ₽»', () => assert.strictEqual(norm(moneyDisplay(23442.62)), '23 442,62 ₽'));
t('1184 → «1 184,00 ₽»', () => assert.strictEqual(norm(moneyDisplay(1184)), '1 184,00 ₽'));
t('0 → пусто (не «0,00 ₽»)', () => assert.strictEqual(moneyDisplay(0), ''));
t('null → пусто', () => assert.strictEqual(moneyDisplay(null), ''));
t('строка "34313.65" → «34 313,65 ₽»', () => assert.strictEqual(norm(moneyDisplay('34313.65')), '34 313,65 ₽'));
t('миллион с разрядами', () => assert.strictEqual(norm(moneyDisplay(1234567.89)), '1 234 567,89 ₽'));

console.log('\n=== 2. Разбор ввода (обратно в число) ===');
t('«130 000,00 ₽» → 130000', () => assert.strictEqual(moneyParse('130 000,00 ₽'), 130000));
t('«23 442,62 ₽» → 23442.62', () => assert.strictEqual(moneyParse('23 442,62 ₽'), 23442.62));
t('«130000» → 130000', () => assert.strictEqual(moneyParse('130000'), 130000));
t('«130000.50» → 130000.5 (точка тоже ок)', () => assert.strictEqual(moneyParse('130000.50'), 130000.5));
t('«1 234 567,89 ₽» → 1234567.89', () => assert.strictEqual(moneyParse('1 234 567,89 ₽'), 1234567.89));
t('пусто → null', () => assert.strictEqual(moneyParse(''), null));
t('мусор «abc» → null', () => assert.strictEqual(moneyParse('abc'), null));

console.log('\n=== 3. КРУГ: display → parse → display (идемпотентность) ===');
for (const v of [130000, 23442.62, 1184, 34313.65, 1234567.89, 0.01]) {
  t(`круг ${v}`, () => {
    const shown = moneyDisplay(v);
    const back = moneyParse(shown);
    assert.strictEqual(back, v, `«${shown}» → ${back}, ожидали ${v}`);
    assert.strictEqual(moneyDisplay(back), shown, 'повторный показ совпадает');
  });
}

console.log('\n=== 4. Краевые: не теряем копейки ===');
t('0.01 → «0,01 ₽» → 0.01', () => {
  assert.strictEqual(norm(moneyDisplay(0.01)), '0,01 ₽');
  assert.strictEqual(moneyParse('0,01 ₽'), 0.01);
});
t('999999999.99 не ломается', () => {
  const s = moneyDisplay(999999999.99);
  assert.strictEqual(moneyParse(s), 999999999.99);
});
t('отрицательная (корректировка)', () => {
  const s = moneyDisplay(-5000);
  assert.strictEqual(moneyParse(s), -5000);
});

console.log(`\n═══ ИТОГ: ${pass} PASS / ${fail} FAIL ═══`);
if (fail) process.exitCode = 1;
