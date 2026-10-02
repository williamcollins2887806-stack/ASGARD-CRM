'use strict';

const { Pool } = require('pg');
const {
  handleInboundAgi,
  setPool,
  activeChannels,
} = require('../../../src/pbx/index');

const DEFAULT_DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://asgard:123456789@127.0.0.1:5432/asgard_crm_test';

/** Work-hours config that includes «сейчас» (MSK). */
const INTEGRATION_PBX_BASE = {
  enabled: true,
  routing_mode: 'duty_first',
  fallback_routing: 'round_robin',
  browser_ring_sec: 5,
  mobile_ring_sec: 20,
  total_wait_sec: 60,
  miss_pause_after: 3,
  miss_pause_minutes: 15,
  parallel_ring: false,
  timezone: 'Europe/Moscow',
  work_hours: {
    mon: { start: '00:00', end: '23:59' },
    tue: { start: '00:00', end: '23:59' },
    wed: { start: '00:00', end: '23:59' },
    thu: { start: '00:00', end: '23:59' },
    fri: { start: '00:00', end: '23:59' },
    sat: { start: '00:00', end: '23:59' },
    sun: { start: '00:00', end: '23:59' },
  },
};

function assertLocalDb(url) {
  const raw = url || DEFAULT_DATABASE_URL;
  let parsed;
  try {
    parsed = new URL(raw.replace(/^postgresql:\/\//, 'http://'));
  } catch (e) {
    throw new Error(`Invalid DATABASE_URL: ${e.message}`);
  }
  const host = (parsed.hostname || '').toLowerCase();
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  if (!loopback) {
    throw new Error(`Refusing non-loopback DATABASE_URL host: ${host}`);
  }
  const dbName = (parsed.pathname || '').replace(/^\//, '').split('?')[0];
  if (dbName === 'asgard_crm') {
    throw new Error('Refusing production database name asgard_crm (use asgard_crm_test)');
  }
  if (!dbName.includes('test')) {
    throw new Error(`Refusing database "${dbName}" — expected name containing "test" (e.g. asgard_crm_test)`);
  }
  return raw;
}

function createPool(url) {
  const cs = assertLocalDb(url || DEFAULT_DATABASE_URL);
  return new Pool({ connectionString: cs });
}

class MockAgiSession {
  constructor(env = {}) {
    this.env = {
      agi_callerid: '+74951234567',
      agi_uniqueid: 'itest-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      agi_dnid: '74993223062',
      agi_channel: 'PJSIP/mango-inbound-0001',
      ...env,
    };
    this.vars = {};
    this.commands = [];
  }

  async verbose(msg, level) {
    this.commands.push(['VERBOSE', msg, level]);
  }

  async answer() {
    this.commands.push(['ANSWER']);
  }

  async hangup() {
    this.commands.push(['HANGUP']);
  }

  async setVariable(k, v) {
    this.vars[k] = v;
    this.commands.push(['SET', k, v]);
  }

  async streamFile(f) {
    this.commands.push(['STREAM', f]);
  }
}

async function pickActiveUserId(pool, offset = 0) {
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE is_active = true ORDER BY id ASC OFFSET $1 LIMIT 1`,
    [offset]
  );
  if (!rows[0]) throw new Error('No active users in test DB');
  return rows[0].id;
}

async function setAllOperatorsOffline(pool) {
  await pool.query(`UPDATE pbx_operators SET on_line = false, updated_at = NOW()`);
}

async function seedOperators(pool, operators) {
  for (const op of operators) {
    const userId = op.userId ?? op.user_id;
    if (!userId) throw new Error('seedOperators: userId required');
    await pool.query(
      `INSERT INTO pbx_operators (
         user_id, can_accept, sort_order, receive_mode, on_line,
         mobile_phone, sip_username, webrtc_registered, miss_streak, paused_until,
         last_seen_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         can_accept = EXCLUDED.can_accept,
         sort_order = EXCLUDED.sort_order,
         receive_mode = EXCLUDED.receive_mode,
         on_line = EXCLUDED.on_line,
         mobile_phone = EXCLUDED.mobile_phone,
         sip_username = EXCLUDED.sip_username,
         webrtc_registered = EXCLUDED.webrtc_registered,
         miss_streak = EXCLUDED.miss_streak,
         paused_until = EXCLUDED.paused_until,
         last_seen_at = NOW(),
         updated_at = NOW()`,
      [
        userId,
        op.can_accept !== false,
        op.sort_order ?? 100,
        op.receive_mode || 'browser',
        !!op.on_line,
        op.mobile_phone ?? null,
        op.sip_username ?? `u${userId}_itest`,
        !!op.webrtc_registered,
        op.miss_streak ?? 0,
        op.paused_until ?? null,
      ]
    );
    await pool.query(
      `INSERT INTO user_call_status (user_id, updated_at)
       VALUES ($1, NOW())
       ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );
  }
}

async function setDutyUser(pool, userId) {
  await pool.query(`UPDATE user_call_status SET is_duty = false, updated_at = NOW()`);
  if (userId != null) {
    await pool.query(
      `UPDATE user_call_status SET is_duty = true, updated_at = NOW() WHERE user_id = $1`,
      [userId]
    );
  }
}

async function ensurePbxConfig(pool, cfg) {
  const merged = { ...INTEGRATION_PBX_BASE, ...(cfg || {}) };
  await pool.query(
    `INSERT INTO settings (key, value_json) VALUES ('pbx_config', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json`,
    [JSON.stringify(merged)]
  );
  return merged;
}

/** pbx_config where «сейчас» вне рабочих часов (MSK). */
function offHoursPbxOverlay() {
  return {
    work_hours: {
      mon: { start: '03:00', end: '03:01' },
      tue: { start: '03:00', end: '03:01' },
      wed: { start: '03:00', end: '03:01' },
      thu: { start: '03:00', end: '03:01' },
      fri: { start: '03:00', end: '03:01' },
      sat: { start: '03:00', end: '03:01' },
      sun: { start: '03:00', end: '03:01' },
    },
  };
}

async function runInbound(pool, opts = {}) {
  const uniqueId =
    opts.uniqueId ||
    opts.pbxUid ||
    'uid-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const session = new MockAgiSession({
    agi_callerid: opts.caller || '+74951234567',
    agi_uniqueid: uniqueId,
    agi_channel: opts.channel || 'PJSIP/inbound-test-0001',
    ...(opts.env || {}),
  });
  setPool(pool);
  const result = await handleInboundAgi(session);
  return { session, result, uniqueId, pbxUid: uniqueId, callId: 'pbx_' + uniqueId };
}

function assertDialStringSet(session, { expectEmpty = false } = {}) {
  const ds = session.vars.ASGARD_DIAL_STRING;
  if (expectEmpty) {
    if (ds && String(ds).trim()) {
      throw new Error(`Expected empty ASGARD_DIAL_STRING, got: ${ds}`);
    }
    return;
  }
  if (!ds || !String(ds).trim()) {
    throw new Error('ASGARD_DIAL_STRING not set on AGI session');
  }
}

async function assertHistory(pool, pbxUid, expected = {}) {
  const { rows } = await pool.query(
    `SELECT id, call_id, pbx_uid, status, call_type, outcome, from_number, source
     FROM call_history WHERE pbx_uid = $1 LIMIT 1`,
    [String(pbxUid)]
  );
  if (!rows[0]) throw new Error(`call_history missing for pbx_uid=${pbxUid}`);
  const row = rows[0];
  if (expected.status != null) {
    if (row.status !== expected.status) {
      throw new Error(`history.status expected ${expected.status}, got ${row.status}`);
    }
  }
  if (expected.call_type != null && row.call_type !== expected.call_type) {
    throw new Error(`history.call_type expected ${expected.call_type}, got ${row.call_type}`);
  }
  if (expected.outcome != null && row.outcome !== expected.outcome) {
    throw new Error(`history.outcome expected ${expected.outcome}, got ${row.outcome}`);
  }
  return row;
}

async function assertLegs(pool, callId, minCount, { role } = {}) {
  const cid = String(callId).startsWith('pbx_') ? callId : 'pbx_' + callId;
  const { rows } = await pool.query(
    `SELECT id, leg_seq, user_id, target_type, role FROM pbx_call_legs
     WHERE call_id = $1 ORDER BY leg_seq`,
    [cid]
  );
  if (rows.length < minCount) {
    throw new Error(`Expected >= ${minCount} legs for ${cid}, got ${rows.length}`);
  }
  if (role != null) {
    const bad = rows.filter((r) => r.role !== role);
    if (bad.length && rows.some((r) => r.role === role)) {
      /* ok mixed */
    } else if (rows.every((r) => r.role !== role)) {
      throw new Error(`Expected leg role ${role}, got ${rows.map((r) => r.role).join(',')}`);
    }
  }
  return rows;
}

async function cleanupCall(pool, pbxUid) {
  const uid = String(pbxUid);
  const callId = 'pbx_' + uid;
  await pool.query(`DELETE FROM pbx_call_legs WHERE call_id = $1`, [callId]);
  await pool.query(`DELETE FROM call_history WHERE pbx_uid = $1`, [uid]);
  activeChannels.delete(uid);
}

module.exports = {
  DEFAULT_DATABASE_URL,
  INTEGRATION_PBX_BASE,
  assertLocalDb,
  createPool,
  MockAgiSession,
  pickActiveUserId,
  seedOperators,
  setAllOperatorsOffline,
  setDutyUser,
  ensurePbxConfig,
  offHoursPbxOverlay,
  runInbound,
  assertDialStringSet,
  assertHistory,
  assertLegs,
  cleanupCall,
};
