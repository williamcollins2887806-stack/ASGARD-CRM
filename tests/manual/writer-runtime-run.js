/**
 * Запуск writer-runtime против клона БД. Гоняется НА сервере (там есть pg и БД).
 * Использование: скопировать этот файл + writer-runtime.js + work-expense-writer.js
 * на сервер и запустить узлом с DATABASE_URL клона.
 */
const { Pool } = require('pg');
const { insertWorkExpense } = require('/tmp/work-expense-writer.js');

(async () => {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  const log = [];
  const assert = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); log.push('OK: ' + msg); };
  try {
    const created = await insertWorkExpense(db, {
      work_id: 406, category: 'materials', subcategory: 'other',
      amount: 12200, date: '2026-08-01',
      vat_rate: 22, vat_amount: 2200, amount_ex_vat: 10000, vat_basis: 'gross',
      payment_method: 'bank', source_table: 'manual', source_key: 'RUNTIME-TEST-V439'
    }, { skipValidation: true });
    assert(Number(created.vat_amount) === 2200, 'НДС записан при вставке');
    assert(Number(created.amount_ex_vat) === 10000, 'нетто записано при вставке');
    assert(created.vat_basis === 'gross', 'база записана при вставке');

    const updated = await insertWorkExpense(db, {
      work_id: 406, category: 'materials', subcategory: 'other',
      amount: 12200, date: '2026-08-01',
      vat_rate: 20, vat_amount: 2033.33, amount_ex_vat: 10166.67, vat_basis: 'net',
      payment_method: 'bank', source_table: 'manual', source_key: 'RUNTIME-TEST-V439'
    }, { skipValidation: true });
    assert(Number(updated.vat_amount) === 2033.33, 'НДС обновился при повторной записи');
    assert(Number(updated.vat_rate) === 20, 'ставка обновилась');
    assert(updated.vat_basis === 'net', 'база обновилась');
    assert(updated.id === created.id, 'не создалась вторая строка');

    await db.query("DELETE FROM work_expenses WHERE source_key = 'RUNTIME-TEST-V439'");
    log.push('OK: тестовая строка удалена');
    console.log(log.join('\n'));
    console.log('RESULT: PASS');
  } catch (e) {
    console.error('RESULT: FAIL —', e.message);
    try { await db.query("DELETE FROM work_expenses WHERE source_key = 'RUNTIME-TEST-V439'"); } catch (_) {}
    process.exit(1);
  } finally {
    await db.end();
  }
})();
