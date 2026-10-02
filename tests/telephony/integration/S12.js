'use strict';

const assert = require('assert');
const { createPool, pickActiveUserId, cleanupCall } = require('./harness');
const { insertCallLeg } = require('../../../src/pbx/call-lifecycle');

module.exports.id = 'S12';

/** Consult leg записывается в pbx_call_legs с role transfer_consult. */
module.exports.run = async function run() {
  const pool = createPool();
  const userId = await pickActiveUserId(pool);
  const pbxUid = 's12-' + Date.now();
  const callId = 'pbx_' + pbxUid;
  const client = await pool.connect();
  try {
    const leg = await insertCallLeg(client, {
      callId,
      legSeq: 2,
      userId,
      targetType: 'webrtc',
      targetAddr: 'peer',
      role: 'transfer_consult',
    });
    assert.ok(leg.id);
    const { rows } = await client.query(
      `SELECT role FROM pbx_call_legs WHERE id = $1`,
      [leg.id]
    );
    assert.strictEqual(rows[0].role, 'transfer_consult');
  } finally {
    client.release();
    await cleanupCall(pool, pbxUid);
    await pool.end();
  }
};
