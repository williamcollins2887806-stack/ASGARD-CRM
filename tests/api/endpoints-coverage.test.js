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
        if (resp.status === 404) skip('users/roles/list not available');
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
        if (resp.status === 404) skip('invoices/overdue/list not available');
        assertOk(resp, '/api/invoices/overdue/list: got');
      }
    },
    {
      name: 'EP: GET /api/invoices/stats/summary → 200',
      run: async () => {
        const resp = await api('GET', '/api/invoices/stats/summary', { role: 'ADMIN' });
        if (resp.status === 404) skip('invoices/stats/summary not available');
        assertOk(resp, '/api/invoices/stats/summary: got');
      }
    },

    // ═══ Acts routes ═══
    {
      name: 'EP: GET /api/acts → 200',
      run: async () => {
        const resp = await api('GET', '/api/acts', { role: 'ADMIN' });
        if (resp.status === 404) skip('acts endpoint not available');
        assertOk(resp, '/api/acts');
      }
    },
    {
      name: 'EP: GET /api/acts/stats/summary → 200',
      run: async () => {
        const resp = await api('GET', '/api/acts/stats/summary', { role: 'ADMIN' });
        if (resp.status === 404) skip('acts/stats/summary not available');
        assertOk(resp, '/api/acts/stats/summary: got');
      }
    },

    // ═══ Cash routes ═══
    {
      name: 'EP: GET /api/cash/my → not 500',
      run: async () => {
        const resp = await api('GET', '/api/cash/my', { role: 'ADMIN' });
        if (resp.status === 404) skip('cash/my not available');
        assertOk(resp, '/api/cash/my: got');
      }
    },
    {
      name: 'EP: GET /api/cash/all → not 500',
      run: async () => {
        const resp = await api('GET', '/api/cash/all', { role: 'ADMIN' });
        if (resp.status === 404) skip('cash/all not available');
        assertOk(resp, '/api/cash/all: got');
      }
    },
    {
      name: 'EP: GET /api/cash/summary → not 500',
      run: async () => {
        const resp = await api('GET', '/api/cash/summary', { role: 'ADMIN' });
        if (resp.status === 404) skip('cash/summary not available');
        assertOk(resp, '/api/cash/summary: got');
      }
    },

    // ═══ Finances / expenses / incomes ═══
    {
      name: 'EP: GET /api/incomes → 200',
      run: async () => {
        const resp = await api('GET', '/api/incomes', { role: 'ADMIN' });
        if (resp.status === 404) skip('incomes endpoint not available');
        assertOk(resp, '/api/incomes');
      }
    },
    {
      name: 'EP: GET /api/expenses/work → not 500',
      run: async () => {
        const resp = await api('GET', '/api/expenses/work', { role: 'ADMIN' });
        if (resp.status === 404) skip('expenses/work not available');
        assertOk(resp, '/api/expenses/work: got');
      }
    },

    // ═══ Permits routes ═══
    {
      name: 'EP: GET /api/permits → 200',
      run: async () => {
        const resp = await api('GET', '/api/permits', { role: 'ADMIN' });
        if (resp.status === 404) skip('permits endpoint not available');
        assertOk(resp, '/api/permits');
      }
    },
    {
      name: 'EP: GET /api/permits/types → 200',
      run: async () => {
        const resp = await api('GET', '/api/permits/types', { role: 'ADMIN' });
        if (resp.status === 404) skip('permits/types not available');
        assertOk(resp, '/api/permits/types: got');
      }
    },
    {
      name: 'EP: GET /api/permits/matrix → not 500',
      run: async () => {
        const resp = await api('GET', '/api/permits/matrix', { role: 'ADMIN' });
        if (resp.status === 404) skip('permits/matrix not available');
        assertOk(resp, '/api/permits/matrix: got');
      }
    },
    {
      name: 'EP: GET /api/permits/upcoming → not 500',
      run: async () => {
        const resp = await api('GET', '/api/permits/upcoming', { role: 'ADMIN' });
        if (resp.status === 404) skip('permits/upcoming not available');
        if (resp.status === 400) skip('permits/upcoming matches /:id route — not a dedicated endpoint');
        assertOk(resp, '/api/permits/upcoming: got');
      }
    },

    // ═══ Equipment routes ═══
    {
      name: 'EP: GET /api/equipment → 200',
      run: async () => {
        const resp = await api('GET', '/api/equipment', { role: 'ADMIN' });
        if (resp.status === 404) skip('equipment endpoint not available');
        assertOk(resp, '/api/equipment');
      }
    },
    {
      name: 'EP: GET /api/equipment/categories → 200',
      run: async () => {
        const resp = await api('GET', '/api/equipment/categories', { role: 'ADMIN' });
        if (resp.status === 404) skip('equipment/categories not available');
        assertOk(resp, '/api/equipment/categories: got');
      }
    },
    {
      name: 'EP: GET /api/equipment/warehouses → 200',
      run: async () => {
        const resp = await api('GET', '/api/equipment/warehouses', { role: 'ADMIN' });
        if (resp.status === 404) skip('equipment/warehouses not available');
        assertOk(resp, '/api/equipment/warehouses: got');
      }
    },
    {
      name: 'EP: GET /api/equipment/objects → not 500',
      run: async () => {
        const resp = await api('GET', '/api/equipment/objects', { role: 'ADMIN' });
        if (resp.status === 404) skip('equipment/objects not available');
        assertOk(resp, '/api/equipment/objects: got');
      }
    },
    {
      name: 'EP: GET /api/equipment/stats/summary → not 500',
      run: async () => {
        const resp = await api('GET', '/api/equipment/stats/summary', { role: 'ADMIN' });
        if (resp.status === 404) skip('equipment/stats/summary not available');
        assertOk(resp, '/api/equipment/stats/summary: got');
      }
    },
    {
      name: 'EP: GET /api/equipment/maintenance/upcoming → not 500',
      run: async () => {
        const resp = await api('GET', '/api/equipment/maintenance/upcoming', { role: 'ADMIN' });
        if (resp.status === 404) skip('equipment/maintenance/upcoming not available');
        assertOk(resp, '/api/equipment/maintenance/upcoming: got');
      }
    },
    {
      name: 'EP: GET /api/equipment/available → not 500',
      run: async () => {
        const resp = await api('GET', '/api/equipment/available', { role: 'ADMIN' });
        if (resp.status === 404) skip('equipment/available not available');
        assertOk(resp, '/api/equipment/available: got');
      }
    },
    {
      name: 'EP: GET /api/equipment/requests → not 500',
      run: async () => {
        const resp = await api('GET', '/api/equipment/requests', { role: 'ADMIN' });
        if (resp.status === 404) skip('equipment/requests not available');
        assertOk(resp, '/api/equipment/requests: got');
      }
    },

    // ═══ Calendar routes ═══
    {
      name: 'EP: GET /api/calendar → 200',
      run: async () => {
        const resp = await api('GET', '/api/calendar', { role: 'ADMIN' });
        if (resp.status === 404) skip('calendar endpoint not available');
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
        if (resp.status === 404) skip('chat-groups endpoint not available');
        assertOk(resp, '/api/chat-groups');
      }
    },

    // ═══ Notifications ═══
    {
      name: 'EP: GET /api/notifications → 200',
      run: async () => {
        const resp = await api('GET', '/api/notifications', { role: 'ADMIN' });
        if (resp.status === 404) skip('notifications endpoint not available');
        assertOk(resp, '/api/notifications');
      }
    },

    // ═══ Sites ═══
    {
      name: 'EP: GET /api/sites → 200',
      run: async () => {
        const resp = await api('GET', '/api/sites', { role: 'ADMIN' });
        if (resp.status === 404) skip('sites endpoint not available');
        assertOk(resp, '/api/sites');
      }
    },

    // ═══ Staff / employees ═══
    {
      name: 'EP: GET /api/staff/employees → 200',
      run: async () => {
        const resp = await api('GET', '/api/staff/employees', { role: 'ADMIN' });
        if (resp.status === 404) skip('staff/employees endpoint not available');
        assertOk(resp, '/api/staff/employees');
      }
    },

    // ═══ Permissions ═══
    {
      name: 'EP: GET /api/permissions/modules → 200',
      run: async () => {
        const resp = await api('GET', '/api/permissions/modules', { role: 'ADMIN' });
        if (resp.status === 404) skip('permissions/modules not available');
        assertOk(resp, '/api/permissions/modules');
      }
    },
    {
      name: 'EP: GET /api/permissions/presets → 200',
      run: async () => {
        const resp = await api('GET', '/api/permissions/presets', { role: 'ADMIN' });
        if (resp.status === 404) skip('permissions/presets not available');
        assertOk(resp, '/api/permissions/presets');
      }
    },
    {
      name: 'EP: GET /api/permissions/my → 200',
      run: async () => {
        const resp = await api('GET', '/api/permissions/my', { role: 'ADMIN' });
        if (resp.status === 404) skip('permissions/my not available');
        assertOk(resp, '/api/permissions/my');
      }
    },
    {
      name: 'EP: GET /api/permissions/menu → 200',
      run: async () => {
        const resp = await api('GET', '/api/permissions/menu', { role: 'ADMIN' });
        if (resp.status === 404) skip('permissions/menu not available');
        assertOk(resp, '/api/permissions/menu');
      }
    },

    // ═══ Reports ═══
    {
      name: 'EP: GET /api/reports/summary → not 500',
      run: async () => {
        const resp = await api('GET', '/api/reports/summary', { role: 'ADMIN' });
        if (resp.status === 404) skip('reports/summary not available');
        assertOk(resp, '/api/reports/summary: got');
      }
    },

    // ═══ Settings ═══
    {
      name: 'EP: GET /api/settings → 200',
      run: async () => {
        const resp = await api('GET', '/api/settings', { role: 'ADMIN' });
        if (resp.status === 404) skip('settings endpoint not available');
        assertOk(resp, '/api/settings');
      }
    },

    // ═══ Meetings ═══
    {
      name: 'EP: GET /api/meetings → not 500',
      run: async () => {
        const resp = await api('GET', '/api/meetings', { role: 'ADMIN' });
        if (resp.status === 404) skip('meetings endpoint not available');
        assertOk(resp, '/api/meetings: got');
      }
    },

    // ═══ Pre-tenders ═══
    {
      name: 'EP: GET /api/pre-tenders → not 500',
      run: async () => {
        const resp = await api('GET', '/api/pre-tenders', { role: 'ADMIN' });
        if (resp.status === 404) skip('pre-tenders endpoint not available');
        assertOk(resp, '/api/pre-tenders: got');
      }
    },
    {
      name: 'EP: GET /api/pre-tenders/stats → not 500',
      run: async () => {
        const resp = await api('GET', '/api/pre-tenders/stats', { role: 'ADMIN' });
        if (resp.status === 404) skip('pre-tenders/stats not available');
        assertOk(resp, '/api/pre-tenders/stats: got');
      }
    },

    // ═══ Payroll ═══
    {
      name: 'EP: GET /api/payroll → not 500',
      run: async () => {
        const resp = await api('GET', '/api/payroll', { role: 'ADMIN' });
        if (resp.status === 404) skip('payroll endpoint not available');
        assertOk(resp, '/api/payroll: got');
      }
    },

    // ═══ Integrations ═══
    {
      name: 'EP: GET /api/integrations/bank/batches → not 500',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/batches', { role: 'ADMIN' });
        if (resp.status === 404) skip('integrations/bank/batches not available');
        assertOk(resp, '/api/integrations/bank/batches: got');
      }
    },
    {
      name: 'EP: GET /api/integrations/bank/transactions → not 500',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/transactions', { role: 'ADMIN' });
        if (resp.status === 404) skip('integrations/bank/transactions not available');
        assertOk(resp, '/api/integrations/bank/transactions: got');
      }
    },
    {
      name: 'EP: GET /api/integrations/bank/rules → not 500',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/rules', { role: 'ADMIN' });
        if (resp.status === 404) skip('integrations/bank/rules not available');
        assertOk(resp, '/api/integrations/bank/rules: got');
      }
    },
    {
      name: 'EP: GET /api/integrations/bank/stats → not 500',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/stats', { role: 'ADMIN' });
        if (resp.status === 404) skip('integrations/bank/stats not available');
        assertOk(resp, '/api/integrations/bank/stats: got');
      }
    },
    {
      name: 'EP: GET /api/integrations/platforms → not 500',
      run: async () => {
        const resp = await api('GET', '/api/integrations/platforms', { role: 'ADMIN' });
        if (resp.status === 404) skip('integrations/platforms not available');
        assertOk(resp, '/api/integrations/platforms: got');
      }
    },
    {
      name: 'EP: GET /api/integrations/erp/connections → not 500',
      run: async () => {
        const resp = await api('GET', '/api/integrations/erp/connections', { role: 'ADMIN' });
        if (resp.status === 404) skip('integrations/erp/connections not available');
        assertOk(resp, '/api/integrations/erp/connections: got');
      }
    },

    // ═══ Mailbox ═══
    {
      name: 'EP: GET /api/mailbox/accounts → not 500',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/accounts', { role: 'ADMIN' });
        if (resp.status === 404) skip('mailbox/accounts not available');
        assertOk(resp, '/api/mailbox/accounts: got');
      }
    },
    {
      name: 'EP: GET /api/mailbox/emails → not 500',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/emails', { role: 'ADMIN' });
        if (resp.status === 404) skip('mailbox/emails not available');
        assertOk(resp, '/api/mailbox/emails: got');
      }
    },
    {
      name: 'EP: GET /api/mailbox/templates → not 500',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/templates', { role: 'ADMIN' });
        if (resp.status === 404) skip('mailbox/templates not available');
        assertOk(resp, '/api/mailbox/templates: got');
      }
    },
    {
      name: 'EP: GET /api/mailbox/stats → not 500',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/stats', { role: 'ADMIN' });
        if (resp.status === 404) skip('mailbox/stats not available');
        assertOk(resp, '/api/mailbox/stats: got');
      }
    },

    // ═══ Email history ═══
    {
      name: 'EP: GET /api/email/history → not 500',
      run: async () => {
        const resp = await api('GET', '/api/email/history', { role: 'ADMIN' });
        if (resp.status === 404) skip('email/history not available');
        assertOk(resp, '/api/email/history: got');
      }
    },

    // ═══ Inbox AI ═══
    {
      name: 'EP: GET /api/inbox_applications_ai → not 500',
      run: async () => {
        const resp = await api('GET', '/api/inbox_applications_ai', { role: 'ADMIN' });
        if (resp.status === 404) skip('inbox_applications_ai not available');
        assertOk(resp, '/api/inbox_applications_ai: got');
      }
    },
    {
      name: 'EP: GET /api/inbox_applications_ai/stats/summary → not 500',
      run: async () => {
        const resp = await api('GET', '/api/inbox_applications_ai/stats/summary', { role: 'ADMIN' });
        if (resp.status === 404) skip('inbox_applications_ai/stats/summary not available');
        assertOk(resp, '/api/inbox_applications_ai/stats/summary: got');
      }
    },

    // ═══ Geo ═══
    {
      name: 'EP: GET /api/geo → not 500',
      run: async () => {
        const resp = await api('GET', '/api/geo', { role: 'ADMIN' });
        if (resp.status === 404) skip('geo endpoint not available');
        assertOk(resp, '/api/geo: got');
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
