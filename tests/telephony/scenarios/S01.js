'use strict';

const assert = require('assert');
const { buildRingPlan, defaultConfig, mockOperator, workNow } = require('./_mocks');

module.exports.id = 'S01';

module.exports.run = async function run() {
  const ops = [mockOperator(1), mockOperator(2), mockOperator(3)];
  const plan = buildRingPlan(ops, 2, defaultConfig, workNow);
  assert.strictEqual(plan.targets[0].userId, 2, 'duty first');
  assert.ok(plan.targets[0].targetType === 'webrtc');
};
