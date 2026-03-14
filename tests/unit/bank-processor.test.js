/**
 * ASGARD CRM — Unit-тесты: парсер банковских выписок
 */

'use strict';

const {
  parseCSV, parse1C, parseTinkoff, parseSber, parseTochka,
  detectFormat, generateHash, classifyTransaction
} = require('../../src/services/bank-processor');

const { BANK_CSV_FIXTURE, BANK_1C_FIXTURE } = require('../helpers/fixtures');

// ═══════════════════════════════════════════════════════════════════════════
// detectFormat()
// ═══════════════════════════════════════════════════════════════════════════

describe('detectFormat()', () => {
  test('определяет формат 1С по маркеру 1CClientBankExchange', () => {
    expect(detectFormat('1CClientBankExchange\nВерсияФормата=1.03\nКодировка=Windows')).toBe('1c_txt');
  });

  test('определяет формат Тинькофф по заголовку', () => {
    expect(detectFormat('Дата операции;Номер карты;Статус;Сумма операции')).toBe('tinkoff');
  });

  test('определяет формат Тинькофф по ключевому слову', () => {
    expect(detectFormat('Выписка Tinkoff Bank\nДата;Сумма')).toBe('tinkoff');
  });

  test('определяет формат Сбербанк по заголовку', () => {
    expect(detectFormat('Номер документа;Дата операции;Сумма')).toBe('sber');
  });

  test('определяет формат Точка по заголовку', () => {
    expect(detectFormat('Дата;Номер;Сумма;Валюта;Контрагент')).toBe('tochka');
  });

  test('по умолчанию определяет CSV', () => {
    expect(detectFormat('Дата;Сумма;Контрагент;Назначение')).toBe('csv');
  });

  test('пустая строка → csv', () => {
    expect(detectFormat('')).toBe('csv');
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// parseCSV()
// ═══════════════════════════════════════════════════════════════════════════

describe('parseCSV()', () => {
  test('парсит CSV с разделителем ";"', () => {
    const result = parseCSV(BANK_CSV_FIXTURE);
    expect(result).toHaveLength(3);
  });

  test('определяет направление (income/expense) по знаку суммы', () => {
    const result = parseCSV(BANK_CSV_FIXTURE);
    expect(result[0].direction).toBe('expense');  // -150000
    expect(result[1].direction).toBe('income');   // +500000
    expect(result[2].direction).toBe('expense');  // -85000
  });

  test('хранит абсолютные значения суммы', () => {
    const result = parseCSV(BANK_CSV_FIXTURE);
    expect(result[0].amount).toBe(150000);
    expect(result[1].amount).toBe(500000);
    expect(result[2].amount).toBe(85000);
  });

  test('парсит даты в формате DD.MM.YYYY → YYYY-MM-DD', () => {
    const result = parseCSV(BANK_CSV_FIXTURE);
    expect(result[0].transaction_date).toBe('2026-01-15');
    expect(result[1].transaction_date).toBe('2026-01-16');
    expect(result[2].transaction_date).toBe('2026-01-17');
  });

  test('извлекает контрагента для 5-колоночного CSV', () => {
    const csv5col = 'Дата;Сумма;Контрагент;Назначение;Основание\n15.01.2026;-150000.00;ООО ТрансЛогистик;Оплата по счёту №42;дог.1';
    const result = parseCSV(csv5col);
    expect(result[0].counterparty_name).toContain('ТрансЛогистик');
  });

  test('извлекает данные из 4-колоночного CSV', () => {
    const result = parseCSV(BANK_CSV_FIXTURE);
    // В 4-колоночном CSV 3-я колонка идёт в описание (нет отдельного поля контрагента)
    expect(result[0].payment_purpose || result[0].counterparty_name).toBeTruthy();
  });

  test('обрабатывает пустой файл', () => {
    expect(parseCSV('')).toHaveLength(0);
  });

  test('обрабатывает файл без данных (только заголовок)', () => {
    expect(parseCSV('Дата;Сумма;Контрагент')).toHaveLength(0);
  });

  test('парсит CSV с запятой как разделителем', () => {
    const csv = 'Дата,Сумма,Контрагент,Назначение\n01.02.2026,100000,Тест,Тестовый платёж';
    const result = parseCSV(csv);
    expect(result).toHaveLength(1);
    expect(result[0].amount).toBe(100000);
  });

  test('корректно обрабатывает строки в кавычках', () => {
    const csv = 'Дата;Сумма;Контрагент;Назначение\n01.02.2026;-50000;"ООО ""Тест""";Оплата';
    const result = parseCSV(csv);
    expect(result).toHaveLength(1);
  });

  test('содержит _hash_row для генерации хеша', () => {
    const result = parseCSV(BANK_CSV_FIXTURE);
    expect(result[0]._hash_row).toBeDefined();
    expect(result[0]._hash_row.date).toBeDefined();
    expect(result[0]._hash_row.amount).toBeDefined();
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// parse1C()
// ═══════════════════════════════════════════════════════════════════════════

describe('parse1C()', () => {
  test('парсит формат 1CClientBankExchange', () => {
    const result = parse1C(BANK_1C_FIXTURE);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  test('извлекает сумму', () => {
    const result = parse1C(BANK_1C_FIXTURE);
    expect(result[0].amount).toBe(150000);
  });

  test('определяет расход (плательщик = наш р/с)', () => {
    const result = parse1C(BANK_1C_FIXTURE);
    expect(result[0].direction).toBe('expense');
  });

  test('извлекает получателя как контрагента при расходе', () => {
    const result = parse1C(BANK_1C_FIXTURE);
    expect(result[0].counterparty_name).toContain('ТрансЛогистик');
  });

  test('извлекает ИНН получателя', () => {
    const result = parse1C(BANK_1C_FIXTURE);
    expect(result[0].counterparty_inn).toBe('7708654321');
  });

  test('извлекает номер документа', () => {
    const result = parse1C(BANK_1C_FIXTURE);
    expect(result[0].document_number).toBe('1');
  });

  test('извлекает назначение платежа', () => {
    const result = parse1C(BANK_1C_FIXTURE);
    expect(result[0].payment_purpose).toContain('Оплата по счёту');
  });

  test('обрабатывает пустой файл', () => {
    expect(parse1C('')).toHaveLength(0);
  });

  test('обрабатывает файл без секций документов', () => {
    const text = '1CClientBankExchange\nВерсияФормата=1.03\nКонецФайла';
    expect(parse1C(text)).toHaveLength(0);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// generateHash()
// ═══════════════════════════════════════════════════════════════════════════

describe('generateHash()', () => {
  test('формат хеша: tx_ + base36', () => {
    const hash = generateHash({ date: '2026-01-15', amount: -150000, counterparty: 'Тест', description: 'Оплата' });
    expect(hash).toMatch(/^tx_[a-z0-9]+$/);
  });

  test('один и тот же вход → один и тот же хеш', () => {
    const row = { date: '2026-01-15', amount: -150000, counterparty: 'ООО "ТрансЛогистик"', description: 'Оплата' };
    expect(generateHash(row)).toBe(generateHash(row));
  });

  test('разные даты → разные хеши', () => {
    const base = { amount: -150000, counterparty: 'A', description: 'B' };
    expect(generateHash({ ...base, date: '2026-01-15' })).not.toBe(generateHash({ ...base, date: '2026-01-16' }));
  });

  test('разные суммы → разные хеши', () => {
    const base = { date: '2026-01-15', counterparty: 'A', description: 'B' };
    expect(generateHash({ ...base, amount: -150000 })).not.toBe(generateHash({ ...base, amount: -200000 }));
  });

  test('обрезает контрагента и описание до 30 символов', () => {
    const short = { date: '2026-01-15', amount: 100, counterparty: 'X'.repeat(30), description: 'Y'.repeat(30) };
    const long = { date: '2026-01-15', amount: 100, counterparty: 'X'.repeat(100), description: 'Y'.repeat(100) };
    expect(generateHash(short)).toBe(generateHash(long));
  });

  test('обрабатывает null/undefined поля', () => {
    const hash = generateHash({ date: '2026-01-15', amount: 100 });
    expect(hash).toMatch(/^tx_/);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// classifyTransaction()
// ═══════════════════════════════════════════════════════════════════════════

describe('classifyTransaction()', () => {
  // Правила в формате, соответствующем bank_classification_rules
  const rules = [
    { id: 1, rule_name: 'ФОТ', article: 'fot', direction: 'expense', is_active: true, is_system: true,
      match_field: 'purpose', pattern: 'зарплат' },
    { id: 2, rule_name: 'Налоги', article: 'taxes', direction: 'expense', is_active: true, is_system: true,
      match_field: 'purpose', pattern: 'ндс' },
    { id: 3, rule_name: 'Аренда', article: 'rent', direction: 'expense', is_active: true, is_system: true,
      match_field: 'purpose', pattern: 'аренда' }
  ];

  test('классифицирует зарплату как ФОТ', () => {
    const tx = { payment_purpose: 'Зарплата за январь 2026', direction: 'expense' };
    const result = classifyTransaction(tx, rules);
    expect(result).not.toBeNull();
    expect(result.article).toBe('fot');
    expect(result.rule_id).toBe(1);
  });

  test('классифицирует НДС как налоги', () => {
    const tx = { payment_purpose: 'Уплата НДС за 4 кв. 2025', direction: 'expense' };
    const result = classifyTransaction(tx, rules);
    expect(result).not.toBeNull();
    expect(result.article).toBe('taxes');
  });

  test('не классифицирует неизвестный платёж → null', () => {
    const tx = { payment_purpose: 'Прочий платёж без ключевых слов', direction: 'expense' };
    const result = classifyTransaction(tx, rules);
    expect(result).toBeNull();
  });

  test('пустой список правил → null', () => {
    const tx = { payment_purpose: 'Зарплата', direction: 'expense' };
    const result = classifyTransaction(tx, []);
    expect(result).toBeNull();
  });

  test('правила фильтруются по direction', () => {
    const tx = { payment_purpose: 'Зарплата', direction: 'income' };
    const result = classifyTransaction(tx, rules);
    // Все правила expense, income не должен матчить
    expect(result).toBeNull();
  });

  test('неактивные правила пропускаются', () => {
    const inactiveRules = [{ ...rules[0], is_active: false }];
    const tx = { payment_purpose: 'Зарплата за январь', direction: 'expense' };
    const result = classifyTransaction(tx, inactiveRules);
    expect(result).toBeNull();
  });
});
