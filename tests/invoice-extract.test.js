'use strict';
const ex = require('../src/services/invoice-extract');
let pass = 0, fail = 0;
const t = (name, got, exp) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp);
  if (ok) { pass++; console.log('  PASS', name); } else { fail++; console.log(`  FAIL ${name}: got=${JSON.stringify(got)} exp=${JSON.stringify(exp)}`); }
};

// Валидаторы
console.log('\n=== ИНН контрольная сумма ===');
t('ИНН 7721793895 валиден', ex.validInn('7721793895'), true);
t('ИНН 7712345671 валиден', ex.validInn('7712345671'), true);
t('ИНН 7712345670 невалиден (сумма)', ex.validInn('7712345670'), false);
t('ИНН 12345 невалиден (длина)', ex.validInn('12345'), false);
t('ИП 12 цифр валиден', ex.validInn('500100732259'), true);
t('КПП 9 цифр', ex.validKpp('771201001'), true);
t('БИК 9 цифр', ex.validBik('044525225'), true);
t('р/с 20 цифр', ex.validAccount('40702810600000012345'), true);
t('р/с 19 цифр невалиден', ex.validAccount('4070281060000001234'), false);

console.log('\n=== суммы ===');
t('parseSum пробелы+запятая', ex.parseSum('123 456,78'), 123456.78);
t('parseSum точка', ex.parseSum('44000.00'), 44000);
t('parseSum пусто', ex.parseSum(''), null);

console.log('\n=== извлечение из счёта ===');
const invoice = `
СЧЁТ № 555 от 01.10.2026
Поставщик: ООО «РОМАШКА»
ИНН 7721793895 КПП 771201001
Банк: ПАО СБЕРБАНК БИК 044525225
р/с 40702810600000012345 к/с 30101810400000000225
Товар: ... 
Итого без НДС: 100 000,00
НДС: 20 000,00
Всего к оплате: 120 000,00
`;
const r = ex.extractInvoice(invoice);
console.log(JSON.stringify(r, null, 1));
t('ИНН', r.inn, '7721793895');
t('КПП', r.kpp, '771201001');
t('БИК', r.bik, '044525225');
t('р/с', r.rs, '40702810600000012345');
t('к/с', r.ks, '30101810400000000225');
t('сумма с НДС', r.amount_gross, 120000);
t('НДС', r.vat_amount, 20000);
t('без НДС', r.amount_net, 100000);
t('has_vat', r.has_vat, true);
t('номер счёта', r.invoice_number, '555');
t('дата счёта', r.invoice_date, '2026-10-01');
t('контрагент', r.counterparty_name, 'ООО «РОМАШКА»');
(r.confidence > 0.5) ? (pass++, console.log('  PASS уверенность > 0.5')) : (fail++, console.log('  FAIL уверенность=' + r.confidence));

console.log('\n=== счёт без НДС ===');
const noVat = 'СЧЁТ № 12 от 05.11.2026\nИНН 7721793895\nБез НДС\nВсего к оплате: 55 000,00';
const r2 = ex.extractInvoice(noVat);
t('has_vat=false', r2.has_vat, false);
t('сумма', r2.amount_gross, 55000);

console.log('\n=== не счёт (мусор) ===');
const junk = ex.extractInvoice('Привет! Как дела? Пришли фото.');
t('нет ИНН', junk.inn, null);
t('нет суммы', junk.amount_gross, null);
(junk.confidence < 0.3) ? (pass++, console.log('  PASS низкая уверенность')) : (fail++, console.log('  FAIL уверенность=' + junk.confidence));

console.log('\n────────────────────────────────────────');
console.log(`ИТОГ извлечения реквизитов: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
