'use strict';

const assert = require('assert');
const { buildRingPlan, defaultConfig, mockOperator, workNow } = require('./_mocks');

module.exports.id = 'S16';

module.exports.run = async function run() {
  const op = mockOperator(1, { can_accept: false, on_line: true });
  const plan = buildRingPlan([op], 1, defaultConfig, workNow);
  assert.strictEqual(plan.targets.length, 0);
};
