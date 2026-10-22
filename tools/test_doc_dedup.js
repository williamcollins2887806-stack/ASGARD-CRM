'use strict';
/**
 * D-338: юнит-тесты правил дедупа (без БД).
 * Проверяем не только «находит дубль», но и «НЕ склеивает разные счета» —
 * ложная склейка прячет деньги, это опаснее дубля.
 */
const assert = require('assert');
const d = require('../src/services/doc-dedup');

const OWN = '7736244785';
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`PASS  ${name}`); pass++; }
  catch (e) { console.log(`FAIL  ${name}\n      ${e.message}`); fail++; }
}

console.log('=== 1. Нормализация номера ===');
t('«№ 276» == «276»', () => assert.strictEqual(d.normDocNumber('№ 276'), '276'));
t('«no.276» == «276»', () => assert.strictEqual(d.normDocNumber('no.276'), '276'));
t('«ДС-26027738» == «ДС 26027738»', () => assert.strictEqual(d.normDocNumber('ДС-26027738'), d.normDocNumber('ДС 26027738')));
t('«--» → пусто (мусор)', () => assert.strictEqual(d.normDocNumber('--'), ''));
t('«-» → пусто', () => assert.strictEqual(d.normDocNumber('-'), ''));
t('null → пусто', () => assert.strictEqual(d.normDocNumber(null), ''));
t('«0VT/1873865/66597749» стабилен', () =>
  assert.strictEqual(d.normDocNumber('0VT/1873865/66597749'), d.normDocNumber('0vt / 1873865 / 66597749')));

console.log('\n=== 2. Наш ИНН никогда не лицо контрагента ===');
t('свой ИНН → null', () => assert.strictEqual(d.normInn(OWN, OWN), null));
t('чужой ИНН сохраняется', () => assert.strictEqual(d.normInn('3015042714', OWN), '3015042714'));
t('9 цифр → null (невалиден)', () => assert.strictEqual(d.normInn('301504271', OWN), null));

console.log('\n=== 3. Имена ===');
t('ООО «X» == Общество с ограниченной ответственностью X', () =>
  assert.strictEqual(d.normOrgName('ООО "Ромашка"'), d.normOrgName('Общество с ограниченной ответственностью «Ромашка»')));
t('ИП Иванов == Индивидуальный предприниматель Иванов', () =>
  assert.strictEqual(d.normOrgName('ИП Иванов'), d.normOrgName('Индивидуальный предприниматель Иванов')));
t('разные имена не равны', () =>
  assert.notStrictEqual(d.normOrgName('ИП Пономарёва И.В.'), d.normOrgName('ИП Пономарева О.В.')));

console.log('\n=== 4. Деньги в копейках (без плавающих ошибок) ===');
t('3305.00 → 330500', () => assert.strictEqual(d.moneyCents(3305), 330500));
t('0.1+0.2 не плывёт', () => assert.strictEqual(d.moneyCents(0.30000000000000004), 30));

console.log('\n=== 5. Mock-БД: реальные пары с прода ===');

// Имитация db.query: возвращаем заранее заданные строки для любого запроса.
function mockDb(rows) {
  return { query: async () => ({ rows }) };
}

async function run() {
  console.log('\n--- 5.1 ДУБЛЬ (реальный случай #1597 vs #1523) ---');
  {
    const existing = [{
      id: 1523, invoice_number: 'ДС-26027738', invoice_date: '2026-10-19',
      counterparty_name: 'ООО "Электротехническая компания"', counterparty_inn: '3015042714',
      amount_gross: '3305.00', dir: 'in', payment_invoice_id: 6
    }];
    const found = await d.findDuplicate(mockDb(existing), {
      invoice_number: 'ДС-26027738', amount_gross: 3305, invoice_date: '2026-10-19',
      counterparty_inn: OWN,                      // ← вот этот ИИ и извлёк (наш ИНН)
      counterparty_name: 'ООО "Асгард-Сервис"',   // ← и это
      ownInn: OWN
    });
    const ok = found && found.id === 1523;
    console.log(`${ok ? 'PASS' : 'FAIL'}   наш ИНН + наше имя НЕ мешают найти дубль (найдено: ${found ? '#' + found.id : 'ничего'})`);
    ok ? pass++ : fail++;
  }

  console.log('\n--- 5.2 НЕ ДУБЛЬ: «№74 / 20 000 ₽» от разных ИП ---');
  {
    const existing = [{
      id: 586, invoice_number: '74', invoice_date: '2025-09-09',
      counterparty_name: 'ИП Студенникова Александра Андреевна', counterparty_inn: '301711964588',
      amount_gross: '20000.00', dir: 'in'
    }];
    const found = await d.findDuplicate(mockDb(existing), {
      invoice_number: '74', amount_gross: 20000, invoice_date: '2025-12-04',
      counterparty_inn: '519035882504',
      counterparty_name: 'ИП Павленко Антон Игоревич',
      ownInn: OWN
    });
    const ok = found === null;
    console.log(`${ok ? 'PASS' : 'FAIL'}   разные ИНН при одном номере НЕ склеиваются (${found ? 'склеило с #' + found.id : 'верно, не дубль'})`);
    ok ? pass++ : fail++;
  }

  console.log('\n--- 5.3 НЕ ДУБЛЬ: аренда ИП Гужва, 5 счетов по 20 000 без номеров ---');
  {
    const existing = [{
      id: 912, invoice_number: '--', invoice_date: '2025-08-25',
      counterparty_name: 'ИП Гужва К.Ю.', counterparty_inn: null,
      amount_gross: '20000.00', dir: 'in'
    }];
    const found = await d.findDuplicate(mockDb(existing), {
      invoice_number: '--', amount_gross: 20000, invoice_date: '2025-10-27',
      counterparty_inn: null, counterparty_name: 'ИП Гужва К.Ю.',
      ownInn: OWN
    });
    const ok = found === null;
    console.log(`${ok ? 'PASS' : 'FAIL'}   мусорный номер + разные даты НЕ склеиваются (${found ? 'склеило с #' + found.id : 'верно'})`);
    ok ? pass++ : fail++;
  }

  console.log('\n--- 5.4 ДУБЛЬ без ИНН, но дата и имя совпали ---');
  {
    const existing = [{
      id: 500, invoice_number: '123', invoice_date: '2026-03-01',
      counterparty_name: 'ООО "Ромашка"', counterparty_inn: null,
      amount_gross: '1000.00', dir: 'in', payment_invoice_id: 9
    }];
    const found = await d.findDuplicate(mockDb(existing), {
      invoice_number: '123', amount_gross: 1000, invoice_date: '2026-03-01',
      counterparty_inn: null, counterparty_name: 'Общество с ограниченной ответственностью «Ромашка»',
      ownInn: OWN
    });
    const ok = found && found.id === 500;
    console.log(`${ok ? 'PASS' : 'FAIL'}   имя в разной записи формы распознано (${found ? '#' + found.id : 'не найдено'})`);
    ok ? pass++ : fail++;
  }

  console.log('\n--- 5.5 ДУБЛЬ, когда ИНН есть только у новой строки ---');
  {
    const existing = [{
      id: 700, invoice_number: '55', invoice_date: '2026-04-01',
      counterparty_name: 'ООО "Вектор"', counterparty_inn: null,
      amount_gross: '5000.00', dir: 'in'
    }];
    const found = await d.findDuplicate(mockDb(existing), {
      invoice_number: '55', amount_gross: 5000, invoice_date: '2026-04-01',
      counterparty_inn: '7701234567', counterparty_name: 'ООО "Вектор"',
      ownInn: OWN
    });
    const ok = found && found.id === 700;
    console.log(`${ok ? 'PASS' : 'FAIL'}   пустой ИНН в базе не блокирует поиск дубля (${found ? '#' + found.id : 'не найдено'})`);
    ok ? pass++ : fail++;
  }

  console.log('\n--- 5.6 НЕ ДУБЛЬ: разные номера, та же сумма ---');
  {
    const existing = [{
      id: 800, invoice_number: '101', invoice_date: '2026-05-01',
      counterparty_name: 'ООО "Тест"', counterparty_inn: '7701234567',
      amount_gross: '1000.00', dir: 'in'
    }];
    const found = await d.findDuplicate(mockDb(existing), {
      invoice_number: '102', amount_gross: 1000, invoice_date: '2026-05-01',
      counterparty_inn: '7701234567', counterparty_name: 'ООО "Тест"',
      ownInn: OWN
    });
    const ok = found === null;
    console.log(`${ok ? 'PASS' : 'FAIL'}   разные номера при известных обоих НЕ склеиваются`);
    ok ? pass++ : fail++;
  }

  console.log('\n--- 5.7 КРАЕВОЙ: сумма 0 / null не ключ ---');
  {
    const existing = [{ id: 900, invoice_number: '1', amount_gross: '0.00', dir: 'in', counterparty_name: 'X' }];
    const f1 = await d.findDuplicate(mockDb(existing), { invoice_number: '1', amount_gross: 0, ownInn: OWN });
    const f2 = await d.findDuplicate(mockDb(existing), { invoice_number: '1', amount_gross: null, ownInn: OWN });
    const ok = f1 === null && f2 === null;
    console.log(`${ok ? 'PASS' : 'FAIL'}   нулевая/пустая сумма не даёт склейку`);
    ok ? pass++ : fail++;
  }

  console.log('\n--- 5.8 КРАЕВОЙ: excludeId не даёт найти себя же ---');
  {
    const existing = [{
      id: 950, invoice_number: '9', invoice_date: '2026-06-01',
      counterparty_name: 'ООО "Себя"', counterparty_inn: '7701234567', amount_gross: '100.00', dir: 'in'
    }];
    // mockDb не фильтрует по SQL — проверяем, что excludeId уходит в запрос.
    let sawExclude = false;
    const db = {
      query: async (sql, params) => {
        if (String(sql).includes('id <>')) sawExclude = true;
        return { rows: existing };
      }
    };
    await d.findDuplicate(db, {
      invoice_number: '9', amount_gross: 100, counterparty_inn: '7701234567',
      counterparty_name: 'ООО "Себя"', excludeId: 950, ownInn: OWN
    });
    console.log(`${sawExclude ? 'PASS' : 'FAIL'}   excludeId передаётся в SQL (защита от самодубля)`);
    sawExclude ? pass++ : fail++;
  }

  console.log('\n--- 5.9 Идемпотентность нормализации (двойной прогон) ---');
  {
    const once = d.normDocNumber('№ ДС-26027738');
    const twice = d.normDocNumber(once);
    const ok = once === twice;
    console.log(`${ok ? 'PASS' : 'FAIL'}   нормализация идемпотентна («${once}» → «${twice}»)`);
    ok ? pass++ : fail++;
  }

  console.log('\n--- 5.10 НЕ ДУБЛЬ: «№1003 / 25 800 ₽» Аэроотель, разные даты ---');
  {
    const existing = [{
      id: 875, invoice_number: '1003', invoice_date: '2026-08-05',
      counterparty_name: 'ООО "АЭРООТЕЛЬ"', counterparty_inn: '7014049295',
      amount_gross: '25800.00', dir: 'in'
    }];
    const found = await d.findDuplicate(mockDb(existing), {
      invoice_number: '1003', amount_gross: 25800, invoice_date: '2026-08-08',
      counterparty_inn: '7014049295', counterparty_name: 'ООО "АЭРООТЕЛЬ"',
      ownInn: OWN
    });
    const ok = found === null;
    console.log(`${ok ? 'PASS' : 'FAIL'}   одинаковый номер+сумма, РАЗНЫЕ даты → разные счета (${found ? 'склеило с #' + found.id : 'верно'})`);
    ok ? pass++ : fail++;
  }

  console.log('\n--- 5.11 ДУБЛЬ: номер+сумма+дата, лицо не подтверждается (случай #1597) ---');
  {
    const existing = [{
      id: 1523, invoice_number: 'ДС-26027738', invoice_date: '2026-10-19',
      counterparty_name: 'ООО "Электротехническая компания"', counterparty_inn: '3015042714',
      amount_gross: '3305.00', dir: 'in', payment_invoice_id: 6
    }];
    const found = await d.findDuplicate(mockDb(existing), {
      invoice_number: 'ДС-26027738', amount_gross: 3305, invoice_date: '2026-10-19',
      counterparty_inn: null, counterparty_name: null, ownInn: OWN
    });
    const ok = found && found.id === 1523;
    console.log(`${ok ? 'PASS' : 'FAIL'}   тройной ключ ловит дубль без лица (${found ? '#' + found.id : 'не найдено'})`);
    ok ? pass++ : fail++;
  }

  console.log('\n--- 5.13 КРАЕВОЙ: Date из PostgreSQL не сдвигается на день ---');
  {
    // Регресс: `String(date).slice(0,10)` давал «Mon Oct 19», а toISOString()
    // на UTC+3 сдвигал 2026-10-19 на 2026-10-18. Оба варианта ломали дедуп.
    const asDate = new Date(2026, 9, 19);   // 19 октября 2026, локальная полночь
    const got = d.normDate(asDate);
    const ok = got === '2026-10-19';
    console.log(`${ok ? 'PASS' : 'FAIL'}   Date → ${got} (ожидали 2026-10-19)`);
    ok ? pass++ : fail++;
  }

  console.log('\n--- 5.14 Дата из строки и из Date дают одно значение ---');
  {
    const a = d.normDate('2026-10-19');
    const b = d.normDate(new Date(2026, 9, 19));
    const c2 = d.normDate('19.10.2026');
    const ok = a === b && b === c2;
    console.log(`${ok ? 'PASS' : 'FAIL'}   «2026-10-19» == Date == «19.10.2026» → ${a} / ${b} / ${c2}`);
    ok ? pass++ : fail++;
  }
  {
    const existing = [{
      id: 960, invoice_number: '777', invoice_date: null,
      counterparty_name: 'ООО "Альфа"', counterparty_inn: '7701111111',
      amount_gross: '5000.00', dir: 'in'
    }];
    const found = await d.findDuplicate(mockDb(existing), {
      invoice_number: '777', amount_gross: 5000, invoice_date: null,
      counterparty_inn: '7702222222', counterparty_name: 'ООО "Бета"', ownInn: OWN
    });
    const ok = found === null;
    console.log(`${ok ? 'PASS' : 'FAIL'}   разные ИНН без дат не склеиваются (${found ? 'склеило с #' + found.id : 'верно'})`);
    ok ? pass++ : fail++;
  }

  console.log(`\n═══ ИТОГ: ${pass} PASS / ${fail} FAIL ═══`);
  if (fail) process.exitCode = 1;
}

run().catch((e) => { console.error('ERR', e); process.exit(1); });
