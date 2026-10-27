/**
 * Тесты единого helper'а expense-tax.js.
 * Запуск: node tests/expense-tax.test.js
 */
const assert = require('assert');
const t = require('../src/services/expense-tax');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    failed++;
    console.log('  ✗ ' + name + ' — ' + e.message);
  }
}

console.log('expense-tax: isTaxableExpense');

test('cash payment_method → taxable', () => {
  assert.strictEqual(t.isTaxableExpense({ category: 'materials', payment_method: 'cash' }), true);
});
test('card payment_method → taxable', () => {
  assert.strictEqual(t.isTaxableExpense({ category: 'tickets', payment_method: 'card' }), true);
});
test('bank payment_method → НЕ taxable (с НДС-вычетом отдельно)', () => {
  assert.strictEqual(t.isTaxableExpense({ category: 'materials', payment_method: 'bank' }), false);
});
test('self (самозанятый) → taxable (внутреннее правило: НПД = обналичка)', () => {
  // ИСТОРИЯ (27.10.2026, найдено верификатором): этот тест ожидал `false` и
  // ПАДАЛ на неизменённом коде — расхождение теста с реализацией, а не
  // изменение бизнес-правила. Проверка на коммите до правок:
  //   git show HEAD:src/services/expense-tax.js → TAX_PAYMENT_METHODS содержит 'self'
  //   isTaxableExpense({payment_method:'self'}) === true
  // Реализация и шапка модуля (пункт 1: cash | card | self → 55%) с самого
  // начала считали НПД обналичкой. Ожидание приведено к фактическому поведению.
  assert.strictEqual(t.isTaxableExpense({ category: 'transfer', payment_method: 'self' }), true);
});
test('auto + fot → taxable', () => {
  assert.strictEqual(t.isTaxableExpense({ category: 'fot', payment_method: 'auto' }), true);
});
test('auto + materials → НЕ taxable', () => {
  assert.strictEqual(t.isTaxableExpense({ category: 'materials', payment_method: 'auto' }), false);
});
test('payment_method NULL + legacy category cash → taxable (fallback)', () => {
  assert.strictEqual(t.isTaxableExpense({ category: 'cash', payment_method: null }), true);
});
test('payment_method NULL + legacy category subcontract → taxable', () => {
  assert.strictEqual(t.isTaxableExpense({ category: 'subcontract' }), true);
});
test('payment_method NULL + materials → НЕ taxable', () => {
  assert.strictEqual(t.isTaxableExpense({ category: 'materials' }), false);
});
test('empty input → false', () => {
  assert.strictEqual(t.isTaxableExpense(null), false);
  assert.strictEqual(t.isTaxableExpense({}), false);
});

console.log('expense-tax: calcVatDeductible');
test('vat_amount > 0 → возвращает округлённое', () => {
  assert.strictEqual(t.calcVatDeductible({ vat_amount: 1234.567 }), 1234.57);
});
test('vat_amount NULL → 0', () => {
  assert.strictEqual(t.calcVatDeductible({ vat_amount: null }), 0);
});
test('vat_amount = 0 → 0 (а не синтезируем из суммы)', () => {
  assert.strictEqual(t.calcVatDeductible({ vat_amount: 0, amount: 10000 }), 0);
});

console.log('expense-tax: calcTaxBurden');
test('cash 10000 × 55% = 5500', () => {
  assert.strictEqual(t.calcTaxBurden({ amount: 10000, payment_method: 'cash' }), 5500);
});
test('bank 10000 → 0 (нет нагрузки)', () => {
  assert.strictEqual(t.calcTaxBurden({ amount: 10000, payment_method: 'bank' }), 0);
});
test('Custom ставка 40% — 10000 × 40 = 4000', () => {
  assert.strictEqual(t.calcTaxBurden({ amount: 10000, payment_method: 'cash' }, 40), 4000);
});

console.log('expense-tax: aggregate');
test('Сумма списка', () => {
  const r = t.aggregate([
    { amount: 10000, payment_method: 'cash',  vat_amount: 0 },
    { amount: 5000,  payment_method: 'bank',  vat_amount: 909.09 },
    { amount: 20000, category: 'fot', payment_method: 'auto', vat_amount: null },
  ]);
  assert.strictEqual(r.total, 35000);
  // taxBurden: 10000*55% + 20000*55% = 5500 + 11000 = 16500
  assert.strictEqual(r.taxBurden, 16500);
  // vatDeductible: 909.09 (только реальный НДС из счёта)
  assert.strictEqual(r.vatDeductible, 909.09);
});

console.log('expense-tax: calcTaxBurden — база без НДС (V443)');
test('cash 12200 с НДС 22% → 55% от 10000 = 5500, а не от 12200', () => {
  assert.strictEqual(
    t.calcTaxBurden({ amount: 12200, vat_rate: 22, vat_amount: 2200, vat_basis: 'gross', payment_method: 'cash' }),
    5500
  );
});
test('cash 10000 без НДС → 5500 (база не изменилась)', () => {
  assert.strictEqual(t.calcTaxBurden({ amount: 10000, vat_amount: null, payment_method: 'cash' }), 5500);
});

console.log('');
console.log('Total: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
