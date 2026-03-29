/**
 * ASGARD Field -- SMS Auth API Tests
 * Zapusk: node tests/field/field-auth.test.js
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { BASE_URL, rawFetch, assert, assertStatus, assertHasFields, getToken, initTokens } = require('../config');
const { Client } = require('pg');

const FIELD_AUTH = '/api/field/auth';

let testEmployeeId = null;
let testPhone = null;
let smsCode = null;
let fieldToken = null;
let pgClient = null;

// Direct DB access for test helpers
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

// Test counter
let passed = 0;
let failed = 0;
let skipped = 0;
const results = [];

function test(name, fn) {
  results.push({ name, fn });
}

async function runTests() {
  console.log('\n===================================================');
  console.log('  ASGARD Field -- Auth API Tests');
  console.log('===================================================\n');

  // Setup: get admin token, find test employee, cleanup old codes
  try {
    await initTokens();
  } catch (e) {
    console.log('  [Setup] initTokens warning:', (e.message || '').slice(0, 100));
  }

  // Find an active employee with a phone
  try {
    const { rows } = await dbQuery(
      `SELECT id, fio, phone FROM employees WHERE phone IS NOT NULL AND phone != '' AND is_active = true ORDER BY id LIMIT 1`
    );
    if (rows.length > 0) {
      testEmployeeId = rows[0].id;
      testPhone = rows[0].phone;
      console.log('  [Setup] Test employee: id=' + testEmployeeId + ', phone=' + testPhone);
    } else {
      console.log('  [Setup] ERROR: No employee with phone found');
    }
  } catch (e) {
    console.log('  [Setup] DB error:', (e.message || '').slice(0, 200));
  }

  // Cleanup old auth codes for this phone
  try {
    if (testPhone) {
      await dbQuery(`DELETE FROM field_auth_codes WHERE phone LIKE $1`, ['%' + testPhone.replace(/\D/g, '').slice(-10)]);
      await dbQuery(`DELETE FROM field_sessions WHERE employee_id = $1`, [testEmployeeId]);
      console.log('  [Setup] Cleaned up old codes and sessions');
    }
  } catch (e) {
    console.log('  [Setup] Cleanup warning:', (e.message || '').slice(0, 100));
  }

  // Run tests
  for (const { name, fn } of results) {
    try {
      await fn();
      passed++;
      console.log('  PASS ' + name);
    } catch (e) {
      failed++;
      console.log('  FAIL ' + name);
      console.log('     ' + (e.message || ''));
    }
  }

  console.log('\n---------------------------------------------------');
  console.log('  Results: ' + passed + ' passed, ' + failed + ' failed (total ' + results.length + ')');
  console.log('---------------------------------------------------\n');

  // Cleanup
  try {
    if (pgClient) await pgClient.end();
  } catch (_) {}

  process.exit(failed > 0 ? 1 : 0);
}

// ===================================================
// TEST 1: Request code with valid phone -> 200
// ===================================================
test('T1: POST /request-code with valid phone -> 200', async () => {
  if (!testEmployeeId) throw new Error('No test employee');

  const resp = await rawFetch('POST', FIELD_AUTH + '/request-code', {
    body: { phone: testPhone }
  });

  assertStatus(resp, 200, 'request-code');
  assert(resp.data.ok === true, 'expected ok:true');
  assert(resp.data.expires_in > 0, 'expected expires_in > 0');
});

// ===================================================
// TEST 2: Request code with unknown phone -> 404
// ===================================================
test('T2: POST /request-code with unknown phone -> 404', async () => {
  const resp = await rawFetch('POST', FIELD_AUTH + '/request-code', {
    body: { phone: '+79999999999' }
  });

  assertStatus(resp, 404, 'unknown phone');
});

// ===================================================
// TEST 3: Request code again within 60s -> 429
// ===================================================
test('T3: POST /request-code repeat < 60s -> 429', async () => {
  if (!testEmployeeId) throw new Error('No test employee');

  const resp = await rawFetch('POST', FIELD_AUTH + '/request-code', {
    body: { phone: testPhone }
  });

  assertStatus(resp, 429, 'rate limit');
});

// ===================================================
// TEST 4: Verify code with correct code -> 200 + JWT
// ===================================================
test('T4: POST /verify-code with correct code -> 200, token + employee', async () => {
  if (!testEmployeeId) throw new Error('No test employee');

  // Read code from DB directly
  const { rows } = await dbQuery(
    `SELECT code FROM field_auth_codes WHERE employee_id = $1 AND used = false AND expires_at > NOW() ORDER BY id DESC LIMIT 1`,
    [testEmployeeId]
  );

  if (rows.length === 0) throw new Error('No auth code found in DB');
  smsCode = rows[0].code;

  const resp = await rawFetch('POST', FIELD_AUTH + '/verify-code', {
    body: { phone: testPhone, code: smsCode }
  });

  assertStatus(resp, 200, 'verify-code');
  assert(resp.data.token, 'expected token in response');
  assert(resp.data.employee, 'expected employee in response');
  assert(resp.data.employee.id, 'expected employee.id');
  assertHasFields(resp.data.employee, ['id', 'fio', 'phone'], 'employee');

  fieldToken = resp.data.token;
});

// ===================================================
// TEST 5: Verify code with wrong code -> 401
// ===================================================
test('T5: POST /verify-code with wrong code -> 401', async () => {
  if (!testEmployeeId) throw new Error('No test employee');

  // Clean up cooldown so we can request a new code
  await dbQuery(`DELETE FROM field_auth_codes WHERE employee_id = $1`, [testEmployeeId]);

  // Request a new code
  const reqResp = await rawFetch('POST', FIELD_AUTH + '/request-code', {
    body: { phone: testPhone }
  });
  assertStatus(reqResp, 200, 'request new code for T5');

  // Try wrong code
  const resp = await rawFetch('POST', FIELD_AUTH + '/verify-code', {
    body: { phone: testPhone, code: '0000' }
  });

  assertStatus(resp, 401, 'wrong code');
});

// ===================================================
// TEST 6: Verify code 3+ attempts -> 429
// ===================================================
test('T6: POST /verify-code 3+ attempts -> 429 (code blocked)', async () => {
  if (!testEmployeeId) throw new Error('No test employee');

  // We already have a code from T5 with 1 attempt used
  // Try 2 more wrong codes to exhaust attempts
  await rawFetch('POST', FIELD_AUTH + '/verify-code', {
    body: { phone: testPhone, code: '1111' }
  });
  await rawFetch('POST', FIELD_AUTH + '/verify-code', {
    body: { phone: testPhone, code: '2222' }
  });

  // 4th attempt should be blocked
  const resp = await rawFetch('POST', FIELD_AUTH + '/verify-code', {
    body: { phone: testPhone, code: '3333' }
  });

  assertStatus(resp, 429, '3+ attempts');
});

// ===================================================
// TEST 7: GET /me with valid token -> 200
// ===================================================
test('T7: GET /me with valid field token -> 200, employee data', async () => {
  if (!fieldToken) throw new Error('No field token (T4 must pass first)');

  const resp = await rawFetch('GET', FIELD_AUTH + '/me', {
    token: fieldToken
  });

  assertStatus(resp, 200, 'me');
  assertHasFields(resp.data, ['id', 'fio', 'phone'], 'me response');
  assert(resp.data.id === testEmployeeId, 'expected employee id=' + testEmployeeId + ', got ' + resp.data.id);
});

// ===================================================
// TEST 8: GET /me without token -> 401
// ===================================================
test('T8: GET /me without token -> 401', async () => {
  const resp = await rawFetch('GET', FIELD_AUTH + '/me');

  assertStatus(resp, 401, 'me without token');
});

// Run
runTests();
