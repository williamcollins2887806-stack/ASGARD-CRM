'use strict';
/**
 * Срок работ из ТЗ: найти, не выдумать, и заставить РП заполнить руками,
 * если не нашли. Задача заказчика от 06.11.
 */
const assert = require('assert');
const { extractSchedule, extractMode, kindOf } = require('../src/services/schedule-extract');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

check('срок выполнения работ в днях', () => {
  const r = extractSchedule('Срок выполнения работ: 45 календарных дней с даты подписания договора.');
  assert.strictEqual(r.found, true);
  assert.strictEqual(r.days, 45);
});

check('срок в месяцах приводится к дням', () => {
  const r = extractSchedule('Продолжительность работ — 1 (один) месяц.');
  assert.strictEqual(r.found, true);
  assert.strictEqual(r.days, 30);
});

check('срок в году приводится к дням', () => {
  const r = extractSchedule('Срок оказания услуг: 1 год.');
  assert.strictEqual(r.found, true);
  assert.strictEqual(r.days, 365);
});

check('«в течение 20 рабочих дней» находится', () => {
  const r = extractSchedule('Исполнитель обязуется выполнить работы в течение 20 дней.');
  assert.strictEqual(r.found, true);
  assert.strictEqual(r.days, 20);
});

check('срок ПОДАЧИ заявки не путается со сроком работ', () => {
  const r = extractSchedule('Окончание приема заявок: 15 дней до даты вскрытия. Срок выполнения работ не указан.');
  assert.strictEqual(r.found, false, 'приняли срок подачи заявки за срок работ: ' + JSON.stringify(r));
});

check('график диапазоном дат считается', () => {
  const r = extractSchedule('График работ: 01.06.2026 - 30.06.2026. Объект — котельная.');
  assert.strictEqual(r.found, true);
  assert.strictEqual(r.days, 29);
});

check('нет срока — found: false, ничего не выдумано', () => {
  const r = extractSchedule('Очистка теплообменника. Объём — 120 пластин. Работы по заявке.');
  assert.strictEqual(r.found, false);
  assert.strictEqual(r.days, null);
});

check('режим «остановочный ремонт» распознаётся', () => {
  assert.strictEqual(extractMode('Работы выполняются во время остановочного ремонта.'), 'stop');
});

check('режим «круглосуточно» распознаётся', () => {
  assert.strictEqual(extractMode('Работы ведутся круглосуточно, без остановки производства.'), 'around');
});

check('масштаб работ: месяц / квартал / год', () => {
  assert.strictEqual(kindOf(20), 'месяц');
  assert.strictEqual(kindOf(60), 'квартал');
  assert.strictEqual(kindOf(300), 'год');
  assert.strictEqual(kindOf(400), 'больше_года');
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
