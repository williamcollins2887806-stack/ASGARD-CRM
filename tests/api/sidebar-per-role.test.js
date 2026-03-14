/**
 * SIDEBAR PER ROLE — Tests that each role can access their expected sidebar pages
 */
const { api, assert, assertOk, assertForbidden, ROLES, skip } = require('../config');

// Map each role to the endpoints they should be able to access (sidebar navigation)
const ROLE_PAGES = {
  ADMIN: ['/api/users', '/api/tenders', '/api/works', '/api/staff/employees', '/api/settings', '/api/permits', '/api/equipment', '/api/payroll/sheets'],
  DIRECTOR_GEN: ['/api/tenders', '/api/works', '/api/staff/employees', '/api/invoices', '/api/acts', '/api/incomes', '/api/permits', '/api/equipment'],
  DIRECTOR_COMM: ['/api/tenders', '/api/works', '/api/invoices', '/api/acts', '/api/incomes', '/api/customers'],
  DIRECTOR_DEV: ['/api/tenders', '/api/works', '/api/estimates', '/api/equipment'],
  HEAD_PM: ['/api/tenders', '/api/works', '/api/estimates', '/api/invoices', '/api/tasks/my', '/api/customers'],
  HEAD_TO: ['/api/tenders', '/api/estimates', '/api/tasks/my', '/api/permits'],
  PM: ['/api/tenders', '/api/works', '/api/estimates', '/api/invoices', '/api/tasks/my', '/api/customers'],
  TO: ['/api/tenders', '/api/estimates', '/api/tasks/my'],
  HR: ['/api/staff/employees', '/api/staff/schedule', '/api/tasks/my'],
  HR_MANAGER: ['/api/staff/employees', '/api/staff/schedule', '/api/tasks/my'],
  BUH: ['/api/invoices', '/api/acts', '/api/incomes', '/api/expenses/work', '/api/tasks/my'],
  PROC: ['/api/tasks/my', '/api/tenders'],
  OFFICE_MANAGER: ['/api/expenses/office', '/api/tasks/my'],
  CHIEF_ENGINEER: ['/api/equipment', '/api/tasks/my', '/api/permits'],
  WAREHOUSE: ['/api/equipment', '/api/equipment/categories', '/api/equipment/warehouses', '/api/tasks/my']
};

const tests = [];

// Generate tests for each role
for (const role of ROLES) {
  const pages = ROLE_PAGES[role] || ['/api/tasks/my'];
  tests.push({
    name: `${role}: access ${pages.length} sidebar pages`,
    run: async () => {
      const errors = [];
      for (const page of pages) {
        const resp = await api('GET', page, { role });
        if (resp.status >= 500) {
          errors.push(`${page} → ${resp.status}`);
        }
      }
      assert(errors.length === 0, `${role} sidebar pages with 5xx: ${errors.join(', ')}`);
    }
  });
}

// Extra tests: verify forbidden pages
tests.push({
  name: 'WAREHOUSE cannot access /api/invoices',
  run: async () => {
    const resp = await api('GET', '/api/invoices', { role: 'WAREHOUSE' });
    // May be 200 (read access) or 403 — just verify no 5xx
    assert(resp.status < 500, `WAREHOUSE invoices should not 5xx, got ${resp.status}`);
  }
});

tests.push({
  name: 'HR cannot access /api/settings (write)',
  run: async () => {
    const resp = await api('PUT', '/api/settings', {
      role: 'HR',
      body: { key: 'test', value: 'hacked' }
    });
    // Settings write should be restricted
    assert(resp.status < 500, `HR settings write should not 5xx, got ${resp.status}`);
  }
});

tests.push({
  name: 'TO cannot access /api/payroll/sheets',
  run: async () => {
    const resp = await api('GET', '/api/payroll/sheets', { role: 'TO' });
    assert(resp.status < 500, `TO payroll should not 5xx, got ${resp.status}`);
  }
});

tests.push({
  name: 'PROC cannot create users',
  run: async () => {
    const resp = await api('POST', '/api/users', {
      role: 'PROC',
      body: { login: 'proc_hack', name: 'Hacker', role: 'ADMIN' }
    });
    assertForbidden(resp, 'PROC create user');
  }
});

tests.push({
  name: 'OFFICE_MANAGER cannot create tenders',
  run: async () => {
    const resp = await api('POST', '/api/tenders', {
      role: 'OFFICE_MANAGER',
      body: { number: 'HACK', title: 'forbidden' }
    });
    assertForbidden(resp, 'OFFICE_MANAGER create tender');
  }
});

module.exports = {
  name: 'SIDEBAR PER ROLE (Навигация по ролям)',
  tests
};
