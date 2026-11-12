#!/usr/bin/env node
'use strict';
/**
 * Проверка шага 2: число выездов описывает РОВНО то, что в графике.
 *
 * Дефект #2138 (12.11.2026): visit_plan.mode=visits, visits = ОДИН заезд
 * «один непрерывный заезд», а trip_count = 5 из ответа модели. Смета умножает
 * дорогу, проживание, пайковые и мобилизацию на trip_count — РП видел график
 * из одного приезда и цену за пять.
 *
 * Запуск: node tests/visit-trip-count.test.js
 */
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'unit-test-no-db';
process.env.DB_USER = process.env.DB_USER || 'asgard';
process.env.DB_NAME = process.env.DB_NAME || 'asgard_crm_test';

const assert = require('assert');
const vp = require('../src/services/visit-plan');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

const POSITION = (i) => ({
  id: 'p' + i, name: 'Аппарат ' + i, volume: 100, unit: 'п.м',
  period: 'апрель', clean_count: 1, days: 1, people: 5
});

// ── Главный кейс: #2138 ────────────────────────────────────────────────────
check('#2138: mode=visits, заезд один, модель назвала 5 → trip_count 1', () => {
  const plan = vp.buildVisitPlan({
    positions: [POSITION(1), POSITION(2)],
    text: '',
    modelPlan: {
      schedule_mode: 'visits',
      visits: [{ id: 'v1', label: 'один непрерывный заезд', position_ids: ['p1', 'p2'] }],
      trip_count: 5
    }
  });
  assert.strictEqual(plan.visits.length, 1, 'заездов не 1');
  assert.strictEqual(plan.trip_count, 1,
    `trip_count ${plan.trip_count} при одном заезде — смета переплатит за дорогу`);
});

check('#2138: расхождение с моделью попадает в конфликты, а не в тишину', () => {
  const plan = vp.buildVisitPlan({
    positions: [POSITION(1)],
    text: '',
    modelPlan: {
      schedule_mode: 'visits',
      visits: [{ id: 'v1', label: 'один непрерывный заезд', position_ids: ['p1'] }],
      trip_count: 5
    }
  });
  const mismatch = plan.conflicts.find((c) => c.kind === 'trip_count_mismatch');
  assert.ok(mismatch, 'расхождение не записано в конфликты');
  assert.ok(/5/.test(mismatch.message), 'в сообщении нет числа модели: ' + mismatch.message);
  assert.ok(/1/.test(mismatch.message), 'в сообщении нет принятого числа: ' + mismatch.message);
});

// ── Режим visits с настоящей разбивкой ─────────────────────────────────────
check('три заезда → trip_count 3', () => {
  const plan = vp.buildVisitPlan({
    positions: [POSITION(1), POSITION(2), POSITION(3)],
    text: '',
    modelPlan: {
      schedule_mode: 'visits',
      visits: [
        { id: 'v1', label: 'апрель', position_ids: ['p1'] },
        { id: 'v2', label: 'октябрь', position_ids: ['p2'] },
        { id: 'v3', label: 'декабрь', position_ids: ['p3'] }
      ],
      trip_count: 3
    }
  });
  assert.strictEqual(plan.visits.length, 3);
  assert.strictEqual(plan.trip_count, 3);
  assert.strictEqual(plan.conflicts.filter((c) => c.kind === 'trip_count_mismatch').length, 0,
    'при совпадении конфликта быть не должно');
});

// ── Непрерывный режим ──────────────────────────────────────────────────────
check('непрерывный режим: trip_count 1 при любом числе модели', () => {
  const plan = vp.buildVisitPlan({
    positions: [POSITION(1), POSITION(2)],
    text: '',
    modelPlan: { schedule_mode: 'continuous', visits: [], trip_count: 5 }
  });
  assert.strictEqual(plan.mode, 'continuous');
  assert.strictEqual(plan.trip_count, 1, 'непрерывный режим не может иметь 5 приездов');
});

check('непрерывный режим: расхождение с моделью видно РП', () => {
  const plan = vp.buildVisitPlan({
    positions: [POSITION(1)],
    text: '',
    modelPlan: { schedule_mode: 'continuous', visits: [], trip_count: 4 }
  });
  const mismatch = plan.conflicts.find((c) => c.kind === 'trip_count_mismatch');
  assert.ok(mismatch, 'нет конфликта');
  assert.ok(/непрерывн/i.test(mismatch.message),
    'в сообщении не объяснено, почему один приезд: ' + mismatch.message);
});

// ── Краевые случаи ─────────────────────────────────────────────────────────
check('модель без trip_count: считается по заездам, конфликта нет', () => {
  const plan = vp.buildVisitPlan({
    positions: [POSITION(1), POSITION(2)],
    text: '',
    modelPlan: {
      schedule_mode: 'visits',
      visits: [
        { id: 'v1', label: 'апрель', position_ids: ['p1'] },
        { id: 'v2', label: 'октябрь', position_ids: ['p2'] }
      ]
    }
  });
  assert.strictEqual(plan.trip_count, 2);
  assert.strictEqual(plan.conflicts.filter((c) => c.kind === 'trip_count_mismatch').length, 0);
});

check('trip_count никогда не ноль и не отрицательный', () => {
  const plan = vp.buildVisitPlan({
    positions: [POSITION(1)],
    text: '',
    modelPlan: { schedule_mode: 'visits', visits: [], trip_count: 0 }
  });
  assert.ok(plan.trip_count >= 1, 'trip_count ' + plan.trip_count);
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
