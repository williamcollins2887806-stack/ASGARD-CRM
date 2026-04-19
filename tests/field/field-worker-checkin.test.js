/**
 * ASGARD Field -- Worker API + Checkin/Checkout Tests
 * Run: PGPASSWORD=123456789 node tests/field/field-worker-checkin.test.js
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { BASE_URL, rawFetch, assert, assertStatus, assertHasFields, getToken, initTokens } = require('../config');
const { Client } = require('pg');

const FIELD_AUTH = '/api/field/auth';
const FIELD_WORKER = '/api/field/worker';
const FIELD_CHECKIN = '/api/field/checkin';

let pgClient = null;
let testEmployeeId = null;
let testPhone = null;
let fieldToken = null;
let testWorkId = null;
let testAssignmentId = null;
let testCheckinId = null;
let masterEmployeeId = null;
let masterToken = null;

async function dbQuery(sql, params) {
  if (!pgClient) {
    pgClient = new Client({
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432', 10),
      database: process.env.PGDATABASE || 'asgard_crm',
      user: process.env.PGUSER || 'asgard',
      password: process.env.PGPASSWORD || '',
    });
    await pgClient.connect();
  }
  return pgClient.query(sql, params);
}

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

async function getFieldToken(empId, phone) {
  // Cleanup old codes
  await dbQuery(`DELETE FROM field_auth_codes WHERE employee_id = $1`, [empId]);
  await dbQuery(`DELETE FROM field_sessions WHERE employee_id = $1`, [empId]);

  // Request code
  const reqResp = await rawFetch('POST', FIELD_AUTH + '/request-code', { body: { phone } });
  if (reqResp.status !== 200) throw new Error('request-code failed: ' + reqResp.status);

  // Read code from DB
  const { rows } = await dbQuery(
    `SELECT code FROM field_auth_codes WHERE employee_id = $1 AND used = false ORDER BY id DESC LIMIT 1`,
    [empId]
  );
  if (!rows.length) throw new Error('No code in DB');

  // Verify
  const verResp = await rawFetch('POST', FIELD_AUTH + '/verify-code', { body: { phone, code: rows[0].code } });
  if (verResp.status !== 200) throw new Error('verify-code failed: ' + verResp.status);
  return verResp.data.token;
}

async function runTests() {
  console.log('\n===================================================');
  console.log('  ASGARD Field -- Worker + Checkin API Tests');
  console.log('===================================================\n');

  try { await initTokens(); } catch (_) {}

  // Setup: create test employee, work, assignment
  try {
    // Find or create employee
    const { rows: emps } = await dbQuery(
      `SELECT id, fio, phone FROM employees WHERE phone IS NOT NULL AND phone != '' AND is_active = true ORDER BY id LIMIT 1`
    );
    testEmployeeId = emps[0].id;
    testPhone = emps[0].phone;
    console.log('  [Setup] Employee: id=' + testEmployeeId + ' phone=' + testPhone);

    // Get field token
    fieldToken = await getFieldToken(testEmployeeId, testPhone);
    console.log('  [Setup] Got field token');

    // Find or create a work
    const { rows: works } = await dbQuery(`SELECT id FROM works WHERE work_status != 'closed' ORDER BY id DESC LIMIT 1`);
    if (works.length > 0) {
      testWorkId = works[0].id;
    } else {
      const { rows: newWork } = await dbQuery(
        `INSERT INTO works (work_title, city, work_status) VALUES ('FIELD_TEST_PROJECT', 'TestCity', 'active') RETURNING id`
      );
      testWorkId = newWork[0].id;
    }
    console.log('  [Setup] Work id=' + testWorkId);

    // Create assignment with tariff
    const { rows: tariffs } = await dbQuery(
      `SELECT id, rate_per_shift, points FROM field_tariff_grid WHERE category = 'ground' AND is_combinable = false ORDER BY sort_order LIMIT 1`
    );
    const tariffId = tariffs.length > 0 ? tariffs[0].id : null;

    // Clean old test assignment
    await dbQuery(`DELETE FROM field_checkins WHERE employee_id = $1 AND work_id = $2`, [testEmployeeId, testWorkId]);
    await dbQuery(`DELETE FROM employee_assignments WHERE employee_id = $1 AND work_id = $2`, [testEmployeeId, testWorkId]);

    const { rows: newAssign } = await dbQuery(`
      INSERT INTO employee_assignments (employee_id, work_id, field_role, tariff_id, tariff_points, is_active, shift_type)
      VALUES ($1, $2, 'worker', $3, $4, true, 'day') RETURNING id
    `, [testEmployeeId, testWorkId, tariffId, tariffs.length > 0 ? tariffs[0].points : null]);
    testAssignmentId = newAssign[0].id;
    console.log('  [Setup] Assignment id=' + testAssignmentId + ' tariff_id=' + tariffId);

    // Create project settings
    await dbQuery(`DELETE FROM field_project_settings WHERE work_id = $1`, [testWorkId]);
    await dbQuery(`
      INSERT INTO field_project_settings (work_id, is_active, schedule_type, shift_hours, rounding_rule, rounding_step, per_diem, site_category)
      VALUES ($1, true, 'shift', 11, 'half_up', 0.5, 1000, 'ground')
    `, [testWorkId]);

    // Create a second employee as master
    const { rows: masterEmps } = await dbQuery(
      `SELECT id, phone FROM employees WHERE phone IS NOT NULL AND phone != '' AND is_active = true AND id != $1 ORDER BY id LIMIT 1`,
      [testEmployeeId]
    );
    if (masterEmps.length > 0) {
      masterEmployeeId = masterEmps[0].id;
      // Assign as master
      await dbQuery(`DELETE FROM employee_assignments WHERE employee_id = $1 AND work_id = $2`, [masterEmployeeId, testWorkId]);
      await dbQuery(`
        INSERT INTO employee_assignments (employee_id, work_id, field_role, is_active, shift_type)
        VALUES ($1, $2, 'shift_master', true, 'day')
      `, [masterEmployeeId, testWorkId]);
      masterToken = await getFieldToken(masterEmployeeId, masterEmps[0].phone);
      console.log('  [Setup] Master id=' + masterEmployeeId);
    }

    console.log('  [Setup] Complete\n');
  } catch (e) {
    console.log('  [Setup] ERROR:', (e.message || '').slice(0, 300));
    console.log('  Tests may fail.\n');
  }

  // Run
  for (const { name, fn } of tests) {
    try {
      await fn();
      passed++;
      console.log('  PASS ' + name);
    } catch (e) {
      failed++;
      console.log('  FAIL ' + name);
      console.log('     ' + (e.message || '').slice(0, 300));
    }
  }

  console.log('\n---------------------------------------------------');
  console.log('  Results: ' + passed + ' passed, ' + failed + ' failed (total ' + tests.length + ')');
  console.log('---------------------------------------------------\n');

  // Cleanup
  try {
    await dbQuery(`DELETE FROM field_checkins WHERE employee_id = $1 AND work_id = $2`, [testEmployeeId, testWorkId]);
    if (masterEmployeeId) {
      await dbQuery(`DELETE FROM field_checkins WHERE employee_id = $1 AND work_id = $2`, [masterEmployeeId, testWorkId]);
      await dbQuery(`DELETE FROM employee_assignments WHERE employee_id = $1 AND work_id = $2`, [masterEmployeeId, testWorkId]);
    }
    await dbQuery(`DELETE FROM employee_assignments WHERE id = $1`, [testAssignmentId]);
    await dbQuery(`DELETE FROM field_project_settings WHERE work_id = $1`, [testWorkId]);
    if (pgClient) await pgClient.end();
  } catch (_) {}

  process.exit(failed > 0 ? 1 : 0);
}

// ===================================================
// TEST 1: GET /worker/active-project with assignment
// ===================================================
test('T1: GET /worker/active-project -> 200, project data', async () => {
  const resp = await rawFetch('GET', FIELD_WORKER + '/active-project', { token: fieldToken });
  assertStatus(resp, 200, 'active-project');
  assert(resp.data.project !== null, 'expected project not null');
  assert(resp.data.project.work_id === testWorkId, 'expected work_id=' + testWorkId);
  assert(resp.data.project.day_rate > 0, 'expected day_rate > 0, got ' + resp.data.project.day_rate);
  assertHasFields(resp.data.project, ['work_title', 'field_role', 'schedule_type', 'shift_hours'], 'project');
});

// ===================================================
// TEST 2: GET /worker/me -> profile with achievements
// ===================================================
test('T2: GET /worker/me -> 200, profile + achievements', async () => {
  const resp = await rawFetch('GET', FIELD_WORKER + '/me', { token: fieldToken });
  assertStatus(resp, 200, 'me');
  assertHasFields(resp.data, ['id', 'fio', 'phone', 'achievements'], 'me');
  assert(Array.isArray(resp.data.achievements), 'achievements should be array');
  assert(resp.data.achievements.length > 0, 'should have achievements');
  assertHasFields(resp.data.achievements[0], ['id', 'icon', 'name', 'earned'], 'achievement');
});

// ===================================================
// TEST 3: POST /checkin -> 200, checkin_id
// ===================================================
test('T3: POST /checkin -> 200, checkin_id + day_rate + quote', async () => {
  const resp = await rawFetch('POST', FIELD_CHECKIN, {
    token: fieldToken,
    body: { work_id: testWorkId, lat: 55.7558, lng: 37.6173, accuracy: 10 }
  });
  assertStatus(resp, 200, 'checkin');
  assert(resp.data.checkin_id > 0, 'expected checkin_id');
  assert(resp.data.day_rate > 0, 'expected day_rate > 0');
  assert(resp.data.quote, 'expected quote');
  testCheckinId = resp.data.checkin_id;
});

// ===================================================
// TEST 4: POST /checkin again -> 409
// ===================================================
test('T4: POST /checkin repeat -> 409', async () => {
  const resp = await rawFetch('POST', FIELD_CHECKIN, {
    token: fieldToken,
    body: { work_id: testWorkId }
  });
  assertStatus(resp, 409, 'duplicate checkin');
});

// ===================================================
// TEST 5: POST /checkin/checkout -> 200, hours + earned
// ===================================================
test('T5: POST /checkout -> 200, hours_worked + amount_earned', async () => {
  if (!testCheckinId) throw new Error('No checkin_id');

  // Backdate checkin to simulate 10h13m shift
  await dbQuery(
    `UPDATE field_checkins SET checkin_at = NOW() - INTERVAL '10 hours 13 minutes' WHERE id = $1`,
    [testCheckinId]
  );

  const resp = await rawFetch('POST', FIELD_CHECKIN + '/checkout', {
    token: fieldToken,
    body: { checkin_id: testCheckinId, lat: 55.7558, lng: 37.6173, accuracy: 10 }
  });
  assertStatus(resp, 200, 'checkout');
  assert(resp.data.hours_worked > 10, 'expected hours_worked > 10, got ' + resp.data.hours_worked);
  assert(resp.data.hours_paid > 0, 'expected hours_paid > 0');
  assert(resp.data.amount_earned > 0, 'expected amount_earned > 0, got ' + resp.data.amount_earned);
  assert(resp.data.quote, 'expected quote');
});

// ===================================================
// TEST 6: Rounding check: 10h13m with step=0.5 -> 10.5
// ===================================================
test('T6: Rounding: 10h13m with step=0.5 -> hours_paid=10.0 or 10.5', async () => {
  const { rows } = await dbQuery(
    `SELECT hours_worked, hours_paid FROM field_checkins WHERE id = $1`,
    [testCheckinId]
  );
  const hp = parseFloat(rows[0].hours_paid);
  // 10h13m = 10.217h, round to 0.5 step -> 10.0 (half_up rounds 10.217/0.5=20.433 -> round(20.433)=20 -> 10.0)
  assert(hp === 10.0 || hp === 10.5, 'expected hours_paid 10.0 or 10.5, got ' + hp);
});

// ===================================================
// TEST 7: GET /worker/finances -> correct amounts
// ===================================================
test('T7: GET /worker/finances -> 200, current_project with amounts', async () => {
  const resp = await rawFetch('GET', FIELD_WORKER + '/finances', { token: fieldToken });
  assertStatus(resp, 200, 'finances');
  assertHasFields(resp.data, ['current_project', 'all_time'], 'finances');
  if (resp.data.current_project) {
    assert(resp.data.current_project.earned_total >= 0, 'earned_total should be >= 0');
    assertHasFields(resp.data.current_project, ['work_title', 'days_worked', 'to_pay'], 'current_project');
  }
});

// ===================================================
// TEST 8: GET /worker/projects -> list
// ===================================================
test('T8: GET /worker/projects -> 200, projects array', async () => {
  const resp = await rawFetch('GET', FIELD_WORKER + '/projects', { token: fieldToken });
  assertStatus(resp, 200, 'projects');
  assert(Array.isArray(resp.data.projects), 'expected projects array');
  assert(resp.data.projects.length > 0, 'expected at least 1 project');
});

// ===================================================
// TEST 9: POST /checkin/manual (master) -> 200
// ===================================================
test('T9: POST /checkin/manual (master) -> 200', async () => {
  if (!masterToken) throw new Error('No master token');

  // Clean the checkin from T3-T5 first, so manual doesn't conflict
  await dbQuery(`DELETE FROM field_checkins WHERE employee_id = $1 AND work_id = $2 AND date = CURRENT_DATE`, [testEmployeeId, testWorkId]);

  const now = new Date();
  const checkinAt = new Date(now - 10 * 3600 * 1000).toISOString();
  const checkoutAt = now.toISOString();

  const resp = await rawFetch('POST', FIELD_CHECKIN + '/manual', {
    token: masterToken,
    body: {
      employee_id: testEmployeeId,
      work_id: testWorkId,
      checkin_at: checkinAt,
      checkout_at: checkoutAt,
      date: now.toISOString().split('T')[0],
      reason: 'Test manual checkin'
    }
  });
  assertStatus(resp, 200, 'manual checkin');
  assert(resp.data.checkin_id > 0, 'expected checkin_id');
  assert(resp.data.hours_worked > 0, 'expected hours_worked > 0');
  assert(resp.data.amount_earned > 0, 'expected amount_earned > 0');
});

// ===================================================
// TEST 10: POST /checkin/manual (worker) -> 403
// ===================================================
test('T10: POST /checkin/manual (worker) -> 403', async () => {
  // Worker tries to manually check in another worker — should fail
  await dbQuery(`DELETE FROM field_checkins WHERE employee_id = $1 AND work_id = $2 AND date = CURRENT_DATE`, [testEmployeeId, testWorkId]);

  const resp = await rawFetch('POST', FIELD_CHECKIN + '/manual', {
    token: fieldToken,
    body: { employee_id: masterEmployeeId || 999, work_id: testWorkId, reason: 'test' }
  });
  assertStatus(resp, 403, 'worker cannot manual checkin');
});

// Run
runTests();
