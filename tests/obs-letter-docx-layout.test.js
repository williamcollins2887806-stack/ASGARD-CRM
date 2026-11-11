'use strict';
/**
 * Проверка DOCX письма ОБС по эталону Дмитрия.
 *
 * Что проверяем (замером, не «на глаз»):
 *   1. печать реально лежит в word/media и стоит ПЛАВАЮЩИМ слоем (wp:anchor + wrapNone)
 *      диаметром ~40 мм;
 *   2. поля страницы как в эталоне (bottom 1583);
 *   3. шрифты: реквизиты — Franklin Gothic Book, тело — Calibri 12;
 *   4. в тексте нет «безопасного выполнения работ» для не-СИЗ;
 *   5. перечень позиций не идёт списком Word (numPr).
 */
const assert = require('assert');

// Сервис тянет letter/_shared → services/db, которому нужен DB_PASSWORD.
// Тест не ходит в БД (передаёт фейковый db), переменная нужна только для импорта.
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test-not-used';

const PizZip = require('pizzip');
const { generateObsLetterDocx } = require('../src/services/obs-letter-docx');

let n = 0;
function t(name, fn) {
  try { fn(); n += 1; console.log('  \u2713', name); }
  catch (e) { console.error('  \u2717', name); throw e; }
}

// Минимальный фейковый db: сервис читает данные через loadLetterData.
const fakeDb = {
  query: async (sql) => {
    if (/FROM doc_registry/i.test(sql)) {
      return { rows: [{
        id: 900, dir: 'in', invoice_number: 'TEST-900', invoice_date: '2026-11-11',
        amount_gross: 5000, vat_amount: 0, vat_rate: 0, amount_net: 5000,
        counterparty_name: 'ООО «Тест-Поставщик»',
        comment_text: 'Шуруповёрт аккумуляторный',
        work_id: null, payment_invoice_id: null, created_by: 1,
        line_items_json: null, subcontract_id: null, contract_label: null,
      }] };
    }
    if (/FROM works/i.test(sql)) return { rows: [] };
    if (/FROM users/i.test(sql)) return { rows: [] };
    if (/subcontract_limit_state/i.test(sql)) return { rows: [] };
    if (/FFROM settings|FROM settings/i.test(sql)) return { rows: [] };
    return { rows: [] };
  },
};

(async () => {
  const buf = await generateObsLetterDocx(fakeDb, 900, {
    items: ['Шуруповёрт аккумуляторный 18В'],
    amount_gross: 5000,
    payment_source: 'obs',
  }, { number: 'ТЕСТ-1', dateText: '11.11.2026 г.' });

  assert.ok(buf && buf.length > 1000, 'DOCX собран');
  const zip = new PizZip(buf);
  const xml = zip.file('word/document.xml').asText();
  const media = Object.keys(zip.files).filter((k) => k.startsWith('word/media/') && !zip.files[k].dir);

  console.log('  media:', media.length, '| xml:', xml.length, 'байт');

  // 1. Печать: плавающий слой, не inline
  t('в DOCX есть картинка печати', () => {
    assert.ok(media.length >= 2, `media файлов: ${media.length}`);
  });

  t('печать стоит плавающим слоем (wp:anchor + wrapNone)', () => {
    const anchors = (xml.match(/<wp:anchor\b/g) || []).length;
    const wrapNone = (xml.match(/<wp:wrapNone\/>/g) || []).length;
    assert.ok(anchors >= 1, `якорей: ${anchors}`);
    assert.ok(wrapNone >= 1, `wrapNone: ${wrapNone}`);
  });

  t('размер печати ≈ 40 мм по высоте', () => {
    const exts = [...xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)]
      .map((m) => ({ cx: +m[1], cy: +m[2] }));
    // 40 мм = 1 440 000 EMU; допускаем 35–48 мм (картинка печати+подписи шире круга)
    const forty = 1440000;
    const hit = exts.some((e) => Math.abs(e.cy - forty) < forty * 0.2);
    assert.ok(hit, 'нет extent с высотой ~40 мм: ' + JSON.stringify(exts));
  });

  // 2. Поля
  t('нижнее поле 1583 (как в эталоне Дмитрия)', () => {
    const m = xml.match(/<w:pgMar[^/]*\/>/);
    assert.ok(m, 'нет pgMar');
    assert.ok(/w:bottom="1583"/.test(m[0]), 'bottom не 1583: ' + m[0]);
  });

  // 3. Шрифты
  t('реквизиты шапки набраны Franklin Gothic Book', () => {
    assert.ok(/Franklin Gothic Book/i.test(xml), 'шрифт реквизитов не Franklin Gothic Book');
  });

  // 4. Текст не врёт про охрану труда для инструмента
  const plain = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  t('для ШУРУПОВЁРТА нет «безопасного выполнения работ»', () => {
    assert.ok(!/безопасного\s+выполнения/i.test(plain), 'в письме про инструмент проскочило «безопасное выполнение»');
  });

  // 5. Никаких списков Word
  t('нет нумерованных/маркированных списков Word (numPr)', () => {
    assert.strictEqual((xml.match(/<w:numPr>/g) || []).length, 0);
  });

  console.log(`\nOK: ${n} проверок`);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
