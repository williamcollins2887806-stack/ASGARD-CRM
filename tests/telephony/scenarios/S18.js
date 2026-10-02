'use strict';

const assert = require('assert');
const { buildRingPlan, defaultConfig, mockOperator, workNow } = require('./_mocks');

module.exports.id = 'S18';

module.exports.run = async function run() {
  const plan = buildRingPlan([mockOperator(1, { receive_mode: 'mobile', webrtc_registered: false })], null, defaultConfig, workNow);
  assert.strictEqual(plan.targets[0].ringSec, 20);
};
