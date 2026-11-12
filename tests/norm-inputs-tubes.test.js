#!/usr/bin/env node
'use strict';
/**
 * Шаг 4: tubes и length_m доезжают до нормы, мм→м.
 *
 * Дефект #2138 (12.11.2026): парсер читает tubes у 534 позиций, length_m
 * у 552, а в карточке tubes = 0 и length_m в миллиметрах. Норма tubes.gdo
 * отвечала «Укажите число трубок» / «Укажите длину трубки, м», и 452 позиции
 * из 658 остались без срока.
 *
 * Проверено вживую: tubes=899, length_m=6.09 -> норма даёт 192 чел·ч.
 *
 * Запуск: node tests/norm-inputs-tubes.test.js
 */
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'unit-test-no-db';
process.env.DB_USER = process.env.DB_USER || 'asgard';
process.env.DB_NAME = process.env.DB_NAME || 'asgard_crm_test';

const assert = require('assert');
const st = require('../src/services/mimir-tender-stages');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

const dv = (positions) => st.normalizeDv({ positions }, { categories: [], rates: [] });

check('tubes доезжает до позиции (раньше терялось полностью)', () => {
  const out = dv([{ name: 'Теплообменник 2104L', volume: 5475, unit: 'п.м', tubes: 899, dn_mm: 18, length_m: 6090 }]);
  assert.strictEqual(out.positions.length, 1);
  assert.strictEqual(out.positions[0].tubes, 899,
    'tubes не перенесён: норма ответит «Укажите число трубок»');
});

check('length_m: миллиметры переводятся в метры', () => {
  const out = dv([{ name: 'А', volume: 100, unit: 'п.м', tubes: 899, length_m: 6090 }]);
  assert.strictEqual(out.positions[0].conversion_params.length_m, 6.09,
    'длина осталась в миллиметрах: норма попросит «Укажите длину трубки, м»');
});

check('length_m: метры не пересчитываются повторно', () => {
  const out = dv([{ name: 'А', volume: 100, unit: 'п.м', length_m: 6.09 }]);
  assert.strictEqual(out.positions[0].conversion_params.length_m, 6.09);
});

check('length_m: граница 100 м остаётся метрами', () => {
  const out = dv([{ name: 'А', volume: 100, unit: 'п.м', length_m: 100 }]);
  assert.strictEqual(out.positions[0].conversion_params.length_m, 100);
});

check('length_m: 101 м уже считается миллиметрами', () => {
  const out = dv([{ name: 'А', volume: 100, unit: 'п.м', length_m: 101 }]);
  assert.strictEqual(out.positions[0].conversion_params.length_m, 0.101);
});

check('dn_mm не ломается', () => {
  const out = dv([{ name: 'А', volume: 100, unit: 'п.м', dn_mm: 18, length_m: 6090 }]);
  assert.strictEqual(out.positions[0].conversion_params.dn_mm, 18);
});

check('отсутствующая геометрия остаётся null, не нулём', () => {
  const out = dv([{ name: 'Ёмкость', volume: 50, unit: 'м3' }]);
  assert.strictEqual(out.positions[0].tubes, null);
  assert.strictEqual(out.positions[0].conversion_params.length_m, null);
});

check('мусор в geometry не даёт NaN', () => {
  const out = dv([{ name: 'А', volume: 100, unit: 'п.м', tubes: 'нет', length_m: 'x' }]);
  assert.strictEqual(out.positions[0].tubes, null);
  assert.strictEqual(out.positions[0].conversion_params.length_m, null);
});

check('дробное число трубок округляется до целого', () => {
  const out = dv([{ name: 'А', volume: 100, unit: 'п.м', tubes: 898.6 }]);
  assert.strictEqual(out.positions[0].tubes, 899);
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
