'use strict';

/**
 * D-319: наши исходящие письма не должны становиться счётом.
 * ═══════════════════════════════════════════════════════════════════════════
 * Инцидент 21.10.2026 (ООО «Безопасность Труда»):
 *   письмо #4960 (Дмитрий Путков, «Исх. №261021-03») — наше информационное
 *   письмо заказчику. В нём есть ЦИТАТА «выставлен счёт на оплату № УТ-2360»,
 *   поэтому срабатывал INVOICE_STRONG; банк и р/с в письме наши.
 *   Результат: письмо classifyDocument → invoice, ИИ взял НАШ ИНН как ИНН
 *   поставщика, дедуп не нашёл существующую строку → создались дубль
 *   заявки #20 и дубль реестра #1587.
 *
 * Тест оффлайн: подсовываем classifyDocument и extractInvoice реальные фрагменты
 * того письма и проверяем, что это НЕ счёт и наш ИНН не становится ИНН контрагента.
 * Плюс обратные проверки: настоящий счёт поставщика по-прежнему распознаётся.
 */

const assert = require('assert');
const { classifyDocument } = require('../src/services/doc-classifier');
const { extractInvoice } = require('../src/services/invoice-extract');

const OUR_INN = '7736244785';

// Реальный текст «Исх. _261021-03.pdf» (OCR с прода, 21.10.2026).
const OWN_LETTER = `ООО «Асгард-Сервис» 105082, г. Москва, ул. Большая Почтовая, д. 55/59, стр. 1, пом. 37
ИНН / КПП: 7736244785 / 770101001
АО «Альфа-Банк» р/с 40702810502260000343
к/с 30101810200000000593 БИК 044525593
e-mail: info@asgard-service.com тел.: +7 (499) 322-30-62
Исх. №261021-03 от 21.10.2026 г.
Уважаемые Коллеги!
Настоящим сообщаем, что ООО «Асгард-Сервис» выполняет работы по ремонту
теплоизоляции аппаратов и трубопроводов в интересах Астраханского ГПЗ
ООО «Газпром Переработка», расположенного в Астраханской области.
Поставщиком выставлен счёт на оплату № УТ-2360 от 21.10.2026 на сумму 19 460,00 руб.`;

// Настоящий счёт поставщика (структура реального «Счёт _УТ-2360.pdf»).
const REAL_INVOICE = `Счёт на оплату № УТ-2360 от 21.10.2026
Поставщик: ООО «Безопасность Труда», ИНН 3017052355, КПП 301701001
Покупатель: ООО «Асгард-Сервис», ИНН 7736244785, КПП 770101001
БИК 040173604 р/с 40702810800000001234 к/с 30101810000000000604
Всего к оплате: 19 460,00
Основание: Договор № 12.03/1339 от 12.03.2025`;
// Счёт, где НАШ ИНН напечатан выше продавца (счёт-НПД) — класс Д2а.
const NPД_INVOICE = `Счёт на оплату № 7 от 20.10.2026
Покупатель: ООО "АСГАРД-СЕРВИС" ИНН 7736244785 КПП 770101001
Продавец: ИП Иванов Иван Иванович ИНН 519035882504
БИК 044525225 р/с 40702810100000001234
Всего к оплате: 5 000,00`;

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log('  PASS', name); }
  catch (e) { fail++; console.log('  FAIL', name, '→', e.message); }
};

console.log('\n=== D-319: исходящие письма ≠ счёт ===');

check('наше «Исх. №» письмо НЕ считается счётом', () => {
  const r = classifyDocument(OWN_LETTER, { ownInn: OUR_INN });
  assert.strictEqual(r.is_invoice, false, 'письмо снова признано счётом: ' + JSON.stringify(r));
  assert.strictEqual(r.kind, 'letter', 'kind=' + r.kind + ', reason=' + r.reason);
});

check('без ownInn «Исх. №» всё равно отсекает письмо (мягкий режим)', () => {
  const r = classifyDocument(OWN_LETTER, {});
  assert.strictEqual(r.is_invoice, false, 'без ownInn письмо стало счётом');
});

check('настоящий счёт поставщика по-прежнему invoice', () => {
  const r = classifyDocument(REAL_INVOICE, { ownInn: OUR_INN });
  assert.strictEqual(r.is_invoice, true, 'настоящий счёт перестал распознаваться: ' + JSON.stringify(r));
});

check('счёт с цитатой «коммерческое предложение» не уехал в offer', () => {
  const t = 'СЧЁТ на оплату № 7 от 01.10.2026\nСм. коммерческое предложение во вложении\nВсего к оплате: 1000';
  const r = classifyDocument(t, { ownInn: OUR_INN });
  assert.strictEqual(r.is_invoice, true, 'регресс: счёт стал ' + r.kind);
});

check('наш ИНН НЕ становится ИНН контрагента (счёт-НПД)', () => {
  const r = extractInvoice(NPД_INVOICE, { ownInn: OUR_INN });
  assert.notStrictEqual(r.inn, OUR_INN, 'наш ИНН снова попал в контрагента');
  assert.strictEqual(r.inn, '519035882504', 'не взял ИНН продавца: ' + r.inn);
});

check('наш ИНН не попадает и когда он единственный (флаг inn_is_own)', () => {
  const r = extractInvoice(OWN_LETTER, { ownInn: OUR_INN });
  assert.notStrictEqual(r.inn, OUR_INN, 'наш ИНН попал в контрагента');
  assert.strictEqual(r.inn, null, 'ожидался null, получено ' + r.inn);
  assert.strictEqual(r.inn_is_own, true, 'флаг inn_is_own не выставлен');
});

check('настоящий ИНН поставщика извлекается как раньше', () => {
  const r = extractInvoice(REAL_INVOICE, { ownInn: OUR_INN });
  assert.strictEqual(r.inn, '3017052355', 'ИНН поставщика не найден: ' + r.inn);
});

check('«на объекте Заказчика» не становится work_hint', () => {
  const t = 'Счёт на оплату № 1\nОплата по договору на объекте Заказчика в г. Астрахань\nВсего к оплате: 100';
  const r = extractInvoice(t, { ownInn: OUR_INN });
  assert.notStrictEqual(r.work_hint, 'Заказчика', 'work_hint снова мусорный: ' + r.work_hint);
});

check('нормальный объект в work_hint остаётся', () => {
  const t = 'Счёт на оплату № 1\nОбъект: Астраханский ГПЗ, установка 2\nВсего к оплате: 100';
  const r = extractInvoice(t, { ownInn: OUR_INN });
  assert.ok(/ГПЗ/.test(String(r.work_hint || '')), 'потеряли объект: ' + r.work_hint);
});

check('номер договора с точкой нормализуется одинаково с SQL', () => {
  const { normContractNo } = require('../src/services/contract-match');
  // SQL вырезает всё кроме букв/цифр/слэша/дефиса → «12.03/1339» → «1203/1339»
  const jsNorm = normContractNo('12.03/1339').replace(/[^a-zа-яё0-9/\-]/g, '');
  assert.strictEqual(jsNorm, '1203/1339', 'JS нормализует иначе: ' + jsNorm);
});

console.log(`\nИТОГ: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
