/**
 * Рантайм-проверка insertWorkExpense на клоне: НДС доезжает и обновляется.
 * Запуск: node tests/manual/writer-runtime.js
 * Требует PG-доступа к asgard_crm_test (через ssh-туннель не нужно — гоняем на сервере).
 */
const { insertWorkExpense } = require('../../../src/services/work-expense-writer');

module.exports = async function run(db) {
  const log = [];
  const assert = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); log.push('OK: ' + msg); };

  // 1. Вставка с НДС из счёта
  const created = await insertWorkExpense(db, {
    work_id: 406, category: 'materials', subcategory: 'other',
    amount: 12200, date: '2026-08-01',
    vat_rate: 22, vat_amount: 2200, amount_ex_vat: 10000, vat_basis: 'gross',
    payment_method: 'bank', source_table: 'manual', source_key: 'RUNTIME-TEST-V439'
  }, { skipValidation: true });
  assert(created.vat_amount == 2200, 'НДС записан при вставке');
  assert(created.amount_ex_vat == 10000, 'нетто записано при вставке');
  assert(created.vat_basis === 'gross', 'база записана при вставке');

  // 2. Повторный upsert с другими НДС-полями — должен обновить, а не оставить старые
  const updated = await insertWorkExpense(db, {
    work_id: 406, category: 'materials', subcategory: 'other',
    amount: 12200, date: '2026-08-01',
    vat_rate: 20, vat_amount: 2033.33, amount_ex_vat: 10166.67, vat_basis: 'gross',
    payment_method: 'bank', source_table: 'manual', source_key: 'RUNTIME-TEST-V439'
  }, { skipValidation: true });
  assert(updated.vat_amount == 2033.33, 'НДС обновился при повторной записи');
  assert(updated.vat_rate == 20, 'ставка обновилась');
  assert(updated.id === created.id, 'не создалась вторая строка');

  // 3. Уборка
  await db.query("DELETE FROM work_expenses WHERE source_key = 'RUNTIME-TEST-V439'");
  log.push('OK: тестовая строка удалена');

  return log;
};
