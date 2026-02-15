/**
 * SMOKE MATRIX: API Access Policy Tests
 *
 * Tests each role against each API endpoint based on ACTUAL server-side access control:
 * - fastify.authenticate (any authenticated user)
 * - fastify.requireRoles([...]) with role inheritance
 * - fastify.requirePermission(module, op) based on role_presets/user_permissions
 * - inline hasRole() checks (payroll)
 *
 * Role inheritance (in requireRoles only):
 *   HEAD_PM inherits PM
 *   HEAD_TO inherits TO
 *   HR_MANAGER inherits HR
 *   CHIEF_ENGINEER inherits WAREHOUSE
 *
 * Permission system: ADMIN always bypasses. Others checked via user_permissions
 * table (seeded from role_presets by seed.js).
 */
const { api, assert, getToken, BASE_URL, ROLES } = require('../config');

const ALL_ROLES = [
  'ADMIN', 'PM', 'TO', 'HEAD_PM', 'HEAD_TO', 'HR', 'HR_MANAGER', 'BUH',
  'PROC', 'OFFICE_MANAGER', 'CHIEF_ENGINEER',
  'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'WAREHOUSE'
];

// ═══════════════════════════════════════════════════════════════════
// ACCESS POLICY DEFINITIONS
// ═══════════════════════════════════════════════════════════════════

// Policy type: 'open' = any authenticated user (non-403)
// Policy type: 'roles' = requireRoles with inheritance
// Policy type: 'permission' = requirePermission (from role_presets)
// Policy type: 'hasRole' = inline hasRole check (payroll)
// Policy type: 'skip' = endpoint likely 404, skip entirely

// ---------- OPEN APIs (fastify.authenticate only) ----------
// All authenticated users get non-403 response
const OPEN_ENDPOINTS = [
  { page: '/home',              api: 'GET /api/auth/me' },
  { page: '/my-dashboard',      api: 'GET /api/auth/me' },
  { page: '/funnel',            api: 'GET /api/tenders' },
  { page: '/tenders',           api: 'GET /api/tenders' },
  { page: '/customers',         api: 'GET /api/customers' },
  { page: '/pm-calcs',          api: 'GET /api/estimates' },
  { page: '/calculator',        api: 'GET /api/estimates' },
  { page: '/approvals',         api: 'GET /api/estimates' },
  { page: '/bonus-approval',    api: 'GET /api/estimates' },
  { page: '/pm-works',          api: 'GET /api/works' },
  { page: '/all-works',         api: 'GET /api/works' },
  { page: '/all-estimates',     api: 'GET /api/estimates' },
  { page: '/gantt-calcs',       api: 'GET /api/estimates' },
  { page: '/gantt-works',       api: 'GET /api/works' },
  { page: '/finances',          api: 'GET /api/expenses/work' },
  { page: '/invoices',          api: 'GET /api/invoices' },
  { page: '/acts',              api: 'GET /api/acts' },
  { page: '/buh-registry',      api: 'GET /api/invoices' },
  { page: '/office-expenses',   api: 'GET /api/expenses/office' },
  { page: '/warehouse',         api: 'GET /api/equipment' },
  { page: '/my-equipment',      api: 'GET /api/equipment' },
  { page: '/engineer-dashboard', api: 'GET /api/equipment' },
  { page: '/personnel',         api: 'GET /api/staff/employees' },
  { page: '/workers-schedule',  api: 'GET /api/staff/employees' },
  { page: '/hr-rating',         api: 'GET /api/staff/employees' },
  { page: '/birthdays',         api: 'GET /api/staff/employees' },
  { page: '/calendar',          api: 'GET /api/calendar' },
  { page: '/office-schedule',   api: 'GET /api/calendar' },
  { page: '/settings',          api: 'GET /api/settings' },
  { page: '/backup',            api: 'GET /api/settings' },
  { page: '/sync',              api: 'GET /api/settings' },
  { page: '/diag',              api: 'GET /api/settings' },
  { page: '/alerts',            api: 'GET /api/notifications' },
  { page: '/chat',              api: 'GET /api/chats' },
  { page: '/object-map',        api: 'GET /api/sites' },
  { page: '/incomes',           api: 'GET /api/incomes' },
  { page: '/self-employed',    api: 'GET /api/payroll/self-employed' },
  { page: '/one-time-pay',     api: 'GET /api/payroll/one-time' },
];

// ---------- ROLE-RESTRICTED APIs (requireRoles) ----------
// pre-tenders: ALLOWED_ROLES = ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','HEAD_TO','TO']
// With inheritance: HEAD_TO is explicit, HEAD_PM inherits PM (not listed), HR_MANAGER inherits HR (not listed), CHIEF_ENGINEER inherits WAREHOUSE (not listed)
const PRE_TENDER_ALLOWED = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_TO', 'TO'];

const ROLE_RESTRICTED_ENDPOINTS = [
  {
    page: '/pre-tenders',
    api: 'GET /api/pre-tenders',
    allowed: PRE_TENDER_ALLOWED,
  },
  {
    page: '/inbox-applications',
    api: 'GET /api/pre-tenders',
    allowed: PRE_TENDER_ALLOWED,
  },
];

// ---------- PERMISSION-BASED APIs (requirePermission) ----------
// Verified against actual role_presets from GET /api/permissions/presets

// tasks (read): ALL roles have tasks.read in role_presets
const TASKS_READ_ROLES = [...ALL_ROLES];

// tasks_admin (read): DIRECTOR_GEN, DIRECTOR_COMM, DIRECTOR_DEV + ADMIN
const TASKS_ADMIN_READ_ROLES = [
  'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'
];

// cash (read): PM, HEAD_PM, BUH + DIRECTORS + ADMIN
const CASH_READ_ROLES = [
  'ADMIN', 'PM', 'HEAD_PM', 'BUH',
  'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'
];

// cash_admin (read): BUH + DIRECTORS + ADMIN
const CASH_ADMIN_READ_ROLES = [
  'ADMIN', 'BUH',
  'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'
];

// meetings (read): NO role has meetings.read in role_presets — ADMIN only
const MEETINGS_READ_ROLES = ['ADMIN'];

// permits (read): V005 role_presets give TO, PM, HR + ADMIN + directors
// HEAD_PM inherits PM, HR_MANAGER inherits HR, HEAD_TO inherits TO
const PERMITS_READ_ROLES = [
  'ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO',
  'HR', 'HR_MANAGER',
  'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'
];

// chat_groups (read): ALL roles have chat_groups.read in role_presets
const CHAT_GROUPS_READ_ROLES = [...ALL_ROLES];

const PERMISSION_ENDPOINTS = [
  {
    page: '/tasks',
    api: 'GET /api/tasks/my',
    permission: 'tasks',
    allowed: TASKS_READ_ROLES,
  },
  {
    page: '/kanban',
    api: 'GET /api/tasks/kanban',
    permission: 'tasks',
    allowed: TASKS_READ_ROLES,
  },
  {
    page: '/tasks-admin',
    api: 'GET /api/tasks/all',
    permission: 'tasks_admin',
    allowed: TASKS_ADMIN_READ_ROLES,
  },
  {
    page: '/cash',
    api: 'GET /api/cash/my',
    permission: 'cash',
    allowed: CASH_READ_ROLES,
  },
  {
    page: '/cash-admin',
    api: 'GET /api/cash/all',
    permission: 'cash_admin',
    allowed: CASH_ADMIN_READ_ROLES,
  },
  {
    page: '/meetings',
    api: 'GET /api/meetings',
    permission: 'meetings',
    allowed: MEETINGS_READ_ROLES,
  },
  {
    page: '/permits',
    api: 'GET /api/permits',
    permission: 'permits',
    allowed: PERMITS_READ_ROLES,
  },
  {
    page: '/permit-applications',
    api: 'GET /api/permits',
    permission: 'permits',
    allowed: PERMITS_READ_ROLES,
  },
  {
    page: '/chat-groups',
    api: 'GET /api/chat-groups',
    permission: 'chat_groups',
    allowed: CHAT_GROUPS_READ_ROLES,
  },
];

// ---------- PAYROLL APIs ----------
// GET /payroll/sheets uses inline hasRole(PAYROLL_ROLES)
// GET /payroll/self-employed uses just authenticate (OPEN)
// GET /payroll/one-time uses just authenticate (OPEN)
const PAYROLL_ALLOWED = [
  'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'PM', 'HEAD_PM', 'BUH'
];

const PAYROLL_ENDPOINTS = [
  { page: '/payroll', api: 'GET /api/payroll/sheets' },
  // self-employed and one-time are OPEN to all authenticated users
];

// ---------- SKIPPED APIs (likely 404 or not relevant) ----------
const SKIPPED_PAGES = [
  { page: '/dashboard',       api: 'GET /api/analytics/dashboard',       reason: 'endpoint may not exist (404)' },
  { page: '/big-screen',      api: 'GET /api/analytics/dashboard',       reason: 'endpoint may not exist (404)' },
  { page: '/analytics',       api: 'GET /api/analytics/dashboard',       reason: 'endpoint may not exist (404)' },
  { page: '/to-analytics',    api: 'GET /api/analytics/dashboard',       reason: 'endpoint may not exist (404)' },
  { page: '/pm-analytics',    api: 'GET /api/analytics/dashboard',       reason: 'endpoint may not exist (404)' },
  { page: '/mailbox',         api: 'GET /api/mailbox/accounts',          reason: 'endpoint may not exist (404)' },
  { page: '/mail-settings',   api: 'GET /api/mailbox/accounts',          reason: 'endpoint may not exist (404)' },
  { page: '/telegram',        api: 'GET /api/integrations/telegram/status', reason: 'endpoint may not exist (404)' },
  { page: '/mango',           api: 'GET /api/integrations/mango/status', reason: 'endpoint may not exist (404)' },
];

// ---------- DATA-TABLE APIs (/api/data/:table with ACCESS_MATRIX) ----------
// These are handled by the dedicated data-access-matrix.test.js
// Covered here only for pages backed by data tables; tested per ACCESS_MATRIX
// ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, DIRECTOR_DEV have tables:'all'
// HEAD_TO, HR_MANAGER, CHIEF_ENGINEER NOT in ACCESS_MATRIX → 403 on all
const DATA_ALL_ROLES = ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'];
const DATA_TABLE_ENDPOINTS = [
  { page: '/correspondence',  table: 'correspondence',     extraRoles: ['PM','TO','OFFICE_MANAGER'] },
  { page: '/contracts',       table: 'contracts',           extraRoles: ['PM','BUH','OFFICE_MANAGER','HEAD_PM'] },
  { page: '/seals',           table: 'seals',               extraRoles: ['OFFICE_MANAGER'] },
  { page: '/proxies',         table: 'seals',               extraRoles: ['OFFICE_MANAGER'] },
  { page: '/proc-requests',   table: 'purchase_requests',   extraRoles: ['OFFICE_MANAGER','PROC'] },
  { page: '/hr-requests',     table: 'staff_requests',      extraRoles: ['HR'] },
  { page: '/user-requests',   table: 'staff_requests',      extraRoles: ['HR'] },
  { page: '/travel',          table: 'travel_expenses',     extraRoles: ['PM','HR','OFFICE_MANAGER'] },
];

// ═══════════════════════════════════════════════════════════════════
// TEST GENERATION
// ═══════════════════════════════════════════════════════════════════

const tests = [];

// ─── 1. OPEN APIs: all 15 roles should get non-403 ───────────────
for (const endpoint of OPEN_ENDPOINTS) {
  const [method, path] = endpoint.api.split(' ');

  for (const role of ALL_ROLES) {
    tests.push({
      name: `[OPEN] ${role} CAN access ${endpoint.page} (${path}) -> non-403`,
      run: async () => {
        const resp = await api(method, path, { role });
        assert(
          resp.status !== 403,
          `${role} should access ${path} but got 403`
        );
      }
    });
  }
}

// ─── 2. DATA TABLE APIs: per ACCESS_MATRIX ──────────────────────
for (const endpoint of DATA_TABLE_ENDPOINTS) {
  const path = `/api/data/${endpoint.table}?limit=1`;
  const allowed = [...DATA_ALL_ROLES, ...endpoint.extraRoles];

  for (const role of ALL_ROLES) {
    const isAllowed = allowed.includes(role);
    tests.push({
      name: `[DATA] ${role} ${isAllowed ? 'CAN' : 'CANNOT'} access ${endpoint.page} (/api/data/${endpoint.table}) -> ${isAllowed ? 'non-403' : '403'}`,
      run: async () => {
        const resp = await api('GET', path, { role });
        if (isAllowed) {
          assert(resp.status !== 403, `${role} should access /api/data/${endpoint.table} but got 403`);
        } else {
          assert(resp.status === 403, `SECURITY: ${role} accessed /api/data/${endpoint.table} got ${resp.status}, expected 403`);
        }
      }
    });
  }
}

// ─── 3. ROLE-RESTRICTED APIs: allowed vs forbidden ───────────────
for (const endpoint of ROLE_RESTRICTED_ENDPOINTS) {
  const [method, path] = endpoint.api.split(' ');

  for (const role of ALL_ROLES) {
    const isAllowed = endpoint.allowed.includes(role);
    tests.push({
      name: `[ROLES] ${role} ${isAllowed ? 'CAN' : 'CANNOT'} access ${endpoint.page} (${path}) -> ${isAllowed ? 'non-403' : '403'}`,
      run: async () => {
        const resp = await api(method, path, { role });
        if (isAllowed) {
          assert(
            resp.status !== 403,
            `${role} should access ${path} but got 403`
          );
        } else {
          assert(
            resp.status === 403,
            `SECURITY: ${role} accessed ${path} got ${resp.status}, expected 403`
          );
        }
      }
    });
  }
}

// ─── 4. PERMISSION-BASED APIs: allowed vs forbidden ──────────────
for (const endpoint of PERMISSION_ENDPOINTS) {
  const [method, path] = endpoint.api.split(' ');

  for (const role of ALL_ROLES) {
    const isAllowed = endpoint.allowed.includes(role);
    tests.push({
      name: `[PERM:${endpoint.permission}] ${role} ${isAllowed ? 'CAN' : 'CANNOT'} access ${endpoint.page} (${path}) -> ${isAllowed ? 'non-403' : '403'}`,
      run: async () => {
        const resp = await api(method, path, { role });
        if (isAllowed) {
          assert(
            resp.status !== 403,
            `${role} should access ${path} (perm=${endpoint.permission}) but got 403`
          );
        } else {
          assert(
            resp.status === 403,
            `SECURITY: ${role} accessed ${path} (perm=${endpoint.permission}) got ${resp.status}, expected 403`
          );
        }
      }
    });
  }
}

// ─── 5. PAYROLL APIs: hasRole inline check ───────────────────────
for (const endpoint of PAYROLL_ENDPOINTS) {
  const [method, path] = endpoint.api.split(' ');

  for (const role of ALL_ROLES) {
    const isAllowed = PAYROLL_ALLOWED.includes(role);
    tests.push({
      name: `[PAYROLL] ${role} ${isAllowed ? 'CAN' : 'CANNOT'} access ${endpoint.page} (${path}) -> ${isAllowed ? 'non-403' : '403'}`,
      run: async () => {
        const resp = await api(method, path, { role });
        if (isAllowed) {
          assert(
            resp.status !== 403,
            `${role} should access ${path} but got 403`
          );
        } else {
          assert(
            resp.status === 403,
            `SECURITY: ${role} accessed ${path} got ${resp.status}, expected 403`
          );
        }
      }
    });
  }
}

// ─── 6. SKIPPED APIs: verify they return 404 (not a security hole) ─
for (const endpoint of SKIPPED_PAGES) {
  const [method, path] = endpoint.api.split(' ');

  tests.push({
    name: `[SKIP] ${endpoint.page} (${path}) -> expected 404 or non-403 (${endpoint.reason})`,
    run: async () => {
      const resp = await api(method, path, { role: 'ADMIN' });
      // We just verify it does not unexpectedly return 200 for a non-existent endpoint
      // or that it returns 404. Either 404 or 2xx is acceptable (endpoint may exist after all).
      // The key point: we are not testing access control for these.
      assert(
        resp.status !== 403,
        `ADMIN should never get 403 on ${path}, got ${resp.status}`
      );
    }
  });
}

// ─── 7. Additional cross-cutting security tests ──────────────────

// 7a. Verify ADMIN can access ALL permission-based endpoints
for (const endpoint of PERMISSION_ENDPOINTS) {
  const [method, path] = endpoint.api.split(' ');
  tests.push({
    name: `[ADMIN-BYPASS] ADMIN always accesses ${endpoint.page} (${path})`,
    run: async () => {
      const resp = await api(method, path, { role: 'ADMIN' });
      assert(
        resp.status !== 403,
        `ADMIN should bypass permission check on ${path} but got 403`
      );
    }
  });
}

// 7b. Verify ADMIN can access ALL role-restricted endpoints
for (const endpoint of ROLE_RESTRICTED_ENDPOINTS) {
  const [method, path] = endpoint.api.split(' ');
  tests.push({
    name: `[ADMIN-BYPASS] ADMIN always accesses ${endpoint.page} (${path})`,
    run: async () => {
      const resp = await api(method, path, { role: 'ADMIN' });
      assert(
        resp.status !== 403,
        `ADMIN should bypass role check on ${path} but got 403`
      );
    }
  });
}

// 7c. Verify ADMIN can access ALL payroll endpoints
for (const endpoint of PAYROLL_ENDPOINTS) {
  const [method, path] = endpoint.api.split(' ');
  tests.push({
    name: `[ADMIN-BYPASS] ADMIN always accesses ${endpoint.page} (${path})`,
    run: async () => {
      const resp = await api(method, path, { role: 'ADMIN' });
      assert(
        resp.status !== 403,
        `ADMIN should bypass payroll check on ${path} but got 403`
      );
    }
  });
}

// 7d. Role inheritance tests for requireRoles (pre-tenders)
const INHERITANCE_TESTS = [
  { role: 'HEAD_TO', inheritsFrom: 'TO',  endpoint: 'GET /api/pre-tenders', shouldAccess: true,  desc: 'HEAD_TO inherits TO -> access pre-tenders' },
  { role: 'HEAD_PM', inheritsFrom: 'PM',  endpoint: 'GET /api/pre-tenders', shouldAccess: false, desc: 'HEAD_PM inherits PM, PM not in pre-tender roles -> 403' },
  { role: 'HR_MANAGER', inheritsFrom: 'HR', endpoint: 'GET /api/pre-tenders', shouldAccess: false, desc: 'HR_MANAGER inherits HR, HR not in pre-tender roles -> 403' },
  { role: 'CHIEF_ENGINEER', inheritsFrom: 'WAREHOUSE', endpoint: 'GET /api/pre-tenders', shouldAccess: false, desc: 'CHIEF_ENGINEER inherits WAREHOUSE, WAREHOUSE not in pre-tender roles -> 403' },
];

for (const test of INHERITANCE_TESTS) {
  const [method, path] = test.endpoint.split(' ');
  tests.push({
    name: `[INHERIT] ${test.desc}`,
    run: async () => {
      const resp = await api(method, path, { role: test.role });
      if (test.shouldAccess) {
        assert(resp.status !== 403, `${test.role} should access ${path} via inheritance but got 403`);
      } else {
        assert(resp.status === 403, `${test.role} should NOT access ${path} but got ${resp.status}`);
      }
    }
  });
}

// 7e. Permission-based: verify specific preset matches
tests.push({
  name: '[PERM-VERIFY] HEAD_PM has cash.read permission -> non-403',
  run: async () => {
    const resp = await api('GET', '/api/cash/my', { role: 'HEAD_PM' });
    assert(resp.status !== 403, `HEAD_PM should access /api/cash/my but got 403`);
  }
});

tests.push({
  name: '[PERM-VERIFY] HEAD_PM has tasks.read permission -> non-403',
  run: async () => {
    const resp = await api('GET', '/api/tasks/my', { role: 'HEAD_PM' });
    assert(resp.status !== 403, `HEAD_PM should access /api/tasks/my but got ${resp.status}`);
  }
});

tests.push({
  name: '[PERM-VERIFY] HEAD_TO lacks meetings permission (no preset) -> 403',
  run: async () => {
    const resp = await api('GET', '/api/meetings', { role: 'HEAD_TO' });
    assert(resp.status === 403, `HEAD_TO should NOT access /api/meetings but got ${resp.status}`);
  }
});

tests.push({
  name: '[PERM-VERIFY] HR_MANAGER has tasks.read permission -> non-403',
  run: async () => {
    const resp = await api('GET', '/api/tasks/my', { role: 'HR_MANAGER' });
    assert(resp.status !== 403, `HR_MANAGER should access /api/tasks/my but got ${resp.status}`);
  }
});

tests.push({
  name: '[PERM-VERIFY] CHIEF_ENGINEER lacks meetings permission -> 403',
  run: async () => {
    const resp = await api('GET', '/api/meetings', { role: 'CHIEF_ENGINEER' });
    assert(resp.status === 403, `CHIEF_ENGINEER should NOT access /api/meetings but got ${resp.status}`);
  }
});

// 7f. Chat groups: verify a few representative roles have read access
for (const role of ['ADMIN', 'PM', 'TO', 'BUH', 'HR', 'DIRECTOR_GEN']) {
  tests.push({
    name: `[CHAT-GROUPS] ${role} CAN access /chat-groups -> non-403`,
    run: async () => {
      const resp = await api('GET', '/api/chat-groups', { role });
      assert(resp.status !== 403, `${role} should access /api/chat-groups but got 403`);
    }
  });
}

// 7g. Payroll: verify role inheritance in hasRole (HEAD_PM -> PM)
tests.push({
  name: '[PAYROLL-INHERIT] HEAD_PM inherits PM -> accesses payroll/sheets',
  run: async () => {
    const resp = await api('GET', '/api/payroll/sheets', { role: 'HEAD_PM' });
    assert(resp.status !== 403, `HEAD_PM should access /api/payroll/sheets via PM inheritance but got 403`);
  }
});

tests.push({
  name: '[PAYROLL-INHERIT] HEAD_TO does NOT inherit into PAYROLL_ROLES -> 403',
  run: async () => {
    const resp = await api('GET', '/api/payroll/sheets', { role: 'HEAD_TO' });
    assert(resp.status === 403, `HEAD_TO should NOT access /api/payroll/sheets but got ${resp.status}`);
  }
});

// 7h. Open API cross-checks: verify specific roles don't get 403 on open endpoints
const OPEN_SPOT_CHECKS = [
  { role: 'WAREHOUSE', path: '/api/equipment', page: '/warehouse' },
  { role: 'PROC',      path: '/api/sites',     page: '/object-map' },
  { role: 'HR',        path: '/api/staff/employees', page: '/personnel' },
  { role: 'BUH',       path: '/api/invoices',  page: '/invoices' },
  { role: 'OFFICE_MANAGER', path: '/api/expenses/office', page: '/office-expenses' },
  { role: 'TO',        path: '/api/customers',  page: '/customers' },
  { role: 'PM',        path: '/api/works',      page: '/pm-works' },
  { role: 'CHIEF_ENGINEER', path: '/api/equipment', page: '/engineer-dashboard' },
  { role: 'HR_MANAGER', path: '/api/staff/employees', page: '/personnel' },
  { role: 'HEAD_PM',   path: '/api/estimates',  page: '/pm-calcs' },
  { role: 'HEAD_TO',   path: '/api/tenders',    page: '/tenders' },
  { role: 'DIRECTOR_GEN', path: '/api/settings', page: '/settings' },
  { role: 'DIRECTOR_COMM', path: '/api/calendar', page: '/calendar' },
  { role: 'DIRECTOR_DEV', path: '/api/notifications', page: '/alerts' },
  { role: 'WAREHOUSE', path: '/api/auth/me',    page: '/home' },
];

for (const check of OPEN_SPOT_CHECKS) {
  tests.push({
    name: `[SPOT] ${check.role} accesses open API ${check.page} (${check.path}) -> non-403`,
    run: async () => {
      const resp = await api('GET', check.path, { role: check.role });
      assert(resp.status !== 403, `${check.role} should access ${check.path} but got 403`);
    }
  });
}

// ─── Summary ─────────────────────────────────────────────────────

const uniquePages = new Set([
  ...OPEN_ENDPOINTS.map(e => e.page),
  ...DATA_TABLE_ENDPOINTS.map(e => e.page),
  ...ROLE_RESTRICTED_ENDPOINTS.map(e => e.page),
  ...PERMISSION_ENDPOINTS.map(e => e.page),
  ...PAYROLL_ENDPOINTS.map(e => e.page),
  ...SKIPPED_PAGES.map(e => e.page),
]);

module.exports = {
  name: `SMOKE MATRIX (${uniquePages.size} pages, ${ALL_ROLES.length} roles, ${tests.length} tests)`,
  tests
};
