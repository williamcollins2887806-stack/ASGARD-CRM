process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
// Patch for /var/www/asgard-crm/tests/config.js
// Adds missing helper functions: api, assert*, skip, SkipError, initRealUsers, etc.

const path = require('path');
const https = require('https');
const _sharedAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true, maxSockets: 10 });
const http = require('http');

const BASE_URL = process.env.TEST_BASE_URL || 'https://92.242.61.184';
const API_URL = `${BASE_URL}/api`;

const TEST_PASSWORD = 'Test123!';
const TEST_PIN = '0000';
const JWT_SECRET = process.env.JWT_SECRET || 'asgard-jwt-secret-2026';

const ACCOUNTS = [
  { login: 'test_admin',         password: 'Test123!',    pin: '0000', role: 'ADMIN' },
  { login: 'test_director_gen',  password: TEST_PASSWORD, pin: TEST_PIN, role: 'DIRECTOR_GEN' },
  { login: 'test_director_comm', password: TEST_PASSWORD, pin: TEST_PIN, role: 'DIRECTOR_COMM' },
  { login: 'test_director_dev',  password: TEST_PASSWORD, pin: TEST_PIN, role: 'DIRECTOR_DEV' },
  { login: 'test_head_pm',       password: TEST_PASSWORD, pin: TEST_PIN, role: 'HEAD_PM' },
  { login: 'test_head_to',       password: TEST_PASSWORD, pin: TEST_PIN, role: 'HEAD_TO' },
  { login: 'test_pm',            password: TEST_PASSWORD, pin: TEST_PIN, role: 'PM' },
  { login: 'test_to',            password: TEST_PASSWORD, pin: TEST_PIN, role: 'TO' },
  { login: 'test_hr',            password: TEST_PASSWORD, pin: TEST_PIN, role: 'HR' },
  { login: 'test_buh',           password: TEST_PASSWORD, pin: TEST_PIN, role: 'BUH' },
  { login: 'test_office_manager',password: TEST_PASSWORD, pin: TEST_PIN, role: 'OFFICE_MANAGER' },
  { login: 'test_proc',          password: TEST_PASSWORD, pin: TEST_PIN, role: 'PROC' },
  { login: 'test_warehouse',     password: TEST_PASSWORD, pin: TEST_PIN, role: 'WAREHOUSE' },
  { login: 'test_chief_engineer',password: TEST_PASSWORD, pin: TEST_PIN, role: 'CHIEF_ENGINEER' },
  { login: 'test_hr_manager',   password: TEST_PASSWORD, pin: TEST_PIN, role: 'HR_MANAGER' },
];

const ROLES = [
  'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV',
  'HEAD_PM', 'HEAD_TO', 'PM', 'TO', 'HR', 'HR_MANAGER',
  'BUH', 'OFFICE_MANAGER', 'PROC', 'CHIEF_ENGINEER', 'WAREHOUSE'
];

const TEST_PREFIX = 'TEST_AUTO_';

const DIRS = {
  screenshots: path.join(__dirname, 'screenshots'),
  reports: path.join(__dirname, 'reports'),
};

const TIMEOUTS = {
  page: 60000,
  login: 45000,
  navigation: 15000,
  formFill: 30000,
  modal: 10000,
  apiCall: 15000,
};

const SSH = {
  host: '127.0.0.1',
  port: 22,
  username: 'ubuntu',
  agent: process.env.SSH_AUTH_SOCK,
  privateKeyPath: process.env.SSH_KEY_PATH || path.join(require('os').homedir(), '.ssh', 'id_ed25519'),
  dbName: 'asgard_crm',
  dbUser: 'postgres',
};

const BATCH_SIZE = 3;

function getAccount(role) {
  return ACCOUNTS.find(a => a.role === role);
}

// ── SkipError ────────────────────────────────────
class SkipError extends Error {
  constructor(msg) { super(msg); this.name = 'SkipError'; }
}
function skip(msg) { throw new SkipError(msg); }

// ── Token cache ──────────────────────────────────
const tokenCache = {};

async function rawFetch(method, urlPath, opts = {}) {
  const agent = _sharedAgent;
  const fullUrl = urlPath.startsWith('http') ? urlPath : `${BASE_URL}${urlPath}`;
  const fetchOpts = { method, agent, headers: {} };

  if (opts.headers) Object.assign(fetchOpts.headers, opts.headers);
  if (opts.body !== undefined) {
    if (typeof opts.body === 'object') {
      fetchOpts.body = JSON.stringify(opts.body);
      if (!fetchOpts.headers['Content-Type']) fetchOpts.headers['Content-Type'] = 'application/json';
    } else {
      fetchOpts.body = opts.body;
    }
  }
  if (opts.token) {
    fetchOpts.headers['Authorization'] = `Bearer ${opts.token}`;
  }
  if (opts.noContentType) {
    delete fetchOpts.headers['Content-Type'];
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  fetchOpts.signal = controller.signal;
  try {
    const resp = await fetch(fullUrl, fetchOpts);
    clearTimeout(timer);
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: resp.status, ok: resp.ok, data, text, headers: resp.headers };
  } catch (e) {
    clearTimeout(timer);
    // Retry once on network error
    if (opts._retried) throw e;
    await new Promise(r => setTimeout(r, 500));
    return rawFetch(method, urlPath, { ...opts, _retried: true });
  }
}

async function getToken(role) {
  if (tokenCache[role]) return tokenCache[role];
  const account = ACCOUNTS.find(a => a.role === role);
  if (!account) throw new Error(`Unknown role: ${role}`);

  const agent = _sharedAgent;

  // Step 1: Login
  const ac1 = new AbortController(); setTimeout(() => ac1.abort(), 15000);
  const loginResp = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: account.login, password: account.password }),
    agent, signal: ac1.signal,
  });
  const loginData = await loginResp.json();
  if (!loginData.token) throw new Error(`Login failed for ${role}: ${JSON.stringify(loginData)}`);

  // Step 2: Verify PIN if needed
  if (loginData.status === 'need_pin') {
    const ac2 = new AbortController(); setTimeout(() => ac2.abort(), 15000);
    const pinResp = await fetch(`${API_URL}/auth/verify-pin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${loginData.token}`,
      },
      body: JSON.stringify({ pin: account.pin }),
      agent, signal: ac2.signal,
    });
    const pinData = await pinResp.json();
    if (pinData.token) {
      tokenCache[role] = pinData.token;
      return pinData.token;
    }
  }

  tokenCache[role] = loginData.token;
  return loginData.token;
}

// Synchronous version for use in template literals (returns cached token or throws)
function getTokenSync(role) {
  if (tokenCache[role]) return tokenCache[role];
  throw new Error(`Token for ${role} not cached. Ensure initTokens() was called first.`);
}

// Pre-fetch tokens for all roles at startup
async function initTokens() {
  for (const account of ACCOUNTS) {
    try {
      await getToken(account.role);
    } catch (e) {
      console.log(`  [initTokens] Warning for ${account.role}:`, e.message?.slice(0, 100));
    }
  }
}

async function api(method, urlPath, opts = {}) {
  const { role = 'ADMIN', body } = opts;
  const token = await getToken(role);
  const agent = _sharedAgent;

  const fullUrl = urlPath.startsWith('http') ? urlPath : `${BASE_URL}${urlPath}`;
  const fetchOpts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    agent,
  };
  if (body && method !== 'GET') {
    fetchOpts.body = JSON.stringify(body);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  fetchOpts.signal = controller.signal;
  try {
    const resp = await fetch(fullUrl, fetchOpts);
    clearTimeout(timer);
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { status: resp.status, ok: resp.ok, data };
  } catch (e) {
    clearTimeout(timer);
    if (opts._retried) throw e;
    await new Promise(r => setTimeout(r, 500));
    return api(method, urlPath, { ...opts, _retried: true });
  }
}

// ── Assert helpers ───────────────────────────────
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function assertOk(resp, context = '') {
  assert(
    resp.status >= 200 && resp.status < 300,
    `${context}: expected 2xx, got ${resp.status} — ${JSON.stringify(resp.data || {}).slice(0, 200)}`
  );
}

function assertForbidden(resp, context = '') {
  assert(
    resp.status === 403 || resp.status === 401,
    `${context}: expected 401/403, got ${resp.status}`
  );
}

function assertArray(val, context = '') {
  assert(Array.isArray(val), `${context}: expected array, got ${typeof val}`);
}

function assertHasFields(obj, fields, context = '') {
  if (!obj) throw new Error(`${context}: object is null/undefined`);
  for (const f of fields) {
    assert(f in obj, `${context}: missing field '${f}'`);
  }
}

function assertNotHasFields(obj, fields, context = '') {
  if (!obj) return; // null/undefined doesn't have any fields
  for (const f of fields) {
    assert(!(f in obj), `${context}: field '${f}' should NOT be present but was found`);
  }
}

function assertFieldType(obj, field, type, context = '') {
  if (!obj) throw new Error(`${context}: object is null/undefined`);
  const val = obj[field];
  if (type === 'number') {
    assert(typeof val === 'number' || (typeof val === 'string' && !isNaN(Number(val))),
      `${context}: field '${field}' should be ${type}, got ${typeof val} (${val})`);
  } else {
    assert(typeof val === type, `${context}: field '${field}' should be ${type}, got ${typeof val}`);
  }
}

function assertMatch(val, pattern, context = '') {
  if (pattern instanceof RegExp) {
    const str = typeof val === 'object' ? JSON.stringify(val) : String(val || '');
    assert(pattern.test(str), `${context}: '${str}' does not match ${pattern}`);
  } else if (typeof pattern === 'object' && pattern !== null) {
    // Object pattern: check that val contains matching fields
    if (!val || typeof val !== 'object') throw new Error(`${context}: expected object, got ${typeof val}`);
    for (const [k, v] of Object.entries(pattern)) {
      if (v instanceof RegExp) {
        assert(v.test(String(val[k] || '')), `${context}: field '${k}' = '${val[k]}' does not match ${v}`);
      } else if (typeof v === 'number') {
        assert(Number(val[k]) === v, `${context}: field '${k}' = '${val[k]}', expected ${v}`);
      } else {
        assert(String(val[k]) === String(v), `${context}: field '${k}' = '${val[k]}', expected '${v}'`);
      }
    }
  } else {
    assert(String(val) === String(pattern), `${context}: '${val}' !== '${pattern}'`);
  }
}

function assertStatus(resp, expected, context = '') {
  assert(
    resp.status === expected,
    `${context}: expected ${expected}, got ${resp.status} — ${JSON.stringify(resp.data || {}).slice(0, 200)}`
  );
}

function assertOneOf(val, allowed, context = '') {
  assert(
    allowed.includes(val),
    `${context}: '${val}' is not one of [${allowed.join(', ')}]`
  );
}

// ── TEST_USERS (real IDs from DB) ────────────────
const TEST_USERS = {};

async function initRealUsers() {
  try {
    const resp = await api('GET', '/api/data/users?limit=500', { role: 'ADMIN' });
    const allUsers = resp.data?.users || resp.data?.data || (Array.isArray(resp.data) ? resp.data : []);
    for (const account of ACCOUNTS) {
      const found = allUsers.find(u => u.login === account.login);
      if (found) {
        TEST_USERS[account.role] = found;
      }
    }
    // Fallback: admin by id=1 if login 'admin' not matched via ACCOUNTS
    if (!TEST_USERS['ADMIN']) {
      const adm = allUsers.find(u => u.login === 'admin' || u.role === 'ADMIN');
      if (adm) TEST_USERS['ADMIN'] = adm;
    }
  } catch (e) {
    console.log('  [initRealUsers] Warning:', e.message?.slice(0, 100));
  }
}

module.exports = {
  BASE_URL,
  API_URL,
  TEST_PASSWORD,
  TEST_PIN,
  JWT_SECRET,
  ACCOUNTS,
  ROLES,
  TEST_PREFIX,
  TEST_USERS,
  DIRS,
  TIMEOUTS,
  SSH,
  BATCH_SIZE,
  getAccount,
  api,
  rawFetch,
  getToken,
  getTokenSync,
  initTokens,
  assert,
  assertOk,
  assertForbidden,
  assertArray,
  assertHasFields,
  assertNotHasFields,
  assertFieldType,
  assertMatch,
  assertStatus,
  assertOneOf,
  skip,
  SkipError,
  initRealUsers,
};
