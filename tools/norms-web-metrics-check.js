#!/usr/bin/env node
'use strict';
/**
 * norms-web-metrics-check.js — проверка покрытия конверсии на реальных verified.
 *
 * Показывает: сколько строк конвертируются, во сколько кодов, какие метрики
 * требуют доработки (R4). Это и есть измерение «норма → калькулятор».
 */
const fs = require('fs');
const path = require('path');
const conv = require('./norms-web-metrics');

const FILES = process.argv.slice(2);
const files = FILES.length ? FILES : [
  path.join(__dirname, '..', 'tests/reports/norms-web/verified.jsonl'),
  path.join(__dirname, '..', 'tests/reports/norms-web/findings.jsonl')
];

let total = 0;
let ok = 0;
const byCode = {};
const byMetric = {};
const review = {};

for (const file of files) {
  if (!fs.existsSync(file)) { console.log('skip (нет файла):', file); continue; }
  const rows = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map((l) => {
    try { return JSON.parse(l); } catch (_) { return null; }
  }).filter(Boolean);
  console.log(`\n### ${path.basename(file)} — ${rows.length} строк`);
  for (const r of rows) {
    total += 1;
    const res = conv.convert(r);
    const metric = r.metric || r.derived_metric || '(пусто)';
    if (res.ok) {
      ok += 1;
      byCode[res.code] = byCode[res.code] || { count: 0, values: [], unit: res.unit, kind: res.calc_kind };
      byCode[res.code].count += 1;
      byCode[res.code].values.push(res.value);
      byMetric[metric] = (byMetric[metric] || 0) + 1;
    } else {
      review[metric] = review[metric] || { count: 0, reason: res.reason };
      review[metric].count += 1;
    }
  }
}

console.log('\n=== ИТОГ ===');
console.log(`строк: ${total}, конвертируется: ${ok}, требует доработки: ${total - ok}`);
console.log(`уникальных кодов на выходе: ${Object.keys(byCode).length}`);

console.log('\n=== КОДЫ СПРАВОЧНИКА ===');
for (const [code, v] of Object.entries(byCode)) {
  const uniq = [...new Set(v.values)].sort((a, b) => a - b);
  console.log(`${code} | ${v.kind} | ${v.unit} | строк ${v.count} | значения: ${uniq.slice(0, 8).join(', ')}${uniq.length > 8 ? '…' : ''}`);
}

console.log('\n=== ТРЕБУЮТ ДОРАБОТКИ (R4) ===');
for (const [m, v] of Object.entries(review)) {
  console.log(`${m} ×${v.count}: ${v.reason}`);
}

const coverage = total ? Math.round((ok / total) * 100) : 0;
console.log(`\nпокрытие конверсии: ${coverage}%`);
process.exitCode = 0;
