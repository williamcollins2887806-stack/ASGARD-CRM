'use strict';

const assert = require('assert');
const { buildRingPlan, defaultConfig, mockOperator, workNow } = require('./_mocks');

module.exports.id = 'S12';

module.exports.run = async function run() {
  const cfg = { ...defaultConfig, routing_mode: 'parallel', parallel_ring: true };
  const plan = buildRingPlan([mockOperator(1), mockOperator(2)], null, cfg, workNow);
  assert.ok(plan.targets.length >= 2);
};
