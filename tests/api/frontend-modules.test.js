/**
 * FRONTEND MODULES — Tests for all frontend-facing module endpoints
 */
const { api, assert, assertOk, assertForbidden, assertArray, skip } = require('../config');

module.exports = {
  name: 'FRONTEND MODULES (Модули фронтенда)',
  tests: [
    // ── Auth module ──
    {
      name: 'Auth: GET /me returns user data',
      run: async () => {
        const resp = await api('GET', '/api/auth/me', { role: 'ADMIN' });
        assertOk(resp, '/me');
        assert(resp.data?.id || resp.data?.user?.id, 'user id exists');
      }
    },
    // ── Users module ──
    {
      name: 'Users: list endpoint',
      run: async () => {
        const resp = await api('GET', '/api/users', { role: 'ADMIN' });
        assertOk(resp, 'users list');
      }
    },
    {
      name: 'Users: roles list',
      run: async () => {
        const resp = await api('GET', '/api/users/roles/list', { role: 'ADMIN' });
        assertOk(resp, 'roles list');
      }
    },
    // ── Tenders module ──
    {
      name: 'Tenders: list endpoint',
      run: async () => {
        const resp = await api('GET', '/api/tenders', { role: 'ADMIN' });
        assertOk(resp, 'tenders');
      }
    },
    {
      name: 'Tenders: stats summary',
      run: async () => {
        const resp = await api('GET', '/api/tenders/stats/summary', { role: 'ADMIN' });
        assertOk(resp, 'tenders stats');
      }
    },
    // ── Pre-tenders module ──
    {
      name: 'Pre-tenders: list endpoint',
      run: async () => {
        const resp = await api('GET', '/api/pre-tenders', { role: 'ADMIN' });
        assertOk(resp, 'pre-tenders');
      }
    },
    {
      name: 'Pre-tenders: stats',
      run: async () => {
        const resp = await api('GET', '/api/pre-tenders/stats', { role: 'ADMIN' });
        assertOk(resp, 'pre-tenders stats');
      }
    },
    // ── Works module ──
    {
      name: 'Works: list endpoint',
      run: async () => {
        const resp = await api('GET', '/api/works', { role: 'ADMIN' });
        assertOk(resp, 'works');
      }
    },
    // ── Estimates module ──
    {
      name: 'Estimates: list endpoint',
      run: async () => {
        const resp = await api('GET', '/api/estimates', { role: 'ADMIN' });
        assertOk(resp, 'estimates');
      }
    },
    // ── Customers module ──
    {
      name: 'Customers: list endpoint',
      run: async () => {
        const resp = await api('GET', '/api/customers', { role: 'ADMIN' });
        assertOk(resp, 'customers');
      }
    },
    // ── Tasks module ──
    {
      name: 'Tasks: my tasks',
      run: async () => {
        const resp = await api('GET', '/api/tasks/my', { role: 'ADMIN' });
        assertOk(resp, 'my tasks');
      }
    },
    {
      name: 'Tasks: created tasks',
      run: async () => {
        const resp = await api('GET', '/api/tasks/created', { role: 'ADMIN' });
        assertOk(resp, 'created tasks');
      }
    },
    {
      name: 'Tasks: stats',
      run: async () => {
        const resp = await api('GET', '/api/tasks/stats', { role: 'ADMIN' });
        assertOk(resp, 'tasks stats');
      }
    },
    {
      name: 'Tasks: todo list',
      run: async () => {
        const resp = await api('GET', '/api/tasks/todo', { role: 'ADMIN' });
        assertOk(resp, 'todo');
      }
    },
    // ── Calendar module ──
    {
      name: 'Calendar: list events',
      run: async () => {
        const resp = await api('GET', '/api/calendar', { role: 'ADMIN' });
        assertOk(resp, 'calendar');
      }
    },
    // ── Staff module ──
    {
      name: 'Staff: employees list',
      run: async () => {
        const resp = await api('GET', '/api/staff/employees', { role: 'ADMIN' });
        assertOk(resp, 'employees');
      }
    },
    {
      name: 'Staff: schedule',
      run: async () => {
        const resp = await api('GET', '/api/staff/schedule', { role: 'ADMIN' });
        assertOk(resp, 'schedule');
      }
    },
    // ── Notifications module ──
    {
      name: 'Notifications: list',
      run: async () => {
        const resp = await api('GET', '/api/notifications', { role: 'ADMIN' });
        assertOk(resp, 'notifications');
      }
    },
    // ── Settings module ──
    {
      name: 'Settings: get settings',
      run: async () => {
        const resp = await api('GET', '/api/settings', { role: 'ADMIN' });
        assertOk(resp, 'settings');
      }
    },
    // ── Permissions module ──
    {
      name: 'Permissions: modules list',
      run: async () => {
        const resp = await api('GET', '/api/permissions/modules', { role: 'ADMIN' });
        assert(resp.status < 500, `permissions modules should not 5xx, got ${resp.status}`);
      }
    },
    {
      name: 'Permissions: role presets',
      run: async () => {
        const resp = await api('GET', '/api/permissions/presets', { role: 'ADMIN' });
        assert(resp.status < 500, `presets should not 5xx, got ${resp.status}`);
      }
    },
    // ── Invoices module ──
    {
      name: 'Invoices: list',
      run: async () => {
        const resp = await api('GET', '/api/invoices', { role: 'ADMIN' });
        assertOk(resp, 'invoices');
      }
    },
    {
      name: 'Invoices: overdue',
      run: async () => {
        const resp = await api('GET', '/api/invoices/overdue/list', { role: 'ADMIN' });
        assertOk(resp, 'invoices overdue');
      }
    },
    // ── Acts module ──
    {
      name: 'Acts: list',
      run: async () => {
        const resp = await api('GET', '/api/acts', { role: 'ADMIN' });
        assertOk(resp, 'acts');
      }
    },
    // ── Incomes module ──
    {
      name: 'Incomes: list',
      run: async () => {
        const resp = await api('GET', '/api/incomes', { role: 'ADMIN' });
        assertOk(resp, 'incomes');
      }
    },
    // ── Expenses module ──
    {
      name: 'Expenses: work expenses',
      run: async () => {
        const resp = await api('GET', '/api/expenses/work', { role: 'ADMIN' });
        assertOk(resp, 'work expenses');
      }
    },
    {
      name: 'Expenses: office expenses',
      run: async () => {
        const resp = await api('GET', '/api/expenses/office', { role: 'ADMIN' });
        assertOk(resp, 'office expenses');
      }
    },
    // ── Equipment module ──
    {
      name: 'Equipment: list',
      run: async () => {
        const resp = await api('GET', '/api/equipment', { role: 'ADMIN' });
        assertOk(resp, 'equipment');
      }
    },
    {
      name: 'Equipment: categories',
      run: async () => {
        const resp = await api('GET', '/api/equipment/categories', { role: 'ADMIN' });
        assertOk(resp, 'equipment categories');
      }
    },
    // ── Permits module ──
    {
      name: 'Permits: list',
      run: async () => {
        const resp = await api('GET', '/api/permits', { role: 'ADMIN' });
        assertOk(resp, 'permits');
      }
    },
    {
      name: 'Permits: types',
      run: async () => {
        const resp = await api('GET', '/api/permits/types', { role: 'ADMIN' });
        assertOk(resp, 'permit types');
      }
    },
    {
      name: 'Permits: matrix',
      run: async () => {
        const resp = await api('GET', '/api/permits/matrix', { role: 'ADMIN' });
        assertOk(resp, 'permit matrix');
      }
    },
    // ── Cash module ──
    {
      name: 'Cash: my balance',
      run: async () => {
        const resp = await api('GET', '/api/cash/my-balance', { role: 'ADMIN' });
        assertOk(resp, 'cash balance');
      }
    },
    // ── Meetings module ──
    {
      name: 'Meetings: list',
      run: async () => {
        const resp = await api('GET', '/api/meetings', { role: 'ADMIN' });
        assertOk(resp, 'meetings');
      }
    },
    // ── Payroll module ──
    {
      name: 'Payroll: sheets',
      run: async () => {
        const resp = await api('GET', '/api/payroll/sheets', { role: 'ADMIN' });
        assertOk(resp, 'payroll sheets');
      }
    },
    // ── Permit applications module ──
    {
      name: 'Permit applications: list',
      run: async () => {
        const resp = await api('GET', '/api/permit-applications', { role: 'ADMIN' });
        assertOk(resp, 'permit applications');
      }
    },
    {
      name: 'Permit applications: types',
      run: async () => {
        const resp = await api('GET', '/api/permit-applications/types', { role: 'ADMIN' });
        assertOk(resp, 'permit app types');
      }
    },
    // ── TKP module ──
    {
      name: 'TKP: list',
      run: async () => {
        const resp = await api('GET', '/api/tkp', { role: 'ADMIN' });
        assertOk(resp, 'tkp');
      }
    },
    // ── Pass requests module ──
    {
      name: 'Pass requests: list',
      run: async () => {
        const resp = await api('GET', '/api/pass-requests', { role: 'ADMIN' });
        assertOk(resp, 'pass requests');
      }
    },
    // ── TMC requests module ──
    {
      name: 'TMC requests: list',
      run: async () => {
        const resp = await api('GET', '/api/tmc-requests', { role: 'ADMIN' });
        assertOk(resp, 'tmc requests');
      }
    },
    // ── Sites module ──
    {
      name: 'Sites: list',
      run: async () => {
        const resp = await api('GET', '/api/sites', { role: 'ADMIN' });
        assertOk(resp, 'sites');
      }
    },
    // ── Email module ──
    {
      name: 'Email: accounts',
      run: async () => {
        const resp = await api('GET', '/api/email/accounts', { role: 'ADMIN' });
        assert(resp.status < 500, `email accounts should not 5xx, got ${resp.status}`);
      }
    },
    // ── Mailbox module ──
    {
      name: 'Mailbox: list',
      run: async () => {
        const resp = await api('GET', '/api/mailbox', { role: 'ADMIN' });
        assert(resp.status < 500, `mailbox should not 5xx, got ${resp.status}`);
      }
    },
    // ── Mimir module ──
    {
      name: 'Mimir: knowledge base',
      run: async () => {
        const resp = await api('GET', '/api/mimir', { role: 'ADMIN' });
        assert(resp.status < 500, `mimir should not 5xx, got ${resp.status}`);
      }
    },
    // ── Geo module ──
    {
      name: 'Geo: config',
      run: async () => {
        const resp = await api('GET', '/api/geo/config', { role: 'ADMIN' });
        assert(resp.status < 500, `geo config should not 5xx, got ${resp.status}`);
      }
    },
    // ── Chat groups module ──
    {
      name: 'Chat groups: list',
      run: async () => {
        const resp = await api('GET', '/api/chat-groups', { role: 'ADMIN' });
        assert(resp.status < 500, `chat groups should not 5xx, got ${resp.status}`);
      }
    },
    // ── Inbox applications ──
    {
      name: 'Inbox applications: list',
      run: async () => {
        const resp = await api('GET', '/api/inbox-applications', { role: 'ADMIN' });
        assert(resp.status < 500, `inbox apps should not 5xx, got ${resp.status}`);
      }
    },
    // ── Integrations module ──
    {
      name: 'Integrations: list',
      run: async () => {
        const resp = await api('GET', '/api/integrations', { role: 'ADMIN' });
        assert(resp.status < 500, `integrations should not 5xx, got ${resp.status}`);
      }
    },
    // ── Reports module ──
    {
      name: 'Reports: main endpoint',
      run: async () => {
        const resp = await api('GET', '/api/reports', { role: 'ADMIN' });
        assert(resp.status < 500, `reports should not 5xx, got ${resp.status}`);
      }
    },
    // ── Health ──
    {
      name: 'Health check endpoint',
      run: async () => {
        const resp = await api('GET', '/api/health', { role: 'ADMIN' });
        assertOk(resp, 'health check');
      }
    }
  ]
};
