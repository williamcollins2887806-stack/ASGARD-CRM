/**
 * Academy blocking — enrollment, onboarding, one-rune rule
 * Run: node tests/field/academy-blocking.test.js
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { Client } = require('pg');
const {
  getBlockingLesson,
  resolveEnrollmentMonday,
  ACADEMY_ROLLOUT_MONDAY,
} = require('../../src/lib/academy-blocking');

let pgClient = null;
let dbAvailable = null;
let passed = 0;
let failed = 0;
const tests = [];

function test(name, fn) { tests.push({ name, fn }); }

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

async function ensureDb() {
  if (dbAvailable === false) {
    throw new Error('SKIP: database unavailable');
  }
  if (pgClient) return pgClient;
  pgClient = new Client({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432', 10),
    database: process.env.PGDATABASE || 'asgard_crm',
    user: process.env.PGUSER || 'asgard',
    password: process.env.PGPASSWORD || '',
    connectionTimeoutMillis: 3000,
  });
  try {
    await pgClient.connect();
    dbAvailable = true;
  } catch (e) {
    dbAvailable = false;
    pgClient = null;
    throw new Error('SKIP: database unavailable — ' + e.message);
  }
  return pgClient;
}

async function dbQuery(sql, params) {
  const client = await ensureDb();
  return client.query(sql, params);
}

const db = { query: dbQuery };

async function runTests() {
  console.log('\n===================================================');
  console.log('  Academy Blocking Tests');
  console.log('===================================================\n');

  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log('  ✓ ' + t.name);
    } catch (e) {
      if (String(e.message).startsWith('SKIP:')) {
        console.log('  ○ ' + t.name + ' (skipped)');
        continue;
      }
      failed++;
      console.log('  ✗ ' + t.name);
      console.log('    ' + e.message);
    }
  }

  if (pgClient) await pgClient.end();

  console.log('\n---------------------------------------------------');
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('---------------------------------------------------\n');
  process.exit(failed > 0 ? 1 : 0);
}

// ── Unit-style tests (no DB) ─────────────────────────────────────────────

test('resolveEnrollmentMonday: veteran before rollout → rollout monday', () => {
  const mon = resolveEnrollmentMonday({ created_at: '2025-01-15', academy_enrolled_at: null });
  assert(mon === ACADEMY_ROLLOUT_MONDAY, `expected ${ACADEMY_ROLLOUT_MONDAY}, got ${mon}`);
});

test('resolveEnrollmentMonday: explicit enrolled_at wins', () => {
  const mon = resolveEnrollmentMonday({
    created_at: '2025-01-15',
    academy_enrolled_at: '2026-08-03',
  });
  assert(mon === '2026-08-03');
});

// ── DB integration tests ───────────────────────────────────────────────────

test('legacy worker: pre-enrollment overdue lessons do not block', async () => {
  const { rows: [emp] } = await dbQuery(`
    SELECT id FROM employees
    WHERE academy_enrolled_at = $1::date
      AND academy_onboarding_passed_at IS NOT NULL
      AND is_active = true
    LIMIT 1
  `, [ACADEMY_ROLLOUT_MONDAY]);

  if (!emp) throw new Error('No legacy employee found — run migration V275 first');

  const result = await getBlockingLesson(db, emp.id);
  // May block on post-rollout lesson only — must not block on pre-rollout if none post-rollout overdue
  if (result.blocking && result.blocking.release_monday) {
    const rel = String(result.blocking.release_monday).split('T')[0];
    assert(rel >= ACADEMY_ROLLOUT_MONDAY, `blocking lesson ${rel} is before enrollment cutoff`);
  }
});

test('getBlockingLesson returns consistent shape', async () => {
  const { rows: [emp] } = await dbQuery(
    `SELECT id FROM employees WHERE is_active = true LIMIT 1`
  );
  if (!emp) throw new Error('No active employee');

  const result = await getBlockingLesson(db, emp.id);
  assert(typeof result.allowed === 'boolean');
  assert('blocking' in result);
  assert('blocking_reason' in result);
});

test('waiver unblocks specific lesson', async () => {
  const { rows: [emp] } = await dbQuery(`
    SELECT id FROM employees
    WHERE is_active = true AND academy_onboarding_passed_at IS NOT NULL
    LIMIT 1
  `);
  if (!emp) throw new Error('No employee for waiver test');

  const blockBefore = await getBlockingLesson(db, emp.id);
  if (!blockBefore.blocking) {
    console.log('    (skip waiver effect — worker not blocked)');
    return;
  }

  const lessonId = blockBefore.blocking.id;

  await dbQuery(`
    INSERT INTO academy_lesson_waivers (employee_id, lesson_id, waiver_type, note)
    VALUES ($1, $2, 'pm_exempt', 'test auto')
  `, [emp.id, lessonId]);

  try {
    const blockAfter = await getBlockingLesson(db, emp.id);
    assert(blockAfter.allowed === true || blockAfter.blocking?.id !== lessonId,
      'waiver should unblock that lesson');
  } finally {
    await dbQuery(
      `DELETE FROM academy_lesson_waivers WHERE employee_id = $1 AND lesson_id = $2 AND note = 'test auto'`,
      [emp.id, lessonId]
    );
  }
});

test('onboarding blocks new hire after logistics grace', async () => {
  const { rows: [lesson] } = await dbQuery(`
    SELECT id FROM academy_lessons
    WHERE status = 'published' AND (is_onboarding = true OR week_number = 1)
    LIMIT 1
  `);
  if (!lesson) throw new Error('No onboarding lesson');

  const phone = `7999${Date.now().toString().slice(-7)}`;
  const { rows: [emp] } = await dbQuery(`
    INSERT INTO employees (fio, phone, is_active, created_at, academy_enrolled_at)
    VALUES ('TEST Academy Block', $1, true, NOW() - INTERVAL '2 days', DATE_TRUNC('week', NOW())::date)
    RETURNING id
  `, [phone]);

  try {
    const result = await getBlockingLesson(db, emp.id);
    assert(result.allowed === false, 'new hire should be blocked');
    assert(result.blocking_reason === 'onboarding', `expected onboarding, got ${result.blocking_reason}`);
  } finally {
    await dbQuery(`DELETE FROM academy_worker_progress WHERE employee_id = $1`, [emp.id]);
    await dbQuery(`DELETE FROM employees WHERE id = $1`, [emp.id]);
  }
});

test('onboarding passed clears onboarding block', async () => {
  const phone = `7999${Date.now().toString().slice(-7)}`;
  const { rows: [lesson] } = await dbQuery(`
    SELECT id FROM academy_lessons
    WHERE status = 'published' AND (is_onboarding = true OR week_number = 1)
    LIMIT 1
  `);
  if (!lesson) throw new Error('No onboarding lesson');

  const { rows: [emp] } = await dbQuery(`
    INSERT INTO employees (fio, phone, is_active, created_at, academy_enrolled_at, academy_onboarding_passed_at)
    VALUES ('TEST Onboard Done', $1, true, NOW() - INTERVAL '5 days', DATE_TRUNC('week', NOW())::date, NOW())
    RETURNING id
  `, [phone]);

  try {
    const result = await getBlockingLesson(db, emp.id);
    assert(result.blocking_reason !== 'onboarding', 'onboarding should not block when passed_at set');
  } finally {
    await dbQuery(`DELETE FROM employees WHERE id = $1`, [emp.id]);
  }
});

runTests();
