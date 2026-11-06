'use strict';
/**
 * Распаковка RTF.
 *
 * Дефект 06.11.2026 (тендер 2158, «Т-101 чистка трубок.rtf»):
 * в БД лежало 100 000 символов сырой RTF-разметки — 11 538 управляющих
 * команд и ни одного читаемого слова. Документ с объёмами считался
 * распознанным и уходил в промпт мусором.
 */
const assert = require('assert');
const { rtfToText, rtfJunkRatio } = require('../src/services/rtf-text');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

// Реальный фрагмент структуры того файла (проверено на продакшене).
const REAL = Buffer.from(
  String.raw`{\rtf1\adeflang1025\ansi\ansicpg1251\uc1\deff0\deflang1049` +
  String.raw`{\fonttbl{\f0\fbidi \froman\fcharset204 Times New Roman;}}{\colortbl ;}` +
  String.raw`{\*\generator Riched20 10.0.19041;}\viewkind4\pard\sa200\sl276\slmult1` +
  String.raw`\lang1049\f0\fs22 \'d2\'e5\'f5\'ed\'e8\'f7\'e5\'f1\'ea\'ee\'e5 \'e7\'e0\'e4\'e0\'ed\'e8\'e5\par` +
  String.raw`\'d4\'e5\'e0\'ed\'ee\'e2 \'e0\'ef\'e0\'f0\'e0\'f2\'ee\'e2: 12 \'f8\'f2\par` +
  String.raw`\'cf\'eb\'ee\'f9\'e0\'e4\'fc \'ef\'ee\'e2\'e5\'f0\'f5\'ed\'ee\'f1\'f2\'e8: 3400 \'ec2\par` +
  `}`,
  'latin1'
);

check('русский текст из \\\'xx извлекается', () => {
  const t = rtfToText(REAL);
  assert.ok(/Техническое задание/.test(t), 'нет заголовка, получено: ' + t.slice(0, 120));
  assert.ok(/12 шт/.test(t), 'нет «12 шт», получено: ' + t.slice(0, 200));
  assert.ok(/3400/.test(t), 'нет объёма 3400');
});

check('команды разметки не остаются', () => {
  const t = rtfToText(REAL);
  assert.strictEqual(rtfJunkRatio(t), 0, 'в тексте остались RTF-команды: ' + t.slice(0, 200));
  assert.ok(!/\\rtf|\\ansi|\\fonttbl/.test(t), 'служебные слова попали в текст');
});

check('метаданные (\\*\\generator, fonttbl, colortbl) выбрасываются', () => {
  const t = rtfToText(REAL);
  assert.ok(!/Riched20|Times New Roman/.test(t), 'метаданные попали в текст: ' + t.slice(0, 200));
});

check('юникод \\uNNNN разбирается', () => {
  const rtf = Buffer.from(String.raw`{\rtf1\ansi \u1058?\u1077?\u1089?\u1090?`, 'latin1');
  const t = rtfToText(rtf);
  assert.ok(/Тест/.test(t), 'юникод не разобран: ' + t);
});

check('абзацы \\par дают переводы строк', () => {
  const t = rtfToText(REAL);
  assert.ok(t.split('\n').length >= 2, 'нет переводов строк: ' + JSON.stringify(t));
});

check('не-RTF текст возвращается как есть', () => {
  const plain = Buffer.from('Обычный текст ведомости объёмов', 'utf-8');
  assert.ok(/Обычный текст/.test(rtfToText(plain)));
});

check('пустой вход не падает', () => {
  assert.strictEqual(rtfToText(''), '');
  assert.strictEqual(rtfToText(Buffer.alloc(0)), '');
});

check('\\tab и \\cell не склеивают слова', () => {
  // Русский — через \'xx, как в настоящем RTF (latin1-строка не портит байты).
  const rtf = Buffer.from(String.raw`{\rtf1\ansi \'ce\'e1\'fa\'b8\'ec\tab 500\cell \'ec3\cell }`, 'latin1');
  const t = rtfToText(rtf);
  assert.ok(/Объём/.test(t), 'текст потерян: ' + JSON.stringify(t));
  assert.ok(/\t?500/.test(t), 'значение 500 потеряно: ' + JSON.stringify(t));
  assert.ok(!/Объём500/.test(t), 'слова склеились: ' + JSON.stringify(t));
});

check('чужая кодировка (cp1252) определяется', () => {
  const rtf = Buffer.from(String.raw`{\rtf1\ansi\ansicpg1252 Caf\'e9}`, 'latin1');
  const t = rtfToText(rtf);
  assert.ok(/Caf/.test(t), 'текст потерян: ' + t);
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
