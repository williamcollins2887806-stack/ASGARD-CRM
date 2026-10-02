'use strict';

const assert = require('assert');
const { buildRingPlan, defaultConfig, mockOperator, MockAgiSession } = require('./_mocks');

module.exports.id = 'S06';

module.exports.run = async function run() {
  const offNow = new Date('2026-10-03T09:00:00.000Z');
  const plan = buildRingPlan([mockOperator(1)], 1, defaultConfig, offNow);
  assert.strictEqual(plan.withinHours, false);
  const agi = new MockAgiSession();
  await agi.answer();
  await agi.streamFile('custom/after-hours');
  assert.ok(agi.commands.some((c) => c[0] === 'STREAM'));
};
