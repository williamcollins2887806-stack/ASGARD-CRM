'use strict';
/**
 * D-292 (заказчик 20.10.2026): график оплат показывал НЕ то.
 * ═══════════════════════════════════════════════════════════════════════════
 * Вопросы заказчика дословно:
 *   «Почему 2 счёта? почему на 649? если директор не подтвердил часть счетов???»
 *   «почему неоплаченные счета из реестра счетов туда не попали?»
 *   «я рассчитывал что график будет показывать только счета которые согласовал
 *    директор»
 *
 * РАЗБОР ФАКТА.
 * В проде на момент проверки:
 *   payment_invoices: awaiting_dir  2 счёта  604 761 ₽  ← НЕ согласованы
 *                     pending_payment 4 счёта  108 520 ₽  ← согласованы
 * График показывал 2 счёта на 649 256 ₽ и брал их из doc_registry.payment_due_at,
 * то есть:
 *   (а) включал НЕсогласованный счёт 1518 (601 456 ₽, awaiting_dir) — отсюда
 *       «649 256» и вопрос «почему, если не подтвердил»;
 *   (б) терял 3 из 4 СОГЛАСОВАННЫХ счетов (8 400 + 4 000 + 48 320 = 60 720 ₽),
 *       потому что у них в реестре срок пуст — он есть только в заявке
 *       payment_invoices.due_date.
 *
 * ВЫВОД: источник истины неверный. Согласование живёт в payment_invoices,
 * реестр — это документы, а не очередь оплаты.
 */

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; fails.push(name); console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

const ROUTE = fs.readFileSync(path.join(__dirname, '../src/routes/doc-registry.js'), 'utf8');
const JS = fs.readFileSync(path.join(__dirname, '../public/assets/js/doc-hub.js'), 'utf8');

// Вырезаем тело роута /payment-schedule — чтобы проверять именно его.
const start = ROUTE.indexOf("fastify.get('/payment-schedule'");
const end = ROUTE.indexOf("const RECON_ROLES", start);
const body = start >= 0 ? ROUTE.slice(start, end) : '';

console.log('── 1. Источник — payment_invoices, а не doc_registry ──');
check('роут найден', body.length > 500, `len=${body.length}`);
check('SELECT ... FROM payment_invoices pi', /FROM payment_invoices pi/.test(body));
check('НЕТ выборки «все со сроком из реестра»', !/WHERE d\.deleted_at IS NULL\s*\n\s*AND d\.dir = 'in'\s*\n\s*AND COALESCE\(d\.pay_status/.test(body));

console.log('\n── 2. Только согласованные директором ──');
check('фильтр по статусу заявки', /pi\.status = ANY\(\$\$\{?pStatuses/.test(body));
check('pending_payment — согласованные', /'pending_payment'/.test(body));
check('awaiting_dir отдельным режимом, не вместе', /'awaiting_dir'/.test(body) && /approvedOnly/.test(body));
check('параметр approved управляет выбором', /q\.approved/.test(body));
check('отклонённые исключены', /COALESCE\(pi\.payment_status,''\)\s*<>\s*'rejected'/.test(body));

console.log('\n── 3. Срок: заявка, с фолбэком на реестр ──');
check('due_date берётся из заявки (pi.due_date)', /pi\.due_date/.test(body));
check('фолбэк на реестр (reg_due)', /reg_due/.test(body));
check('счета без срока НЕ отбрасываются', /has_due/.test(body) && !/AND pi\.due_date IS NOT NULL/.test(body));

console.log('\n── 4. KPI не считает счета без срока в календарь ──');
check('KPI учитывает has_due', /has_due/.test(body) && /inRange/.test(body));
check('есть отдельный KPI «без срока»', /no_due:/.test(body));
check('byDay только с датой', (() => {
  const m = body.match(/const byDay = \{\};([\s\S]{0,300})/);
  return !!(m && /if \(!it\.due_at\) continue/.test(m[1]));
})());

console.log('\n── 5. UI: переключатель и честные подписи ──');
check('переключатель «Согласованные директором»', /Согласованные директором/.test(JS));
check('переключатель «Ещё не согласованы»', /Ещё не согласованы/.test(JS));
check('статус «ждёт оплаты» / «у директора»', /ждёт оплаты/.test(JS) && /у директора/.test(JS));
check('подпись «без срока» вместо пустой даты', /без срока/.test(JS));
check('карточка KPI «Без срока»', /Без срока/.test(JS));
check('период больше не подписан как «Счета к оплате» без статуса', /Согласовано к оплате/.test(JS));
check('state.payMode по умолчанию approved', /payMode: 'approved'/.test(JS));

console.log('\n── 6. Регресс: график не сломал реестр ──');
check('реестр по-прежнему использует payment_due_at', /payment_due_at/.test(ROUTE));
check('visibilitySql применён (чужие не видят лишнего)', /visibilitySql/.test(body));

console.log('\n────────────────────────────────────────');
console.log(`ИТОГ D-292: PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log('FAIL:', fails.join(' | ')); process.exit(1); }
