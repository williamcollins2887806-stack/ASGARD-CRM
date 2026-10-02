'use strict';

const assert = require('assert');
const {
  createPool,
  pickActiveUserId,
  seedOperators,
  setDutyUser,
  ensurePbxConfig,
  offHoursPbxOverlay,
  runInbound,
  assertDialStringSet,
  assertHistory,
  cleanupCall,
} = require('./harness');

module.exports.id = 'S06';

module.exports.run = async function run() {
  const pool = createPool();
  const userId = await pickActiveUserId(pool);
  await ensurePbxConfig(pool, offHoursPbxOverlay());
  await seedOperators(pool, [
    { userId, on_line: true, sip_username: `u${userId}_s06`, webrtc_registered: true },
  ]);
  await setDutyUser(pool, userId);

  const { session, result, pbxUid } = await runInbound(pool);
  try {
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.missed, true);
    assertDialStringSet(session, { expectEmpty: true });
    await assertHistory(pool, pbxUid, { status: 'missed', outcome: 'off_hours' });
    assert.ok(session.commands.some((c) => c[0] === 'STREAM' && String(c[1]).includes('after-hours')));
  } finally {
    await cleanupCall(pool, pbxUid);
    await pool.end();
  }
};
