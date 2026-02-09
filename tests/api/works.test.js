const { api, assert, assertOk, assertForbidden } = require('../config');

let testWorkId = null;

module.exports = {
  name: 'WORKS CRUD',
  tests: [
    {
      name: 'PM creates work',
      run: async () => {
        const resp = await api('POST', '/api/works', {
          role: 'PM',
          body: {
            work_title: 'ТЕСТ: Монтаж HVAC',
            work_number: 'TEST-W-001',
            customer_name: 'Test Customer Alpha',
            contract_value: 3000000,
            cost_plan: 2000000,
            work_status: 'В работе',
            pm_id: 9001
          }
        });
        assertOk(resp, 'create work');
        testWorkId = resp.data?.id;
        assert(testWorkId, 'should return id');
      }
    },
    {
      name: 'PM reads works list',
      run: async () => {
        const resp = await api('GET', '/api/works', { role: 'PM' });
        assertOk(resp, 'list works');
        assert(Array.isArray(resp.data), 'array expected');
      }
    },
    {
      name: 'PM reads single work',
      run: async () => {
        if (!testWorkId) throw new Error('No work created');
        const resp = await api('GET', `/api/works/${testWorkId}`, { role: 'PM' });
        assertOk(resp, 'get work');
      }
    },
    {
      name: 'PM updates work status',
      run: async () => {
        if (!testWorkId) throw new Error('No work created');
        const resp = await api('PUT', `/api/works/${testWorkId}`, {
          role: 'PM',
          body: { work_status: 'Мобилизация' }
        });
        assertOk(resp, 'update work');
      }
    },
    {
      name: 'HEAD_PM reads works (inherits PM)',
      run: async () => {
        const resp = await api('GET', '/api/works', { role: 'HEAD_PM' });
        assertOk(resp, 'HEAD_PM list works');
      }
    },
    {
      name: 'Cleanup: ADMIN deletes test work',
      run: async () => {
        if (!testWorkId) return;
        const resp = await api('DELETE', `/api/works/${testWorkId}`, { role: 'ADMIN' });
        assertOk(resp, 'delete work');
        testWorkId = null;
      }
    }
  ]
};
