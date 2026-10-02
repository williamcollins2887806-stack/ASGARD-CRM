'use strict';

const assert = require('assert');
const { buildDialVars, targetToDialPart } = require('../../../src/pbx/call-lifecycle');

module.exports.id = 'S17';

/** Исходящий / callback mobile confirm channel. */
module.exports.run = async function run() {
  const t = {
    userId: 2,
    targetType: 'mobile',
    targetAddr: '+79005556677',
    ringSec: 20,
  };
  const part = targetToDialPart(t);
  assert.ok(part.startsWith('Local/'));
  assert.ok(part.endsWith('@asgard-mobile-confirm'));
  const v = buildDialVars([t], { mobile_ring_sec: 20 });
  assert.strictEqual(v.ringTimeout, 20);
  assert.ok(v.dialString.includes('89005556677') || v.dialString.includes('79005556677'));
};
