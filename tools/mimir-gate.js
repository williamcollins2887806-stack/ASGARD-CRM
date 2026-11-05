#!/usr/bin/env node
'use strict';
/**
 * mimir-gate.js — единый гейт этапов Мимира и норм.
 *
 * Один прогон, все проверки, машинный вердикт:
 *   1. Нормы: Excel, покрытие, арифметика, промпт (делегируется norms-gate).
 *   2. Этапы: unit-контракт (переходы, preflight, ДВ, план).
 *   3. Этапы: API на клоне (продолжение, optimistic lock, терминальные).
 *   4. Этапы: сквозной конвейер (ДВ → норма → план → финал → отказ).
 *   5. UI-статика: CSS без хардкод-цветов, экраны C1–C9 на месте, скрипт подключён.
 *
 * Запуск: node tools/mimir-gate.js [--db=asgard_crm_test]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DB = (process.argv.find((a) => a.startsWith('--db=')) || '').split('=')[1] || 'asgard_crm_test';
const C = { red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', off: '\x1b[0m' };

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: String(detail || '') });
  console.log(`${ok ? C.green + 'PASS' : C.red + 'FAIL'}${C.off}  ${name}${detail ? C.dim + '  — ' + detail + C.off : ''}`);
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', env: process.env, maxBuffer: 20 * 1024 * 1024 });
  return { code: r.status, out: ((r.stdout || '') + (r.stderr || '')).trim() };
}

function tail(text, n) {
  const lines = String(text || '').split('\n').filter(Boolean);
  return lines.slice(-n).join(' | ');
}

// ── 1. Нормы ────────────────────────────────────────────────────────────────
const norms = run('node', ['tools/norms-gate.js', `--db=${DB}`]);
const normsReportPath = path.join(ROOT, 'tests/reports/norms-web/NORMS-GATE.json');
const normsReport = fs.existsSync(normsReportPath)
  ? JSON.parse(fs.readFileSync(normsReportPath, 'utf8')) : null;
check('Нормы: единый гейт 10/10', norms.code === 0,
  normsReport ? `${normsReport.passed}/${normsReport.total}` : tail(norms.out, 2));

// ── 2. Unit этапов ──────────────────────────────────────────────────────────
const unit = run('node', ['tests/mimir-stages.test.js']);
check('Этапы: unit-контракт', unit.code === 0, tail(unit.out, 1));

// ── 3. API на клоне ─────────────────────────────────────────────────────────
const api = run('node', ['tests/mimir-stages-api.test.js', `--db=${DB}`]);
check('Этапы: API на клоне', api.code === 0, tail(api.out, 1));

// ── 4. Сквозной конвейер ────────────────────────────────────────────────────
const flow = run('node', ['tests/mimir-stages-flow.test.js', `--db=${DB}`]);
check('Этапы: сквозной конвейер', flow.code === 0, tail(flow.out, 1));

// ── 5. UI-статика ───────────────────────────────────────────────────────────
const cssPath = path.join(ROOT, 'public/assets/css/mimir-stages.css');
const uiPath = path.join(ROOT, 'public/assets/js/mimir_stages_ui.js');
const index = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '';
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
const hardcoded = (cssNoComments.match(/#[0-9a-fA-F]{3,6}\b/g) || []);
check('UI: CSS без хардкод-цветов', hardcoded.length === 0,
  hardcoded.length ? [...new Set(hardcoded)].slice(0, 5).join(', ') : 'только токены');

const ui = fs.existsSync(uiPath) ? fs.readFileSync(uiPath, 'utf8') : '';
const views = ['viewIntake', 'viewRead', 'viewClarify', 'viewDv', 'viewTech',
  'viewDecision', 'viewCalcPlan', 'viewSmeta', 'viewNogo', 'viewDone'];
const missingViews = views.filter((v) => !ui.includes(v));
check('UI: экраны C1–C9 на месте', missingViews.length === 0,
  missingViews.length ? 'нет: ' + missingViews.join(', ') : `${views.length} экранов`);

check('UI: скрипт и стили подключены', index.includes('mimir_stages_ui.js') && index.includes('mimir-stages.css'),
  index.includes('mimir_stages_ui.js') ? 'подключены' : 'не подключены');

check('UI: глобал AsgardMimirStages экспортирован', ui.includes('window.AsgardMimirStages'));

const sidePanels = ['mst-side__live', 'mst-side__log', 'mst-step'];
const missingPanels = sidePanels.filter((p) => !css.includes(p) || !ui.includes(p));
check('UI: панель «Ход работы» и рельс этапов', missingPanels.length === 0,
  missingPanels.length ? 'нет: ' + missingPanels.join(', ') : 'есть');

const states = ['mst-skeleton', 'mst-empty', 'mst-error', 'mst-warn'];
const missingStates = states.filter((s) => !css.includes(s));
check('UI: состояния loading/empty/error/warn', missingStates.length === 0,
  missingStates.length ? 'нет: ' + missingStates.join(', ') : 'есть');

// ── Итог ────────────────────────────────────────────────────────────────────
const failed = checks.filter((c) => !c.ok);
const out = {
  generated_at: new Date().toISOString(),
  database: DB,
  checks,
  passed: checks.length - failed.length,
  total: checks.length,
  verdict: failed.length ? 'FAIL' : 'PASS'
};
fs.writeFileSync(path.join(ROOT, 'tests/reports/MIMIR-GATE.json'), JSON.stringify(out, null, 2));

console.log(`\n=== МИМИР: ${out.passed}/${out.total} ===`);
console.log(failed.length ? C.red + 'ИТОГ: FAIL' + C.off : C.green + 'ИТОГ: PASS' + C.off);
console.log('отчёт: tests/reports/MIMIR-GATE.json');
process.exitCode = failed.length ? 1 : 0;
