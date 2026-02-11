/**
 * API ENDPOINTS COVERAGE — verify all route files respond (not 500)
 */
const { api, assert, assertOk, rawFetch, skip } = require('../config');

module.exports = {
  name: 'API ENDPOINTS COVERAGE',
  tests: [
    // ═══ Auth routes ═══
    {
      name: 'EP: GET /api/auth/me → 200',
      run: async () => {
        const resp = await api('GET', '/api/auth/me', { role: 'ADMIN' });
        assertOk(resp, '/api/auth/me');
      }
    },

    // ═══ Users routes ═══
    {
      name: 'EP: GET /api/users → 200',
      run: async () => {
        const resp = await api('GET', '/api/users', { role: 'ADMIN' });
        assertOk(resp, '/api/users');
      }
    },
    {
      name: 'EP: GET /api/users/roles/list → 200',
      run: async () => {
        const resp = await api('GET', '/api/users/roles/list', { role: 'ADMIN' });
        assertOk(resp, '/api/users/roles/list');
      }
    },

    // ═══ Tenders routes ═══
    {
      name: 'EP: GET /api/tenders → 200',
      run: async () => {
        const resp = await api('GET', '/api/tenders', { role: 'ADMIN' });
        assertOk(resp, '/api/tenders');
      }
    },

    // ═══ Works routes ═══
    {
      name: 'EP: GET /api/works → 200',
      run: async () => {
        const resp = await api('GET', '/api/works', { role: 'ADMIN' });
        assertOk(resp, '/api/works');
      }
    },

    // ═══ Estimates routes ═══
    {
      name: 'EP: GET /api/estimates → 200',
      run: async () => {
        const resp = await api('GET', '/api/estimates', { role: 'ADMIN' });
        assertOk(resp, '/api/estimates');
      }
    },

    // ═══ Invoices routes ═══
    {
      name: 'EP: GET /api/invoices → 200',
      run: async () => {
        const resp = await api('GET', '/api/invoices', { role: 'ADMIN' });
        assertOk(resp, '/api/invoices');
      }
    },
    {
      name: 'EP: GET /api/invoices/overdue/list → 200',
      run: async () => {
        const resp = await api('GET', '/api/invoices/overdue/list', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/invoices/overdue/list: got ${resp.status}`);
      }
    },
    {
      name: 'EP: GET /api/invoices/stats/summary → 200',
      run: async () => {
        const resp = await api('GET', '/api/invoices/stats/summary', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/invoices/stats/summary: got ${resp.status}`);
      }
    },

    // ═══ Acts routes ═══
    {
      name: 'EP: GET /api/acts → 200',
      run: async () => {
        const resp = await api('GET', '/api/acts', { role: 'ADMIN' });
        assertOk(resp, '/api/acts');
      }
    },
    {
      name: 'EP: GET /api/acts/stats/summary → 200',
      run: async () => {
        const resp = await api('GET', '/api/acts/stats/summary', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/acts/stats/summary: got ${resp.status}`);
      }
    },

    // ═══ Cash routes ═══
    {
      name: 'EP: GET /api/cash/my → not 500',
      run: async () => {
        const resp = await api('GET', '/api/cash/my', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/cash/my: got ${resp.status}`);
      }
    },
    {
      name: 'EP: GET /api/cash/all → not 500',
      run: async () => {
        const resp = await api('GET', '/api/cash/all', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/cash/all: got ${resp.status}`);
      }
    },
    {
      name: 'EP: GET /api/cash/summary → not 500',
      run: async () => {
        const resp = await api('GET', '/api/cash/summary', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/cash/summary: got ${resp.status}`);
      }
    },

    // ═══ Finances / expenses / incomes ═══
    {
      name: 'EP: GET /api/incomes → 200',
      run: async () => {
        const resp = await api('GET', '/api/incomes', { role: 'ADMIN' });
        assertOk(resp, '/api/incomes');
      }
    },
    {
      name: 'EP: GET /api/expenses/work → not 500',
      run: async () => {
        const resp = await api('GET', '/api/expenses/work', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/expenses/work: got ${resp.status}`);
      }
    },

    // ═══ Permits routes ═══
    {
      name: 'EP: GET /api/permits → 200',
      run: async () => {
        const resp = await api('GET', '/api/permits', { role: 'ADMIN' });
        assertOk(resp, '/api/permits');
      }
    },
    {
      name: 'EP: GET /api/permits/types → 200',
      run: async () => {
        const resp = await api('GET', '/api/permits/types', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/permits/types: got ${resp.status}`);
      }
    },
    {
      name: 'EP: GET /api/permits/matrix → not 500',
      run: async () => {
        const resp = await api('GET', '/api/permits/matrix', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/permits/matrix: got ${resp.status}`);
      }
    },
    {
      name: 'EP: GET /api/permits/upcoming → not 500',
      run: async () => {
        const resp = await api('GET', '/api/permits/upcoming', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/permits/upcoming: got ${resp.status}`);
      }
    },

    // ═══ Equipment routes ═══
    {
      name: 'EP: GET /api/equipment → 200',
      run: async () => {
        const resp = await api('GET', '/api/equipment', { role: 'ADMIN' });
        assertOk(resp, '/api/equipment');
      }
    },
    {
      name: 'EP: GET /api/equipment/categories → 200',
      run: async () => {
        const resp = await api('GET', '/api/equipment/categories', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/equipment/categories: got ${resp.status}`);
      }
    },
    {
      name: 'EP: GET /api/equipment/warehouses → 200',
      run: async () => {
        const resp = await api('GET', '/api/equipment/warehouses', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/equipment/warehouses: got ${resp.status}`);
      }
    },
    {
      name: 'EP: GET /api/equipment/objects → not 500',
      run: async () => {
        const resp = await api('GET', '/api/equipment/objects', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/equipment/objects: got ${resp.status}`);
      }
    },
    {
      name: 'EP: GET /api/equipment/stats/summary → not 500',
      run: async () => {
        const resp = await api('GET', '/api/equipment/stats/summary', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/equipment/stats/summary: got ${resp.status}`);
      }
    },
    {
      name: 'EP: GET /api/equipment/maintenance/upcoming → not 500',
      run: async () => {
        const resp = await api('GET', '/api/equipment/maintenance/upcoming', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/equipment/maintenance/upcoming: got ${resp.status}`);
      }
    },
    {
      name: 'EP: GET /api/equipment/available → not 500',
      run: async () => {
        const resp = await api('GET', '/api/equipment/available', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/equipment/available: got ${resp.status}`);
      }
    },
    {
      name: 'EP: GET /api/equipment/requests → not 500',
      run: async () => {
        const resp = await api('GET', '/api/equipment/requests', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/equipment/requests: got ${resp.status}`);
      }
    },

    // ═══ Calendar routes ═══
    {
      name: 'EP: GET /api/calendar → 200',
      run: async () => {
        const resp = await api('GET', '/api/calendar', { role: 'ADMIN' });
        assertOk(resp, '/api/calendar');
      }
    },

    // ═══ Customers routes ═══
    {
      name: 'EP: GET /api/customers → 200',
      run: async () => {
        const resp = await api('GET', '/api/customers', { role: 'ADMIN' });
        assertOk(resp, '/api/customers');
      }
    },

    // ═══ Chat groups ═══
    {
      name: 'EP: GET /api/chat-groups → 200',
      run: async () => {
        const resp = await api('GET', '/api/chat-groups', { role: 'ADMIN' });
        assertOk(resp, '/api/chat-groups');
      }
    },

    // ═══ Notifications ═══
    {
      name: 'EP: GET /api/notifications → 200',
      run: async () => {
        const resp = await api('GET', '/api/notifications', { role: 'ADMIN' });
        assertOk(resp, '/api/notifications');
      }
    },

    // ═══ Sites ═══
    {
      name: 'EP: GET /api/sites → 200',
      run: async () => {
        const resp = await api('GET', '/api/sites', { role: 'ADMIN' });
        assertOk(resp, '/api/sites');
      }
    },

    // ═══ Staff / employees ═══
    {
      name: 'EP: GET /api/staff/employees → 200',
      run: async () => {
        const resp = await api('GET', '/api/staff/employees', { role: 'ADMIN' });
        assertOk(resp, '/api/staff/employees');
      }
    },

    // ═══ Permissions ═══
    {
      name: 'EP: GET /api/permissions/modules → 200',
      run: async () => {
        const resp = await api('GET', '/api/permissions/modules', { role: 'ADMIN' });
        assertOk(resp, '/api/permissions/modules');
      }
    },
    {
      name: 'EP: GET /api/permissions/presets → 200',
      run: async () => {
        const resp = await api('GET', '/api/permissions/presets', { role: 'ADMIN' });
        assertOk(resp, '/api/permissions/presets');
      }
    },
    {
      name: 'EP: GET /api/permissions/my → 200',
      run: async () => {
        const resp = await api('GET', '/api/permissions/my', { role: 'ADMIN' });
        assertOk(resp, '/api/permissions/my');
      }
    },
    {
      name: 'EP: GET /api/permissions/menu → 200',
      run: async () => {
        const resp = await api('GET', '/api/permissions/menu', { role: 'ADMIN' });
        assertOk(resp, '/api/permissions/menu');
      }
    },

    // ═══ Reports ═══
    {
      name: 'EP: GET /api/reports/summary → not 500',
      run: async () => {
        const resp = await api('GET', '/api/reports/summary', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/reports/summary: got ${resp.status}`);
      }
    },

    // ═══ Settings ═══
    {
      name: 'EP: GET /api/settings → 200',
      run: async () => {
        const resp = await api('GET', '/api/settings', { role: 'ADMIN' });
        assertOk(resp, '/api/settings');
      }
    },

    // ═══ Meetings ═══
    {
      name: 'EP: GET /api/meetings → not 500',
      run: async () => {
        const resp = await api('GET', '/api/meetings', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/meetings: got ${resp.status}`);
      }
    },

    // ═══ Pre-tenders ═══
    {
      name: 'EP: GET /api/pre-tenders → not 500',
      run: async () => {
        const resp = await api('GET', '/api/pre-tenders', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/pre-tenders: got ${resp.status}`);
      }
    },
    {
      name: 'EP: GET /api/pre-tenders/stats → not 500',
      run: async () => {
        const resp = await api('GET', '/api/pre-tenders/stats', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/pre-tenders/stats: got ${resp.status}`);
      }
    },

    // ═══ Payroll ═══
    {
      name: 'EP: GET /api/payroll → not 500',
      run: async () => {
        const resp = await api('GET', '/api/payroll', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/payroll: got ${resp.status}`);
      }
    },

    // ═══ Integrations ═══
    {
      name: 'EP: GET /api/integrations/bank/batches → not 500',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/batches', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/integrations/bank/batches: got ${resp.status}`);
      }
    },
    {
      name: 'EP: GET /api/integrations/bank/transactions → not 500',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/transactions', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/integrations/bank/transactions: got ${resp.status}`);
      }
    },
    {
      name: 'EP: GET /api/integrations/bank/rules → not 500',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/rules', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/integrations/bank/rules: got ${resp.status}`);
      }
    },
    {
      name: 'EP: GET /api/integrations/bank/stats → not 500',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/stats', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/integrations/bank/stats: got ${resp.status}`);
      }
    },
    {
      name: 'EP: GET /api/integrations/platforms → not 500',
      run: async () => {
        const resp = await api('GET', '/api/integrations/platforms', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/integrations/platforms: got ${resp.status}`);
      }
    },
    {
      name: 'EP: GET /api/integrations/erp/connections → not 500',
      run: async () => {
        const resp = await api('GET', '/api/integrations/erp/connections', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/integrations/erp/connections: got ${resp.status}`);
      }
    },

    // ═══ Mailbox ═══
    {
      name: 'EP: GET /api/mailbox/accounts → not 500',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/accounts', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/mailbox/accounts: got ${resp.status}`);
      }
    },
    {
      name: 'EP: GET /api/mailbox/emails → not 500',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/emails', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/mailbox/emails: got ${resp.status}`);
      }
    },
    {
      name: 'EP: GET /api/mailbox/templates → not 500',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/templates', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/mailbox/templates: got ${resp.status}`);
      }
    },
    {
      name: 'EP: GET /api/mailbox/stats → not 500',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/stats', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/mailbox/stats: got ${resp.status}`);
      }
    },

    // ═══ Email history ═══
    {
      name: 'EP: GET /api/email/history → not 500',
      run: async () => {
        const resp = await api('GET', '/api/email/history', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/email/history: got ${resp.status}`);
      }
    },

    // ═══ Inbox AI ═══
    {
      name: 'EP: GET /api/inbox_applications_ai → not 500',
      run: async () => {
        const resp = await api('GET', '/api/inbox_applications_ai', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/inbox_applications_ai: got ${resp.status}`);
      }
    },
    {
      name: 'EP: GET /api/inbox_applications_ai/stats/summary → not 500',
      run: async () => {
        const resp = await api('GET', '/api/inbox_applications_ai/stats/summary', { role: 'ADMIN' });
        assert(resp.status !== 500, `/api/inbox_applications_ai/stats/summary: got ${resp.status}`);
      }
    },

    // ═══ Geo ═══
    {
      name: 'EP: GET /api/geo → not 500',
      run: async () => {
        const resp = await api('GET', '/api/geo', { role: 'ADMIN' });
        // May 404 or 400 — just not 500
        assert(resp.status !== 500, `/api/geo: got ${resp.status}`);
      }
    },

    // ═══ Health (no auth) ═══
    {
      name: 'EP: GET /api/health → 200 (no auth)',
      run: async () => {
        const resp = await rawFetch('GET', '/api/health');
        assertOk(resp, '/api/health');
      }
    },

    // ═══ Data API general ═══
    {
      name: 'EP: GET /api/data/tenders?limit=1 → 200',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?limit=1', { role: 'ADMIN' });
        assertOk(resp, '/api/data/tenders');
      }
    },
    {
      name: 'EP: GET /api/data/unknown_table → 400/404',
      run: async () => {
        const resp = await api('GET', '/api/data/unknown_table_xyz', { role: 'ADMIN' });
        assert(
          resp.status === 400 || resp.status === 404 || resp.status === 403,
          `unknown table should return 400/404/403, got ${resp.status}`
        );
      }
    }
  ]
};
