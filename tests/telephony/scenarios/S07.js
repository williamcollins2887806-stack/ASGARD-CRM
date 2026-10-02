'use strict';

const assert = require('assert');
const { buildRingPlan, defaultConfig, mockOperator, workNow, MockAgiSession } = require('./_mocks');

module.exports.id = 'S07';

module.exports.run = async function run() {
  const plan = buildRingPlan(
    [mockOperator(1, { on_line: false })],
    null,
    defaultConfig,
    workNow
  );
  assert.strictEqual(plan.targets.length, 0);
  const agi = new MockAgiSession();
  await agi.answer();
  await agi.hangup();
  assert.ok(agi.commands.find((c) => c[0] === 'HANGUP'));
};
