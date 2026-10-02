'use strict';

const assert = require('assert');
const { targetToDialPart, buildDialVars } = require('../../../src/pbx/call-lifecycle');

module.exports.id = 'S16';

/** Исходящий webrtc: PJSIP/<sip>. */
module.exports.run = async function run() {
  const targets = [
    {
      userId: 1,
      targetType: 'webrtc',
      targetAddr: 'u_out_s16',
      ringSec: 5,
    },
  ];
  const v = buildDialVars(targets, { browser_ring_sec: 5 });
  assert.strictEqual(v.dialString, 'PJSIP/u_out_s16');
  assert.strictEqual(targetToDialPart(targets[0]), 'PJSIP/u_out_s16');
};
