'use strict';
/**
 * Связывание звонка с контрагентом: чистые функции (без БД).
 * Проверяем нормализацию номеров, похожесть названий, извлечение ИНН.
 */
const assert = require('assert');
const link = require('../src/services/call-client-link');

const tests = [];
function test(name, fn) { tests.push({ name: 'client-link: ' + name, run: fn }); }

test('phoneTail: +7 917 … и 7917… дают один хвост', () => {
  assert.strictEqual(link.phoneTail('+7 (917) 530-02-67'), '9175300267');
  assert.strictEqual(link.phoneTail('79175300267'), '9175300267');
  assert.strictEqual(link.phoneTail('8 917 530 02 67'), '9175300267');
});

test('phoneTail: короткий номер → пусто (не мусорим)', () => {
  assert.strictEqual(link.phoneTail('12345'), '');
  assert.strictEqual(link.phoneTail(''), '');
  assert.strictEqual(link.phoneTail(null), '');
});

test('namesLookAlike: ООО и кавычки не мешают', () => {
  assert.ok(link.namesLookAlike('Крон-Сервис', 'ООО «Крон-Сервис»'));
  assert.ok(link.namesLookAlike('ООО "ГАЛА ЮГ"', 'ООО Гала Юг'));
});

test('namesLookAlike: разные компании → false', () => {
  assert.strictEqual(link.namesLookAlike('Крон-Сервис', 'Ямал Дорстрой'), false);
  assert.strictEqual(link.namesLookAlike('', 'Крон'), false);
});

test('extractInnFromText: находит ИНН 10 и 12 цифр', () => {
  const inns = link.extractInnFromText('Компания Крон, ИНН 8602123456, тел. +7 917 530 02 67');
  assert.ok(inns.includes('8602123456'));
  const ip = link.extractInnFromText('ИП Иванов ИНН 860212345678');
  assert.ok(ip.includes('860212345678'));
});

test('extractInnFromText: телефон не путается с ИНН', () => {
  // 11 цифр телефона (79175300267) — не ИНН (10 или 12).
  const inns = link.extractInnFromText('звоните 79175300267');
  assert.strictEqual(inns.length, 0);
});

test('extractInnFromText: пустой текст', () => {
  assert.deepStrictEqual(link.extractInnFromText(''), []);
  assert.deepStrictEqual(link.extractInnFromText(null), []);
});

let fail = 0;
for (const t of tests) {
  try { t.run(); console.log('PASS ' + t.name); }
  catch (e) { fail += 1; console.log('FAIL ' + t.name + ' -> ' + e.message); }
}
console.log(`\nИтог: ${tests.length - fail} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
