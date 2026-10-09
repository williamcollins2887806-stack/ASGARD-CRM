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
test('U2', 'Хугинн: строка = иконка трубки → аватар → имя → время (как в ТГ)', () => {
  const dock = read('public/assets/js/huginn_dock.js');
  const fn = dock.slice(dock.indexOf('function renderCallsPanel'), dock.indexOf('function renderSettingsPanel'));
  assert.ok(/hg-call-dir/.test(fn), 'нет иконки-трубки направления');
  assert.ok(/CALL_DIR_ICO/.test(fn), 'нет набора SVG-иконок направления');
  assert.ok(/ph-ios-av/.test(fn), 'нет аватара');
  assert.ok(/ph-ios-when/.test(fn), 'нет времени в правом блоке');
  assert.ok(/ph-ios-right/.test(fn), 'нет правого блока');
  // Порядок в разметке: иконка направления раньше аватара.
  assert.ok(fn.indexOf('hg-call-dir') < fn.indexOf('ph-ios-av-wrap'),
    'иконка трубки должна идти перед аватаром (как в ТГ)');
});

test('U3', 'Хугинн: убраны бейджи источника, эмодзи и глиф на аватаре', () => {
  const dock = read('public/assets/js/huginn_dock.js');
  const fn = dock.slice(dock.indexOf('function renderCallsPanel'), dock.indexOf('function renderSettingsPanel'));
  assert.ok(!/hg-call-src/.test(fn), 'остался бейдж источника');
  assert.ok(!/hg-call-ico/.test(fn), 'осталась иконка-эмодзи типа');
  assert.ok(!/ph-ios-dir/.test(fn), 'стрелка-глиф на аватаре осталась (нужна отдельная иконка трубки)');
});

test('U4', 'Хугинн: подпись — тип звонка, время справа', () => {
  const dock = read('public/assets/js/huginn_dock.js');
  const fn = dock.slice(dock.indexOf('function renderCallsPanel'), dock.indexOf('function renderSettingsPanel'));
  assert.ok(/esc\(c\.detail\)/.test(fn), 'подпись не выводится');
  assert.ok(/fmtWhen\(c\.at\)/.test(fn), 'время не выводится');
});

test('U4b', 'Хугинн: чистый номер даёт иконку трубки, а не «+ (»', () => {
  const dock = read('public/assets/js/huginn_dock.js');
  assert.ok(/function callInitials/.test(dock), 'нет callInitials');
  assert.ok(/function callAvatarInner/.test(dock), 'нет callAvatarInner');
  const fn = dock.slice(dock.indexOf('function callInitials'), dock.indexOf('function callAvatarInner'));
  assert.ok(/A-Za-zА-Яа-яЁё/.test(fn), 'не проверяет наличие букв (для имён)');
  assert.ok(!/\+\' \+ d\.slice/.test(fn), 'всё ещё подставляет цифры вместо иконки');
});

test('U4c', 'Хугинн: номера форматируются и берутся из телефонии', () => {
  const dock = read('public/assets/js/huginn_dock.js');
  const fn = dock.slice(dock.indexOf('function renderCallsPanel'), dock.indexOf('function renderSettingsPanel'));
  assert.ok(/fmtPhone\(num\)/.test(fn), 'номер не форматируется');
  assert.ok(/\/api\/telephony\/calls/.test(fn), 'не подтягивает номера из телефонии (Mango)');
  assert.ok(/client_name/.test(fn), 'не использует имя клиента из CRM');
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
test('U7', 'CSS Хугинна: иконка трубки, аватар и время', () => {
  const css = read('public/assets/css/huginn_dock.css');
  assert.ok(/\.hg-call-dir/.test(css), 'нет стиля иконки-трубки');
  assert.ok(/\.hg-call-dir\.is-out/.test(css), 'нет цвета исходящего');
  assert.ok(/\.hg-call-dir\.is-missed/.test(css), 'нет цвета пропущенного');
  assert.ok(/\.hg-calls \.ph-ios-av-wrap/.test(css), 'нет стиля аватара');
  assert.ok(/\.hg-calls \.ph-ios-when/.test(css), 'нет стиля времени');
  assert.ok(/\.hg-calls \.ph-ios-right/.test(css), 'нет стиля правого блока');
});

test('U8', 'CSS Хугинна: не осталось правил удалённых классов', () => {
  const css = read('public/assets/css/huginn_dock.css');
  assert.ok(!/\.hg-call-ico\s*\{/.test(css), 'осталось правило .hg-call-ico');
  assert.ok(!/\.hg-call-arrow/.test(css), 'осталось правило .hg-call-arrow');
  assert.ok(!/\.hg-calls \.ph-ios-dir/.test(css), 'остался стиль глифа на аватаре');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
