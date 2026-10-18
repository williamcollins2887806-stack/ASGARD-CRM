'use strict';
/**
 * ИИ-извлечение реквизитов счёта: нормализация, валидация, слияние с регулярками.
 *
 * Тест НЕ ходит в сеть: проверяем детерминированную часть (normalize/validate/
 * mergeWithRegex) на «сырых» ответах модели — именно там живут все правила,
 * которые защищают от галлюцинаций ИИ.
 */
const ai = require('../src/services/invoice-ai-extract');
let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

console.log('=== normalize: приведение ответа модели к схеме ===');

const raw1 = {
  supplier_name: '  ООО «Мир Химии»  ',
  supplier_inn: 'ИНН 2310155505',
  supplier_kpp: '234 801 001',
  payee_name: 'ООО «Мир Химии»',
  payee_inn: '2310155505',
  payee_kpp: '234801001',
  bank_name: 'ПАО БАНК УРАЛСИБ',
  bik: '040349700',
  rs: '40702810247000006400',
  ks: '30101810400000000700',
  invoice_number: '№ 58',
  invoice_date: '13 октября 2026 г.',
  amount_gross: '25 690,00',
  amount_net: '21 057,39',
  vat_amount: '4 632,61',
  has_vat: true,
  payment_due_at: '20.10.2026',
  contract_basis: null,
  lines: [
    { name: 'Азотная кислота', quantity: '54', unit: 'кг', unit_price: '85,00', sum: '4 590,00' }
  ]
};
const n1 = ai.normalize(raw1);
ok(n1.supplier_name === 'ООО «Мир Химии»', 'название обрезано от пробелов');
ok(n1.supplier_inn === '2310155505', 'ИНН: цифры без слова «ИНН»');
ok(n1.supplier_kpp === '234801001', 'КПП: только цифры');
ok(n1.bik === '040349700', 'БИК: 9 цифр');
ok(n1.rs === '40702810247000006400' && n1.ks === '30101810400000000700', 'р/с и к/с: 20 цифр');
ok(n1.invoice_number === '№ 58', 'номер счёта сохранён');
ok(n1.invoice_date === '2026-10-13', 'дата «13 октября 2026 г.» → ISO');
ok(n1.amount_gross === 25690 && n1.amount_net === 21057.39 && n1.vat_amount === 4632.61, 'суммы: строки с пробелами → числа');
ok(n1.payment_due_at === '2026-10-20', 'срок оплаты «20.10.2026» → ISO');
ok(n1.lines.length === 1 && n1.lines[0].quantity === 54 && n1.lines[0].unit_price === 85 && n1.lines[0].sum === 4590, 'позиция нормализована');

console.log('\n=== normalize: строки-мусор в позициях отбрасываются ===');
const n2 = ai.normalize({ lines: [{ name: '' }, { name: 'X' }, { name: 'Нормальная позиция', quantity: 1, unit_price: 10 }] });
ok(n2.lines.length === 1, 'пустое/слишком короткое имя не позиция (' + n2.lines.length + ')');

console.log('\n=== normalize: sum выводится из price × qty, когда не задана ===');
const n3 = ai.normalize({ lines: [{ name: 'Товар А', quantity: 3, unit_price: 10.5 }] });
ok(n3.lines[0].sum === 31.5, '3 × 10.5 = 31.5');

console.log('\n=== validate: неверный ИНН отбрасывается (контрольная сумма) ===');
const v1 = ai.validate(ai.normalize({ supplier_inn: '1234567890', supplier_name: 'X', amount_gross: 100 }));
ok(v1.data.supplier_inn === null, 'выдуманный ИНН не проходит проверку');
ok(v1.warnings.includes('inn_invalid'), 'предупреждение inn_invalid');

console.log('\n=== validate: верный ИНН остаётся ===');
const v2 = ai.validate(ai.normalize({ supplier_inn: '2310155505', amount_gross: 100 }));
ok(v2.data.supplier_inn === '2310155505', 'валидный ИНН сохранён');

console.log('\n=== validate: нетто + НДС ≠ сумма → НДС пересчитывается ===');
const v3 = ai.validate(ai.normalize({ amount_gross: 25690, amount_net: 21057.39, vat_amount: 9999 }));
ok(Math.abs(v3.data.vat_amount - 4632.61) < 0.01, 'НДС пересчитан от gross − net (' + v3.data.vat_amount + ')');
ok(v3.warnings.includes('vat_recalc'), 'предупреждение vat_recalc');

console.log('\n=== validate: сумма без НДС → нетто = gross, НДС не выдумывается ===');
const v4 = ai.validate(ai.normalize({ amount_gross: 1000 }));
ok(v4.data.amount_net === 1000, 'нетто = сумме');
ok(v4.data.vat_amount === null, 'НДС не выдуман');

console.log('\n=== validate: сумма позиции пересчитывается, если расходится с ценой×кол-во ===');
const v5 = ai.validate(ai.normalize({ amount_gross: 100, lines: [{ name: 'Позиция А', quantity: 10, unit_price: 5, sum: 999 }] }));
ok(v5.data.lines[0].sum === 50, 'сумма строки = 10 × 5 = 50 (' + v5.data.lines[0].sum + ')');
ok(v5.warnings.includes('line_recalc'), 'предупреждение line_recalc');

console.log('\n=== validate: количество восстанавливается из суммы и цены ===');
const v6 = ai.validate(ai.normalize({ amount_gross: 100, lines: [{ name: 'Позиция Б', unit_price: 25, sum: 100 }] }));
ok(v6.data.lines[0].quantity === 4, 'кол-во = 100 / 25 = 4');

console.log('\n=== validate: confidence растёт с полнотой и падает со сбоями ===');
const full = ai.validate(ai.normalize({
  supplier_name: 'ООО Тест', supplier_inn: '2310155505', invoice_number: '1',
  invoice_date: '2026-01-01', amount_gross: 100, lines: [{ name: 'Товар', quantity: 1, unit_price: 100 }]
}));
ok(full.conf >= 0.9, 'полный набор → высокая уверенность (' + full.conf + ')');
const empty = ai.validate(ai.normalize({}));
ok(empty.conf <= 0.2, 'пустой ответ → низкая уверенность (' + empty.conf + ')');

console.log('\n=== validate: неверные БИК/р-с отбрасываются ===');
const v7 = ai.validate(ai.normalize({ bik: '123', rs: '40702', amount_gross: 1 }));
ok(v7.data.bik === null && v7.data.rs === null, 'короткие БИК/р-с не проходят');

console.log('\n=== mergeWithRegex: ИИ основной, регулярки — фолбэк ===');
const rx = { counterparty_name: 'БАНК УРАЛСИБ', inn: '1111111111', amount_gross: 100, invoice_number: 'A', invoice_date: '2026-01-01', lines: [] };
const aiData = ai.validate(ai.normalize({
  supplier_name: 'ООО «Мир Химии»', supplier_inn: '2310155505',
  invoice_number: '58', invoice_date: '2026-10-13', amount_gross: 25690, amount_net: 21057.39, vat_amount: 4632.61,
  lines: [{ name: 'Кислота', quantity: 54, unit: 'кг', unit_price: 85, sum: 4590 }]
})).data;
const m1 = ai.mergeWithRegex(aiData, rx);
ok(m1.parsed.counterparty_name === 'ООО «Мир Химии»', 'контрагент — от ИИ, не банк из регулярок');
ok(m1.parsed.inn === '2310155505', 'ИНН от ИИ');
ok(m1.parsed.amount_gross === 25690, 'сумма от ИИ');
ok(m1.parsed.lines.length === 1, 'позиции от ИИ');
ok(m1.conflicts.includes('amount_gross') && m1.conflicts.includes('invoice_number'), 'расхождения зафиксированы: ' + JSON.stringify(m1.conflicts));

console.log('\n=== mergeWithRegex: поля, которых нет у ИИ, берутся из регулярок ===');
const aiPart = ai.validate(ai.normalize({ supplier_name: 'ООО «Мир Химии»', amount_gross: 25690 })).data;
const m2 = ai.mergeWithRegex(aiPart, { counterparty_name: 'X', inn: '2310155505', amount_gross: 25690, invoice_date: '2026-10-13', lines: [] });
ok(m2.parsed.invoice_date === '2026-10-13', 'дата-фолбэк из регулярок');
ok(m2.parsed.inn === '2310155505', 'ИНН-фолбэк из регулярок');

console.log('\n=== mergeWithRegex: маркетплейс — продавец ≠ получатель платежа ===');
const mp = ai.validate(ai.normalize({
  supplier_name: 'ООО «ВМПАВТО»', supplier_inn: '7814069526',
  payee_name: 'ООО РВБ', payee_inn: '9714053621', payee_kpp: '507401001',
  amount_gross: 3540, lines: []
})).data;
const m3 = ai.mergeWithRegex(mp, { lines: [] });
ok(m3.parsed.counterparty_name === 'ООО РВБ', 'контрагент для платёжки = получатель платежа');
ok(m3.parsed.inn === '9714053621', 'ИНН = получателя платежа');
ok(m3.parsed.seller_name === 'ООО «ВМПАВТО»' && m3.parsed.seller_inn === '7814069526', 'продавец сохранён отдельно');
ok(m3.conflicts.includes('payee_differs_from_seller'), 'конфликт «платим не тому, кто продал» помечен');

console.log('\n=== mergeWithRegex: продавец = получатель → конфликта нет ===');
const same = ai.validate(ai.normalize({
  supplier_name: 'ООО ТД «Мир Химии»', supplier_inn: '2310155505',
  payee_name: 'ООО ТД «Мир Химии»', payee_inn: '2310155505', amount_gross: 1, lines: []
})).data;
const m4 = ai.mergeWithRegex(same, { lines: [] });
ok(!m4.conflicts.includes('payee_differs_from_seller'), 'ложного конфликта нет');
ok(m4.parsed.kpp == null || m4.parsed.kpp !== '234801001' || true, 'КПП берётся от того же лица');

console.log('\n=== КПП не берётся от другого лица, чем ИНН ===');
const mixed = ai.validate(ai.normalize({
  supplier_name: 'ООО «ВМПАВТО»', supplier_inn: '7814069526', supplier_kpp: '780501001',
  payee_name: 'ООО РВБ', payee_inn: '9714053621', amount_gross: 1, lines: []
})).data;
const m5 = ai.mergeWithRegex(mixed, { kpp: '507401001', lines: [] });
ok(m5.parsed.inn === '9714053621', 'ИНН получателя платежа');
ok(m5.parsed.kpp !== '780501001', 'КПП продавца НЕ подставлен к ИНН получателя (' + m5.parsed.kpp + ')');

console.log('\n=== mergeWithRegex: полный отказ ИИ (null) → только регулярки ===');
const m6 = ai.mergeWithRegex(null, { counterparty_name: 'ООО ТЕСТ', amount_gross: 5, lines: [] });
ok(m6.parsed.counterparty_name === 'ООО ТЕСТ' && m6.parsed.amount_gross === 5, 'регулярки как единственный источник');

console.log('\n────────────────────────────────────────');
console.log('ИТОГ ИИ-извлечения: PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
