'use strict';
/**
 * D-294 (заказчик 20.10.2026): срок оплаты — не выдумывать, а понимать.
 * ═══════════════════════════════════════════════════════════════════════════
 * Требование дословно: «сейчас нужно починить что сломано чтобы не выдумывало
 * и реально ставила срок» + выбран вариант C: если счёт срока не содержит,
 * поле остаётся пустым, срок ставит инициатор руками.
 *
 * ЧТО БЫЛО:
 *  1) Если счёт не печатал срок, doc-email-intake писал invoice_date + 10 дней
 *     и выдавал это за срок из бумаги. Audit: у 4 из 6 заявок дельта ровно 10
 *     при ПУСТОМ parse_raw.payment_due_at. Светофор и напоминания считали по
 *     выдуманной дате → ложные просрочки.
 *  2) Парсер понимал только «оплата до / оплатить до / срок оплаты». Реальные
 *     формулировки терялись: «Счёт действителен до 22.10.2026», «Оплатить не
 *     позднее 23.10.2026», «Оплата в течение 5 банковских дней».
 *  3) CHECK emails_email_type_check не пропускал категории сортировщика папок
 *     (tkp/invoice/act/contract/...) → 189 ошибок в сутки.
 */

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; fails.push(name); console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

const { extractInvoice } = require('../src/services/invoice-extract');
const INTAKE = fs.readFileSync(path.join(__dirname, '../src/services/doc-email-intake.js'), 'utf8');

// ─────────────────────────────────────────────────────────────────────────
console.log('── 1. Парсер понимает реальные формулировки ──');
{
  const cases = [
    ['Счёт на оплату № 5. Внимание! Счет действителен до 22.10.2026. Итого 1000', '2026-10-22', 'счёт действителен до'],
    ['Счёт № 1. Оплатить не позднее 23.10.2026. Сумма 500', '2026-10-23', 'оплатить не позднее'],
    ['Оплата до 25.10.2026. Счёт №2 от 10.10.2026', '2026-10-25', 'оплата до'],
    ['Срок оплаты: 25.10.2026. Счёт №3', '2026-10-25', 'срок оплаты'],
    ['Счёт №6. Оплата не позднее 15.11.2026', '2026-11-15', 'оплата не позднее'],
  ];
  for (const [text, want, label] of cases) {
    const got = extractInvoice(text).payment_due_at;
    check(label, got === want, `got=${got} want=${want}`);
  }
}

console.log('\n── 2. Дата словами и относительный срок ──');
{
  check('«оплата до 25 октября 2026»', extractInvoice('Счёт №3. Срок оплаты: 25 октября 2026 г. Итого 100').payment_due_at === '2026-10-25');
  check('«оплата до 5 ноября» (год текущий)', /-11-05$/.test(String(extractInvoice('Счёт №4. Оплата до 5 ноября. Итого 90').payment_due_at || '')));
  // «в течение N дней» считается от даты счёта — это НЕ выдумка, срок указан в бумаге.
  const r = extractInvoice('Оплата в течение 5 банковских дней. Счёт №4 от 01.10.2026. Итого 700');
  check('«в течение 5 банковских дней» → дата счёта + 5', r.payment_due_at === '2026-10-06', `got=${r.payment_due_at}`);
}

console.log('\n── 3. Если срока нет — его НЕ выдумывают ──');
{
  const cases = [
    'Счёт №5 от 01.10.2026. Итого 1000 рублей.',
    'Счёт на оплату № 7 от 05.10.2026. Сумма 5000.',
    'Счёт №8. Оплата данного счёта означает согласие с условиями.',
  ];
  for (const t of cases) {
    const got = extractInvoice(t).payment_due_at;
    check(`без срока: ${t.slice(0, 34)}…`, got == null, `got=${got}`);
  }
  // Отдельно: «счёт действителен в течение 5 рабочих дней» — это про срок
  // действия КП, а не про deadline оплаты; формула «в течение N дней» требует
  // слова «оплата» перед ней, поэтому здесь срока быть не должно.
  const tricky = extractInvoice('Счёт действителен в течение 5 рабочих дней! Счёт №9 от 01.10.2026').payment_due_at;
  check('«действителен в течение 5 дней» (без «оплата») не путается', tricky == null, `got=${tricky}`);
}

console.log('\n── 4. Intake больше не выдумывает срок ──');
{
  check('формула invoice_date + N удалена из intake', !/d0\.setUTCDate\(d0\.getUTCDate\(\) \+ days\)/.test(INTAKE));
  check('нет чтения settings.doc_due_days', !/doc_due_days/.test(INTAKE));
  check('срок = intent.due_date || parsed.payment_due_at', /const dueDate = intent\.due_date \|\| parsed\.payment_due_at \|\| null/.test(INTAKE));
  check('есть маркер источника срока (dueSource)', /const dueSource =/.test(INTAKE));
  check('комментарий объясняет запрет выдумывания', /НЕ ВЫДУМЫВАЕМ/.test(INTAKE));
}

console.log('\n── 5. Миграции: очистка выдуманного и constraint ──');
{
  const m421 = fs.readFileSync(path.join(__dirname, '../migrations/V421__emails_email_type_categories.sql'), 'utf8');
  const m422 = fs.readFileSync(path.join(__dirname, '../migrations/V422__drop_invented_due_dates.sql'), 'utf8');
  check('V421 добавляет категории сортировщика', /'tkp', 'tender', 'invoice', 'act', 'contract', 'correspondence', 'other'/.test(m421));
  check('V421 сохраняет исторические значения', /'direct_request', 'platform_tender', 'newsletter', 'internal'/.test(m421));
  check('V421 не удаляет данные', !/DELETE\s+FROM/i.test(m421));
  check('V422 чистит только +10', /INTERVAL '10 days'/.test(m422));
  check('V422 проверяет, что в бумаге срока не было', /parse_raw::jsonb ->> 'payment_due_at'/.test(m422));
  check('V422 не трогает заявки со сроком из документа', /NOT EXISTS[\s\S]{0,300}payment_due_at/.test(m422));
}

console.log('\n────────────────────────────────────────');
console.log(`ИТОГ D-294: PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log('FAIL:', fails.join(' | ')); process.exit(1); }
