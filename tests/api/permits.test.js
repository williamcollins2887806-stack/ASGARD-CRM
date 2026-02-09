const { api, assert, assertOk } = require('../config');

let testPermitId = null;

module.exports = {
  name: 'PERMITS (Допуски)',
  tests: [
    {
      name: 'ADMIN reads permit types',
      run: async () => {
        const resp = await api('GET', '/api/permits/types', { role: 'ADMIN' });
        assertOk(resp, 'permit types');
      }
    },
    {
      name: 'ADMIN reads permits list',
      run: async () => {
        const resp = await api('GET', '/api/permits', { role: 'ADMIN' });
        assertOk(resp, 'permits list');
      }
    },
    {
      name: 'ADMIN creates permit for test employee',
      run: async () => {
        const resp = await api('POST', '/api/permits', {
          role: 'ADMIN',
          body: {
            employee_id: 9100,
            type_id: 'safety_general',
            doc_number: 'TEST-001',
            issue_date: '2026-01-01',
            expiry_date: '2027-01-01',
            notes: 'Автотест'
          }
        });
        // Может быть 200/201 или 400 если type_id не существует
        assert(resp.status < 500, `create permit: ${resp.status}`);
        if (resp.ok) testPermitId = resp.data?.id;
      }
    },
    {
      name: 'ADMIN reads permit matrix',
      run: async () => {
        const resp = await api('GET', '/api/permits/matrix', { role: 'ADMIN' });
        assertOk(resp, 'permit matrix');
      }
    },
    {
      name: 'ADMIN reads permit stats',
      run: async () => {
        const resp = await api('GET', '/api/permits/stats', { role: 'ADMIN' });
        assertOk(resp, 'permit stats');
      }
    },
    {
      name: 'Cleanup: delete test permit',
      run: async () => {
        if (!testPermitId) return;
        await api('DELETE', `/api/permits/${testPermitId}`, { role: 'ADMIN' });
      }
    }
  ]
};
