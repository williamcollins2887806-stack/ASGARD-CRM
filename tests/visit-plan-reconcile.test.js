#!/usr/bin/env node
'use strict';
/**
 * Согласование mode / trip_count / visits.
 *
 * Реальный дефект (#2138, 12.11.2026): в карточке стояло
 * mode=visits, trip_count=5, а заездов — ОДИН («один непрерывный заезд»).
 * Смета умножает дорогу, проживание, пайковые и мобилизацию на trip_count,
 * поэтому РП получал переплату за 5 приездов при графике из одного.
 *
 * Запуск: node tests/visit-plan-reconcile.test.js
 */
const assert = require('assert');
const { reconcileVisitPlan } = require('../src/services/visit-plan-reconcile');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

const V = (id, label) => ({ id, label, position_ids: ['p1'] });

check('сжатый ответ модели не обнуляет разбивку из анализа', () => {
  const r = reconcileVisitPlan({
    // Модель назвала 1 заезд, анализ до этого собрал 3.
    planVisits: [V('v1', 'апрель')],
    prevPlan: { mode: 'visits', trip_count: 3, visits: [V('v1', 'апрель'), V('v2', 'октябрь'), V('v3', 'декабрь')] }
  });
  assert.strictEqual(r.visits.length, 3, 'заезды из анализа потерялись');
  assert.strictEqual(r.mode, 'visits');
  assert.strictEqual(r.trip_count, 3, 'trip_count не совпадает с числом заездов');
});

check('#2138: mode=visits, заезд один → trip_count 1, а не 5', () => {
  const r = reconcileVisitPlan({
    planVisits: [V('v1', 'один непрерывный заезд')],
    prevPlan: { mode: 'visits', trip_count: 5, visits: [V('v1', 'один непрерывный заезд')] }
  });
  assert.strictEqual(r.visits.length, 1);
  assert.strictEqual(r.trip_count, 1,
    `trip_count ${r.trip_count} при одном заезде — смета переплатит за дорогу`);
});

check('больше заездов в плане — берём план', () => {
  const r = reconcileVisitPlan({
    planVisits: [V('v1', 'а'), V('v2', 'б'), V('v3', 'в')],
    prevPlan: { mode: 'visits', trip_count: 1, visits: [V('v1', 'а')] }
  });
  assert.strictEqual(r.visits.length, 3);
  assert.strictEqual(r.trip_count, 3);
});

check('подтверждённый РП непрерывный заезд не превращается в visits', () => {
  const r = reconcileVisitPlan({
    planVisits: [V('v1', 'один непрерывный заезд')],
    prevPlan: { mode: 'continuous', trip_count: 1, visits: [V('v1', 'один непрерывный заезд')] }
  });
  assert.strictEqual(r.mode, 'continuous', 'ручное решение РП перезаписано');
  assert.strictEqual(r.trip_count, 1);
});

check('пустой план при готовом графике — график не теряется', () => {
  const r = reconcileVisitPlan({
    planVisits: [],
    prevPlan: { mode: 'visits', trip_count: 2, visits: [V('v1', 'а'), V('v2', 'б')] }
  });
  assert.strictEqual(r.visits.length, 2);
  assert.strictEqual(r.trip_count, 2);
});

check('совсем пусто — continuous и один выезд, без падения', () => {
  const r = reconcileVisitPlan({ planVisits: [], prevPlan: {} });
  assert.deepStrictEqual(r.visits, []);
  assert.strictEqual(r.trip_count, 1);
  assert.strictEqual(r.mode, 'continuous');
});

check('мусор на входе не даёт исключения', () => {
  assert.doesNotThrow(() => reconcileVisitPlan(null));
  const r = reconcileVisitPlan({ planVisits: 'x', prevPlan: 'y' });
  assert.strictEqual(r.trip_count, 1);
  assert.deepStrictEqual(r.visits, []);
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
