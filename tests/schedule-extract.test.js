'use strict';
/**
 * Срок работ из текста ТЗ.
 *
 * Дефекты, найденные на прогоне очереди 06.11.2026:
 *   1. Тендер 2131 («чистка на 2027 год») дал срок 739 855 суток —
 *      календарный год принят за длительность (2027 × 365).
 *   2. «Срок гарантии 12 месяцев, срок выполнения работ 60 дней» давал
 *      null: запретное слово «гарантии» стояло до правильного числа.
 *   3. График «01.06–30.06» давал 29 дней вместо 30.
 */
const assert = require('assert');
const { extractSchedule, toDays, kindOf } = require('../src/services/schedule-extract');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

const CASES = [
  // [текст, ожидаемые дни]
  ['Срок выполнения работ: 45 календарных дней', 45],
  ['Срок выполнения работ - 30 суток', 30],
  ['Продолжительность работ 90 календарных дней', 90],
  ['Срок оказания услуг 1 (один) месяц', 30],
  ['Срок выполнения работ 12 месяцев', 360],
  ['Работы в течение 30 дней с даты заключения договора', 30],
  ['Гарантия 12 месяцев. Срок выполнения работ 45 дней', 45],
  ['Срок гарантии 12 месяцев, срок выполнения работ 60 дней', 60],
  ['Срок выполнения работ 30 дней. Гарантия 24 месяца', 30],
  ['Срок выполнения работ: 01.06.2027 - 30.06.2027', 30],
  // Не срок работ:
  ['Гарантийный срок 24 месяца', null],
  ['Срок подачи заявки 5 дней', null],
  ['Тендер на 2027-2029 гг. Работы в 2027 году', null],
  ['Цена работ 5 000 000 руб., срок оплаты 30 дней', null]
];

check('сроки извлекаются верно', () => {
  for (const [text, expected] of CASES) {
    const got = extractSchedule(text).days;
    assert.strictEqual(got, expected, `«${text}» → ${got}, ожидалось ${expected}`);
  }
});

check('календарный год не считается сроком', () => {
  // Тендер 2131: «чистка на 2027 год» дала 739 855 суток.
  const r = extractSchedule('Чистка оборудования на 2027 год. Работы в 2027 году.');
  assert.notStrictEqual(r.days, 739855, 'год снова стал длительностью');
  assert.strictEqual(r.days, null, 'период работ принят за срок: ' + r.days);
});

check('огромная длительность не проходит как год', () => {
  assert.strictEqual(toDays(2027, 'лет'), null, '2027 «лет» должно отсекаться');
  assert.strictEqual(toDays(3, 'года'), 1095, '3 года — законный срок');
});

check('режим работ определяется', () => {
  assert.strictEqual(extractSchedule('Работы в период остановочного ремонта, 20 дней').mode, 'stop');
  assert.strictEqual(extractSchedule('Работы круглосуточно, 15 дней').mode, 'around');
  assert.strictEqual(extractSchedule('Свободный график по согласованию с заказчиком, 10 дней').mode, 'free');
});

check('масштаб работ человеку понятен', () => {
  assert.strictEqual(kindOf(1), 'дни');
  assert.strictEqual(kindOf(3), 'до_двух_недель');
  assert.strictEqual(kindOf(30), 'месяц');
  assert.strictEqual(kindOf(90), 'квартал');
  assert.strictEqual(kindOf(365), 'год');
});

check('пустой текст не падает', () => {
  assert.strictEqual(extractSchedule('').found, false);
  assert.strictEqual(extractSchedule(null).found, false);
});

check('найденный срок отдаёт цитату для сверки', () => {
  const r = extractSchedule('Срок выполнения работ: 45 календарных дней');
  assert.ok(r.raw && /45/.test(r.raw), 'нет цитаты: ' + JSON.stringify(r));
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
