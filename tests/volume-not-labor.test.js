'use strict';
/**
 * Отсечение трудоёмкости в поле объёма.
 *
 * Дефект 06.11 (тендер 2143, Hi Pro): модель положила в volume трудоёмкость
 * «50 чел·ч» вместо объёма работ. Такая позиция считалась как «50 единиц
 * работ» — расчёт умножал трудозатраты на 50 и давал бессмысленный срок.
 *
 * Объём — это количество работ (м³, м², п.м, трубки, шт).
 * Трудоёмкость (чел·ч, чел·смены) калькулятор считает сам по норме.
 */
const assert = require('assert');
const st = require('../src/services/mimir-tender-stages');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

const catalog = {
  categories: [
    { code: 'vessels', title: 'Ёмкости', methods_json: [{ code: 'clean', label: 'Зачистка' }] },
    { code: 'tubes', title: 'Трубные пучки', methods_json: [{ code: 'gdo', label: 'ГДО' }] }
  ]
};

function norm(over) {
  const dv = st.normalizeDv({
    positions: [Object.assign({
      name: 'Позиция', category_code: 'vessels', method_code: 'clean', volume: 100, unit: 'м³'
    }, over)]
  }, catalog);
  return dv.positions[0];
}

check('чел·ч в объёме — обнуляется и помечается проблемой', () => {
  const p = norm({ volume: 50, unit: 'чел·ч' });
  assert.strictEqual(p.volume, null, 'трудоёмкость осталась в объёме: ' + p.volume);
  assert.strictEqual(p.measured_value, null, 'measured_value тоже должен быть пуст');
  assert.ok(p.problems.some((x) => /трудоёмкость/.test(x)),
    'нет пометки, что это трудоёмкость: ' + JSON.stringify(p.problems));
});

check('чел·смены в объёме — тоже отсекаются', () => {
  const p = norm({ volume: 12, unit: 'чел·смен' });
  assert.strictEqual(p.volume, null);
});

check('нормальный объём не задет', () => {
  const p = norm({ volume: 200, unit: 'м³' });
  assert.strictEqual(p.volume, 200);
  assert.strictEqual(p.problems.length, 0, 'лишние проблемы: ' + JSON.stringify(p.problems));
});

check('погонные метры для трубок проходят как объём', () => {
  const p = norm({ category_code: 'tubes', method_code: 'gdo', volume: 102516, unit: 'п.м' });
  assert.strictEqual(p.volume, 102516, 'п.м должен остаться объёмом');
  assert.ok(!p.problems.some((x) => /трудоёмкость/.test(x)));
});

check('промпт запрещает писать трудоёмкость в volume', () => {
  const fs = require('fs');
  const path = require('path');
  const md = fs.readFileSync(path.join(__dirname, '../templates/prompts/PROMPT-dv-v1.md'), 'utf8');
  assert.ok(/объём работ, а не трудоёмкость/.test(md), 'промпт не предупреждает про подмену');
  assert.ok(/length_m/.test(md), 'промпт не просит длину трубки');
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
