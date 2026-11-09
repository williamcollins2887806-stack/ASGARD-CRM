'use strict';
/**
 * Гард: номер договора без цифр не ищем и не создаём.
 * Закрывает шум pipeline_check §5 («Счет-оферта», «+», «оферта»).
 */
const test = require('node:test');
const assert = require('node:assert');
const { hasContractDigits, normContractNo, matchContract } = require('../src/services/contract-match');
const { ensureContractFromInvoice } = require('../src/services/contract-auto');

test('hasContractDigits: цифры обязательны', () => {
  assert.strictEqual(hasContractDigits('16/2026'), true);
  assert.strictEqual(hasContractDigits('МЛСП-245.5'), true);
  assert.strictEqual(hasContractDigits('оферта'), false);
  assert.strictEqual(hasContractDigits('Счет-оферта'), false);
  assert.strictEqual(hasContractDigits('+'), false);
  assert.strictEqual(hasContractDigits(''), false);
});

test('matchContract: no_digits без обращения к БД', async () => {
  let called = false;
  const db = { query: async () => { called = true; return { rows: [] }; } };
  const r = await matchContract(db, { number: 'Счет-оферта' });
  assert.strictEqual(r.found, false);
  assert.strictEqual(r.reason, 'no_digits');
  assert.strictEqual(called, false, 'к БД ходить нельзя — иначе поймаем мусорный договор');
});

test('ensureContractFromInvoice: no_digits → skipped', async () => {
  const db = { query: async () => { throw new Error('не должны ходить в БД'); } };
  const r = await ensureContractFromInvoice(db, { number: 'оферта', counterpartyInn: '7707083893', counterpartyName: 'X' });
  assert.strictEqual(r.action, 'skipped');
  assert.strictEqual(r.reason, 'no_digits');
});

test('normContractNo не выдумывает цифры', () => {
  assert.ok(!/\d/.test(normContractNo('Счет-оферта')));
});
