'use strict';

/**
 * Fail-тест разрыва AGI ↔ dialplan (должен стать зелёным после A1).
 * Локально: без прода. БД не обязательна — проверяем buildDialVars + контракт handleInboundAgi session vars.
 */
const assert = require('assert');
const { buildDialVars, targetToDialPart } = require('../../../src/pbx/call-lifecycle');

function testDialVars() {
  const targets = [
    { userId: 1, targetType: 'webrtc', targetAddr: 'u1_ivan', ringSec: 5 },
  ];
  const v = buildDialVars(targets, { browser_ring_sec: 5 });
  assert.ok(v.dialString, 'dialString must be non-empty');
  assert.strictEqual(v.dialString, 'PJSIP/u1_ivan');
  assert.strictEqual(v.ringTimeout, 5);

  const mob = buildDialVars(
    [{ userId: 2, targetType: 'mobile', targetAddr: '+79001234567', ringSec: 20 }],
    { mobile_ring_sec: 20 }
  );
  assert.ok(mob.dialString.includes('Local/'), 'mobile must use Local/...@asgard-mobile-confirm');
  assert.ok(mob.dialString.includes('asgard-mobile-confirm'));
  assert.strictEqual(mob.ringTimeout, 20);

  const parallel = buildDialVars(
    [
      { userId: 1, targetType: 'webrtc', targetAddr: 'a', ringSec: 5 },
      { userId: 2, targetType: 'webrtc', targetAddr: 'b', ringSec: 5 },
    ],
    { parallel_ring: true }
  );
  const cascade = buildDialVars(
    [
      { userId: 1, targetType: 'webrtc', targetAddr: 'u1_ivan', ringSec: 5 },
      { userId: 1, targetType: 'mobile', targetAddr: '+79001234567', ringSec: 20 },
    ],
    { browser_ring_sec: 5, mobile_ring_sec: 20 }
  );
  assert.strictEqual(cascade.dialString, 'PJSIP/u1_ivan');
  assert.ok(cascade.fallbackDial && cascade.fallbackDial.includes('Local/'));
  assert.strictEqual(cascade.fallbackTimeout, 20);
}

function testTargetParts() {
  assert.strictEqual(targetToDialPart({ targetType: 'webrtc', targetAddr: 'x' }), 'PJSIP/x');
  assert.strictEqual(
    targetToDialPart({ targetType: 'mobile', targetAddr: '8 (900) 111-22-33' }),
    'Local/89001112233@asgard-mobile-confirm'
  );
}

testDialVars();
testTargetParts();
console.log('fail-dial-string-contract: PASS (buildDialVars)');
