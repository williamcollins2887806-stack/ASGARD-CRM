/**
 * SMOKE ALL PAGES — verify every API endpoint responds without 5xx errors.
 *
 * Part 1: Hit all 75 endpoints as ADMIN, assert status < 500.
 * Part 2: For each of the 15 roles, hit 5 key endpoints to verify role-based
 *         access works without server crashes (status < 500).
 *
 * Total: ~75 admin endpoint tests + 15 role tests = ~90 tests.
 */
const { api, assert, assertOk, assertForbidden, skip } = require('../config');

// ── Helper: assert no 5xx ──
function assertNo5xx(resp, context) {
  assert(resp.status < 500, `${context}: got 5xx error (${resp.status}) — ${JSON.stringify(resp.data)?.slice(0, 300)}`);
}

// ── All endpoints to smoke-test as ADMIN ──
const ADMIN_ENDPOINTS = [
  // Core
  { path: '/api/health',                     group: 'Core' },
  { path: '/api/users',                      group: 'Users' },
  { path: '/api/users/roles/list',           group: 'Users' },
  // Tenders
  { path: '/api/tenders',                    group: 'Tenders' },
  { path: '/api/tenders/stats/summary',      group: 'Tenders' },
  { path: '/api/tenders/analytics/team',     group: 'Tenders' },
  // Works
  { path: '/api/works',                      group: 'Works' },
  { path: '/api/works/analytics/team',       group: 'Works' },
  // Estimates
  { path: '/api/estimates',                  group: 'Estimates' },
  // Pre-tenders
  { path: '/api/pre-tenders',               group: 'Pre-tenders' },
  { path: '/api/pre-tenders/stats',         group: 'Pre-tenders' },
  // Customers
  { path: '/api/customers',                  group: 'Customers' },
  // Incomes
  { path: '/api/incomes',                    group: 'Incomes' },
  // Expenses
  { path: '/api/expenses/work',              group: 'Expenses' },
  { path: '/api/expenses/office',            group: 'Expenses' },
  // Invoices
  { path: '/api/invoices',                   group: 'Invoices' },
  { path: '/api/invoices/overdue/list',      group: 'Invoices' },
  { path: '/api/invoices/stats/summary',     group: 'Invoices' },
  // Acts
  { path: '/api/acts',                       group: 'Acts' },
  { path: '/api/acts/stats/summary',         group: 'Acts' },
  // Tasks
  { path: '/api/tasks/my',                   group: 'Tasks' },
  { path: '/api/tasks/created',              group: 'Tasks' },
  { path: '/api/tasks/stats',                group: 'Tasks' },
  { path: '/api/tasks/todo',                 group: 'Tasks' },
  // Calendar
  { path: '/api/calendar',                   group: 'Calendar' },
  { path: '/api/calendar/reminders/check',   group: 'Calendar' },
  // Staff
  { path: '/api/staff/employees',            group: 'Staff' },
  { path: '/api/staff/schedule',             group: 'Staff' },
  // Notifications
  { path: '/api/notifications',              group: 'Notifications' },
  // Settings
  { path: '/api/settings',                   group: 'Settings' },
  // Reports
  { path: '/api/reports',                    group: 'Reports' },
  // Permits
  { path: '/api/permits',                    group: 'Permits' },
  { path: '/api/permits/types',              group: 'Permits' },
  { path: '/api/permits/matrix',             group: 'Permits' },
  { path: '/api/permits/stats',              group: 'Permits' },
  { path: '/api/permits/upcoming',           group: 'Permits' },
  // Equipment
  { path: '/api/equipment',                  group: 'Equipment' },
  { path: '/api/equipment/categories',       group: 'Equipment' },
  { path: '/api/equipment/objects',          group: 'Equipment' },
  { path: '/api/equipment/warehouses',       group: 'Equipment' },
  { path: '/api/equipment/available',        group: 'Equipment' },
  { path: '/api/equipment/stats/summary',    group: 'Equipment' },
  { path: '/api/equipment/requests',         group: 'Equipment' },
  { path: '/api/equipment/maintenance/upcoming', group: 'Equipment' },
  // Cash
  { path: '/api/cash/my',                    group: 'Cash' },
  { path: '/api/cash/all',                   group: 'Cash' },
  { path: '/api/cash/summary',              group: 'Cash' },
  { path: '/api/cash/my-balance',            group: 'Cash' },
  // Meetings
  { path: '/api/meetings',                   group: 'Meetings' },
  { path: '/api/meetings/upcoming',          group: 'Meetings' },
  { path: '/api/meetings/stats',             group: 'Meetings' },
  // Payroll
  { path: '/api/payroll/sheets',             group: 'Payroll' },
  { path: '/api/payroll/items',              group: 'Payroll' },
  { path: '/api/payroll/rates',              group: 'Payroll' },
  { path: '/api/payroll/rates/current',      group: 'Payroll' },
  { path: '/api/payroll/self-employed',      group: 'Payroll' },
  { path: '/api/payroll/one-time',           group: 'Payroll' },
  { path: '/api/payroll/payments',           group: 'Payroll' },
  { path: '/api/payroll/stats',              group: 'Payroll' },
  // Permit applications
  { path: '/api/permit-applications',             group: 'Permit Applications' },
  { path: '/api/permit-applications/types',        group: 'Permit Applications' },
  { path: '/api/permit-applications/contractors',  group: 'Permit Applications' },
  // TKP
  { path: '/api/tkp',                        group: 'TKP' },
  // Pass requests
  { path: '/api/pass-requests',              group: 'Pass Requests' },
  // TMC requests
  { path: '/api/tmc-requests',               group: 'TMC Requests' },
  // Sites
  { path: '/api/sites',                      group: 'Sites' },
  // Chat groups
  { path: '/api/chat-groups',                group: 'Chat Groups' },
  // Mailbox
  { path: '/api/mailbox',                    group: 'Mailbox' },
  // Mimir
  { path: '/api/mimir',                      group: 'Mimir' },
  // Geo
  { path: '/api/geo/config',                 group: 'Geo' },
  // Email
  { path: '/api/email/accounts',             group: 'Email' },
  // Data export
  { path: '/api/data/tenders?limit=1',       group: 'Data' },
  { path: '/api/data/works?limit=1',         group: 'Data' },
  { path: '/api/data/estimates?limit=1',     group: 'Data' },
  // Integrations
  { path: '/api/integrations',               group: 'Integrations' },
];

// ── Role-specific endpoint subsets (5 endpoints per role) ──
const ROLE_ENDPOINTS = {
  ADMIN: [
    '/api/users',
    '/api/settings',
    '/api/tenders',
    '/api/payroll/sheets',
    '/api/equipment',
  ],
  PM: [
    '/api/tenders',
    '/api/works',
    '/api/invoices',
    '/api/tasks/my',
    '/api/customers',
  ],
  TO: [
    '/api/works',
    '/api/estimates',
    '/api/equipment',
    '/api/tasks/my',
    '/api/permits',
  ],
  HEAD_PM: [
    '/api/tenders',
    '/api/works/analytics/team',
    '/api/invoices',
    '/api/tasks/created',
    '/api/reports',
  ],
  HEAD_TO: [
    '/api/works',
    '/api/equipment',
    '/api/permits',
    '/api/staff/employees',
    '/api/tasks/my',
  ],
  HR: [
    '/api/staff/employees',
    '/api/staff/schedule',
    '/api/calendar',
    '/api/notifications',
    '/api/tasks/my',
  ],
  HR_MANAGER: [
    '/api/staff/employees',
    '/api/staff/schedule',
    '/api/payroll/sheets',
    '/api/users',
    '/api/tasks/my',
  ],
  BUH: [
    '/api/invoices',
    '/api/incomes',
    '/api/expenses/work',
    '/api/acts',
    '/api/payroll/payments',
  ],
  PROC: [
    '/api/tenders',
    '/api/estimates',
    '/api/tkp',
    '/api/tmc-requests',
    '/api/customers',
  ],
  OFFICE_MANAGER: [
    '/api/expenses/office',
    '/api/calendar',
    '/api/meetings',
    '/api/notifications',
    '/api/tasks/my',
  ],
  CHIEF_ENGINEER: [
    '/api/permits',
    '/api/equipment',
    '/api/works',
    '/api/sites',
    '/api/staff/employees',
  ],
  DIRECTOR_GEN: [
    '/api/tenders',
    '/api/reports',
    '/api/payroll/stats',
    '/api/cash/all',
    '/api/acts/stats/summary',
  ],
  DIRECTOR_COMM: [
    '/api/tenders',
    '/api/customers',
    '/api/invoices',
    '/api/meetings',
    '/api/incomes',
  ],
  DIRECTOR_DEV: [
    '/api/works',
    '/api/estimates',
    '/api/tenders',
    '/api/equipment',
    '/api/sites',
  ],
  WAREHOUSE: [
    '/api/equipment',
    '/api/equipment/categories',
    '/api/equipment/warehouses',
    '/api/equipment/requests',
    '/api/tasks/my',
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// Build test suite
// ═══════════════════════════════════════════════════════════════════════════

const tests = [];

// ── Part 1: All endpoints as ADMIN (75 tests) ──

for (const ep of ADMIN_ENDPOINTS) {
  tests.push({
    name: `SMOKE ADMIN: GET ${ep.path} — no 5xx [${ep.group}]`,
    run: async () => {
      const resp = await api('GET', ep.path, { role: 'ADMIN' });
      assertNo5xx(resp, `GET ${ep.path} as ADMIN`);
    }
  });
}

// ── Part 2: Role-based smoke (15 roles x 5 endpoints = 15 tests, grouped) ──

for (const [role, endpoints] of Object.entries(ROLE_ENDPOINTS)) {
  tests.push({
    name: `SMOKE ROLE ${role}: 5 key endpoints — no 5xx`,
    run: async () => {
      const errors = [];
      for (const path of endpoints) {
        const resp = await api('GET', path, { role });
        if (resp.status >= 500) {
          errors.push(`GET ${path} as ${role} returned ${resp.status}`);
        }
      }
      assert(errors.length === 0, `5xx errors for ${role}:\n  ${errors.join('\n  ')}`);
    }
  });
}

module.exports = {
  name: 'SMOKE ALL PAGES (API endpoints \u00d7 roles)',
  tests
};
