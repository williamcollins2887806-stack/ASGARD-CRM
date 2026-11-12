'use strict';
/**
 * Схлопывание повторных звонков одного номера в журнале.
 * Контракт: подряд идущие звонки одного номера в пределах 3 часов → одна
 * строка с count>1. Разные номера и звонки далеко по времени не склеиваются.
 */
const assert = require('assert');
const fs = require('fs');

// Извлекаем функцию из telephony.js (она самодостаточна, без DOM).
const src = fs.readFileSync('public/assets/js/telephony.js', 'utf8');
const start = src.indexOf('function groupRepeatedCalls(');
assert.ok(start > 0, 'groupRepeatedCalls должна существовать в telephony.js');
let depth = 0;
let end = -1;
for (let i = src.indexOf('{', start); i < src.length; i++) {
  if (src[i] === '{') depth++;
  else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
assert.ok(end > 0, 'не нашли конец функции');
const fnSrc = src.slice(start, end);
// eslint-disable-next-line no-new-func
const groupRepeatedCalls = new Function(fnSrc + '\nreturn groupRepeatedCalls;')();

const tests = [];
function test(name, fn) { tests.push({ name: 'repeat-calls: ' + name, run: fn }); }

const T = (h, m) => new Date(`2026-11-12T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+03:00`).toISOString();

test('два подряд звонка одного номера схлопываются', () => {
  const g = groupRepeatedCalls([
    { id: 2, call_type: 'inbound', client_number: '79535749436', created_at: T(16, 54), duration_seconds: 34 },
    { id: 1, call_type: 'inbound', client_number: '79535749436', created_at: T(16, 27), duration_seconds: 42 },
  ]);
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].count, 2);
  assert.strictEqual(g[0].totalDuration, 76);
  assert.strictEqual(g[0].lead.id, 2, 'первым показываем самый свежий');
});

test('разные номера не склеиваются', () => {
  const g = groupRepeatedCalls([
    { id: 2, call_type: 'inbound', client_number: '79535749436', created_at: T(16, 54) },
    { id: 1, call_type: 'inbound', client_number: '79654862200', created_at: T(16, 27) },
  ]);
  assert.strictEqual(g.length, 2);
});

test('звонки через 4 часа не склеиваются', () => {
  const g = groupRepeatedCalls([
    { id: 2, call_type: 'inbound', client_number: '79535749436', created_at: T(20, 0) },
    { id: 1, call_type: 'inbound', client_number: '79535749436', created_at: T(16, 0) },
  ]);
  assert.strictEqual(g.length, 2);
});

test('разное направление не склеивается', () => {
  const g = groupRepeatedCalls([
    { id: 2, call_type: 'outbound', client_number: '79535749436', created_at: T(16, 30) },
    { id: 1, call_type: 'inbound', client_number: '79535749436', created_at: T(16, 27) },
  ]);
  assert.strictEqual(g.length, 2);
});

test('три звонка дают count=3', () => {
  const g = groupRepeatedCalls([
    { id: 3, call_type: 'inbound', client_number: '79535749436', created_at: T(17, 0) },
    { id: 2, call_type: 'inbound', client_number: '79535749436', created_at: T(16, 54) },
    { id: 1, call_type: 'inbound', client_number: '79535749436', created_at: T(16, 27) },
  ]);
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].count, 3);
});

test('звонок без номера не теряется', () => {
  const g = groupRepeatedCalls([
    { id: 2, call_type: 'internal', created_at: T(16, 30) },
    { id: 1, call_type: 'inbound', client_number: '79535749436', created_at: T(16, 27) },
  ]);
  assert.strictEqual(g.length, 2);
});

test('пустой список не падает', () => {
  assert.deepStrictEqual(groupRepeatedCalls([]), []);
});

let fail = 0;
for (const t of tests) {
  try { t.run(); console.log('PASS ' + t.name); }
  catch (e) { fail += 1; console.log('FAIL ' + t.name + ' -> ' + e.message); }
}
console.log(`\nИтог: ${tests.length - fail} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
