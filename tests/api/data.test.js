/**
 * DATA - Universal CRUD API for whitelisted tables
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, assertMatch, assertFieldType } = require('../config');

module.exports = {
  name: 'DATA (Универсальный CRUD)',
  tests: [
    {
      name: 'ADMIN reads tenders via /data/tenders',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?limit=5', { role: 'ADMIN' });
        assertOk(resp, 'data/tenders');
        if (resp.data) {
          const list = Array.isArray(resp.data) ? resp.data : (resp.data.data || resp.data.items || []);
          assertArray(list, 'data/tenders');
        }
      }
    },
    {
      name: 'ADMIN reads works via /data/works',
      run: async () => {
        const resp = await api('GET', '/api/data/works?limit=5', { role: 'ADMIN' });
        assertOk(resp, 'data/works');
      }
    },
    {
      name: 'ADMIN reads estimates via /data/estimates',
      run: async () => {
        const resp = await api('GET', '/api/data/estimates?limit=5', { role: 'ADMIN' });
        assertOk(resp, 'data/estimates');
      }
    },
    {
      name: 'ADMIN reads work_expenses via /data/work_expenses',
      run: async () => {
        const resp = await api('GET', '/api/data/work_expenses?limit=5', { role: 'ADMIN' });
        assertOk(resp, 'data/work_expenses');
      }
    },
    {
      name: 'ADMIN reads audit_log via /data/audit_log',
      run: async () => {
        const resp = await api('GET', '/api/data/audit_log?limit=5', { role: 'ADMIN' });
        assertOk(resp, 'audit_log');
      }
    },
    {
      name: 'ADMIN counts tenders returns number',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders/count', { role: 'ADMIN' });
        assertOk(resp, 'tenders count');
        if (resp.data) {
          const count = resp.data.count !== undefined ? resp.data.count : resp.data;
          assert(
            typeof count === 'number' || typeof count === 'string',
            `count should be number or numeric string, got ${typeof count}`
          );
        }
      }
    },
    {
      name: 'Non-whitelisted table returns 400/403',
      run: async () => {
        const resp = await api('GET', '/api/data/nonexistent_table', { role: 'ADMIN' });
        assert(resp.status >= 400, `expected 4xx, got ${resp.status}`);
      }
    },
    {
      name: 'PM reads tenders via /data',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?limit=3', { role: 'PM' });
        assertOk(resp, 'PM data/tenders');
      }
    }
  ]
};
