'use strict';

const assert = require('assert');
const {
  createPool,
  pickActiveUserId,
  seedOperators,
  setDutyUser,
  ensurePbxConfig,
  runInbound,
  cleanupCall,
} = require('./harness');

module.exports.id = 'S15';

module.exports.run = async function run() {
  const pool = createPool();
  const userId = await pickActiveUserId(pool);
  await ensurePbxConfig(pool, { routing_mode: 'duty_first' });
  await seedOperators(pool, [
    { userId, on_line: true, sip_username: `u${userId}_s15`, webrtc_registered: true },
  ]);
  await setDutyUser(pool, userId);

  const a = await runInbound(pool, { uniqueId: 'parallel-a-' + Date.now(), caller: '+74951111111' });
  const b = await runInbound(pool, { uniqueId: 'parallel-b-' + Date.now(), caller: '+74952222222' });
  try {
    assert.notStrictEqual(a.pbxUid, b.pbxUid);
    const { rows } = await pool.query(
      `SELECT pbx_uid FROM call_history WHERE pbx_uid = ANY($1::text[])`,
      [[a.pbxUid, b.pbxUid]]
    );
    assert.strictEqual(rows.length, 2);
  } finally {
    await cleanupCall(pool, a.pbxUid);
    await cleanupCall(pool, b.pbxUid);
    await pool.end();
  }
};
