#!/usr/bin/env node
'use strict';

/**
 * Техплан: сроки, бригада, МТР — проверки без сети и без БД.
 *
 * Что доказываем:
 *  1. Смета строит строки A из crew[] по ролям (сварщик отдельной строкой),
 *     а не из трёх параметров. ИТР не удваивается при двух сменах.
 *  2. МТР попадает в секцию F с инвентарным номером; на суммы не влияет.
 *  3. Человеко-часы считаются по ролям и совпадают с ручным пересчётом.
 *  4. Старая смета без crew[]/mtr[] считается по-прежнему (совместимость).
 *  5. Кандидат склада — предложение, а не решение: source остаётся purchase.
 *  6. Валидатор показывает дырки, но не блокирует просчёт.
 *  7. Описание техплана для карточек: число ролей, склад/закупка.
 *
 * Запуск: node tests/rp-tech-plan.test.js
 */

const assert = require('assert');
const smeta = require('../src/services/asgard-smeta');
const tp = require('../src/services/rp-tech-plan');

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

function baseParams(over) {
  return Object.assign({
    shifts_per_day: 2,
    shift_hours: 12,
    work_days: 9,
    rate_itr: 20000,
    rate_master: 18000,
    rate_worker: 14000,
    rate_road: 3000,
    vat: 0.22,
    markup: 1.3
  }, over || {});
}

const CREW = [
  { code: 'itr', role: 'ИТР (РП)', role_code: 'itr', count: 1, shifts_per_day: 1 },
  { code: 'master', role: 'Мастер / бригадир', role_code: 'master', count: 1 },
  { code: 'worker', role: 'Слесарь', role_code: 'worker', count: 5 },
  { code: 'welder', role: 'Сварщик (НАКС)', role_code: 'welder', count: 2 }
];

const MTR = [
  { name: 'АВД 500', inventory_number: 'ИНВ-341', equipment_id: 12, qty: 2, unit: 'шт', source: 'warehouse' },
  { name: 'Насос Яртек', qty: 2, unit: 'шт', source: 'purchase', purpose: 'откачка' }
];

/* ───────── 1. Строки A из crew[] ───────── */

check('бригада по ролям: ИТР не удваивается при двух сменах', () => {
  const est = smeta.recalcAsgardSmeta({ params: baseParams(), crew: CREW, mtr: MTR });
  const rows = est.rows.filter((r) => r.kind === 'line' && r.section === 'A');
  const itr = rows.find((r) => r.code === 'A1');
  const master = rows.find((r) => r.code === 'A2');
  const worker = rows.find((r) => r.code === 'A3');
  assert.strictEqual(itr.qty, 9, 'ИТР: 1 чел × 9 дней × 1 смена = 9, получили ' + itr.qty);
  assert.strictEqual(master.qty, 18, 'мастер: 1 × 9 × 2 = 18, получили ' + master.qty);
  assert.strictEqual(worker.qty, 90, 'слесарь: 5 × 9 × 2 = 90, получили ' + worker.qty);
});

check('сварщик идёт отдельной строкой с своим количеством', () => {
  const est = smeta.recalcAsgardSmeta({ params: baseParams(), crew: CREW, mtr: MTR });
  const welder = est.rows.find((r) => r.crewRole === 'welder');
  assert.ok(welder, 'нет строки сварщика');
  assert.strictEqual(welder.qty, 36, 'сварщик: 2 × 9 × 2 = 36, получили ' + welder.qty);
  assert.ok(/Сварщик/.test(welder.name), welder.name);
});

check('ставка роли берётся из параметров (ИТР дороже слесаря)', () => {
  const est = smeta.recalcAsgardSmeta({ params: baseParams(), crew: CREW, mtr: MTR });
  const itr = est.rows.find((r) => r.code === 'A1');
  const worker = est.rows.find((r) => r.code === 'A3');
  assert.strictEqual(itr.price, 20000);
  assert.strictEqual(worker.price, 14000);
});

/* ───────── 2. МТР в перечне, но не в сумме ───────── */

check('МТР попадает в секцию F с инвентарным номером', () => {
  const est = smeta.recalcAsgardSmeta({ params: baseParams(), crew: CREW, mtr: MTR });
  const f = est.rows.filter((r) => r.section === 'F' && r.kind === 'info');
  assert.strictEqual(f.length, 2, 'позиций F: ' + f.length);
  assert.strictEqual(f[0].inventory_number, 'ИНВ-341');
  assert.strictEqual(f[1].name, 'Насос Яртек');
});

check('перечень МТР не участвует в себестоимости', () => {
  const withMtr = smeta.recalcAsgardSmeta({ params: baseParams(), crew: CREW, mtr: MTR });
  const without = smeta.recalcAsgardSmeta({ params: baseParams(), crew: CREW, mtr: [] });
  assert.strictEqual(withMtr.totals.cost, without.totals.cost,
    'перечень изменил себестоимость: ' + withMtr.totals.cost + ' vs ' + without.totals.cost);
});

/* ───────── 3. Человеко-часы ───────── */

check('человеко-часы считаются по ролям', () => {
  const est = smeta.recalcAsgardSmeta({ params: baseParams(), crew: CREW, mtr: MTR });
  // ИТР 1×9×1×12=108; мастер 1×9×2×12=216; слесарь 5×9×2×12=1080; сварщик 2×9×2×12=432
  assert.strictEqual(est.totals.man_hours, 1836, 'получили ' + est.totals.man_hours);
});

check('без crew[] человеко-часы берутся из параметров', () => {
  const est = smeta.recalcAsgardSmeta({ params: baseParams({ workers_per_shift: 3, masters_per_shift: 1 }) });
  assert.ok(est.totals.man_hours > 0, 'человеко-часы не посчитаны');
  // (3+1) × 9 × 2 × 12 = 864
  assert.strictEqual(est.totals.man_hours, 864);
});

/* ───────── 4. Совместимость со старыми сметами ───────── */

check('старая смета без crew/mtr считается как раньше', () => {
  const old = {
    params: baseParams({ workers_per_shift: 6, masters_per_shift: 1 }),
    rows: null
  };
  const est = smeta.recalcAsgardSmeta(old);
  assert.ok(Array.isArray(est.crew) && est.crew.length === 0, 'crew должен быть пустым массивом');
  const worker = est.rows.find((r) => r.code === 'A3');
  // 6 рабочих × 9 дней × 2 смены
  assert.strictEqual(worker.qty, 108, 'старый расчёт сломан: ' + worker.qty);
});

check('пустой crew не добавляет лишних строк A', () => {
  const est = smeta.recalcAsgardSmeta({ params: baseParams() });
  const aLines = est.rows.filter((r) => r.kind === 'line' && r.section === 'A');
  assert.ok(aLines.length <= 7, 'строк A: ' + aLines.length);
  assert.ok(!est.rows.some((r) => r.crewRole === 'welder'), 'появился сварщик без бригады');
});

/* ───────── 5. Склад: кандидат, а не решение ───────── */

check('кандидат склада не подменяет источник без согласия РП', () => {
  const plan = tp.buildTechPlan({
    estimate: { equipment_needed: [{ item: 'Аппарат высокого давления АВД 500', quantity: 2 }] },
    smeta: { params: baseParams() },
    stock: [{ id: 101, name: 'АВД высокого давления 500', inventory_number: 'ИНВ-341', quantity: 3, unit: 'шт' }]
  });
  assert.strictEqual(plan.mtr.length, 1);
  assert.strictEqual(plan.mtr[0].source, 'purchase', 'система сама решила взять со склада');
  assert.ok(plan.mtr[0].suggested, 'кандидат склада не найден');
  assert.strictEqual(plan.mtr[0].suggested.inventory_number, 'ИНВ-341');
});

check('несовместимое название не получает кандидата', () => {
  const plan = tp.buildTechPlan({
    estimate: { equipment_needed: [{ item: 'Компрессор винтовой', quantity: 1 }] },
    smeta: { params: baseParams() },
    stock: [{ id: 103, name: 'Насос дренажный', inventory_number: 'ИНВ-912', quantity: 2, unit: 'шт' }]
  });
  assert.strictEqual(plan.mtr[0].suggested, undefined, 'ложное совпадение: ' + JSON.stringify(plan.mtr[0].suggested));
});

/* ───────── 6. Валидатор ───────── */

check('валидатор показывает дырки, но просчёт не блокирует', () => {
  const res = tp.validateTechPlan({ schedule: {}, crew: [], mtr: [] });
  assert.strictEqual(res.ok, false);
  assert.ok(res.missing.includes('crew'));
  assert.ok(res.missing.includes('mtr'));
  assert.ok(res.missing.includes('schedule.work_days'));
});

check('неполный техплан проходит при заполненных ключевых полях', () => {
  const plan = tp.buildTechPlan({
    estimate: { work_days: 9, shift_mode: '2', shift_hours: 12, calculation: { personnel: [{ role: 'Слесарь', count: 3 }] }, equipment_needed: [{ item: 'АВД', quantity: 1 }] },
    smeta: { params: baseParams() }
  });
  const res = tp.validateTechPlan(plan);
  assert.strictEqual(res.ok, true, JSON.stringify(res.missing));
});

check('человеко-часы в плане совпадают с расчётом сметы', () => {
  const plan = tp.buildTechPlan({
    estimate: { work_days: 9, shift_mode: '2', shift_hours: 12 },
    smeta: { params: baseParams(), crew: CREW }
  });
  const est = smeta.recalcAsgardSmeta({ params: baseParams(), crew: CREW });
  assert.strictEqual(tp.computeManHours(plan, baseParams()), est.totals.man_hours);
});

/* ───────── 7. Описание для карточек ───────── */

check('describeTechPlan отдаёт роли, склад и закупку', () => {
  const est = smeta.recalcAsgardSmeta({ params: baseParams(), crew: CREW, mtr: MTR });
  const d = smeta.describeTechPlan(est);
  assert.ok(d, 'описание пустое');
  assert.strictEqual(d.roles.length, 4, 'ролей: ' + d.roles.length);
  assert.strictEqual(d.mtr_count, 2);
  assert.strictEqual(d.mtr_warehouse, 1);
  assert.strictEqual(d.mtr_purchase, 1);
  assert.ok(d.man_hours > 0);
});

check('describeTechPlan на пустой смете отдаёт null', () => {
  assert.strictEqual(smeta.describeTechPlan({ rows: [], totals: {} }), null);
});

/* ───────── 8. Роли из текста ───────── */

check('classifyMobileRole понимает роли Мимира', () => {
  const cases = {
    'слесарь-универсал': 'worker',
    'Сварщик НАКС': 'welder',
    'мастер': 'master',
    'наблюдающий': 'observer',
    'ИТР': 'itr',
    'водитель': 'driver',
    'изолировщик': 'insulator',
    'монтажник': 'assembler'
  };
  Object.keys(cases).forEach((k) => {
    assert.strictEqual(smeta.classifyMobileRole(k), cases[k], k);
  });
  assert.strictEqual(smeta.classifyMobileRole('бухгалтер'), '', 'неизвестная роль не должна угадываться');
});

/* ───────── 9. applyToSmeta идемпотентен ───────── */

check('applyToSmeta дважды даёт тот же результат', () => {
  const plan = tp.buildTechPlan({
    estimate: {
      work_days: 9,
      shift_mode: '2',
      shift_hours: 12,
      calculation: { personnel: [{ role: 'Слесарь', count: 5 }, { role: 'Мастер', count: 1 }] },
      equipment_needed: [{ item: 'АВД', quantity: 2 }]
    },
    smeta: { params: baseParams() }
  });
  const once = tp.applyToSmeta({ params: baseParams() }, plan);
  const twice = tp.applyToSmeta(once, plan);
  assert.strictEqual(once.totals.cost, twice.totals.cost, 'себестоимость разъехалась');
  assert.strictEqual(once.totals.man_hours, twice.totals.man_hours);
  assert.strictEqual(once.rows.length, twice.rows.length, 'строки размножились');
});

console.log('\nrp-tech-plan: ' + passed + '/' + (passed + failed) + ' проверок пройдено');
if (failed) {
  failures.forEach((f) => console.log(' -', f.name, ':', f.error));
  process.exit(1);
}
console.log('OK');
