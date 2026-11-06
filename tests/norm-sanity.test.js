'use strict';
/**
 * Детерминированная защита от абсурдного расчёта.
 * Не зависит от модели: проверяет физику и применимость нормы.
 */
const assert = require('assert');
const { checkSane, checkApplicability, RATIO_LIMIT } = require('../src/services/norm-sanity');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

// ── Проверка на абсурд ─────────────────────────────────────────────────────

check('нормальный расчёт не поднимает тревогу', () => {
  // 87,5 м³ отложений, 0,25 чел·ч/м³, 5 человек, 12 ч, 2 смены.
  // Чел·ч = 21,9; сутки = 21,9 / (5 × 2 × 12) = 0,18 → 1 сутки.
  const r = checkSane({ workDays: 1, volumeM3: 87.5, people: 5, shiftHours: 12, shiftsPerDay: 2, mhPerM3: 0.25 });
  assert.strictEqual(r.suspicious, false, 'не должно быть подозрения: ' + r.message);
});

check('перепутали м² и м³ — тревога', () => {
  // Взяли 1750 м³ вместо 87,5 м³: срок будет в 20 раз больше ожидаемого.
  // Норма 0,25 чел·ч/м³, 5 человек, 12 ч, 2 смены.
  // Правильно для 87,5 м³: 1 сутки. Расчёт даёт 20 суток.
  const r = checkSane({ workDays: 20, volumeM3: 87.5, people: 5, shiftHours: 12, shiftsPerDay: 2, mhPerM3: 0.25 });
  assert.strictEqual(r.suspicious, true, 'должно быть подозрение');
  assert.ok(r.ratio >= 3, 'расхождение должно быть > 3 раз: ' + r.ratio);
  assert.ok(/единицу измерения/.test(r.message), 'сообщение должно подсказывать про единицу');
});

check('норма занижает вдвое-втрое — тоже тревога', () => {
  const r = checkSane({ workDays: 1, volumeM3: 500, people: 5, shiftHours: 12, shiftsPerDay: 2, mhPerM3: 0.5 });
  // ожидается: 250 / 120 = 2,08 → 3 суток. Расчёт 1 сутки. Расхождение 3.
  assert.strictEqual(r.suspicious, true, 'в 3 раза — уже повод проверить');
});

check('без удельной трудоёмкости проверка не выдумывает', () => {
  const r = checkSane({ workDays: 10, volumeM3: 100, people: 5, mhPerM3: null });
  assert.strictEqual(r.suspicious, false);
  assert.strictEqual(r.expected_days, null, 'независимой оценки нет — и не должно быть');
});

check('нулевой объём — проверка пропускается', () => {
  const r = checkSane({ workDays: 5, volumeM3: 0, people: 5, mhPerM3: 0.25 });
  assert.strictEqual(r.suspicious, false);
});

// ── Применимость нормы ─────────────────────────────────────────────────────

check('объект в диапазоне — норма применима', () => {
  const r = checkApplicability({ min_value: 1000, max_value: 50000, value_field: 'volume_m3' }, { value: 5000 });
  assert.strictEqual(r.ok, true);
});

check('РВС-1000 вне диапазона Ø20–25 м — предупреждение', () => {
  // Норма для больших резервуаров, объект маленький.
  const r = checkApplicability({ min_value: 10000 }, { value: 1000 });
  assert.strictEqual(r.ok, false);
  assert.ok(/вне диапазона/.test(r.reason), 'должно сказать про диапазон');
});

check('слишком большой объект — тоже предупреждение', () => {
  const r = checkApplicability({ max_value: 5000 }, { value: 50000 });
  assert.strictEqual(r.ok, false);
});

check('не тот тип отложений — предупреждение', () => {
  const r = checkApplicability({ fouling: ['light', 'medium'] }, { value: 1000, fouling: 'heavy' });
  assert.strictEqual(r.ok, false);
  assert.ok(/отложений/.test(r.reason), 'должно сказать про тип отложений');
});

check('пустая применимость — без ограничений', () => {
  const r = checkApplicability({}, { value: 999999 });
  assert.strictEqual(r.ok, true);
});

check('порог расхождения — 3 раза', () => {
  assert.strictEqual(RATIO_LIMIT, 3);
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
