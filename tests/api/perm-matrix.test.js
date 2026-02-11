/**
 * PERMISSIONS MATRIX — Role × Table access via /api/data/:table
 * Tests READ and WRITE access for each role against critical tables
 */
const { api, assert, assertForbidden, assertOk, skip } = require('../config');

// ─── Access matrix from data.js ───
const ROLE_TABLES = {
  PM: {
    read: ['users', 'employees', 'works', 'tenders', 'staff_plan', 'invoices', 'estimates', 'correspondence', 'contracts', 'equipment'],
    write: ['works', 'tenders', 'staff_plan', 'estimates', 'correspondence', 'contracts'],
    noRead: ['audit_log'],
    noWrite: ['users', 'audit_log', 'purchase_requests', 'seals']
  },
  TO: {
    read: ['users', 'employees', 'works', 'tenders', 'invoices', 'estimates', 'customers', 'correspondence'],
    write: ['tenders', 'estimates', 'customers', 'correspondence'],
    noRead: ['audit_log'],
    noWrite: ['users', 'audit_log', 'staff_plan', 'equipment_maintenance', 'payroll_sheets']
  },
  HR: {
    read: ['users', 'employees', 'works', 'tenders', 'invoices', 'staff', 'staff_plan', 'staff_requests'],
    write: ['employees', 'staff', 'staff_plan', 'staff_requests', 'employee_reviews'],
    noRead: ['audit_log'],
    noWrite: ['users', 'audit_log', 'equipment', 'purchase_requests']
  },
  BUH: {
    read: ['users', 'employees', 'works', 'tenders', 'invoices', 'cash_requests', 'acts', 'bank_rules', 'payroll_sheets'],
    write: ['invoices', 'cash_requests', 'cash_expenses', 'acts', 'bank_rules', 'payroll_sheets'],
    noRead: ['audit_log'],
    noWrite: ['users', 'audit_log', 'equipment', 'purchase_requests']
  },
  OFFICE_MANAGER: {
    read: ['users', 'employees', 'contracts', 'seals', 'correspondence', 'office_expenses', 'documents', 'purchase_requests'],
    write: ['contracts', 'seals', 'correspondence', 'office_expenses', 'documents', 'purchase_requests'],
    noRead: ['audit_log', 'cash_advances'],
    noWrite: ['users', 'audit_log', 'tenders', 'equipment']
  },
  WAREHOUSE: {
    read: ['users', 'equipment', 'equipment_categories', 'equipment_movements', 'equipment_requests', 'equipment_maintenance', 'warehouses', 'objects'],
    write: ['equipment', 'equipment_movements', 'equipment_requests', 'equipment_maintenance', 'warehouses'],
    noRead: ['audit_log', 'cash_advances'],
    noWrite: ['users', 'audit_log', 'tenders', 'invoices']
  },
  PROC: {
    read: ['users', 'purchase_requests', 'equipment', 'invoices', 'documents'],
    write: ['purchase_requests', 'equipment_categories', 'invoices', 'documents'],
    noRead: ['audit_log', 'cash_advances'],
    noWrite: ['users', 'audit_log', 'tenders', 'works', 'staff_plan']
  },
  DIRECTOR_GEN: {
    read: ['users', 'employees', 'works', 'tenders', 'invoices', 'cash_requests', 'audit_log', 'equipment', 'staff_plan'],
    write: ['works', 'tenders', 'invoices', 'cash_requests', 'equipment', 'staff_plan'],
    noRead: [],
    noWrite: []
  },
  ADMIN: {
    read: ['users', 'employees', 'works', 'tenders', 'invoices', 'cash_requests', 'audit_log', 'equipment', 'staff_plan'],
    write: ['works', 'tenders', 'invoices', 'cash_requests', 'equipment', 'staff_plan'],
    noRead: [],
    noWrite: []
  }
};

const tests = [];

// ═══ Generate READ tests ═══
for (const [role, config] of Object.entries(ROLE_TABLES)) {
  // Allowed reads
  for (const table of config.read) {
    tests.push({
      name: `PERM: ${role} can READ ${table}`,
      run: async () => {
        const resp = await api('GET', `/api/data/${table}?limit=1`, { role });
        assert(
          resp.status === 200,
          `${role} should read ${table}, got ${resp.status}`
        );
      }
    });
  }

  // Denied reads
  for (const table of config.noRead) {
    tests.push({
      name: `PERM: ${role} cannot READ ${table}`,
      run: async () => {
        const resp = await api('GET', `/api/data/${table}?limit=1`, { role });
        assertForbidden(resp, `${role} read ${table}`);
      }
    });
  }
}

// ═══ Generate WRITE tests (POST) ═══
for (const [role, config] of Object.entries(ROLE_TABLES)) {
  // Denied writes — most important
  for (const table of config.noWrite) {
    tests.push({
      name: `PERM: ${role} cannot WRITE ${table}`,
      run: async () => {
        const resp = await api('POST', `/api/data/${table}`, {
          role,
          body: { _perm_test: true, name: 'PERM_TEST_' + Date.now() }
        });
        // Should be 403 for denied. Also accept 400 for write-protected tables
        assert(
          resp.status === 403 || resp.status === 401 || resp.status === 400,
          `${role} should NOT write ${table}, got ${resp.status}`
        );
      }
    });
  }
}

module.exports = {
  name: 'PERMISSIONS MATRIX (Role×Table)',
  tests
};
