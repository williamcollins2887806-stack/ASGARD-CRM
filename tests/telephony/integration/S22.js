'use strict';

const assert = require('assert');
const {
  createPool,
  pickActiveUserId,
  seedOperators,
  setDutyUser,
  ensurePbxConfig,
  runInbound,
  assertLegs,
  cleanupCall,
} = require('./harness');

module.exports.id = 'S22';

module.exports.run = async function run() {
  const pool = createPool();
  const userId = await pickActiveUserId(pool);
  await ensurePbxConfig(pool, {});
  await seedOperators(pool, [
    { userId, on_line: true, sip_username: `u${userId}_s22`, webrtc_registered: true },
  ]);
  await setDutyUser(pool, userId);

  const { pbxUid, callId } = await runInbound(pool);
  try {
    const legs = await assertLegs(pool, callId, 1);
    assert.strictEqual(legs[0].role, 'ring');
    assert.ok(legs[0].target_type);
  } finally {
    await cleanupCall(pool, pbxUid);
    await pool.end();
  }
};
