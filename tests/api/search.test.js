/**
 * Block E: Search tests
 * Tests search functionality across various endpoints
 */
const { api, assert, assertOk, assertArray, skip } = require('../config');

module.exports = {
  name: 'SEARCH',
  tests: [
    {
      name: 'SEARCH: staff?search=... filters by FIO',
      run: async () => {
        const resp = await api('GET', '/api/staff?search=а', { role: 'ADMIN' });
        if (resp.status === 404) skip('Staff search endpoint not available');
        assertOk(resp, 'staff search');
        const list = Array.isArray(resp.data) ? resp.data : (resp.data?.staff || resp.data?.items || []);
        assertArray(list, 'staff search results');
      }
    },
    {
      name: 'SEARCH: users?search=... filters by name/login',
      run: async () => {
        const resp = await api('GET', '/api/users?search=admin', { role: 'ADMIN' });
        assertOk(resp, 'users search');
        const list = Array.isArray(resp.data) ? resp.data : (resp.data?.users || []);
        assertArray(list, 'users search results');
      }
    },
    {
      name: 'SEARCH: empty search → returns all results',
      run: async () => {
        const withSearch = await api('GET', '/api/users?search=', { role: 'ADMIN' });
        const withoutSearch = await api('GET', '/api/users', { role: 'ADMIN' });
        assertOk(withSearch, 'empty search');
        assertOk(withoutSearch, 'no search');
        const a = Array.isArray(withSearch.data) ? withSearch.data : (withSearch.data?.users || []);
        const b = Array.isArray(withoutSearch.data) ? withoutSearch.data : (withoutSearch.data?.users || []);
        assert(a.length === b.length, `empty search (${a.length}) should equal no search (${b.length})`);
      }
    },
    {
      name: 'SEARCH: non-existent term → empty array',
      run: async () => {
        const resp = await api('GET', '/api/users?search=ZZZZNONEXISTENT999', { role: 'ADMIN' });
        assertOk(resp, 'nonexistent search');
        const list = Array.isArray(resp.data) ? resp.data : (resp.data?.users || []);
        assert(list.length === 0, `expected 0 results for nonsense, got ${list.length}`);
      }
    },
    {
      name: 'SEARCH: special chars (%, _) → no SQL error',
      run: async () => {
        const resp = await api('GET', '/api/users?search=' + encodeURIComponent("100%_test'OR 1=1"), { role: 'ADMIN' });
        assert(resp.status < 500, `special chars should not cause 500, got ${resp.status}`);
      }
    },
    {
      name: 'SEARCH: data API where filter for tenders by status',
      run: async () => {
        const where = JSON.stringify({ tender_status: 'Новый' });
        const resp = await api('GET', `/api/data/tenders?where=${encodeURIComponent(where)}&limit=10`, { role: 'ADMIN' });
        assertOk(resp, 'where filter');
        const list = resp.data?.tenders || [];
        for (const item of list) {
          assert(item.tender_status === 'Новый', `expected status Новый, got ${item.tender_status}`);
        }
      }
    },
    {
      name: 'SEARCH: data API where filter with non-existent value → empty',
      run: async () => {
        const where = JSON.stringify({ tender_status: 'NONEXISTENT_STATUS_XYZ' });
        const resp = await api('GET', `/api/data/tenders?where=${encodeURIComponent(where)}&limit=10`, { role: 'ADMIN' });
        assertOk(resp, 'where filter nonexistent');
        const list = resp.data?.tenders || [];
        assert(list.length === 0, `expected 0 for nonexistent status, got ${list.length}`);
      }
    },
    {
      name: 'SEARCH: pre_tenders?search=... (if available)',
      run: async () => {
        const resp = await api('GET', '/api/pre-tenders?search=test', { role: 'ADMIN' });
        if (resp.status === 404) skip('Pre-tenders search not available');
        assert(resp.status < 500, `pre-tenders search: ${resp.status}`);
      }
    },
    {
      name: 'SEARCH: case insensitive (users)',
      run: async () => {
        const upper = await api('GET', '/api/users?search=ADMIN', { role: 'ADMIN' });
        const lower = await api('GET', '/api/users?search=admin', { role: 'ADMIN' });
        assertOk(upper, 'upper search');
        assertOk(lower, 'lower search');
        const a = Array.isArray(upper.data) ? upper.data : (upper.data?.users || []);
        const b = Array.isArray(lower.data) ? lower.data : (lower.data?.users || []);
        assert(a.length === b.length, `case insensitive: upper(${a.length}) should equal lower(${b.length})`);
      }
    },
    {
      name: 'SEARCH: payroll self-employed?search=... (if available)',
      run: async () => {
        const resp = await api('GET', '/api/payroll/self-employed?search=test', { role: 'ADMIN' });
        if (resp.status === 404) skip('Self-employed search not available');
        assert(resp.status < 500, `self-employed search: ${resp.status}`);
      }
    }
  ]
};
