#!/usr/bin/env node
'use strict';
/**
 * Рантайм-проверка P2: план по РЕАЛЬНОМУ пути приходит с разрезом трудосуток,
 * и смета получает ТЕ ЖЕ трудосутки (ФОТ/проживание не уезжают).
 *
 * Без БД, без сети: normalizeCalcPlan + recalcAsgardSmeta.
 * Запуск: node tests/p2-visit-work-days.test.js
 */
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'unit-test-no-db';
process.env.DB_USER = process.env.DB_USER || 'asgard';
process.env.DB_NAME = process.env.DB_NAME || 'asgard_crm_test';

const assert = require('assert');
const st = require('../src/services/mimir-tender-stages');
const smeta = require('../src/services/asgard-smeta');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

// 3 заезда, как #2138: апрель, октябрь, декабрь. MH распределён по заездам
// неравномерно — именно так и бывает в жизни.
const VISITS = [
  { id: 'v1', label: 'апрель', position_ids: ['a'], period_start: '2027-04-01', period_end: '2027-04-30' },
  { id: 'v2', label: 'октябрь', position_ids: ['b'], period_start: '2027-10-01', period_end: '2027-10-31' },
  { id: 'v3', label: 'декабрь', position_ids: ['c'], period_start: '2027-12-01', period_end: '2027-12-20' }
];
const POSITIONS = [
  { id: 'a', name: 'ТО-1', mh: 60000, people: 5, days: 10, shifts: 1, shift_hours: 12, source: 'norm' },
  { id: 'b', name: 'ТО-2', mh: 30000, people: 5, days: 5, shifts: 1, shift_hours: 12, source: 'norm' },
  { id: 'c', name: 'ТО-3', mh: 10000, people: 5, days: 2, shifts: 1, shift_hours: 12, source: 'norm' }
];

function buildPlan() {
  return st.normalizeCalcPlan(
    { positions: POSITIONS, trip_count: 3, visits: VISITS },
    { visit_mode: 'visits', trip_count: 3, dv_positions: POSITIONS }
  );
}

check('P2: план отдаёт разрез по заездам и он сходится с work_days', () => {
  const plan = buildPlan();
  assert.ok(Array.isArray(plan.visits_work), 'visits_work отсутствует');
  assert.strictEqual(plan.visits_work.length, 3, 'заездов не 3');
  assert.strictEqual(plan.visits_work_total, plan.work_days,
    `Σ разрез ${plan.visits_work_total} != work_days ${plan.work_days}`);
});

check('P2: доля заезда соответствует его человеко-часам (60/30/10 тыс.)', () => {
  const plan = buildPlan();
  const [v1, v2, v3] = plan.visits_work;
  assert.strictEqual(v1.share_pct, 60, 'апрель — 60 % объёма');
  assert.strictEqual(v2.share_pct, 30, 'октябрь — 30 %');
  assert.strictEqual(v3.share_pct, 10, 'декабрь — 10 %');
  // И трудосутки упорядочены так же (у последнего — остаток от округления).
  assert.ok(v1.work_days > v2.work_days, 'апрель длиннее октября');
  assert.ok(v2.work_days > v3.work_days, 'октябрь длиннее декабря');
});

check('P2: work_days НЕ изменился — смета получает те же трудосутки', () => {
  const plan = buildPlan();
  const est = smeta.recalcAsgardSmeta({
    template: 'asgard_v1',
    crew: plan.crew,
    params: {
      work_days: plan.work_days,
      shifts_per_day: plan.work_days_source === 'mh_invariant' ? 1 : (plan.shifts_per_day || 1),
      shift_hours: plan.shift_hours || 12,
      trip_count: plan.trip_count || 1,
      calc_formula_version: 2
    },
    works: []
  });
  // Трудосутки на объекте — знаменатель ФОТ. Их нельзя заменить «суммой
  // заездов»: при том же C это то же число, а при другом — смета развалится.
  assert.strictEqual(est.params.work_days, plan.work_days);
  assert.ok(est.totals.fot > 0, 'ФОТ посчитан');
  // Количество смен в смете = трудосутки × смены × люди — инвариант MH.
  const shifts = est.totals.person_shifts;
  assert.ok(shifts > 0, 'чел·смены есть');
});

check('P2: смета одинаково считает при 1 и 3 заездах (дорога/проживание — отдельно)', () => {
  const mk = (trips) => {
    const plan = st.normalizeCalcPlan(
      { positions: POSITIONS, trip_count: trips, visits: trips > 1 ? VISITS : [] },
      { visit_mode: trips > 1 ? 'visits' : 'continuous', trip_count: trips, dv_positions: POSITIONS }
    );
    const est = smeta.recalcAsgardSmeta({
      template: 'asgard_v1',
      crew: plan.crew,
      params: {
        work_days: plan.work_days,
        shifts_per_day: plan.work_days_source === 'mh_invariant' ? 1 : 1,
        shift_hours: plan.shift_hours || 12,
        trip_count: plan.trip_count || 1,
        calc_formula_version: 2
      },
      works: []
    });
    const row = (id) => est.rows.find((r) => r.id === id) || {};
    return { plan, est, row };
  };
  const one = mk(1);
  const three = mk(3);

  // Работа на объекте: смены рабочих/мастера зависят от трудосуток, а НЕ от
  // числа выездов. Если они поехали — значит срок или состав подменились.
  assert.strictEqual(three.row('a3').qty, one.row('a3').qty, 'смены рабочих уехали от числа выездов');
  assert.strictEqual(three.row('a2').qty, one.row('a2').qty, 'смены мастера уехали');
  assert.strictEqual(three.row('a1').qty, one.row('a1').qty, 'сутки ИТР уехали');

  // А дорога и командировочные — законно растут: каждый выезд везёт бригаду.
  assert.ok(three.row('a6').qty > one.row('a6').qty, 'дни дороги не выросли при 3 заездах');
  assert.ok(three.est.totals.travel > one.est.totals.travel,
    'проживание/пайковые не выросли при 3 заездах');
});

check('P2: окно проверяется по каждому заезду', () => {
  const plan = buildPlan();
  const checks = plan.visit_window_check;
  assert.strictEqual(checks.length, 3, 'проверок не 3');
  // Декабрь короткий (20 дней) и объём мал — должен пройти.
  const dec = checks.find((c) => c.label === 'декабрь');
  assert.ok(dec, 'нет проверки декабря');
  assert.strictEqual(dec.checked, true, 'окно декабря не проверено');
  assert.ok(/влезает/.test(dec.message), dec.message);
});

check('P2: неразмеченные заезды — равные доли, не ноль', () => {
  const plan = st.normalizeCalcPlan(
    {
      positions: POSITIONS,
      trip_count: 3,
      visits: [{ id: 'v1', label: 'а' }, { id: 'v2', label: 'б' }, { id: 'v3', label: 'в' }]
    },
    { visit_mode: 'visits', trip_count: 3 }
  );
  assert.strictEqual(plan.visits_work_total, plan.work_days);
  assert.ok(plan.visits_work.every((v) => Number(v.work_days) > 0), 'есть нулевые заезды');
});

check('P2: без заездов разрез пуст и ничего не выдумано', () => {
  const plan = st.normalizeCalcPlan(
    { positions: POSITIONS },
    { visit_mode: 'continuous', trip_count: 1 }
  );
  assert.deepStrictEqual(plan.visits_work, []);
  assert.strictEqual(plan.visits_work_total, null);
  assert.ok(plan.work_days > 0, 'срок при этом есть');
});

check('P2: work_days_per_trip — от трудосуток, а не от бригадо-суток', () => {
  const plan = buildPlan();
  assert.ok(plan.work_days_per_trip != null, 'work_days_per_trip пуст');
  assert.strictEqual(plan.work_days_per_trip, Math.round((plan.work_days / 3) * 100) / 100,
    'доля на заезд считается не от work_days');
  // И это НЕ crew_days / crews / trips (старая формула давала другое число).
  const crewPerTrip = Math.round((plan.total_crew_days / plan.crews / 3) * 100) / 100;
  assert.notStrictEqual(plan.work_days_per_trip, crewPerTrip,
    'work_days_per_trip всё ещё считается от бригадо-суток');
});

// ── Частичная разметка: найдено на проде #2138 ──────────────────────────────
check('P2: частичная разметка — доли считаются от РАЗМЕЧЕННЫХ часов, не от всего MH', () => {
  // На #2138 к заезду привязано 146 позиций из 675. Если делить на весь MH,
  // единственный заезд получал 24 % при 407 трудосутках итога — и карточка
  // показывала «407 трудосуток, доля 24%», что противоречит само себе.
  const plan = st.normalizeCalcPlan(
    {
      positions: [
        { id: 'a', name: 'А', mh: 40000, people: 5, days: 5, shifts: 1, shift_hours: 12 },
        { id: 'b', name: 'Б', mh: 60000, people: 5, days: 5, shifts: 1, shift_hours: 12 }
      ],
      trip_count: 1,
      visits: [{ id: 'v1', label: 'апрель', position_ids: ['a'] }]
    },
    { visit_mode: 'visits', trip_count: 1 }
  );
  assert.strictEqual(plan.visits_work.length, 1);
  // Размечено 40 000 из 100 000 — но заезд единственный, значит его доля 100 %.
  assert.strictEqual(plan.visits_work[0].share_pct, 100,
    'доля заезда считается от всего MH, а не от размеченного');
  assert.strictEqual(plan.visits_work_total, plan.work_days, 'разрез не сошёлся с итогом');
});

check('P2: trip_count и число заездов не расходятся', () => {
  // Реальный дефект #2138: mode=visits, trip_count=5, visits=1. Смета считала
  // дорогу и проживание за 5 приездов, а график показывал один.
  const plan = st.normalizeCalcPlan(
    { positions: POSITIONS, trip_count: 5, visits: [VISITS[0]] },
    { visit_mode: 'visits', trip_count: 5, dv_positions: POSITIONS }
  );
  assert.strictEqual(plan.trip_count, 1,
    `trip_count ${plan.trip_count} при ${plan.visits.length} заезде — смета переплатит за дорогу`);
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
