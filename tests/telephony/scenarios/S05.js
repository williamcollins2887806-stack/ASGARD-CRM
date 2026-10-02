'use strict';

const assert = require('assert');
const { advanceAfterMiss, defaultConfig, mockOperator, workNow } = require('./_mocks');

module.exports.id = 'S05';

module.exports.run = async function run() {
  let op = mockOperator(1, { miss_streak: 2 });
  op = { ...op, ...advanceAfterMiss(op, defaultConfig, workNow) };
  assert.strictEqual(op.miss_streak, 3);
  assert.ok(op.paused_until);
};
