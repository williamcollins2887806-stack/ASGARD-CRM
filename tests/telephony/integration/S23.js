'use strict';

const assert = require('assert');
const { canViewCall, hasFullCallView } = require('../../../src/lib/telephony-access');
const {
  createPool,
  pickActiveUserId,
  runInbound,
  cleanupCall,
  seedOperators,
  setDutyUser,
  ensurePbxConfig,
} = require('./harness');
const { insertCallLeg } = require('../../../src/pbx/call-lifecycle');

module.exports.id = 'S23';

module.exports.run = async function run() {
  const pool = createPool();
  const participant = await pickActiveUserId(pool, 0);
  const other = await pickActiveUserId(pool, 1);
  if (participant === other) throw new Error('Need two users for S23');

  await ensurePbxConfig(pool, {});
  await seedOperators(pool, [
    { userId: participant, on_line: true, sip_username: `u${participant}_s23`, webrtc_registered: true },
  ]);
  await setDutyUser(pool, participant);

  const pbxUid = 's23-' + Date.now();
  await runInbound(pool, { uniqueId: pbxUid });
  const hist = await pool.query(`SELECT * FROM call_history WHERE pbx_uid = $1`, [pbxUid]);
  const row = hist.rows[0];

  const client = await pool.connect();
  try {
    await insertCallLeg(client, {
      callId: row.call_id,
      legSeq: 99,
      userId: participant,
      targetType: 'webrtc',
      targetAddr: 'x',
      role: 'answer',
    });
  } finally {
    client.release();
  }

  try {
    assert.strictEqual(await canViewCall(pool, { id: participant, role: 'PM' }, row), true);
    assert.strictEqual(await canViewCall(pool, { id: other, role: 'PM' }, row), false);
    assert.strictEqual(
      await canViewCall(pool, { id: other, role: 'ADMIN' }, row),
      hasFullCallView({ role: 'ADMIN' })
    );
  } finally {
    await cleanupCall(pool, pbxUid);
    await pool.end();
  }
};
