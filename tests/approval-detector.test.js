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

console.log('\n=== ОБХОДЫ ВЕРИФИКАТОРА (17.10) — раньше согласовывали счёт ===');
t('«Пока не оплачивайте»', det.detectApproval('Пока не оплачивайте').approve, false);
t('«Не оплачивайте пока»', det.detectApproval('Не оплачивайте пока').approve, false);
t('«Я не даю добро»', det.detectApproval('Я не даю добро').approve, false);
t('«Добро, но не оплачивайте»', det.detectApproval('Добро, но не оплачивайте').approve, false);
t('«Не подтверждаю оплату»', det.detectApproval('Не подтверждаю оплату').approve, false);
t('«Оплачивайте позже»', det.detectApproval('Оплачивайте позже').approve, false);
t('«Отложить оплату»', det.detectApproval('Отложить оплату').approve, false);
t('«Запрещаю оплачивать»', det.detectApproval('Запрещаю оплачивать').approve, false);
t('«Отмена, не оплачивайте»', det.detectApproval('Отмена, не оплачивайте').approve, false);
t('«Добро пожаловать» (НЕ согласие)', det.detectApproval('Добро пожаловать в команду!').approve, false);
t('«Оплачиваем?»', det.detectApproval('Оплачиваем?').approve, false);
t('«Добро, так?»', det.detectApproval('Добро, так?').approve, false);
t('Outlook-блок От/Кому с «добро» в цитате', det.detectApproval('См. ниже\nОт: X\nКому: Y\nДобро').approve, false);
t('Отправлено: блок с «согласовано» в цитате', det.detectApproval('Пересылаю письмо\nОтправлено: вчера\nСогласовано').approve, false);
// Положительные, которые ОБЯЗАНЫ остаться согласием:
t('«Да, добро»', det.detectApproval('Да, добро').approve, true);
t('«Добро!»', det.detectApproval('Добро!').approve, true);
t('«Согласовано, оплачивайте»', det.detectApproval('Согласовано, оплачивайте').approve, true);
t('«Даю добро»', det.detectApproval('Даю добро на оплату').approve, true);

console.log('\n=== ОБХОД №2 ВЕРИФИКАТОРА: негатив в СЛЕДУЮЩЕМ предложении ===');
t('«Добро. Не оплачивайте.»', det.detectApproval('Добро. Не оплачивайте.').approve, false);
t('«Согласовано. Отменяю оплату.»', det.detectApproval('Согласовано. Отменяю оплату.').approve, false);
t('«Утверждаю. Но оплату отложить.»', det.detectApproval('Утверждаю. Но оплату отложить.').approve, false);
t('«Согласовано!\\nОтклоняю»', det.detectApproval('Согласовано!\nОтклоняю').approve, false);
t('«Добро. Не оплачивайте этот счёт!»', det.detectApproval('Добро. Не оплачивайте этот счёт!').approve, false);
t('«оплачивайте\\n\\nп.с. нет, стоп»', det.detectApproval('оплачивайте\n\nп.с. нет, стоп').approve, false);
t('«Добро, но позже»', det.detectApproval('Добро, но позже').approve, false);

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
