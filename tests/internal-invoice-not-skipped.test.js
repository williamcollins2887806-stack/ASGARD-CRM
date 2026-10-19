/**
 * Кейс заказчика 19.10.2026: закупщик Виктор Баринов (bv@asgard-service.com) прислал
 * счёт (#4878 «АГПЗ, счет BP-7784»), но письмо было помечено «Пропущено автоматически:
 * internal_email» — потому что домен наш. Такие письма обязаны обрабатываться.
 */
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
const { shouldSkipEmail } = require('../src/services/ai-email-analyzer');
let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

console.log('=== Счёт от НАШЕГО сотрудника не должен пропускаться ===');

// 1. Реальный кейс Баринова: сотрудник + счёт в теме/теле.
const r1 = shouldSkipEmail({
  fromEmail: 'bv@asgard-service.com',
  subject: 'АГПЗ, счет BP-7784 от 19.10.2026 БАШПРОМ',
  bodyText: 'Материал Маты МП-СТ 100. Стоимость 601 456 руб с НДС 22%. Аванс 100%.'
});
ok(!r1.skip, 'счёт от сотрудника НЕ пропущен (skip=' + r1.skip + ', reason=' + (r1.reason || '—') + ')');

// 2. С реквизитами в теле (без слова «счёт» в теме).
const r2 = shouldSkipEmail({
  fromEmail: 'n.androsov@asgard-service.com',
  subject: 'Fwd: оплата',
  bodyText: 'Поставщик ООО Ромашка, БИК 044525225, р/с 40702810800000020353, к/с 30101810245250000450'
});
ok(!r2.skip, 'реквизиты в теле (БИК/р/с) → НЕ пропущен (' + (r2.skip ? 'skip=' + r2.reason : 'ok') + ')');

// 3. КОПИЯ на ящик CRM — по-прежнему проходит (не сломан прошлый фикс).
const r3 = shouldSkipEmail({
  fromEmail: 'crm@asgard-service.com',
  subject: 'Счёт на согласование',
  bodyText: 'во вложении'
});
ok(!r3.skip, 'копия на ящик CRM проходит (' + (r3.skip ? 'skip=' + r3.reason : 'ok') + ')');

// 4. Обычное внутреннее письмо (без признаков счёта) — пропускаем как раньше.
const r4 = shouldSkipEmail({
  fromEmail: 'n.androsov@asgard-service.com',
  subject: 'Обед сегодня?',
  bodyText: 'пойдём в 13:00'
});
ok(r4.skip && r4.reason === 'internal_email', 'обычное внутреннее письмо пропущено (' + (r4.skip ? r4.reason : 'НЕ пропущено!') + ')');

// 5. Внешний счёт — не сломан.
const r5 = shouldSkipEmail({
  fromEmail: 'supplier@example.com',
  subject: 'Счёт № 58',
  bodyText: 'сумма 25690'
});
ok(!r5.skip, 'внешний счёт проходит');

console.log('\nИТОГ: PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
