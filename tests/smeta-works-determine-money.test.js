'use strict';
/**
 * Объём работ определяет деньги; строки бригады согласованы; роли не теряются.
 *
 * ── История (10.11.2026, разведка по 4 фактам) ─────────────────────────────
 * Найдено численно:
 *  1. `works[]` в деньгах не участвовали: срок брался только из
 *     `params.work_days`, а `schedule.work_days` был мёртвым входом.
 *     Тендер на 6 позиций и на 600 при одной бригаде давал одну цену.
 *  2. `classifyMobileRole('Химик') === ''` → роль отбрасывалась, химик работал
 *     без строки в ФОТ.
 *  3. Строка роли никогда не удалялась: убрали химика из бригады — его деньги
 *     остались в себестоимости (cost не менялся).
 *  4. `person_shifts` включал «Подготовка на складе» и «Дни дороги» — в
 *     знаменатель KPI «прибыль на чел·смену» попадали не смены на объекте.
 */

process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test-stub';
const assert = require('assert');
const smeta = require('../src/services/asgard-smeta');

const results = [];
function check(name, fn) {
  try { fn(); results.push({ ok: true }); console.log('PASS ' + name); }
  catch (e) { results.push({ ok: false }); console.log('FAIL ' + name + ' — ' + e.message); }
}

function params(over) {
  return Object.assign({ work_days: 10, shifts_per_day: 2, shift_hours: 12 }, over || {});
}

// ── 1. Объём работ задаёт срок ─────────────────────────────────────────────
check('works задают срок и он важнее params', () => {
  const est = smeta.recalcAsgardSmeta({
    params: params({ work_days: 5 }),
    crew: [{ code: 'worker', role: 'Слесарь', count: 5 }],
    // 2 позиции × 1 бригада × 4 сут = 8 бригадо-суток, crews=1 → срок 8
    works: [{ name: 'A', people: 5, days: 4 }, { name: 'B', people: 5, days: 4 }]
  });
  assert.strictEqual(est.totals.work_days, 8, 'срок не выведен из работ: ' + est.totals.work_days);
  assert.strictEqual(est.totals.work_days_source, 'works');
  // A3 = 5 чел × 8 сут × 2 смены = 80
  assert.strictEqual(est.rows.find((r) => r.code === 'A3').qty, 80, 'A3 не пересчитан');
});

check('расхождение params vs works фиксируется, а не прячется', () => {
  const est = smeta.recalcAsgardSmeta({
    params: params({ work_days: 3 }),
    crew: [{ code: 'worker', role: 'Слесарь', count: 5 }],
    works: [{ name: 'A', people: 5, days: 6 }]
  });
  assert.ok(est.totals.work_days_conflict, 'конфликт срока не записан');
  assert.strictEqual(est.totals.work_days_conflict.params, 3);
  assert.strictEqual(est.totals.work_days_conflict.applied, 6);
});

check('без трудозатрат в works срок остаётся из params', () => {
  const est = smeta.recalcAsgardSmeta({
    params: params({ work_days: 7 }),
    crew: [{ code: 'worker', role: 'Слесарь', count: 4 }],
    works: [{ name: 'A', volume: 100, unit: 'м²' }]
  });
  assert.strictEqual(est.totals.work_days_source, 'params');
  assert.strictEqual(est.totals.work_days, 7);
});

check('больше объём → дороже (сквозной путь)', () => {
  const mk = (n) => smeta.recalcAsgardSmeta({
    params: params({ work_days: 1 }),
    crew: [{ code: 'worker', role: 'Слесарь', count: 5 }],
    works: Array.from({ length: n }, (_, i) => ({ name: 'W' + i, people: 5, days: 2 }))
  });
  const small = mk(3);
  const big = mk(30);
  assert.ok(big.totals.cost > small.totals.cost * 5,
    `себестоимость почти не выросла: ${small.totals.cost} → ${big.totals.cost}`);
});

// ── 2. Роли распознаются ───────────────────────────────────────────────────
check('химик и ПТО распознаются как роли', () => {
  assert.strictEqual(smeta.classifyMobileRole('Химик'), 'chemist');
  assert.strictEqual(smeta.classifyMobileRole('ПТО / приёмка'), 'pto');
  // «ПТО / приёмка» не должна падать в рабочего
  assert.notStrictEqual(smeta.classifyMobileRole('ПТО / приёмка'), 'worker');
});

// ── 3. Осиротевшие строки ролей удаляются ──────────────────────────────────
check('убрали роль из бригады — её строка и деньги уходят', () => {
  const withChem = smeta.recalcAsgardSmeta({
    params: params(),
    crew: [
      { code: 'worker', role: 'Слесарь', count: 4 },
      { code: 'chemist', role: 'Химик', count: 1 }
    ]
  });
  const hasChem = withChem.rows.filter((r) => r.crewRole === 'chemist');
  assert.strictEqual(hasChem.length, 1, 'строки химика нет в смете');

  // Пересчёт того же объекта без химика (строки тащим как в сохранённой смете)
  const without = smeta.recalcAsgardSmeta({
    params: params(),
    crew: [{ code: 'worker', role: 'Слесарь', count: 4 }],
    rows: withChem.rows
  });
  const left = without.rows.filter((r) => r.crewRole === 'chemist');
  assert.strictEqual(left.length, 0, 'строка химика осталась после удаления роли');
  assert.ok(without.totals.cost < withChem.totals.cost,
    `себестоимость не уменьшилась: ${withChem.totals.cost} → ${without.totals.cost}`);
});

// ── 4. person_shifts = только смены на объекте ─────────────────────────────
check('person_shifts не включает склад и дорогу', () => {
  const est = smeta.recalcAsgardSmeta({
    params: params({ work_days: 10 }),
    crew: [
      { code: 'worker', role: 'Слесарь', count: 4 },
      { code: 'master', role: 'Мастер / бригадир', count: 1 }
    ]
  });
  const crewShifts = est.rows
    .filter((r) => r.kind === 'line' && r.section === 'A' && r.tech_from === 'crew')
    .reduce((s, r) => s + Number(r.qty || 0), 0);
  assert.strictEqual(est.totals.person_shifts, crewShifts,
    `person_shifts ${est.totals.person_shifts} ≠ смен на объекте ${crewShifts}`);
  // A5 (склад) и A6 (дорога) — в «прочих», не в знаменателе
  assert.ok(est.totals.person_shifts_other > 0,
    'A5/A6 не попали в прочие — значит они всё ещё в знаменателе');
  assert.strictEqual(est.totals.person_shifts_all_a,
    est.totals.person_shifts + est.totals.person_shifts_other);
});

check('два пересчёта подряд дают тот же результат', () => {
  const once = smeta.recalcAsgardSmeta({
    params: params(),
    crew: [{ code: 'worker', role: 'Слесарь', count: 4 }],
    works: [{ name: 'A', people: 5, days: 3 }]
  });
  const twice = smeta.recalcAsgardSmeta(once);
  assert.strictEqual(twice.totals.cost, once.totals.cost, 'цена «плывёт» между пересчётами');
  assert.strictEqual(twice.totals.work_days, once.totals.work_days);
});

check('deriveWorkDaysFromWorks совпадает с формулой плана', () => {
  const works = [{ people: 12, days: 3 }, { people: 4, days: 2 }];
  const d = smeta.deriveWorkDaysFromWorks(works, { crew_size: 5, crews: 1 });
  // ceil(12/5)=3 бригады × 3 сут = 9; ceil(4/5)=1 × 2 = 2; итого 11
  assert.strictEqual(d.crew_days, 11, 'crew_days=' + d.crew_days);
  assert.strictEqual(d.work_days, 11);
  const d2 = smeta.deriveWorkDaysFromWorks(works, { crew_size: 5, crews: 2 });
  assert.strictEqual(d2.work_days, 5.5, 'две бригады должны сократить срок вдвое');
});

const failed = results.filter((r) => !r.ok);
console.log('\nитог: ' + (results.length - failed.length) + ' PASS, ' + failed.length + ' FAIL');
process.exit(failed.length ? 1 : 0);
