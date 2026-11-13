'use strict';
/**
 * Спикеры в субтитрах: каналы L/R и ФИО после перевода.
 * Проверяем контракт отрисовки (логика из telephony.js).
 */
const assert = require('assert');

const tests = [];
function test(name, fn) { tests.push({ name: 'speakers: ' + name, run: fn }); }

// Воспроизводим резолв подписи из renderDetailBody.
function resolveLabel(call, seg) {
  var idx = seg.speaker_css != null ? seg.speaker_css : normalize(seg);
  // Мёртвая зона перевода: speaker=null и нет transfer-метки — «Спикер»,
  // канал R не должен «поднять» его до оператора.
  if (idx == null && seg.transfer_speaker !== true) return 'Спикер';

  var ch = String(seg.channel || '').toUpperCase();
  var hasTransfer = seg.transfer_speaker === true || (typeof idx === 'number' && idx >= 2);
  if (ch === 'L') idx = 0;
  else if (ch === 'R' && !hasTransfer) idx = 1;

  var rawLabel = seg.speakerLabel || seg.speaker_label || null;
  if (rawLabel && !/^(оператор|клиент|спикер|абонент)$/i.test(String(rawLabel).trim())) {
    return rawLabel;
  }
  if (idx === 1) return call.manager_name || 'Оператор';
  if (idx === 0) return clientLabel(call);
  return 'Спикер';
}

function normalize(seg) {
  var s = seg && seg.speaker;
  if (typeof s === 'number') return s;
  if (typeof s === 'string') {
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    var m = /^SPEAKER[_\s-]?(\d+)$/i.exec(s.trim());
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

function clientLabel(call) {
  var OWN = /асгард\s*(crm|сервис|service)/i;
  var company = String(call.caller_company || '').trim();
  if (company && !OWN.test(company)) return company;
  var name = String(call.caller_name || call.client_name || '').trim();
  if (name && !OWN.test(name)) return name;
  return 'Клиент';
}

test('канал L → клиент, даже если speaker=1', () => {
  const call = { manager_name: 'Андросов Н.А.', caller_company: 'Крон-Сервис' };
  assert.strictEqual(resolveLabel(call, { channel: 'L', speaker: 1 }), 'Крон-Сервис');
});

test('канал R без перевода → ФИО оператора, не «Асгард CRM»', () => {
  const call = { manager_name: 'Андросов Н.А.', caller_company: 'Асгард CRM' };
  assert.strictEqual(resolveLabel(call, { channel: 'R', speaker: 1 }), 'Андросов Н.А.');
});

test('канал R ПОСЛЕ перевода → ФИО второго сотрудника', () => {
  const call = { manager_name: 'Андросов Н.А.' };
  const seg = { channel: 'R', speaker: 2, speakerLabel: 'Иванова Е.В.', transfer_speaker: true };
  assert.strictEqual(resolveLabel(call, seg), 'Иванова Е.В.');
});

test('канал R + transfer_speaker без явного ФИО → не сбрасывается в оператора', () => {
  const call = { manager_name: 'Андросов Н.А.' };
  const seg = { channel: 'R', speaker: 3, transfer_speaker: true };
  // Без ФИО остаётся нейтральный «Спикер», но НЕ первый оператор.
  assert.notStrictEqual(resolveLabel(call, seg), 'Андросов Н.А.');
});

test('мёртвая зона перевода → «Спикер»', () => {
  const call = { manager_name: 'Андросов Н.А.' };
  assert.strictEqual(resolveLabel(call, { channel: 'R', speaker: null }), 'Спикер');
});

test('клиент «Асгард CRM» не показывается — нейтрально', () => {
  const call = { caller_company: 'Асгард CRM' };
  assert.strictEqual(resolveLabel(call, { channel: 'L', speaker: 0 }), 'Клиент');
});

test('snake_case speaker_label тоже читается', () => {
  const call = { manager_name: 'X' };
  assert.strictEqual(resolveLabel(call, { channel: 'R', speaker: 1, speaker_label: 'Петров П.П.' }), 'Петров П.П.');
});

let fail = 0;
for (const t of tests) {
  try { t.run(); console.log('PASS ' + t.name); }
  catch (e) { fail += 1; console.log('FAIL ' + t.name + ' -> ' + e.message); }
}
console.log(`\nИтог: ${tests.length - fail} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
