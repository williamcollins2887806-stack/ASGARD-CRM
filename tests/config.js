/**
 * ASGARD CRM — Test Configuration
 * JWT helper, test users, HTTP utilities
 */
const jwt = require('jsonwebtoken');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-testing';

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

// HTTP helper
async function api(method, path, { role = 'ADMIN', body = null, expectStatus = null } = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = {
    'Authorization': `Bearer ${getToken(role)}`,
    'Content-Type': 'application/json'
  };
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const resp = await fetch(url, opts);
  const ct = resp.headers.get('content-type') || '';
  const data = ct.includes('json')
    ? await resp.json().catch(() => null)
    : await resp.text().catch(() => null);

  if (expectStatus && resp.status !== expectStatus) {
    throw new Error(`${method} ${path} [${role}]: expected ${expectStatus}, got ${resp.status}`);
  }

  return { status: resp.status, data, ok: resp.ok };
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

module.exports = {
  BASE_URL, JWT_SECRET, ROLES, TEST_USERS,
  getToken, api, assert, assertStatus, assertOk, assertForbidden,
  initRealUsers
};
