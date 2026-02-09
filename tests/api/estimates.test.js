const { api, assert, assertOk } = require('../config');

let testEstimateId = null;

module.exports = {
  name: 'ESTIMATES CRUD',
  tests: [
    {
      name: 'PM creates estimate',
      run: async () => {
        const resp = await api('POST', '/api/estimates', {
          role: 'PM',
          body: {
            estimate_title: 'ТЕСТ: Просчёт HVAC',
            cost_total: 3500000,
            margin_percent: 15,
            pm_id: 9001,
            status: 'Черновик'
          }
        });
        assertOk(resp, 'create estimate');
        testEstimateId = resp.data?.id;
      }
    },
    {
      name: 'PM reads estimates',
      run: async () => {
        const resp = await api('GET', '/api/estimates', { role: 'PM' });
        assertOk(resp, 'list estimates');
        assert(Array.isArray(resp.data), 'array expected');
      }
    },
    {
      name: 'PM reads single estimate',
      run: async () => {
        if (!testEstimateId) throw new Error('No estimate created');
        const resp = await api('GET', `/api/estimates/${testEstimateId}`, { role: 'PM' });
        assertOk(resp, 'get estimate');
      }
    },
    {
      name: 'PM updates estimate',
      run: async () => {
        if (!testEstimateId) throw new Error('No estimate created');
        const resp = await api('PUT', `/api/estimates/${testEstimateId}`, {
          role: 'PM',
          body: { status: 'На согласовании' }
        });
        assertOk(resp, 'update estimate');
      }
    },
    {
      name: 'Cleanup: ADMIN deletes estimate',
      run: async () => {
        if (!testEstimateId) return;
        const resp = await api('DELETE', `/api/estimates/${testEstimateId}`, { role: 'ADMIN' });
        assertOk(resp, 'delete estimate');
        testEstimateId = null;
      }
    }
  ]
};
