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

module.exports.id = 'S05';

module.exports.run = async function run() {
  const pool = createPool();
  const userId = await pickActiveUserId(pool);
  await ensurePbxConfig(pool, { routing_mode: 'duty_first', mobile_ring_sec: 20 });
  await seedOperators(pool, [
    {
      userId,
      on_line: true,
      receive_mode: 'mobile',
      mobile_phone: '+7 (900) 111-22-33',
      webrtc_registered: false,
      sip_username: null,
    },
  ]);
  await setDutyUser(pool, userId);

  const { session, result, pbxUid } = await runInbound(pool);
  try {
    assert.strictEqual(result.ok, true);
    assertDialStringSet(session);
    assert.ok(session.vars.ASGARD_DIAL_STRING.includes('Local/'), 'mobile uses Local/');
    assert.ok(session.vars.ASGARD_DIAL_STRING.includes('@asgard-mobile-confirm'));
    assert.strictEqual(session.vars.ASGARD_RING_TIMEOUT, '20');
  } finally {
    await cleanupCall(pool, pbxUid);
    await pool.end();
  }
};
