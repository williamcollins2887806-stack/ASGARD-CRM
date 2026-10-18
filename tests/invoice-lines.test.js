const { extractInvoice, extractInvoiceLines } = require('../src/services/invoice-extract');
let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

console.log('=== extractInvoiceLines: разбор позиций счёта ===');
const A = `Счёт на оплату № 1185 от 14.07.2026
Поставщик: ООО «ВСЕ ИНСТРУМЕНТЫ»
1. Дрель аккумуляторная Makita DDF482 2 шт x 8 000,00 = 16 000,00
2. Бур SDS-plus 8x160 10 шт x 300,00 = 3 000,00
Итого к оплате: 19 000,00 руб.
НДС 20%: 3 166,67`;
const a = extractInvoiceLines(A);
console.log(JSON.stringify(a, null, 1));
ok(a.length === 2, 'две позиции (x = форма)');
ok(a[0] && a[0].name.includes('Makita') && a[0].quantity === 2 && a[0].unit_price === 8000, 'позиция 1: Makita, 2 шт, 8000');
ok(a[1] && /Бур/.test(a[1].name) && a[1].quantity === 10 && a[1].unit_price === 300, 'позиция 2: Бур, 10 шт, 300');

console.log('\n=== табличная форма (unit qty price sum) ===');
const B = `Счёт № 77 от 01.10.2026
Кабель ВВГ 3х2,5   м   120	12 050,00   1 446 000,00
Автомат C16          шт  4	850,00      3 400,00
Всего к оплате: 1 449 400,00`;
const b = extractInvoiceLines(B);
console.log(JSON.stringify(b, null, 1));
ok(b.length >= 2, 'табличная форма распознана: ' + b.length);

console.log('\n=== мусор не превращается в позиции ===');
const C = `Итого к оплате: 100 000,00
НДС 20%: 16 666,67
Всего наименований 3, на сумму 100 000,00 руб.`;
const c = extractInvoiceLines(C);
ok(c.length === 0, 'служебные строки не стали позициями (' + c.length + ')');

console.log('\n=== в extractInvoice появилось поле lines ===');
const e = extractInvoice(A);
ok(Array.isArray(e.lines) && e.lines.length === 2, 'extractInvoice().lines = ' + (e.lines || []).length);
ok(e.lines.every((l) => l.unit_price > 0), 'у всех позиций цена > 0');

// Граница: скан-подобный текст без позиций — lines пустой, но не падает.
const D = 'ООО РОМАШКА ИНН 7701234567 Счёт на оплату № 5 от 01.01.2026 Всего к оплате 1000,00 руб.';
const d = extractInvoiceLines(D);
ok(Array.isArray(d) && d.length === 0, 'счёт без построчных позиций → [] (не падает)');

console.log(`\nPASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
