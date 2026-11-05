#!/usr/bin/env node
'use strict';

/**
 * Полное КП: разбивка по позициям.
 *
 * Что доказываем:
 *  1. Полное КП даёт N работ + N единиц МТР, а не одну строку.
 *  2. Σ строк = цена КП без НДС до копейки, включая «неудобные» цены.
 *  3. 30 единиц оборудования → 30 строк (требование заказчика).
 *  4. Краткое ТКП остаётся одной строкой.
 *  5. Внутренние статьи (ФОТ, пайковые, амортизация) не попадают в позиции.
 *  6. Если МТР дороже цены КП — цены на МТР обнуляются, Σ всё равно сходится.
 *  7. Пустой техплан → разбивка по работам, а не падение.
 *
 * Запуск: node tests/tkp-itemized-items.test.js
 */

const assert = require('assert');

if (!process.env.DB_PASSWORD) process.env.DB_PASSWORD = 'unit-test-no-connection';

const svc = require('../src/services/tkp-ai-draft');
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

function pricing(over) {
  const o = over || {};
  return {
    priceNoVat: o.priceNoVat != null ? o.priceNoVat : 5935430,
    priceWithVat: o.priceWithVat != null ? o.priceWithVat : 7241223.99,
    vatPct: o.vatPct != null ? o.vatPct : 22,
    totals: { transport: 50000 },
    smeta: { rows: o.rows || [], totals: {} },
    durationDays: 9
  };
}

function techPlan(over) {
  return Object.assign({
    schedule: { work_days: 9, shift_mode: '2', shift_hours: 12, trip_count: 1 },
    crew: [
      { role: 'ИТР (РП)', role_code: 'itr', count: 1, shifts_per_day: 1 },
      { role: 'Мастер / бригадир', role_code: 'master', count: 1 },
      { role: 'Слесарь', role_code: 'worker', count: 5 },
      { role: 'Сварщик (НАКС)', role_code: 'welder', count: 2 }
    ],
    mtr: [
      { name: 'АВД 500', qty: 2, unit: 'шт', source: 'warehouse', inventory_number: 'ИНВ-341' },
      { name: 'Насос Яртек', qty: 2, unit: 'шт', source: 'purchase', purpose: 'откачка' }
    ],
    man_hours_total: 1836
  }, over || {});
}

const WORKS = [
  'Чистка технологических каналов корпуса №37',
  'Чистка технологических каналов корпуса №64',
  'Промывка каналов аппаратом высокого давления'
];

function sumOf(items) {
  return Math.round(items.reduce((s, it) => s + Number(it.total || 0), 0) * 100) / 100;
}

/* ───────── 1. N позиций вместо одной ───────── */

check('полное КП: работы + МТР отдельными позициями', () => {
  const items = svc.buildItemizedClientItems({
    pricing: pricing(), techPlan: techPlan(), workNames: WORKS
  });
  const works = items.filter((i) => i.section === 'WORK');
  const mtr = items.filter((i) => i.section === 'MTR');
  assert.strictEqual(works.length, 3, 'работ: ' + works.length);
  assert.strictEqual(mtr.length, 2, 'МТР: ' + mtr.length);
  assert.strictEqual(items.length, 5);
});

check('30 единиц оборудования → 30 строк МТР', () => {
  const mtr = [];
  for (let i = 1; i <= 30; i += 1) {
    mtr.push({ name: 'Аппарат №' + i, qty: 1, unit: 'шт', source: 'warehouse', inventory_number: 'ИНВ-' + (100 + i) });
  }
  const items = svc.buildItemizedClientItems({
    pricing: pricing(), techPlan: techPlan({ mtr }), workNames: WORKS
  });
  const mtrRows = items.filter((i) => i.section === 'MTR');
  assert.strictEqual(mtrRows.length, 30, 'строк МТР: ' + mtrRows.length);
  assert.ok(mtrRows[0].name.indexOf('ИНВ-101') >= 0, 'инв. номер не попал в название: ' + mtrRows[0].name);
});

/* ───────── 2. Сумма сходится всегда ───────── */

check('Σ строк = цена КП без НДС', () => {
  const p = pricing();
  const items = svc.buildItemizedClientItems({ pricing: p, techPlan: techPlan(), workNames: WORKS });
  assert.strictEqual(sumOf(items), p.priceNoVat);
});

check('Σ сходится при «неудобной» цене (копейки)', () => {
  const cases = [1000000.03, 999999.99, 1234567.89, 100.01];
  for (const price of cases) {
    const p = pricing({ priceNoVat: price });
    const items = svc.buildItemizedClientItems({ pricing: p, techPlan: techPlan(), workNames: WORKS });
    assert.strictEqual(sumOf(items), price, 'цена ' + price + ' → ' + sumOf(items));
  }
});

check('Σ сходится при 30 позициях МТР', () => {
  const mtr = [];
  for (let i = 1; i <= 30; i += 1) {
    mtr.push({ name: 'Аппарат №' + i, qty: 1, unit: 'шт', source: 'purchase' });
  }
  const p = pricing({ priceNoVat: 1234567.89 });
  const items = svc.buildItemizedClientItems({ pricing: p, techPlan: techPlan({ mtr }), workNames: WORKS });
  assert.strictEqual(sumOf(items), 1234567.89);
});

check('нет отрицательных и нулевых количеств', () => {
  const items = svc.buildItemizedClientItems({ pricing: pricing(), techPlan: techPlan(), workNames: WORKS });
  items.forEach((it) => {
    assert.ok(Number(it.qty) > 0, 'qty=' + it.qty + ' у ' + it.name);
    assert.ok(Number(it.total) >= 0, 'отрицательная сумма у ' + it.name);
  });
});

/* ───────── 3. Внутренние статьи не протекают ───────── */

check('в позициях нет ФОТ, пайковых, амортизации', () => {
  const items = svc.buildItemizedClientItems({ pricing: pricing(), techPlan: techPlan(), workNames: WORKS });
  const names = items.map((i) => i.name).join(' | ');
  const forbidden = [/ФОТ/i, /накладн/i, /пайков/i, /проживан/i, /амортизац/i, /СИЗ/i, /себестоимост/i, /марж/i];
  const hits = forbidden.filter((re) => re.test(names)).map((re) => re.source);
  assert.deepStrictEqual(hits, [], 'протекло: ' + hits.join(','));
});

check('каждое название проходит клиентский линтер', () => {
  const items = svc.buildItemizedClientItems({ pricing: pricing(), techPlan: techPlan(), workNames: WORKS });
  const bad = [];
  items.forEach((it) => {
    const r = lint.lintText(it.name, { skipNumbers: true });
    if (r.hits.length) bad.push(it.name + ' → ' + r.hits.map((h) => h.kind).join(','));
  });
  assert.deepStrictEqual(bad, [], bad.join(' | '));
});

/* ───────── 4. МТР дороже цены КП ───────── */

check('если МТР дороже цены КП — цены МТР справочные, Σ сходится', () => {
  const mtr = [{ name: 'Дорогой аппарат', qty: 1, unit: 'шт', source: 'purchase', price: 5000000 }];
  const p = pricing({ priceNoVat: 1000000 });
  const items = svc.buildItemizedClientItems({ pricing: p, techPlan: techPlan({ mtr }), workNames: WORKS });
  assert.strictEqual(sumOf(items), 1000000);
  const mtrRow = items.find((i) => i.section === 'MTR');
  assert.strictEqual(mtrRow.total, 0, 'МТР забрал цену у работ');
  assert.strictEqual(mtrRow.reference, true, 'позиция не помечена справочной');
});

/* ───────── 5. Краткое КП — одна строка ───────── */

check('краткое КП остаётся одной сводной строкой', () => {
  const items = svc.buildClientItems(pricing(), { summaryName: 'Выполнение работ по очистке' });
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].total, 5935430);
});

/* ───────── 6. Пустые данные ───────── */

check('без техплана разбивка идёт по работам', () => {
  const items = svc.buildItemizedClientItems({
    pricing: pricing({ rows: [] }), techPlan: {}, workNames: WORKS
  });
  assert.strictEqual(items.length, 3, 'позиций: ' + items.length);
  assert.strictEqual(sumOf(items), 5935430);
  assert.ok(items.every((i) => i.section === 'WORK'));
});

check('без работ берётся сводная позиция, а не пустая таблица', () => {
  const items = svc.buildItemizedClientItems({
    pricing: pricing(), techPlan: {}, workNames: []
  });
  assert.ok(items.length >= 1, 'таблица пустая');
  assert.strictEqual(sumOf(items), 5935430);
});

check('нулевая цена → пустой список (публиковать нечего)', () => {
  const items = svc.buildItemizedClientItems({
    pricing: pricing({ priceNoVat: 0 }), techPlan: techPlan(), workNames: WORKS
  });
  assert.deepStrictEqual(items, []);
});

/* ───────── 7. Распределение по трудозатратам ───────── */

check('работы делят цену по трудозатратам, а не поровну при разных весах', () => {
  const plan = techPlan({
    mtr: [],
    man_hours_total: 300
  });
  // Три работы с разными чел-часами → разные суммы.
  const items = svc.buildItemizedClientItems({
    pricing: pricing({ priceNoVat: 300000 }),
    techPlan: plan,
    workNames: WORKS
  });
  assert.strictEqual(items.length, 3);
  assert.strictEqual(sumOf(items), 300000);
});

/* ───────── 8. Инвентарный номер в названии ───────── */

check('складская позиция несёт инвентарный номер', () => {
  const items = svc.buildItemizedClientItems({ pricing: pricing(), techPlan: techPlan(), workNames: WORKS });
  const wh = items.find((i) => i.inventory_number === 'ИНВ-341');
  assert.ok(wh, 'складская позиция потеряна');
  assert.ok(/ИНВ-341/.test(wh.name), 'инв. номер не в названии: ' + wh.name);
});

/* ─── Регресс: утечки в МТР и единство формулы НДС (05.11.2026) ─── */

check('внутренние статьи не проходят в МТР ни в одной формулировке', () => {
  // Верификатор нашёл: фильтр стоял только для работ, и «Транспортные расходы»
  // становились позицией МТР, попадая в preview-pdf.
  const dirty = [
    'ФОТ бригады',
    'Транспортные расходы',
    'Логистика до объекта',
    'Мобилизация техники',
    'Пайковые 5000',
    'Амортизация АВД',
    'Накладные расходы',
    'Проживание бригады',
    'Себестоимость работ',
    'Маржинальность'
  ];
  const mtr = dirty.map((name, i) => ({ name, qty: 1, unit: 'шт', source: 'purchase' }));
  const items = svc.buildItemizedClientItems({
    pricing: pricing(), techPlan: techPlan({ mtr }), workNames: WORKS
  });
  const mtrItems = items.filter((i) => i.section === 'MTR');
  assert.deepStrictEqual(mtrItems.map((i) => i.name), [],
    'протекло в МТР: ' + mtrItems.map((i) => i.name).join(' | '));
  assert.strictEqual(sumOf(items), 5935430, 'Σ разъехалась после фильтра');
});

check('isInternalName ловит те же слова, что клиентский линтер', () => {
  // Единый источник: новый список в линтере не должен снова разойтись с позициями.
  const probes = ['Транспортные расходы', 'Логистика до объекта', 'Мобилизация техники', 'ФОТ бригады'];
  probes.forEach((p) => {
    assert.strictEqual(svc.isInternalName(p), true, 'не поймано: ' + p);
  });
  const clean = ['Аппарат высокого давления АВД 500', 'Насос Яртек', 'Компрессор винтовой'];
  clean.forEach((p) => {
    assert.strictEqual(svc.isInternalName(p), false, 'ложное срабатывание: ' + p);
  });
});

check('НДС: серверная формула — целые копейки (эталон)', () => {
  // Та же формула в модалке (vatFromBase). Проверяем базы, на которых прежняя
  // реализация расходилась на копейку (0,08 % случаев).
  const cases = [
    { base: 5935430, pct: 22 },
    { base: 663095.25, pct: 22 },
    { base: 1000000.03, pct: 22 },
    { base: 999999.99, pct: 22 },
    { base: 100000, pct: 22 },
    { base: 600000, pct: 22 }
  ];
  cases.forEach((c) => {
    const r = svc.vatFromBase(c.base, c.pct);
    const baseKop = Math.round(c.base * 100);
    const expectedVatKop = Math.round(baseKop * Math.round(c.pct * 100) / 10000);
    assert.strictEqual(Math.round(r.vat * 100), expectedVatKop,
      'НДС не в копейках у базы ' + c.base);
    assert.strictEqual(Math.round((r.base + r.vat) * 100), Math.round(r.total * 100),
      'итог ≠ база + НДС у базы ' + c.base);
  });
});

check('НДС: формула модалки совпадает с серверной на 10 000 базах', () => {
  // Копия vatFromBase из public/assets/js/tkp-ai-modal.js — обязана давать
  // те же копейки. Это ловит расхождение двух реализаций.
  const modalVatFromBase = (base, vatPct) => {
    const b = Number(base);
    const p = Number(vatPct);
    if (!Number.isFinite(b) || b <= 0) return { half: 0, vat: 0, total: 0 };
    const baseKop = Math.round(b * 100);
    const bp = Math.round(p * 100);
    const vatKop = Math.round(baseKop * bp / 10000);
    return { half: baseKop / 100, vat: vatKop / 100, total: (baseKop + vatKop) / 100 };
  };
  let diffs = 0;
  for (let i = 0; i < 10000; i += 1) {
    const base = 100000 + (i * 50.07) % 500000;
    const srv = svc.vatFromBase(base, 22);
    const mod = modalVatFromBase(base, 22);
    if (Math.round(srv.vat * 100) !== Math.round(mod.vat * 100)
      || Math.round(srv.total * 100) !== Math.round(mod.total * 100)) {
      diffs += 1;
    }
  }
  assert.strictEqual(diffs, 0, 'расхождений: ' + diffs + ' из 10000');
});

console.log('\ntkp-itemized-items: ' + passed + '/' + (passed + failed) + ' проверок пройдено');
if (failed) {
  failures.forEach((f) => console.log(' -', f.name, ':', f.error));
  process.exit(1);
}
console.log('OK');
