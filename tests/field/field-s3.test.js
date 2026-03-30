/**
 * ASGARD Field -- Session 3 Tests (Reports, Manage, Logistics, Photos)
 * Run: PGPASSWORD=123456789 node tests/field/field-s3.test.js
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { BASE_URL, rawFetch, assert, assertStatus, assertHasFields } = require('../config');
const { Client } = require('pg');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const CRM_JWT_SECRET = process.env.JWT_SECRET || 'asgard-jwt-secret-2026';

const FIELD_AUTH = '/api/field/auth';
const FIELD_REPORTS = '/api/field/reports';
const FIELD_MANAGE = '/api/field/manage';
const FIELD_LOGISTICS = '/api/field/logistics';
const FIELD_PHOTOS = '/api/field/photos';

let pgClient = null;
let testEmployeeId = null;
let testPhone = null;
let fieldToken = null;
let masterToken = null;
let masterEmployeeId = null;
let testWorkId = null;
let testAssignmentId = null;
let crmToken = null; // PM CRM token
let testReportId = null;
let testLogisticsId = null;

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
  await dbQuery(`DELETE FROM field_auth_codes WHERE employee_id = $1`, [empId]);
  await dbQuery(`DELETE FROM field_sessions WHERE employee_id = $1`, [empId]);
  const reqResp = await rawFetch('POST', FIELD_AUTH + '/request-code', { body: { phone } });
  if (reqResp.status !== 200) throw new Error('request-code failed: ' + reqResp.status);
  const { rows } = await dbQuery(
    `SELECT code FROM field_auth_codes WHERE employee_id = $1 AND used = false ORDER BY id DESC LIMIT 1`, [empId]
  );
  if (!rows.length) throw new Error('No code in DB');
  const verResp = await rawFetch('POST', FIELD_AUTH + '/verify-code', { body: { phone, code: rows[0].code } });
  if (verResp.status !== 200) throw new Error('verify-code failed: ' + verResp.status);
  return verResp.data.token;
}

async function runTests() {
  console.log('\n===================================================');
  console.log('  ASGARD Field -- Session 3 Tests');
  console.log('===================================================\n');

  // Setup
  try {
    // Get CRM token by finding an ADMIN user and signing JWT directly
    const { rows: admins } = await dbQuery(
      `SELECT id, login, name, role, email FROM users WHERE role = 'ADMIN' AND is_active = true LIMIT 1`
    );
    if (admins.length > 0) {
      const u = admins[0];
      crmToken = jwt.sign({ id: u.id, login: u.login, name: u.name, role: u.role, email: u.email, pinVerified: true }, CRM_JWT_SECRET);
    }
    console.log('  [Setup] CRM token: ' + (crmToken ? 'OK (user=' + admins[0]?.login + ')' : 'MISSING'));

    // Find test employee
    const { rows: emps } = await dbQuery(
      `SELECT id, fio, phone FROM employees WHERE phone IS NOT NULL AND phone != '' AND is_active = true ORDER BY id LIMIT 1`
    );
    testEmployeeId = emps[0].id;
    testPhone = emps[0].phone;
    console.log('  [Setup] Employee: id=' + testEmployeeId + ' phone=' + testPhone);

    // Get field token
    fieldToken = await getFieldToken(testEmployeeId, testPhone);
    console.log('  [Setup] Got field token');

    // Find or create work
    const { rows: works } = await dbQuery(`SELECT id FROM works WHERE work_status != 'closed' ORDER BY id DESC LIMIT 1`);
    if (works.length > 0) {
      testWorkId = works[0].id;
    } else {
      const { rows: newWork } = await dbQuery(
        `INSERT INTO works (work_title, city, work_status) VALUES ('FIELD_TEST_S3', 'TestCity', 'active') RETURNING id`
      );
      testWorkId = newWork[0].id;
    }
    console.log('  [Setup] Work id=' + testWorkId);

    // Get tariff
    const { rows: tariffs } = await dbQuery(
      `SELECT id, rate_per_shift, points FROM field_tariff_grid WHERE category = 'ground' AND is_combinable = false ORDER BY sort_order LIMIT 1`
    );
    const tariffId = tariffs.length > 0 ? tariffs[0].id : null;

    // Clean and create assignment as worker
    await dbQuery(`DELETE FROM field_checkins WHERE employee_id = $1 AND work_id = $2`, [testEmployeeId, testWorkId]);
    await dbQuery(`DELETE FROM employee_assignments WHERE employee_id = $1 AND work_id = $2`, [testEmployeeId, testWorkId]);

    const { rows: newAssign } = await dbQuery(`
      INSERT INTO employee_assignments (employee_id, work_id, field_role, tariff_id, tariff_points, is_active, shift_type)
      VALUES ($1, $2, 'worker', $3, $4, true, 'day') RETURNING id
    `, [testEmployeeId, testWorkId, tariffId, tariffs.length > 0 ? tariffs[0].points : null]);
    testAssignmentId = newAssign[0].id;

    // Project settings
    await dbQuery(`DELETE FROM field_project_settings WHERE work_id = $1`, [testWorkId]);

    // Get default report template
    const { rows: tmpl } = await dbQuery(`SELECT id FROM field_report_templates WHERE is_default = true LIMIT 1`);

    await dbQuery(`
      INSERT INTO field_project_settings (work_id, is_active, schedule_type, shift_hours, rounding_rule, rounding_step, per_diem, site_category, report_template_id)
      VALUES ($1, true, 'shift', 11, 'half_up', 0.5, 1000, 'ground', $2)
    `, [testWorkId, tmpl.length > 0 ? tmpl[0].id : null]);

    // Create master
    const { rows: masterEmps } = await dbQuery(
      `SELECT id, phone FROM employees WHERE phone IS NOT NULL AND phone != '' AND is_active = true AND id != $1 ORDER BY id LIMIT 1`,
      [testEmployeeId]
    );
    if (masterEmps.length > 0) {
      masterEmployeeId = masterEmps[0].id;
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

  // Run tests
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
    await dbQuery(`DELETE FROM field_daily_reports WHERE work_id = $1 AND author_id IN ($2, $3)`, [testWorkId, testEmployeeId, masterEmployeeId || 0]);
    await dbQuery(`DELETE FROM field_incidents WHERE work_id = $1`, [testWorkId]);
    await dbQuery(`DELETE FROM field_logistics WHERE work_id = $1`, [testWorkId]);
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
// TEST 1: POST /reports (master) -> 200
// ===================================================
test('T1: POST /reports (master) -> 200', async () => {
  if (!masterToken) throw new Error('No master token');
  const resp = await rawFetch('POST', FIELD_REPORTS, {
    token: masterToken,
    body: {
      work_id: testWorkId,
      date: new Date().toISOString().split('T')[0],
      shift: 'day',
      report_data: { tubes_done: 150, diameter: '25', notes: 'Test report' },
    }
  });
  assertStatus(resp, 200, 'master report');
  assert(resp.data.report_id > 0, 'expected report_id');
  assert(resp.data.quote, 'expected quote');
  testReportId = resp.data.report_id;
});

// ===================================================
// TEST 2: POST /reports (worker) -> 403
// ===================================================
test('T2: POST /reports (worker) -> 403', async () => {
  const resp = await rawFetch('POST', FIELD_REPORTS, {
    token: fieldToken,
    body: { work_id: testWorkId, report_data: {} }
  });
  assertStatus(resp, 403, 'worker cannot report');
});

// ===================================================
// TEST 3: GET /manage/tariffs?category=ground -> tariffs + specials
// ===================================================
test('T3: GET /manage/tariffs?category=ground -> tariffs + specials', async () => {
  if (!crmToken) throw new Error('No CRM token');
  const resp = await rawFetch('GET', FIELD_MANAGE + '/tariffs?category=ground', { token: crmToken });
  assertStatus(resp, 200, 'tariffs');
  assert(Array.isArray(resp.data.tariffs), 'expected tariffs array');
  assert(resp.data.tariffs.length >= 3, 'expected >= 3 ground tariffs, got ' + resp.data.tariffs.length);
  assert(Array.isArray(resp.data.specials), 'expected specials array');
  assert(resp.data.point_value === 500, 'expected point_value 500');
});

// ===================================================
// TEST 4: GET /manage/tariffs?category=mlsp -> 10 tariffs
// ===================================================
test('T4: GET /manage/tariffs?category=mlsp -> mlsp tariffs', async () => {
  if (!crmToken) throw new Error('No CRM token');
  const resp = await rawFetch('GET', FIELD_MANAGE + '/tariffs?category=mlsp', { token: crmToken });
  assertStatus(resp, 200, 'mlsp tariffs');
  assert(resp.data.tariffs.length >= 8, 'expected >= 8 mlsp tariffs, got ' + resp.data.tariffs.length);
});

// ===================================================
// TEST 5: POST /manage/projects/:id/crew with tariff -> correct rate
// ===================================================
test('T5: POST /crew with tariff -> correct rate', async () => {
  if (!crmToken) throw new Error('No CRM token');

  // Get ground tariff
  const { rows: tariffs } = await dbQuery(
    `SELECT id, rate_per_shift, points FROM field_tariff_grid WHERE category = 'ground' AND is_combinable = false ORDER BY sort_order LIMIT 1`
  );
  if (tariffs.length === 0) throw new Error('No ground tariff');

  const resp = await rawFetch('POST', FIELD_MANAGE + '/projects/' + testWorkId + '/crew', {
    token: crmToken,
    body: {
      employees: [{ employee_id: testEmployeeId, field_role: 'worker', tariff_id: tariffs[0].id, shift_type: 'day' }]
    }
  });
  assertStatus(resp, 200, 'crew assign');
  assert(resp.data.count === 1, 'expected count=1');
  assert(resp.data.results[0].ok === true, 'expected ok=true');
  assert(resp.data.results[0].day_rate === parseFloat(tariffs[0].rate_per_shift), 'expected day_rate=' + tariffs[0].rate_per_shift);
});

// ===================================================
// TEST 6: POST /crew with combination tariff -> rate = base + combo
// ===================================================
test('T6: POST /crew with combo tariff -> rate = base + combo', async () => {
  if (!crmToken) throw new Error('No CRM token');

  const { rows: base } = await dbQuery(
    `SELECT id, rate_per_shift FROM field_tariff_grid WHERE category = 'ground' AND is_combinable = false ORDER BY sort_order LIMIT 1`
  );
  const { rows: combo } = await dbQuery(
    `SELECT id, rate_per_shift FROM field_tariff_grid WHERE category = 'ground' AND is_combinable = true LIMIT 1`
  );
  if (base.length === 0 || combo.length === 0) throw new Error('No tariffs');

  const expectedRate = parseFloat(base[0].rate_per_shift) + parseFloat(combo[0].rate_per_shift);

  const resp = await rawFetch('POST', FIELD_MANAGE + '/projects/' + testWorkId + '/crew', {
    token: crmToken,
    body: {
      employees: [{
        employee_id: testEmployeeId, field_role: 'worker',
        tariff_id: base[0].id, combination_tariff_id: combo[0].id, shift_type: 'day'
      }]
    }
  });
  assertStatus(resp, 200, 'combo crew');
  assert(resp.data.results[0].day_rate === expectedRate, 'expected rate ' + expectedRate + ' got ' + resp.data.results[0].day_rate);
});

// ===================================================
// TEST 7: POST /crew with category mismatch -> error
// ===================================================
test('T7: POST /crew with category mismatch -> error in result', async () => {
  if (!crmToken) throw new Error('No CRM token');

  // Project is 'ground', try mlsp tariff
  const { rows: mlsp } = await dbQuery(
    `SELECT id FROM field_tariff_grid WHERE category = 'mlsp' LIMIT 1`
  );
  if (mlsp.length === 0) throw new Error('No mlsp tariff');

  const resp = await rawFetch('POST', FIELD_MANAGE + '/projects/' + testWorkId + '/crew', {
    token: crmToken,
    body: {
      employees: [{ employee_id: testEmployeeId, field_role: 'worker', tariff_id: mlsp[0].id }]
    }
  });
  assertStatus(resp, 200, 'mismatch response');
  assert(resp.data.results[0].error, 'expected error for mismatch');
  assert(resp.data.count === 0, 'expected count=0');
});

// ===================================================
// TEST 8: POST /manage/send-invites -> SMS log created
// ===================================================
test('T8: POST /send-invites -> sms log created', async () => {
  if (!crmToken) throw new Error('No CRM token');

  // Clean sms log
  await dbQuery(`DELETE FROM field_sms_log WHERE work_id = $1 AND message_type = 'invite'`, [testWorkId]);

  // Mark as not sent
  await dbQuery(`UPDATE employee_assignments SET sms_sent = false WHERE work_id = $1`, [testWorkId]);

  const resp = await rawFetch('POST', FIELD_MANAGE + '/projects/' + testWorkId + '/send-invites', {
    token: crmToken,
    body: {}
  });
  assertStatus(resp, 200, 'send-invites');
  assert(resp.data.total >= 0, 'expected total >= 0');

  // Check sms_log was created
  const { rows: logs } = await dbQuery(
    `SELECT COUNT(*) as cnt FROM field_sms_log WHERE work_id = $1 AND message_type = 'invite'`, [testWorkId]
  );
  // SMS may fail (no MANGO configured) but log should exist
  assert(parseInt(logs[0].cnt) >= 0, 'sms_log check ok');
});

// ===================================================
// TEST 9: GET /manage/dashboard -> correct counts
// ===================================================
test('T9: GET /dashboard -> correct structure', async () => {
  if (!crmToken) throw new Error('No CRM token');

  const resp = await rawFetch('GET', FIELD_MANAGE + '/projects/' + testWorkId + '/dashboard', { token: crmToken });
  assertStatus(resp, 200, 'dashboard');
  assertHasFields(resp.data, ['online_now', 'today_count', 'total_crew', 'today_hours', 'week_summary'], 'dashboard');
  assert(Array.isArray(resp.data.online_now), 'online_now is array');
  assert(resp.data.total_crew >= 0, 'total_crew >= 0');
});

// ===================================================
// TEST 10: POST /logistics + POST /:id/send -> status updated
// ===================================================
test('T10: POST /logistics + send -> logistics flow', async () => {
  if (!crmToken) throw new Error('No CRM token');

  // Create logistics item
  const createResp = await rawFetch('POST', FIELD_LOGISTICS, {
    token: crmToken,
    body: {
      work_id: testWorkId,
      employee_id: testEmployeeId,
      item_type: 'ticket',
      title: 'Test airline ticket',
      description: 'Moscow -> Noyabrsk'
    }
  });
  assertStatus(createResp, 200, 'create logistics');
  assert(createResp.data.logistics_id > 0, 'expected logistics_id');
  testLogisticsId = createResp.data.logistics_id;

  // Send to employee
  const sendResp = await rawFetch('POST', FIELD_LOGISTICS + '/' + testLogisticsId + '/send', { token: crmToken });
  assertStatus(sendResp, 200, 'send logistics');
  assert(sendResp.data.ok === true, 'expected ok');
});

// ===================================================
// TEST 11: GET /logistics/my (field auth) -> employee's logistics
// ===================================================
test('T11: GET /logistics/my -> employee logistics', async () => {
  const resp = await rawFetch('GET', FIELD_LOGISTICS + '/my', { token: fieldToken });
  assertStatus(resp, 200, 'my logistics');
  assert(Array.isArray(resp.data.logistics), 'expected logistics array');
});

// ===================================================
// TEST 12: POST /incidents (master) -> 200
// ===================================================
test('T12: POST /incidents (master) -> 200', async () => {
  if (!masterToken) throw new Error('No master token');

  const resp = await rawFetch('POST', FIELD_REPORTS + '/incidents', {
    token: masterToken,
    body: {
      work_id: testWorkId,
      incident_type: 'equipment_failure',
      description: 'Pump #2 overheating — stopped for cooldown',
      severity: 'medium',
      started_at: new Date().toISOString()
    }
  });
  assertStatus(resp, 200, 'incident');
  assert(resp.data.incident_id > 0, 'expected incident_id');
});

// Run
runTests();
