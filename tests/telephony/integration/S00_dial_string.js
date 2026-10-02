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

module.exports.id = 'S00_dial_string';

module.exports.run = async function run() {
  const pool = createPool();
  const userId = await pickActiveUserId(pool);
  const sip = `u${userId}_s00`;
  await ensurePbxConfig(pool, { routing_mode: 'duty_first' });
  await seedOperators(pool, [
    {
      userId,
      on_line: true,
      receive_mode: 'browser',
      sip_username: sip,
      webrtc_registered: true,
      sort_order: 10,
    },
  ]);
  await setDutyUser(pool, userId);

  const { session, result, pbxUid } = await runInbound(pool, { caller: '+74950000001' });
  try {
    assert.strictEqual(result.ok, true);
    assert.ok(!result.missed);
    assertDialStringSet(session);
    assert.ok(session.vars.ASGARD_DIAL_STRING.includes(sip), 'dial string must target seeded sip');
    assert.ok(session.vars.ASGARD_RING_TIMEOUT, 'ring timeout var set');
  } finally {
    await cleanupCall(pool, pbxUid);
    await pool.end();
  }
};
