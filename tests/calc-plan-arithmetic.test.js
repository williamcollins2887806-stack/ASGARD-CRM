'use strict';
/**
 * План просчёта: бригады, срок и люди считаются без вранья.
 *
 * Что было не так 06.11:
 *  1) 34 позиции в одной группе дали «3 суток силами 102 человек» — люди
 *     суммировались по всем позициям, а группа трактовалась как «одновременно».
 *  2) 41 позиция в 5 группах дала 184 суток, хотя заказчик ждал уложиться
 *     в свой график — число бригад не подбиралось под окно дат.
 *
 * Модель, которую фиксируем:
 *   • все позиции делятся между бригадами, бригады работают параллельно;
 *   • бригад подбирается столько, чтобы уложиться в срок заказчика;
 *   • срок = сумма суток / число бригад;
 *   • людей на объекте = бригады × численность бригады, а не сумма по позициям;
 *   • не влезли в окно даже на максимуме бригад — честное предупреждение.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const stages = require('../src/services/mimir-tender-stages');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

function pos(over) {
  return Object.assign({
    name: 'Позиция', people: 3, days: 1, shifts: 1, shift_hours: 8,
    parallel_group: '1', source: 'norm', source_ref: 'r1'
  }, over);
}

check('34 позиции по 0.5 сут: порог 30 бригадо-суток → одна бригада', () => {
  const list = Array.from({ length: 34 }, (_, i) => pos({ id: `c${i}`, days: 0.5, people: 3 }));
  const p = stages.normalizeCalcPlan({ positions: list }, { max_parallel_posts: 2, max_crews: 3 });
  // 34 × 0.5 = 17 бригадо-суток < 30, окна дат нет → одна бригада.
  assert.strictEqual(p.total_crew_days, 17, 'сумма трудозатрат: ' + p.total_crew_days);
  assert.strictEqual(p.crews, 1, 'на 17 бригадо-сутках хватает одной бригады: ' + p.crews);
  assert.strictEqual(p.work_days, 17, 'срок = 17 / 1: ' + p.work_days);
  assert.strictEqual(p.people_total, 3, 'на объекте одна бригада из 3, а не 102: ' + p.people_total);
});

check('34 позиции по 3 сут: 102 бригадо-суток → 3 бригады', () => {
  const list = Array.from({ length: 34 }, (_, i) => pos({ id: `c${i}`, days: 3, people: 3 }));
  const p = stages.normalizeCalcPlan({ positions: list }, { max_crews: 3 });
  assert.strictEqual(p.total_crew_days, 102);
  assert.strictEqual(p.crews, 3, '102 > 90 → максимум бригад: ' + p.crews);
  assert.strictEqual(p.work_days, 34, 'срок = 102 / 3: ' + p.work_days);
  assert.strictEqual(p.people_total, 9, '3 бригады × 3 чел = 9: ' + p.people_total);
});

check('люди НЕ суммируются по всем позициям тендера', () => {
  const list = Array.from({ length: 40 }, (_, i) => pos({ id: `p${i}`, days: 1, people: 5 }));
  const p = stages.normalizeCalcPlan({ positions: list }, { max_crews: 3 });
  assert.ok(p.people_total <= 5 * 3, 'пик не больше трёх бригад по 5 человек: ' + p.people_total);
  assert.ok(p.people_total < 200, 'старый дефект 200 человек не вернулся');
});

check('окно дат: бригад подбирается столько, чтобы уложиться в срок', () => {
  // 41 позиция, по 5 сут = 205 бригадо-суток. Окно 60 сут при 4 бригадах max.
  const list = Array.from({ length: 41 }, (_, i) => pos({ id: `p${i}`, days: 5, people: 4 }));
  const p = stages.normalizeCalcPlan({ positions: list }, { window_days: 60, max_crews: 4 });
  assert.strictEqual(p.total_crew_days, 205);
  assert.strictEqual(p.crews, 4, 'нужно 4 бригады (205/60 = 3.4 → 4): ' + p.crews);
  assert.strictEqual(p.work_days, 51.25, 'срок = 205 / 4: ' + p.work_days);
  assert.strictEqual(p.fits_window, true, 'должны уложиться в 60 сут');
  assert.strictEqual(p.people_total, 16, '4 бригады × 4 чел = 16: ' + p.people_total);
});

check('не влезли в окно даже на максимуме — честное предупреждение', () => {
  // 100 суток работ, окно 10, максимум 3 бригады → 33.3 сут > 10.
  const list = [pos({ id: 'a', days: 100, people: 4 })];
  const p = stages.normalizeCalcPlan({ positions: list }, { window_days: 10, max_crews: 3 });
  assert.strictEqual(p.fits_window, false, 'должно быть false');
  assert.ok(p.warnings.some((w) => /не укладывается/.test(w)), 'нет предупреждения о сроке');
  assert.ok(p.work_days > 10, 'срок не подгоняется под окно');
});

check('без окна дат — предупреждение, что график не проверен', () => {
  const list = [pos({ id: 'a', days: 5, people: 4 })];
  const p = stages.normalizeCalcPlan({ positions: list }, {});
  assert.ok(p.warnings.some((w) => /срок заказчика не задан/.test(w)), 'нет предупреждения об окне');
});

check('одна бригада на малом объёме не размножается', () => {
  const list = [pos({ id: 'a', days: 2, people: 4 }), pos({ id: 'b', days: 3, people: 4 })];
  const p = stages.normalizeCalcPlan({ positions: list }, { max_crews: 3 });
  assert.strictEqual(p.crews, 1, 'на 5 сутках достаточно одной бригады: ' + p.crews);
  assert.strictEqual(p.work_days, 5);
  assert.strictEqual(p.people_total, 4);
});

check('промпт объясняет, что бригад 2–3 и надо уложиться в график', () => {
  const md = fs.readFileSync(path.join(__dirname, '../templates/prompts/PROMPT-calc-plan-v1.md'), 'utf8');
  assert.ok(/бригада \(пост\)/.test(md), 'промпт не объясняет смысл parallel_group');
  assert.ok(/уложиться|график/i.test(md), 'промпт не требует уложиться в график заказчика');
  assert.ok(/не сваливай всё в «1»/.test(md), 'промпт не запрещает сваливать всё в одну группу');
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
