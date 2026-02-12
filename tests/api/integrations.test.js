/**
 * INTEGRATIONS - Bank/1C/Platform imports — deep validation + negative tests
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, assertFieldType } = require('../config');

module.exports = {
  name: 'INTEGRATIONS (Интеграции)',
  tests: [
    {
      name: 'ADMIN reads bank batches — validates shape',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/batches', { role: 'ADMIN' });
        assertOk(resp, 'bank batches');
        if (resp.data) {
          const list = Array.isArray(resp.data) ? resp.data : (resp.data.batches || resp.data.items || []);
          assertArray(list, 'bank batches list');
          if (list.length > 0) {
            assertHasFields(list[0], ['id'], 'batch item');
            assertFieldType(list[0], 'id', 'number', 'batch item id');
          }
        }
      }
    },
    {
      name: 'BUH reads bank batches',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/batches', { role: 'BUH' });
        assertOk(resp, 'BUH bank batches');
      }
    },
    {
      name: 'DIRECTOR_GEN reads bank batches',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/batches', { role: 'DIRECTOR_GEN' });
        assertOk(resp, 'DIR bank batches');
      }
    },
    {
      name: 'PM can also access bank batches (authenticate only)',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/batches', { role: 'PM' });
        assertOk(resp, 'PM bank batches');
      }
    },
    {
      name: 'ADMIN reads bank transactions — validates shape',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/transactions', { role: 'ADMIN' });
        assertOk(resp, 'bank transactions');
        if (resp.ok && resp.data) {
          const list = Array.isArray(resp.data) ? resp.data : (resp.data.transactions || resp.data.items || []);
          if (Array.isArray(list) && list.length > 0) {
            assertHasFields(list[0], ['id'], 'transaction item');
          }
        }
      }
    },
    {
      name: 'ADMIN reads bank stats',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/stats', { role: 'ADMIN' });
        assertOk(resp, 'bank stats');
        if (resp.ok) assert(typeof resp.data === 'object', 'stats should be object');
      }
    },
    {
      name: 'ADMIN reads bank rules — validates array',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/rules', { role: 'ADMIN' });
        assertOk(resp, 'bank rules');
        if (resp.ok && resp.data) {
          const list = Array.isArray(resp.data) ? resp.data : (resp.data.rules || resp.data.items || []);
          assertArray(list, 'bank rules list');
        }
      }
    },
    {
      name: 'ADMIN reads ERP connections',
      run: async () => {
        const resp = await api('GET', '/api/integrations/erp/connections', { role: 'ADMIN' });
        assertOk(resp, 'erp connections');
        if (resp.ok && resp.data) {
          const list = Array.isArray(resp.data) ? resp.data : (resp.data.connections || []);
          assertArray(list, 'erp connections list');
        }
      }
    },
    {
      name: 'ADMIN reads ERP sync log',
      run: async () => {
        const resp = await api('GET', '/api/integrations/erp/sync-log', { role: 'ADMIN' });
        assertOk(resp, 'erp sync-log');
      }
    },
    {
      name: 'ADMIN reads platforms — validates shape',
      run: async () => {
        const resp = await api('GET', '/api/integrations/platforms', { role: 'ADMIN' });
        assertOk(resp, 'platforms');
        if (resp.ok && resp.data) {
          const list = Array.isArray(resp.data) ? resp.data : (resp.data.platforms || resp.data.items || []);
          if (Array.isArray(list) && list.length > 0) {
            assertHasFields(list[0], ['id'], 'platform item');
          }
        }
      }
    },
    {
      name: 'ADMIN reads platforms stats',
      run: async () => {
        const resp = await api('GET', '/api/integrations/platforms/stats', { role: 'ADMIN' });
        assertOk(resp, 'platforms stats');
        if (resp.ok) assert(typeof resp.data === 'object', 'platforms stats is object');
      }
    },
    {
      name: 'NEGATIVE: upload bank without file → 400',
      run: async () => {
        const resp = await api('POST', '/api/integrations/bank/upload', { role: 'ADMIN', body: {} });
        assert(resp.status === 400 || resp.status === 406, `upload empty: expected 400/406, got ${resp.status}`);
      }
    },
    {
      name: 'NEGATIVE: non-existent transaction → 404',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/transactions/999999', { role: 'ADMIN' });
        assert(resp.status === 404 || resp.status === 400, `non-existent tx: expected 404, got ${resp.status}`);
      }
    },
    {
      name: 'NEGATIVE: ERP rotate-secret requires ADMIN/DIRECTOR_GEN',
      run: async () => {
        const resp = await api('POST', '/api/integrations/erp/connections/1/rotate-secret', { role: 'PM' });
        assert(resp.status >= 400, `PM rotate-secret should be denied, got ${resp.status}`);
      }
    }
  ]
};
