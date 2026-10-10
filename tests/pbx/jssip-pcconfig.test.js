'use strict';
/**
 * Контракт: pcConfig с iceServers обязан передаваться в JsSIP call()/answer().
 *
 * Причина (замер SDP на проде 10.10.2026): в JsSIP pcConfig читается из
 * аргументов вызова, а НЕ из конфигурации UA:
 *   u = R.cloneObject(n.pcConfig, { iceServers: [] })
 * Поэтому настройка UA.pcConfig игнорировалась: сбор кандидатов шёл с пустым
 * списком STUN/TURN → в SDP только приватные host-кандидаты (srflx=0, relay=0)
 * → медиа-путь не строился, в трубке тишина в обе стороны.
 *
 * Usage: node tests/pbx/jssip-pcconfig.test.js
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

console.log('jssip-pcconfig');

test('J1', 'ua.call() передаёт pcConfig (иначе iceServers игнорируются)', () => {
  const js = read('public/assets/js/phone_core.js');
  const i = js.indexOf('ua.call(');
  assert.ok(i !== -1, 'нет вызова ua.call');
  const blk = js.slice(i, i + 600);
  assert.ok(/pcConfig:\s*pcConfig/.test(blk), 'ua.call() без pcConfig — STUN/TURN не применятся');
});

test('J2', 'answer() передаёт pcConfig для входящих', () => {
  const js = read('public/assets/js/phone_core.js');
  const i = js.indexOf('activeSession.answer(');
  assert.ok(i !== -1, 'нет answer()');
  const blk = js.slice(i, i + 300);
  assert.ok(/pcConfig:\s*pcConfig/.test(blk), 'answer() без pcConfig');
});

test('J3', 'pcConfig сохраняется при старте UA', () => {
  const js = read('public/assets/js/phone_core.js');
  assert.ok(/var pcConfig = null/.test(js), 'нет переменной pcConfig');
  assert.ok(/pcConfig = configuration\.pcConfig/.test(js), 'pcConfig не сохраняется из конфигурации UA');
});

test('J4', 'iceServers берутся из credentials (STUN+TURN), есть fallback', () => {
  const js = read('public/assets/js/phone_core.js');
  assert.ok(/creds\.ice_servers/.test(js), 'не используются ice_servers из API');
  assert.ok(/stun\.l\.google\.com/.test(js), 'нет fallback STUN');
});

test('J5', 'сервер отдаёт ice_servers с TURN-credentials', () => {
  const js = read('src/routes/telephony-pbx.js');
  assert.ok(/buildIceServers/.test(js), 'нет buildIceServers');
  assert.ok(/createHmac\('sha1'/.test(js), 'нет генерации TURN-credentials');
  assert.ok(/turn:\$\{host\}/.test(js), 'нет turn: URL');
});

test('J6', 'в репо зафиксирована причина (комментарий про cloneObject)', () => {
  const js = read('public/assets/js/phone_core.js');
  assert.ok(/cloneObject\(n\.pcConfig/.test(js), 'нет пояснения, почему pcConfig нужен в call()');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
