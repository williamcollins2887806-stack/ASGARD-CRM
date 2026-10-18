/**
 * V410: номенклатура из счёта НЕ дублируется при повторной обработке.
 * Дефект живого теста 18.10.2026: 15 прогонов одного счёта → 15 одинаковых
 * строк в price_records (искажение истории цен). Теперь позиция опознаётся по
 * (документ + наименование + артикул) и обновляется, а не дублируется.
 */
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
const { Client } = require('pg');
const { enrichCatalogFromLines } = require('../src/services/catalog-from-invoice');

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

(async () => {
  const db = new Client({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
  await db.connect();

  // Своя тестовая строка реестра (реальные не трогаем).
  const doc = (await db.query(
    `INSERT INTO doc_registry(dir,package_type,ops_status,pay_status,invoice_number,invoice_date,
       counterparty_name,counterparty_inn,amount_gross,amount_net,vat_amount,has_vat,wh_status,parsed_json)
     VALUES ('in','invoice','wait_sf','wait','DUP-1',CURRENT_DATE,'ООО «ДУБЛЬ-ТЕСТ»','7701234567',
       3540,2901.64,638.36,true,'none','[]'::jsonb) RETURNING id`)).rows[0];
  const tag = 'DUPTEST-' + Date.now();
  const lines = [
    { name: `Позиция один ${tag}`, unit_price: 590, quantity: 6, unit: 'шт' },
    { name: `Позиция два ${tag}`, unit_price: 250.5, quantity: 2, unit: 'шт' }
  ];
  const call = () => enrichCatalogFromLines(db, {
    lines, supplierName: 'ООО «ДУБЛЬ-ТЕСТ»', userId: 3474, source: 'quote',
    docRegistryId: doc.id, invoiceDate: '2026-07-17', invoiceNumber: 'DUP-1'
  });

  console.log('=== Повторная обработка одного счёта ===');
  await call();                       // 1-й прогон
  const n1 = (await db.query(`SELECT count(*)::int n FROM price_records WHERE doc_registry_id=$1`, [doc.id])).rows[0].n;
  ok(n1 === 2, 'после 1-го прогона 2 позиции (получили ' + n1 + ')');

  await call(); await call(); await call();   // ещё три прогона
  const n5 = (await db.query(`SELECT count(*)::int n FROM price_records WHERE doc_registry_id=$1`, [doc.id])).rows[0].n;
  ok(n5 === 2, 'после 4 прогонов ВСЁ ЕЩЁ 2 позиции (получили ' + n5 + ') — дублей нет');

  console.log('\n=== Обновление, а не дублирование (цена изменилась) ===');
  await enrichCatalogFromLines(db, {
    lines: [{ name: `Позиция один ${tag}`, unit_price: 700, quantity: 5, unit: 'шт' }],
    supplierName: 'ООО «ДУБЛЬ-ТЕСТ»', userId: 3474, source: 'quote',
    docRegistryId: doc.id, invoiceDate: '2026-07-17', invoiceNumber: 'DUP-1'
  });
  const row = (await db.query(`SELECT unit_price, quantity, total FROM price_records WHERE doc_registry_id=$1 AND item_name=$2`, [doc.id, `Позиция один ${tag}`])).rows[0];
  ok(Number(row.unit_price) === 700 && Number(row.quantity) === 5, 'цена/количество обновились: ' + row.unit_price + ' × ' + row.quantity);
  ok(Number(row.total) === 3500, 'сумма пересчитана: ' + row.total);
  const n6 = (await db.query(`SELECT count(*)::int n FROM price_records WHERE doc_registry_id=$1`, [doc.id])).rows[0].n;
  ok(n6 === 2, 'строк по-прежнему 2 (получили ' + n6 + ')');

  console.log('\n=== Дубли внутри ОДНОГО счёта отсекаются ===');
  const before = (await db.query(`SELECT count(*)::int n FROM price_records WHERE doc_registry_id=$1`, [doc.id])).rows[0].n;
  await enrichCatalogFromLines(db, {
    lines: [
      { name: `Позиция три ${tag}`, unit_price: 100, quantity: 1 },
      { name: `Позиция три ${tag}`, unit_price: 100, quantity: 1 }
    ],
    supplierName: 'ООО «ДУБЛЬ-ТЕСТ»', userId: 3474, source: 'quote',
    docRegistryId: doc.id, invoiceDate: '2026-07-17', invoiceNumber: 'DUP-1'
  });
  const after = (await db.query(`SELECT count(*)::int n FROM price_records WHERE doc_registry_id=$1`, [doc.id])).rows[0].n;
  ok(after === before + 1 || after === before, 'повтор внутри счёта не создал лишнюю строку (' + before + ' → ' + after + ')');

  // уборка — только своё
  await db.query(`DELETE FROM price_records WHERE doc_registry_id=$1`, [doc.id]);
  await db.query(`DELETE FROM doc_registry WHERE id=$1`, [doc.id]);
  await db.query(`DELETE FROM products WHERE name LIKE $1`, ['%' + tag + '%']);
  await db.end();
  console.log(`\nPASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
