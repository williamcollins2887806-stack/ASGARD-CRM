'use strict';
/**
 * D-338: интеграционный тест на КЛОНЕ БД (asgard_crm_test).
 * Проверяем на реальных данных клона: находит ли дедуп существующие дубли,
 * и НЕ склеивает ли он законно разные счета.
 */
process.chdir('/var/www/asgard-crm');
require('/var/www/asgard-crm/node_modules/dotenv').config({ path: '/var/www/asgard-crm/.env' });
const { Client } = require('/var/www/asgard-crm/node_modules/pg');
const dedup = require('/var/www/asgard-crm/src/services/doc-dedup');

(async () => {
  const conn = process.env.DATABASE_URL_TEST
    || 'postgres://asgard:123456789@localhost/asgard_crm_test';
  const c = new Client({ connectionString: conn });
  await c.connect();
  const db = { query: (s, p) => c.query(s, p) };
  console.log('БД:', conn.replace(/:[^:@]+@/, ':***@'));
  dedup.resetOwnInnCache();
  const own = await dedup.ownInn(db);
  console.log('наш ИНН:', own || '(не найден!)');

  let pass = 0, fail = 0;
  const ok = (cond, msg) => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
    cond ? pass++ : fail++;
  };

  console.log('\n=== 1. Реальный дубль ДС-26027738: новая строка с нашим ИНН ===');
  // Имитируем ровно то, что пришло из письма #4995/#4905 — ИИ извлёк наш ИНН.
  const d1 = await dedup.findDuplicate(db, {
    invoice_number: 'ДС-26027738',
    amount_gross: 3305,
    invoice_date: '2026-10-19',
    counterparty_inn: own,                 // 7736244785 — наш
    counterparty_name: 'ООО "Асгард-Сервис"'
  });
  ok(!!d1 && d1.id === 1523, `наш ИНН не мешает: найден #${d1 ? d1.id : 'ничего'} (ожидали #1523)`);

  console.log('\n=== 2. Тот же счёт, но БЕЗ лица вовсе ===');
  const d2 = await dedup.findDuplicate(db, {
    invoice_number: 'ДС-26027738', amount_gross: 3305, invoice_date: '2026-10-19'
  });
  ok(!!d2 && d2.id === 1523, `тройной ключ: найден #${d2 ? d2.id : 'ничего'}`);

  console.log('\n=== 3. НЕ склеить: «№74 / 20 000 ₽» от разных ИП ===');
  // ВАЖНО: номер и дата РАЗНЫЕ — иначе это законный дубль по тройному ключу.
  // Проверяем именно вето по ИНН: тот же номер, разные люди, разные даты.
  const d3 = await dedup.findDuplicate(db, {
    invoice_number: '74', amount_gross: 20000, invoice_date: '2025-12-04',
    counterparty_inn: '519035882504', counterparty_name: 'ИП Павленко Антон Игоревич'
  });
  const d3ok = !d3 || String(d3.counterparty_inn || '').replace(/\D/g, '') === '519035882504';
  ok(d3ok, `разные ИНН → не привязано к чужому (${d3 ? 'найдено #' + d3.id + ' inn=' + d3.counterparty_inn : 'верно, ничего'})`);

  console.log('\n=== 4. НЕ склеить: аренда ИП Гужва (мусорный номер «--») ===');
  // Единственное допустимое совпадение — та же дата (тогда это тот же счёт).
  const d4 = await dedup.findDuplicate(db, {
    invoice_number: '--', amount_gross: 20000, invoice_date: '2025-11-05',
    counterparty_name: 'ИП Гужва К.Ю.'
  });
  const d4ok = !d4 || dedup.normDate(d4.invoice_date) === '2025-11-05';
  ok(d4ok, `мусорный номер → не склеено с другой датой (${d4 ? 'найдено #' + d4.id + ' ' + dedup.normDate(d4.invoice_date) : 'верно, ничего'})`);

  console.log('\n=== 5. НЕ склеить: «№1003 / 25 800 ₽» Аэроотель, разные даты ===');
  const d5 = await dedup.findDuplicate(db, {
    invoice_number: '1003', amount_gross: 25800, invoice_date: '2026-08-08',
    counterparty_inn: '7014049295', counterparty_name: 'ООО "АЭРООТЕЛЬ"'
  });
  ok(d5 === null, `разные даты при одном номере → не склеено (${d5 ? 'ОШИБКА: #' + d5.id : 'верно'})`);

  console.log('\n=== 6. НЕ найти несуществующий счёт (защита от ложных срабатываний) ===');
  const d6 = await dedup.findDuplicate(db, {
    invoice_number: 'НЕСУЩЕСТВУЮЩИЙ-999999', amount_gross: 123456.78,
    invoice_date: '2030-01-01', counterparty_inn: '9999999999', counterparty_name: 'ООО "Нет такого"'
  });
  ok(d6 === null, `нет такого счёта → ничего (${d6 ? 'ОШИБКА: #' + d6.id : 'верно'})`);

  console.log('\n=== 7. Найти по сумме+номеру известный счёт (Экопром 205) ===');
  const d7 = await dedup.findDuplicate(db, {
    invoice_number: '205', amount_gross: 79200, invoice_date: '2026-10-22',
    counterparty_inn: '5190048582', counterparty_name: 'ООО "ЭКОПРОМ"'
  });
  ok(!!d7, `известный счёт найден (#${d7 ? d7.id : 'ничего'})`);

  console.log('\n=== 8. Мусорный номер не даёт ложную склейку по имени без дат ===');
  const d8 = await dedup.findDuplicate(db, {
    invoice_number: '', amount_gross: 67000, counterparty_name: 'СОВЕРШЕННО ДРУГОЕ ООО'
  });
  ok(d8 === null, `другое имя → не склеено (${d8 ? 'ОШИБКА: #' + d8.id : 'верно'})`);

  console.log(`\n═══ ИТОГ на клоне: ${pass} PASS / ${fail} FAIL ═══`);
  await c.end();
  if (fail) process.exitCode = 1;
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
