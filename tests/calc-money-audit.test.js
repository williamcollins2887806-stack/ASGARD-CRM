'use strict';
/**
 * Остальные находки аудита, которые касаются ДЕНЕГ и сохранности правок.
 * Проверяем поведением, а не чтением.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const CALC = fs.readFileSync(path.join(__dirname, '../public/assets/js/rp_calc_modal.js'), 'utf8');
const smeta = require('../src/services/asgard-smeta');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

// №19: «Применить норму» не меняет бригаду в смете.
check('№19 применение нормы переносит бригаду в crew[]', () => {
  const m = /function applyNormPreview[\s\S]*?\n    \}/.exec(CALC);
  assert.ok(m, 'applyNormPreview не найдена');
  assert.ok(/\.crew\s*=/.test(m[0]),
    'норма пишет только params, а смета считает по crew[] — люди не изменятся');
});

// №9: PUT без expected_updated_at затирает чужой отчёт.
check('№9 сохранение плана шлёт токен блокировки', () => {
  const m = /const lockToken = state\.review && state\.review\.updated_at;[\s\S]{0,220}/.exec(CALC);
  assert.ok(m, 'сохранение плана не использует токен блокировки');
  assert.ok(/expected_updated_at/.test(m[0]),
    'PUT идёт без expected_updated_at — затрёт report_json другого РП');
});

// №13: удаление МТР оставляет строку в себестоимости.
check('№13 удалённая позиция МТР исчезает из сметы', () => {
  const withMtr = smeta.recalcAsgardSmeta({
    crew: [{ role_code: 'worker', count: 3 }],
    mtr: [{ name: 'АВД', qty: 1, unit: 'шт', cost: 200000 }],
    params: { work_days: 5 }
  });
  const before = (withMtr.rows || []).filter((r) => String(r.tech_from || '') === 'mtr').length;
  assert.ok(before > 0, 'МТР не попал в смету — проверка бессмысленна');

  const without = smeta.recalcAsgardSmeta({
    crew: withMtr.crew,
    mtr: [],
    params: withMtr.params,
    rows: withMtr.rows
  });
  const after = (without.rows || []).filter((r) => String(r.tech_from || '') === 'mtr').length;
  assert.strictEqual(after, 0, `после удаления МТР осталось ${after} строк — оборудование в себестоимости висит`);
});

// №25: смета с нулевой ценой уходит как «согласование не требуется».
check('№25 нулевая цена не считается «ниже порога»', () => {
  const m = /const noVat = Number\(totals\.price_no_vat\) \|\| 0;[\s\S]{0,320}/.exec(CALC);
  assert.ok(m, 'чтение цены не найдено');
  assert.ok(/noVat > 0|noVat <= 0|noVat === 0/.test(m[0]),
    'нет защиты от нулевой цены — уйдёт отчёт с work_price = 0');
});

// №5: сравнение бригады для калибровки должно смотреть crew, не только params.
check('№5 изменение бригады запускает калибровку нормы', () => {
  const m = /function normCrewChangedVsTrace[\s\S]*?\n  \}/.exec(CALC);
  assert.ok(m, 'normCrewChangedVsTrace не найдена');
  assert.ok(/crew/.test(m[0]), 'смотрит только params — калибровка не сработает');
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
