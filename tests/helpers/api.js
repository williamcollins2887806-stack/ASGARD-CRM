/**
 * ASGARD CRM - HTTP helper + assertions for Stage 12 test suite
 */
'use strict';

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';

/**
 * Universal HTTP request helper
 * @param {string} method - HTTP method
 * @param {string} path - API path
 * @param {object} opts - { token, body, query, role, timeout }
 * @returns {{ status, data, ok, headers }}
 */
async function request(method, path, opts = {}) {
  const { token, body, query, timeout = 15000 } = opts;

  let url = `${BASE_URL}${path}`;
  if (query) {
    const qs = new URLSearchParams(query).toString();
    if (qs) url += `?${qs}`;
  }

  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const fetchOpts = { method, headers };
  if (body && method !== 'GET') fetchOpts.body = JSON.stringify(body);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  fetchOpts.signal = controller.signal;

  try {
    const resp = await fetch(url, fetchOpts);
    clearTimeout(timer);
    const ct = resp.headers.get('content-type') || '';
    const data = ct.includes('json')
      ? await resp.json().catch(() => null)
      : await resp.text().catch(() => null);
    return { status: resp.status, data, ok: resp.ok, headers: resp.headers };
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error(`TIMEOUT ${method} ${path} (${timeout}ms)`);
    }
    throw err;
  }
}

// ---- Assertions ----

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

function assertOk(resp, context = '') {
  assert(resp.status < 400, `${context}: expected 2xx/3xx, got ${resp.status} - ${JSON.stringify(resp.data)?.slice(0, 300)}`);
}

function assertStatus(resp, expected, context = '') {
  assert(resp.status === expected, `${context}: expected ${expected}, got ${resp.status} - ${JSON.stringify(resp.data)?.slice(0, 300)}`);
}

function assertForbidden(resp, context = '') {
  assert(resp.status === 403 || resp.status === 401, `${context}: expected 401/403, got ${resp.status}`);
}

function assertArray(data, context = '') {
  assert(Array.isArray(data), `${context}: expected array, got ${typeof data}`);
}

function assertHasFields(obj, fields, context = '') {
  for (const f of fields) {
    assert(obj && obj[f] !== undefined, `${context}: missing field "${f}"`);
  }
}

module.exports = {
  BASE_URL,
  request,
  assert,
  assertOk,
  assertStatus,
  assertForbidden,
  assertArray,
  assertHasFields
};
