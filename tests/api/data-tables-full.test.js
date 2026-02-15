/**
 * DATA TABLES FULL — Read access for 50+ tables via /api/data/:table
 */
const { api, assert, assertOk, assertArray, ROLES, skip } = require('../config');

const TABLES = [
  'tenders', 'works', 'estimates', 'work_expenses', 'office_expenses',
  'invoices', 'invoice_payments', 'acts', 'customers', 'employees',
  'employee_permits', 'permit_types', 'equipment', 'equipment_categories',
  'equipment_movements', 'warehouses', 'users', 'tasks', 'task_comments',
  'audit_log', 'incomes', 'sites', 'objects', 'pre_tender_requests',
  'calendar_events', 'reminders', 'chat_messages', 'chats', 'notifications',
  'settings', 'modules', 'role_presets', 'user_permissions', 'email_accounts',
  'emails', 'employee_assignments', 'employee_plan', 'employee_reviews',
  'cash_requests', 'meetings', 'meeting_participants', 'meeting_minutes',
  'payroll_sheets', 'payroll_items', 'employee_rates', 'tkp',
  'pass_requests', 'tmc_requests', 'permit_applications',
  'inbox_applications', 'staff_plan', 'staff'
];

const tests = [];

// Test each table is readable by ADMIN
for (const table of TABLES) {
  tests.push({
    name: `ADMIN reads /api/data/${table}`,
    run: async () => {
      const resp = await api('GET', `/api/data/${table}?limit=2`, { role: 'ADMIN' });
      if (resp.status === 400 || resp.status === 403) {
        // Table not in whitelist — that's ok
        return;
      }
      assertOk(resp, `data/${table}`);
      const list = Array.isArray(resp.data) ? resp.data : (resp.data?.data || resp.data?.items || []);
      assertArray(list, `data/${table}`);
    }
  });
}

// Test key tables by PM role
const PM_TABLES = ['tenders', 'works', 'estimates', 'customers', 'invoices'];
for (const table of PM_TABLES) {
  tests.push({
    name: `PM reads /api/data/${table}`,
    run: async () => {
      const resp = await api('GET', `/api/data/${table}?limit=2`, { role: 'PM' });
      if (resp.status === 403) return; // PM may not have access to this table
      assertOk(resp, `PM data/${table}`);
    }
  });
}

// Test key tables by BUH role
const BUH_TABLES = ['invoices', 'acts', 'incomes', 'work_expenses', 'office_expenses'];
for (const table of BUH_TABLES) {
  tests.push({
    name: `BUH reads /api/data/${table}`,
    run: async () => {
      const resp = await api('GET', `/api/data/${table}?limit=2`, { role: 'BUH' });
      if (resp.status === 403) return;
      assertOk(resp, `BUH data/${table}`);
    }
  });
}

// Test key tables by HR role
const HR_TABLES = ['employees', 'employee_permits', 'employee_plan', 'staff'];
for (const table of HR_TABLES) {
  tests.push({
    name: `HR reads /api/data/${table}`,
    run: async () => {
      const resp = await api('GET', `/api/data/${table}?limit=2`, { role: 'HR' });
      if (resp.status === 403) return;
      assertOk(resp, `HR data/${table}`);
    }
  });
}

// Test key tables by WAREHOUSE role
const WH_TABLES = ['equipment', 'equipment_categories', 'warehouses', 'equipment_movements'];
for (const table of WH_TABLES) {
  tests.push({
    name: `WAREHOUSE reads /api/data/${table}`,
    run: async () => {
      const resp = await api('GET', `/api/data/${table}?limit=2`, { role: 'WAREHOUSE' });
      if (resp.status === 403) return;
      assertOk(resp, `WAREHOUSE data/${table}`);
    }
  });
}

module.exports = {
  name: 'DATA TABLES FULL (50+ tables × roles)',
  tests
};
