'use strict';

/**
 * S26: /reports/missed scope — non-full role не видит чужие missed (SQL-эквивалент роута).
 */
const assert = require('assert');
const { hasFullCallView } = require('../../../src/lib/telephony-access');
const {
  createPool,
  pickActiveUserId,
  cleanupCall,
  seedOperators,
  setDutyUser,
  ensurePbxConfig,
} = require('./harness');

module.exports.id = 'S26';

module.exports.run = async function run() {
  const pool = createPool();
  const a = await pickActiveUserId(pool, 0);
  const b = await pickActiveUserId(pool, 1);
  if (a === b) throw new Error('Need two users for S26');

  await ensurePbxConfig(pool, {});
  await seedOperators(pool, [
    { userId: a, on_line: true, sip_username: `u${a}_s26`, webrtc_registered: true },
    { userId: b, on_line: true, sip_username: `u${b}_s26`, webrtc_registered: true },
  ]);
  await setDutyUser(pool, a);

  const uidA = 's26a-' + Date.now();
  const uidB = 's26b-' + Date.now();

  await pool.query(
    `INSERT INTO call_history (call_id, pbx_uid, source, call_type, from_number, user_id, outcome, started_at, created_at)
     VALUES ($1,$2,'pbx','missed','79001111111',$3,'missed',NOW(),NOW())`,
    ['pbx_' + uidA, uidA, a]
  );
  await pool.query(
    `INSERT INTO call_history (call_id, pbx_uid, source, call_type, from_number, user_id, outcome, started_at, created_at)
     VALUES ($1,$2,'pbx','missed','79002222222',$3,'missed',NOW(),NOW())`,
    ['pbx_' + uidB, uidB, b]
  );

  const missedSqlScoped = `
    SELECT id, pbx_uid FROM call_history
    WHERE call_type = 'missed' AND (source = 'pbx' OR pbx_uid IS NOT NULL)
      AND (user_id = $1 OR answered_by = $1
           OR EXISTS (
             SELECT 1 FROM pbx_call_legs l
             WHERE l.user_id = $1
               AND (l.call_id = call_history.call_id OR l.call_id = call_history.pbx_uid)
           ))
      AND pbx_uid IN ($2, $3)`;

  try {
    assert.strictEqual(hasFullCallView({ role: 'PM' }), false);
    assert.strictEqual(hasFullCallView({ role: 'ADMIN' }), true);

    const scoped = await pool.query(missedSqlScoped, [a, uidA, uidB]);
    const uids = scoped.rows.map((r) => r.pbx_uid);
    assert.ok(uids.includes(uidA), 'participant sees own missed');
    assert.ok(!uids.includes(uidB), 'participant must NOT see other missed');

    const full = await pool.query(
      `SELECT pbx_uid FROM call_history
       WHERE call_type = 'missed' AND pbx_uid IN ($1,$2)`,
      [uidA, uidB]
    );
    assert.strictEqual(full.rows.length, 2);
  } finally {
    await cleanupCall(pool, uidA);
    await cleanupCall(pool, uidB);
    await pool.end();
  }
};
