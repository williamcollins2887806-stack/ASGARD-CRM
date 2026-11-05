#!/usr/bin/env node
'use strict';
/**
 * norms-web-coverage.js — измеряет, сколько запросов реально кормит справочник.
 *
 * Для каждого query из queries-320plus.jsonl проверяет:
 *   1) есть ли норма в work_norm_rates по (category, method);
 *   2) можно ли собрать inputs, которые пройдут physicalInputError;
 *   3) что даёт previewCalc (work_days, бригада, man_hours).
 *
 * Это и есть честная метрика «норма → калькулятор», а не число строк в Excel.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const DB = process.env.COVERAGE_DB || 'asgard_crm_test';
const REPORTS = path.join(__dirname, '..', 'tests/reports/norms-web');

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split(/\r?\n/)
    .map((l) => { try { return JSON.parse(l); } catch (_) { return null; } })
    .filter(Boolean);
}

(async () => {
  const workNorms = require('../src/services/work-norms');
  const db = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'asgard',
    password: process.env.DB_PASSWORD || '123456789',
    database: DB
  });
  await db.connect();

  const queries = readJsonl(path.join(REPORTS, 'queries-320plus.jsonl'));
  const rates = (await db.query(
    `SELECT category_code, method_code, code, calc_kind, unit, rate_default
       FROM work_norm_rates WHERE is_active ORDER BY category_code, sort_order`
  )).rows;

  const byMethod = new Map();
  for (const r of rates) {
    const key = r.category_code + '|' + (r.method_code || '');
    if (!byMethod.has(key)) byMethod.set(key, []);
    byMethod.get(key).push(r);
  }

  const stats = {
    queries: queries.length,
    method_covered: 0,
    method_missing: 0,
    calc_ok: 0,
    calc_error: 0,
    errors: {}
  };
  const perMethod = new Map();
  const okRows = [];
  const failedRows = [];

  for (const q of queries) {
    const cat = q.category || q.category_code;
    const method = q.method || q.method_code;
    const key = cat + '|' + (method || '');
    const hasRate = byMethod.has(key) || byMethod.has(cat + '|');
    const bucket = perMethod.get(key) || { total: 0, hasRate: 0, calcOk: 0, calcErr: 0, codes: new Set() };
    bucket.total += 1;
    if (hasRate) {
      bucket.hasRate += 1;
      stats.method_covered += 1;
      for (const r of (byMethod.get(key) || byMethod.get(cat + '|'))) bucket.codes.add(r.code);
    } else {
      stats.method_missing += 1;
    }

    // inputs из запроса: объёмы уже подобраны генератором R1
    const inputs = Object.assign({}, q.inputs || {});
    delete inputs.complexity;
    delete inputs.variation_axis;
    delete inputs.method_code;
    delete inputs.category_code;

    let res;
    try {
      res = await workNorms.previewCalc(db, {
        category_code: cat,
        method_code: method,
        inputs,
        fouling: q.fouling || 'medium'
      });
    } catch (e) {
      res = { error: 'throw: ' + e.message };
    }

    if (res && res.ok) {
      stats.calc_ok += 1;
      bucket.calcOk += 1;
      okRows.push({
        query_id: q.id,
        category: cat,
        method,
        rate_code: res.rate.code,
        inputs,
        work_days: res.results.work_days,
        person_shifts: res.results.person_shifts,
        man_hours: res.results.man_hours,
        crew: res.crew
      });
    } else {
      stats.calc_error += 1;
      bucket.calcErr += 1;
      const msg = (res && res.error) || 'нет результата';
      stats.errors[msg] = (stats.errors[msg] || 0) + 1;
      failedRows.push({ query_id: q.id, category: cat, method, inputs, error: msg });
    }
    perMethod.set(key, bucket);
  }

  console.log('=== ПОКРЫТИЕ ЗАПРОСОВ СПРАВОЧНИКОМ ===');
  console.log('БД:', DB);
  console.log('запросов:', stats.queries);
  console.log('метод с нормой:', stats.method_covered, '| без нормы:', stats.method_missing);
  console.log('previewCalc ok:', stats.calc_ok, '| ошибок:', stats.calc_error);
  const pct = stats.queries ? ((stats.calc_ok / stats.queries) * 100).toFixed(1) : '0';
  console.log('доля считаемых запросов:', pct + '%');

  console.log('\n=== ПО МЕТОДАМ ===');
  for (const [key, b] of [...perMethod.entries()].sort((a, b2) => b2[1].total - a[1].total)) {
    console.log(
      `${key.padEnd(28)} всего ${String(b.total).padStart(3)} | с нормой ${String(b.hasRate).padStart(3)}` +
      ` | считается ${String(b.calcOk).padStart(3)} | ошибок ${String(b.calcErr).padStart(3)}` +
      ` | коды: ${[...b.codes].join(', ') || '—'}`
    );
  }

  console.log('\n=== ТОП ОШИБОК ===');
  Object.entries(stats.errors).sort((a, b) => b[1] - a[1]).slice(0, 25)
    .forEach(([msg, n]) => console.log(`${n} × ${msg}`));

  fs.writeFileSync(path.join(REPORTS, 'coverage-report.json'), JSON.stringify({
    stats, per_method: [...perMethod.entries()].map(([k, v]) => ({
      key: k, total: v.total, has_rate: v.hasRate, calc_ok: v.calcOk, calc_err: v.calcErr, codes: [...v.codes]
    })),
    ok_rows: okRows,
    failed_rows: failedRows
  }, null, 2));
  console.log('\nотчёт: tests/reports/norms-web/coverage-report.json');

  await db.end();
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
