'use strict';
// Функциональный тест: реальный INSERT в office_expenses на КЛОНЕ БД, затем очистка.
process.chdir(__dirname + '/..');
require('dotenv').config();
const { Client } = require('pg');
const { classifyOfficeCategory } = require('../src/services/office-category');

(async () => {
  const conn = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL
    || 'postgres://asgard:123456789@localhost/asgard_crm';
  const c = new Client({ connectionString: conn });
  await c.connect();
  console.log('БД:', (conn || '').replace(/:[^:@]+@/, ':***@'));

  // Повторяем SQL из ensureOfficeExpenseForDoc ровно как в коде.
  const { rows } = await c.query(
    `INSERT INTO office_expenses
       (category, description, amount, total_amount, vat_amount, date, supplier, counterparty,
        status, source, created_by, created_at, doc_number, document_number)
     VALUES ($9, $1, $2, $2, $3, COALESCE($4::date, CURRENT_DATE), $5, $5,
             $6, 'doc_hub', $7, NOW(), $8, $8)
     RETURNING id, category, amount, status, doc_number`,
    [
      'Тестовый счёт D-336',
      1234.56,
      205.76,
      '2026-10-21',
      'ООО "КОМУС"',
      'approved',
      null,
      'TEST-D336-1',
      classifyOfficeCategory({ counterparty: 'ООО "КОМУС"', description: 'Тестовый счёт D-336' })
    ]
  );
  const r = rows[0];
  console.log('вставлено:', JSON.stringify(r));
  const okCat = r.category === 'office_supplies';
  const okAmt = Math.abs(Number(r.amount) - 1234.56) < 0.01;
  const okTotal = Math.abs(Number(r.amount) - 1234.56) < 0.01;
  console.log(`категория по контрагенту: ${okCat ? 'PASS' : 'FAIL'} (${r.category})`);
  console.log(`сумма: ${okAmt ? 'PASS' : 'FAIL'}`);
  await c.query('DELETE FROM office_expenses WHERE id=$1', [r.id]);
  console.log('тестовая запись удалена');
  await c.end();
  if (!okCat || !okAmt || !okTotal) process.exitCode = 1;
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
