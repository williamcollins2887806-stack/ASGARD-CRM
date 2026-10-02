'use strict';

const assert = require('assert');
const { buildRingPlan, defaultConfig, mockOperator, workNow } = require('./_mocks');

module.exports.id = 'S11';

module.exports.run = async function run() {
  const cfg = { ...defaultConfig, routing_mode: 'ordered' };
  const plan = buildRingPlan([mockOperator(2, { sort_order: 50 }), mockOperator(1, { sort_order: 10 })], null, cfg, workNow);
  assert.strictEqual(plan.targets[0].userId, 1);
};
