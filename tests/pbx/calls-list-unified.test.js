'use strict';

/**
 * Унификация журналов звонков под образец телефонной панели (скриншот 09.10):
 * аватар с глифом направления, название, подпись (тип + длительность),
 * справа — время. Никаких источников/бейджей/иконок-duration.
 *
 * Образец: public/assets/js/phone_ui.js → callRowHtml (классы .ph-ios-*).
 *
 * Usage: node tests/pbx/calls-list-unified.test.js
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

console.log('calls-list-unified');

// ── Образец ──
test('U1', 'образец: phone_ui использует .ph-ios-row с аватаром и глифом', () => {
  const ui = read('public/assets/js/phone_ui.js');
  const row = ui.slice(ui.indexOf('function callRowHtml'), ui.indexOf('function fmtWhen'));
  assert.ok(/class="ph-dp-row ph-ios-row/.test(row), 'нет .ph-ios-row');
  assert.ok(/ph-ios-av-wrap/.test(row), 'нет аватара');
  assert.ok(/ph-ios-right/.test(row), 'нет правого блока');
  assert.ok(/ph-ios-when/.test(row), 'нет времени справа');
});

// ── Huginn ──
test('U2', 'Хугинн: строка звонка использует ту же разметку, что образец', () => {
  const dock = read('public/assets/js/huginn_dock.js');
  const fn = dock.slice(dock.indexOf('function renderCallsPanel'), dock.indexOf('function renderSettingsPanel'));
  assert.ok(/hg-call-row ph-ios-row/.test(fn), 'нет .ph-ios-row');
  assert.ok(/ph-ios-av-wrap/.test(fn), 'нет аватара как в образце');
  assert.ok(/ph-ios-av/.test(fn), 'нет круга-аватара');
  assert.ok(/ph-ios-dir/.test(fn), 'нет глифа направления');
  assert.ok(/ph-ios-when/.test(fn), 'нет времени в правом блоке');
  assert.ok(/ph-ios-right/.test(fn), 'нет правого блока');
});

test('U3', 'Хугинн: убраны бейджи источника и иконка типа', () => {
  const dock = read('public/assets/js/huginn_dock.js');
  const fn = dock.slice(dock.indexOf('function renderCallsPanel'), dock.indexOf('function renderSettingsPanel'));
  assert.ok(!/hg-call-src/.test(fn), 'остался бейдж источника');
  assert.ok(!/hg-call-ico/.test(fn), 'осталась иконка-эмодзи типа');
  assert.ok(!/kindIco/.test(fn), 'осталась переменная иконки типа');
});

test('U4', 'Хугинн: подпись — тип звонка, время справа', () => {
  const dock = read('public/assets/js/huginn_dock.js');
  const fn = dock.slice(dock.indexOf('function renderCallsPanel'), dock.indexOf('function renderSettingsPanel'));
  assert.ok(/esc\(c\.detail\)/.test(fn), 'подпись не выводится');
  assert.ok(/fmtWhen\(c\.at\)/.test(fn), 'время не выводится');
});

// ── Мобильный ──
test('U5', 'мобильный: подпись — тип + длительность, время справа', () => {
  const row = read('public/mobile-app/src/components/telephony/CallRow.jsx');
  assert.ok(/Пропущенный.*Исходящий.*Входящий/s.test(row), 'нет типа звонка в подписи');
  assert.ok(/formatDuration\(row\.duration_seconds/.test(row), 'нет длительности в подписи');
  assert.ok(/formatCallTime\(row\.created_at\)/.test(row), 'нет времени');
});

test('U6', 'мобильный: убраны английские answered/percent-стили', () => {
  const row = read('public/mobile-app/src/components/telephony/CallRow.jsx');
  assert.ok(!/answered -/.test(row), 'осталось «answered -»');
  assert.ok(!/opacity: 0\.7/.test(row), 'осталась приглушённая подпись');
});

// ── CSS ──
test('U7', 'CSS Хугинна: аватар/глиф/время как в образце', () => {
  const css = read('public/assets/css/huginn_dock.css');
  assert.ok(/\.hg-calls \.ph-ios-av-wrap/.test(css), 'нет стиля аватара');
  assert.ok(/\.hg-calls \.ph-ios-dir/.test(css), 'нет стиля глифа');
  assert.ok(/\.hg-calls \.ph-ios-when/.test(css), 'нет стиля времени');
  assert.ok(/\.hg-calls \.ph-ios-right/.test(css), 'нет стиля правого блока');
});

test('U8', 'CSS Хугинна: не осталось правил удалённых классов', () => {
  const css = read('public/assets/css/huginn_dock.css');
  assert.ok(!/\.hg-call-ico\s*\{/.test(css), 'осталось правило .hg-call-ico');
  assert.ok(!/\.hg-call-arrow/.test(css), 'осталось правило .hg-call-arrow');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
