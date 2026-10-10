'use strict';

/**
 * Регрессия 10.10.2026: «нажимаю на мобильный — db.connect is not a function».
 *
 * Причина: src/services/db.js экспортирует pool/query/transaction, но НЕ connect.
 * claimLine() в src/pbx/line-claim.js звал `await db.connect()` → падал →
 * /operator/claim-line отвечал 409/500, оператор не мог встать на линию.
 * Тот же класс ошибки уже был в src/routes/inbox_applications_ai.js (комментарий
 * "db.connect не существует, надо db.pool.connect").
 *
 * Usage: node tests/pbx/line-claim-db.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
let passed = 0;
let failed = 0;
function test(id, name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${id} ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${id} ${name}: ${e.message}`); }
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

console.log('line-claim-db');

test('L1', 'db.js НЕ экспортирует connect (правило проекта)', () => {
  const js = read('src/services/db.js');
  const mod = js.slice(js.indexOf('module.exports'));
  assert.ok(/pool,/.test(mod), 'pool должен экспортироваться');
  assert.ok(!/^\s*connect[,:]/m.test(mod.split('module.exports')[1]),
    'db.js не должен экспортировать connect — вызывающий обязан использовать pool.connect');
});

test('L2', 'line-claim не зовёт db.connect напрямую', () => {
  const js = read('src/pbx/line-claim.js');
  assert.ok(!/await\s+db\.connect\(\)/.test(js),
    'прямой db.connect() снова сломает вставание на линию');
});

test('L3', 'line-claim идёт через pool.connect с фолбэком', () => {
  const js = read('src/pbx/line-claim.js');
  assert.ok(/getPool\(db\)\.connect\(\)/.test(js), 'нет вызова через getPool');
  assert.ok(/db\.pool\.connect/.test(js), 'нет фолбэка на db.pool.connect');
  assert.ok(/is not a function/.test(js), 'нет понятной ошибки при отсутствии обоих');
});

test('L4', 'getPool принимает и Pool, и {pool}', () => {
  const js = read('src/pbx/line-claim.js');
  const fn = js.slice(js.indexOf('function getPool'), js.indexOf('async function claimLine'));
  assert.ok(/typeof db\.connect === 'function'/.test(fn), 'не проверяет прямой connect');
  assert.ok(/db\.pool/.test(fn), 'не проверяет db.pool');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
