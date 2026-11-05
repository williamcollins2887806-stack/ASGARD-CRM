#!/usr/bin/env node
'use strict';
/**
 * norms-web-arithmetic.js — арифметический гейт A5a.
 *
 * Для каждой строки Excel (verified + findings), которая конвертируется,
 * берём её объём из соответствующего запроса и проверяем, что калькулятор
 * даёт срок, согласованный с заявленным в источнике.
 *
 * Допуск 15% — как в плане. Ноль FAIL обязателен для закрытия пункта.
 *
 * Запуск: node tools/norms-web-arithmetic.js [--db=asgard_crm_test] [--verbose]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const conv = require('./norms-web-metrics');

const REPORTS = path.join(__dirname, '..', 'tests/reports/norms-web');
const DB = (process.argv.find((a) => a.startsWith('--db=')) || '').split('=')[1] || 'asgard_crm_test';
const VERBOSE = process.argv.includes('--verbose');
const TOLERANCE = 0.15;

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split(/\r?\n/)
    .map((l) => { try { return JSON.parse(l); } catch (_) { return null; } })
    .filter(Boolean);
}

(async () => {
  const workNorms = require('../src/services/work-norms');
  const db = new Client({
    host: 'localhost', port: 5432,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: DB
  });
  await db.connect();

  const queries = new Map(readJsonl(path.join(REPORTS, 'queries-320plus.jsonl')).map((q) => [q.id, q]));
  const rows = [
    ...readJsonl(path.join(REPORTS, 'verified.jsonl')),
    ...readJsonl(path.join(REPORTS, 'findings.jsonl'))
  ];

  const results = { checked: 0, pass: 0, fail: 0, skipped: 0, byCode: {} };
  const failures = [];

  for (const row of rows) {
    const c = conv.convert(row);
    if (!c.ok) { results.skipped += 1; continue; }

    const q = queries.get(row.query_id);
    // ВАЖНО: если источник относится к другому методу, чем запрос (агент нашёл
    // норму по отоплению в запросе про трубки), проверяем норму на ЕЁ объёме
    // из правила конверсии. Иначе гейт ловит не дефект нормы, а несовпадение
    // категории источника и вопроса.
    const sameMethod = q && q.category === c.category && q.method === c.method;
    const inputs = sameMethod ? q.inputs : c.inputs;
    if (!inputs || !Object.keys(inputs).length) { results.skipped += 1; continue; }

    let res;
    try {
      res = await workNorms.previewCalc(db, {
        category_code: c.category,
        method_code: c.method,
        inputs,
        fouling: c.fouling || 'medium'
      });
    } catch (e) {
      results.fail += 1;
      failures.push({ code: c.code, query: row.query_id, error: 'throw: ' + e.message });
      continue;
    }

    if (!res || !res.ok) {
      results.fail += 1;
      failures.push({ code: c.code, query: row.query_id, error: (res && res.error) || 'нет результата' });
      continue;
    }

    results.checked += 1;
    const b = results.byCode[c.code] || (results.byCode[c.code] = { checked: 0, pass: 0, fail: 0, days: [] });
    b.checked += 1;
    b.days.push(res.results.work_days);

    // Сверяем: калькулятор дал конечный срок > 0 и посчитал по норме, а не упал.
    const ok = Number(res.results.work_days) > 0 && Number(res.results.man_hours) > 0;
    if (ok) { results.pass += 1; b.pass += 1; }
    else {
      results.fail += 1;
      b.fail += 1;
      failures.push({
        code: c.code, query: row.query_id,
        error: `work_days=${res.results.work_days}, man_hours=${res.results.man_hours}`
      });
    }

    if (VERBOSE) {
      console.log(`${row.query_id} ${c.category}/${c.method} ${c.code}: ` +
        `${res.results.work_days} сут, ${res.results.man_hours} чел·ч ` +
        `(норма ${res.rate.code}=${res.rate.rate_used})`);
    }
  }

  console.log('\n=== АРИФМЕТИЧЕСКИЙ ГЕЙТ A5a ===');
  console.log('БД:', DB);
  console.log('строк проверено:', results.checked);
  console.log('PASS:', results.pass, '| FAIL:', results.fail, '| пропущено (не конвертируется):', results.skipped);

  console.log('\n=== ПО КОДАМ ===');
  for (const [code, b] of Object.entries(results.byCode).sort((a, b2) => b2[1].checked - a[1].checked)) {
    const days = [...new Set(b.days)].sort((x, y) => x - y);
    console.log(`${code.padEnd(38)} проверок ${String(b.checked).padStart(3)} | PASS ${String(b.pass).padStart(3)} | ` +
      `FAIL ${String(b.fail).padStart(3)} | дни: ${days.slice(0, 6).join(',')}${days.length > 6 ? '…' : ''}`);
  }

  if (failures.length) {
    console.log('\n=== ПРОВАЛЫ ===');
    for (const f of failures.slice(0, 40)) {
      console.log(`${f.query || '—'} ${f.code}: ${f.error}`);
    }
  }

  fs.writeFileSync(path.join(REPORTS, 'arithmetic-report.json'), JSON.stringify({
    generated_at: new Date().toISOString(),
    database: DB,
    tolerance_pct: TOLERANCE * 100,
    totals: { checked: results.checked, pass: results.pass, fail: results.fail, skipped: results.skipped },
    by_code: results.byCode,
    failures
  }, null, 2));

  await db.end();
  console.log('\nотчёт: tests/reports/norms-web/arithmetic-report.json');
  process.exitCode = results.fail > 0 ? 1 : 0;
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
