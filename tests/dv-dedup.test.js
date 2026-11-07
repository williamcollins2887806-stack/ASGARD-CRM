'use strict';
/**
 * Дедупликация позиций при доборе.
 *
 * Дефект 07.11 (тендер 2138): при доборе модель начинала ведомость заново,
 * и одна строка повторялась до 39 раз — 224 лишние позиции из 364.
 */
const assert = require('assert');
const { dupKey } = require('../src/services/mimir-tender-stages-ai');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

check('одинаковая позиция даёт одинаковый ключ', () => {
  const a = { name: 'Гидрочистка трубок цеха 9', volume: 7200, unit: 'п.м' };
  const b = { name: 'Гидрочистка трубок цеха 9', volume: 7200, unit: 'п.м' };
  assert.strictEqual(dupKey(a), dupKey(b));
});

check('различия в пробелах и регистре не мешают', () => {
  const a = { name: 'Гидрочистка  трубок  цеха 9', volume: 7200, unit: 'П.М' };
  const b = { name: 'гидрочистка трубок цеха 9', volume: 7200, unit: 'п.м' };
  assert.strictEqual(dupKey(a), dupKey(b), dupKey(a) + ' != ' + dupKey(b));
});

check('кавычки не мешают', () => {
  const a = { name: 'Чистка аппарата «BORZIG»', volume: 816, unit: 'м²' };
  const b = { name: 'Чистка аппарата BORZIG', volume: 816, unit: 'м²' };
  assert.strictEqual(dupKey(a), dupKey(b));
});

check('разные объёмы — разные позиции', () => {
  const a = { name: 'Чистка трубок', volume: 7200, unit: 'п.м' };
  const b = { name: 'Чистка трубок', volume: 9666, unit: 'п.м' };
  assert.notStrictEqual(dupKey(a), dupKey(b));
});

check('разные единицы — разные позиции', () => {
  const a = { name: 'Чистка', volume: 100, unit: 'м²' };
  const b = { name: 'Чистка', volume: 100, unit: 'м³' };
  assert.notStrictEqual(dupKey(a), dupKey(b));
});

check('разные названия — разные позиции', () => {
  const a = { name: 'Чистка конденсатора 3/13', volume: 9666, unit: 'п.м' };
  const b = { name: 'Чистка конденсатора 3/14', volume: 9666, unit: 'п.м' };
  assert.notStrictEqual(dupKey(a), dupKey(b));
});

check('позиция без объёма не схлопывается с позицией с объёмом', () => {
  const a = { name: 'Чистка', volume: null, unit: 'м³' };
  const b = { name: 'Чистка', volume: 100, unit: 'м³' };
  assert.notStrictEqual(dupKey(a), dupKey(b));
});

check('имитация добора: 39 повторов схлопываются в 1', () => {
  // Ровно то, что было в 2138: одна строка, повторённая 39 раз.
  const one = { name: 'Гидродинамическая чистка трубок цеха 9/бут (поз.199–244) — испарители', volume: 7200, unit: 'п.м трубок' };
  const collected = [];
  const seen = new Set();
  for (let i = 0; i < 39; i += 1) {
    const k = dupKey(one);
    if (seen.has(k)) continue;
    seen.add(k);
    collected.push(one);
  }
  assert.strictEqual(collected.length, 1, 'получилось ' + collected.length);
});

check('пустая позиция не падает', () => {
  assert.ok(typeof dupKey({}) === 'string');
  assert.ok(typeof dupKey(null) === 'string');
});

check('normalizeDv схлопывает дубли внутри одного ответа', () => {
  // Дефект 07.11 (тендер 2138): модель повторяла позицию 39 раз.
  const stages = require('../src/services/mimir-tender-stages');
  const catalog = { categories: [{ code: 'tubes', methods_json: [{ code: 'gdo' }] }] };
  const p = { name: 'Чистка теплообменника 2104L', volume: 5474.91, unit: 'п.м', category_code: 'tubes', method_code: 'gdo' };
  const dv = stages.normalizeDv({ positions: [p, { ...p }, { ...p }] }, catalog);
  assert.strictEqual(dv.positions.length, 1, 'дубли не схлопнуты: ' + dv.positions.length);
});

check('нормализация различает разные аппараты с равным объёмом', () => {
  const stages = require('../src/services/mimir-tender-stages');
  const catalog = { categories: [{ code: 'tubes', methods_json: [{ code: 'gdo' }] }] };
  const dv = stages.normalizeDv({
    positions: [
      { name: 'Чистка конденсатора 3/13', volume: 9666, unit: 'п.м', category_code: 'tubes', method_code: 'gdo' },
      { name: 'Чистка конденсатора 3/14', volume: 9666, unit: 'п.м', category_code: 'tubes', method_code: 'gdo' }
    ]
  }, catalog);
  assert.strictEqual(dv.positions.length, 2, 'разные аппараты схлопнуты');
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
