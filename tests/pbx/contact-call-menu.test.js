'use strict';

/**
 * Контекстное меню контакта в Huginn: ПКМ → звонок через Mango / Huginn / чат / приглашение.
 * Проверяет контракты (source + API + данные directory), не поднимая сервер.
 *
 * Usage: node tests/pbx/contact-call-menu.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
let passed = 0;
let failed = 0;

function test(id, name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${id} ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${id} ${name}: ${e.message}`);
  }
}

const dock = fs.readFileSync(path.join(ROOT, 'public/assets/js/huginn_dock.js'), 'utf8');
const ext = fs.readFileSync(path.join(ROOT, 'src/routes/huginn_ext.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'public/assets/css/huginn_dock.css'), 'utf8');

console.log('contact-call-menu');

test('CM1', 'directory отдаёт phone', () => {
  assert.ok(/AS phone/.test(ext), 'нет выборки phone в /directory');
  assert.ok(/phone: r\.phone/.test(ext), 'phone не попадает в ответ');
});

test('CM2', 'endpoint звонка существует', () => {
  assert.ok(ext.includes("'/contacts/:userId/call'"), 'нет роута /contacts/:userId/call');
});

test('CM3', 'endpoint требует заполненный номер (409)', () => {
  assert.ok(/не заполнен номер/.test(ext), 'нет проверки пустого номера');
});

test('CM4', 'endpoint ходит в PBX CMD /call/originate', () => {
  assert.ok(/\/call\/originate/.test(ext), 'не вызывает PBX originate');
  assert.ok(/X-PBX-Secret/.test(ext), 'нет секрета PBX');
});

test('CM5', 'ПКМ открывает меню контакта', () => {
  assert.ok(/el\.oncontextmenu/.test(dock), 'нет oncontextmenu на строке контакта');
  assert.ok(/openContactMenu\(/.test(dock), 'нет функции openContactMenu');
});

test('CM5b', 'ПКМ привязан и в inline-списке, и в панели контактов', () => {
  const n = (dock.match(/el\.oncontextmenu = \(ev\) =>/g) || []).length;
  assert.ok(n >= 4, `ожидалось ≥4 обработчиков (inline+panel, обычные+приглашение), найдено ${n}`);
  assert.ok(/renderContactsPanel/.test(dock), 'нет renderContactsPanel');
});

test('CM5c', 'меню позиционируется в #hgPanel (есть и в списке контактов)', () => {
  const fn = dock.slice(dock.indexOf('function placeFloat'), dock.indexOf('async function toggleReaction'));
  assert.ok(/#hgPanel/.test(fn), 'placeFloat не берёт #hgPanel — в списке контактов .hg-thread нет');
  assert.ok(!/querySelector\('\.hg-thread'\)\s*;/.test(fn), 'placeFloat всё ещё жёстко требует .hg-thread');
});

test('CM6', 'меню собирается условно, все 4 действия возможны', () => {
  const menu = dock.slice(dock.indexOf('function openContactMenu'), dock.indexOf('async function callContactViaMango'));
  assert.ok(/data-cm="mango"/.test(menu), 'нет «Позвонить через Mango»');
  assert.ok(/data-cm="huginn"/.test(menu), 'нет «Позвонить в Huginn»');
  assert.ok(/data-cm="chat"/.test(menu), 'нет «Открыть чат»');
  assert.ok(/data-cm="invite"/.test(menu), 'нет «Пригласить»');
});

test('CM6b', 'приглашение только тем, кого нет в Huginn', () => {
  const menu = dock.slice(dock.indexOf('function openContactMenu'), dock.indexOf('async function callContactViaMango'));
  assert.ok(/if \(!hasHuginn\) \{[\s\S]*data-cm="invite"/.test(menu), '«Пригласить» не под условием !hasHuginn');
});

test('CM6c', 'Mango только при наличии номера; Huginn только при аккаунте', () => {
  const menu = dock.slice(dock.indexOf('function openContactMenu'), dock.indexOf('async function callContactViaMango'));
  assert.ok(/if \(phone\) \{[\s\S]*data-cm="mango"/.test(menu), 'Mango не под условием phone');
  assert.ok(/if \(hasHuginn\) \{[\s\S]*data-cm="huginn"/.test(menu), 'Huginn не под условием hasHuginn');
});

test('CM7', 'нет disabled-заглушек в меню (пункты просто не показываются)', () => {
  const menu = dock.slice(dock.indexOf('function openContactMenu'), dock.indexOf('async function callContactViaMango'));
  assert.ok(!/нет номера/.test(menu), 'осталась заглушка «нет номера»');
  assert.ok(!/нет аккаунта/.test(menu), 'осталась заглушка «нет аккаунта»');
});

test('CM8', 'звонок контакту всегда идёт из браузера (outbound сам поднимает SIP)', () => {
  const fn = dock.slice(dock.indexOf('async function callContactViaMango'), dock.indexOf('async function callContactViaMango') + 1600);
  assert.ok(/P\.outbound\(phone\)/.test(fn), 'не звонит через AsgardPhone.outbound');
  // Раньше звонили серверно (на мобильный) при отсутствии SIP до клика: это
  // давало «звонок от Асгарда на телефон» вместо звонка из браузера.
  assert.ok(!/getSipRegistered/.test(fn), 'не должен гейтить по предварительной SIP-регистрации');
  assert.ok(/P\.outbound\(phone\)/.test(fn), 'outbound поднимает SIP лениво и звонит из браузера');
});

test('CM9', 'CSS для заголовка меню и disabled', () => {
  assert.ok(/\.hg-float-head/.test(css), 'нет стиля .hg-float-head');
  assert.ok(/\.hg-float-actions button:disabled/.test(css), 'нет стиля disabled');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
