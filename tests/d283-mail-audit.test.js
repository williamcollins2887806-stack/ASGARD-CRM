'use strict';
/**
 * D-283 (аудит почты 19.10.2026): 5 багов после разбора реального дня.
 * ═══════════════════════════════════════════════════════════════════════════
 * Проверено по факту на проде: 9 писем, 5 счетов. Основная цепочка работала,
 * но всплыли дефекты. Тест фиксирует каждый, чтобы не вернулся.
 *
 *  1) НДС 9.91% у АэроОтель №1388 — такой ставки в НК РФ нет.
 *     Причина: валидация была только в AI-ветке, регулярный фолбэк писал как есть.
 *  2) Позиции не попадали в payment_invoices (INSERT без колонки), хотя лежали
 *     в parse_raw и price_records — бухгалтер не видел состав счёта.
 *  3) У 3 из 5 счетов срок оплаты пуст → просрочка не видна.
 *  4) supplier_id пуст, когда ИНН в счёте ≠ ИНН в справочнике.
 *  5) tidyOrgName существовал, но не вызывался → `ООО "ТД "БАШПРОМТОРГ"`.
 */

let pass = 0, fail = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; fails.push(name); console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

const INVOICE_AI = require('../src/services/invoice-ai-extract');
const { tidyOrgName } = require('../src/lib/item-name-clean');

// ─────────────────────────────────────────────────────────────────────────
console.log('── 1. НДС: недопустимые ставки не проходят ──');
// mergeWithRegex возвращает { parsed, conflicts }, а не сам объект.
function merged(ai, rx) {
  const r = INVOICE_AI.mergeWithRegex(ai, rx);
  return (r && r.parsed) ? r.parsed : r;
}
{
  // Ставка 9.91% (реальный баг на проде). На вход ИИ отдаём её, ждём исправление.
  const r = merged({ amount_gross: 8400, vat_amount: 757.38, vat_rate: 9.91 }, {});
  check('9.91% → ближайшая допустимая ставка (10)', r.vat_rate === 10, JSON.stringify(r.vat_rate));
  check('сумма НДС не тронута (757.38)', Number(r.vat_amount) === 757.38, String(r.vat_amount));
}
{
  const r = merged({ amount_gross: 4000, vat_amount: 0, vat_rate: null }, {});
  check('без НДС → vat_rate null', r.vat_rate == null, String(r.vat_rate));
}
{
  const r = merged({ amount_gross: 48320, vat_amount: 8713.45, vat_rate: 22 }, {});
  check('легальная 22% сохраняется', r.vat_rate === 22, String(r.vat_rate));
}
{
  // Заведомо выдуманная ставка 13% — вывести нельзя (сумм нет) → null
  const r = merged({ vat_rate: 13 }, {});
  check('13% без сумм → null (не выдумываем)', r.vat_rate == null, String(r.vat_rate));
}

// ─────────────────────────────────────────────────────────────────────────
console.log('── 2. Позиции: колонка в INSERT у заявки ──');
{
  const fs = require('fs');
  const src = fs.readFileSync(require('path').join(__dirname, '../src/services/doc-email-intake.js'), 'utf8');
  check('INSERT payment_invoices содержит line_items_json', /INSERT INTO payment_invoices[\s\S]{0,700}line_items_json/.test(src));
  check('в VALUES есть приведение ::jsonb', /VALUES \('awaiting_dir'[\s\S]{0,300}\$23::jsonb/.test(src));
  check('ставка НДС пишется с валидацией VAT_OK', /VAT_OK\.includes/.test(src));
}

// ─────────────────────────────────────────────────────────────────────────
console.log('── 3. Срок оплаты: оценивается от даты счёта ──');
{
  const fs = require('fs');
  const src = fs.readFileSync(require('path').join(__dirname, '../src/services/doc-email-intake.js'), 'utf8');
  check('есть расчёт срока от invoice_date', /dueDerived/.test(src));
  check('настройка doc_due_days читается', /doc_due_days/.test(src));
  // Проверим саму арифметику: 2026-10-01 + 10 дней = 2026-10-11
  const d0 = new Date('2026-10-01T00:00:00Z'); d0.setUTCDate(d0.getUTCDate() + 10);
  check('01.10 + 10 дн = 11.10', d0.toISOString().slice(0, 10) === '2026-10-11', d0.toISOString().slice(0, 10));
}

// ─────────────────────────────────────────────────────────────────────────
console.log('── 4. supplier_id: фолбэк по названию + пометка расхождения ИНН ──');
{
  const fs = require('fs');
  const src = fs.readFileSync(require('path').join(__dirname, '../src/services/doc-email-intake.js'), 'utf8');
  check('есть поиск поставщика по названию', /regexp_replace\(trim\(name\)/.test(src));
  check('расхождение ИНН помечается', /supplier_inn_mismatch/.test(src));
}

// ─────────────────────────────────────────────────────────────────────────
console.log('── 5. Название организации: кавычки ──');
{
  const cases = [
    ['ООО "ТД "БАШПРОМТОРГ"', 'ООО "ТД БАШПРОМТОРГ"'],
    ['ООО ТД БАШПРОМТОРГ', 'ООО ТД БАШПРОМТОРГ'],
    ['ООО "ПРЕСС БЮРО"', 'ООО "ПРЕСС БЮРО"'],
  ];
  for (const [input, want] of cases) {
    const got = tidyOrgName(input);
    const even = (got.match(/"/g) || []).length % 2 === 0;
    check(`${input} → кавычки парные`, even && got === want, got);
  }
  const fs = require('fs');
  const src = fs.readFileSync(require('path').join(__dirname, '../src/services/doc-email-intake.js'), 'utf8');
  check('tidyOrgName ВЫЗЫВАЕТСЯ в intake', /const cpName = tidyOrgName\(/.test(src));
}

// ─────────────────────────────────────────────────────────────────────────
console.log('── 6. Регресс: ложное согласие Яковлева не проходит ──');
{
  const { detectApproval } = require('../src/services/approval-detector');
  const body = 'Иван, добрый день.\nОплату счета подтверждаю.\nТам ещё была обувь в запросе.';
  check('«Оплату подтверждаю» ≠ согласие (fail-closed)', detectApproval(body).approve === false);
  check('«Добро» директора проходит', detectApproval('Добро\n\n-- \nС уважением,\nГажилиев').approve === true);
}

console.log('\n────────────────────────────────────────');
console.log(`ИТОГ D-283: PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log('FAIL:', fails.join(' | ')); process.exit(1); }
