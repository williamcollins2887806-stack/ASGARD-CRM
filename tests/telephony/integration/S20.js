'use strict';

const assert = require('assert');
const { activeChannels } = require('../../../src/pbx/index');
const {
  createPool,
  pickActiveUserId,
  seedOperators,
  setDutyUser,
  ensurePbxConfig,
  runInbound,
  cleanupCall,
} = require('./harness');

module.exports.id = 'S20';

module.exports.run = async function run() {
  assert.ok(activeChannels instanceof Map);
  const pool = createPool();
  const userId = await pickActiveUserId(pool);
  const uid = 's20-' + Date.now();
  await ensurePbxConfig(pool, {});
  await seedOperators(pool, [
    { userId, on_line: true, sip_username: `u${userId}_s20`, webrtc_registered: true },
  ]);
  await setDutyUser(pool, userId);

  const { pbxUid } = await runInbound(pool, { uniqueId: uid, channel: 'PJSIP/s20-ch' });
  try {
    assert.ok(activeChannels.has(uid));
    assert.strictEqual(activeChannels.get(uid).userId, userId);
  } finally {
    await cleanupCall(pool, pbxUid);
    assert.ok(!activeChannels.has(uid));
    await pool.end();
  }
};
