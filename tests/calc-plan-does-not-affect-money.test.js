'use strict';
/**
 * От чего зависят ДЕНЬГИ в смете: от объёма работ или ни от чего.
 *
 * ── История ────────────────────────────────────────────────────────────────
 * Раньше этот тест утверждал, что «движок сметы не знает про объём работ» —
 * то есть фиксировал дефект как норму. На проде это вылилось в 10 просчётов,
 * где тендер на 600 позиций и тендер на 6 позиций при одной бригаде давали
 * одну цену.
 *
 * Теперь канон другой:
 *   • срок = человеко-сутки / людей на объекте, то есть объём работ;
 *   • себестоимость = роли × срок × ставки + накладные + непредвиденные;
 *   • перечень работ (`works[]`) приходит из ведомости и задаёт срок;
 *   • `asgard_smeta` остаётся единственным источником денег — второй сметы
 *     из `calc_plan` не строится, работы передаются как вход `works[]`.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CALC = fs.readFileSync(path.join(ROOT, 'public/assets/js/rp_calc_modal.js'), 'utf8');
const SRC = fs.readFileSync(path.join(ROOT, 'src/services/asgard-smeta.js'), 'utf8');
const PM_DUTY = fs.readFileSync(path.join(ROOT, 'src/routes/pm-duty.js'), 'utf8');
const smeta = require('../src/services/asgard-smeta');

let fail = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) fail += 1;
}

// 1. Движок принимает объём работ отдельным входом.
const recalcStart = SRC.indexOf('function recalcAsgardSmeta');
const recalcBody = SRC.slice(recalcStart, recalcStart + 3600);
const engineInputs = ['est.rows', 'est.crew', 'est.mtr', 'est.schedule', 'est.works'];
const missing = engineInputs.filter((k) => !new RegExp(k.replace('.', '\\.') + '\\b').test(recalcBody));
check('движок сметы берёт строки, бригаду, МТР, сроки, параметры и работы',
  recalcStart >= 0 && missing.length === 0,
  missing.length ? 'не найдено в recalcAsgardSmeta: ' + missing.join(', ') : 'все входы на месте');

// 2. Объём работ реально меняет себестоимость.
const base = {
  params: { work_days: 10, shifts_per_day: 2, shift_hours: 12 },
  crew: [{ code: 'itr', role: 'ИТР (РП)', count: 1 }, { code: 'worker', role: 'Слесарь', count: 4 }],
  rows: []
};
const a = smeta.recalcAsgardSmeta(base);
const b = smeta.recalcAsgardSmeta(Object.assign({}, base, { params: { work_days: 40, shifts_per_day: 2, shift_hours: 12 } }));
check('срок из объёма работ влияет на себестоимость',
  b.totals.cost > a.totals.cost * 2,
  `${a.totals.cost} → ${b.totals.cost} при сроке 10 → 40`);

// 3. Перечень работ не задваивает деньги (справочный блок W).
const withWorks = smeta.recalcAsgardSmeta(Object.assign({}, base, {
  works: [{ name: 'Чистка АВО', unit: 'м2', volume: 350, people: 5, days: 2 }]
}));
check('перечень работ справочный и не задваивает себестоимость',
  withWorks.totals.cost === a.totals.cost,
  `${a.totals.cost} vs ${withWorks.totals.cost}`);
check('перечень работ виден в смете отдельным блоком',
  withWorks.rows.some((r) => r.section === 'W' && /Чистка АВО/.test(String(r.name))));

// 4. Модалка при закрытии анализа передаёт работы в смету.
check('смета из анализа передаёт works из плана',
  /works:\s*\(\(\)\s*=>/.test(PM_DUTY),
  'в buildSmetaFromStage нет works из calc.positions');
check('смета сохраняет работы, если плана нет, а объёмы уже в asgard_smeta.works', () => {
  assert.ok(/asgard_smeta && rj\.asgard_smeta\.works/.test(PM_DUTY),
    'нет фолбэка на report_json.asgard_smeta.works — такие тендеры потеряют объём');
});

// 5. В смету по-прежнему переносится техплан, а не «сырой» calc_plan.
const techBlock = CALC.slice(CALC.indexOf('function applyTechToEstimate'), CALC.indexOf('function applyTechToEstimate') + 1400);
check('в смету переносится техплан (crew/mtr/schedule)',
  /est\.crew/.test(techBlock) && /est\.mtr/.test(techBlock) && /est\.schedule/.test(techBlock));

console.log('');
console.log(fail ? `ИТОГ: ${fail} FAIL — объём работ и деньги разошлись` : 'ИТОГ: OK — объём работ определяет деньги');
process.exitCode = fail ? 1 : 0;
