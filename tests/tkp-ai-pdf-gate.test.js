#!/usr/bin/env node
'use strict';

/**
 * ГЕЙТ НА РЕАЛЬНОМ PDF.
 *
 * Доказывает главное требование: в готовом PDF нет внутренней кухни,
 * ИИ-штампов и выдуманных сумм. Проверяется именно байт-стрим, который
 * уйдёт заказчику, а не исходные данные.
 *
 * Три части:
 *  1. Позитив: собираем PDF из черновика-фикстуры и убеждаемся, что гейт
 *     зелёный и все суммы просчёта в PDF находятся.
 *  2. Негатив: подкладываем в текст себестоимость/«таким образом»/выдуманную
 *     сумму — гейт ОБЯЗАН упасть. Без этого гейт не считается работающим.
 *  3. Проверка, что извлечение сумм из PDF реально работает.
 *
 * Запуск: node tests/tkp-ai-pdf-gate.test.js
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

if (!process.env.DB_PASSWORD) process.env.DB_PASSWORD = 'unit-test-no-connection';

const lint = require('../src/services/client-doc-lint');

const FONT_CANDIDATES = [
  path.join(__dirname, '..', 'public', 'assets', 'fonts', 'DejaVuSans.ttf'),
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
];

function pickFont() {
  for (const f of FONT_CANDIDATES) {
    if (fs.existsSync(f)) return f;
  }
  return null;
}

/**
 * Собрать простой PDF с заданным текстом. Нужен только для гейта:
 * проверяем извлечение и линт, а не вёрстку.
 */
function buildPdf(lines) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const font = pickFont();
    if (font) doc.font(font);
    doc.fontSize(11);
    lines.forEach((l) => doc.text(String(l)));
    doc.end();
  });
}

function fmt(n) {
  return Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

let passed = 0;
let failed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
  } catch (e) {
    failed += 1;
    failures.push({ name, error: e.message });
  }
}

const PRICE_NO_VAT = 2131360;
const VAT = 426272;
const PRICE_WITH_VAT = 2557632;

const CLEAN_LINES = [
  'ТЕХНИКО-КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ',
  'Заказчик: ООО «Ромашка»',
  'Предмет: очистка кожухотрубных теплообменников котельной',
  'Выполняем очистку двух аппаратов силами собственной бригады.',
  'Срок выполнения — 14 рабочих дней с даты подписания договора.',
  'Гарантия — 12 месяцев с даты подписания акта выполненных работ.',
  '',
  'Выполнение работ по техническому заданию | усл. | 1 | ' + fmt(PRICE_NO_VAT),
  '',
  'Итого без НДС: ' + fmt(PRICE_NO_VAT) + ' руб.',
  'НДС 20%: ' + fmt(VAT) + ' руб.',
  'ИТОГО с НДС: ' + fmt(PRICE_WITH_VAT) + ' руб.'
];

const DIRTY_LINES = [
  'ТЕХНИКО-КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ',
  'Заказчик: ООО «Ромашка»',
  'Таким образом, в рамках договора выполним работы.',
  'Себестоимость работ 968 800 руб., маржа 2,2.',
  'Стоимость для заказчика 2 131 360,00 руб.',
  'Срок: {{deadline}}.',
  'Итого без НДС: ' + fmt(PRICE_NO_VAT) + ' руб.'
];

(async function main() {
  const font = pickFont();
  if (!font) {
    console.log('ПРОПУСК: нет DejaVuSans.ttf — PDF с кириллицей не собрать.');
    console.log('Установите fonts-dejavu или проверьте public/assets/fonts.');
    process.exit(1);
  }

  const cleanPdf = await buildPdf(CLEAN_LINES);
  const dirtyPdf = await buildPdf(DIRTY_LINES);

  const EXPECTED = [PRICE_NO_VAT, VAT, PRICE_WITH_VAT];

  await check('чистый PDF проходит гейт и не даёт ложных срабатываний', async () => {
    const res = await lint.lintPdfBuffer(cleanPdf, {
      allowedNumbers: EXPECTED,
      expectedNumbers: EXPECTED
    });
    assert.strictEqual(res.ok, true,
      'ложные срабатывания: ' + JSON.stringify(res.hits.map((h) => h.kind + ':' + h.phrase)));
    assert.ok(res.pages >= 1, 'страниц: ' + res.pages);
  });

  await check('все суммы просчёта найдены в чистом PDF', async () => {
    const res = await lint.lintPdfBuffer(cleanPdf, {
      allowedNumbers: EXPECTED,
      expectedNumbers: EXPECTED
    });
    assert.ok(res.numbers, 'сверка сумм не выполнялась');
    assert.strictEqual(res.numbers.ok, true, 'не найдено: ' + JSON.stringify(res.numbers.missing));
  });

  await check('НЕГАТИВ: себестоимость и маржа в PDF останавливают гейт', async () => {
    const res = await lint.lintPdfBuffer(dirtyPdf, {
      allowedNumbers: EXPECTED,
      expectedNumbers: EXPECTED
    });
    assert.strictEqual(res.ok, false, 'гейт пропустил документ с себестоимостью');
    const kinds = res.hits.map((h) => h.kind);
    assert.ok(kinds.indexOf('internal') !== -1, 'не поймали внутреннюю кухню: ' + JSON.stringify(kinds));
  });

  await check('НЕГАТИВ: ИИ-штамп «таким образом» и «в рамках» ловится в PDF', async () => {
    const res = await lint.lintPdfBuffer(dirtyPdf, { skipNumbers: true });
    const phrases = res.hits.filter((h) => h.kind === 'ai_cliche').map((h) => h.phrase);
    assert.ok(phrases.length >= 2, 'штампы не пойманы: ' + JSON.stringify(phrases));
  });

  await check('НЕГАТИВ: плейсхолдер {{deadline}} в PDF ловится как артефакт', async () => {
    const res = await lint.lintPdfBuffer(dirtyPdf, { skipNumbers: true });
    const art = res.hits.filter((h) => h.kind === 'artifact');
    assert.ok(art.length > 0, 'артефакт не пойман');
  });

  await check('НЕГАТИВ: штамп, разорванный переносом вёрстки PDF, останавливает гейт', async () => {
    // Воспроизводим реальный дефект: pdf-parse вставляет \n в точках переноса,
    // и «Таким образом» оказывается разорванным на две строки. Такой документ
    // РАНЬШЕ проходил гейт и уходил заказчику.
    const brokenStamp = await buildPdf([
      'ТЕХНИКО-КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ',
      'Таким',
      'образом выполняем работы по очистке.',
      'Итого без НДС: ' + fmt(PRICE_NO_VAT) + ' руб.',
      'ИТОГО с НДС: ' + fmt(PRICE_WITH_VAT) + ' руб.'
    ]);
    const res = await lint.lintPdfBuffer(brokenStamp, {
      expectedNumbers: [PRICE_NO_VAT, PRICE_WITH_VAT]
    });
    assert.strictEqual(res.ok, false, 'гейт пропустил штамп, разорванный переносом строки');
    assert.ok(res.hits.some((h) => h.kind === 'ai_cliche'), 'штамп не классифицирован');
  });

  await check('НЕГАТИВ: внутренняя цифра (себестоимость) в PDF останавливает гейт', async () => {
    // Себестоимость 968 800 из просчёта не имеет права появиться в клиентском файле.
    const withCost = await buildPdf([
      'ТЕХНИКО-КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ',
      'Итого без НДС: ' + fmt(PRICE_NO_VAT) + ' руб.',
      'ИТОГО с НДС: ' + fmt(PRICE_WITH_VAT) + ' руб.',
      'Себестоимость 968 800,00 руб.'
    ]);
    const res = await lint.lintPdfBuffer(withCost, {
      expectedNumbers: [PRICE_NO_VAT, PRICE_WITH_VAT],
      forbiddenNumbers: [968800]
    });
    assert.strictEqual(res.ok, false, 'гейт пропустил внутреннюю цифру');
    const kinds = res.hits.map((h) => h.kind);
    assert.ok(kinds.indexOf('internal') !== -1, 'не поймали слово «себестоимость»');
    assert.ok(kinds.indexOf('internal_number') !== -1, 'не поймали само число себестоимости');
  });

  await check('реквизиты компании (ИНН/ОГРН/индекс) НЕ считаются нарушением', async () => {
    const withRequisites = await buildPdf([
      'ООО Асгард-Сервис ИНН 7736244785 ОГРН 1157746388128 КПП 770101001',
      '105082, г. Москва, ул. Большая Почтовая, 55/59',
      'ТКП-2026-080 от 03.11.2026',
      'Итого без НДС: ' + fmt(PRICE_NO_VAT) + ' руб.',
      'ИТОГО с НДС: ' + fmt(PRICE_WITH_VAT) + ' руб.'
    ]);
    const res = await lint.lintPdfBuffer(withRequisites, {
      expectedNumbers: [PRICE_NO_VAT, PRICE_WITH_VAT],
      forbiddenNumbers: [968800, 1162560, 930048]
    });
    assert.strictEqual(res.ok, true,
      'ложные срабатывания на реквизитах: ' + JSON.stringify(res.hits.map((h) => h.kind + ':' + h.phrase)));
  });

  await check('НЕГАТИВ: пропавшая сумма просчёта ловится как amount_missing', async () => {
    const truncated = await buildPdf(['ТЕХНИКО-КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ', 'Итого: 999 000,00 руб.']);
    const res = await lint.lintPdfBuffer(truncated, {
      allowedNumbers: EXPECTED,
      expectedNumbers: EXPECTED
    });
    assert.strictEqual(res.ok, false);
    const missing = res.hits.filter((h) => h.kind === 'amount_missing');
    assert.ok(missing.length > 0, 'пропажа суммы не поймана');
  });

  await check('без pdf-parse гейт честно падает, а не пропускает', async () => {
    // Настоящая проверка: невалидный буфер (не PDF) обязан дать исключение.
    // Если гейт вернёт ok:true на мусоре — он пропустит и грязный документ.
    let threw = false;
    try {
      await lint.lintPdfBuffer(Buffer.from('не pdf'), {});
    } catch (_) {
      threw = true;
    }
    assert.strictEqual(threw, true, 'гейт не упал на невалидном файле — значит может пропустить мусор');
  });

  await check('НЕГАТИВ: цена в PDF не совпадает с просчётом — ловится amount_missing', async () => {
    // Верификатор нашёл: ТКП с ценой 1 000 000 проходило при work_price 2 000 000.
    // Гейт обязан ругаться, если ожидаемая (из просчёта) сумма не найдена.
    const cheap = await buildPdf([
      'ИТОГО без НДС: 1 000 000,00 руб.',
      'ИТОГО с НДС: 1 200 000,00 руб.'
    ]);
    const res = await lint.lintPdfBuffer(cheap, {
      expectedNumbers: [2000000, 2400000],
      allowedNumbers: [1000000, 1200000, 2000000, 2400000]
    });
    assert.strictEqual(res.ok, false, 'гейт пропустил ТКП с ценой, отличной от просчёта');
    assert.ok(res.hits.some((h) => h.kind === 'amount_missing'), 'не поймали расхождение цены');
  });

  console.log('');
  console.log('tkp-ai-pdf-gate: ' + passed + '/' + (passed + failed) + ' проверок пройдено');
  if (failed) {
    console.log('');
    failures.forEach((f) => {
      console.log('FAIL: ' + f.name);
      console.log('      ' + f.error);
    });
    process.exit(1);
  }
  console.log('OK');
})();
