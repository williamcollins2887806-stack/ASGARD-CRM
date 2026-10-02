'use strict';

const assert = require('assert');
const {
  buildRingPlan,
  advanceAfterMiss,
  shouldPauseOperator,
  isWithinWorkHours,
} = require('../../src/pbx/dial-engine');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}: ${e.message}`);
  }
}

const baseConfig = {
  routing_mode: 'duty_first',
  fallback_routing: 'round_robin',
  browser_ring_sec: 5,
  mobile_ring_sec: 20,
  timezone: 'Europe/Moscow',
  work_hours: {
    mon: { start: '09:00', end: '18:00' },
    tue: { start: '09:00', end: '18:00' },
    wed: { start: '09:00', end: '18:00' },
    thu: { start: '09:00', end: '18:00' },
    fri: { start: '09:00', end: '18:00' },
    sat: { start: null, end: null },
    sun: { start: null, end: null },
  },
};

function op(id, overrides = {}) {
  return {
    user_id: id,
    can_accept: true,
    sort_order: id * 10,
    receive_mode: 'browser',
    on_line: true,
    mobile_phone: `+790000000${id}`,
    sip_username: `sip${id}`,
    miss_streak: 0,
    paused_until: null,
    webrtc_registered: true,
    last_seen_at: new Date(Date.now() - id * 60000).toISOString(),
    ...overrides,
  };
}

/** Пятница 2026-10-02 12:00 MSK ≈ 09:00 UTC */
const workNow = new Date('2026-10-02T09:00:00.000Z');
/** Суббота */
const offNow = new Date('2026-10-03T09:00:00.000Z');

console.log('dial-engine');

test('duty_first — дежурный первый', () => {
  const ops = [op(1), op(2), op(3)];
  const plan = buildRingPlan(ops, 2, baseConfig, workNow);
  assert.strictEqual(plan.withinHours, true);
  assert.ok(plan.targets.length >= 1);
  assert.strictEqual(plan.targets[0].userId, 2);
});

test('round_robin — меньший last_seen раньше без дежурного', () => {
  const cfg = { ...baseConfig, routing_mode: 'round_robin' };
  const ops = [
    op(1, { last_seen_at: new Date('2026-01-01T10:00:00Z').toISOString() }),
    op(2, { last_seen_at: new Date('2026-01-01T08:00:00Z').toISOString() }),
  ];
  const plan = buildRingPlan(ops, null, cfg, workNow);
  assert.strictEqual(plan.targets[0].userId, 2);
});

test('ordered — по sort_order', () => {
  const cfg = { ...baseConfig, routing_mode: 'ordered' };
  const ops = [op(3, { sort_order: 300 }), op(1, { sort_order: 100 })];
  const plan = buildRingPlan(ops, null, cfg, workNow);
  assert.strictEqual(plan.targets[0].userId, 1);
});

test('parallel — все операторы в плане', () => {
  const cfg = { ...baseConfig, routing_mode: 'parallel', parallel_ring: true };
  const ops = [op(1), op(2)];
  const plan = buildRingPlan(ops, null, cfg, workNow);
  const userIds = new Set(plan.targets.map((t) => t.userId));
  assert.ok(userIds.has(1));
  assert.ok(userIds.has(2));
});

test('off-hours — пустой план', () => {
  const plan = buildRingPlan([op(1)], 1, baseConfig, offNow);
  assert.strictEqual(plan.withinHours, false);
  assert.strictEqual(plan.targets.length, 0);
});

test('nobody online — пустой план', () => {
  const ops = [op(1, { on_line: false }), op(2, { on_line: false })];
  const plan = buildRingPlan(ops, 1, baseConfig, workNow);
  assert.strictEqual(plan.targets.length, 0);
});

test('miss streak pause — advanceAfterMiss и shouldPauseOperator', () => {
  const cfg = { miss_pause_after: 3, miss_pause_minutes: 15 };
  let o = op(1, { miss_streak: 1 });
  o = { ...o, ...advanceAfterMiss(o, cfg, workNow) };
  assert.strictEqual(o.miss_streak, 2);
  assert.strictEqual(shouldPauseOperator(o, cfg), false);
  o = { ...o, miss_streak: 2, ...advanceAfterMiss(o, cfg, workNow) };
  assert.strictEqual(o.miss_streak, 3);
  assert.strictEqual(shouldPauseOperator(o, cfg), true);
  assert.ok(o.paused_until);
});

test('mobile receive_mode', () => {
  const ops = [op(5, { receive_mode: 'mobile', webrtc_registered: false, sip_username: null })];
  const plan = buildRingPlan(ops, null, baseConfig, workNow);
  assert.strictEqual(plan.targets[0].targetType, 'mobile');
});

test('isWithinWorkHours sanity', () => {
  assert.strictEqual(isWithinWorkHours(baseConfig.work_hours, workNow, 'Europe/Moscow'), true);
  assert.strictEqual(isWithinWorkHours(baseConfig.work_hours, offNow, 'Europe/Moscow'), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
