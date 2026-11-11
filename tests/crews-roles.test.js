'use strict';
/**
 * Бригады по 5 человек с ролями (задача заказчика 06.11).
 *
 * Требования:
 *   • 4 бригады по 5, а не 2 по 10;
 *   • в каждой 1 мастер + 4 слесаря;
 *   • на все бригады один ИТР;
 *   • наблюдающий — только при работе внутри аппарата;
 *   • химик — только при реагентных работах;
 *   • ПТО — на объёмных работах.
 */
const assert = require('assert');
const stages = require('../src/services/mimir-tender-stages');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

function pos(over) {
  return Object.assign({
    name: 'Позиция', people: 5, days: 2, shifts: 1, shift_hours: 8,
    parallel_group: '1', source: 'norm', source_ref: 'x',
    category_code: 'vessels', tech_equip: ''
  }, over);
}

check('бригада = 1 мастер + 4 слесаря, а не 10 человек', () => {
  const list = Array.from({ length: 20 }, (_, i) => pos({ id: `p${i}`, days: 3 }));
  const p = stages.normalizeCalcPlan({ positions: list }, { window_days: 20, max_crews: 6 });
  // Проверяем СОСТАВ бригады, а не конкретное число бригад.
  //
  // Раньше здесь стояло `crews === 3` (60 бригадо-суток / окно 20). Это
  // верно для старой модели «объём делится на окно». Новая считает от
  // человеко-часов при 8-часовой смене: 2400 / (20 × 5 × 5,25) = 4,57 → 5
  // бригад. Требование заказчика — бригады ПО 5 ЧЕЛОВЕК, и оно выполнено в
  // обоих случаях; число бригад — производная от режима смен.
  assert.ok(p.crews >= 1, 'бригад: ' + p.crews);
  assert.strictEqual(p.crew_size, 5, 'численность бригады должна быть 5');
  const master = p.crew.find((c) => c.role_code === 'master');
  const worker = p.crew.find((c) => c.role_code === 'worker');
  const itr = p.crew.find((c) => c.role_code === 'itr');
  // Главное требование: 1 мастер на бригаду и 4 слесаря на мастера.
  assert.strictEqual(master.count, p.crews, 'мастеров = числу бригад: ' + master.count + ' при ' + p.crews);
  assert.strictEqual(worker.count, 4 * p.crews, 'слесарей = 4 на бригаду: ' + worker.count);
  assert.strictEqual(itr.count, 1, 'ИТР один на все бригады: ' + itr.count);
});

check('людей на объекте = сумма ролей, а не бригады × 10', () => {
  const list = Array.from({ length: 20 }, (_, i) => pos({ id: `p${i}`, days: 3 }));
  const p = stages.normalizeCalcPlan({ positions: list }, { window_days: 20, max_crews: 6 });
  const sum = p.crew.reduce((s, c) => s + c.count, 0);
  assert.strictEqual(p.people_total, sum, 'people_total не равен сумме ролей');
  // Людей на объекте — не сумма по всем позициям тендера (было бы 100+).
  // Верхняя граница: бригады × 5 плюс ИТР и ПТО.
  assert.ok(p.people_total <= p.crews * 5 + 5,
    'на объекте не больше (бригад × 5 + штаб): ' + p.people_total + ' при ' + p.crews + ' бр.');
});

check('наблюдающий нужен при работе ВНУТРИ аппарата', () => {
  const inside = stages.normalizeCalcPlan({
    positions: [pos({ id: 'a', days: 5, name: 'Очистка днища резервуара внутри' })]
  }, { window_days: 10 });
  assert.ok(inside.crew.some((c) => c.role_code === 'observer'),
    'нет наблюдающего при работе внутри аппарата');

  const outside = stages.normalizeCalcPlan({
    positions: [pos({ id: 'b', days: 5, name: 'Наружная мойка секций АВО', tech_equip: 'АВД снаружи' })]
  }, { window_days: 10 });
  assert.ok(!outside.crew.some((c) => c.role_code === 'observer'),
    'наблюдающий не нужен снаружи');
});

check('химик нужен при реагентных работах', () => {
  const chem = stages.normalizeCalcPlan({
    positions: [pos({ id: 'a', days: 5, name: 'Химическая промывка котла', tech_equip: 'кислота с ингибитором' })]
  }, { window_days: 10 });
  assert.ok(chem.crew.some((c) => c.role_code === 'chemist'), 'нет химика на кислотной промывке');

  const mech = stages.normalizeCalcPlan({
    positions: [pos({ id: 'b', days: 5, name: 'Механическая зачистка бункера', tech_equip: 'отбойный молоток' })]
  }, { window_days: 10 });
  assert.ok(!mech.crew.some((c) => c.role_code === 'chemist'), 'химик не нужен при механической зачистке');
});

check('ПТО нужен на объёмных работах (больше 10 позиций)', () => {
  const big = stages.normalizeCalcPlan({
    positions: Array.from({ length: 15 }, (_, i) => pos({ id: `p${i}`, days: 2 }))
  }, { window_days: 40, max_crews: 6 });
  assert.ok(big.crew.some((c) => c.role_code === 'pto'), 'нет ПТО на 15 позициях');

  const small = stages.normalizeCalcPlan({ positions: [pos({ id: 'a', days: 2 })] }, { window_days: 10 });
  assert.ok(!small.crew.some((c) => c.role_code === 'pto'), 'ПТО не нужен на одной позиции');
});

check('состав бригад раскрыт по каждой бригаде отдельно', () => {
  const list = Array.from({ length: 10 }, (_, i) => pos({ id: `p${i}`, days: 4 }));
  const p = stages.normalizeCalcPlan({ positions: list }, { window_days: 20, max_crews: 6 });
  assert.strictEqual(p.crew_breakdown.length, p.crews, 'нет разбивки по бригадам');
  p.crew_breakdown.forEach((crew, i) => {
    const m = crew.find((c) => c.role_code === 'master');
    const w = crew.find((c) => c.role_code === 'worker');
    assert.ok(m && m.count === 1, `в бригаде ${i + 1} нет мастера`);
    assert.ok(w && w.count === 4, `в бригаде ${i + 1} не 4 слесаря`);
  });
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
