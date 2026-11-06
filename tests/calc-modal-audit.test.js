'use strict';
/**
 * Регрессия по находкам аудита модалки просчёта (06.11).
 * Проверяем ПО ФАКТУ, а не по словам: где лежит нужный код и что он делает.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const CALC = fs.readFileSync(path.join(__dirname, '../public/assets/js/rp_calc_modal.js'), 'utf8');
const TECH = fs.readFileSync(path.join(__dirname, '../public/assets/js/rp-tech-plan-ui.js'), 'utf8');
const PMDUTY = fs.readFileSync(path.join(__dirname, '../src/routes/pm-duty.js'), 'utf8');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

check('№6 бригада с role_code попадает в смету', () => {
  const sm = require('../src/services/asgard-smeta');
  const est = sm.recalcAsgardSmeta({
    crew: [{ role_code: 'worker', role: 'Слесарь', count: 8 }],
    params: { workers_per_shift: 0, masters_per_shift: 0 }
  });
  const a3 = (est.rows || []).filter((r) => String(r.section) === 'A');
  const sum = a3.reduce((s, r) => s + (Number(r.qty) || 0), 0);
  assert.ok(sum > 0, `бригада потерялась: строк A=${a3.length}, qty=${sum}`);
});

check('№11 склад читает d.equipment (бэкенд отдаёт именно это поле)', () => {
  const m = /const rows = Array\.isArray\(d\)[\s\S]{0,140}/.exec(TECH);
  assert.ok(m, 'чтение ответа склада не найдено');
  assert.ok(/d\.equipment/.test(m[0]),
    'нет d.equipment — склад будет пуст, «Взять со склада» не появится');
});

check('№12 ручная строка перечня F выживает при непустом МТР', () => {
  const sm = require('../src/services/asgard-smeta');
  const est = sm.recalcAsgardSmeta({
    crew: [{ role_code: 'worker', count: 3 }],
    mtr: [{ name: 'АВД', qty: 1, unit: 'шт', cost: 200000 }],
    rows: [{ id: 'my_own', section: 'F', name: 'Мой насос', unit: 'шт', qty: 1, price: 50000 }]
  });
  const has = (est.rows || []).some((r) => String(r.name || '').includes('Мой насос'));
  assert.ok(has, 'ручная строка перечня удалена — правка РП теряется');
});

check('№21 renderDv переживает calc_plan-массив (после «Подаём»)', () => {
  const m = /const rawPlan = rj\.calc_plan[\s\S]{0,200}/.exec(CALC);
  assert.ok(m, 'чтение calc_plan в renderDv не найдено');
  assert.ok(/Array\.isArray\(rawPlan\)/.test(m[0]),
    'renderDv не учитывает массив — сводка плана пропадёт после закрытия анализа');
});

check('№1 флаги прав мержатся из корня ответа в review', () => {
  const m = /session\.state\.review = d\.review \|\| null;[\s\S]{0,700}/.exec(CALC);
  assert.ok(m, 'присвоение review не найдено');
  for (const k of ['is_real_final_owner', 'can_finalize']) {
    assert.ok(new RegExp(k).test(m[0]), `флаг ${k} не переносится — автосейв не работает`);
  }
});

check('№4 автосейв только у реального владельца (не у директора)', () => {
  const m = /function autosaveAllowed[\s\S]*?\n    \}/.exec(CALC);
  assert.ok(m, 'autosaveAllowed не найдена');
  assert.ok(/return !!r\.is_real_final_owner;/.test(m[0]),
    'автосейв всё ещё у директора — он будет молча получать 403');
});

check('№7 план считается и без сессии анализа (запасной путь)', () => {
  assert.ok(/rp-review\/calc-plan/.test(CALC), 'фронт не вызывает запасной эндпоинт');
  assert.ok(/fastify\.post\('\/:id\/rp-review\/calc-plan'/.test(PMDUTY),
    'на бэкенде нет POST /:id/rp-review/calc-plan');
});

check('№17 «Просмотр» файла строится по filename, и filename теперь приходит', () => {
  assert.ok(/files\/preview\/' \+ encodeURIComponent\(f\.filename\)/.test(CALC),
    'просмотр не строится по filename');
  assert.ok(/original_name, filename, download_url/.test(PMDUTY),
    'бэкенд не отдаёт filename — просмотр не заработает');
});

check('№20 пустая строка МТР не исчезает при вводе', () => {
  assert.ok(/filter\(\(m\) => m\.name \|\| m\.inventory_number\)/.test(TECH),
    'фильтр выкидывает новую строку — ввести название невозможно');
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
