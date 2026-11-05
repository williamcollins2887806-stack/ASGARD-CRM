#!/usr/bin/env node
'use strict';
/**
 * norms-gate.js — единый гейт норм: все проверки в одном прогоне.
 *
 *   1. Excel-канон собран (Queries/Answers/ImportMap/Coverage).
 *   2. Покрытие: 100% запросов считаются previewCalc.
 *   3. Арифметика: 0 FAIL по импортированным нормам.
 *   4. Нормы видны Мимиру (toPromptMarkdown содержит импортированные коды).
 *   5. Фолбэк-контракт: unit-тесты «нет нормы / нет объёма».
 *
 * Запуск: node tools/norms-gate.js [--db=asgard_crm_test]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const REPORTS = path.join(ROOT, 'tests/reports/norms-web');
const DB = (process.argv.find((a) => a.startsWith('--db=')) || '').split('=')[1] || 'asgard_crm_test';

const C = { red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', off: '\x1b[0m' };
const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: String(detail || '') });
  console.log(`${ok ? C.green + 'PASS' : C.red + 'FAIL'}${C.off}  ${name}${detail ? C.dim + '  — ' + detail + C.off : ''}`);
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', env: process.env });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

function readJsonSafe(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const text = fs.readFileSync(file, 'utf8');
    if (!text.trim()) return null;
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

(async () => {
  // 1. Excel
  const wb = path.join(REPORTS, 'NORMS-WORKBOOK.xlsx');
  check('Excel-канон существует', fs.existsSync(wb),
    fs.existsSync(wb) ? `${Math.round(fs.statSync(wb).size / 1024)} KB` : 'нет файла');

  // 2. Покрытие
  const cov = run('node', ['tools/norms-web-coverage.js']);
  const covReport = readJsonSafe(path.join(REPORTS, 'coverage-report.json'));
  const covPct = covReport
    ? (covReport.stats.calc_ok / covReport.stats.queries) * 100 : 0;
  check('Покрытие запросов 100%', covPct >= 99.999,
    covReport ? `${covReport.stats.calc_ok}/${covReport.stats.queries} (${covPct.toFixed(1)}%)` : 'нет отчёта');
  check('Нет методов без нормы', covReport && covReport.stats.method_missing === 0,
    covReport ? `method_missing=${covReport.stats.method_missing}` : '—');

  // 3. Арифметика
  run('node', ['tools/norms-web-arithmetic.js', `--db=${DB}`]);
  const ar = readJsonSafe(path.join(REPORTS, 'arithmetic-report.json'));
  check('Арифметика: 0 FAIL', ar && ar.totals.fail === 0,
    ar ? `checked=${ar.totals.checked}, fail=${ar.totals.fail}, skipped=${ar.totals.skipped}` : 'нет отчёта');
  check('Арифметика: проверено ≥100 строк', ar && ar.totals.checked >= 100,
    ar ? `checked=${ar.totals.checked}` : '—');

  // 4. Нормы в промпте Мимира
  const db = new Client({
    host: 'localhost', port: 5432,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: DB
  });
  await db.connect();
  const workNorms = require('../src/services/work-norms');
  const catalog = await workNorms.loadCatalog(db);

  // Если отчёта импорта нет (файл пустой после сбоя) — пересобираем сухим прогоном.
  let importReport = readJsonSafe(path.join(REPORTS, 'import-report.json'));
  if (!importReport) {
    run('node', ['tools/import-norms-workbook.js', `--db=${DB}`]);
    importReport = readJsonSafe(path.join(REPORTS, 'import-report.json'));
  }
  const importedCodes = (importReport?.results || [])
    .filter((r) => r.status === 'created' || r.status === 'updated' || r.status === 'create' || r.status === 'update')
    .map((r) => r.code);
  // Промпт сужается по workType, поэтому проверяем по всем категориям сразу:
  // берём коды, реально лежащие в справочнике, и ищем их в полном промпте.
  const allRates = (await db.query(
    `SELECT code FROM work_norm_rates WHERE is_active`
  )).rows.map((r) => r.code);
  const mdFull = workNorms.toPromptMarkdown(catalog, null);
  const importedPresent = importedCodes.filter((c) => mdFull.includes(c));
  check('Нормы видны в промпте Мимира', importedCodes.length > 0 && importedPresent.length > 0,
    `импортированных ${importedCodes.length}, в промпте ${importedPresent.length} (из ${allRates.length} активных)`);

  // Дополнительно: в промпте есть хотя бы одна норма с основанием research
  // (то есть веб-нормы доходят до модели, а не только сид).
  const researchCodes = (await db.query(
    `SELECT code FROM work_norm_rates WHERE is_active AND basis = 'research'`
  )).rows.map((r) => r.code);
  const researchInPrompt = researchCodes.filter((c) => mdFull.includes(c));
  check('Веб-нормы (research) доходят до промпта', researchInPrompt.length > 0,
    `${researchInPrompt.length}/${researchCodes.length}`);

  const totalRates = (await db.query(`SELECT COUNT(*)::int AS n FROM work_norm_rates WHERE is_active`)).rows[0].n;
  const webRates = (await db.query(
    `SELECT COUNT(*)::int AS n FROM work_norm_rates WHERE is_active AND (basis = 'research' OR code LIKE 'web_%' OR code LIKE '%__%' OR code LIKE 'auto_%')`
  )).rows[0].n;
  check('Справочник наполнен веб-нормами', webRates >= 20,
    `всего ${totalRates}, веб/авто ${webRates}`);

  const logCount = (await db.query(
    `SELECT COUNT(*)::int AS n FROM work_norm_change_log WHERE action IN ('create','update','import')`
  )).rows[0].n;
  check('change_log ведётся', logCount > 0, `${logCount} записей`);

  await db.end();

  // 5. Фолбэк-контракт
  const fb = run('node', ['tests/norms-fallback.test.js']);
  check('Фолбэк «нет нормы» (unit)', fb.code === 0, fb.out.trim().split('\n').pop());

  const failed = checks.filter((c) => !c.ok);
  fs.writeFileSync(path.join(REPORTS, 'NORMS-GATE.json'), JSON.stringify({
    generated_at: new Date().toISOString(),
    database: DB,
    checks,
    passed: checks.length - failed.length,
    total: checks.length,
    verdict: failed.length ? 'FAIL' : 'PASS'
  }, null, 2));

  console.log(`\n=== НОРМЫ: ${checks.length - failed.length}/${checks.length} ===`);
  console.log(failed.length ? C.red + 'ИТОГ: FAIL' + C.off : C.green + 'ИТОГ: PASS' + C.off);
  console.log('отчёт: tests/reports/norms-web/NORMS-GATE.json');
  process.exitCode = failed.length ? 1 : 0;
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
