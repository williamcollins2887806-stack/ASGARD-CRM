'use strict';

/**
 * Гейт: SSE stream и vapid-key не под анонимным rate-limit.
 * 06.11.2026: ×2455 «Rate limit exceeded» за 3ч — EventSource/?token= + vapid
 * без Authorization упирались в RATE_LIMIT_ANON_MAX.
 *
 * Запуск: node tests/sse-vapid-rate-limit-exempt.test.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const checks = [];
const failures = [];
function ok(name, extra) { checks.push({ name, pass: true, extra }); }
function fail(name, extra) {
  checks.push({ name, pass: false, extra });
  failures.push(name + (extra ? ' — ' + extra : ''));
}

function assertRouteExempt(relPath, routeRe) {
  const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  // Ищем объявление маршрута с options-объектом: get('/x', { config: { rateLimit: false } }, ...)
  // Комментарии с текстом «rateLimit: false» НЕ считаем — только код.
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const m = routeRe.exec(stripped);
  if (!m) {
    fail(`${relPath}: маршрут с rateLimit:false`, routeRe.toString());
    return;
  }
  ok(`${relPath}: rateLimit:false в config маршрута`, m[0].replace(/\s+/g, ' ').slice(0, 100));
}

assertRouteExempt(
  'src/routes/sse.js',
  /\.get\(\s*['"]\/stream['"]\s*,\s*\{\s*config\s*:\s*\{\s*rateLimit\s*:\s*false\s*\}\s*\}/
);
assertRouteExempt(
  'src/routes/push.js',
  /\.get\(\s*['"]\/vapid-key['"]\s*,\s*\{\s*config\s*:\s*\{\s*rateLimit\s*:\s*false\s*\}\s*\}/
);

for (const c of checks) {
  console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.extra ? '  — ' + c.extra : ''}`);
}
console.log(`\nитог: ${checks.filter((c) => c.pass).length}/${checks.length}`);
if (failures.length) {
  console.log('FAIL:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('SSE_VAPID_RATE_LIMIT_EXEMPT_OK');
