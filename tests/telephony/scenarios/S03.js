'use strict';

const assert = require('assert');
const { buildRingPlan, defaultConfig, mockOperator, workNow } = require('./_mocks');

module.exports.id = 'S03';

module.exports.run = async function run() {
  const op = mockOperator(1, { receive_mode: 'browser', webrtc_registered: false, sip_username: null });
  const plan = buildRingPlan([op], null, defaultConfig, workNow);
  assert.strictEqual(plan.targets[0].targetType, 'mobile', 'fallback to mobile');
};
