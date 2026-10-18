const det = require('../src/services/approval-detector');
// Явные негативные формулировки, которых НЕТ в списке NEGATIONS, но которые
// человек использует как ОТКАЗ. Ожидание: approve=false.
const negatives = [
  'Не одобряю',
  'не одобряю оплату',
  'НЕ ОДОБРЯЮ',
  'Не утверждено',
  'Не утверждаю оплату',   // это в списке
  'Не утверждено, верните',
  'не подтверждено',
  'Не оплачивайте',
  'не оплачивать',          // в списке
  'НЕ СОГЛАСОВАНО',        // в списке
  'согласовать не могу',
  'воздерживаюсь',
  'Пока не готов согласовать',
];
console.log('=== ОЖИДАЕМ отказ (approve должен быть false) ===');
for (const b of negatives) {
  const r = det.detectApproval(b);
  console.log(`${r.approve ? '!!! FALSE-APPROVE' : 'ok false      '} word=${r.word || '-'} neg=${r.negative ? 'Y' : '-'} | <<${b}>>`);
}
console.log('\n=== «Добро пожаловать» / «Добро?» ===');
for (const b of ['Добро пожаловать в проект', 'Добро пожаловать!', 'Добро?', 'Добро ??', 'добро пожаловать, счёт во вложении']) {
  const r = det.detectApproval(b);
  console.log(`${r.approve ? '!!! FALSE-APPROVE' : 'ok false      '} | <<${b}>>`);
}
