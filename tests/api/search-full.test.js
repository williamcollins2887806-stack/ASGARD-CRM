/**
 * SEARCH — Tests for search functionality across all searchable endpoints
 */
const { api, assert, assertOk, assertArray, skip } = require('../config');

module.exports = {
  name: 'SEARCH FULL (Поиск)',
  tests: [
    // ── Users search ──
    {
      name: 'Search users by name',
      run: async () => {
        const resp = await api('GET', '/api/users?search=test', { role: 'ADMIN' });
        assertOk(resp, 'search users');
        const list = Array.isArray(resp.data) ? resp.data : (resp.data?.users || []);
        assertArray(list, 'users search results');
      }
    },
    {
      name: 'Search users by role filter',
      run: async () => {
        const resp = await api('GET', '/api/users?role=ADMIN', { role: 'ADMIN' });
        assertOk(resp, 'filter users by role');
      }
    },
    // ── Tenders search ──
    {
      name: 'Search tenders by query',
      run: async () => {
        const resp = await api('GET', '/api/tenders?search=test', { role: 'ADMIN' });
        assertOk(resp, 'search tenders');
      }
    },
    {
      name: 'Filter tenders by status',
      run: async () => {
        const resp = await api('GET', '/api/tenders?status=new', { role: 'ADMIN' });
        assertOk(resp, 'filter tenders by status');
      }
    },
    // ── Works search ──
    {
      name: 'Search works by query',
      run: async () => {
        const resp = await api('GET', '/api/works?search=test', { role: 'ADMIN' });
        assertOk(resp, 'search works');
      }
    },
    // ── Customers search ──
    {
      name: 'Search customers by name',
      run: async () => {
        const resp = await api('GET', '/api/customers?search=test', { role: 'ADMIN' });
        assertOk(resp, 'search customers');
      }
    },
    // ── Employees search ──
    {
      name: 'Search employees by name',
      run: async () => {
        const resp = await api('GET', '/api/staff/employees?search=test', { role: 'ADMIN' });
        assertOk(resp, 'search employees');
      }
    },
    // ── Equipment search ──
    {
      name: 'Search equipment by query',
      run: async () => {
        const resp = await api('GET', '/api/equipment?search=test', { role: 'ADMIN' });
        assertOk(resp, 'search equipment');
      }
    },
    // ── Data API search ──
    {
      name: 'Search data API tenders',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?search=test&limit=5', { role: 'ADMIN' });
        assertOk(resp, 'data search tenders');
      }
    },
    {
      name: 'Search data API employees',
      run: async () => {
        const resp = await api('GET', '/api/data/employees?search=test&limit=5', { role: 'ADMIN' });
        assertOk(resp, 'data search employees');
      }
    },
    // ── Invoices search ──
    {
      name: 'Search invoices',
      run: async () => {
        const resp = await api('GET', '/api/invoices?search=test', { role: 'ADMIN' });
        assertOk(resp, 'search invoices');
      }
    },
    // ── TKP search ──
    {
      name: 'Search TKP',
      run: async () => {
        const resp = await api('GET', '/api/tkp?search=test', { role: 'ADMIN' });
        assertOk(resp, 'search tkp');
      }
    },
    // ── Pass requests search ──
    {
      name: 'Search pass requests',
      run: async () => {
        const resp = await api('GET', '/api/pass-requests?search=test', { role: 'ADMIN' });
        assertOk(resp, 'search pass requests');
      }
    },
    // ── TMC requests search ──
    {
      name: 'Search TMC requests',
      run: async () => {
        const resp = await api('GET', '/api/tmc-requests?search=test', { role: 'ADMIN' });
        assertOk(resp, 'search tmc requests');
      }
    },
    // ── Pre-tenders search ──
    {
      name: 'Search pre-tenders',
      run: async () => {
        const resp = await api('GET', '/api/pre-tenders?search=test', { role: 'ADMIN' });
        assertOk(resp, 'search pre-tenders');
      }
    },
    // ── Sites search ──
    {
      name: 'Search sites',
      run: async () => {
        const resp = await api('GET', '/api/sites?search=test', { role: 'ADMIN' });
        assertOk(resp, 'search sites');
      }
    },
    // ── Empty search returns results ──
    {
      name: 'Empty search query returns all records',
      run: async () => {
        const resp = await api('GET', '/api/tenders?search=', { role: 'ADMIN' });
        assertOk(resp, 'empty search');
      }
    },
    // ── Special chars in search ──
    {
      name: 'Special characters in search do not crash',
      run: async () => {
        const resp = await api('GET', '/api/tenders?search=%25%26%3C%3E', { role: 'ADMIN' });
        assert(resp.status < 500, `special chars search should not 5xx, got ${resp.status}`);
      }
    },
    // ── Pagination with search ──
    {
      name: 'Search with pagination',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?search=a&limit=2&offset=0', { role: 'ADMIN' });
        assertOk(resp, 'search with pagination');
      }
    },
    // ── Permit applications contractors search ──
    {
      name: 'Search permit application contractors',
      run: async () => {
        const resp = await api('GET', '/api/permit-applications/contractors?search=test', { role: 'ADMIN' });
        assert(resp.status < 500, `contractors search should not 5xx, got ${resp.status}`);
      }
    }
  ]
};
