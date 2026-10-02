'use strict';

const assert = require('assert');
const { buildRingPlan, defaultConfig, mockOperator, workNow } = require('./_mocks');

module.exports.id = 'S02';

module.exports.run = async function run() {
  const cfg = { ...defaultConfig, routing_mode: 'round_robin' };
  const ops = [
    mockOperator(1, { last_seen_at: '2026-01-02T12:00:00.000Z' }),
    mockOperator(2, { last_seen_at: '2026-01-01T12:00:00.000Z' }),
  ];
  const plan = buildRingPlan(ops, null, cfg, workNow);
  assert.strictEqual(plan.targets[0].userId, 2);
};
