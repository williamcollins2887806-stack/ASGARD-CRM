/**
 * ASGARD CRM — Test Configuration
 * JWT helper, test users, HTTP utilities
 */
const jwt = require('jsonwebtoken');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'asgard-jwt-secret-2026';

// 15 ролей системы
const ROLES = [
  'ADMIN', 'PM', 'TO', 'HEAD_PM', 'HEAD_TO',
  'HR', 'HR_MANAGER', 'BUH', 'PROC', 'OFFICE_MANAGER',
  'CHIEF_ENGINEER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV',
  'WAREHOUSE'
];

// Тестовые юзеры — начальные синтетические ID (будут заменены реальными через initRealUsers)
const TEST_USERS = {};
for (const role of ROLES) {
  const id = 9000 + ROLES.indexOf(role);
  TEST_USERS[role] = {
    id,
    login: `test_${role.toLowerCase()}`,
    password: 'Test123!',
    pin: '0000',
    name: `Test ${role}`,
    role
  };
}

// Token cache (invalidated when user IDs change)
const _tokenCache = {};

// Генерация JWT напрямую (без реального логина)
function getToken(role) {
  const user = TEST_USERS[role];
  if (!user) throw new Error(`Unknown role: ${role}`);
  // Cache tokens per role+id to avoid re-signing
  const cacheKey = `${role}_${user.id}`;
  if (_tokenCache[cacheKey]) return _tokenCache[cacheKey];
  const token = jwt.sign({
    id: user.id,
    login: user.login,
    name: user.name,
    role: user.role,
    email: `${user.login}@test.asgard.local`,
    pinVerified: true
  }, JWT_SECRET, { expiresIn: '1h' });
  _tokenCache[cacheKey] = token;
  return token;
}

/**
 * Initialize real user IDs from the database.
 * Fetches GET /api/users and maps real user IDs to test roles.
 * This fixes FK constraint violations when creating records (tasks, payroll, etc.)
 */
async function initRealUsers() {
  try {
    const url = `${BASE_URL}/api/users`;
    const resp = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${getToken('ADMIN')}`,
        'Content-Type': 'application/json'
      }
    });
    if (!resp.ok) return; // fallback to synthetic IDs
    const data = await resp.json();
    const users = Array.isArray(data) ? data : (data.users || data.data || []);
    if (!users.length) return;

    // Map real users to roles
    const roleMap = {};
    for (const u of users) {
      if (u.role && !roleMap[u.role]) {
        roleMap[u.role] = u;
      }
    }

    // Update TEST_USERS with real IDs where available
    let mapped = 0;
    for (const role of ROLES) {
      const realUser = roleMap[role];
      if (realUser) {
        TEST_USERS[role].id = realUser.id;
        TEST_USERS[role].login = realUser.login || TEST_USERS[role].login;
        TEST_USERS[role].name = realUser.name || realUser.fio || TEST_USERS[role].name;
        mapped++;
      }
    }

    // If no role-matched users, use first user as ADMIN fallback
    if (!roleMap['ADMIN'] && users[0]) {
      TEST_USERS['ADMIN'].id = users[0].id;
      mapped++;
    }

    // Clear token cache since IDs changed
    Object.keys(_tokenCache).forEach(k => delete _tokenCache[k]);

    if (mapped > 0) {
      console.log(`  [init] Mapped ${mapped} real user IDs for FK-safe tests`);
    }
  } catch (e) {
    // Silent fallback — tests will use synthetic IDs
  }
}

// HTTP helper (with 429 retry logic)
async function api(method, path, { role = 'ADMIN', body = null, expectStatus = null } = {}) {
  const maxRetries = 5;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const url = `${BASE_URL}${path}`;
    const headers = {
      'Authorization': `Bearer ${getToken(role)}`,
      'Content-Type': 'application/json'
    };
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);

    const resp = await fetch(url, opts);

    if (resp.status === 429 && attempt < maxRetries) {
      const waitMs = attempt <= 2 ? 3000 * attempt : 10000 * (attempt - 1);
      console.log(`  [retry] 429 on ${method} ${path}, attempt ${attempt}/${maxRetries}, waiting ${waitMs}ms...`);
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }

    const ct = resp.headers.get('content-type') || '';
    const data = ct.includes('json')
      ? await resp.json().catch(() => null)
      : await resp.text().catch(() => null);

    if (expectStatus && resp.status !== expectStatus) {
      throw new Error(`${method} ${path} [${role}]: expected ${expectStatus}, got ${resp.status}`);
    }

    return { status: resp.status, data, ok: resp.ok };
  }
}

// Утилиты
function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
}

function assertStatus(resp, expected, context = '') {
  assert(
    resp.status === expected,
    `${context}: expected ${expected}, got ${resp.status} — ${JSON.stringify(resp.data)?.slice(0, 200)}`
  );
}

function assertOk(resp, context = '') {
  assert(resp.status < 400, `${context}: expected 2xx/3xx, got ${resp.status} — ${JSON.stringify(resp.data)?.slice(0, 200)}`);
}

function assertForbidden(resp, context = '') {
  assert(
    resp.status === 403 || resp.status === 401,
    `${context}: expected 401/403, got ${resp.status}`
  );
}

// ── Deep validation helpers ──

function assertArray(data, context = '') {
  assert(Array.isArray(data), `${context}: expected array, got ${typeof data}`);
}

function assertHasFields(obj, fields, context = '') {
  assert(obj && typeof obj === 'object', `${context}: expected object, got ${typeof obj}`);
  for (const f of fields) {
    assert(f in obj, `${context}: missing field "${f}" (keys: ${Object.keys(obj).join(', ')})`);
  }
}

function assertFieldType(obj, field, type, context = '') {
  assert(obj && typeof obj === 'object', `${context}: expected object`);
  if (!(field in obj) || obj[field] === null) return; // null is allowed (nullable column)
  const actual = typeof obj[field];
  assert(actual === type, `${context}: field "${field}" expected ${type}, got ${actual} (${JSON.stringify(obj[field])?.slice(0, 50)})`);
}

function assertIdReturned(data, context = '') {
  assert(data && (data.id || data.id === 0), `${context}: expected id in response, got ${JSON.stringify(data)?.slice(0, 150)}`);
}

function assertCount(arr, min, max = Infinity, context = '') {
  assertArray(arr, context);
  assert(arr.length >= min, `${context}: expected >= ${min} items, got ${arr.length}`);
  if (max < Infinity) assert(arr.length <= max, `${context}: expected <= ${max} items, got ${arr.length}`);
}

function assertMatch(obj, expected, context = '') {
  for (const [k, v] of Object.entries(expected)) {
    const actual = obj[k];
    // Handle numeric comparisons (PostgreSQL returns decimals as strings like "20.00")
    const numMatch = typeof v === 'number' && !isNaN(parseFloat(actual)) && parseFloat(actual) === v;
    assert(
      actual === v || String(actual) === String(v) || numMatch,
      `${context}: field "${k}" expected ${JSON.stringify(v)}, got ${JSON.stringify(actual)}`
    );
  }
}

function assertNotHasFields(obj, fields, context = '') {
  assert(obj && typeof obj === 'object', `${context}: expected object`);
  for (const f of fields) {
    assert(!(f in obj), `${context}: LEAKED field "${f}" should not be present`);
  }
}

function assertOneOf(value, allowed, context = '') {
  assert(allowed.includes(value), `${context}: "${value}" not in [${allowed.join(', ')}]`);
}

class SkipError extends Error {
  constructor(msg) { super(msg); this.name = 'SkipError'; }
}
function skip(msg) { throw new SkipError(msg); }

// Raw fetch without JWT (for auth bypass tests)
async function rawFetch(method, urlPath, { body = null, headers = {} } = {}) {
  const url = `${BASE_URL}${urlPath}`;
  const opts = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(url, opts);
  const ct = resp.headers.get('content-type') || '';
  const data = ct.includes('json')
    ? await resp.json().catch(() => null)
    : await resp.text().catch(() => null);
  return { status: resp.status, data, ok: resp.ok, headers: resp.headers };
}

module.exports = {
  BASE_URL, JWT_SECRET, ROLES, TEST_USERS,
  getToken, api, assert, assertStatus, assertOk, assertForbidden,
  assertArray, assertHasFields, assertFieldType, assertIdReturned, assertCount, assertMatch,
  assertNotHasFields, assertOneOf,
  rawFetch, skip, SkipError,
  initRealUsers
};
