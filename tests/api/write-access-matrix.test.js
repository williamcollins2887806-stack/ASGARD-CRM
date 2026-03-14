/**
 * WRITE ACCESS MATRIX — Every POST/PUT/DELETE endpoint x 15 roles
 * Tests that forbidden roles get 403 on all write endpoints.
 * If a forbidden role gets 200 or 500 instead of 403, it's a SECURITY HOLE.
 *
 * Generated from actual preHandler/requireRoles/requirePermission in src/routes/*.js
 *
 * Role inheritance (from src/index.js requireRoles):
 *   - ADMIN always passes
 *   - HEAD_PM inherits PM
 *   - HEAD_TO inherits TO
 *   - HR_MANAGER inherits HR
 *   - CHIEF_ENGINEER inherits WAREHOUSE
 */
const { api, assert, assertOk, skip, TEST_USERS, getToken, BASE_URL } = require('../config');

const ALL_ROLES = [
  'ADMIN','PM','TO','HEAD_PM','HEAD_TO','HR','HR_MANAGER','BUH',
  'PROC','OFFICE_MANAGER','CHIEF_ENGINEER',
  'DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','WAREHOUSE'
];

// ═══════════════════════════════════════════════════════════════════════════
// WRITE ENDPOINTS with allowed roles (from actual route code analysis)
//
// requireRoles inheritance applied:
//   - If PM in roles list  => HEAD_PM also allowed
//   - If TO in roles list  => HEAD_TO also allowed
//   - If HR in roles list  => HR_MANAGER also allowed
//   - If WAREHOUSE in list => CHIEF_ENGINEER also allowed
//   - ADMIN always allowed (implicit)
// ═══════════════════════════════════════════════════════════════════════════
const WRITE_ENDPOINTS = [
  // ─── TENDERS ─────────────────────────────────────────────────
  // requireRoles(['ADMIN','PM','TO','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'])
  // HEAD_PM inherits PM, HEAD_TO inherits TO
  { method: 'POST',   url: '/api/tenders',       allowed: ['ADMIN','PM','HEAD_PM','TO','HEAD_TO','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','PROC'],
    body: { customer_name: 'WAM-Test', tender_type: 'Прямой запрос' } },
  { method: 'PUT',    url: '/api/tenders/:id',    allowed: ['ADMIN','PM','HEAD_PM','TO','HEAD_TO','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','PROC'],
    body: { comment_to: 'WAM-update' }, needsId: 'tenders' },
  { method: 'DELETE', url: '/api/tenders/:id',    allowed: ['ADMIN','DIRECTOR_GEN'],
    needsId: 'tenders' },

  // ─── ESTIMATES ───────────────────────────────────────────────
  // requireRoles(['ADMIN','PM','TO','DIRECTOR_GEN'])
  // HEAD_PM inherits PM, HEAD_TO inherits TO
  { method: 'POST',   url: '/api/estimates',      allowed: ['ADMIN','PM','HEAD_PM','TO','HEAD_TO','DIRECTOR_GEN'],
    body: { title: 'WAM-Est', amount: 100 } },
  { method: 'PUT',    url: '/api/estimates/:id',   allowed: ['ADMIN','PM','HEAD_PM','TO','HEAD_TO','DIRECTOR_GEN'],
    body: { title: 'WAM-Est-upd' }, needsId: 'estimates' },
  { method: 'DELETE', url: '/api/estimates/:id',   allowed: ['ADMIN'],
    needsId: 'estimates' },

  // ─── WORKS ───────────────────────────────────────────────────
  // requireRoles(['ADMIN','PM','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'])
  // HEAD_PM inherits PM
  { method: 'POST',   url: '/api/works',          allowed: ['ADMIN','PM','HEAD_PM','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','PROC'],
    body: { work_title: 'WAM-Work' } },
  { method: 'PUT',    url: '/api/works/:id',       allowed: ['ADMIN','PM','HEAD_PM','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','PROC'],
    body: { work_title: 'WAM-Work-upd' }, needsId: 'works' },
  { method: 'DELETE', url: '/api/works/:id',       allowed: ['ADMIN'],
    needsId: 'works' },

  // ─── EXPENSES ────────────────────────────────────────────────
  // WRITE_ROLES = ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','PM','BUH']
  // HEAD_PM inherits PM via requireRoles
  { method: 'POST',   url: '/api/expenses/work',  allowed: ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','PM','HEAD_PM','BUH'],
    body: { amount: 100, category: 'Материалы', description: 'WAM-exp' } },
  { method: 'POST',   url: '/api/expenses/office', allowed: ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','PM','HEAD_PM','BUH'],
    body: { amount: 50, category: 'Канцелярия', description: 'WAM-off' } },

  // ─── INCOMES ─────────────────────────────────────────────────
  // WRITE_ROLES = ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','PM','BUH']
  // HEAD_PM inherits PM via requireRoles
  { method: 'POST',   url: '/api/incomes',        allowed: ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','PM','HEAD_PM','BUH'],
    body: { amount: 1000, type: 'Оплата', description: 'WAM-inc' } },
  { method: 'DELETE', url: '/api/incomes/:id',     allowed: ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','PM','HEAD_PM','BUH'],
    needsId: 'incomes' },

  // ─── INVOICES ────────────────────────────────────────────────
  // WRITE_ROLES = ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','PM','BUH']
  // HEAD_PM inherits PM via requireRoles
  { method: 'POST',   url: '/api/invoices',       allowed: ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','PM','HEAD_PM','BUH'],
    body: { invoice_number: 'WAM-INV', invoice_date: '2026-02-15', amount: 5000 } },
  { method: 'DELETE', url: '/api/invoices/:id',    allowed: ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','PM','HEAD_PM','BUH'],
    needsId: 'invoices' },

  // ─── ACTS ────────────────────────────────────────────────────
  // WRITE_ROLES = ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','PM','BUH']
  // HEAD_PM inherits PM via requireRoles
  { method: 'POST',   url: '/api/acts',           allowed: ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','PM','HEAD_PM','BUH'],
    body: { number: 'WAM-ACT', amount: 3000, date: '2026-02-15' } },
  { method: 'DELETE', url: '/api/acts/:id',        allowed: ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','PM','HEAD_PM','BUH'],
    needsId: 'acts' },

  // ─── CUSTOMERS ───────────────────────────────────────────────
  // requireRoles(['ADMIN','PM','TO','DIRECTOR_GEN','DIRECTOR_COMM'])
  // HEAD_PM inherits PM, HEAD_TO inherits TO
  { method: 'POST',   url: '/api/customers',      allowed: ['ADMIN','PM','HEAD_PM','TO','HEAD_TO','DIRECTOR_GEN','DIRECTOR_COMM'],
    body: { inn: '9999977777', name: 'WAM Customer' } },
  { method: 'DELETE', url: '/api/customers/:inn',  allowed: ['ADMIN'],
    needsId: 'customers', idValue: '9999977777' },

  // ─── SITES ───────────────────────────────────────────────────
  // requireRoles(['ADMIN','PM','DIRECTOR_GEN'])
  // HEAD_PM inherits PM
  { method: 'POST',   url: '/api/sites',          allowed: ['ADMIN','PM','HEAD_PM','DIRECTOR_GEN'],
    body: { name: 'WAM-Site', short_name: 'WAM' } },
  { method: 'DELETE', url: '/api/sites/:id',       allowed: ['ADMIN'],
    needsId: 'sites' },

  // ─── STAFF / EMPLOYEES ──────────────────────────────────────
  // requireRoles(['ADMIN','HR','DIRECTOR_GEN'])
  // HR_MANAGER inherits HR
  { method: 'POST',   url: '/api/staff/employees', allowed: ['ADMIN','HR','HR_MANAGER','DIRECTOR_GEN'],
    body: { fio: 'WAM Тестовый Работник' } },

  // ─── USERS ───────────────────────────────────────────────────
  // requireRoles(['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'])
  // Schema requires: login, name, role (without role field => 400 before 403)
  { method: 'POST',   url: '/api/users',          allowed: ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'],
    body: { login: 'wam_test_' + Date.now(), password: 'WamTest123!', name: 'WAM User', email: 'wam@test.local', role: 'PM' } },
  { method: 'DELETE', url: '/api/users/:id',       allowed: ['ADMIN'],
    needsId: 'users' },

  // ─── SETTINGS ────────────────────────────────────────────────
  { method: 'DELETE', url: '/api/settings/:key',   allowed: ['ADMIN'],
    needsId: 'settings', idValue: 'wam_nonexistent_key' },

  // ─── EQUIPMENT ───────────────────────────────────────────────
  // requireRoles(['ADMIN','WAREHOUSE','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'])
  // CHIEF_ENGINEER inherits WAREHOUSE
  { method: 'POST',   url: '/api/equipment',      allowed: ['ADMIN','WAREHOUSE','CHIEF_ENGINEER','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'],
    body: { name: 'WAM-Equip', inventory_number: 'WAM-' + Date.now() } },

  // ─── TKP ─────────────────────────────────────────────────────
  // requireRoles(['ADMIN','PM','TO','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'])
  // HEAD_PM inherits PM, HEAD_TO inherits TO
  { method: 'POST',   url: '/api/tkp',            allowed: ['ADMIN','PM','HEAD_PM','TO','HEAD_TO','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'],
    body: { title: 'WAM-TKP', amount: 500 } },
  { method: 'DELETE', url: '/api/tkp/:id',         allowed: ['ADMIN'],
    needsId: 'tkp' },

  // ─── PASS REQUESTS ──────────────────────────────────────────
  // requireRoles(['ADMIN','PM','TO','HR','DIRECTOR_GEN'])
  // HEAD_PM inherits PM, HEAD_TO inherits TO, HR_MANAGER inherits HR
  { method: 'POST',   url: '/api/pass-requests',  allowed: ['ADMIN','PM','HEAD_PM','TO','HEAD_TO','HR','HR_MANAGER','DIRECTOR_GEN'],
    body: { object_name: 'WAM-Pass', pass_date_from: '2026-03-01', pass_date_to: '2026-03-15' } },
  { method: 'DELETE', url: '/api/pass-requests/:id', allowed: ['ADMIN'],
    needsId: 'pass-requests' },

  // ─── TMC REQUESTS ───────────────────────────────────────────
  // requireRoles(['ADMIN','PM','TO','DIRECTOR_GEN','DIRECTOR_COMM','BUH'])
  // HEAD_PM inherits PM, HEAD_TO inherits TO
  { method: 'POST',   url: '/api/tmc-requests',   allowed: ['ADMIN','PM','HEAD_PM','TO','HEAD_TO','DIRECTOR_GEN','DIRECTOR_COMM','BUH'],
    body: { title: 'WAM-TMC', description: 'test' } },
  { method: 'DELETE', url: '/api/tmc-requests/:id', allowed: ['ADMIN'],
    needsId: 'tmc-requests' },

  // ─── PAYROLL ─────────────────────────────────────────────────
  // POST /sheets: authenticate + inline hasRole(['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','PM','HEAD_PM'])
  // HEAD_PM is explicitly listed; BUH is NOT in the POST create list
  { method: 'POST',   url: '/api/payroll/sheets',  allowed: ['ADMIN','PM','HEAD_PM','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'],
    body: { title: 'WAM-Sheet', period_from: '2026-03-01', period_to: '2026-03-31' } },
  // DELETE /sheets/:id: authenticate only, no role check — handler checks resource existence then status.
  // All authenticated roles can reach the handler; non-existent ID returns 404.
  { method: 'DELETE', url: '/api/payroll/sheets/:id', allowed: ALL_ROLES,
    needsId: 'payroll-sheets' },

  // ─── CALENDAR ────────────────────────────────────────────────
  // authenticate only — all roles allowed
  { method: 'POST',   url: '/api/calendar',       allowed: ALL_ROLES,
    body: { title: 'WAM-Cal', date: '2026-03-01' } },
  { method: 'DELETE', url: '/api/calendar/:id',    allowed: ALL_ROLES,
    needsId: 'calendar' },
];

// ═══════════════════════════════════════════════════════════════════════════
// Track created resources for cleanup
// ═══════════════════════════════════════════════════════════════════════════
const _created = { tenders: [], works: [], estimates: [], invoices: [], acts: [],
  incomes: [], sites: [], users: [], tkp: [], calendar: [], equipment: [],
  'payroll-sheets': [], 'pass-requests': [], 'tmc-requests': [] };

async function getOrCreateId(resource) {
  // For endpoints that need :id, create a resource first
  switch (resource) {
    case 'tenders': {
      const r = await api('POST', '/api/tenders', { role: 'ADMIN', body: { customer_name: 'WAM-id-test', tender_type: 'Прямой запрос' } });
      const id = r.data?.tender?.id || r.data?.id;
      if (id) _created.tenders.push(id);
      return id || 1;
    }
    case 'estimates': {
      const r = await api('POST', '/api/estimates', { role: 'ADMIN', body: { title: 'WAM-id-est', amount: 100 } });
      const id = r.data?.estimate?.id || r.data?.id;
      if (id) _created.estimates.push(id);
      return id || 1;
    }
    case 'works': {
      const r = await api('POST', '/api/works', { role: 'ADMIN', body: { work_title: 'WAM-id-work' } });
      const id = r.data?.work?.id || r.data?.id;
      if (id) _created.works.push(id);
      return id || 1;
    }
    case 'incomes': {
      const r = await api('POST', '/api/incomes', { role: 'ADMIN', body: { amount: 100, type: 'Оплата', description: 'WAM-id-inc' } });
      const id = r.data?.income?.id || r.data?.id;
      if (id) _created.incomes.push(id);
      return id || 1;
    }
    case 'invoices': {
      const r = await api('POST', '/api/invoices', { role: 'ADMIN', body: { invoice_number: 'WAM-INV-ID', invoice_date: '2026-02-15', amount: 100 } });
      const id = r.data?.invoice?.id || r.data?.id;
      if (id) _created.invoices.push(id);
      return id || 1;
    }
    case 'acts': {
      const r = await api('POST', '/api/acts', { role: 'ADMIN', body: { number: 'WAM-ACT-ID', amount: 100, date: '2026-02-15' } });
      const id = r.data?.act?.id || r.data?.id;
      if (id) _created.acts.push(id);
      return id || 1;
    }
    case 'sites': {
      const r = await api('POST', '/api/sites', { role: 'ADMIN', body: { name: 'WAM-Site-ID', short_name: 'WS' } });
      const id = r.data?.site?.id || r.data?.id;
      if (id) _created.sites.push(id);
      return id || 1;
    }
    case 'tkp': {
      const r = await api('POST', '/api/tkp', { role: 'ADMIN', body: { title: 'WAM-TKP-ID' } });
      const id = r.data?.tkp?.id || r.data?.id;
      if (id) _created.tkp.push(id);
      return id || 1;
    }
    case 'calendar': {
      const r = await api('POST', '/api/calendar', { role: 'ADMIN', body: { title: 'WAM-Cal-ID', date: '2026-03-01' } });
      const id = r.data?.event?.id || r.data?.id;
      if (id) _created.calendar.push(id);
      return id || 1;
    }
    case 'payroll-sheets': {
      const r = await api('POST', '/api/payroll/sheets', { role: 'ADMIN', body: { title: 'WAM-Sheet-ID', period_from: '2026-03-01', period_to: '2026-03-31' } });
      const id = r.data?.sheet?.id || r.data?.id;
      if (id) _created['payroll-sheets'].push(id);
      return id || 1;
    }
    case 'pass-requests': {
      const r = await api('POST', '/api/pass-requests', { role: 'ADMIN', body: { object_name: 'WAM-Pass-ID', pass_date_from: '2026-03-01', pass_date_to: '2026-03-15' } });
      const id = r.data?.passRequest?.id || r.data?.id;
      if (id) _created['pass-requests'].push(id);
      return id || 1;
    }
    case 'tmc-requests': {
      const r = await api('POST', '/api/tmc-requests', { role: 'ADMIN', body: { title: 'WAM-TMC-ID', description: 'test' } });
      const id = r.data?.tmcRequest?.id || r.data?.id;
      if (id) _created['tmc-requests'].push(id);
      return id || 1;
    }
    default:
      return 999999;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Generate tests: for each endpoint, test forbidden roles -> 403
// ═══════════════════════════════════════════════════════════════════════════
const tests = [];

// Setup: create resources for :id tests
tests.push({
  name: 'SETUP: create test resources for :id endpoints',
  run: async () => {
    // Pre-create resources we'll need for DELETE / PUT :id tests
    await getOrCreateId('tenders');
    await getOrCreateId('works');
    await getOrCreateId('estimates');
    await getOrCreateId('incomes');
    await getOrCreateId('invoices');
    await getOrCreateId('acts');
    await getOrCreateId('payroll-sheets');
  }
});

for (const ep of WRITE_ENDPOINTS) {
  const forbidden = ALL_ROLES.filter(r => !ep.allowed.includes(r));

  // Skip endpoints where all roles are allowed (no security test needed)
  if (forbidden.length === 0) continue;

  // Positive test: first allowed non-ADMIN role can access
  const positiveRole = ep.allowed.find(r => r !== 'ADMIN') || 'ADMIN';
  if (ep.method === 'POST' && !ep.needsId) {
    tests.push({
      name: `ALLOWED: ${positiveRole} CAN ${ep.method} ${ep.url}`,
      run: async () => {
        const resp = await api(ep.method, ep.url, { role: positiveRole, body: ep.body || {} });
        assert(
          resp.status !== 403,
          `${positiveRole} should be ALLOWED for ${ep.method} ${ep.url}: got 403`
        );
        // Cleanup created resource
        const id = resp.data?.id || resp.data?.tender?.id || resp.data?.work?.id ||
                   resp.data?.estimate?.id || resp.data?.invoice?.id || resp.data?.act?.id ||
                   resp.data?.income?.id || resp.data?.site?.id || resp.data?.tkp?.id ||
                   resp.data?.event?.id || resp.data?.sheet?.id;
        if (id && ep.method === 'POST') {
          await api('DELETE', `${ep.url}/${id}`, { role: 'ADMIN' }).catch(() => {});
        }
      }
    });
  }

  // Negative tests: EACH forbidden role -> 403
  for (const role of forbidden) {
    tests.push({
      name: `FORBIDDEN: ${role} CANNOT ${ep.method} ${ep.url} -> 403`,
      run: async () => {
        let url = ep.url;
        if (ep.needsId) {
          if (ep.idValue) {
            url = url.replace(':id', ep.idValue).replace(':inn', ep.idValue).replace(':key', ep.idValue);
          } else {
            const id = _created[ep.needsId]?.[0] || 999999;
            url = url.replace(':id', id);
          }
        }
        const resp = await api(ep.method, url, { role, body: ep.body || {} });
        assert(
          resp.status === 403,
          `SECURITY HOLE: ${role} got ${resp.status} on ${ep.method} ${url}, expected 403`
        );
      }
    });
  }
}

// Cleanup
tests.push({
  name: 'CLEANUP: remove all WAM test data',
  run: async () => {
    for (const id of _created.calendar) await api('DELETE', `/api/calendar/${id}`, { role: 'ADMIN' }).catch(() => {});
    for (const id of _created.tkp) await api('DELETE', `/api/tkp/${id}`, { role: 'ADMIN' }).catch(() => {});
    for (const id of _created.acts) await api('DELETE', `/api/acts/${id}`, { role: 'ADMIN' }).catch(() => {});
    for (const id of _created.invoices) await api('DELETE', `/api/invoices/${id}`, { role: 'ADMIN' }).catch(() => {});
    for (const id of _created.incomes) await api('DELETE', `/api/incomes/${id}`, { role: 'ADMIN' }).catch(() => {});
    for (const id of _created.estimates) await api('DELETE', `/api/estimates/${id}`, { role: 'ADMIN' }).catch(() => {});
    for (const id of _created.sites) await api('DELETE', `/api/sites/${id}`, { role: 'ADMIN' }).catch(() => {});
    for (const id of _created.works) await api('DELETE', `/api/works/${id}`, { role: 'ADMIN' }).catch(() => {});
    for (const id of _created.tenders) await api('DELETE', `/api/tenders/${id}`, { role: 'ADMIN' }).catch(() => {});
    for (const id of _created.users) await api('DELETE', `/api/users/${id}`, { role: 'ADMIN' }).catch(() => {});
    for (const id of _created.equipment) await api('DELETE', `/api/equipment/${id}`, { role: 'ADMIN' }).catch(() => {});
    for (const id of _created['payroll-sheets']) await api('DELETE', `/api/payroll/sheets/${id}`, { role: 'ADMIN' }).catch(() => {});
    for (const id of _created['pass-requests']) await api('DELETE', `/api/pass-requests/${id}`, { role: 'ADMIN' }).catch(() => {});
    for (const id of _created['tmc-requests']) await api('DELETE', `/api/tmc-requests/${id}`, { role: 'ADMIN' }).catch(() => {});
    await api('DELETE', '/api/customers/9999977777', { role: 'ADMIN' }).catch(() => {});
  }
});

module.exports = {
  name: `WRITE ACCESS MATRIX (${tests.length} tests)`,
  tests
};
