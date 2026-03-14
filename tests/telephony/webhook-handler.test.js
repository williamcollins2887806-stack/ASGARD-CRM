'use strict';

const {
  api, rawFetch, assert, assertOk, assertStatus, assertHasFields,
  assertArray, skip
} = require('../config');
const helpers = require('./helpers');
const crypto = require("crypto");

const tests = [];
function test(name, fn) { tests.push({ name: 'Webhook: ' + name, run: fn }); }

// Mango webhook signature helper
function mangoSign(apiKey, json, apiSalt) {
  return crypto.createHash("sha256").update(apiKey + json + apiSalt).digest("hex");
}

const FAKE_KEY = "test_api_key_12345";
const FAKE_SALT = "test_api_salt_67890";

// ==================== Webhook /events/call ====================

test('POST /webhook/events/call with valid signature', async () => {
  const payload = helpers.generateCallEvent();
  const json = JSON.stringify(payload);
  const sign = mangoSign(FAKE_KEY, json, FAKE_SALT);
  const resp = await rawFetch('POST', '/api/telephony/webhook/events/call', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vpbx_api_key: FAKE_KEY, sign: sign, json: json })
  });
  // Server may reject if key not configured, but should not crash
  assert(resp.status < 500 || resp.status === 503, "call webhook should not 500, got " + resp.status);
});

test('POST /webhook/events/call with missing signature', async () => {
  const payload = helpers.generateCallEvent();
  const resp = await rawFetch('POST', '/api/telephony/webhook/events/call', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: JSON.stringify(payload) })
  });
  assert(resp.status === 400 || resp.status === 401 || resp.status === 403 || resp.status === 503,
    "missing signature should be 400/401/403, got " + resp.status);
});

test('POST /webhook/events/call with invalid signature', async () => {
  const payload = helpers.generateCallEvent();
  const json = JSON.stringify(payload);
  const resp = await rawFetch('POST', '/api/telephony/webhook/events/call', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vpbx_api_key: FAKE_KEY, sign: 'invalid_signature', json: json })
  });
  assert(resp.status === 400 || resp.status === 401 || resp.status === 403 || resp.status === 503,
    "invalid signature should be rejected, got " + resp.status);
});

test('POST /webhook/events/call with empty body', async () => {
  const resp = await rawFetch('POST', '/api/telephony/webhook/events/call', {
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert((resp.status >= 400 && resp.status < 500) || resp.status === 503, "empty body should fail, got " + resp.status);
});

test('POST /webhook/events/call with malformed JSON', async () => {
  const resp = await rawFetch('POST', '/api/telephony/webhook/events/call', {
    headers: { 'Content-Type': 'application/json' },
    body: '{not valid json}'
  });
  assert(resp.status >= 400 && resp.status < 500, "malformed JSON should fail, got " + resp.status);
});
// ==================== Webhook /events/summary ====================

test('POST /webhook/events/summary with valid payload', async () => {
  const payload = helpers.generateSummaryEvent();
  const json = JSON.stringify(payload);
  const sign = mangoSign(FAKE_KEY, json, FAKE_SALT);
  const resp = await rawFetch('POST', '/api/telephony/webhook/events/summary', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vpbx_api_key: FAKE_KEY, sign: sign, json: json })
  });
  assert(resp.status < 500 || resp.status === 503, "summary webhook should not 500, got " + resp.status);
});

test('POST /webhook/events/summary missed call payload', async () => {
  const payload = helpers.generateMissedCallSummary();
  const json = JSON.stringify(payload);
  const sign = mangoSign(FAKE_KEY, json, FAKE_SALT);
  const resp = await rawFetch('POST', '/api/telephony/webhook/events/summary', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vpbx_api_key: FAKE_KEY, sign: sign, json: json })
  });
  assert(resp.status < 500 || resp.status === 503, "missed summary webhook should not 500, got " + resp.status);
});

test('POST /webhook/events/summary with empty json field', async () => {
  const sign = mangoSign(FAKE_KEY, "{}", FAKE_SALT);
  const resp = await rawFetch('POST', '/api/telephony/webhook/events/summary', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vpbx_api_key: FAKE_KEY, sign: sign, json: "{}" })
  });
  assert(resp.status < 500 || resp.status === 503, "empty json summary should not 500, got " + resp.status);
});

// ==================== Webhook /events/recording ====================

test('POST /webhook/events/recording with valid payload', async () => {
  const payload = { recording_id: "rec_" + Date.now(), call_id: "call_" + Date.now(), recording_url: "https://example.com/rec.mp3" };
  const json = JSON.stringify(payload);
  const sign = mangoSign(FAKE_KEY, json, FAKE_SALT);
  const resp = await rawFetch('POST', '/api/telephony/webhook/events/recording', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vpbx_api_key: FAKE_KEY, sign: sign, json: json })
  });
  assert(resp.status < 500 || resp.status === 503, "recording webhook should not 500, got " + resp.status);
});

// ==================== Webhook /events/dtmf ====================

test('POST /webhook/events/dtmf with valid payload', async () => {
  const payload = { call_id: "call_" + Date.now(), dtmf: "1234" };
  const json = JSON.stringify(payload);
  const sign = mangoSign(FAKE_KEY, json, FAKE_SALT);
  const resp = await rawFetch('POST', '/api/telephony/webhook/events/dtmf', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vpbx_api_key: FAKE_KEY, sign: sign, json: json })
  });
  assert(resp.status < 500 || resp.status === 503, "dtmf webhook should not 500, got " + resp.status);
});

// ==================== Webhook /ping ====================

test('POST /webhook/ping responds successfully', async () => {
  const resp = await rawFetch('POST', '/api/telephony/webhook/ping', {
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert(resp.status === 200 || resp.status === 204, "ping should be 200/204, got " + resp.status);
});
// ==================== Payload Validation ====================

test('POST /webhook/events/call validates call_direction field', async () => {
  const payload = helpers.generateCallEvent();
  payload.call_direction = 999; // invalid type
  const json = JSON.stringify(payload);
  const sign = mangoSign(FAKE_KEY, json, FAKE_SALT);
  const resp = await rawFetch('POST', '/api/telephony/webhook/events/call', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vpbx_api_key: FAKE_KEY, sign: sign, json: json })
  });
  // Should either reject or handle gracefully - must NOT crash
  assert(resp.status < 500 || resp.status === 503, "invalid call_direction should not 500, got " + resp.status);
});

test('POST /webhook/events/call with extra unknown fields', async () => {
  const payload = helpers.generateCallEvent();
  payload.unknown_field_xyz = "extra";
  payload.another_extra = 12345;
  const json = JSON.stringify(payload);
  const sign = mangoSign(FAKE_KEY, json, FAKE_SALT);
  const resp = await rawFetch('POST', '/api/telephony/webhook/events/call', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vpbx_api_key: FAKE_KEY, sign: sign, json: json })
  });
  assert(resp.status < 500 || resp.status === 503, "extra fields should not crash, got " + resp.status);
});

test('POST /webhook/events/summary with missing entry_id', async () => {
  const payload = helpers.generateSummaryEvent();
  delete payload.entry_id;
  const json = JSON.stringify(payload);
  const sign = mangoSign(FAKE_KEY, json, FAKE_SALT);
  const resp = await rawFetch('POST', '/api/telephony/webhook/events/summary', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vpbx_api_key: FAKE_KEY, sign: sign, json: json })
  });
  assert(resp.status < 500 || resp.status === 503, "missing entry_id should not 500, got " + resp.status);
});

// ==================== HTTP Method Validation ====================

test('GET /webhook/events/call should not be allowed', async () => {
  const resp = await rawFetch('GET', '/api/telephony/webhook/events/call');
  assert(resp.status === 404 || resp.status === 405,
    "GET on webhook should be 404/405, got " + resp.status);
});

test('GET /webhook/events/summary should not be allowed', async () => {
  const resp = await rawFetch('GET', '/api/telephony/webhook/events/summary');
  assert(resp.status === 404 || resp.status === 405,
    "GET on summary should be 404/405, got " + resp.status);
});

// ==================== Content-Type Validation ====================

test('POST /webhook/events/call with text/plain content-type', async () => {
  const resp = await rawFetch('POST', '/api/telephony/webhook/events/call', {
    headers: { 'Content-Type': 'text/plain' },
    body: 'not json'
  });
  assert((resp.status >= 400 && resp.status < 500) || resp.status === 503,
    "text/plain should be rejected, got " + resp.status);
});

// ==================== Rate Limiting ====================

test('Webhook rate limiting (send multiple fast requests)', async () => {
  // Send 5 rapid requests - should all succeed (under 100/min limit)
  const results = [];
  for (let i = 0; i < 5; i++) {
    const payload = helpers.generateCallEvent();
    const json = JSON.stringify(payload);
    const sign = mangoSign(FAKE_KEY, json, FAKE_SALT);
    const resp = await rawFetch('POST', '/api/telephony/webhook/events/call', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vpbx_api_key: FAKE_KEY, sign: sign, json: json })
    });
    results.push(resp.status);
  }
  // All should be under 500
  for (const status of results) {
    assert(status < 500 || status === 503, "rapid request should not 500, got " + status);
  }
  // None should be rate limited at only 5 requests
  const rateLimited = results.filter(s => s === 429);
  assert(rateLimited.length === 0, "5 requests should not trigger rate limit");
});

module.exports = { name: 'Webhook Handler', tests };
