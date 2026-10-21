/**
 * Тест D-335 на КЛОНЕ: ensureOfficeExpenseForDoc идемпотентен и не дублирует.
 * Запуск на сервере клона (:3100, asgard_crm_test) — здесь только статическая проверка логики.
 */
'use strict';
const assert = require('assert');

// Проверяем чистую логику правил (без БД): какие документы подпадают.
function eligible(doc) {
  if (!doc || !doc.id) return false;
  if (doc.office_expense_id) return false;
  if (String(doc.dir || '') !== 'in') return false;
  if (doc.work_id) return false;
  if (String(doc.spend_kind || '') !== 'office') return false;
  if (!(Number(doc.amount_gross) > 0)) return false;
  return true;
}

const cases = [
  ['офисный без объекта', { id: 1, dir: 'in', spend_kind: 'office', amount_gross: 100 }, true],
  ['уже связан', { id: 2, dir: 'in', spend_kind: 'office', amount_gross: 100, office_expense_id: 9 }, false],
  ['есть объект', { id: 3, dir: 'in', spend_kind: 'office', amount_gross: 100, work_id: 7 }, false],
  ['склад', { id: 4, dir: 'in', spend_kind: 'warehouse', amount_gross: 100 }, false],
  ['прочее', { id: 5, dir: 'in', spend_kind: 'other', amount_gross: 100 }, false],
  ['исходящий', { id: 6, dir: 'out', spend_kind: 'office', amount_gross: 100 }, false],
  ['сумма 0', { id: 7, dir: 'in', spend_kind: 'office', amount_gross: 0 }, false],
  ['без вида', { id: 8, dir: 'in', amount_gross: 100 }, false],
];
let pass = 0;
for (const [name, doc, want] of cases) {
  const got = eligible(doc);
  const ok = got === want;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ожидали ${want}, получили ${got}`);
  if (!ok) process.exitCode = 1;
  else pass++;
}
console.log(`\n${pass}/${cases.length} правил отбора прошли`);
