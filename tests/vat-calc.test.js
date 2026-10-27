/**
 * Тесты единого расчёта НДС (src/services/vat-calc.js).
 * Запуск: node tests/vat-calc.test.js
 *
 * Кейсы взяты из реального разбора работы #406 (27.10.2026):
 *   • строка ПАНХ — сумма без НДС, ставка записана как 22.0 (проценты);
 *   • материальные счета из Doc Hub — ставка записана как 0.22 (доля);
 *   • счета, где НДС не выделен вовсе.
 */
const assert = require('assert');
const v = require('../src/services/vat-calc');

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
function near(a, b, eps = 0.02) {
  assert.ok(Math.abs(a - b) <= eps, `ожидалось ${b}, получено ${a} (допуск ${eps})`);
}

console.log('vat-calc: normalizeRate');

test('доля 0.22 → 22 процента', () => {
  assert.strictEqual(v.normalizeRate(0.22), 22);
});
test('доля 0.2 → 20 процентов', () => {
  assert.strictEqual(v.normalizeRate(0.2), 20);
});
test('проценты 22 → 22 (не превращаются в 0.22)', () => {
  assert.strictEqual(v.normalizeRate(22), 22);
});
test('строка "22" → 22', () => {
  assert.strictEqual(v.normalizeRate('22'), 22);
});
test('NULL / пусто → null', () => {
  assert.strictEqual(v.normalizeRate(null), null);
  assert.strictEqual(v.normalizeRate(''), null);
  assert.strictEqual(v.normalizeRate(undefined), null);
});
test('мусор (18) → null (ставки вне ФРСН не поддерживаем)', () => {
  assert.strictEqual(v.normalizeRate(18), null);
});

console.log('vat-calc: splitGross / addToNet');

test('splitGross 12200 @22 → net 10000, vat 2200', () => {
  const r = v.splitGross(12200, 22);
  assert.strictEqual(r.net, 10000);
  assert.strictEqual(r.vat, 2200);
  assert.strictEqual(r.gross, 12200);
});
test('addToNet 10000 @22 → gross 12200, vat 2200', () => {
  const r = v.addToNet(10000, 22);
  assert.strictEqual(r.gross, 12200);
  assert.strictEqual(r.vat, 2200);
});
test('net + vat всегда = gross до копейки', () => {
  for (const gross of [12345.67, 545000, 23111014.72, 999.99]) {
    for (const rate of [10, 20, 22]) {
      const r = v.splitGross(gross, rate);
      near(r.net + r.vat, r.gross, 0.011);
    }
  }
});

console.log('vat-calc: resolveExpense — явная база (post-V443)');

test('vat_basis=net: 10000 @22 → gross 12200', () => {
  const r = v.resolveExpense({ amount: 10000, vat_rate: 22, vat_amount: 2200, vat_basis: 'net' });
  assert.strictEqual(r.basis, 'net');
  assert.strictEqual(r.net, 10000);
  assert.strictEqual(r.vat, 2200);
  assert.strictEqual(r.gross, 12200);
  assert.strictEqual(r.inconsistent, false);
});
test('vat_basis=gross: 12200 @22 → net 10000', () => {
  const r = v.resolveExpense({ amount: 12200, vat_rate: 22, vat_amount: 2200, vat_basis: 'gross' });
  assert.strictEqual(r.basis, 'gross');
  assert.strictEqual(r.net, 10000);
  assert.strictEqual(r.vat, 2200);
  assert.strictEqual(r.inconsistent, false);
});

console.log('vat-calc: resolveExpense — legacy без vat_basis');

test('legacy gross по amount_ex_vat: amount = ex + vat', () => {
  // Реальная строка #5240: 545 000 = 446 721,32 + 98 278,68
  const r = v.resolveExpense({ amount: 545000, amount_ex_vat: 446721.32, vat_amount: 98278.68, vat_rate: 22 });
  assert.strictEqual(r.basis, 'gross');
  near(r.net, 446721.32);
  near(r.vat, 98278.68);
  assert.strictEqual(r.inconsistent, false);
});
test('legacy по ставке-доле (0.2): нормализуется в проценты', () => {
  // 235 000 × 22/122 = 42 377,05 — записанная доля 0.2 не совпадает с суммой,
  // ставка подбирается по паре (amount, vat) → 22.
  const r = v.resolveExpense({ amount: 235000, vat_rate: 0.2, vat_amount: 42377.05 });
  assert.strictEqual(r.rate, 22);
  assert.strictEqual(r.basis, 'gross');
  near(r.net, 192622.95);
});
test('записанная ставка верна — используется она, а не подбор', () => {
  // 120 000 × 20/120 = 20 000 — здесь честные 20%.
  const r = v.resolveExpense({ amount: 120000, vat_rate: 0.2, vat_amount: 20000 });
  assert.strictEqual(r.rate, 20);
  assert.strictEqual(r.basis, 'gross');
  near(r.net, 100000);
});
test('НДС не выделен вовсе → basis none, vat 0', () => {
  const r = v.resolveExpense({ amount: 371264, vat_rate: null, vat_amount: null });
  assert.strictEqual(r.basis, 'none');
  assert.strictEqual(r.vat, 0);
  assert.strictEqual(r.net, 371264);
  assert.strictEqual(r.inconsistent, false);
});
test('НДС есть, ставка не задана (Wildberries: ставки разные) → берём amount_ex_vat', () => {
  // Реальная строка #5255: 48 552 = 45 674,12 + 2 877,88, vat_rate NULL
  const r = v.resolveExpense({ amount: 48552, vat_rate: null, vat_amount: 2877.88, amount_ex_vat: 45674.12 });
  assert.strictEqual(r.basis, 'gross');
  assert.strictEqual(r.inconsistent, false);
  near(r.net, 45674.12);
  near(r.vat, 2877.88);
});

console.log('vat-calc: resolveExpense — битые данные (#406, ПАНХ)');

test('ПАНХ #5257: amount_ex_vat + vat НЕ равно amount → inconsistent', () => {
  // amount 23 111 014,72; amount_ex_vat 20 022 987,41; vat 4 405 057,23
  // 20 022 987,41 + 4 405 057,23 = 24 428 044,64 ≠ 23 111 014,72
  const r = v.resolveExpense({
    amount: 23111014.72,
    amount_ex_vat: 20022987.41,
    vat_amount: 4405057.23,
    vat_rate: 22
  });
  assert.strictEqual(r.basis, 'unknown');
  assert.strictEqual(r.inconsistent, true);
});
test('ПАНХ, если правильно записать как net: 23 111 014,72 + 22%', () => {
  const r = v.resolveExpense({
    amount: 23111014.72,
    vat_rate: 22,
    vat_amount: 5084423.24,
    vat_basis: 'net'
  });
  assert.strictEqual(r.basis, 'net');
  assert.strictEqual(r.net, 23111014.72);
  near(r.vat, 5084423.24);
  near(r.gross, 28195437.96);
  assert.strictEqual(r.inconsistent, false);
});

console.log('vat-calc: taxBase — 55% от суммы без НДС');

test('cash 12200 gross @22 → налоговая база 10000, а не 12200', () => {
  assert.strictEqual(v.taxBase({ amount: 12200, vat_rate: 22, vat_amount: 2200, vat_basis: 'gross' }), 10000);
});
test('cash 10000 без НДС → база 10000', () => {
  assert.strictEqual(v.taxBase({ amount: 10000, vat_amount: null }), 10000);
});

console.log('vat-calc: дефекты, найденные верификатором 27.10.2026');

test('7% НДС поддерживается (было: normalizeRate(7)=null, нетто завышалось)', () => {
  assert.strictEqual(v.normalizeRate(7), 7);
  // 107 000 с НДС 7% → нетто 100 000, НДС 7 000
  const r = v.resolveExpense({ amount: 107000, vat_rate: 7, vat_amount: 7000 });
  assert.strictEqual(r.basis, 'gross');
  assert.strictEqual(r.net, 100000);
  assert.strictEqual(r.vat, 7000);
  assert.strictEqual(r.inconsistent, false);
});

test('НДС больше суммы (частичная оплата) → нетто не уходит в минус', () => {
  // amount 100 000, а НДС со всего счёта 220 000
  const r = v.resolveExpense({ amount: 100000, vat_rate: 22, vat_amount: 220000 });
  assert.ok(r.net >= 0, 'нетто не должно быть отрицательным, получено ' + r.net);
  assert.strictEqual(r.inconsistent, true);
});

test('resolveExpense для vat_basis=net + сходящийся amount_ex_vat', () => {
  // строка #11/#3880: 349 249 = 286 270 + 62 979, суммы округлены до рубля
  const r = v.resolveExpense({ amount: 349249, vat_rate: 22, vat_amount: 62979, amount_ex_vat: 286270, vat_basis: 'gross' });
  assert.strictEqual(r.inconsistent, false, 'допуск 1 ₽ должен покрывать округление до рубля');
  assert.strictEqual(r.net, 286270);
});

console.log('');
console.log('Total: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
