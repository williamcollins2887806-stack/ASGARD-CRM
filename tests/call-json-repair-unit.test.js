'use strict';
// Проверка _repairTruncatedJson: модель обрезает JSON на maxTokens.
const CallAnalyzer = require('../src/services/call-analyzer');

const a = new CallAnalyzer({}, { query: async () => ({ rows: [] }) });

const cases = [
  ['{"is_target":true,"summary":"обрезано', 'незакрытая строка'],
  ['{"is_target":true,"summary":"ok","next_steps":["a","b', 'обрезанный массив'],
  ['{"a":1,"b":{"c":2', 'вложенный объект'],
  ['{"is_target":true,"summary":"ok",', 'висячая запятая'],
];

let ok = 0;
let fail = 0;
for (const [raw, label] of cases) {
  const r = a._parseResponse(raw);
  const good = r && !r._parseError;
  console.log((good ? 'PASS ' : 'FAIL ') + label + (good ? '' : ' -> parse error'));
  if (good) ok += 1; else fail += 1;
}
console.log(`\nИтог: ${ok} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
