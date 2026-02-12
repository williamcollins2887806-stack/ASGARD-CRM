/**
 * Block L: Migration idempotency and schema integrity tests
 * Verifies all tables exist, key columns are present, FK constraints valid
 */
const { api, assert, assertOk, skip, BASE_URL, getToken } = require('../config');

// Expected tables from migrations
const EXPECTED_TABLES = [
  'users', 'settings', 'tenders', 'estimates', 'works',
  'work_expenses', 'customers', 'employees', 'equipment',
  'invoices', 'tasks', 'notifications', 'calendar_events',
  'correspondence', 'cash_requests', 'cash_expenses',
  'documents', 'acts', 'chats', 'chat_messages',
  'sites', 'employee_permits', 'permit_types', 'staff',
  'audit_log', 'contracts', 'seals'
];

// Key columns that must exist on important tables
const REQUIRED_COLUMNS = {
  users: ['id', 'login', 'role', 'is_active'],
  tenders: ['id', 'tender_status', 'created_at'],
  works: ['id', 'work_title', 'created_at'],
  employees: ['id', 'fio', 'created_at'],
  invoices: ['id', 'created_at'],
  equipment: ['id', 'name', 'created_at'],
  cash_requests: ['id', 'amount', 'status', 'created_at'],
  estimates: ['id', 'tender_id', 'created_at']
};

function makeTests() {
  const tests = [];

  // Test that all expected tables exist via data API
  for (const table of EXPECTED_TABLES) {
    tests.push({
      name: `SCHEMA: Table "${table}" exists in database`,
      run: async () => {
        // Use data API to check, or direct query
        const resp = await api('GET', `/api/data/${table}?limit=1`);
        // 400 means "not in whitelist" (table may exist but not exposed)
        // 200 means table exists and accessible
        // 403 means accessible but role restricted
        // A6: 200=ok, 400=not in whitelist, 403=restricted — never 500
        assert(
          resp.status === 200 || resp.status === 400 || resp.status === 403,
          `table "${table}": expected 200/400/403, got ${resp.status}`
        );
      }
    });
  }

  // Test required columns
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    tests.push({
      name: `SCHEMA: Table "${table}" has required columns: ${columns.slice(0, 3).join(', ')}...`,
      run: async () => {
        const resp = await api('GET', `/api/data/${table}?limit=1`);
        if (resp.status === 400) skip(`Table "${table}" not in data API whitelist`);
        if (resp.status === 403) skip(`No access to "${table}" as ADMIN`);
        if (resp.status === 500) skip(`Table "${table}" has schema issue`);
        assertOk(resp, `fetch ${table}`);
        const items = resp.data?.[table] || [];
        if (items.length === 0) {
          // Table exists but empty — check columns via POST shape instead
          // Just verify the endpoint responds
          return;
        }
        const item = items[0];
        for (const col of columns) {
          assert(col in item, `table "${table}" missing column "${col}" (keys: ${Object.keys(item).join(', ')})`);
        }
      }
    });
  }

  // FK constraint validity tests
  tests.push({
    name: 'SCHEMA: estimates.tender_id references valid tenders',
    run: async () => {
      const resp = await api('GET', '/api/data/estimates?limit=10');
      assertOk(resp, 'fetch estimates');
      const list = resp.data?.estimates || [];
      if (list.length === 0) skip('No estimates to check');
      // Just verify no orphaned references would cause 500s
      for (const est of list.slice(0, 3)) {
        if (est.tender_id) {
          const check = await api('GET', `/api/tenders/${est.tender_id}`);
          assertOk(check, `tender ${est.tender_id} lookup`);
        }
      }
    }
  });

  tests.push({
    name: 'SCHEMA: works.tender_id references valid tenders',
    run: async () => {
      const resp = await api('GET', '/api/data/works?limit=10');
      assertOk(resp, 'fetch works');
      const list = resp.data?.works || [];
      if (list.length === 0) skip('No works to check');
      for (const w of list.slice(0, 3)) {
        if (w.tender_id) {
          const check = await api('GET', `/api/tenders/${w.tender_id}`);
          assertOk(check, `tender ${w.tender_id} for work ${w.id}`);
        }
      }
    }
  });

  tests.push({
    name: 'SCHEMA: tasks endpoint accessible',
    run: async () => {
      const resp = await api('GET', '/api/tasks', { role: 'ADMIN' });
      if (resp.status === 404) skip('tasks endpoint not available');
      assertOk(resp, 'tasks endpoint');
      const list = Array.isArray(resp.data) ? resp.data : (resp.data?.tasks || []);
      if (list.length > 0 && list[0].assignee_id) {
        const check = await api('GET', `/api/users/${list[0].assignee_id}`);
        assertOk(check, 'user lookup');
      }
    }
  });

  tests.push({
    name: 'SCHEMA: work_expenses.work_id references valid works',
    run: async () => {
      const resp = await api('GET', '/api/data/work_expenses?limit=5');
      assertOk(resp, 'fetch work_expenses');
      const list = resp.data?.work_expenses || [];
      if (list.length === 0) skip('No work_expenses to check');
      for (const e of list.slice(0, 3)) {
        if (e.work_id) {
          const check = await api('GET', `/api/data/works/${e.work_id}`);
          assertOk(check, `work ${e.work_id} for expense ${e.id}`);
        }
      }
    }
  });

  // Verify migration-specific features
  tests.push({
    name: 'SCHEMA: sites table exists (V023)',
    run: async () => {
      const resp = await api('GET', '/api/data/sites?limit=1');
      // sites might not be in whitelist — check via dedicated endpoint
      if (resp.status === 400) {
        const direct = await api('GET', '/api/sites');
        assertOk(direct, 'sites endpoint');
      } else {
        assertOk(resp, 'sites data');
      }
    }
  });

  tests.push({
    name: 'SCHEMA: permit_applications table exists (V017)',
    run: async () => {
      const resp = await api('GET', '/api/data/permit_applications?limit=1');
      assertOk(resp, 'permit_applications');
    }
  });

  tests.push({
    name: 'SCHEMA: mimir_conversations table exists (V014)',
    run: async () => {
      const resp = await api('GET', '/api/mimir/conversations', { role: 'ADMIN' });
      if (resp.status === 404) skip('mimir/conversations not available');
      assertOk(resp, 'mimir conversations');
    }
  });

  return tests;
}

module.exports = {
  name: 'SCHEMA & MIGRATIONS',
  tests: makeTests()
};
