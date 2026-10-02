'use strict';

const assert = require('assert');
const { mockOperator, defaultConfig, workNow, buildRingPlan } = require('./_mocks');

module.exports.id = 'S13';

module.exports.run = async function run() {
  const op = mockOperator(1, { paused_until: new Date(Date.now() + 3600000).toISOString() });
  const plan = buildRingPlan([op], 1, defaultConfig, workNow);
  assert.strictEqual(plan.targets.length, 0);
};
