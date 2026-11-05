#!/usr/bin/env node
'use strict';

/**
 * Гейт DOCX-шаблона полного КП: пустых разделов и двойного транспорта нет.
 *
 * Закрывает дефекты, найденные верификатором L3 (05.11.2026):
 *  1. Итог в документе ≠ Σ позиций, потому что шаблон прибавлял транспорт
 *     к уже распределённой цене (5 935 430 + 50 000).
 *  2. «ИТОГО» не совпадало с «без НДС + НДС» (база округлена, налог — нет).
 *  3. Заголовки «ПОРЯДОК СДАЧИ…», «УСЛОВИЯ…», «ОБЯЗАННОСТИ…»,
 *     «ИСПОЛНИТЕЛЬНАЯ ДОКУМЕНТАЦИЯ» печатались без содержания.
 *
 * Запуск: node tests/tkp-full-kp-sections.test.js
 */

const assert = require('assert');
const PizZip = require('pizzip');
const full = require('../src/services/tkp-full-kp');

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
  return xml.replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ');
}

/** Деньги из текста: неразрывные пробелы — норма вывода toLocaleString. */
function money(n) {
  return Number(n).toLocaleString('ru-RU', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  }).replace(/[\s\u00a0\u202f]/g, ' ');
}

function makeTkp(over) {
  const o = over || {};
  return {
    id: 901,
    customer_name: 'ООО ПК «КИРОВ ТАЙР»',
    subject: 'Чистка технологических каналов',
    validity_days: 30,
    created_at: new Date('2026-11-05'),
    items: {
      vat_pct: 22,
      subtotal: 5935430,
      vat_sum: 1305794.60,
      total_with_vat: 7241224.60,
      items: [
        { name: 'Чистка каналов корпуса №37', unit: 'усл.', qty: 1, price: 2967715, total: 2967715, section: 'WORK' },
        { name: 'Чистка каналов корпуса №64', unit: 'усл.', qty: 1, price: 2967715, total: 2967715, section: 'WORK' },
        { name: 'АВД 500', unit: 'шт', qty: 2, price: 0, total: 0, section: 'MTR', inventory_number: 'ИНВ-341', reference: true }
      ],
      full: Object.assign({
        object_name: 'Завод Пирелли',
        basis: 'Техническое задание заказчика',
        apparatus: [
          { equipment: 'Чистка каналов корпуса №37', inventory_no: 'усл.', tube_data: '', qty: 1, amount_no_vat: 2967715 },
          { equipment: 'Чистка каналов корпуса №64', inventory_no: 'усл.', tube_data: '', qty: 1, amount_no_vat: 2967715 },
          { equipment: 'АВД 500', inventory_no: 'шт', tube_data: 'инв. № ИНВ-341', qty: 2, amount_no_vat: 0 }
        ],
        transport_amount: 0,
        conditions: {
          personnel: 'ИТР (РП) — 1, Мастер / бригадир — 1, Слесарь — 5',
          regime: '2 смены в сутки, смена 12 ч, рабочих дней: 9',
          payment: 'Постоплата'
        },
        acceptance: '',
        risks: '',
        customer_duties: '',
        deliverables: ''
      }, o.full || {})
    }
  };
}

const COMPANY = { name: 'ООО «АСГАРД-Сервис»' };

check('итог без НДС = Σ позиций (транспорт не удваивается)', () => {
  const text = docxText(full.generateFullKpDocxBuffer(makeTkp(), COMPANY));
  assert.ok(text.indexOf(money(5935430)) >= 0, 'нет итога 5 935 430,00');
  assert.ok(text.indexOf(money(5985430)) < 0, 'появился удвоенный итог 5 985 430,00');
});

check('итог = без НДС + НДС (арифметика в документе)', () => {
  const data = full.buildFullKpTemplateData(makeTkp(), COMPANY);
  const sub = Number(String(data.subtotal).replace(/[\s\u00a0]/g, '').replace(',', '.'));
  const vat = Number(String(data.vat_sum).replace(/[\s\u00a0]/g, '').replace(',', '.'));
  const tot = Number(String(data.total).replace(/[\s\u00a0]/g, '').replace(',', '.'));
  assert.strictEqual(Math.round((sub + vat) * 100) / 100, tot,
    sub + ' + ' + vat + ' = ' + Math.round((sub + vat) * 100) / 100 + ' ≠ ' + tot);
  assert.strictEqual(Math.round(sub * 0.22 * 100) / 100, vat, 'НДС не 22% от базы');
});

check('пустые разделы не печатаются заголовками', () => {
  const text = docxText(full.generateFullKpDocxBuffer(makeTkp(), COMPANY));
  assert.ok(text.indexOf('ПОРЯДОК СДАЧИ') < 0, 'пустой порядок сдачи напечатан');
  assert.ok(text.indexOf('УСЛОВИЯ, ВЛИЯЮЩИЕ') < 0, 'пустые условия напечатаны');
  assert.ok(text.indexOf('ОБЯЗАННОСТИ ЗАКАЗЧИКА') < 0, 'пустые обязанности напечатаны');
  assert.ok(text.indexOf('ИСПОЛНИТЕЛЬНАЯ ДОКУМЕНТ') < 0, 'пустая документация напечатана');
});

check('заполненные разделы печатаются вместе с заголовком', () => {
  const tkp = makeTkp({
    full: {
      acceptance: 'Работы сдаются по акту в течение 5 рабочих дней.',
      customer_duties: 'Предоставить доступ на объект.\nОбеспечить подключение к воде.',
      deliverables: 'Акт выполненных работ.\nПротокол очистки.'
    }
  });
  const text = docxText(full.generateFullKpDocxBuffer(tkp, COMPANY));
  assert.ok(text.indexOf('ПОРЯДОК СДАЧИ') >= 0, 'заголовок порядка сдачи потерян');
  assert.ok(text.indexOf('акту в течение') >= 0, 'текст порядка сдачи потерян');
  assert.ok(text.indexOf('ОБЯЗАННОСТИ ЗАКАЗЧИКА') >= 0, 'заголовок обязанностей потерян');
  assert.ok(text.indexOf('Предоставить доступ') >= 0, 'текст обязанностей потерян');
  assert.ok(text.indexOf('ИСПОЛНИТЕЛЬНАЯ ДОКУМЕНТ') >= 0, 'заголовок документации потерян');
});

check('условия из техплана на месте (персонал и режим)', () => {
  const text = docxText(full.generateFullKpDocxBuffer(makeTkp(), COMPANY));
  assert.ok(text.indexOf('Слесарь') >= 0, 'нет состава бригады');
  assert.ok(text.indexOf('2 смены в сутки') >= 0, 'нет режима работ');
});

check('инвентарный номер складской позиции в документе', () => {
  const text = docxText(full.generateFullKpDocxBuffer(makeTkp(), COMPANY));
  assert.ok(text.indexOf('ИНВ-341') >= 0, 'нет инвентарного номера');
});

check('пустая метка «Мобилизация и срок» не печатается', () => {
  const text = docxText(full.generateFullKpDocxBuffer(makeTkp(), COMPANY));
  assert.ok(text.indexOf('Мобилизация и срок') < 0, 'метка без значения осталась');
});

/* ─── Регресс на дефекты, найденные верификатором 05.11.2026 ─── */

check('«Примечания к распределению стоимости» не печатаются без текста', () => {
  // cost_notes в ИИ-черновике всегда '' — заголовок не должен оставаться.
  const text = docxText(full.generateFullKpDocxBuffer(makeTkp(), COMPANY));
  assert.ok(text.indexOf('Примечания к распределению стоимости') < 0,
    'заголовок примечаний без текста');
});

check('«Граница объема» не печатается без значения', () => {
  const text = docxText(full.generateFullKpDocxBuffer(makeTkp(), COMPANY));
  assert.ok(text.indexOf('Граница объема') < 0, 'метка границы объёма без значения');
});

check('примечания и граница печатаются, когда заполнены', () => {
  const tkp = makeTkp({
    full: {
      cost_notes: 'Стоимость распределена по объёму работ.',
      scope_boundary: 'Не входит в объём работ:\nРемонт оборудования.'
    }
  });
  const text = docxText(full.generateFullKpDocxBuffer(tkp, COMPANY));
  assert.ok(text.indexOf('Примечания к распределению стоимости') >= 0, 'потерян заголовок примечаний');
  assert.ok(text.indexOf('распределена по объёму') >= 0, 'потерян текст примечаний');
  assert.ok(text.indexOf('Граница объема') >= 0, 'потеряна метка границы объёма');
  assert.ok(text.indexOf('Ремонт оборудования') >= 0, 'потерян текст границы объёма');
});

check('«Персонал» и «Режим производства» не печатаются без техплана', () => {
  // 114 из 115 готовых просчётов не имеют crew/params: метки не должны висеть.
  const tkp = makeTkp({ full: { conditions: { payment: 'Постоплата' } } });
  const text = docxText(full.generateFullKpDocxBuffer(tkp, COMPANY));
  assert.ok(text.indexOf('Персонал') < 0, 'пустая метка «Персонал»');
  assert.ok(text.indexOf('Режим производства') < 0, 'пустая метка «Режим производства»');
  assert.ok(text.indexOf('Постоплата') >= 0, 'заполненная оплата потеряна');
});

/* ─── Третья итерация верификатора (05.11.2026) ─── */

check('«Оплата» не печатается без значения', () => {
  const tkp = makeTkp({ full: { conditions: {} } });
  const text = docxText(full.generateFullKpDocxBuffer(tkp, COMPANY));
  assert.ok(text.indexOf('Оплата') < 0, 'метка «Оплата» без значения');
});

check('«Оплата» печатается, когда значение есть', () => {
  const tkp = makeTkp({ full: { conditions: { payment: 'Аванс 30%, остаток по акту' } } });
  const text = docxText(full.generateFullKpDocxBuffer(tkp, COMPANY));
  assert.ok(text.indexOf('Оплата') >= 0, 'потеряна метка оплаты');
  assert.ok(text.indexOf('Аванс 30%') >= 0, 'потерян текст оплаты');
});

check('подпись не содержит пустых скобок без ФИО', () => {
  const tkp = makeTkp({ full: { author_name: '' } });
  const text = docxText(full.generateFullKpDocxBuffer(tkp, { name: 'ООО «АСГАРД-Сервис»' }));
  assert.ok(text.indexOf('/  /') < 0, 'пустая подпись «/  /»');
  assert.ok(!/\(\s*\)/.test(text), 'пустые скобки в подписи');
});

check('подпись берёт ФИО директора из профиля компании', () => {
  const tkp = makeTkp({ full: { author_name: '' } });
  const text = docxText(full.generateFullKpDocxBuffer(tkp, {
    name: 'ООО «АСГАРД-Сервис»',
    director_name: 'Кудряшов Олег Сергеевич'
  }));
  assert.ok(/КУДРЯШОВ/.test(text), 'ФИО директора не подставлено');
});

console.log('\ntkp-full-kp-sections: ' + passed + '/' + (passed + failed) + ' проверок пройдено');
if (failed) {
  failures.forEach((f) => console.log(' -', f.name, ':', f.error));
  process.exit(1);
}
console.log('OK');
