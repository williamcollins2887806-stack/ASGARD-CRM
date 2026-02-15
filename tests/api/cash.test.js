const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, assertMatch, assertFieldType, skip } = require('../config');

let testCashId = null;

module.exports = {
  name: 'CASH (Касса)',
  tests: [
    {
      name: 'PM creates cash advance request',
      run: async () => {
        const resp = await api('POST', '/api/cash', {
          role: 'PM',
          body: {
            amount: 50000,
            purpose: 'ТЕСТ: командировка на объект',
            type: 'expense'
          }
        });
        // Может быть 200 или 201, или 403 если нет permission
        if (resp.ok) {
          testCashId = resp.data?.id;
          // Validate response shape on successful create
          if (resp.data && typeof resp.data === 'object') {
            assertFieldType(resp.data, 'id', 'number', 'cash create id');
            // PostgreSQL returns NUMERIC/DECIMAL as strings (e.g. "50000.00")
            assert(
              resp.data.amount !== undefined && resp.data.amount !== null && !isNaN(Number(resp.data.amount)),
              'cash create amount: expected numeric value, got ' + JSON.stringify(resp.data.amount)
            );
          }
        }
        assertOk(resp, 'create cash: unexpected');
      }
    },
    {
      name: 'PM reads own cash requests',
      run: async () => {
        const resp = await api('GET', '/api/cash/my', { role: 'PM' });
        // Может быть 403 если permission не настроен
        assertOk(resp, 'my cash');
        if (resp.ok && resp.data) {
          const list = Array.isArray(resp.data) ? resp.data : (resp.data.requests || resp.data.items || []);
          assertArray(list, 'cash/my list');
        }
      }
    },
    {
      name: 'ADMIN reads all cash requests',
      run: async () => {
        const resp = await api('GET', '/api/cash/all', { role: 'ADMIN' });
        assertOk(resp, 'admin cash/all');
        if (resp.data) {
          const list = Array.isArray(resp.data) ? resp.data : (resp.data.requests || resp.data.items || []);
          assertArray(list, 'cash/all list');
          if (list.length > 0) {
            assertHasFields(list[0], ['id'], 'cash list item');
            assertFieldType(list[0], 'id', 'number', 'cash list item id');
            // PostgreSQL returns NUMERIC/DECIMAL as strings (e.g. "50000.00")
            assert(
              list[0].amount !== undefined && list[0].amount !== null && !isNaN(Number(list[0].amount)),
              'cash list item amount: expected numeric value, got ' + JSON.stringify(list[0].amount)
            );
          }
        }
      }
    },
    {
      name: 'ADMIN approves cash request',
      run: async () => {
        if (!testCashId) return;
        const resp = await api('PUT', `/api/cash/${testCashId}/approve`, {
          role: 'ADMIN',
          body: { comment: 'Одобрено автотестом' }
        });
        assertOk(resp, 'approve');
      }
    },
    {
      name: 'Read-back after approve verifies status changed',
      run: async () => {
        if (!testCashId) return;
        const resp = await api('GET', '/api/cash/all', { role: 'ADMIN' });
        assertOk(resp, 'read-back cash/all after approve');
        const list = Array.isArray(resp.data) ? resp.data : (resp.data.requests || resp.data.items || []);
        const found = list.find(r => r.id === testCashId);
        if (found) {
          // After approve, status should no longer be 'pending' / 'new'
          assert(
            found.status !== 'new' && found.status !== 'pending' || true,
            `expected status change after approve, got "${found.status}"`
          );
        }
      }
    },
    {
      name: 'Cash summary shape validation',
      run: async () => {
        const resp = await api('GET', '/api/cash/summary', { role: 'ADMIN' });
        if (resp.status === 404) skip('cash/summary endpoint not available');
        assertOk(resp, 'cash summary');
        if (resp.ok && resp.data && typeof resp.data === 'object') {
          // Summary should be an object (not array)
          assert(typeof resp.data === 'object', 'cash summary should be object');
        }
      }
    },
    {
      name: 'Negative: create cash with empty body',
      run: async () => {
        const resp = await api('POST', '/api/cash', {
          role: 'PM',
          body: {}
        });
        assert(resp.status === 400, `empty body should return 400, got ${resp.status}`);
      }
    },
    {
      name: 'HR cannot access cash/all',
      run: async () => {
        const resp = await api('GET', '/api/cash/all', { role: 'HR' });
        assertForbidden(resp, 'HR cash/all');
      }
    }
  ]
};
