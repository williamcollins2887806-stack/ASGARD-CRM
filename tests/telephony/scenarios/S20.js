'use strict';

const assert = require('assert');
const { buildRingPlan, defaultConfig, mockOperator, workNow } = require('./_mocks');

module.exports.id = 'S20';

module.exports.run = async function run() {
  const plan = buildRingPlan([], null, defaultConfig, workNow);
  assert.strictEqual(plan.targets.length, 0);
};
