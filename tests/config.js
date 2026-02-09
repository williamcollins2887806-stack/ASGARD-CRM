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

// Тестовые юзеры (создаются seed.sql)
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

// Генерация JWT напрямую (без реального логина)
function getToken(role) {
  const user = TEST_USERS[role];
  if (!user) throw new Error(`Unknown role: ${role}`);
  return jwt.sign({
    id: user.id,
    login: user.login,
    name: user.name,
    role: user.role,
    email: `${user.login}@test.asgard.local`,
    pinVerified: true
  }, JWT_SECRET, { expiresIn: '1h' });
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
  getToken, api, assert, assertStatus, assertOk, assertForbidden
};
