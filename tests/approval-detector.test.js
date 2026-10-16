'use strict';
const det = require('../src/services/approval-detector');
let pass = 0, fail = 0;
const t = (name, got, exp) => {
  const ok = got === exp;
  if (ok) { pass++; console.log(`  PASS ${name}`); } else { fail++; console.log(`  FAIL ${name}: got=${got} exp=${exp}`); }
};
console.log('\n=== детект «Добро» (согласие) ===');
t('просто «Добро»', det.detectApproval('Добро').approve, true);
t('«Добро, оплачивайте»', det.detectApproval('Добро, оплачивайте').approve, true);
t('«Согласовано»', det.detectApproval('Согласовано').approve, true);
t('«Утверждаю»', det.detectApproval('Утверждаю.').approve, true);
t('«Доброе утро» (НЕ согласие)', det.detectApproval('Доброе утро, коллеги!').approve, false);
t('«доброжелательный» (НЕ согласие)', det.detectApproval('доброжелательный тон письма').approve, false);

console.log('\n=== отрицания НЕ считаем согласием ===');
t('«Не добро»', det.detectApproval('Не добро').approve, false);
t('«Не согласовано»', det.detectApproval('Не согласовано, переделайте').approve, false);
t('«Отклоняю»', det.detectApproval('Отклоняю оплату').approve, false);
t('«против»', det.detectApproval('Я против этой оплаты').approve, false);
t('«на доработку»', det.detectApproval('Отправляю на доработку').approve, false);

console.log('\n=== вопрос НЕ считаем согласием ===');
t('«Согласовать?»', det.detectApproval('Согласовать?').approve, false);
t('«Оплачивать ли?»', det.detectApproval('Оплачивать ли этот счёт?').approve, false);

console.log('\n=== цитата прежнего письма НЕ согласие ===');
const quoted = `Смотрите ниже.

--- Исходное сообщение ---
От: Инициатор
Тема: Счёт на согласование
Директор сказал добро, оплачиваем`;
t('цитата с «добро» в исх.сообщении', det.detectApproval(quoted).approve, false);
const fwd = `Добро

> предыдущее письмо: согласовано ранее`;
t('согласие сверху + цитата снизу', det.detectApproval(fwd).approve, true);
t('outlook-блок с «согласовано» внутри цитаты', det.detectApproval('Переслано\nОт: X\nКому: Y\nСогласовано').approve, false);

console.log('\n=== отказ отдельно ===');
t('«Отклоняю» = reject', det.detectRejection('Отклоняю').reject, true);
t('«Добро» ≠ reject', det.detectRejection('Добро').reject, false);

console.log('\n────────────────────────────────────────');
console.log(`ИТОГ детектора: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
