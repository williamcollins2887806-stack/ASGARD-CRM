'use strict';

/**
 * tests/contract-from-document.test.js
 *
 * D-402 (08.11.2026): договор из почты должен попадать в реестр договоров.
 *
 * ЧТО БЫЛО СЛОМАНО. Intake умел создавать договор ТОЛЬКО косвенно — если в
 * СЧЁТЕ написано «на основании договора № X». Сам файл договора, пришедший
 * отдельным вложением, не создавал ничего: классификатор ставил
 * `kind='contract'`, срабатывала ветка «не счёт» → `rejected`. Файл оставался
 * в почте, в `contracts` не появлялся, скан терялся.
 *
 * Проверено на проде: из 12 писем с договором за месяц 9 отклонены как
 * `not_invoice:contract`, 2 ушли в `needs_manual`, 1 в `parsed`. Ни один не
 * дал записи в реестре договоров. Поэтому у договора #204 («Гала Юг» 16/2026)
 * не было скана, а у контрагента — связи.
 *
 * Тест держит извлечение реквизитов на РЕАЛЬНЫХ форматах с прода.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  extractContractNumber,
  extractContractDate,
  extractContractAmount,
  extractContractInn,
  parseRuDate,
} = require('../src/services/contract-from-document');

// ─── Номер договора ───────────────────────────────────────────────────────
test('D-402: номер из «ДОГОВОР № 16/2026» (реальный договор Гала Юг)', () => {
  const t = 'ДОГОВОР № 16/2026\n5 ноября 2026 г.\nна изготовление полиграфической продукции';
  assert.strictEqual(extractContractNumber(t), '16/2026');
});

test('D-402: номер с типом договора — «Договор поставки № 12.03/1339»', () => {
  // Реальный файл с прода: «Договор _12.03_1339 от 12.03.25.pdf».
  // ВАЖНО: «12.03/1339» похоже на дату, но это НОМЕР (тип/счёт).
  const t = 'Договор поставки № 12.03/1339 от 12.03.25';
  assert.strictEqual(extractContractNumber(t), '12.03/1339',
    'номер не должен отбрасываться как дата');
});

test('D-402: номер с буквами — «Договор № МЛСП-245.5»', () => {
  assert.strictEqual(extractContractNumber('Договор № МЛСП-245.5 от 09.09.2024'), 'МЛСП-245.5');
});

test('D-402: «Договор-счёт № ЭТ-10-26-16»', () => {
  assert.strictEqual(extractContractNumber('Договор-счёт № ЭТ-10-26-16 от 19.10.2026 г.'), 'ЭТ-10-26-16');
});

test('D-402: «Договор возмездного оказания услуг № 45-У»', () => {
  const t = 'Договор возмездного оказания услуг № 45-У от 01.02.2026';
  assert.strictEqual(extractContractNumber(t), '45-У');
});

test('D-402: ДАТА не принимается за номер договора', () => {
  // «Договор № 05.11.2026 от 05.11.2026» — номер-дата не является номером.
  const t = 'Договор № 05.11.2026 от 05.11.2026';
  assert.strictEqual(extractContractNumber(t), null,
    'дата не должна становиться номером договора');
});

test('D-402: без номера — null (безымянный договор не создаём)', () => {
  assert.strictEqual(extractContractNumber('ДОГОВОР оказания услуг'), null);
  assert.strictEqual(extractContractNumber(''), null);
  assert.strictEqual(extractContractNumber(null), null);
});

test('D-402: номер счёта из 20 цифр не принимается за договор', () => {
  assert.strictEqual(extractContractNumber('Договор № 40702810502260000343'), null);
});

test('D-402: номер без цифр («оферта») не принимается', () => {
  assert.strictEqual(extractContractNumber('Договор № оферта'), null);
  assert.strictEqual(extractContractNumber('Договор № Счет-оферта'), null);
  assert.strictEqual(extractContractNumber('Договор № +'), null);
});

// ─── Дата договора ────────────────────────────────────────────────────────
test('D-402: дата текстом «5 ноября 2026 г.» (формат договора Гала Юг)', () => {
  const t = 'ДОГОВОР № 16/2026\n5 ноября 2026 г.';
  assert.strictEqual(extractContractDate(t), '2026-11-05');
});

test('D-402: дата числами «от 12.03.25» → 2025-03-12', () => {
  // Двузначный год: 25 → 2025 (не 1925).
  assert.strictEqual(parseRuDate('12.03.25'), '2025-03-12');
});

test('D-402: parseRuDate не путает день и месяц', () => {
  assert.strictEqual(parseRuDate('09.09.2024'), '2024-09-09');
  assert.strictEqual(parseRuDate('31.12.2026'), '2026-12-31');
  assert.strictEqual(parseRuDate('мусор'), null);
});

// ─── Сумма и ИНН ──────────────────────────────────────────────────────────
test('D-402: сумма договора только при явной формулировке', () => {
  assert.strictEqual(extractContractAmount('Общая сумма договора: 1 234 567,89 руб.'), 1234567.89);
  assert.strictEqual(extractContractAmount('на сумму 50000,00 рублей'), 50000);
  // Без явной формулировки — не угадываем.
  assert.strictEqual(extractContractAmount('Договор № 16/2026 от 5 ноября 2026 г.'), null);
});

test('D-402: ИНН договора — не наш собственный', () => {
  const text = 'Заказчик: ООО «Асгард-Сервис», ИНН 7736244785. '
    + 'Исполнитель: ООО «Гала Юг», ИНН 4000024880.';
  const inn = extractContractInn(text, '7736244785');
  assert.strictEqual(inn, '4000024880',
    'свой ИНН отбрасывается — это покупатель, а не контрагент');
});

test('D-402: ИНН не найден → null', () => {
  assert.strictEqual(extractContractInn('Договор без реквизитов', '7736244785'), null);
});

// ─── Связь с intake ───────────────────────────────────────────────────────
test('D-402: intake обрабатывает договор ДО ветки «не счёт»', () => {
  const fs = require('fs');
  const src = fs.readFileSync(require.resolve('../src/services/doc-email-intake'), 'utf8');
  const iContract = src.indexOf("cls.kind === 'contract'");
  const iNotInvoice = src.indexOf('Не счёт (сертификат/акт/УПД/накладная)');
  assert.ok(iContract > 0, 'ветка договора присутствует');
  assert.ok(iNotInvoice > 0, 'ветка «не счёт» присутствует');
  assert.ok(iContract < iNotInvoice,
    'договор обрабатывается РАНЬШЕ отклонения — иначе файл снова потеряется');
  assert.ok(/ensureContractFromDocument/.test(src), 'intake вызывает создание договора');
  // И заявку на оплату по договору НЕ создаём.
  assert.ok(/status: 'contract'/.test(src), 'договор получает свой статус, не invoice');
});

test('D-402: карточка контрагента считает договоры по ИНН, а не только по имени', () => {
  const fs = require('fs');
  const src = fs.readFileSync(require.resolve('../src/routes/customers'), 'utf8');
  assert.ok(/regexp_replace\(COALESCE\(ct\.customer_inn/.test(src),
    'в подсчёте договоров появился ключ по ИНН');
  assert.ok(/contracts_list/.test(src), 'карточка отдаёт список договоров');
  assert.ok(/docs_list/.test(src), 'карточка отдаёт список счетов');
});
