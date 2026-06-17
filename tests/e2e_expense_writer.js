/**
 * E2E смоук: 8 разнотипных записей → проверка writer/CHECK-constraints/financial-summary.
 *
 *   1. cash + supplies               → 55%, без НДС
 *   2. cash + gsm                    → 55%, без НДС
 *   3. subcontract + lathe           → 55%, без НДС
 *   4. materials + bank + НДС 1818   → 0%,  НДС 1818
 *   5. fot + auto                    → 55%, без НДС
 *   6. per_diem + auto               → 55%, без НДС
 *   7. accommodation + bank + НДС    → 0%,  НДС 833
 *   8. other + bank                  → 0%,  без НДС
 *
 *   Также негативные тесты CHECK:
 *   - category='garbage' → должно упасть
 *   - cash + subcategory='lathe' → должно упасть (lathe только под subcontract)
 *   - payment_method='qr' → должно упасть
 *
 * Запуск: DB_PASSWORD=123456789 DB_NAME=asgard_crm_test node tests/e2e_expense_writer.js
 */
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
process.env.DB_NAME = process.env.DB_NAME || 'asgard_crm_test';

const { Pool } = require('pg');
const db = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'asgard',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});
db.query = ((orig) => async (...args) => orig.apply(db, args))(db.query);

const { insertWorkExpense } = require('../src/services/work-expense-writer');
const expenseTax = require('../src/services/expense-tax');

const WORK_ID = 11;
const SOURCE = 'e2e_test_v219';

let passed = 0;
let failed = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log('  ✓ ' + name); })
    .catch((e) => { failed++; console.log('  ✗ ' + name + ' — ' + e.message); });
}

const FIXTURES = [
  { name: 'cash/supplies',    p: { work_id: WORK_ID, category: 'cash', subcategory: 'supplies', amount: 626, supplier: 'Леруа Мерлен', description: 'Стройматериалы', payment_method: 'cash' } },
  { name: 'cash/gsm',         p: { work_id: WORK_ID, category: 'cash', subcategory: 'gsm', amount: 2027.70, supplier: 'TEBOIL', description: 'АИ-95 50 л', payment_method: 'cash' } },
  { name: 'subcontract/lathe',p: { work_id: WORK_ID, category: 'subcontract', subcategory: 'lathe', amount: 20000, supplier: 'Токарь', description: 'Фалы Вулкан', payment_method: 'cash' } },
  { name: 'materials/bank',   p: { work_id: WORK_ID, category: 'materials', amount: 10000, vat_rate: 20, vat_amount: 1818.18, supplier: 'OZON', description: 'Форсунки', payment_method: 'bank' } },
  { name: 'fot/auto',         p: { work_id: WORK_ID, category: 'fot', amount: 100000, supplier: 'Иванов И.И.', description: 'ЗП май', payment_method: 'auto' } },
  { name: 'per_diem/auto',    p: { work_id: WORK_ID, category: 'per_diem', amount: 10000, supplier: 'Иванов И.И.', description: 'Суточные', payment_method: 'auto' } },
  { name: 'accommodation/bank',p:{ work_id: WORK_ID, category: 'accommodation', amount: 5000, vat_rate: 20, vat_amount: 833.33, supplier: 'Hotel ИП', description: 'Сутки×3', payment_method: 'bank' } },
  { name: 'other/bank',       p: { work_id: WORK_ID, category: 'other', amount: 300, supplier: 'Прочее', description: 'Канцтовары', payment_method: 'bank' } },
];

async function main() {
  // Cleanup
  await db.query("DELETE FROM work_expenses WHERE source_table = $1", [SOURCE]);

  console.log('=== Позитивные: insertWorkExpense + 55%/НДС ===');
  const inserted = [];
  for (const f of FIXTURES) {
    await check('insert ' + f.name, async () => {
      const row = await insertWorkExpense(db, {
        ...f.p,
        source_table: SOURCE,
        source_key: SOURCE + ':' + f.name,
        status: 'confirmed',
      });
      if (!row?.id) throw new Error('нет id');
      inserted.push(row);
    });
  }

  console.log('\n=== Негативные: CHECK-constraints ловят мусор ===');
  await check('category=garbage → CHECK', async () => {
    try {
      await insertWorkExpense(db, { work_id: WORK_ID, category: 'garbage', amount: 100, source_table: SOURCE, source_key: 'neg:garbage' }, { skipValidation: true });
      throw new Error('должен был упасть, но прошёл');
    } catch (e) {
      if (!/violates check|chk_work_expenses_category/.test(e.message)) throw e;
    }
  });
  await check('cash+lathe → CHECK', async () => {
    try {
      await insertWorkExpense(db, { work_id: WORK_ID, category: 'cash', subcategory: 'lathe', amount: 100, source_table: SOURCE, source_key: 'neg:cashlathe' }, { skipValidation: true });
      throw new Error('должен был упасть, но прошёл');
    } catch (e) {
      if (!/violates check|chk_work_expenses_subcategory/.test(e.message)) throw e;
    }
  });
  await check('payment_method=qr → CHECK', async () => {
    try {
      await insertWorkExpense(db, { work_id: WORK_ID, category: 'other', amount: 100, payment_method: 'qr', source_table: SOURCE, source_key: 'neg:qr' }, { skipValidation: true });
      throw new Error('должен был упасть, но прошёл');
    } catch (e) {
      if (!/violates check|chk_work_expenses_payment_method/.test(e.message)) throw e;
    }
  });

  console.log('\n=== Negative: serverside validation в helper-writer ===');
  await check('garbage без skipValidation → 400-text', async () => {
    try {
      await insertWorkExpense(db, { work_id: WORK_ID, category: 'garbage', amount: 100 });
      throw new Error('должен был упасть, но прошёл');
    } catch (e) {
      if (!/не входит в список/.test(e.message)) throw e;
    }
  });

  console.log('\n=== Сверка 55% / НДС вручную vs expense-tax.aggregate ===');
  const { rows: testRows } = await db.query("SELECT * FROM work_expenses WHERE source_table = $1 AND id = ANY($2)", [SOURCE, inserted.map(r => r.id)]);
  const agg = expenseTax.aggregate(testRows);

  // Ручные ожидания:
  const totalExpected = 626 + 2027.70 + 20000 + 10000 + 100000 + 10000 + 5000 + 300; // 147953.70
  // taxable: cash×2 + subcontract + fot(auto) + per_diem(auto) = 626 + 2027.70 + 20000 + 100000 + 10000 = 132653.70
  const taxBaseExpected = 626 + 2027.70 + 20000 + 100000 + 10000;
  const taxBurdenExpected = Math.round(taxBaseExpected * 0.55 * 100) / 100; // 72959.535 → 72959.54
  const vatExpected = 1818.18 + 833.33; // 2651.51

  await check('total = ' + totalExpected, () => {
    if (Math.abs(agg.total - totalExpected) > 0.01) throw new Error('got ' + agg.total);
  });
  await check('taxBurden = ' + taxBurdenExpected, () => {
    if (Math.abs(agg.taxBurden - taxBurdenExpected) > 0.01) throw new Error('got ' + agg.taxBurden);
  });
  await check('vatDeductible = ' + vatExpected, () => {
    if (Math.abs(agg.vatDeductible - vatExpected) > 0.01) throw new Error('got ' + agg.vatDeductible);
  });

  console.log('\n=== Сверка через GET /api/works/:id/financial-summary helper ===');
  // Воспроизводим логику works.js financial-summary локально (без HTTP)
  let summary_tax = 0;
  let summary_vat = 0;
  let summary_total = 0;
  for (const r of testRows) {
    const amt = parseFloat(r.amount) || 0;
    summary_total += amt;
    summary_tax += expenseTax.calcTaxBurden(r, 55);
    summary_vat += expenseTax.calcVatDeductible(r);
  }
  summary_total = Math.round(summary_total * 100) / 100;
  summary_tax = Math.round(summary_tax * 100) / 100;
  summary_vat = Math.round(summary_vat * 100) / 100;
  await check('financial-summary total = ' + totalExpected, () => {
    if (Math.abs(summary_total - totalExpected) > 0.01) throw new Error('got ' + summary_total);
  });
  await check('financial-summary tax = ' + taxBurdenExpected, () => {
    if (Math.abs(summary_tax - taxBurdenExpected) > 0.01) throw new Error('got ' + summary_tax);
  });
  await check('financial-summary vat = ' + vatExpected, () => {
    if (Math.abs(summary_vat - vatExpected) > 0.01) throw new Error('got ' + summary_vat);
  });

  console.log('\n=== Защита от double-count (worker_payments + ручной cash) ===');
  // Сценарий: ФОТ уже автосинкнулся (source_table='worker_payments').
  // РП по ошибке вносит ту же сумму ещё раз как cash. Проверяем: оба попадают
  // в total, но writer должен по source_key защититься, если ключ совпадает.
  const dupKey = SOURCE + ':dup:1';
  await insertWorkExpense(db, {
    work_id: WORK_ID, category: 'fot', amount: 50000, supplier: 'Двойник',
    payment_method: 'auto', source_table: 'worker_payments', source_key: dupKey
  }, { skipValidation: true });
  await insertWorkExpense(db, {
    work_id: WORK_ID, category: 'fot', amount: 50000, supplier: 'Двойник',
    payment_method: 'auto', source_table: 'worker_payments', source_key: dupKey
  }, { skipValidation: true });
  await check('Один и тот же source_key → 1 запись (ON CONFLICT)', async () => {
    const { rows } = await db.query("SELECT COUNT(*)::int c FROM work_expenses WHERE source_key = $1", [dupKey]);
    if (rows[0].c !== 1) throw new Error('Дубликаты не предотвращены: ' + rows[0].c);
  });

  // Cleanup
  await db.query("DELETE FROM work_expenses WHERE source_table IN ($1, 'worker_payments') AND (source_key = $2 OR source_table = $1)", [SOURCE, dupKey]);
  await db.end();

  console.log('\n=== Сводка ===');
  console.log('Passed: ' + passed);
  console.log('Failed: ' + failed);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
