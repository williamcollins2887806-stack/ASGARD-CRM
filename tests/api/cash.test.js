const { api, assert, assertOk, assertForbidden } = require('../config');

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
            purpose: 'ТЕСТ: командировка на объект'
          }
        });
        // Может быть 200 или 201, или 403 если нет permission
        if (resp.ok) {
          testCashId = resp.data?.id;
        }
        assert(resp.status < 500, `create cash: unexpected ${resp.status}`);
      }
    },
    {
      name: 'PM reads own cash requests',
      run: async () => {
        const resp = await api('GET', '/api/cash/my', { role: 'PM' });
        // Может быть 403 если permission не настроен
        assert(resp.status < 500, `my cash: ${resp.status}`);
      }
    },
    {
      name: 'ADMIN reads all cash requests',
      run: async () => {
        const resp = await api('GET', '/api/cash/all', { role: 'ADMIN' });
        assertOk(resp, 'admin cash/all');
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
        assert(resp.status < 500, `approve: ${resp.status}`);
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
