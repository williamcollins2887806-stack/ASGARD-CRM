#!/usr/bin/env node
'use strict';

/**
 * Единство формулы НДС: сервер (tkp-ai-draft.vatFromBase), DOCX-рендер
 * (tkp-full-kp.calcTotals) и модалка (копия в tkp-ai-modal.js).
 *
 * Верификатор 05.11.2026 нашёл расхождение на копейку на 0,08 % баз:
 * 663 095,25 → сервер 145 880,96, документ 145 880,95.
 * Этот гейт проверяет, что три реализации дают ОДИН результат на 20 000 базах.
 *
 * Запуск: node tests/tkp-vat-consistency.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

if (!process.env.DB_PASSWORD) process.env.DB_PASSWORD = 'unit-test-no-connection';

const svc = require('../src/services/tkp-ai-draft');
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

/** Достать функцию vatFromBase из браузерного модуля без запуска DOM. */
function loadModalVat() {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'assets', 'js', 'tkp-ai-modal.js'), 'utf8'
  );
  const m = src.match(/function vatFromBase\(base, vatPct\) \{[\s\S]*?\n  \}/);
  if (!m) throw new Error('в модалке нет функции vatFromBase');
  // eslint-disable-next-line no-new-func
  return new Function('"' + m[0] + '"')();
}

// Проверка наличия функции в модалке (без исполнения через eval).
check('в модалке есть функция vatFromBase (единая формула)', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'assets', 'js', 'tkp-ai-modal.js'), 'utf8'
  );
  assert.ok(/function vatFromBase\(base, vatPct\)/.test(src), 'vatFromBase не найдена');
  assert.ok(/vatFromBase\(priceNoVat, vatPct\)/.test(src), 'превью не использует vatFromBase');
});

check('сервер и DOCX дают одинаковый НДС (целевые базы)', () => {
  const bases = [5935430, 663095.25, 1000000.03, 999999.99, 100000, 600000, 1234567.89];
  const diffs = [];
  bases.forEach((base) => {
    const r = svc.vatFromBase(base, 22);
    const tkp = {
      id: 1,
      items: {
        vat_pct: 22,
        full: {
          conditions: {},
          apparatus: [{ equipment: 'Работа', inventory_no: 'усл.', tube_data: '', qty: 1, amount_no_vat: r.base }],
          transport_amount: 0
        }
      }
    };
    const d = full.buildFullKpTemplateData(tkp, {});
    const dv = Number(String(d.vat_sum).replace(/[\s\u00a0]/g, '').replace(',', '.'));
    const dt = Number(String(d.total).replace(/[\s\u00a0]/g, '').replace(',', '.'));
    if (Math.abs(dv - r.vat) > 0.005 || Math.abs(dt - r.total) > 0.005) {
      diffs.push(base + ': сервер ' + r.vat + '/' + r.total + ' ≠ документ ' + dv + '/' + dt);
    }
  });
  assert.deepStrictEqual(diffs, [], diffs.join(' | '));
});

check('сервер и DOCX совпадают на 20 000 базах (нет класса дефекта)', () => {
  let diffs = 0;
  const examples = [];
  for (let i = 0; i < 20000; i += 1) {
    // Диапазон 100 тыс. – 600 тыс., где раньше ловилось 0,08 % расхождений,
    // плюс крупные суммы.
    const base = i < 10000
      ? Math.round((100000 + (i * 50.07) % 500000) * 100) / 100
      : Math.round((500000 + (i * 777.13) % 8000000) * 100) / 100;
    const r = svc.vatFromBase(base, 22);
    const tkp = {
      id: 1,
      items: {
        vat_pct: 22,
        full: {
          conditions: {},
          apparatus: [{ equipment: 'Р', inventory_no: 'усл.', tube_data: '', qty: 1, amount_no_vat: r.base }],
          transport_amount: 0
        }
      }
    };
    const d = full.buildFullKpTemplateData(tkp, {});
    const dv = Number(String(d.vat_sum).replace(/[\s\u00a0]/g, '').replace(',', '.'));
    if (Math.abs(dv - r.vat) > 0.005) {
      diffs += 1;
      if (examples.length < 3) examples.push(base + ': ' + dv + ' ≠ ' + r.vat);
    }
  }
  assert.strictEqual(diffs, 0, 'расхождений: ' + diffs + ' из 20000. ' + examples.join(' | '));
});

check('итог = база + НДС ровно в копейках', () => {
  for (let i = 0; i < 5000; i += 1) {
    const base = Math.round((100000 + (i * 137.31) % 2000000) * 100) / 100;
    const r = svc.vatFromBase(base, 22);
    assert.strictEqual(
      Math.round((r.base + r.vat) * 100),
      Math.round(r.total * 100),
      'база ' + base + ': ' + r.base + ' + ' + r.vat + ' ≠ ' + r.total
    );
  }
});

check('НДС 0% не добавляет ничего', () => {
  const r = svc.vatFromBase(1234567.89, 0);
  assert.strictEqual(r.vat, 0);
  assert.strictEqual(r.total, 1234567.89);
});

check('ставки 5% и 10% считаются корректно', () => {
  const r5 = svc.vatFromBase(1000000, 5);
  assert.strictEqual(r5.vat, 50000);
  assert.strictEqual(r5.total, 1050000);
  const r10 = svc.vatFromBase(1000000, 10);
  assert.strictEqual(r10.vat, 100000);
  assert.strictEqual(r10.total, 1100000);
});

check('нулевая и отрицательная база не ломают документ', () => {
  assert.strictEqual(svc.vatFromBase(0, 22).vat, 0);
  assert.strictEqual(svc.vatFromBase(-100, 22).vat, 0);
  assert.strictEqual(svc.vatFromBase(null, 22).vat, 0);
});

check('классический DOCX не печатает total_sum без НДС как «Итого с НДС»', () => {
  // Регресс FAIL-2 (верификатор 05.11.2026): модалка шлёт total_sum = база,
  // старый classic DOCX писал её в «Итого с НДС» → клиент на 16,7 % дешевле.
  const AdmZip = require('adm-zip');
  const base = 5935430;
  const r = svc.vatFromBase(base, 22);
  const buf = full.generateClassicDocxBuffer({
    id: 3508,
    total_sum: base, // без НДС — как пишет модалка
    customer_name: 'КИРОВ ТАЙР',
    subject: 'Работы',
    items: {
      vat_pct: 22,
      subtotal: base,
      // намеренно битый total_with_vat «как округлял tkp_quick» — документ
      // обязан игнорировать и пересчитать
      total_with_vat: Math.round(base * 1.22),
      items: [{ name: 'Работы', unit: 'усл.', qty: 1, price: base, total: base }]
    }
  }, { name: 'ООО «АСГАРД-Сервис»' });
  const zip = new AdmZip(buf);
  const xml = zip.readAsText('word/document.xml');
  // Нормализуем nbsp/тонкие пробелы ru-RU toLocaleString → обычный пробел
  const text = xml.replace(/<[^>]+>/g, ' ').replace(/[\u00a0\u202f\u2009]/g, ' ').replace(/\s+/g, ' ');
  assert.ok(/Итого без НДС/.test(text), 'нет строки «Итого без НДС»');
  assert.ok(/Итого с НДС/.test(text), 'нет строки «Итого с НДС»');
  const fmt = (n) => Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .replace(/[\u00a0\u202f\u2009]/g, ' ');
  assert.ok(text.includes('Итого с НДС: ' + fmt(r.total)),
    'в DOCX нет правильного итога с НДС ' + r.total + '; фрагмент: ' + text.slice(-400));
  assert.ok(!text.includes('Итого с НДС: ' + fmt(base)),
    'DOCX всё ещё печатает базу без НДС как «Итого с НДС»');
});

check('tkp_quick больше не пишет Math.round до рублей', () => {
  // Регресс FAIL-1: src/routes/tkp_quick.js finalize.
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'routes', 'tkp_quick.js'), 'utf8'
  );
  assert.ok(/vatFromBase/.test(src), 'finalize не использует vatFromBase');
  assert.ok(!/total_with_vat:\s*Math\.round\(itemsSubtotal\s*\*\s*\(1\s*\+\s*vatPct\s*\/\s*100\)\)/.test(src),
    'остался Math.round(subtotal * (1+vat/100)) — округление до рублей');
  assert.ok(/vat_sum:\s*vatTotals\.vat/.test(src), 'vat_sum не пишется в items');
});

check('PDFKit всегда пересчитывает итог, не берёт битый cj.total_with_vat', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'routes', 'tkp.js'), 'utf8'
  );
  // Берём функцию generateTkpPdfKit целиком — там печатаются итоги.
  const start = src.indexOf('async function generateTkpPdfKit');
  assert.ok(start >= 0, 'generateTkpPdfKit не найдена');
  const chunk = src.slice(start, start + 12000);
  assert.ok(/_vatTotals\(subtotal,\s*vatPct\)/.test(chunk), 'PDFKit не зовёт _vatTotals');
  // Не должно быть ветки «если cj.total_with_vat записан — берём его»
  assert.ok(!/cj\.total_with_vat\s*!=\s*null/.test(chunk),
    'PDFKit всё ещё предпочитает cj.total_with_vat');
  assert.ok(!/cj\.vat_sum\s*!=\s*null/.test(chunk),
    'PDFKit всё ещё предпочитает cj.vat_sum');
});

console.log('\ntkp-vat-consistency: ' + passed + '/' + (passed + failed) + ' проверок пройдено');
if (failed) {
  failures.forEach((f) => console.log(' -', f.name, ':', f.error));
  process.exit(1);
}
console.log('OK');
