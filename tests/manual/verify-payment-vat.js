/** Проверка: НДС из заявки на оплату доходит до расхода (дефект D верификатора). */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../src/routes/payment-invoices.js'), 'utf8');
const block = src.match(/async function autoWorkExpense[\s\S]*?\n\}/);
if (!block) { console.error('autoWorkExpense не найдена'); process.exit(1); }
const code = block[0];

let fail = 0;
const checks = [
  ['читает payment.vat_amount', /payment\.vat_amount/.test(code)],
  ['читает payment.amount_net', /payment\.amount_net/.test(code)],
  ['читает payment.vat_rate', /payment\.vat_rate/.test(code)],
  ['не полагается только на docRow', /usePay/.test(code)],
  ['передаёт vat_amount в insertWorkExpense', /vat_amount:\s*hasVat/.test(code)],
  ['передаёт amount_ex_vat', /amount_ex_vat:\s*hasVat/.test(code)],
  ['передаёт vat_basis', /vat_basis:\s*hasVat/.test(code)],
  // не должно остаться старого «только из карточки»
  ['нет hasDocVat-монополии', !/const hasDocVat = docVat > 0;/.test(code)],
];

console.log('=== autoWorkExpense: НДС из заявки ===');
for (const [name, ok] of checks) {
  if (!ok) fail++;
  console.log((ok ? '  OK   ' : '  FAIL ') + name);
}
console.log('');
console.log(fail ? 'ПРОВАЛОВ: ' + fail : 'ВСЁ ПРОШЛО');
process.exit(fail ? 1 : 0);
