'use strict';

const assert = require('assert');
const { buildRingPlan, defaultConfig, mockOperator, workNow } = require('./_mocks');

module.exports.id = 'S24';

module.exports.run = async function run() {
  const ops = [mockOperator(1), mockOperator(2)];
  const plan = buildRingPlan(ops, 99, defaultConfig, workNow);
  assert.ok(plan.targets.length >= 1, 'fallback when duty absent');
};
