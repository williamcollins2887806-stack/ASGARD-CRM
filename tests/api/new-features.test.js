/**
 * API Tests for new features:
 * - Employee Collections CRUD
 * - Schedule bulk endpoint
 * - Cash submit-report endpoint
 * - User patronymic field
 * - SCHEDULE_COLS validation
 */
const { api, rawFetch, assertOk, assertStatus, skip, getToken, BASE_URL, SkipError } = require('../config');

const tests = [];
let collectionId = null;

// ── Employee Collections ──────────────────────────────────
tests.push({
  name: '[new-features] POST /api/employee-collections — create',
  run: async () => {
    const resp = await api('POST', '/api/employee-collections', {
      role: 'HR',
      body: { name: 'TEST_COLL_AUTO_' + Date.now(), description: 'Auto test' }
    });
    if (resp.status === 404) throw new SkipError('Route not registered');
    assertOk(resp);
    const data = resp.data;
    collectionId = (resp.data && resp.data.id) || (resp.data && resp.data.collection && resp.data.collection.id) || null;
    if (!collectionId) throw new Error('No collection id returned');
  }
});

tests.push({
  name: '[new-features] GET /api/employee-collections — list',
  run: async () => {
    const resp = await api('GET', '/api/employee-collections', { role: 'HR' });
    if (resp.status === 404) throw new SkipError('Route not registered');
    assertOk(resp);
  }
});

tests.push({
  name: '[new-features] GET /api/employee-collections/:id',
  run: async () => {
    if (!collectionId) throw new SkipError('No collection');
    const resp = await api('GET', '/api/employee-collections/' + collectionId, { role: 'HR' });
    assertOk(resp);
  }
});

tests.push({
  name: '[new-features] PUT /api/employee-collections/:id — update',
  run: async () => {
    if (!collectionId) throw new SkipError('No collection');
    const resp = await api('PUT', '/api/employee-collections/' + collectionId, {
      role: 'HR',
      body: { name: 'TEST_COLL_UPDATED_' + Date.now() }
    });
    assertOk(resp);
  }
});

tests.push({
  name: '[new-features] POST /api/employee-collections/:id/employees — add',
  run: async () => {
    if (!collectionId) throw new SkipError('No collection');
    const empResp = await api('GET', '/api/staff/employees?limit=1', { role: 'HR' });
    const emps = empResp.data;
    const empId = (emps.rows || emps || [])[0]?.id || 1;
    const resp = await api('POST', '/api/employee-collections/' + collectionId + '/employees', {
      role: 'HR',
      body: { employee_ids: [empId] }
    });
    assertOk(resp);
  }
});

tests.push({
  name: '[new-features] DELETE /api/employee-collections/:id',
  run: async () => {
    if (!collectionId) throw new SkipError('No collection');
    const resp = await api('DELETE', '/api/employee-collections/' + collectionId, { role: 'HR' });
    assertOk(resp);
  }
});

// ── Schedule Bulk ───────────────────────────────────────────
tests.push({
  name: '[new-features] POST /api/staff/schedule/bulk — create entries',
  run: async () => {
    const today = new Date().toISOString().slice(0, 10);
    const resp = await api('POST', '/api/staff/schedule/bulk', {
      role: 'HR',
      body: {
        entries: [
          { employee_id: 1, date: today, kind: 'reserve', source: 'api_test', locked: false }
        ]
      }
    });
    if (resp.status === 404) throw new Error('Bulk endpoint not found (404)');
    assertOk(resp);
    if (!resp.data.success) throw new Error('Expected success:true');
  }
});

tests.push({
  name: '[new-features] POST /api/staff/schedule/bulk — empty rejected',
  run: async () => {
    const resp = await api('POST', '/api/staff/schedule/bulk', {
      role: 'HR',
      body: { entries: [] }
    });
    assertStatus(resp, 400);
  }
});

tests.push({
  name: '[new-features] POST /api/staff/schedule/bulk — no auth 401',
  run: async () => {
    const resp = await rawFetch('POST', '/api/staff/schedule/bulk', {
      body: { entries: [{ employee_id: 1, date: '2026-01-01', kind: 'reserve' }] }
    });
    assertStatus(resp, 401);
  }
});

// ── Cash Submit Report ──────────────────────────────────────
tests.push({
  name: '[new-features] PUT /api/cash/999999/submit-report — not found',
  run: async () => {
    const resp = await api('PUT', '/api/cash/999999/submit-report', { role: 'PM' });
    if (resp.status !== 404 && resp.status !== 400) {
      throw new Error('Expected 404 or 400, got ' + resp.status);
    }
  }
});

tests.push({
  name: '[new-features] PUT /api/cash/999999/submit-report — no auth 401',
  run: async () => {
    const resp = await rawFetch('PUT', '/api/cash/999999/submit-report');
    assertStatus(resp, 401);
  }
});

// ── Patronymic ──────────────────────────────────────────────
tests.push({
  name: '[new-features] GET /api/auth/me — patronymic field exists',
  run: async () => {
    const resp = await api('GET', '/api/auth/me', { role: 'ADMIN' });
    assertOk(resp);
    const user = resp.data.user || resp.data;
    if (!('patronymic' in user)) throw new Error('patronymic field missing from /api/auth/me');
  }
});

tests.push({
  name: '[new-features] PUT /api/users/:id — update patronymic',
  run: async () => {
    const meResp = await api('GET', '/api/auth/me', { role: 'ADMIN' });
    assertOk(meResp);
    const userId = ((meResp.data && meResp.data.user) || meResp.data || {}).id;

    const resp = await api('PUT', '/api/users/' + userId, {
      role: 'ADMIN',
      body: { patronymic: 'Тестович' }
    });
    if (resp.status === 404) throw new SkipError('Users PUT not found');
    assertOk(resp);

    // Verify
    const check = await api('GET', '/api/auth/me', { role: 'ADMIN' });
    const pat = ((check.data && check.data.user) || check.data || {}).patronymic;
    if (pat !== 'Тестович') throw new Error('Patronymic not saved: got "' + pat + '"');

    // Reset
    await api('PUT', '/api/users/' + userId, { role: 'ADMIN', body: { patronymic: null } });
  }
});

// ── SCHEDULE_COLS ───────────────────────────────────────────
tests.push({
  name: '[new-features] POST /api/staff/schedule — kind field accepted',
  run: async () => {
    const today = new Date().toISOString().slice(0, 10);
    const resp = await api('POST', '/api/staff/schedule', {
      role: 'HR',
      body: { employee_id: 1, date: today, kind: 'office', source: 'api_test_cols' }
    });
    if (resp.status === 404) throw new SkipError('Schedule POST not found');
    if (!resp.ok && resp.status !== 409 && resp.status !== 200 && resp.status !== 201) {
      throw new Error('Expected 2xx or 409, got ' + resp.status);
    }
  }
});

module.exports = {
  name: 'New Features API',
  tests
};
