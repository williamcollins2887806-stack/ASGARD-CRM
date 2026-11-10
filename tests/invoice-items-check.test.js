'use strict';

const assert = require('assert');
const {
  checkItemsVsAmount,
  assertItemsMatchAmount,
  sumLines,
  CODE,
} = require('../src/services/invoice-items-check');

function t(name, fn) {
  try {
    fn();
    console.log('  ✓', name);
  } catch (e) {
    console.error('  ✗', name);
    throw e;
  }
}

console.log('invoice-items-check');

t('пустые позиции — ok (не стоп)', () => {
  const r = checkItemsVsAmount({ amount: 48000, line_items_json: [] });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.n_items, 0);
});

t('позиции = gross — ok', () => {
  const r = checkItemsVsAmount({
    amount: 48000,
    vat_amount: 0,
    line_items_json: [
      { sum: 11000 }, { sum: 37000 },
    ],
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.matched, 'gross');
});

t('позиции = net (без НДС) при amount с НДС — ok', () => {
  const r = checkItemsVsAmount({
    amount: 122,
    vat_amount: 22,
    line_items_json: [{ sum: 100 }],
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.matched, 'net');
});

t('кейс #368: 37000 vs 48000 — mismatch', () => {
  const lines = [
    { sum: 6000 }, { sum: 16500 }, { sum: 2700 }, { sum: 6400 }, { sum: 5400 },
  ];
  assert.strictEqual(sumLines(lines), 37000);
  const r = checkItemsVsAmount({ amount: 48000, vat_amount: 0, line_items_json: lines });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, CODE);
  assert.strictEqual(r.items_sum, 37000);
  assert.strictEqual(r.amount, 48000);
});

t('assert бросает 409', () => {
  let thrown = null;
  try {
    assertItemsMatchAmount({
      amount: 100,
      line_items_json: [{ sum: 50 }],
    });
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown);
  assert.strictEqual(thrown.statusCode, 409);
  assert.strictEqual(thrown.code, CODE);
});

t('строка JSON парсится', () => {
  const r = checkItemsVsAmount({
    amount: 10,
    line_items_json: JSON.stringify([{ sum: 10 }]),
  });
  assert.strictEqual(r.ok, true);
});

console.log('OK');
