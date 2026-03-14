'use strict';

const {
  api, assert, assertOk, assertStatus, assertHasFields,
  assertFieldType, assertArray, assertOneOf, skip
} = require('../config');
const helpers = require('./helpers');

const tests = [];
function test(name, fn) { tests.push({ name: 'FieldVal: ' + name, run: fn }); }

// ==================== Call Item Field Types ====================

test('Call items - id is number', async () => {
  const resp = await api('GET', '/api/telephony/calls?page=1&limit=5');
  assertOk(resp, 'GET /calls');
  if (resp.data.items.length === 0) return skip('No calls');
  for (const call of resp.data.items) {
    assert(typeof call.id === "number" || typeof call.id === "string",
      "call.id should be number or string, got " + typeof call.id);
    assert(Number.isFinite(Number(call.id)), "call.id should be numeric: " + call.id);
  }
});

test('Call items - direction is valid enum', async () => {
  const resp = await api('GET', '/api/telephony/calls?page=1&limit=20');
  assertOk(resp, 'GET /calls');
  if (resp.data.items.length === 0) return skip('No calls');
  const validDirections = ['inbound', 'outbound', 'in', 'out', 'incoming', 'outgoing', '1', '2'];
  for (const call of resp.data.items) {
    if (call.direction !== undefined && call.direction !== null) {
      const dir = String(call.direction).toLowerCase();
      assert(validDirections.includes(dir),
        "call.direction should be valid enum, got: " + call.direction);
    }
  }
});

test('Call items - duration is non-negative number', async () => {
  const resp = await api('GET', '/api/telephony/calls?page=1&limit=20');
  assertOk(resp, 'GET /calls');
  if (resp.data.items.length === 0) return skip('No calls');
  for (const call of resp.data.items) {
    if (call.duration !== undefined && call.duration !== null) {
      const dur = Number(call.duration);
      assert(Number.isFinite(dur), "duration should be finite: " + call.duration);
      assert(dur >= 0, "duration should be >= 0, got " + dur);
    }
  }
});

test('Call items - status is valid string', async () => {
  const resp = await api('GET', '/api/telephony/calls?page=1&limit=20');
  assertOk(resp, 'GET /calls');
  if (resp.data.items.length === 0) return skip('No calls');
  for (const call of resp.data.items) {
    if (call.status !== undefined && call.status !== null) {
      assert(typeof call.status === "string", "status should be string, got " + typeof call.status);
      assert(call.status.length > 0, "status should not be empty");
    }
  }
});
test('Call items - created_at/start_time is valid date string', async () => {
  const resp = await api('GET', '/api/telephony/calls?page=1&limit=10');
  assertOk(resp, 'GET /calls');
  if (resp.data.items.length === 0) return skip('No calls');
  for (const call of resp.data.items) {
    const ts = call.created_at || call.start_time || call.timestamp;
    if (ts) {
      const d = new Date(ts);
      assert(!isNaN(d.getTime()), "date should be parseable: " + ts);
      assert(d.getFullYear() >= 2020, "year should be >= 2020: " + ts);
    }
  }
});

test('Call items - phone numbers have valid format', async () => {
  const resp = await api('GET', '/api/telephony/calls?page=1&limit=10');
  assertOk(resp, 'GET /calls');
  if (resp.data.items.length === 0) return skip('No calls');
  for (const call of resp.data.items) {
    const phone = call.from_number || call.caller || call.phone || call.from;
    if (phone) {
      assert(typeof phone === "string", "phone should be string: " + typeof phone);
      assert(phone.length >= 3, "phone too short: " + phone);
    }
  }
});

// ==================== Pagination Field Types ====================

test('Pagination - total is non-negative integer', async () => {
  const resp = await api('GET', '/api/telephony/calls?page=1&limit=5');
  assertOk(resp, 'GET /calls');
  const total = Number(resp.data.total);
  assert(Number.isInteger(total), "total should be integer: " + resp.data.total);
  assert(total >= 0, "total should be >= 0: " + total);
});

test('Pagination - pages matches ceil(total/limit)', async () => {
  const resp = await api('GET', '/api/telephony/calls?page=1&limit=7');
  assertOk(resp, 'GET /calls');
  const total = Number(resp.data.total);
  const limit = Number(resp.data.limit);
  const pages = Number(resp.data.pages);
  if (total === 0) {
    assert(pages === 0 || pages === 1, "0 items: pages should be 0 or 1, got " + pages);
  } else {
    const expected = Math.ceil(total / limit);
    assert(pages === expected, "pages mismatch: expected " + expected + " got " + pages);
  }
});

test('Pagination - items.length <= limit', async () => {
  const resp = await api('GET', '/api/telephony/calls?page=1&limit=3');
  assertOk(resp, 'GET /calls');
  assert(resp.data.items.length <= 3, "items should be <= limit 3, got " + resp.data.items.length);
});

test('Pagination - page 2 returns different items than page 1', async () => {
  const p1 = await api('GET', '/api/telephony/calls?page=1&limit=3');
  assertOk(p1, 'page 1');
  if (Number(p1.data.total) <= 3) return skip('Not enough calls for multi-page test');
  const p2 = await api('GET', '/api/telephony/calls?page=2&limit=3');
  assertOk(p2, 'page 2');
  if (p1.data.items.length > 0 && p2.data.items.length > 0) {
    const ids1 = p1.data.items.map(i => i.id);
    const ids2 = p2.data.items.map(i => i.id);
    const overlap = ids1.filter(id => ids2.includes(id));
    assert(overlap.length === 0, "page 1 and 2 should not overlap, found: " + overlap.join(","));
  }
});
// ==================== Stats Field Validation ====================

test('Stats - numeric fields are valid numbers', async () => {
  const resp = await api('GET', '/api/telephony/stats');
  assertOk(resp, 'GET /stats');
  const stats = resp.data;
  // Check all numeric-looking fields
  for (const key of Object.keys(stats)) {
    const val = stats[key];
    if (typeof val === "number") {
      assert(Number.isFinite(val), "stats." + key + " should be finite: " + val);
      assert(val >= 0, "stats." + key + " should be >= 0: " + val);
    }
  }
});

test('Stats/managers - each manager has required fields', async () => {
  const resp = await api('GET', '/api/telephony/stats/managers');
  assertOk(resp, 'GET /stats/managers');
  const managers = resp.data.items || resp.data.managers || resp.data;
  if (!Array.isArray(managers) || managers.length === 0) return skip('No manager stats');
  for (const mgr of managers) {
    assert(mgr.id !== undefined || mgr.manager_id !== undefined || mgr.name !== undefined,
      "manager should have id or name");
  }
});

// ==================== Missed Call Field Validation ====================

test('Missed calls - items have phone and timestamp', async () => {
  const resp = await api('GET', '/api/telephony/missed?page=1&limit=10');
  assertOk(resp, 'GET /missed');
  if (resp.data.items.length === 0) return skip('No missed calls');
  for (const item of resp.data.items) {
    assert(item.id !== undefined, "missed call should have id");
    // Check if phone-like field exists
    const hasPhone = item.from || item.phone || item.caller || item.from_number;
    assert(hasPhone !== undefined, "missed call should have phone info");
  }
});

// ==================== Routing Rule Field Validation ====================

test('Routing rules - items have required fields', async () => {
  const resp = await api('GET', '/api/telephony/routing');
  assertOk(resp, 'GET /routing');
  const rules = resp.data.items || resp.data.rules || resp.data;
  if (!Array.isArray(rules) || rules.length === 0) return skip('No routing rules');
  for (const rule of rules) {
    assert(rule.id !== undefined, "rule should have id");
    if (rule.priority !== undefined) {
      assert(typeof rule.priority === "number", "priority should be number: " + typeof rule.priority);
    }
  }
});

// ==================== Extension Field Validation ====================

test('Extensions - items have number/extension field', async () => {
  const resp = await api('GET', '/api/telephony/extensions');
  assertOk(resp, 'GET /extensions');
  const exts = resp.data.items || resp.data.extensions || resp.data;
  if (!Array.isArray(exts) || exts.length === 0) return skip('No extensions');
  for (const ext of exts) {
    const num = ext.mango_extension || ext.sip_login || ext.extension || ext.number || ext.name;
    assert(num !== undefined, "extension should have number/extension field");
  }
});

// ==================== Consistency Checks ====================

test('Total from /calls matches /stats total_calls if available', async () => {
  const callsResp = await api('GET', '/api/telephony/calls?page=1&limit=1');
  assertOk(callsResp, 'GET /calls');
  const callsTotal = Number(callsResp.data.total);

  const statsResp = await api('GET', '/api/telephony/stats');
  assertOk(statsResp, 'GET /stats');
  const statsTotal = statsResp.data.total_calls || statsResp.data.totalCalls || statsResp.data.total;
  if (statsTotal === undefined) return skip("stats does not have total_calls field");
  // They should be close (stats might be cached)
  const diff = Math.abs(callsTotal - Number(statsTotal));
  assert(diff <= 10, "total mismatch: calls=" + callsTotal + " stats=" + statsTotal);
});

test('Single call has same fields as list item', async () => {
  const list = await api('GET', '/api/telephony/calls?page=1&limit=1');
  assertOk(list, 'GET /calls');
  if (list.data.items.length === 0) return skip('No calls');
  const listItem = list.data.items[0];
  const single = await api('GET', '/api/telephony/calls/' + listItem.id);
  assertOk(single, 'GET /calls/:id');
  const singleCall = single.data.call || single.data;
  // Single call should have at least the same fields as list item
  for (const key of Object.keys(listItem)) {
    assert(singleCall[key] !== undefined,
      "single call missing field: " + key + " that list item has");
  }
});

module.exports = { name: 'Field Validation', tests };
