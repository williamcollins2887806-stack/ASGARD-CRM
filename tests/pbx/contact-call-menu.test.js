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

test('CM6', 'меню содержит все 4 действия', () => {
  const menu = dock.slice(dock.indexOf('function openContactMenu'), dock.indexOf('async function callContactViaMango'));
  assert.ok(/data-cm="mango"/.test(menu), 'нет действия «Позвонить через Mango»');
  assert.ok(/data-cm="huginn"/.test(menu), 'нет действия «Позвонить в Huginn»');
  assert.ok(/data-cm="chat"/.test(menu), 'нет действия «Открыть чат»');
  assert.ok(/data-cm="invite"/.test(menu), 'нет действия «Пригласить»');
});

test('CM7', 'без номера кнопка Mango недоступна', () => {
  const menu = dock.slice(dock.indexOf('function openContactMenu'), dock.indexOf('async function callContactViaMango'));
  assert.ok(/data-cm="mango"\$\{phone \? '' : ' disabled'\}/.test(menu), 'Mango не блокируется при пустом номере');
});

test('CM8', 'SIP зарегистрирован → звонок из браузера (WebRTC)', () => {
  const fn = dock.slice(dock.indexOf('async function callContactViaMango'), dock.indexOf('async function callContactViaMango') + 1600);
  assert.ok(/getSipRegistered/.test(fn), 'не проверяет SIP-регистрацию');
  assert.ok(/P\.outbound\(phone\)/.test(fn), 'не звонит через AsgardPhone.outbound');
});

test('CM9', 'CSS для заголовка меню и disabled', () => {
  assert.ok(/\.hg-float-head/.test(css), 'нет стиля .hg-float-head');
  assert.ok(/\.hg-float-actions button:disabled/.test(css), 'нет стиля disabled');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
