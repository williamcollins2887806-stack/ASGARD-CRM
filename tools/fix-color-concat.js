'use strict';
/**
 * fix-color-concat.js — заменяет hex-склейку `${c}22` на `color-mix(in oklab, c 13%, transparent)`.
 *
 * Зачем: hex-суффикс (`${c}22`) валиден ТОЛЬКО когда `c` — литеральный hex.
 * После перехода на семантические токены `c` часто равен `var(--acc)`/`var(--value)`,
 * и строка `var(--acc)22` — невалидный CSS: браузер молча отбрасывает свойство
 * (фон/бордер/тень пропадают). `color-mix` принимает ЛЮБОЙ <color>, включая var().
 *
 * Запуск: node tools/fix-color-concat.js [--apply] [--dir=<путь>]
 */
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const dirArg = process.argv.find((a) => a.startsWith('--dir='));
const DIR = dirArg
  ? path.resolve(dirArg.slice(6))
  : path.join(__dirname, '..', 'public', 'mobile-app', 'src', 'pages', 'field');

/* hex-суффикс → процент непрозрачности (alpha/255) */
const SUFFIX_PCT = {
  '05': 2, '08': 3, '0a': 4, '0c': 5, '0f': 6, '10': 6, '11': 7, '12': 7,
  '14': 8, '15': 8, '18': 9, '1a': 10, '1c': 11, '1f': 12, '20': 13, '22': 13,
  '24': 14, '25': 15, '28': 16, '2a': 17, '2c': 17, '30': 19, '33': 20,
  '38': 22, '3a': 23, '40': 25, '44': 27, '4d': 30, '50': 31, '55': 33,
  '5c': 36, '60': 38, '66': 40, '6b': 42, '70': 44, '77': 47, '7a': 48,
  '80': 50, '88': 53, '8c': 55, '99': 60, 'aa': 67, 'b3': 70, 'bb': 73,
  'cc': 80, 'd9': 85, 'e6': 90, 'f2': 95,
};

/* ${expr}AA — где AA ровно два hex-символа и следом НЕ идёт hex-символ */
const RE = /\$\{([^}]+)\}([0-9a-fA-F]{2})(?![0-9a-fA-F])/g;

/* expr + 'AA' — обычная (не template) строка. expr — идентификатор/цепочка или строковый литерал. */
const RE2 = /([A-Za-z_][A-Za-z0-9_.]*|'[^'\n]{1,40}')\s*\+\s*'([0-9a-fA-F]{2})(?![0-9a-fA-F])'/g;

/* Пропускаем вычисляемые (не цветовые) интерполяции: px/deg/scale/vY и т.п. */
const SKIP = /px|deg|sec|scale|Rot|vY|vw|vh|%|\bss\.|Math\./;

const report = [];
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.jsx') || f.endsWith('.js') || f.endsWith('.css'));

for (const f of files) {
  const p = path.join(DIR, f);
  const src = fs.readFileSync(p, 'utf8');
  let hits = 0;
  let out = src.replace(RE, (m, expr, hex) => {
    if (SKIP.test(expr)) return m;
    const pct = SUFFIX_PCT[hex.toLowerCase()];
    if (pct == null) return m;
    hits++;
    return `color-mix(in oklab, \${${expr}} ${pct}%, transparent)`;
  });
  out = out.replace(RE2, (m, expr, hex) => {
    if (SKIP.test(expr)) return m;
    const pct = SUFFIX_PCT[hex.toLowerCase()];
    if (pct == null) return m;
    hits++;
    return `\`color-mix(in oklab, \${${expr}} ${pct}%, transparent)\``;
  });
  if (hits) {
    report.push({ f, hits });
    if (APPLY) fs.writeFileSync(p, out, 'utf8');
  }
}

report.sort((a, b) => b.hits - a.hits);
console.log(`# hex-склейка → color-mix (${APPLY ? 'APPLY' : 'DRY-RUN'})\n`);
console.log('| файл | замен |');
console.log('|---|--:|');
for (const r of report) console.log(`| ${r.f} | ${r.hits} |`);
console.log(`\nвсего: ${report.reduce((t, r) => t + r.hits, 0)} в ${report.length} файл(ах)`);
if (!APPLY) console.log('Запуск с --apply.');
