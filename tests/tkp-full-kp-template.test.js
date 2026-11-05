#!/usr/bin/env node
'use strict';

/**
 * Гейт шаблона полного КП (без БД и без LibreOffice).
 *
 * Доказывает:
 *  1. При transport_amount = 0 строка мобилизации НЕ печатается.
 *  2. При transport_amount > 0 строка печатается с суммой.
 *  3. Дефолтная подпись приложения проходит клиентский линтер.
 *  4. Негативный контроль: старая формулировка «Транспортные расходы…»
 *     обязана ловиться (иначе гейт бессмысленный).
 *
 * Запуск: node tests/tkp-full-kp-template.test.js
 */

const assert = require('assert');
const PizZip = require('pizzip');
const full = require('../src/services/tkp-full-kp');
const lint = require('../src/services/client-doc-lint');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('PASS', name);
  } catch (e) {
    failed += 1;
    failures.push({ name, error: e.message });
    console.log('FAIL', name, '—', e.message);
  }
}

function docxText(buf) {
  const zip = new PizZip(buf);
  const xml = zip.file('word/document.xml').asText();
  return xml.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
}

function makeTkp(transportAmount) {
  return {
    id: 900,
    customer_name: 'ООО ПК «КИРОВ ТАЙР»',
    subject: 'Чистка технологических каналов',
    validity_days: 30,
    created_at: new Date('2026-11-05'),
    items: {
      vat_pct: 22,
      full: {
        object_name: 'Завод Пирелли',
        basis: 'Техническое задание заказчика',
        apparatus: [
          {
            equipment: 'Чистка технологических каналов корпуса №37',
            inventory_no: 'усл.',
            tube_data: '1 этаж',
            qty: 1,
            amount_no_vat: 3000000
          },
          {
            equipment: 'Чистка технологических каналов корпуса №64',
            inventory_no: 'усл.',
            tube_data: '1 этаж',
            qty: 1,
            amount_no_vat: 2935430
          }
        ],
        transport_amount: transportAmount
      }
    }
  };
}

const COMPANY = { name: 'ООО «АСГАРД-Сервис»' };
const MOB_LABEL = /Мобилизация и демобилизация/;
const OLD_LABEL = /Транспортные расходы/i;

check('transport_amount = 0 → строка мобилизации не печатается', () => {
  const text = docxText(full.generateFullKpDocxBuffer(makeTkp(0), COMPANY));
  assert.ok(!MOB_LABEL.test(text), 'строка мобилизации присутствует при нулевой сумме');
  assert.ok(!OLD_LABEL.test(text), 'в документ попала запрещённая формулировка');
});

check('transport_amount = 0 → линтер чист', () => {
  const text = docxText(full.generateFullKpDocxBuffer(makeTkp(0), COMPANY));
  const res = lint.lintText(text, { skipNumbers: true });
  assert.deepStrictEqual(res.hits.map((h) => h.kind + ':' + h.phrase), [], JSON.stringify(res.hits));
});

check('transport_amount = 150000 → строка и сумма печатаются', () => {
  const text = docxText(full.generateFullKpDocxBuffer(makeTkp(150000), COMPANY));
  assert.ok(MOB_LABEL.test(text), 'нет строки мобилизации при ненулевой сумме');
  assert.ok(/150[\s\u00a0\u202f]000,00/.test(text), 'нет суммы мобилизации');
});

check('transport_amount = 150000 → линтер всё равно чист', () => {
  const text = docxText(full.generateFullKpDocxBuffer(makeTkp(150000), COMPANY));
  const res = lint.lintText(text, { skipNumbers: true });
  assert.deepStrictEqual(res.hits.map((h) => h.kind + ':' + h.phrase), [], JSON.stringify(res.hits));
});

check('дефолтная подпись шаблона проходит линтер', () => {
  const res = lint.lintText('Мобилизация и демобилизация', { skipNumbers: true });
  assert.deepStrictEqual(res.hits, []);
});

check('негативный контроль: старая формулировка ловится линтером', () => {
  const res = lint.lintText('Транспортные расходы: мобилизация и демобилизация', { skipNumbers: true });
  assert.ok(res.hits.some((h) => h.kind === 'internal'),
    'линтер не поймал старую формулировку — гейт бессмысленный');
});

check('позиции таблицы сохраняются (2 строки работ)', () => {
  const text = docxText(full.generateFullKpDocxBuffer(makeTkp(0), COMPANY));
  assert.ok(/корпуса №37/.test(text), 'нет первой позиции');
  assert.ok(/корпуса №64/.test(text), 'нет второй позиции');
});

check('итоги считаются без транспорта и с ним', () => {
  const zero = full.buildFullKpTemplateData(makeTkp(0), COMPANY);
  const withT = full.buildFullKpTemplateData(makeTkp(150000), COMPANY);
  // Неразрывные пробелы — нормальный вывод toLocaleString('ru-RU').
  const spaces = (s) => String(s).replace(/[\s\u00a0\u202f]/g, ' ');
  assert.strictEqual(spaces(zero.subtotal), '5 935 430,00');
  assert.strictEqual(spaces(withT.subtotal), '6 085 430,00');
  assert.strictEqual(zero.has_transport, false);
  assert.strictEqual(withT.has_transport, true);
});

console.log('\nИтого: PASS', passed, '/ FAIL', failed);
if (failures.length) failures.forEach((f) => console.log(' -', f.name, ':', f.error));
process.exit(failed ? 1 : 0);
