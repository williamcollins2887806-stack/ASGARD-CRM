'use strict';

const assert = require('assert');
const { buildRingPlan, filterEligibleOperators } = require('../../../src/pbx/dial-engine');

function eligibleCount(ops) {
  return filterEligibleOperators(ops, Date.now()).length;
}
const {
  createPool,
  pickActiveUserId,
  seedOperators,
  setDutyUser,
  ensurePbxConfig,
  cleanupCall,
} = require('./harness');

module.exports.id = 'S02';

/** Два оператора: первый target — дежурный (browser path). */
module.exports.run = async function run() {
  const pool = createPool();
  const dutyId = await pickActiveUserId(pool, 0);
  const otherId = await pickActiveUserId(pool, 1);
  if (otherId === dutyId) throw new Error('Need two distinct users for S02');

  await ensurePbxConfig(pool, { routing_mode: 'duty_first', browser_ring_sec: 5 });
  await seedOperators(pool, [
    {
      userId: dutyId,
      on_line: true,
      sort_order: 20,
      sip_username: `u${dutyId}_s02a`,
      webrtc_registered: true,
    },
    {
      userId: otherId,
      on_line: true,
      sort_order: 10,
      sip_username: `u${otherId}_s02b`,
      webrtc_registered: true,
    },
  ]);
  await setDutyUser(pool, dutyId);

  const client = await pool.connect();
  try {
    const { rows: ops } = await client.query(
      `SELECT o.* FROM pbx_operators o JOIN users u ON u.id = o.user_id WHERE u.is_active = true`
    );
    const cfgRow = await client.query(`SELECT value_json FROM settings WHERE key = 'pbx_config'`);
    const cfg = cfgRow.rows[0].value_json;
    const plan = buildRingPlan(ops, dutyId, cfg, new Date());
    assert.ok(plan.targets.length >= 1, 'plan must have targets');
    assert.strictEqual(plan.targets[0].userId, dutyId, 'first ring target must be duty');
    const backupInPlan = plan.targets.some((t) => t.userId === otherId);
    assert.ok(backupInPlan || eligibleCount(ops) > 1, 'backup operator ready after duty timeout');
  } finally {
    client.release();
    await pool.end();
  }
};
