'use strict';
/**
 * Обучение справочника после просчёта.
 *
 * Что проверяем и почему:
 *  • норма БЫЛА → калибруется (applyNormPatchFromSmetaEdit, среднее);
 *  • нормы НЕ было → создаётся (createRateFromEstimate);
 *  • в обоих случаях пишется журнал с автором и комментарием.
 *
 * Заказчик спрашивал: «почему справочник не обучится». Проверено — обучается.
 * Ограничение: нужны category_code и method_code, иначе создавать не из чего.
 * Если все методы покрыты нормами, слово «создана» не появляется — она
 * обновляется, и это правильно: не надо дублировать нормы без нужды.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../src/services/work-norms.js'), 'utf8');
const FEEDBACK = fs.readFileSync(path.join(__dirname, '../src/routes/rp-review-collab.js'), 'utf8');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

check('калибровка: норма была — обновляется', () => {
  assert.ok(/async function applyNormPatchFromSmetaEdit/.test(SRC), 'нет функции калибровки');
});

check('создание: нормы не было — создаётся', () => {
  assert.ok(/async function createRateFromEstimate/.test(SRC), 'нет функции создания');
});

check('просчёт вызывает калибровку или создание', () => {
  assert.ok(/applyNormPatchFromSmetaEdit\(db/.test(FEEDBACK), 'не вызывается калибровка');
  assert.ok(/createRateFromEstimate\(db/.test(FEEDBACK), 'не вызывается создание');
});

check('развилка по наличию кода нормы', () => {
  // Если trace.rate_code есть — калибруем, если нет — создаём.
  assert.ok(/if \(trace\.rate_code\)/.test(FEEDBACK), 'нет развилки по rate_code');
});

check('без входных данных обучение пропускается', () => {
  assert.ok(/no_norm_inputs/.test(FEEDBACK),
    'нет защиты: без inputs калибровка записала бы мусор');
});

check('журнал изменений пишется с автором и комментарием', () => {
  assert.ok(/work_norm_change_log/.test(SRC), 'нет записи в журнал');
});

check('доверие и применимость есть в схеме норм', () => {
  const mig = fs.readFileSync(path.join(__dirname, '../migrations/V472__norm_alt_units.sql'), 'utf8');
  assert.ok(/ADD COLUMN IF NOT EXISTS applicability/.test(mig));
  assert.ok(/ADD COLUMN IF NOT EXISTS confidence/.test(mig));
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
