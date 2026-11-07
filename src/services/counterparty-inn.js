'use strict';

/**
 * Единая гигиена ИНН/имён контрагента (Карта контрагентов).
 * Checksum — из invoice-extract (тот же алгоритм ФНС).
 */

const { validInn } = require('./invoice-extract');

const GARBAGE_INNS = new Set([
  '0000000000', '000000000000',
  '1111111111', '111111111111',
  '1234567890', '123456789012',
  '9999999999', '999999999999'
]);

function digitsInn(v) {
  return String(v || '').replace(/\D/g, '');
}

/** Валидный ИНН для карточки: длина + checksum + не мусорный паттерн. */
function validCounterpartyInn(inn) {
  const s = digitsInn(inn);
  if (!validInn(s)) return false;
  if (GARBAGE_INNS.has(s)) return false;
  // Все нули / все одинаковые цифры
  if (/^(\d)\1+$/.test(s)) return false;
  return true;
}

function isStubOrgName(name) {
  const n = String(name || '').trim();
  if (!n) return true;
  if (n.length < 2) return true;
  if (/^распозна[её]тся/i.test(n)) return true;
  if (/^ожидает\s+распознавания/i.test(n)) return true;
  if (/^(ооо|ао|пао|зао|оао|ип)\.?$/i.test(n)) return true;
  if (/^тест/i.test(n) && n.length < 12) return true;
  return false;
}

module.exports = {
  validInn,
  validCounterpartyInn,
  isStubOrgName,
  digitsInn,
  GARBAGE_INNS
};
