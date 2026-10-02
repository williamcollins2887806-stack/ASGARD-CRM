'use strict';

const assert = require('assert');
const {
  createPool,
  pickActiveUserId,
  seedOperators,
  setDutyUser,
  ensurePbxConfig,
  runInbound,
  assertDialStringSet,
  cleanupCall,
} = require('./harness');

module.exports.id = 'S03';

/** Дежурный offline → круг (следующий online). */
module.exports.run = async function run() {
  const pool = createPool();
  const dutyId = await pickActiveUserId(pool, 0);
  const backupId = await pickActiveUserId(pool, 1);
  if (backupId === dutyId) throw new Error('Need two users for S03');

  const backupSip = `u${backupId}_s03`;
  await ensurePbxConfig(pool, { routing_mode: 'duty_first', fallback_routing: 'round_robin' });
  await seedOperators(pool, [
    {
      userId: dutyId,
      on_line: false,
      sip_username: `u${dutyId}_s03off`,
      webrtc_registered: true,
    },
    {
      userId: backupId,
      on_line: true,
      sort_order: 5,
      sip_username: backupSip,
      webrtc_registered: true,
    },
  ]);
  await setDutyUser(pool, dutyId);

  const { session, result, pbxUid } = await runInbound(pool);
  try {
    assert.strictEqual(result.ok, true);
    assertDialStringSet(session);
    assert.notStrictEqual(result.dial.firstTarget.userId, dutyId);
    assert.strictEqual(result.dial.firstTarget.userId, backupId);
    assert.ok(session.vars.ASGARD_DIAL_STRING.includes(backupSip));
  } finally {
    await cleanupCall(pool, pbxUid);
    await pool.end();
  }
};
