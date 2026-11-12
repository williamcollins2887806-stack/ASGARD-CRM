#!/usr/bin/env node
'use strict';
/**
 * Шаг A: график заездов сохраняется в карточку вместе с расчётом.
 *
 * Дефект #2138 (12.11.2026): analyse-скрипт сохранял dv_positions, calc_plan
 * и asgard_smeta, но НЕ visit_plan. Карточка держала график от прошлого
 * прогона: «trip_count: план 5 / расчёт 7 / смета 7». Метрики врали, а шаг 2
 * (trip_count из графика) не был виден в UI.
 *
 * Запуск: node tests/analyze-saves-visit-plan.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const SCAN = path.join(ROOT, '.deploy', 'analyze-2138.js');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

const src = fs.readFileSync(SCAN, 'utf8');

check('скрипт сохраняет visit_plan в report_json', () => {
  assert.ok(/rj\.visit_plan\s*=/.test(src),
    'visit_plan не записывается — карточка покажет график прошлого прогона');
});

check('вместе с графиком сохраняются режим и число выездов', () => {
  assert.ok(/rj\.visit_mode\s*=/.test(src), 'нет rj.visit_mode');
  assert.ok(/rj\.trip_count\s*=/.test(src), 'нет rj.trip_count');
});

check('конфликты графика тоже едут в карточку', () => {
  assert.ok(/rj\.visit_conflicts\s*=/.test(src),
    'конфликты не сохраняются — РП не увидит расхождение с моделью');
});

check('сохранение под условием: пустой график не затирает прежний', () => {
  // Если buildVisitPlan упал, visitPlan = null. Писать null нельзя:
  // это стёрло бы рабочий график из-за временной ошибки.
  assert.ok(/if\s*\(visitPlan\)\s*\{[\s\S]{0,400}rj\.visit_plan/.test(src),
    'visit_plan пишется без проверки на null');
});

check('остальные поля карточки сохранены (регресс)', () => {
  ['dv_positions', 'dv_incomplete', 'calc_plan', 'asgard_smeta'].forEach((f) => {
    assert.ok(new RegExp('rj\\.' + f + '\\s*=').test(src), 'потеряно поле ' + f);
  });
});

// ── Поведенческая проверка «что останется в карточке» ──────────────────────
function applySave(prev, patch) {
  const rj = JSON.parse(JSON.stringify(prev));
  if (patch.visitPlan) {
    rj.visit_plan = patch.visitPlan;
    rj.visit_mode = patch.visitPlan.mode || null;
    rj.trip_count = patch.visitPlan.trip_count || 1;
    rj.visit_conflicts = Array.isArray(patch.visitPlan.conflicts) ? patch.visitPlan.conflicts : [];
  }
  return rj;
}

check('график перезаписывается новым, а не остаётся старым', () => {
  const prev = { visit_plan: { mode: 'visits', trip_count: 5, visits: [{ id: 'v1' }] }, dv_positions: [] };
  const next = { mode: 'continuous', trip_count: 1, visits: [{ id: 'v1' }], conflicts: [] };
  const out = applySave(prev, { visitPlan: next });
  assert.strictEqual(out.trip_count, 1, 'остался старый trip_count ' + out.trip_count);
  assert.strictEqual(out.visit_mode, 'continuous');
});

check('если график не собрался — прежний не стирается', () => {
  const prev = { visit_plan: { mode: 'continuous', trip_count: 1 }, trip_count: 1 };
  const out = applySave(prev, { visitPlan: null });
  assert.strictEqual(out.trip_count, 1, 'график стёрт');
  assert.strictEqual(out.visit_plan.mode, 'continuous');
});

check('конфликты доезжают до карточки', () => {
  const out = applySave({}, {
    visitPlan: {
      mode: 'continuous', trip_count: 1, visits: [],
      conflicts: [{ kind: 'trip_count_mismatch', message: 'модель 5, график 1' }]
    }
  });
  assert.strictEqual(out.visit_conflicts.length, 1);
  assert.strictEqual(out.visit_conflicts[0].kind, 'trip_count_mismatch');
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
