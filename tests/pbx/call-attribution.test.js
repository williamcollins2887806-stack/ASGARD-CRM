'use strict';

/**
 * Регрессия 09.10.2026: «нет звонков, когда я звонил».
 *
 * Две причины:
 *  1) Исходящие из браузера (from-internal) не привязывались к оператору:
 *     dialplan не передавал вызывающего, user_id в call_history оставался NULL,
 *     поэтому журнал «мои звонки» (scope=mine) не показывал их.
 *  2) hasFullCallView не включала PM/HEAD_PM — РП не видел звонков компании.
 *
 * Usage: node tests/pbx/call-attribution.test.js
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

console.log('call-attribution');

test('A1', 'dialplan шлёт оператора (CHANNEL(endpoint)) в finalize', () => {
  const dp = read('ops/asterisk/extensions_asgard.conf');
  const frm = dp.slice(dp.indexOf('[from-internal]'));
  assert.ok(/ASGARD_OP_USER=\$\{CHANNEL\(endpoint\)\}/.test(frm), 'оператор не берётся из endpoint');
  assert.ok(/ASGARD_OUT_NUMBER=\$\{EXTEN/.test(frm), 'номер не сохраняется');
  assert.ok(/\\"operator\\":\\"\$\{ASGARD_OP_USER\}\\"/.test(frm), 'operator не уходит в finalize');
  assert.ok(/\\"number\\":\\"\$\{ASGARD_OUT_NUMBER\}\\"/.test(frm), 'number не уходит в finalize');
  assert.ok(/\\"direction\\":\\"outbound\\"/.test(frm), 'direction не уходит в finalize');
});

test('A2', 'finalizeRecording принимает оператора и пишет user_id', () => {
  const js = read('src/pbx/recording.js');
  assert.ok(/opts\.operator/.test(js), 'не читает opts.operator');
  assert.ok(/u\(\\d\+\)/.test(js), 'не разбирает u<user_id>');
  assert.ok(/user_id = COALESCE\(user_id, \$4\)/.test(js), 'UPDATE не проставляет user_id');
  assert.ok(/answered_by = COALESCE\(answered_by, \$4\)/.test(js), 'UPDATE не проставляет answered_by');
  assert.ok(/from_number = COALESCE\(from_number, \$7\)/.test(js), 'UPDATE не проставляет from_number');
  assert.ok(/to_number = COALESCE\(to_number, \$8\)/.test(js), 'UPDATE не проставляет to_number');
});

test('A3', 'INSERT страховочной строки тоже содержит user_id и номера', () => {
  const js = read('src/pbx/recording.js');
  const ins = js.slice(js.indexOf('INSERT INTO call_history'), js.indexOf('pg_notify'));
  assert.ok(/user_id, answered_by/.test(ins), 'INSERT без user_id/answered_by');
  assert.ok(/from_number, to_number/.test(ins), 'INSERT без номеров');
});

test('A4', 'AMI-дублёр извлекает оператора из имени канала PJSIP/u<id>', () => {
  const js = read('src/pbx/index.js');
  assert.ok(/PJSIP\\\\\/\(u\\d\+\)-/.test(js) || /PJSIP\\\/\(u\\d\+\)-/.test(js),
    'нет разбора имени канала на оператора');
  assert.ok(/operator: mop \? mop\[1\] : null/.test(js), 'оператор не передаётся в finalize');
});

test('A5', 'PM/HEAD_PM видят журнал компании (hasFullCallView)', () => {
  const js = read('src/lib/telephony-access.js');
  assert.ok(/'HEAD_PM', 'PM'/.test(js), 'PM не добавлены в TEL_FULL_VIEW_ROLES');
});

test('A6', 'журнал scope=mine всё ещё фильтрует по user_id/answered_by', () => {
  const js = read('src/routes/telephony-pbx.js');
  assert.ok(/user_id = \$2 OR answered_by = \$2/.test(js), 'потерян фильтр «мои звонки»');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
