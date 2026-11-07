'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  validCounterpartyInn,
  isStubOrgName,
  digitsInn
} = require('../src/services/counterparty-inn');

test('validCounterpartyInn accepts known good INN checksum', () => {
  // Яндекс 7736207543 — известный валидный 10-значный
  assert.equal(validCounterpartyInn('7736207543'), true);
});

test('validCounterpartyInn rejects garbage patterns', () => {
  assert.equal(validCounterpartyInn('0000000000'), false);
  assert.equal(validCounterpartyInn('1111111111'), false);
  assert.equal(validCounterpartyInn('10100000'), false);
  assert.equal(validCounterpartyInn('123'), false);
});

test('isStubOrgName catches OCR stubs', () => {
  assert.equal(isStubOrgName('Распознаётся…'), true);
  assert.equal(isStubOrgName('ООО'), true);
  assert.equal(isStubOrgName('ООО «Ромашка»'), false);
});

test('digitsInn strips non-digits', () => {
  assert.equal(digitsInn('77 36-207-543'), '7736207543');
});
