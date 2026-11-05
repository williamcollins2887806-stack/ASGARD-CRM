#!/usr/bin/env node
'use strict';
/**
 * patch-norms-web-inputs.js — дополняет inputs в queries-320plus.jsonl до схемы метода.
 *
 * Проблема: R1-генератор писал «объём-подсказку», но не все ключи, которые
 * требует physicalInputError (cycles для котлов, diameter_mm для изоляции, lifts
 * для такелажа). Из-за этого 83 запроса из 325 не считались — но это дефект
 * ЗАПРОСОВ, а не справочника. Скрипт правит только inputs, не меняя id/вопросы,
 * поэтому связь с findings и verified сохраняется.
 *
 * Запуск: node tools/patch-norms-web-inputs.js [--write]
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'tests/reports/norms-web/queries-320plus.jsonl');
const WRITE = process.argv.includes('--write');

/** Что добавить по (category, method), если ключа нет. Значения — типовые, не выдумка норм. */
const DEFAULTS = {
  'boilers|chem': { cycles: 2 },
  'boilers|hydro': { surface_m2: 120 },
  'boilers|mech': { surface_m2: 120 },
  'boilers|complex': { surface_m2: 120, cycles: 2 },
  'tubes|chem': { circuit_m3: 6 },
  'avo|tubes': { tubes: 400 },
  'insulation|insul': { diameter_mm: 159 },
  'repair_weld|compabloc': { surface_m2: 60 },
  'repair_weld|plates_pack': { plates_count: 80 },
  'repair_weld|weld': { dn_mm: 159 },
  'repair_weld|cutting': { length_m: 10 },
  'repair_weld|fire_works': { points: 4 },
  'mount|rigging': { lifts: 2 },
  'mount|flange': { joints: 8 },
  'mount|mount': { qty: 1 },
  'mount|dismount': { qty: 1 },
  'pipelines|hydrotest': { dn_mm: 159 },
  'plates|hydro_dis': { apparatus: 1 }
};

const rows = fs.readFileSync(FILE, 'utf8').trim().split(/\r?\n/).map((l) => JSON.parse(l));
let patched = 0;
const changes = {};

for (const r of rows) {
  const key = `${r.category}|${r.method || ''}`;
  const add = DEFAULTS[key];
  if (!add) continue;
  r.inputs = r.inputs || {};
  let touched = false;
  for (const [k, v] of Object.entries(add)) {
    if (!(Number(r.inputs[k]) > 0)) { r.inputs[k] = v; touched = true; }
  }
  if (touched) {
    patched += 1;
    changes[key] = (changes[key] || 0) + 1;
  }
}

console.log('всего запросов:', rows.length);
console.log('дополнено inputs:', patched);
console.log('по методам:', changes);

if (WRITE) {
  fs.writeFileSync(FILE, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log('записано:', FILE);
} else {
  console.log('(сухой прогон, добавь --write)');
}
