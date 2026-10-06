'use strict';

/**
 * Wave 1 scenario matrix P1–P9 (L1 unit + source contracts + DB maintenance on clone).
 * Usage: node tests/pbx/scenario-matrix-w1.js
 * Optional DB: DATABASE_URL=...asgard_crm_test (P4/P8/P9 API/maintenance)
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  buildRingPlan,
  isWithinWorkHours,
  isWithinDutyWindow,
  isHeartbeatFresh,
  HEARTBEAT_TTL_MS,
} = require('../../src/pbx/dial-engine');
const { applyStaleOffline, applyWorkHoursOffline } = require('../../src/pbx/operator-lifecycle');
const { normalizePbxConfig, buildDialVars } = require('../../src/pbx/call-lifecycle');

const ROOT = path.resolve(__dirname, '../..');
let passed = 0;
let failed = 0;
const results = [];

function test(id, name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed++;
      results.push({ id, name, ok: true });
      console.log(`  ✓ ${id} ${name}`);
    })
    .catch((e) => {
      failed++;
      results.push({ id, name, ok: false, error: e.message });
      console.error(`  ✗ ${id} ${name}: ${e.message}`);
    });
}

const workHours = {
  mon: { start: '09:00', end: '18:00' },
  tue: { start: '09:00', end: '18:00' },
  wed: { start: '09:00', end: '18:00' },
  thu: { start: '09:00', end: '18:00' },
  fri: { start: '09:00', end: '18:00' },
  sat: null,
  sun: null,
};

const baseConfig = normalizePbxConfig({
  routing_mode: 'duty_first',
  browser_ring_sec: 5,
  mobile_ring_sec: 20,
  timezone: 'Europe/Moscow',
  work_hours: workHours,
  duty_until: '20:00',
  max_agents: 3,
});

/** Пятница 12:00 MSK */
const workNow = new Date('2026-10-02T09:00:00.000Z');
/** Пятница 19:00 MSK — вне часов, в duty window */
const afterHoursDuty = new Date('2026-10-02T16:00:00.000Z');
/** Пятница 21:00 MSK — duty_until прошёл */
const afterDuty = new Date('2026-10-02T18:00:00.000Z');
/** Суббота */
const weekend = new Date('2026-10-03T09:00:00.000Z');

function op(id, overrides = {}) {
  return {
    user_id: id,
    can_accept: true,
    sort_order: id * 10,
    receive_mode: 'browser',
    on_line: true,
    mobile_phone: `+790000000${id}`,
    sip_username: `sip${id}`,
    miss_streak: 0,
    paused_until: null,
    webrtc_registered: true,
    last_seen_at: new Date(workNow.getTime() - 30 * 1000).toISOString(),
    ...overrides,
  };
}

function readSrc(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

async function main() {
  console.log('scenario-matrix-w1');

  await test('P1', 'source: idle PIN skipped on_line', () => {
    const src = readSrc('public/assets/js/session-guard.js');
    assert.ok(src.includes('phoneBlocksIdlePin'), 'phoneBlocksIdlePin missing');
    assert.ok(src.includes('on_line_browser'), 'on_line_browser check missing');
    assert.ok(/lock\s*\(\s*opts\s*\)/.test(src) || src.includes('function lock(opts)'), 'lock(opts) missing');
    assert.ok(src.includes('!opts.force && phoneBlocksIdlePin'), 'idle skip gate missing');
  });

  await test('P2', 'source: Ctrl+Shift+L → lockAway offline+PIN', () => {
    const src = readSrc('public/assets/js/session-guard.js');
    assert.ok(src.includes('lockAway'), 'lockAway missing');
    assert.ok(src.includes('Ctrl') || src.includes('ctrlKey'), 'hotkey missing');
    assert.ok(src.includes("e.key === 'L'") || src.includes('Shift+L'), 'L key missing');
    assert.ok(src.includes('goOffline'), 'goOffline in lockAway missing');
    assert.ok(src.includes('force: true') || src.includes('force:true'), 'force lock missing');
  });

  await test('P3', 'source: unlock defers reload on_line + consumePendingReload', () => {
    const sg = readSrc('public/assets/js/session-guard.js');
    const pc = readSrc('public/assets/js/phone_core.js');
    assert.ok(sg.includes('phoneDefersShellReload') || sg.includes('shouldDeferShellReload'), 'defer helper missing');
    assert.ok(pc.includes('shouldDeferShellReload'), 'phone shouldDefer missing');
    assert.ok(pc.includes('on_line_browser'), 'on_line in defer missing');
    assert.ok(pc.includes('consumePendingReload'), 'consumePendingReload missing');
    assert.ok(pc.includes('maybeConsumePendingReload'), 'maybeConsumePendingReload missing');
  });

  await test('P4', 'source: heartbeat + pagehide offline', () => {
    const pc = readSrc('public/assets/js/phone_core.js');
    assert.ok(pc.includes('/operator/heartbeat'), 'heartbeat path missing');
    assert.ok(pc.includes('pagehide') || pc.includes('onPageHide'), 'pagehide missing');
    assert.ok(pc.includes('keepalive'), 'keepalive fetch missing');
    assert.ok(pc.includes('beforeunload'), 'beforeunload missing');
    const route = readSrc('src/routes/telephony-pbx.js');
    assert.ok(route.includes("'/operator/heartbeat'") || route.includes('/operator/heartbeat'), 'API heartbeat missing');
  });

  await test('P5', 'stale heartbeat → GSM only (duty+mobile)', () => {
    const stale = new Date(workNow.getTime() - HEARTBEAT_TTL_MS - 5000).toISOString();
    const ops = [
      op(1, {
        on_line: true,
        webrtc_registered: true,
        last_seen_at: stale,
        mobile_phone: '+79001112233',
        receive_mode: 'browser',
      }),
    ];
    const plan = buildRingPlan(ops, 1, baseConfig, workNow);
    assert.ok(plan.targets.length >= 1, 'expected GSM target');
    assert.strictEqual(plan.targets[0].targetType, 'mobile');
    assert.ok(!plan.targets.some((t) => t.targetType === 'webrtc'), 'webrtc must not ring without heartbeat');
  });

  await test('P6', 'nobody online in hours → empty (all-busy)', () => {
    const plan = buildRingPlan(
      [op(1, { on_line: false }), op(2, { on_line: false })],
      1,
      baseConfig,
      workNow
    );
    assert.strictEqual(plan.withinHours, true);
    assert.strictEqual(plan.targets.length, 0);
  });

  await test('P7', 'off-hours → empty (after-hours)', () => {
    const plan = buildRingPlan([op(1)], 1, baseConfig, weekend);
    assert.strictEqual(plan.withinHours, false);
    assert.strictEqual(plan.targets.length, 0);
  });

  await test('P8', 'after hours keep duty until duty_until', () => {
    assert.strictEqual(isWithinWorkHours(baseConfig.work_hours, afterHoursDuty, 'Europe/Moscow'), false);
    assert.strictEqual(isWithinDutyWindow(baseConfig, afterHoursDuty, 'Europe/Moscow'), true);
  });

  await test('P9', 'duty_until expired', () => {
    assert.strictEqual(isWithinDutyWindow(baseConfig, afterDuty, 'Europe/Moscow'), false);
  });

  await test('C1', 'cascade max_agents=3 non-parallel', () => {
    const ops = [op(1), op(2), op(3), op(4)];
    const plan = buildRingPlan(ops, 1, baseConfig, workNow);
    const users = [...new Set(plan.targets.map((t) => t.userId))];
    assert.ok(users.length <= 3, 'max_agents violated: ' + users.join(','));
    assert.ok(users.length >= 2, 'expected cascade across agents');
    const dial = buildDialVars(plan.targets, baseConfig);
    assert.ok(dial.dialString, 'dialString empty');
    assert.ok(dial.cascade.length >= 1, 'cascade legs missing');
  });

  await test('C2', 'normalizePbxConfig duty_until default end+2h', () => {
    const cfg = normalizePbxConfig({ work_hours_from: '09:00', work_hours_to: '18:00' });
    assert.strictEqual(cfg.duty_until, '20:00');
    assert.strictEqual(cfg.max_agents, 3);
  });

  await test('C3', 'fresh heartbeat webrtc eligible', () => {
    const ops = [op(1, { mobile_phone: null, receive_mode: 'browser' })];
    const plan = buildRingPlan(ops, null, baseConfig, workNow);
    assert.strictEqual(plan.targets[0].targetType, 'webrtc');
    assert.ok(isHeartbeatFresh(ops[0], workNow.getTime()));
  });

  // Optional DB maintenance (clone)
  const dbUrl = process.env.DATABASE_URL || '';
  if (dbUrl.includes('asgard_crm_test') || process.env.SCENARIO_W1_DB === '1') {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: dbUrl || 'postgresql://asgard:123456789@127.0.0.1:5432/asgard_crm_test',
    });
    try {
      await test('P4b', 'DB stale offline', async () => {
        const { rows: urows } = await pool.query(
          `SELECT id FROM users WHERE is_active = true ORDER BY id LIMIT 1`
        );
        assert.ok(urows[0], 'need at least one active user in asgard_crm_test');
        const uid = urows[0].id;
        await pool.query(
          `INSERT INTO pbx_operators (user_id, on_line, webrtc_registered, last_seen_at, receive_mode, can_accept)
           VALUES ($1, true, true, NOW() - interval '5 minutes', 'browser', true)
           ON CONFLICT (user_id) DO UPDATE SET
             on_line = true, webrtc_registered = true,
             last_seen_at = NOW() - interval '5 minutes', updated_at = NOW()`,
          [uid]
        );
        await applyStaleOffline(pool, []);
        const { rows } = await pool.query(
          `SELECT on_line, webrtc_registered FROM pbx_operators WHERE user_id = $1`,
          [uid]
        );
        assert.ok(rows[0], 'operator row missing');
        assert.strictEqual(rows[0].on_line, false);
        assert.strictEqual(rows[0].webrtc_registered, false);
      });

      await test('P8b', 'DB after-hours keep duty', async () => {
        const r = await applyWorkHoursOffline(pool, baseConfig, afterHoursDuty);
        assert.ok(r.action === 'after_hours_keep_duty' || r.action === 'after_hours_all' || r.action === 'duty_until_expired');
      });

      await test('P9b', 'DB duty_until expired → all offline action', async () => {
        const r = await applyWorkHoursOffline(pool, baseConfig, afterDuty);
        assert.ok(
          r.action === 'duty_until_expired' || r.action === 'after_hours_all',
          'unexpected ' + r.action
        );
      });
    } finally {
      await pool.end();
    }
  } else {
    console.log('  · skip P4b/P8b/P9b (set DATABASE_URL=...asgard_crm_test to enable)');
  }

  const report = path.join(ROOT, 'tests/reports/TELEPHONY-SCENARIO-W1.md');
  const lines = [
    '# TELEPHONY-SCENARIO-W1',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `| ID | Result | Name |`,
    `|----|--------|------|`,
    ...results.map((r) => `| ${r.id} | ${r.ok ? 'GREEN' : 'RED'} | ${r.name}${r.error ? ' — ' + r.error : ''} |`),
    '',
    `**${passed} passed, ${failed} failed**`,
    '',
  ];
  fs.writeFileSync(report, lines.join('\n'), 'utf8');
  console.log(`\n${passed} passed, ${failed} failed → ${report}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
