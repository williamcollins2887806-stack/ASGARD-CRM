/**
 * SIDEBAR ACCESS — Tests actual API access policies per role
 *
 * Two categories of tests:
 *
 * 1. OPEN endpoints (use only `fastify.authenticate`):
 *    Every authenticated role CAN access them. We verify status !== 403.
 *
 * 2. RESTRICTED endpoints (requireRoles / requirePermission / inline hasRole / ACCESS_MATRIX):
 *    We test that disallowed roles get 403, and allowed roles do NOT get 403.
 */
const { api, assert } = require('../config');

// ═══════════════════════════════════════════════════════════════════════════
// Roles under test
// ═══════════════════════════════════════════════════════════════════════════
const ROLES = ['TO', 'PM', 'HR', 'PROC', 'BUH', 'OFFICE_MANAGER', 'CHIEF_ENGINEER', 'WAREHOUSE'];

// ═══════════════════════════════════════════════════════════════════════════
// 1. OPEN endpoints — `fastify.authenticate` only (all authenticated → OK)
// ═══════════════════════════════════════════════════════════════════════════
const OPEN_ENDPOINTS = [
  { path: '/api/tenders',          label: 'tenders' },
  { path: '/api/works',            label: 'works' },
  { path: '/api/estimates',        label: 'estimates' },
  { path: '/api/expenses/work',    label: 'expenses/work' },
  { path: '/api/expenses/office',  label: 'expenses/office' },
  { path: '/api/invoices',         label: 'invoices' },
  { path: '/api/acts',             label: 'acts' },
  { path: '/api/staff/employees',  label: 'staff/employees' },
  { path: '/api/settings',         label: 'settings' },
  { path: '/api/equipment',        label: 'equipment' },
  { path: '/api/calendar',         label: 'calendar' },
  { path: '/api/notifications',    label: 'notifications' },
  { path: '/api/customers',        label: 'customers' },
  { path: '/api/sites',            label: 'sites' },
];

// ═══════════════════════════════════════════════════════════════════════════
// 2. RESTRICTED endpoints
// ═══════════════════════════════════════════════════════════════════════════

// --- 2a. GET /api/pre-tenders  →  requireRoles([...])
// Allowed: ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, DIRECTOR_DEV, HEAD_TO, TO
// Role inheritance: HEAD_TO inherits TO (already listed explicitly)
const PRE_TENDERS_ALLOWED = ['TO'];
const PRE_TENDERS_DENIED  = ['PM', 'HR', 'PROC', 'BUH', 'OFFICE_MANAGER', 'CHIEF_ENGINEER', 'WAREHOUSE'];

// --- 2b. GET /api/payroll/sheets  →  inline hasRole(PAYROLL_ROLES)
// PAYROLL_ROLES = ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','PM','HEAD_PM','BUH']
// Role inheritance: HEAD_PM inherits PM (PM is listed → HEAD_PM passes)
const PAYROLL_ALLOWED = ['PM', 'BUH'];
const PAYROLL_DENIED  = ['TO', 'HR', 'PROC', 'OFFICE_MANAGER', 'CHIEF_ENGINEER', 'WAREHOUSE'];

// --- 2c. requirePermission-based endpoints
// These check user_permissions first, then fallback to role_presets table.
// Test users with synthetic IDs will have NO user_permissions rows.
// Whether they get access depends on role_presets data in the database.
// We test the roles that should NOT have the preset → expect 403.
//
// GET /api/tasks/my        → requirePermission('tasks', 'read')
// GET /api/cash/my         → requirePermission('cash', 'read')
// GET /api/cash/all        → requirePermission('cash_admin', 'read')
// GET /api/meetings        → requirePermission('meetings', 'read')
// GET /api/permits         → requirePermission('permits', 'read')
// GET /api/chat-groups     → requirePermission('chat_groups', 'read')

// Permission endpoint definitions: for each, list which of our 8 roles
// are expected to be allowed vs denied based on standard role_presets.
const PERMISSION_ENDPOINTS = [
  {
    path: '/api/tasks/my',
    label: 'tasks/my',
    module: 'tasks',
    // tasks.read: ALL roles have it in role_presets
    allowed: ['TO', 'PM', 'HR', 'BUH', 'PROC', 'OFFICE_MANAGER', 'CHIEF_ENGINEER', 'WAREHOUSE'],
    denied:  [],
  },
  {
    path: '/api/cash/my',
    label: 'cash/my',
    module: 'cash',
    // cash.read: PM, HEAD_PM, BUH + DIRECTORS + ADMIN
    allowed: ['PM', 'BUH'],
    denied:  ['TO', 'HR', 'PROC', 'OFFICE_MANAGER', 'CHIEF_ENGINEER', 'WAREHOUSE'],
  },
  {
    path: '/api/cash/all',
    label: 'cash/all',
    module: 'cash_admin',
    // cash_admin is for directors and BUH only
    allowed: ['BUH'],
    denied:  ['TO', 'PM', 'HR', 'PROC', 'OFFICE_MANAGER', 'CHIEF_ENGINEER', 'WAREHOUSE'],
  },
  {
    path: '/api/meetings',
    label: 'meetings',
    module: 'meetings',
    // meetings.read NOT in role_presets — only ADMIN has access
    allowed: [],
    denied:  ['TO', 'PM', 'HR', 'BUH', 'PROC', 'OFFICE_MANAGER', 'CHIEF_ENGINEER', 'WAREHOUSE'],
  },
  {
    path: '/api/permits',
    label: 'permits',
    module: 'permits',
    // permits.read: V005 role_presets — TO, PM, HR + ADMIN + DIRECTORS
    allowed: ['TO', 'PM', 'HR'],
    denied:  ['PROC', 'OFFICE_MANAGER', 'WAREHOUSE'],
  },
  {
    path: '/api/chat-groups',
    label: 'chat-groups',
    module: 'chat_groups',
    // chat_groups.read: ALL roles have it
    allowed: ['TO', 'PM', 'HR', 'BUH', 'PROC', 'OFFICE_MANAGER', 'CHIEF_ENGINEER', 'WAREHOUSE'],
    denied:  [],
  },
];

// --- 2d. GET /api/data/:table  →  ACCESS_MATRIX check
// The ACCESS_MATRIX in data.js defines per-role table access.
// CHIEF_ENGINEER has NO entry in the matrix → gets 403 on everything.
// Each role has a specific list of allowed tables.
const DATA_TABLES = {
  travel_expenses:    { label: '/data/travel_expenses' },
  purchase_requests:  { label: '/data/purchase_requests' },
  seals:              { label: '/data/seals' },
  correspondence:     { label: '/data/correspondence' },
};

// ACCESS_MATRIX per role (from src/routes/data.js) — only tables above
const DATA_ACCESS = {
  TO:              ['correspondence'],
  PM:              ['travel_expenses', 'correspondence'],
  HR:              ['travel_expenses'],
  PROC:            ['purchase_requests'],
  BUH:             [],
  OFFICE_MANAGER:  ['correspondence', 'seals', 'purchase_requests', 'travel_expenses'],
  CHIEF_ENGINEER:  [],  // Not in ACCESS_MATRIX at all
  WAREHOUSE:       [],
};

// ═══════════════════════════════════════════════════════════════════════════
// Build test cases
// ═══════════════════════════════════════════════════════════════════════════
const tests = [];

// ─── 1. OPEN endpoints: every role gets access (positive tests) ──────────
for (const ep of OPEN_ENDPOINTS) {
  for (const role of ROLES) {
    tests.push({
      name: `OPEN: ${role} CAN access ${ep.label}`,
      run: async () => {
        const resp = await api('GET', ep.path, { role });
        assert(
          resp.status !== 403,
          `${role} should access ${ep.label} (${ep.path}) — authenticate-only endpoint — but got 403`
        );
      },
    });
  }
}

// ─── 2a. /api/pre-tenders: requireRoles ──────────────────────────────────
for (const role of PRE_TENDERS_ALLOWED) {
  tests.push({
    name: `RESTRICTED: ${role} CAN access pre-tenders`,
    run: async () => {
      const resp = await api('GET', '/api/pre-tenders', { role });
      assert(resp.status !== 403, `${role} should access /api/pre-tenders but got 403`);
    },
  });
}
for (const role of PRE_TENDERS_DENIED) {
  tests.push({
    name: `RESTRICTED: ${role} CANNOT access pre-tenders -> 403`,
    run: async () => {
      const resp = await api('GET', '/api/pre-tenders', { role });
      assert(resp.status === 403, `SECURITY: ${role} accessed /api/pre-tenders, got ${resp.status}, expected 403`);
    },
  });
}

// ─── 2b. /api/payroll/sheets: inline hasRole ─────────────────────────────
for (const role of PAYROLL_ALLOWED) {
  tests.push({
    name: `RESTRICTED: ${role} CAN access payroll/sheets`,
    run: async () => {
      const resp = await api('GET', '/api/payroll/sheets', { role });
      assert(resp.status !== 403, `${role} should access /api/payroll/sheets but got 403`);
    },
  });
}
for (const role of PAYROLL_DENIED) {
  tests.push({
    name: `RESTRICTED: ${role} CANNOT access payroll/sheets -> 403`,
    run: async () => {
      const resp = await api('GET', '/api/payroll/sheets', { role });
      assert(resp.status === 403, `SECURITY: ${role} accessed /api/payroll/sheets, got ${resp.status}, expected 403`);
    },
  });
}

// ─── 2c. requirePermission-based endpoints ───────────────────────────────
for (const ep of PERMISSION_ENDPOINTS) {
  for (const role of ep.allowed) {
    tests.push({
      name: `PERM: ${role} CAN access ${ep.label} (${ep.module})`,
      run: async () => {
        const resp = await api('GET', ep.path, { role });
        assert(
          resp.status !== 403,
          `${role} should have permission '${ep.module}:read' for ${ep.path} but got 403`
        );
      },
    });
  }
  for (const role of ep.denied) {
    tests.push({
      name: `PERM: ${role} CANNOT access ${ep.label} (${ep.module}) -> 403`,
      run: async () => {
        const resp = await api('GET', ep.path, { role });
        assert(
          resp.status === 403,
          `SECURITY: ${role} accessed ${ep.path} (${ep.module}), got ${resp.status}, expected 403`
        );
      },
    });
  }
}

// ─── 2d. /api/data/:table — ACCESS_MATRIX ────────────────────────────────
for (const [table, meta] of Object.entries(DATA_TABLES)) {
  const dataPath = `/api/data/${table}`;
  for (const role of ROLES) {
    const allowedTables = DATA_ACCESS[role] || [];
    const canAccess = allowedTables.includes(table);
    if (canAccess) {
      tests.push({
        name: `DATA: ${role} CAN access ${meta.label}`,
        run: async () => {
          const resp = await api('GET', dataPath, { role });
          assert(
            resp.status !== 403,
            `${role} should access ${dataPath} per ACCESS_MATRIX but got 403`
          );
        },
      });
    } else {
      tests.push({
        name: `DATA: ${role} CANNOT access ${meta.label} -> 403`,
        run: async () => {
          const resp = await api('GET', dataPath, { role });
          assert(
            resp.status === 403,
            `SECURITY: ${role} accessed ${dataPath}, got ${resp.status}, expected 403`
          );
        },
      });
    }
  }
}

module.exports = {
  name: `SIDEBAR ACCESS (${tests.length} tests)`,
  tests,
};
