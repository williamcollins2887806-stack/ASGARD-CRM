/**
 * ASGARD CRM - Auth helper for Stage 12 test suite
 *
 * Strategy:
 *   1. Try real login -> verify-pin flow
 *   2. Fallback to JWT synthesis if login fails (e.g. seed not run)
 */
'use strict';

const { request } = require('./api');

const JWT_SECRET = process.env.JWT_SECRET || 'asgard-jwt-secret-2026';

const ROLES = [
  'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV',
  'HEAD_PM', 'HEAD_TO', 'PM', 'TO', 'HR', 'HR_MANAGER',
  'BUH', 'OFFICE_MANAGER', 'PROC', 'CHIEF_ENGINEER', 'WAREHOUSE'
];

const TEST_PASSWORD = 'Test123!';
const TEST_PIN = '0000';

// Token cache
const _tokens = {};
// Real user ID mapping
const _userIds = {};

/**
 * Get token for a role. Uses cached tokens.
 */
async function getToken(role) {
  if (typeof role === 'object') {
    // Legacy compat: getToken(app, role)
    const actualRole = arguments[1] || 'ADMIN';
    return getToken(actualRole);
  }
  if (_tokens[role]) return _tokens[role];
  const token = await _authenticate(role);
  _tokens[role] = token;
  return token;
}

/**
 * Get real user ID for a role (populated after initAuth)
 */
function getUserId(role) {
  return _userIds[role] || null;
}

/**
 * Initialize auth: try real login for all roles
 */
async function initAuth() {
  console.log('  [auth] Initializing tokens...');
  let realCount = 0;
  let synthCount = 0;

  for (const role of ROLES) {
    try {
      const token = await _realLogin(role);
      if (token) {
        _tokens[role] = token;
        realCount++;
        continue;
      }
    } catch (_) { /* fallback below */ }

    // Fallback: JWT synthesis
    try {
      const token = await _synthToken(role);
      _tokens[role] = token;
      synthCount++;
    } catch (e) {
      console.log(`    ! ${role}: no token - ${e.message.slice(0, 80)}`);
    }
  }

  console.log(`  [auth] Tokens: ${realCount} real, ${synthCount} synth`);
  return { realCount, synthCount };
}

/**
 * Real login flow: login -> verify-pin
 */
async function _realLogin(role) {
  const login = `test_${role.toLowerCase()}`;

  const loginResp = await request('POST', '/api/auth/login', {
    body: { login, password: TEST_PASSWORD }
  });

  if (!loginResp.ok || !loginResp.data?.token) return null;

  const status = loginResp.data.status;
  let token = loginResp.data.token;
  const userId = loginResp.data.user?.id;
  if (userId) _userIds[role] = userId;

  if (status === 'need_pin') {
    const pinResp = await request('POST', '/api/auth/verify-pin', {
      token,
      body: { pin: TEST_PIN }
    });
    if (pinResp.ok && pinResp.data?.token) {
      token = pinResp.data.token;
    } else {
      return null;
    }
  } else if (status === 'need_setup') {
    const setupResp = await request('POST', '/api/auth/setup-credentials', {
      token,
      body: { newPassword: TEST_PASSWORD, pin: TEST_PIN }
    });
    if (setupResp.ok && setupResp.data?.token) {
      token = setupResp.data.token;
    } else {
      return null;
    }
  }

  return token;
}

/**
 * JWT synthesis fallback
 */
async function _synthToken(role) {
  let jwt;
  try {
    jwt = require('jsonwebtoken');
  } catch (_) {
    throw new Error('jsonwebtoken not installed');
  }

  if (!_userIds[role]) await _mapRealUserIds();

  const id = _userIds[role] || (9000 + ROLES.indexOf(role));
  const login = `test_${role.toLowerCase()}`;

  return jwt.sign({
    id, login,
    name: `Test ${role}`,
    role,
    email: `${login}@test.asgard.local`,
    pinVerified: true
  }, JWT_SECRET, { expiresIn: '1h' });
}

let _mapAttempted = false;
async function _mapRealUserIds() {
  if (_mapAttempted) return;
  _mapAttempted = true;

  try {
    let jwt;
    try { jwt = require('jsonwebtoken'); } catch (_) { return; }

    const tempToken = jwt.sign({
      id: 9000, login: 'test_admin', name: 'Test ADMIN',
      role: 'ADMIN', email: 'test_admin@test.asgard.local', pinVerified: true
    }, JWT_SECRET, { expiresIn: '5m' });

    const resp = await request('GET', '/api/users', { token: tempToken });
    if (!resp.ok) return;

    const users = Array.isArray(resp.data) ? resp.data : (resp.data?.users || []);
    for (const u of users) {
      if (u.role && !_userIds[u.role]) {
        _userIds[u.role] = u.id;
      }
    }
  } catch (_) { /* silent */ }
}

async function _authenticate(role) {
  try {
    const token = await _realLogin(role);
    if (token) return token;
  } catch (_) { /* fallback */ }
  return _synthToken(role);
}

function clearTokens() {
  for (const k of Object.keys(_tokens)) delete _tokens[k];
}

function authHeaders(token) {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
}

module.exports = {
  ROLES, TEST_PASSWORD, TEST_PIN,
  getToken, getUserId, initAuth, clearTokens, authHeaders
};
