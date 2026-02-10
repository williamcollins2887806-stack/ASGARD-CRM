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
            title: 'ТЕСТ: Просчёт HVAC',
            amount: 3500000,
            margin: 15
          }
        });
        assertOk(resp, 'create estimate');
        testEstimateId = resp.data?.estimate?.id || resp.data?.id;
      }
    },
    {
      name: 'PM reads estimates',
      run: async () => {
        const resp = await api('GET', '/api/estimates', { role: 'PM' });
        assertOk(resp, 'list estimates');
        const list = resp.data?.estimates || resp.data;
        assert(Array.isArray(list), 'array expected');
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
          body: { margin: 20 }
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
