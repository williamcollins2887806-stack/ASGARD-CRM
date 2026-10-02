'use strict';

const assert = require('assert');
const { advanceAfterMiss } = require('../../../src/pbx/dial-engine');
const { createPool, pickActiveUserId } = require('./harness');

module.exports.id = 'S18';

module.exports.run = async function run() {
  const pool = createPool();
  const userId = await pickActiveUserId(pool);
  const op = { user_id: userId, miss_streak: 2 };
  const cfg = { miss_pause_after: 3, miss_pause_minutes: 15 };
  const next = advanceAfterMiss(op, cfg, new Date());
  assert.strictEqual(next.miss_streak, 3);
  assert.ok(next.paused_until);

  await pool.query(
    `UPDATE pbx_operators SET miss_streak = $2, paused_until = $3, updated_at = NOW() WHERE user_id = $1`,
    [userId, next.miss_streak, next.paused_until]
  );
  const { rows } = await pool.query(
    `SELECT miss_streak, paused_until IS NOT NULL AS paused FROM pbx_operators WHERE user_id = $1`,
    [userId]
  );
  assert.strictEqual(rows[0].miss_streak, 3);
  assert.strictEqual(rows[0].paused, true);
  await pool.query(
    `UPDATE pbx_operators SET miss_streak = 0, paused_until = NULL, updated_at = NOW() WHERE user_id = $1`,
    [userId]
  );
  await pool.end();
};
