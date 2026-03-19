#!/usr/bin/env node
/**
 * Парсер результатов full-audit.spec.js
 * Использование: node tests/mobile/parse-audit.js test-results/full-audit.log
 */

var fs = require('fs');
var file = process.argv[2] || 'test-results/full-audit.log';

if (!fs.existsSync(file)) {
  console.error('Файл не найден: ' + file);
  process.exit(1);
}

var lines = fs.readFileSync(file, 'utf8').split('\n');

// ═══ ЧАСТЬ 1 ═══
var p1 = lines.filter(function (l) { return l.includes('[P1]'); });
var p1ok = p1.filter(function (l) { return l.includes('→ OK'); }).length;
var p1err = p1.filter(function (l) { return l.includes('→ UI_ERROR') || l.includes('→ EMPTY'); }).length;
var p1redir = p1.filter(function (l) { return l.includes('→ REDIRECT'); }).length;
var p1js = p1.filter(function (l) { return l.includes('JS:'); }).length;

// ═══ ЧАСТЬ 2 ═══
var p2 = lines.filter(function (l) { return l.includes('[P2]') && l.includes('found='); });
var p2issues = lines.filter(function (l) { return l.includes('[P2]') && l.includes('issues:'); });
var p2totalOk = 0, p2totalNoReact = 0, p2totalFail = 0, p2totalJsErr = 0;
p2.forEach(function (l) {
  var m;
  m = l.match(/OK=(\d+)/); if (m) p2totalOk += parseInt(m[1]);
  m = l.match(/NO_REACT=(\d+)/); if (m) p2totalNoReact += parseInt(m[1]);
  m = l.match(/FAIL=(\d+)/); if (m) p2totalFail += parseInt(m[1]);
  m = l.match(/JS_ERR=(\d+)/); if (m) p2totalJsErr += parseInt(m[1]);
});

// ═══ ЧАСТЬ 3 ═══
var p3 = lines.filter(function (l) { return l.includes('[P3]'); });
var roles = {};
p3.forEach(function (l) {
  var m = l.match(/\[P3\]\[(\w+)\]/);
  if (!m) return;
  var role = m[1];
  if (!roles[role]) roles[role] = { ok: 0, error: 0, empty: 0, redirect: 0, jsErr: 0, total: 0 };
  roles[role].total++;
  if (l.includes('→ OK')) roles[role].ok++;
  else if (l.includes('→ UI_ERROR')) roles[role].error++;
  else if (l.includes('→ EMPTY')) roles[role].empty++;
  else if (l.includes('→ REDIRECT_AUTH')) roles[role].redirect++;
  else if (l.includes('→ JS_ERROR')) roles[role].jsErr++;
});

// ═══ ЧАСТЬ 4 ═══
var p4 = lines.filter(function (l) { return l.includes('[P4]'); });

// ═══ ЧАСТЬ 5 ═══
var p5 = lines.filter(function (l) { return l.includes('[P5]'); });
var p5bugs = p5.filter(function (l) { return l.includes('BUG') || l.includes('API_ERROR'); });

// ═══ ЧАСТЬ 6 ═══
var p6 = lines.filter(function (l) { return l.includes('[P6]'); });
var p6ok = p6.filter(function (l) { return l.includes('→ OK'); }).length;
var p6issues = p6.filter(function (l) { return !l.includes('→ OK'); });

// ═══ ВЫВОД ═══
console.log('═══════════════════════════════════════════════════════');
console.log('ASGARD CRM — МОБИЛЬНЫЙ АУДИТ');
console.log('Дата: ' + new Date().toISOString().slice(0, 10));
console.log('═══════════════════════════════════════════════════════');

console.log('\nЧАСТЬ 1: СТРАНИЦЫ (ADMIN) — ' + p1.length + ' маршрутов');
console.log('  ✅ OK: ' + p1ok);
console.log('  ❌ UI_ERROR/EMPTY: ' + p1err);
console.log('  🔄 REDIRECT: ' + p1redir);
console.log('  ⚠️  JS ошибки: ' + p1js);
p1.filter(function (l) { return !l.includes('→ OK') || l.includes('JS:'); }).forEach(function (l) {
  console.log('  ' + l.trim());
});

console.log('\nЧАСТЬ 2: КНОПКИ — ' + p2.length + ' страниц');
console.log('  OK: ' + p2totalOk + ' | NO_REACTION: ' + p2totalNoReact +
  ' | CLICK_FAILED: ' + p2totalFail + ' | JS_ERROR: ' + p2totalJsErr);
p2issues.forEach(function (l) { console.log('  ' + l.trim()); });

console.log('\nЧАСТЬ 3: РОЛИ');
console.log('┌──────────────────┬───────┬──────┬────────┬───────┬──────────┬────────┐');
console.log('│ Роль             │ Всего │ OK   │ Ошибки │ Пусто │ Редирект │ JS Err │');
console.log('├──────────────────┼───────┼──────┼────────┼───────┼──────────┼────────┤');
Object.keys(roles).forEach(function (role) {
  var r = roles[role];
  var pad = function (s, n) { s = String(s); while (s.length < n) s = ' ' + s; return s; };
  var padR = function (s, n) { s = String(s); while (s.length < n) s = s + ' '; return s; };
  console.log('│ ' + padR(role, 16) + ' │' + pad(r.total, 5) + '  │' + pad(r.ok, 4) + '  │' +
    pad(r.error, 6) + '  │' + pad(r.empty, 5) + '  │' + pad(r.redirect, 8) + '  │' + pad(r.jsErr, 6) + '  │');
});
console.log('└──────────────────┴───────┴──────┴────────┴───────┴──────────┴────────┘');

console.log('\nЧАСТЬ 4: МОБИЛКА vs ДЕСКТОП');
p4.forEach(function (l) { console.log('  ' + l.replace('[P4] ', '')); });

console.log('\nЧАСТЬ 5: ДАННЫЕ');
p5.forEach(function (l) { console.log('  ' + l.trim()); });
if (p5bugs.length) console.log('  🐛 БАГИ: ' + p5bugs.length);

console.log('\nЧАСТЬ 6: МОДАЛКИ — ' + p6.length + ' проверено, ' + p6ok + ' OK');
p6.forEach(function (l) { console.log('  ' + l.trim()); });

// ИТОГО
var totalBugs = p1err + p2totalNoReact + p2totalFail + p2totalJsErr + p5bugs.length + p6issues.length;
var critBugs = p1err + p5bugs.length;
var medBugs = p2totalNoReact + p2totalFail + p6issues.length;
var minorBugs = p1js + p2totalJsErr;

console.log('\n═══════════════════════════════════════════════════════');
console.log('ИТОГО ПРОБЛЕМ: ~' + totalBugs);
console.log('  КРИТИЧНЫХ: ' + critBugs + ' (ошибки загрузки, пустые данные)');
console.log('  СРЕДНИХ: ' + medBugs + ' (кнопки, модалки)');
console.log('  МЕЛКИХ: ' + minorBugs + ' (JS warnings)');
console.log('═══════════════════════════════════════════════════════');
