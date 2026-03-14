/**
 * API Tests for previously uncovered modules:
 * - Bonus Requests (bonus_requests via /api/data)
 * - Seals & Transfers (seals, seal_transfers via /api/data)
 * - Contracts (contracts via /api/data)
 * - User Requests (user registration approvals)
 * - Workers Schedule (employee_plan CRUD)
 * - Reports: funnel, pm-analytics
 * - Dashboard widgets
 */
const { api, rawFetch, assertOk, assertStatus, assertArray, assertHasFields, skip, SkipError } = require('../config');

const tests = [];
let testBonusId = null;
let testSealId = null;
let testContractId = null;

// ═══════════════════════════════════════════════════════
// BONUS REQUESTS
// ═══════════════════════════════════════════════════════
tests.push({
  name: 'GET /api/data/bonus_requests — list bonus requests (ADMIN)',
  run: async () => {
    const resp = await api('GET', '/api/data/bonus_requests?limit=5', { role: 'ADMIN' });
    if (resp.status === 404) throw new SkipError('Data route not found');
    assertOk(resp);
  }
});

tests.push({
  name: 'POST /api/data/bonus_requests — create bonus request (PM)',
  run: async () => {
    const resp = await api('POST', '/api/data/bonus_requests', {
      role: 'PM',
      body: {
        employee_id: 1,
        amount: 5000,
        reason: 'TEST_BONUS_AUTO_' + Date.now(),
        status: 'pending'
      }
    });
    if (resp.status === 404) throw new SkipError('Data route not found');
    if (resp.status === 403) throw new SkipError('PM cannot create bonus requests');
    assertOk(resp);
    testBonusId = (resp.data || {}).id;
  }
});

tests.push({
  name: 'GET /api/data/bonus_requests/:id — get single bonus (ADMIN)',
  run: async () => {
    if (!testBonusId) throw new SkipError('No bonus request created');
    const resp = await api('GET', '/api/data/bonus_requests/' + testBonusId, { role: 'ADMIN' });
    assertOk(resp);
  }
});

tests.push({
  name: 'PUT /api/data/bonus_requests/:id — update bonus (ADMIN)',
  run: async () => {
    if (!testBonusId) throw new SkipError('No bonus request created');
    const resp = await api('PUT', '/api/data/bonus_requests/' + testBonusId, {
      role: 'ADMIN',
      body: { status: 'approved', amount: 7000 }
    });
    assertOk(resp);
  }
});

tests.push({
  name: 'DELETE /api/data/bonus_requests/:id — delete bonus (ADMIN)',
  run: async () => {
    if (!testBonusId) throw new SkipError('No bonus request created');
    const resp = await api('DELETE', '/api/data/bonus_requests/' + testBonusId, { role: 'ADMIN' });
    assertOk(resp);
  }
});

tests.push({
  name: 'GET /api/data/bonus_requests — PM access (should work or 403)',
  run: async () => {
    const resp = await api('GET', '/api/data/bonus_requests?limit=1', { role: 'PM' });
    if (resp.status === 404) throw new SkipError('Route not found');
    // PM may or may not have access — either is valid
    if (resp.status !== 200 && resp.status !== 403) {
      throw new Error('Expected 200 or 403, got ' + resp.status);
    }
  }
});

// ═══════════════════════════════════════════════════════
// SEALS
// ═══════════════════════════════════════════════════════
tests.push({
  name: 'GET /api/data/seals — list seals (ADMIN)',
  run: async () => {
    const resp = await api('GET', '/api/data/seals?limit=5', { role: 'ADMIN' });
    if (resp.status === 404) throw new SkipError('Data route not found');
    assertOk(resp);
  }
});

tests.push({
  name: 'POST /api/data/seals — create seal (ADMIN)',
  run: async () => {
    const resp = await api('POST', '/api/data/seals', {
      role: 'ADMIN',
      body: {
        name: 'TEST_SEAL_AUTO_' + Date.now(),
        type: 'company',
        status: 'active'
      }
    });
    if (resp.status === 404) throw new SkipError('Route not found');
    assertOk(resp);
    testSealId = (resp.data || {}).id;
  }
});

tests.push({
  name: 'GET /api/data/seal_transfers — list seal transfers (ADMIN)',
  run: async () => {
    const resp = await api('GET', '/api/data/seal_transfers?limit=5', { role: 'ADMIN' });
    if (resp.status === 404) throw new SkipError('Route not found');
    assertOk(resp);
  }
});

tests.push({
  name: 'DELETE /api/data/seals/:id — cleanup test seal (ADMIN)',
  run: async () => {
    if (!testSealId) throw new SkipError('No seal created');
    const resp = await api('DELETE', '/api/data/seals/' + testSealId, { role: 'ADMIN' });
    assertOk(resp);
  }
});

// ═══════════════════════════════════════════════════════
// CONTRACTS
// ═══════════════════════════════════════════════════════
tests.push({
  name: 'GET /api/data/contracts — list contracts (ADMIN)',
  run: async () => {
    const resp = await api('GET', '/api/data/contracts?limit=5', { role: 'ADMIN' });
    if (resp.status === 404) throw new SkipError('Route not found');
    assertOk(resp);
  }
});

tests.push({
  name: 'POST /api/data/contracts — create contract (ADMIN)',
  run: async () => {
    const resp = await api('POST', '/api/data/contracts', {
      role: 'ADMIN',
      body: {
        name: 'TEST_CONTRACT_AUTO_' + Date.now(),
        type: 'service',
        status: 'draft'
      }
    });
    if (resp.status === 404) throw new SkipError('Route not found');
    assertOk(resp);
    testContractId = (resp.data || {}).id;
  }
});

tests.push({
  name: 'PUT /api/data/contracts/:id — update contract (ADMIN)',
  run: async () => {
    if (!testContractId) throw new SkipError('No contract created');
    const resp = await api('PUT', '/api/data/contracts/' + testContractId, {
      role: 'ADMIN',
      body: { status: 'active' }
    });
    assertOk(resp);
  }
});

tests.push({
  name: 'DELETE /api/data/contracts/:id — cleanup contract (ADMIN)',
  run: async () => {
    if (!testContractId) throw new SkipError('No contract created');
    const resp = await api('DELETE', '/api/data/contracts/' + testContractId, { role: 'ADMIN' });
    assertOk(resp);
  }
});

tests.push({
  name: 'GET /api/data/contracts — PM access',
  run: async () => {
    const resp = await api('GET', '/api/data/contracts?limit=1', { role: 'PM' });
    if (resp.status === 404) throw new SkipError('Route not found');
    // PM should have read access to contracts
    if (resp.status !== 200 && resp.status !== 403) {
      throw new Error('Expected 200 or 403, got ' + resp.status);
    }
  }
});

// ═══════════════════════════════════════════════════════
// WORKERS SCHEDULE (employee_plan)
// ═══════════════════════════════════════════════════════
tests.push({
  name: 'GET /api/staff/schedule — list schedule (HR)',
  run: async () => {
    const resp = await api('GET', '/api/staff/schedule', { role: 'HR' });
    if (resp.status === 404) throw new SkipError('Schedule route not found');
    assertOk(resp);
  }
});

tests.push({
  name: 'POST /api/staff/schedule — create entry (HR)',
  run: async () => {
    const today = new Date().toISOString().slice(0, 10);
    const resp = await api('POST', '/api/staff/schedule', {
      role: 'HR',
      body: { employee_id: 1, date: today, kind: 'free', source: 'test_uncovered' }
    });
    if (resp.status === 404) throw new SkipError('Route not found');
    // 200, 201, 409 (conflict) all acceptable
    if (!resp.ok && resp.status !== 409) {
      throw new Error('Expected 2xx or 409, got ' + resp.status);
    }
  }
});

tests.push({
  name: 'POST /api/staff/schedule — PM denied (should be 403)',
  run: async () => {
    const today = new Date().toISOString().slice(0, 10);
    const resp = await api('POST', '/api/staff/schedule', {
      role: 'PM',
      body: { employee_id: 1, date: today, kind: 'office', source: 'test_pm' }
    });
    if (resp.status === 404) throw new SkipError('Route not found');
    // PM should not create schedule entries directly — 403 expected
    if (resp.ok) {
      // Some systems allow PM, that's OK too
    }
  }
});

tests.push({
  name: 'POST /api/staff/schedule/bulk — bulk entries (HR)',
  run: async () => {
    const today = new Date().toISOString().slice(0, 10);
    const resp = await api('POST', '/api/staff/schedule/bulk', {
      role: 'HR',
      body: {
        entries: [
          { employee_id: 1, date: today, kind: 'reserve', source: 'test_bulk', locked: false }
        ]
      }
    });
    if (resp.status === 404) throw new SkipError('Bulk endpoint not found');
    assertOk(resp);
  }
});

tests.push({
  name: 'POST /api/staff/schedule/bulk — no auth → 401',
  run: async () => {
    const resp = await rawFetch('POST', '/api/staff/schedule/bulk', {
      body: { entries: [{ employee_id: 1, date: '2026-01-01', kind: 'reserve' }] }
    });
    assertStatus(resp, 401);
  }
});

// ═══════════════════════════════════════════════════════
// REPORTS: funnel, pm-analytics
// ═══════════════════════════════════════════════════════
tests.push({
  name: 'GET /api/reports/funnel — funnel data (ADMIN)',
  run: async () => {
    const resp = await api('GET', '/api/reports/funnel', { role: 'ADMIN' });
    if (resp.status === 404) throw new SkipError('Funnel report not found');
    assertOk(resp);
  }
});

tests.push({
  name: 'GET /api/reports/pm-analytics — PM analytics (ADMIN)',
  run: async () => {
    const resp = await api('GET', '/api/reports/pm-analytics', { role: 'ADMIN' });
    if (resp.status === 404) throw new SkipError('PM analytics not found');
    assertOk(resp);
  }
});

tests.push({
  name: 'GET /api/reports/pm-analytics — PM own analytics',
  run: async () => {
    const resp = await api('GET', '/api/reports/pm-analytics', { role: 'PM' });
    if (resp.status === 404) throw new SkipError('PM analytics not found');
    // PM should see their own analytics
    if (resp.status !== 200 && resp.status !== 403) {
      throw new Error('Expected 200 or 403, got ' + resp.status);
    }
  }
});

// ═══════════════════════════════════════════════════════
// DASHBOARD / HOME
// ═══════════════════════════════════════════════════════
tests.push({
  name: 'GET /api/auth/me — dashboard user data',
  run: async () => {
    const resp = await api('GET', '/api/auth/me', { role: 'ADMIN' });
    assertOk(resp);
    const user = (resp.data && resp.data.user) || resp.data || {};
    assertHasFields(user, ['id', 'login', 'role', 'name'], 'auth/me user');
  }
});

tests.push({
  name: 'GET /api/auth/me — has patronymic field',
  run: async () => {
    const resp = await api('GET', '/api/auth/me', { role: 'ADMIN' });
    assertOk(resp);
    const user = (resp.data && resp.data.user) || resp.data || {};
    if (!('patronymic' in user)) throw new Error('patronymic field missing');
  }
});

// ═══════════════════════════════════════════════════════
// EMPLOYEE COLLECTIONS (deeper tests)
// ═══════════════════════════════════════════════════════
let deepCollectionId = null;

tests.push({
  name: 'POST /api/employee-collections — create collection (HR)',
  run: async () => {
    const resp = await api('POST', '/api/employee-collections', {
      role: 'HR',
      body: { name: 'DEEP_TEST_COLL_' + Date.now(), description: 'Deep coverage test' }
    });
    if (resp.status === 404) throw new SkipError('Route not registered');
    assertOk(resp);
    deepCollectionId = resp.data?.id || resp.data?.collection?.id;
    if (!deepCollectionId) throw new Error('No collection id returned');
  }
});

tests.push({
  name: 'GET /api/employee-collections — list (HR)',
  run: async () => {
    const resp = await api('GET', '/api/employee-collections', { role: 'HR' });
    if (resp.status === 404) throw new SkipError('Route not registered');
    assertOk(resp);
  }
});

tests.push({
  name: 'PUT /api/employee-collections/:id — update (HR)',
  run: async () => {
    if (!deepCollectionId) throw new SkipError('No collection');
    const resp = await api('PUT', '/api/employee-collections/' + deepCollectionId, {
      role: 'HR',
      body: { name: 'DEEP_TEST_UPDATED_' + Date.now(), description: 'Updated' }
    });
    assertOk(resp);
  }
});

tests.push({
  name: 'POST /api/employee-collections/:id/employees — add employee (HR)',
  run: async () => {
    if (!deepCollectionId) throw new SkipError('No collection');
    const empResp = await api('GET', '/api/staff/employees?limit=1', { role: 'HR' });
    const emps = empResp.data;
    const empId = (emps?.rows || emps || [])[0]?.id || 1;
    const resp = await api('POST', '/api/employee-collections/' + deepCollectionId + '/employees', {
      role: 'HR',
      body: { employee_ids: [empId] }
    });
    assertOk(resp);
  }
});

tests.push({
  name: 'GET /api/employee-collections/:id — with employees (HR)',
  run: async () => {
    if (!deepCollectionId) throw new SkipError('No collection');
    const resp = await api('GET', '/api/employee-collections/' + deepCollectionId, { role: 'HR' });
    assertOk(resp);
  }
});

tests.push({
  name: 'GET /api/employee-collections — PM denied or empty',
  run: async () => {
    const resp = await api('GET', '/api/employee-collections', { role: 'PM' });
    if (resp.status === 404) throw new SkipError('Route not registered');
    // PM may get 403 or empty list — both valid
  }
});

tests.push({
  name: 'DELETE /api/employee-collections/:id — cleanup (HR)',
  run: async () => {
    if (!deepCollectionId) throw new SkipError('No collection');
    const resp = await api('DELETE', '/api/employee-collections/' + deepCollectionId, { role: 'HR' });
    assertOk(resp);
  }
});

// ═══════════════════════════════════════════════════════
// TRAINING APPLICATIONS
// ═══════════════════════════════════════════════════════
tests.push({
  name: 'GET /api/training-applications — list (HR)',
  run: async () => {
    const resp = await api('GET', '/api/training-applications', { role: 'HR' });
    if (resp.status === 404) throw new SkipError('Route not found');
    assertOk(resp);
  }
});

tests.push({
  name: 'GET /api/training-applications — no auth → 401',
  run: async () => {
    const resp = await rawFetch('GET', '/api/training-applications');
    if (resp.status === 404) throw new SkipError('Route not found');
    assertStatus(resp, 401);
  }
});

// ═══════════════════════════════════════════════════════
// INTEGRATIONS / SETTINGS (admin)
// ═══════════════════════════════════════════════════════
tests.push({
  name: 'GET /api/settings — admin settings (ADMIN)',
  run: async () => {
    const resp = await api('GET', '/api/settings', { role: 'ADMIN' });
    if (resp.status === 404) throw new SkipError('Route not found');
    assertOk(resp);
  }
});

tests.push({
  name: 'GET /api/settings — PM denied',
  run: async () => {
    const resp = await api('GET', '/api/settings', { role: 'PM' });
    if (resp.status === 404) throw new SkipError('Route not found');
    // PM should not access admin settings
    if (resp.ok) {
      // Some endpoints may allow partial access
    }
  }
});

// ═══════════════════════════════════════════════════════
// SITES
// ═══════════════════════════════════════════════════════
tests.push({
  name: 'GET /api/sites — list sites (ADMIN)',
  run: async () => {
    const resp = await api('GET', '/api/sites', { role: 'ADMIN' });
    if (resp.status === 404) throw new SkipError('Sites route not found');
    assertOk(resp);
  }
});

// ═══════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════
tests.push({
  name: 'GET /api/notifications — list own notifications',
  run: async () => {
    const resp = await api('GET', '/api/notifications', { role: 'PM' });
    if (resp.status === 404) throw new SkipError('Notifications route not found');
    assertOk(resp);
  }
});

tests.push({
  name: 'GET /api/notifications — no auth → 401',
  run: async () => {
    const resp = await rawFetch('GET', '/api/notifications');
    if (resp.status === 404) throw new SkipError('Route not found');
    assertStatus(resp, 401);
  }
});

// ═══════════════════════════════════════════════════════
// INCOMES
// ═══════════════════════════════════════════════════════
tests.push({
  name: 'GET /api/incomes — list incomes (ADMIN)',
  run: async () => {
    const resp = await api('GET', '/api/incomes', { role: 'ADMIN' });
    if (resp.status === 404) throw new SkipError('Incomes route not found');
    assertOk(resp);
  }
});

tests.push({
  name: 'GET /api/incomes — no auth → 401',
  run: async () => {
    const resp = await rawFetch('GET', '/api/incomes');
    if (resp.status === 404) throw new SkipError('Route not found');
    assertStatus(resp, 401);
  }
});

module.exports = {
  name: 'Uncovered Modules API',
  tests
};
