'use strict';
/**
 * Ключи нормы по позиции ДВ: объём не должен уходить как длина.
 *
 * Дефект 06.11: в inputsForPosition проверка `u.includes('м')` стояла раньше,
 * чем `м³`, поэтому «200 м³» превращалось в `{length_m: 200}`. Нормы сосудов
 * ждут `volume_m3`, не находили вход и весь план (41/41 позиций) считался
 * «экспертом» вместо справочника.
 *
 * Здесь фиксируем контракт: для объёма — volume_m3/circuit_m3, для площади —
 * surface_m2, для длины — length_m, и объём никогда не попадает в длину.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

// Тестируем реальную функцию из роута, а не копию: вытаскиваем её текст.
const src = fs.readFileSync(path.join(__dirname, '../src/routes/tkp_quick.js'), 'utf8');
const m = /function inputsForPosition\(pos\) \{[\s\S]*?\n  \}/.exec(src);
assert.ok(m, 'inputsForPosition не найдена в tkp_quick.js');
// eslint-disable-next-line no-new-func
const inputsForPosition = new Function(`${m[0]}; return inputsForPosition;`)();

check('м³ → volume_m3 и circuit_m3, НЕ length_m', () => {
  const r = inputsForPosition({ unit: 'м³', volume: 200, category_code: 'vessels' });
  assert.strictEqual(r.volume_m3, 200, 'нет volume_m3: ' + JSON.stringify(r));
  assert.strictEqual(r.circuit_m3, 200, 'нет circuit_m3');
  assert.strictEqual(r.length_m, undefined, 'объём ушёл в length_m: ' + JSON.stringify(r));
});

check('м² → surface_m2, НЕ length_m', () => {
  const r = inputsForPosition({ unit: 'м²', volume: 150, category_code: 'boilers' });
  assert.strictEqual(r.surface_m2, 150);
  assert.strictEqual(r.length_m, undefined, 'площадь ушла в length_m');
});

check('м (длина) → length_m и dn_mm', () => {
  const r = inputsForPosition({ unit: 'м', volume: 80, category_code: 'pipelines' });
  assert.strictEqual(r.length_m, 80);
  assert.strictEqual(r.dn_mm, 159);
});

check('трубки → tubes + Ø + длина', () => {
  const r = inputsForPosition({ unit: 'трубки', volume: 500, category_code: 'tubes' });
  assert.strictEqual(r.tubes, 500);
  assert.strictEqual(r.diameter_mm, 25);
  assert.strictEqual(r.length_m, 6);
});

check('котёл: добавлены cycles и boilers', () => {
  const r = inputsForPosition({ unit: 'м³', volume: 2, category_code: 'boilers' });
  assert.ok(r.cycles >= 1, 'нет cycles');
  assert.ok(r.boilers >= 1, 'нет boilers');
});

check('ёмкость: добавлены manways', () => {
  const r = inputsForPosition({ unit: 'м³', volume: 200, category_code: 'vessels' });
  assert.ok(r.manways >= 1, 'нет manways');
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
