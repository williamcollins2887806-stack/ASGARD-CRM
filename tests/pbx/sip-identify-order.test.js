'use strict';

/**
 * Контракт: порядок идентификации PJSIP не должен ломать WebRTC-регистрацию.
 *
 * Инцидент 09.10.2026: [identify-livekit] match=127.0.0.1/32 + порядок по
 * умолчанию (ip,username) → REGISTER оператора опознавался как livekit-ting
 * (без AOR) → 404 → SIP не поднимался → звонок уходил на мобильный.
 *
 * Usage: node tests/pbx/sip-identify-order.test.js
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

console.log('sip-identify-order');

test('S1', 'snippet задаёт username раньше ip в порядке идентификации', () => {
  const s = read('ops/asterisk/pjsip.global.snippet');
  assert.ok(/\[global\]/.test(s), 'нет секции [global]');
  assert.ok(/endpoint_identifier_order=username,ip,anonymous/.test(s.replace(/\s/g, '')),
    'порядок должен быть username,ip,anonymous (иначе loopback-identify перехватит браузер)');
});

test('S2', 'в snippet объяснена причина (регрессия 09.10)', () => {
  const s = read('ops/asterisk/pjsip.global.snippet');
  assert.ok(/livekit/i.test(s), 'нет упоминания конфликта с livekit-ting');
  assert.ok(/127\.0\.0\.1/.test(s), 'нет объяснения про loopback/nginx');
  assert.ok(/404/.test(s), 'нет описания симптома 404');
});

test('S3', 'в транках у identify-livekit стоит предупреждение', () => {
  const t = read('ops/asterisk/pjsip_asgard_trunks.conf');
  assert.ok(/identify-livekit/.test(t), 'нет identify-livekit');
  assert.ok(/endpoint_identifier_order/.test(t), 'нет ссылки на фикс в комментарии');
});

test('S4', 'гейт tools/verify_sip_register.js существует и шлёт REGISTER', () => {
  const g = read('tools/verify_sip_register.js');
  assert.ok(/REGISTER/.test(g), 'не отправляет REGISTER');
  assert.ok(/200 OK/.test(g), 'не проверяет 200 OK');
  assert.ok(/404/.test(g), 'не диагностирует 404 (симптом инцидента)');
});

test('S5', 'README документирует применение global-сниппета', () => {
  const r = read('ops/asterisk/README.md');
  assert.ok(/endpoint_identifier_order|pjsip\.global\.snippet/.test(r),
    'README не описывает фикс порядка идентификации');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
