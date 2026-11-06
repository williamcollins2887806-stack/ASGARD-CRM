'use strict';
/**
 * Влияет ли calc_plan (Люди/Сутки от Мимира) на ДЕНЬГИ в смете?
 *
 * Смысл проверки: если смета считается независимо от плана, то отсутствие
 * плана — это не заглушка и не поломка, а просто незаполненная справка.
 * Если смета зависит — пустые цифры действительно ломают просчёт, и это
 * надо чинить, а не «оставлять как есть».
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CALC = fs.readFileSync(path.join(ROOT, 'public/assets/js/rp_calc_modal.js'), 'utf8');
const SRC = fs.readFileSync(path.join(ROOT, 'src/services/asgard-smeta.js'), 'utf8');

let fail = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) fail += 1;
}

// 1. Где вообще читается calc_plan в просчёте?
const calcUses = [];
const lines = CALC.split('\n');
lines.forEach((l, i) => {
  if (/calc_plan/.test(l)) calcUses.push(`${i + 1}: ${l.trim().slice(0, 90)}`);
});
console.log('--- места, где просчёт читает calc_plan ---');
calcUses.forEach((l) => console.log('   ' + l));
console.log('');

check('calc_plan читается только для отображения вкладки «Объёмы»',
  calcUses.every((l) => /rj\.calc_plan|const calc|const plan = rj/.test(l)),
  `${calcUses.length} вхождений`);

// 2. Движок сметы вообще не знает про calc_plan.
check('движок сметы не использует calc_plan',
  !/calc_plan/.test(SRC),
  'asgard-smeta.js не упоминает calc_plan — деньги считаются из asgard_smeta');

// 3. Смета строится из asgard_smeta: строки, бригада, МТР, сроки, параметры.
// Проверяем по реальной функции recalcAsgardSmeta, а не по отдельным словам.
const recalcStart = SRC.indexOf('function recalcAsgardSmeta');
const recalcBody = recalcStart >= 0 ? SRC.slice(recalcStart, recalcStart + 2600) : '';
const engineInputs = ['rows', 'crew', 'mtr', 'schedule', 'params'];
const missing = engineInputs.filter((k) => !new RegExp(`est\\.${k}\\b`).test(recalcBody));
check('движок сметы берёт строки, бригаду, МТР, сроки и параметры',
  recalcStart >= 0 && missing.length === 0,
  missing.length ? 'не найдено в recalcAsgardSmeta: ' + missing.join(', ') : 'все входы на месте');

// 4. applyTechToEstimate переносит в смету именно техплан, а не calc_plan.
const techBlock = CALC.slice(CALC.indexOf('function applyTechToEstimate'), CALC.indexOf('function applyTechToEstimate') + 1400);
check('в смету переносится техплан (crew/mtr/schedule), а не calc_plan',
  /est\.crew/.test(techBlock) && /est\.mtr/.test(techBlock) && /est\.schedule/.test(techBlock) && !/calc_plan/.test(techBlock));

console.log('');
console.log(fail ? `ИТОГ: ${fail} FAIL — цифры плана связаны с деньгами, нужна починка` : 'ИТОГ: OK — смета от плана не зависит');
process.exitCode = fail ? 1 : 0;
