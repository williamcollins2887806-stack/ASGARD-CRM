'use strict';

const assert = require('assert');
const {
  createPool,
  pickActiveUserId,
  seedOperators,
  ensurePbxConfig,
  setDutyUser,
  runInbound,
  assertDialStringSet,
  cleanupCall,
} = require('./harness');

module.exports.id = 'S04';

module.exports.run = async function run() {
  const pool = createPool();
  const u1 = await pickActiveUserId(pool, 0);
  const u2 = await pickActiveUserId(pool, 1);
  if (u1 === u2) throw new Error('Need two users for parallel S04');
  const s1 = `u${u1}_s04`;
  const s2 = `u${u2}_s04`;

  await ensurePbxConfig(pool, { routing_mode: 'parallel', parallel_ring: true });
  await seedOperators(pool, [
    { userId: u1, on_line: true, sip_username: s1, webrtc_registered: true, sort_order: 10 },
    { userId: u2, on_line: true, sip_username: s2, webrtc_registered: true, sort_order: 20 },
  ]);
  await setDutyUser(pool, null);

  const { session, result, pbxUid } = await runInbound(pool);
  try {
    assert.strictEqual(result.ok, true);
    assertDialStringSet(session);
    assert.ok(session.vars.ASGARD_DIAL_STRING.includes('&'), 'parallel dial uses &');
    assert.ok(session.vars.ASGARD_DIAL_STRING.includes(s1));
    assert.ok(session.vars.ASGARD_DIAL_STRING.includes(s2));
  } finally {
    await cleanupCall(pool, pbxUid);
    await pool.end();
  }
};
