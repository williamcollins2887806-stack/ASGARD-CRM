'use strict';

const assert = require('assert');
const { buildRingPlan, defaultConfig, mockOperator, workNow } = require('./_mocks');

module.exports.id = 'S22';

module.exports.run = async function run() {
  const cfg = { ...defaultConfig, browser_ring_sec: 7 };
  const plan = buildRingPlan([mockOperator(1)], null, cfg, workNow);
  assert.strictEqual(plan.targets[0].ringSec, 7);
};
