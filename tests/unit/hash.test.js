/**
 * ASGARD CRM — Unit-тесты: совместимость хешей bank_import.js ↔ bank-processor.js
 */

'use strict';

const { generateHash } = require('../../src/services/bank-processor');

describe('Совместимость хешей банковского импорта', () => {

  // Фронтенд-алгоритм (bank_import.js) воспроизведён для проверки
  function frontendHash(row) {
    const str = `${row.date}|${row.amount}|${(row.counterparty || '').slice(0, 30)}|${(row.description || '').slice(0, 30)}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return 'tx_' + Math.abs(hash).toString(36);
  }

  test('серверный хеш совпадает с фронтенд-хешем', () => {
    const rows = [
      { date: '2026-01-15', amount: -150000, counterparty: 'ООО "ТрансЛогистик"', description: 'Оплата по счёту №42' },
      { date: '2026-01-16', amount: 500000, counterparty: 'ООО "Нефтесервис"', description: 'Аванс по договору №12' },
      { date: '2026-01-17', amount: -85000, counterparty: 'Иванов И.И.', description: 'Зарплата за январь 2026' }
    ];

    for (const row of rows) {
      expect(generateHash(row)).toBe(frontendHash(row));
    }
  });

  test('кириллические символы обрабатываются одинаково', () => {
    const row = { date: '2026-02-01', amount: -99999, counterparty: 'Очень Длинное Название Организации', description: 'Оплата по счёту за февраль' };
    expect(generateHash(row)).toBe(frontendHash(row));
  });

  test('пустые поля не ломают хеш', () => {
    const row = { date: '2026-01-01', amount: 0, counterparty: '', description: '' };
    expect(generateHash(row)).toBe(frontendHash(row));
  });

  test('спецсимволы обрабатываются корректно', () => {
    const row = { date: '2026-03-15', amount: -12345.67, counterparty: 'ООО "Тест & Ко"', description: 'Счёт №1/2-3' };
    expect(generateHash(row)).toBe(frontendHash(row));
  });

  test('хеш стабилен (детерминирован)', () => {
    const row = { date: '2026-01-15', amount: 100000, counterparty: 'Тест', description: 'Тест' };
    const results = new Set();
    for (let i = 0; i < 100; i++) {
      results.add(generateHash(row));
    }
    expect(results.size).toBe(1);
  });
});
