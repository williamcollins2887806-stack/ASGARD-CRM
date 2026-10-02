'use strict';

const assert = require('assert');
const {
  createPool,
  pickActiveUserId,
  seedOperators,
  setDutyUser,
  ensurePbxConfig,
  setAllOperatorsOffline,
  runInbound,
  assertDialStringSet,
  assertHistory,
  cleanupCall,
} = require('./harness');

module.exports.id = 'S07';

module.exports.run = async function run() {
  const pool = createPool();
  const userId = await pickActiveUserId(pool);
  await ensurePbxConfig(pool, {});
  await setAllOperatorsOffline(pool);
  await seedOperators(pool, [
    {
      userId,
      on_line: false,
      webrtc_registered: true,
      sip_username: `u${userId}_s07`,
    },
  ]);
  await setDutyUser(pool, userId);

  const { session, result, pbxUid } = await runInbound(pool);
  try {
    assert.ok(result.missed === true || result.plan?.targets?.length === 0);
    assertDialStringSet(session, { expectEmpty: true });
    await assertHistory(pool, pbxUid, { status: 'missed', outcome: 'no_agents' });
  } finally {
    await cleanupCall(pool, pbxUid);
    await pool.end();
  }
};
