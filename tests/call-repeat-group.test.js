'use strict';
/**
 * Схлопывание повторных звонков — ТОЛЬКО в панели дока (phone_ui.js).
 * Контракт: подряд идущие звонки одного номера в пределах 3 часов → одна
 * строка с count>1. Разные номера и звонки далеко по времени не склеиваются.
 * На странице /telephony журнал НЕ склеивается (оттуда открывается карточка).
 */
const assert = require('assert');
const fs = require('fs');

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start > 0, name + ' должна существовать');
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('не нашли конец ' + name);
}

const ui = fs.readFileSync('public/assets/js/phone_ui.js', 'utf8');
const fnSrc = extractFn(ui, 'groupRepeatedRows') + '\n' + extractFn(ui, 'rowPhoneTail');
// eslint-disable-next-line no-new-func
const build = new Function(fnSrc + '\nreturn { groupRepeatedRows, rowPhoneTail };')();
const groupRepeatedRows = build.groupRepeatedRows;

// Журнал не должен склеивать — этой функции там больше нет.
const journal = fs.readFileSync('public/assets/js/telephony.js', 'utf8');
assert.ok(!/function groupRepeatedCalls\(/.test(journal),
  'журнал /telephony НЕ должен схлопывать строки');

const tests = [];
function test(name, fn) { tests.push({ name: 'dock-repeat: ' + name, run: fn }); }

const T = (h, m) => new Date(`2026-11-12T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+03:00`).toISOString();

test('два подряд звонка одного номера схлопываются', () => {
  const g = groupRepeatedRows([
    { id: 2, call_type: 'inbound', direction: 'inbound', from_number: '79535749436', created_at: T(16, 54), duration_seconds: 34 },
    { id: 1, call_type: 'inbound', direction: 'inbound', from_number: '79535749436', created_at: T(16, 27), duration_seconds: 42 },
  ]);
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].count, 2);
  assert.strictEqual(g[0].totalDuration, 76);
  assert.strictEqual(g[0].lead.id, 2);
});

test('разные номера не склеиваются', () => {
  const g = groupRepeatedRows([
    { id: 2, direction: 'inbound', from_number: '79535749436', created_at: T(16, 54) },
    { id: 1, direction: 'inbound', from_number: '79654862200', created_at: T(16, 27) },
  ]);
  assert.strictEqual(g.length, 2);
});

test('через 4 часа не склеиваются', () => {
  const g = groupRepeatedRows([
    { id: 2, direction: 'inbound', from_number: '79535749436', created_at: T(20, 0) },
    { id: 1, direction: 'inbound', from_number: '79535749436', created_at: T(16, 0) },
  ]);
  assert.strictEqual(g.length, 2);
});

test('разное направление не склеивается', () => {
  const g = groupRepeatedRows([
    { id: 2, direction: 'outbound', to_number: '79535749436', created_at: T(16, 30) },
    { id: 1, direction: 'inbound', from_number: '79535749436', created_at: T(16, 27) },
  ]);
  assert.strictEqual(g.length, 2);
});

test('три звонка → count=3', () => {
  const g = groupRepeatedRows([
    { id: 3, direction: 'inbound', from_number: '79535749436', created_at: T(17, 0) },
    { id: 2, direction: 'inbound', from_number: '79535749436', created_at: T(16, 54) },
    { id: 1, direction: 'inbound', from_number: '79535749436', created_at: T(16, 27) },
  ]);
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].count, 3);
});

test('звонок без номера не теряется', () => {
  const g = groupRepeatedRows([
    { id: 2, direction: 'internal', created_at: T(16, 30) },
    { id: 1, direction: 'inbound', from_number: '79535749436', created_at: T(16, 27) },
  ]);
  assert.strictEqual(g.length, 2);
});

test('журнал /telephony не склеивает строки (карточка должна открываться)', () => {
  assert.ok(!/groupRepeatedCalls/.test(journal));
});

test('пустой список не падает', () => {
  assert.deepStrictEqual(groupRepeatedRows([]), []);
});

let fail = 0;
for (const t of tests) {
  try { t.run(); console.log('PASS ' + t.name); }
  catch (e) { fail += 1; console.log('FAIL ' + t.name + ' -> ' + e.message); }
}
console.log(`\nИтог: ${tests.length - fail} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
