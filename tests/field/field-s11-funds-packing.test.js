/**
 * ASGARD Field — Session 11 Tests: Master Funds + Packing Lists
 * Запуск: node tests/field/field-s11-funds-packing.test.js
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { BASE_URL, rawFetch, assert, assertStatus, assertHasFields, getToken, initTokens } = require('../config');
const { Client } = require('pg');

const FUNDS_API = '/api/field/funds';
const PACKING_API = '/api/field/packing';

let pmToken = null;
let pgClient = null;
let testWorkId = null;
let testEmployeeId = null;
let testFundId = null;
let testListId = null;
let testItemId = null;

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

let passed = 0;
let failed = 0;
let skipped = 0;
const results = [];

function test(name, fn) {
  results.push({ name, fn });
}

async function runTests() {
  console.log('\n===================================================');
  console.log('  ASGARD Field — Session 11: Funds + Packing Tests');
  console.log('===================================================\n');

  // Setup
  try {
    await initTokens();
    pmToken = await getToken('PM');
    console.log('  [Setup] PM token obtained');
  } catch (e) {
    console.log('  [Setup] Token error:', (e.message || '').slice(0, 200));
  }

  // Find a work for testing
  try {
    const { rows } = await dbQuery(`SELECT id FROM works ORDER BY id DESC LIMIT 1`);
    if (rows.length > 0) {
      testWorkId = rows[0].id;
      console.log('  [Setup] Test work_id:', testWorkId);
    }
  } catch (e) {
    console.log('  [Setup] DB works query:', (e.message || '').slice(0, 200));
  }

  // Find an employee
  try {
    const { rows } = await dbQuery(`SELECT id FROM employees WHERE is_active = true ORDER BY id LIMIT 1`);
    if (rows.length > 0) {
      testEmployeeId = rows[0].id;
      console.log('  [Setup] Test employee_id:', testEmployeeId);
    }
  } catch (e) {
    console.log('  [Setup] DB employees query:', (e.message || '').slice(0, 200));
  }

  // ═══════════════════════════════════════
  // FUNDS TESTS
  // ═══════════════════════════════════════

  test('FUNDS: POST / — issue funds (validation)', async () => {
    const r = await rawFetch('POST', FUNDS_API + '/', { token: pmToken, body: {} });
    assertStatus(r, 400, 'missing fields should return 400');
    assert(r.data.error, 'should have error message');
  });

  test('FUNDS: POST / — issue funds (success)', async () => {
    if (!testWorkId || !testEmployeeId) return 'SKIP: no work/employee';
    const r = await rawFetch('POST', FUNDS_API + '/', {
      token: pmToken,
      body: {
        work_id: testWorkId,
        master_employee_id: testEmployeeId,
        amount: 50000,
        purpose: 'Тест: расходные материалы S11',
      },
    });
    assertStatus(r, 200, 'should create fund');
    assert(r.data.fund, 'should return fund object');
    assert(r.data.fund.id, 'fund should have id');
    assert(r.data.fund.status === 'issued', 'status should be issued');
    testFundId = r.data.fund.id;
  });

  test('FUNDS: GET / — list funds for work', async () => {
    if (!testWorkId) return 'SKIP: no work';
    const r = await rawFetch('GET', FUNDS_API + '/?work_id=' + testWorkId, { token: pmToken });
    assertStatus(r, 200, 'should list funds');
    assert(Array.isArray(r.data.funds), 'should return funds array');
  });

  test('FUNDS: GET /:id — fund details', async () => {
    if (!testFundId) return 'SKIP: no fund';
    const r = await rawFetch('GET', FUNDS_API + '/' + testFundId, { token: pmToken });
    assertStatus(r, 200, 'should get fund details');
    assert(r.data.fund, 'should return fund');
    assert(Array.isArray(r.data.expenses), 'should return expenses');
    assert(Array.isArray(r.data.returns), 'should return returns');
  });

  test('FUNDS: GET / — 400 without work_id', async () => {
    const r = await rawFetch('GET', FUNDS_API + '/', { token: pmToken });
    assertStatus(r, 400, 'should require work_id');
  });

  test('FUNDS: PUT /:id/close — close fund', async () => {
    if (!testFundId) return 'SKIP: no fund';
    const r = await rawFetch('PUT', FUNDS_API + '/' + testFundId + '/close', { token: pmToken });
    assertStatus(r, 200, 'should close fund');
    assert(r.data.ok === true, 'should return ok');
  });

  test('FUNDS: PUT /:id/close — double close rejected', async () => {
    if (!testFundId) return 'SKIP: no fund';
    const r = await rawFetch('PUT', FUNDS_API + '/' + testFundId + '/close', { token: pmToken });
    assertStatus(r, 400, 'double close should 400');
  });

  test('FUNDS: POST / — negative amount rejected', async () => {
    if (!testWorkId || !testEmployeeId) return 'SKIP';
    const r = await rawFetch('POST', FUNDS_API + '/', {
      token: pmToken,
      body: { work_id: testWorkId, master_employee_id: testEmployeeId, amount: -100, purpose: 'neg' },
    });
    assertStatus(r, 400, 'negative amount should 400');
  });

  test('FUNDS: 401 without token', async () => {
    const r = await rawFetch('GET', FUNDS_API + '/?work_id=1');
    assert(r.status === 401 || r.status === 403, 'should reject unauthenticated');
  });

  // ═══════════════════════════════════════
  // PACKING TESTS
  // ═══════════════════════════════════════

  test('PACKING: POST / — create list (validation)', async () => {
    const r = await rawFetch('POST', PACKING_API + '/', { token: pmToken, body: {} });
    assertStatus(r, 400, 'missing fields should 400');
  });

  test('PACKING: POST / — create list with items', async () => {
    if (!testWorkId) return 'SKIP: no work';
    const r = await rawFetch('POST', PACKING_API + '/', {
      token: pmToken,
      body: {
        work_id: testWorkId,
        title: 'Тест: комплект S11',
        description: 'Тестовый лист сборки',
        items: [
          { item_name: 'Каска строительная', quantity_required: 5, item_category: 'СИЗ' },
          { item_name: 'Перчатки', quantity_required: 10, unit: 'пар', item_category: 'СИЗ' },
          { item_name: 'Удлинитель 50м', quantity_required: 2, item_category: 'Инструмент' },
        ],
      },
    });
    assertStatus(r, 200, 'should create packing list');
    assert(r.data.list, 'should return list');
    assert(r.data.list.id, 'list should have id');
    assert(r.data.items_count === 3, 'should have 3 items');
    testListId = r.data.list.id;
  });

  test('PACKING: GET / — list packing lists', async () => {
    if (!testWorkId) return 'SKIP: no work';
    const r = await rawFetch('GET', PACKING_API + '/?work_id=' + testWorkId, { token: pmToken });
    assertStatus(r, 200, 'should list packing lists');
    assert(Array.isArray(r.data.lists), 'should return lists array');
  });

  test('PACKING: GET /:id — packing detail with items', async () => {
    if (!testListId) return 'SKIP: no list';
    const r = await rawFetch('GET', PACKING_API + '/' + testListId, { token: pmToken });
    assertStatus(r, 200, 'should get list detail');
    assert(r.data.list, 'should return list');
    assert(Array.isArray(r.data.items), 'should return items');
    assert(r.data.items.length === 3, 'should have 3 items');
    testItemId = r.data.items[0].id;
  });

  test('PACKING: POST /:id/items — add more items', async () => {
    if (!testListId) return 'SKIP: no list';
    const r = await rawFetch('POST', PACKING_API + '/' + testListId + '/items', {
      token: pmToken,
      body: {
        items: [
          { item_name: 'Болгарка', quantity_required: 1, item_category: 'Инструмент' },
        ],
      },
    });
    assertStatus(r, 200, 'should add items');
    assert(r.data.inserted === 1, 'should insert 1 item');
  });

  test('PACKING: PUT /:id — update list', async () => {
    if (!testListId) return 'SKIP: no list';
    const r = await rawFetch('PUT', PACKING_API + '/' + testListId, {
      token: pmToken,
      body: { tracking_number: 'TRACK-S11-001' },
    });
    assertStatus(r, 200, 'should update list');
  });

  test('PACKING: PUT /:id/items/:itemId — update item', async () => {
    if (!testListId || !testItemId) return 'SKIP';
    const r = await rawFetch('PUT', PACKING_API + '/' + testListId + '/items/' + testItemId, {
      token: pmToken,
      body: { quantity_required: 8 },
    });
    assertStatus(r, 200, 'should update item');
  });

  test('PACKING: POST /:id/assign — assign to employee', async () => {
    if (!testListId || !testEmployeeId) return 'SKIP';
    const r = await rawFetch('POST', PACKING_API + '/' + testListId + '/assign', {
      token: pmToken,
      body: { employee_id: testEmployeeId, send_sms: false },
    });
    assertStatus(r, 200, 'should assign');
    assert(r.data.ok === true, 'should return ok');
  });

  test('PACKING: DELETE /:id/items/:itemId — remove item', async () => {
    if (!testListId || !testItemId) return 'SKIP';
    const r = await rawFetch('DELETE', PACKING_API + '/' + testListId + '/items/' + testItemId, { token: pmToken });
    assertStatus(r, 200, 'should delete item');
  });

  test('PACKING: GET / — 400 without work_id', async () => {
    const r = await rawFetch('GET', PACKING_API + '/', { token: pmToken });
    assertStatus(r, 400, 'should require work_id');
  });

  test('PACKING: 401 without token', async () => {
    const r = await rawFetch('GET', PACKING_API + '/?work_id=1');
    assert(r.status === 401 || r.status === 403, 'should reject unauthenticated');
  });

  // ═══════════════════════════════════════
  // CLEANUP
  // ═══════════════════════════════════════

  test('CLEANUP: remove test data', async () => {
    try {
      if (testListId) {
        await dbQuery(`DELETE FROM field_packing_items WHERE list_id = $1`, [testListId]);
        await dbQuery(`DELETE FROM field_packing_lists WHERE id = $1`, [testListId]);
      }
      if (testFundId) {
        await dbQuery(`DELETE FROM field_master_expenses WHERE fund_id = $1`, [testFundId]);
        await dbQuery(`DELETE FROM field_master_returns WHERE fund_id = $1`, [testFundId]);
        await dbQuery(`DELETE FROM field_master_funds WHERE id = $1`, [testFundId]);
      }
      console.log('  [Cleanup] Test data removed');
    } catch (e) {
      console.log('  [Cleanup] Warning:', (e.message || '').slice(0, 200));
    }
  });

  // ─── Run all ───
  for (const t of results) {
    try {
      const result = await t.fn();
      if (result && result.startsWith && result.startsWith('SKIP')) {
        skipped++;
        console.log(`  ⏭ ${t.name} — ${result}`);
      } else {
        passed++;
        console.log(`  ✅ ${t.name}`);
      }
    } catch (err) {
      if (err.name === 'SkipError') {
        skipped++;
        console.log(`  ⏭ ${t.name} — ${err.message}`);
      } else {
        failed++;
        console.log(`  ❌ ${t.name} — ${err.message}`);
      }
    }
  }

  console.log(`\n  Results: ${passed} passed, ${failed} failed, ${skipped} skipped (total ${results.length})`);

  if (pgClient) await pgClient.end().catch(() => {});
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
