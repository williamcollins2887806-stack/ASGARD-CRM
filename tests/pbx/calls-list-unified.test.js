'use strict';

/**
 * Унификация журналов звонков под образец телефонной панели.
 *
 * Канон 09.10 (правка после скриншотов): «Звонки» и «Телефон» — ОДНА вкладка.
 * Рейл содержит одну кнопку data-hg-tab="phone" (title «Звонки»), а журнал
 * Хугинна + телефонии рендерит ЕДИНЫЙ образец phone_ui.js → callRowHtml
 * (классы .ph-ios-*): аватар с глифом направления, имя, подпись (тип + канал),
 * время справа. Отдельного дубля renderCallsPanel в huginn_dock.js нет.
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

// ── Единая вкладка ──
test('U2', 'Хугинн: вкладка «Звонки» рендерится ЕДИНЫМ образцом phone_ui', () => {
  const dock = read('public/assets/js/huginn_dock.js');
  assert.ok(/state\.tab === 'calls' \|\| state\.tab === 'phone'/.test(dock),
    'нет маршрутизации calls/phone в один рендерер');
  assert.ok(/global\.AsgardPhoneUI && typeof global\.AsgardPhoneUI\.renderPanel/.test(dock),
    'вкладка звонков не делегирует в AsgardPhoneUI.renderPanel');
  // Дубль удалён: отдельного рендерера журнала в доке быть не должно.
  assert.ok(!/function renderCallsPanel/.test(dock), 'остался дубль renderCallsPanel');
});

test('U3', 'Хугинн: одна кнопка рейла «Звонки» (нет отдельного таба «Телефон»)', () => {
  const dock = read('public/assets/js/huginn_dock.js');
  assert.ok(/data-hg-tab="phone" title="Звонки"/.test(dock), 'нет единой кнопки «Звонки»');
  assert.ok(!/hg-rail-btn--phone/.test(dock), 'осталась вторая кнопка «Телефон»');
  assert.ok(!/data-hg-tab="calls"/.test(dock), 'осталась кнопка-дубль data-hg-tab="calls"');
});

test('U4', 'образец: подпись — тип звонка + канал (Хугинн/Манго), время справа', () => {
  const ui = read('public/assets/js/phone_ui.js');
  const row = ui.slice(ui.indexOf('function callRowHtml'), ui.indexOf('function fmtWhen'));
  assert.ok(/Пропущенный/.test(row) && /Исходящий/.test(row) && /Входящий/.test(row),
    'нет типа звонка в подписи');
  assert.ok(/ph-ios-src/.test(row) && /Хугинн/.test(row) && /Манго/.test(row),
    'нет бейджа канала (Хугинн/Манго)');
  assert.ok(/fmtWhen\(it\.created_at\)/.test(row), 'время не выводится');
});

test('U4b', 'initialsFrom: чистый номер НЕ даёт «+ (» и не фабрикует цифры', () => {
  const ui = read('public/assets/js/phone_ui.js');
  const i = ui.indexOf('function initialsFrom');
  const fn = ui.slice(i, ui.indexOf('function avatarInner'));
  assert.ok(/A-Za-zА-Яа-яЁё/.test(fn), 'не проверяет наличие букв (для имён)');
  // initialsFrom не должен возвращать цифры — иначе в круге висело «55».
  assert.ok(!/slice\(-2\)/.test(fn), 'initialsFrom снова подставляет последние цифры («55»)');
});

test('U4b2', 'avatarHtml: для неизвестного номера цветной кружок с цифрами (как в Контактах)', () => {
  const ui = read('public/assets/js/phone_ui.js');
  const i = ui.indexOf('function avatarHtml');
  const blk = ui.slice(i, i + 1200);
  assert.ok(/avatarColor\(/.test(blk), 'нет цвета по имени/номеру (как в Контактах)');
  assert.ok(/slice\(-2\)/.test(blk), 'нет цифр для неизвестного номера');
  assert.ok(/background:/.test(blk), 'нет цветного фона кружка');
});

test('U4c', 'образец: номера форматируются и берутся из телефонии (Mango)', () => {
  const ui = read('public/assets/js/phone_ui.js');
  const row = ui.slice(ui.indexOf('function callRowHtml'), ui.indexOf('function fmtWhen'));
  assert.ok(/fmtPhone\(num \|\| ''\)/.test(row), 'номер не форматируется');
  assert.ok(/it\.caller_name \|\| it\.client_name/.test(row), 'не использует имя звонящего из CRM');
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
test('U7', 'CSS Хугинна: аватар, время и бейдж канала в едином журнале', () => {
  const css = read('public/assets/css/phone.css');
  assert.ok(/\.ph-ios-av-wrap/.test(css), 'нет стиля аватара');
  assert.ok(/\.ph-ios-when/.test(css), 'нет стиля времени');
  assert.ok(/\.ph-ios-right/.test(css), 'нет стиля правого блока');
  assert.ok(/\.ph-ios-src\.is-huginn/.test(css) && /\.ph-ios-src\.is-mango/.test(css),
    'нет стилей бейджа канала Хугинн/Манго');
});

test('U8', 'CSS: не осталось правил удалённого дубля журнала', () => {
  const css = read('public/assets/css/huginn_dock.css');
  assert.ok(!/\.hg-call-ico\s*\{/.test(css), 'осталось правило .hg-call-ico');
  assert.ok(!/\.hg-call-arrow/.test(css), 'осталось правило .hg-call-arrow');
  assert.ok(!/\.hg-calls \.ph-ios-dir/.test(css), 'остался стиль глифа на аватаре');
  // Латинские селекторы удалённой разметки ЖУРНАЛА (не оверлея .hg-call-*):
  // .hg-calls / .hg-call-row / .hg-call-dir / .hg-call-sub
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/\.hg-calls\b/.test(code), 'остался orphan-селектор .hg-calls');
  assert.ok(!/\.hg-call-row\b/.test(code), 'остался orphan-селектор .hg-call-row');
  assert.ok(!/\.hg-call-dir\b/.test(code), 'остался orphan-селектор .hg-call-dir');
  assert.ok(!/\.hg-call-sub\b/.test(code), 'остался orphan-селектор .hg-call-sub');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
