'use strict';

/**
 * D-306: регрессия «список реестра падает 500 у всех ролей».
 * ═══════════════════════════════════════════════════════════════════════════
 * Причина была не в SQL, а в JS: список собирался как
 *   JOIN_SQL.replace('SELECT d.*,', `SELECT d.*, (${trafficSql('d')}) AS traffic,`)
 * В SQL светофора есть regex `trim(...) !~ '^[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.'` —
 * точнее, строка `'...$'`, и `String.prototype.replace` трактует `$'`
 * в СТРОКЕ-ЗАМЕНЕ как «весь остаток исходной строки». Из-за этого JOIN_SQL
 * вклеивался в середину SQL-выражения и Postgres отвечал
 * `syntax error at or near "no"` (колонка `e->>'no'`).
 *
 * Тест оффлайн: без БД, только проверка, что при подстановке выражения
 * светофора в SELECT исходный JOIN_SQL не дублируется и `$'` не съедает хвост.
 */

const assert = require('assert');
const traffic = require('../src/lib/doc-traffic');

const JOIN_SQL = `SELECT d.*,
  COALESCE(w.work_title, w.object_name) AS work_title,
  w.work_number AS work_number,
  uo.name AS doc_owner_name, up.name AS pm_name
 FROM doc_registry d
 LEFT JOIN works w ON w.id = d.work_id
 LEFT JOIN users uo ON uo.id = d.doc_owner_id
 LEFT JOIN users up ON up.id = d.pm_id`;

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log('  PASS', name); }
  catch (e) { fail++; console.log('  FAIL', name, '→', e.message); }
};

console.log('\n=== D-306: подстановка SQL светофора ===');

const expr = traffic.trafficSql('d');

check('в выражении светофора действительно есть $-последовательность $', () => {
  // именно это и ломало replace: `$'` в regex
  assert.ok(/\$'/.test(expr) || /\$/.test(expr), 'ожидалась $-последовательность в regex');
});

check('String.replace со строкой-заменой ПОДТАСОВЫВАЕТ хвост (демонстрация дефекта)', () => {
  const broken = JOIN_SQL.replace('SELECT d.*,', `SELECT d.*, (${expr}) AS traffic,`);
  // дефект: FROM doc_registry встретится дважды — значит хвост вклеен в выражение
  const cntFrom = (broken.match(/FROM doc_registry/g) || []).length;
  assert.ok(cntFrom >= 2, 'демонстрация: replace дублирует FROM (иначе тест бессмысленен)');
});

check('замена через функцию даёт РОВНО один FROM doc_registry', () => {
  const fixed = JOIN_SQL.replace('SELECT d.*,', () => `SELECT d.*, (${expr}) AS traffic,`);
  const cntFrom = (fixed.match(/FROM doc_registry/g) || []).length;
  assert.strictEqual(cntFrom, 1, 'FROM doc_registry продублирован');
});

check('замена через функцию сохраняет целостность выражения светофора', () => {
  const fixed = JOIN_SQL.replace('SELECT d.*,', () => `SELECT d.*, (${expr}) AS traffic,`);
  // выражение должно идти ДО первого FROM и не содержать самого FROM
  const idxTraffic = fixed.indexOf('AS traffic');
  const idxFrom = fixed.indexOf('FROM doc_registry');
  assert.ok(idxTraffic > 0 && idxTraffic < idxFrom, 'AS traffic должен быть до FROM');
  assert.ok(!fixed.slice(0, idxFrom).includes('FROM doc_registry'), 'внутри выражения не должно быть FROM');
});

check('баланс круглых скобок в итоговом SELECT', () => {
  const fixed = JOIN_SQL.replace('SELECT d.*,', () => `SELECT d.*, (${expr}) AS traffic,`);
  const head = fixed.slice(0, fixed.indexOf('FROM doc_registry'));
  const open = (head.match(/\(/g) || []).length;
  const close = (head.match(/\)/g) || []).length;
  assert.strictEqual(open, close, `дисбаланс скобок в SELECT: ( ${open} vs ) ${close}`);
});

check('в src/routes/doc-registry.js нет .replace() со строкой-заменой для JOIN_SQL', () => {
  const fs = require('fs');
  const src = fs.readFileSync(require.resolve('../src/routes/doc-registry.js'), 'utf8');
  assert.ok(!/JOIN_SQL\.replace\(\s*['"]SELECT d\.\*,[^)]*\)/.test(src) ||
    /JOIN_SQL\.replace\(\s*['"]SELECT d\.\*,\s*['"]\s*,\s*\(\)/.test(src),
    'JOIN_SQL.replace должен использовать функцию-замену, а не строку');
});

console.log(`\nИТОГ: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
