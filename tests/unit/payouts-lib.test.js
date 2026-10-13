/**
 * ASGARD CRM — Unit-тесты контура выплат (#/payouts).
 * Чистые функции без БД: payout-row (границы периода, пропорция этапов)
 * и payout-notify (генерация/нормализация/проверка кода).
 */

'use strict';

const { MONTH_START, MONTH_END } = require('../../src/lib/payout-row');
const { generateCode, normalizePhone, CODE_LENGTH } = require('../../src/lib/payout-notify');

describe('payout-row: границы месяца', () => {
  test('MONTH_START — первое число, месяц с ведущим нулём', () => {
    expect(MONTH_START(2026, 9)).toBe('2026-09-01');
    expect(MONTH_START(2026, 12)).toBe('2026-12-01');
    expect(MONTH_START(2026, 1)).toBe('2026-01-01');
  });

  test('MONTH_END — последний день месяца (високосный и обычный)', () => {
    expect(MONTH_END(2026, 2)).toBe('2026-02-28'); // не високосный
    expect(MONTH_END(2024, 2)).toBe('2024-02-29'); // високосный
    expect(MONTH_END(2026, 4)).toBe('2026-04-30');
    expect(MONTH_END(2026, 12)).toBe('2026-12-31');
  });
});

describe('payout-notify: generateCode', () => {
  test('длина кода = CODE_LENGTH, только цифры', () => {
    for (let i = 0; i < 200; i++) {
      const c = generateCode();
      expect(c).toHaveLength(CODE_LENGTH);
      expect(/^\d+$/.test(c)).toBe(true);
    }
  });

  test('код не начинается с 0 (диапазон [10^(N-1), 10^N))', () => {
    const min = Math.pow(10, CODE_LENGTH - 1);
    for (let i = 0; i < 500; i++) {
      const c = Number(generateCode());
      expect(c).toBeGreaterThanOrEqual(min);
      expect(c).toBeLessThan(Math.pow(10, CODE_LENGTH));
    }
  });

  test('коды криптослучайны (не константа, есть разброс)', () => {
    const set = new Set();
    for (let i = 0; i < 100; i++) set.add(generateCode());
    expect(set.size).toBeGreaterThan(50); // заведомо больше 50 уникальных из 100
  });
});

describe('payout-notify: normalizePhone', () => {
  test('8XXXXXXXXXX → +7XXXXXXXXXX', () => {
    expect(normalizePhone('89236706924')).toBe('+79236706924');
  });
  test('7XXXXXXXXXX → +7XXXXXXXXXX', () => {
    expect(normalizePhone('79236706924')).toBe('+79236706924');
  });
  test('+7 (923) 670-69-24 → +79236706924 (снимает форматирование)', () => {
    expect(normalizePhone('+7 (923) 670-69-24')).toBe('+79236706924');
  });
  test('номер без ведущей 7/8 — добавляется 7', () => {
    expect(normalizePhone('9236706924')).toBe('+79236706924');
  });
  test('пусто/мусор → пустая строка (не падает)', () => {
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone(null)).toBe('');
    expect(normalizePhone(undefined)).toBe('');
  });
});
