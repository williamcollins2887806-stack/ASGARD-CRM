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
  assertHistory,
  assertLegs,
  cleanupCall,
} = require('./harness');

module.exports.id = 'S01';

module.exports.run = async function run() {
  const pool = createPool();
  const dutyId = await pickActiveUserId(pool);
  const sip = `u${dutyId}_s01`;
  await ensurePbxConfig(pool, { routing_mode: 'duty_first' });
  await seedOperators(pool, [
    {
      userId: dutyId,
      on_line: true,
      receive_mode: 'browser',
      sip_username: sip,
      webrtc_registered: true,
      sort_order: 5,
    },
  ]);
  await setDutyUser(pool, dutyId);

  const { session, result, pbxUid, callId } = await runInbound(pool);
  try {
    assert.strictEqual(result.ok, true);
    assert.ok(!result.missed);
    assertDialStringSet(session);
    assert.ok(session.vars.ASGARD_DIAL_STRING.startsWith('PJSIP/'));
    await assertHistory(pool, pbxUid, { status: 'ringing' });
    const legs = await assertLegs(pool, callId, 1, { role: 'ring' });
    assert.strictEqual(legs[0].user_id, dutyId);
    const n = result.notify;
    assert.strictEqual(n.event, 'call:incoming');
    assert.strictEqual(n.user_id, dutyId);
    assert.ok(n.data.call_id);
    assert.ok(n.data.from_number);
    assert.ok(n.data.fromNumber);
  } finally {
    await cleanupCall(pool, pbxUid);
    await pool.end();
  }
};
