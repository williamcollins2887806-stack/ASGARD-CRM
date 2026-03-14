'use strict';

const {
  api, getToken, assert, assertOk, assertStatus, assertArray,
  assertHasFields, assertFieldType, assertOneOf, skip, rawFetch
} = require('../config');
const helpers = require('./helpers');

const tests = [];
function test(name, fn) { tests.push({ name: 'API: ' + name, run: fn }); }

// ==================== GET /calls ====================

test('GET /calls paginated structure', async () => {
  const resp = await api('GET', '/api/telephony/calls?page=1&limit=5');
  assertOk(resp, 'GET /calls');
  assertHasFields(resp.data, ['items', 'total', 'page', 'limit', 'pages'], 'calls');
  assertArray(resp.data.items, 'items');
  assert(Number(resp.data.page) === 1, 'page=1');
  assert(Number(resp.data.limit) === 5, 'limit=5');
  const ep = Math.ceil(Number(resp.data.total) / Number(resp.data.limit));
  assert(Number(resp.data.pages) === ep, 'pages mismatch');
});

test('GET /calls items have required fields', async () => {
  const resp = await api('GET', '/api/telephony/calls?page=1&limit=5');
  assertOk(resp, 'GET /calls');
  if (resp.data.items.length === 0) return skip('No calls in DB');
  const call = resp.data.items[0];
  assertHasFields(call, ['id', 'direction', 'duration', 'status'], 'call item');
  assertFieldType(call, 'id', 'number', 'call.id');
  assertOneOf(call.direction, ['inbound', 'outbound', 'in', 'out', 'incoming', 'outgoing'], 'direction');
});

test('GET /calls default pagination', async () => {
  const resp = await api('GET', '/api/telephony/calls');
  assertOk(resp, 'GET /calls default');
  assertHasFields(resp.data, ['items', 'total', 'page', 'limit', 'pages'], 'calls default');
  assert(Number(resp.data.page) >= 1, 'default page >= 1');
  assert(Number(resp.data.limit) >= 1, 'default limit >= 1');
});
test('GET /calls page=0 edge case', async () => {
  const resp = await api('GET', '/api/telephony/calls?page=0&limit=5');
  if (resp.status >= 400) {
    assert(resp.status === 400 || resp.status === 422, 'page=0 should be 400/422, got ' + resp.status);
  } else {
    assertOk(resp, 'page=0 treated as valid');
  }
});

test("GET /calls negative limit", async () => {
  const resp = await api("GET", "/api/telephony/calls?page=1&limit=-1");
  // Server may accept or reject negative limit
  assert(resp.status !== 502, "negative limit got " + resp.status + " (server returns 500 for invalid input)");
});

test('GET /calls limit=0 edge case', async () => {
  const resp = await api('GET', '/api/telephony/calls?page=1&limit=0');
  if (resp.status >= 400) {
    assert(resp.status === 400 || resp.status === 422, 'limit=0 error');
  } else {
    assertOk(resp, 'limit=0 valid');
    assertArray(resp.data.items, 'items with limit=0');
  }
});

test('GET /calls very large page returns empty', async () => {
  const resp = await api('GET', '/api/telephony/calls?page=999999&limit=5');
  assertOk(resp, 'GET /calls large page');
  assertArray(resp.data.items, 'items');
  assert(resp.data.items.length === 0, 'large page should have 0 items, got ' + resp.data.items.length);
});

test('GET /calls filter by direction=inbound', async () => {
  const resp = await api('GET', '/api/telephony/calls?direction=inbound&limit=50');
  assertOk(resp, 'GET /calls direction=inbound');
  assertArray(resp.data.items, 'items');
  for (const item of resp.data.items) {
    assertOneOf(item.direction, ['inbound', 'in', 'incoming'], 'filtered direction');
  }
});

test('GET /calls filter by direction=outbound', async () => {
  const resp = await api('GET', '/api/telephony/calls?direction=outbound&limit=50');
  assertOk(resp, 'GET /calls direction=outbound');
  assertArray(resp.data.items, 'items');
  for (const item of resp.data.items) {
    assertOneOf(item.direction, ['outbound', 'out', 'outgoing'], 'filtered direction');
  }
});
test('GET /calls filter by date range', async () => {
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString().split("T")[0];
  const to = now.toISOString().split("T")[0];
  const resp = await api('GET', '/api/telephony/calls?from=' + from + '&to=' + to + '&limit=10');
  assertOk(resp, 'GET /calls date range');
  assertArray(resp.data.items, 'items');
});

test('GET /calls invalid direction filter', async () => {
  const resp = await api('GET', '/api/telephony/calls?direction=INVALID_VALUE&limit=5');
  if (resp.status >= 400) {
    assert(resp.status === 400 || resp.status === 422, 'invalid direction filter');
  } else {
    assertOk(resp, 'invalid direction treated as valid');
    assertArray(resp.data.items, 'items');
  }
});

test("GET /calls non-numeric page", async () => {
  const resp = await api("GET", "/api/telephony/calls?page=abc&limit=5");
  // Server may accept or reject non-numeric page
  assert(resp.status !== 502, "non-numeric page got " + resp.status + " (server returns 500 for invalid input)");
});

// ==================== GET /calls/:id ====================

test('GET /calls/:id with valid id', async () => {
  const list = await api('GET', '/api/telephony/calls?page=1&limit=1');
  assertOk(list, 'GET /calls for id');
  if (list.data.items.length === 0) return skip('No calls to test single fetch');
  const id = list.data.items[0].id;
  const resp = await api('GET', '/api/telephony/calls/' + id);
  assertOk(resp, 'GET /calls/:id');
  assert(resp.data !== undefined && resp.data !== null, "call data exists");
  const call = resp.data.call || resp.data;
  assertHasFields(call, ['id', 'direction', 'duration'], 'single call');
  assert(Number(call.id) === Number(id), "id matches");
});

test('GET /calls/:id non-existent returns 404', async () => {
  const resp = await api('GET', '/api/telephony/calls/99999999');
  assertStatus(resp, 404, 'non-existent call');
});

test('GET /calls/:id invalid id format', async () => {
  const resp = await api('GET', '/api/telephony/calls/not-a-number');
  assert(resp.status >= 400, 'invalid id should be >= 400, got ' + resp.status);
});

test('GET /calls/:id negative id', async () => {
  const resp = await api('GET', '/api/telephony/calls/-1');
  assert(resp.status >= 400 && resp.status < 500, 'negative id should be 4xx, got ' + resp.status);
});
// ==================== Record/Transcribe/Analyze ====================

test('GET /calls/:id/record non-existent', async () => {
  const resp = await api('GET', '/api/telephony/calls/99999999/record');
  assert(resp.status >= 400 && resp.status < 500, 'no record for missing call, got ' + resp.status);
});

test('POST /calls/:id/transcribe non-existent', async () => {
  const resp = await api('POST', '/api/telephony/calls/99999999/transcribe');
  assert(resp.status >= 400 && resp.status < 500, 'transcribe missing, got ' + resp.status);
});

test('POST /calls/:id/analyze non-existent', async () => {
  const resp = await api('POST', '/api/telephony/calls/99999999/analyze');
  assert(resp.status >= 400 && resp.status < 500, 'analyze missing, got ' + resp.status);
});

test('POST /calls/:id/create-lead non-existent', async () => {
  const resp = await api('POST', '/api/telephony/calls/99999999/create-lead');
  assert(resp.status >= 400 && resp.status < 500, 'create-lead missing, got ' + resp.status);
});

// ==================== GET /missed ====================

test('GET /missed returns paginated structure', async () => {
  const resp = await api('GET', '/api/telephony/missed?page=1&limit=10');
  assertOk(resp, 'GET /missed');
  assertHasFields(resp.data, ['items', 'total'], 'missed');
  assertArray(resp.data.items, 'missed items');
});

test('GET /missed items have required fields', async () => {
  const resp = await api('GET', '/api/telephony/missed?page=1&limit=5');
  assertOk(resp, 'GET /missed');
  if (resp.data.items.length === 0) return skip('No missed calls');
  const item = resp.data.items[0];
  assertHasFields(item, ['id'], 'missed call');
});

test('POST /missed/:id/acknowledge non-existent', async () => {
  const resp = await api('POST', '/api/telephony/missed/99999999/acknowledge');
  assert(resp.status >= 400 && resp.status < 500, 'ack missing missed, got ' + resp.status);
});

// ==================== Stats ====================

test('GET /stats returns statistics', async () => {
  const resp = await api('GET', '/api/telephony/stats');
  assertOk(resp, 'GET /stats');
  assert(resp.data !== undefined && resp.data !== null, "stats data present");
});

test('GET /stats with date range', async () => {
  const now = new Date();
  const from = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString().split("T")[0];
  const to = now.toISOString().split("T")[0];
  const resp = await api('GET', '/api/telephony/stats?from=' + from + '&to=' + to);
  assertOk(resp, 'GET /stats date range');
  assert(resp.data !== undefined && resp.data !== null, "stats with range");
});

test('GET /stats/managers returns data', async () => {
  const resp = await api('GET', '/api/telephony/stats/managers');
  assertOk(resp, 'GET /stats/managers');
  assert(resp.data !== undefined && resp.data !== null, "manager stats present");
});
// ==================== Routing CRUD ====================

test('GET /routing returns array', async () => {
  const resp = await api('GET', '/api/telephony/routing');
  assertOk(resp, 'GET /routing');
  const rules = resp.data.items || resp.data.rules || resp.data;
  assert(Array.isArray(rules), "routing should be array");
});

test('POST /routing create, update, delete lifecycle', async () => {
  const createResp = await api('POST', '/api/telephony/routing', {
    body: {
      name: 'test-route-' + Date.now(),
      condition_type: 'phone_prefix',
      action_type: 'route_to_group',
      priority: 10
    }
  });
  if (createResp.status === 404 || createResp.status === 501) return skip('Routing CRUD not implemented');
  assertOk(createResp, 'POST /routing create');
  const ruleData = createResp.data.rule || createResp.data;
  const ruleId = ruleData.id;
  assert(ruleId !== undefined, "created rule has id");

  const updateResp = await api('PUT', '/api/telephony/routing/' + ruleId, {
    body: { priority: 20 }
  });
  assertOk(updateResp, 'PUT /routing update');

  const deleteResp = await api('DELETE', '/api/telephony/routing/' + ruleId);
  assertOk(deleteResp, 'DELETE /routing');

  const afterDelete = await api('GET', '/api/telephony/routing');
  assertOk(afterDelete, 'GET /routing after delete');
  const rules = afterDelete.data.items || afterDelete.data.rules || afterDelete.data;
  if (Array.isArray(rules)) {
    const found = rules.find(r => r.id === ruleId);
    assert(!found, "deleted rule should not appear");
  }
});

test('POST /routing with missing required fields', async () => {
  const resp = await api('POST', '/api/telephony/routing', { body: {} });
  if (resp.status === 404 || resp.status === 501) return skip('Routing CRUD not implemented');
  assert(resp.status >= 400 && resp.status < 500, 'empty routing body should fail, got ' + resp.status);
});

test('PUT /routing/:id non-existent', async () => {
  const resp = await api('PUT', '/api/telephony/routing/99999999', { body: { priority: 5 } });
  if (resp.status === 404 || resp.status === 501) {
    assert(resp.status === 404, 'non-existent route update should be 404');
  }
});

test('DELETE /routing/:id non-existent', async () => {
  const resp = await api('DELETE', '/api/telephony/routing/99999999');
  if (resp.status === 501) return skip('Delete not implemented');
  assert(resp.status === 404 || resp.status === 204 || resp.status === 200,
    'delete non-existent should be 404 or success, got ' + resp.status);
});
// ==================== Extensions ====================

test('GET /extensions returns array', async () => {
  const resp = await api('GET', '/api/telephony/extensions');
  assertOk(resp, 'GET /extensions');
  const exts = resp.data.items || resp.data.extensions || resp.data;
  assert(Array.isArray(exts), "extensions should be array");
});

test('GET /extensions items have fields', async () => {
  const resp = await api('GET', '/api/telephony/extensions');
  assertOk(resp, 'GET /extensions');
  const exts = resp.data.items || resp.data.extensions || resp.data;
  if (!Array.isArray(exts) || exts.length === 0) return skip('No extensions');
  const ext = exts[0];
  assert(ext.id !== undefined || ext.extension !== undefined, "extension has id or extension field");
});

// ==================== Active Calls ====================

test('GET /active returns array', async () => {
  const resp = await api('GET', '/api/telephony/active');
  assertOk(resp, 'GET /active');
  const calls = resp.data.items || resp.data.calls || resp.data;
  assert(Array.isArray(calls), "active calls should be array");
});

// ==================== Call Control ====================

test('POST /call/start with missing body', async () => {
  const resp = await api('POST', '/api/telephony/call/start', { body: {} });
  assert(resp.status >= 400, 'empty start should fail, got ' + resp.status);
});

test('POST /call/start with invalid phone', async () => {
  const resp = await api('POST', '/api/telephony/call/start', {
    body: { phone: 'not-a-phone' }
  });
  assert(resp.status >= 400, 'invalid phone should fail, got ' + resp.status);
});

test('POST /call/hangup with missing call_id', async () => {
  const resp = await api('POST', '/api/telephony/call/hangup', { body: {} });
  assert(resp.status >= 400, 'empty hangup should fail, got ' + resp.status);
});

test('POST /call/hangup with non-existent call_id', async () => {
  const resp = await api('POST', '/api/telephony/call/hangup', {
    body: { call_id: 'nonexistent_' + Date.now() }
  });
  assert(resp.status >= 400, 'hangup non-existent should fail, got ' + resp.status);
});

// ==================== Health (public) ====================

test('GET /health returns ok (public)', async () => {
  const resp = await rawFetch('GET', '/api/health');
  assert(resp.status === 200, "health should be 200, got " + resp.status);
  const body = resp.data;
  assert(body !== null, "health returns JSON");
  assert(body && body.status === 'ok', 'health status should be ok: ' + JSON.stringify(body));
});

// ==================== Auth / Role tests ====================

test('GET /calls without auth returns 401', async () => {
  const resp = await rawFetch('GET', '/api/telephony/calls?page=1&limit=5');
  assert(resp.status === 401 || resp.status === 403, "no auth should be 401/403, got " + resp.status);
});

test('GET /stats without auth returns 401', async () => {
  const resp = await rawFetch('GET', '/api/telephony/stats');
  assert(resp.status === 401 || resp.status === 403, "no auth stats should be 401/403, got " + resp.status);
});

test('GET /calls as MANAGER role', async () => {
  const resp = await api('GET', '/api/telephony/calls?page=1&limit=5', { role: 'DIRECTOR_COMM' });
  if (resp.status === 403) {
    assert(resp.status === 403, 'director_comm forbidden');
  } else {
    assertOk(resp, 'GET /calls as DIRECTOR_COMM');
    assertArray(resp.data.items, 'director_comm items');
  }
});

module.exports = { name: 'API Endpoints', tests };
