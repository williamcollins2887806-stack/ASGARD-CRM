'use strict';

/**
 * D-325: объект из темы письма и морфология в matchWork.
 * ═══════════════════════════════════════════════════════════════════════════
 * Кейс заказчика 21.10.2026: счёт АТЧ-26796 (Акватрио). Объект
 * «Новошахтинский НПЗ» был указан В ТЕМЕ письма, а не в PDF. Не подтянулся
 * по двум причинам:
 *   1. extractWorkHintFromSubject не резала формат «объект, счет №…» (запятая);
 *   2. matchWork не находил «Новошахтинский» в «(Новошахтинск)» — склонение.
 */

const assert = require('assert');
const { extractWorkHintFromSubject } = require('../src/services/doc-email-intake');

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log('  PASS', name); }
  catch (e) { fail++; console.log('  FAIL', name, '→', e.message); }
};

console.log('\n=== D-325: объект из темы ===');

check('формат с ЗАПЯТОЙ (кейс АТЧ-26796) режется', () => {
  const r = extractWorkHintFromSubject('Новошахтинский НПЗ, счет АТЧ-26796 от 21.10.26 Акватрио');
  assert.strictEqual(r, 'Новошахтинский НПЗ', 'получили: ' + JSON.stringify(r));
});

check('то же с префиксом Re:', () => {
  const r = extractWorkHintFromSubject('Re: Новошахтинский НПЗ, счет АТЧ-26796 от 21.10.26 Акватрио');
  assert.strictEqual(r, 'Новошахтинский НПЗ');
});

check('формат с ДВОЕТОЧИЕМ (старый кейс) не сломан', () => {
  const r = extractWorkHintFromSubject('Новошахтинский НПЗ: счет №KA-21297 от 19.10.2026');
  assert.strictEqual(r, 'Новошахтинский НПЗ');
});

check('формат с ТОЧКОЙ режется', () => {
  const r = extractWorkHintFromSubject('АГПЗ. Безопасность труда. Счёт №УТ-2357 от 21.10.2026');
  assert.strictEqual(r, 'АГПЗ. Безопасность труда', 'получили: ' + JSON.stringify(r));
});

check('«Офис» — категория, а не объект → отбрасывается', () => {
  assert.strictEqual(extractWorkHintFromSubject('Офис: Счет ООО Пресс Бюро от 16.10.2026'), null);
});

check('аббревиатура объекта НЕ отбрасывается (АГПЗ)', () => {
  assert.strictEqual(extractWorkHintFromSubject('АГПЗ, счет  BP-7784 от 19.10.2026 БАШПРОМ'), 'АГПЗ');
});

check('составной объект с аббревиатурой сохраняется', () => {
  const r = extractWorkHintFromSubject('МЛСП, Замена факельного оголовка: счет от WILDBERRIES');
  assert.strictEqual(r, 'МЛСП, Замена факельного оголовка');
});

console.log('\n=== D-325: морфология в matchWork ===');

// Читаем исходник — проверяем, что основа слова добавлена в пробы.
const fs = require('fs');
const src = fs.readFileSync(require.resolve('../src/services/contract-match.js'), 'utf8');

check('в matchWork добавлена основа слова (стемминг)', () => {
  assert.ok(/const stem = \(w\) =>/.test(src), 'нет функции stem()');
  assert.ok(/stem\(probeRaw\)/.test(src), 'stem не применяется к probeRaw');
  assert.ok(/ский\|цкий\|ской/.test(src), 'нет русских окончаний прилагательных');
});

check('пороги и дискриминаторы НЕ ослаблены', () => {
  // Было 0.4 для одиночного кандидата и 0.25 отрыва — должны остаться.
  assert.ok(/_score >= 0\.4\) return \{ found: true, work: top, reason: 'fuzzy_single'/.test(src),
    'порог fuzzy_single изменён — можем начать привязывать чужое');
  assert.ok(/_score >= 0\.6/.test(src), 'порог fuzzy_leader изменён');
});

console.log(`\nИТОГ: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
