/**
 * ESTIMATES — Deep CRUD + validation + negative tests
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, assertMatch, assertFieldType } = require('../config');

let testEstimateId = null;

module.exports = {
  name: 'ESTIMATES CRUD (deep)',
  tests: [
    {
      name: 'PM creates estimate + validates response',
      run: async () => {
        const resp = await api('POST', '/api/estimates', {
          role: 'PM',
          body: {
            title: 'ТЕСТ: Просчёт HVAC',
            amount: 3500000,
            margin: 15,
            approval_status: 'draft'
          }
        });
        assert(resp.status < 500, `create estimate: ${resp.status} — ${JSON.stringify(resp.data)?.slice(0, 300)}`);
        const est = resp.data?.estimate || resp.data;
        testEstimateId = est?.id;
        if (testEstimateId) assertFieldType(est, 'id', 'number', 'estimate.id');
      }
    },
    {
      name: 'Read-back: verify created estimate fields',
      run: async () => {
        if (!testEstimateId) throw new Error('No estimate');
        const resp = await api('GET', `/api/estimates/${testEstimateId}`, { role: 'PM' });
        assertOk(resp, 'get estimate');
        const e = resp.data?.estimate || resp.data;
        assertHasFields(e, ['id', 'title', 'approval_status'], 'estimate detail');
        assertMatch(e, { id: testEstimateId, approval_status: 'draft' }, 'estimate fields');
      }
    },
    {
      name: 'List estimates: response is array with fields',
      run: async () => {
        const resp = await api('GET', '/api/estimates', { role: 'PM' });
        assertOk(resp, 'list estimates');
        const list = resp.data?.estimates || resp.data;
        assertArray(list, 'estimates');
        if (list.length > 0) assertHasFields(list[0], ['id', 'title'], 'estimate item');
      }
    },
    {
      name: 'Update estimate → read-back → verify margin changed',
      run: async () => {
        if (!testEstimateId) throw new Error('No estimate');
        await api('PUT', `/api/estimates/${testEstimateId}`, {
          role: 'PM', body: { margin: 20 }
        });
        const check = await api('GET', `/api/estimates/${testEstimateId}`, { role: 'PM' });
        const e = check.data?.estimate || check.data;
        assertMatch(e, { margin: 20 }, 'margin updated');
      }
    },
    {
      name: 'NEGATIVE: HR cannot create estimate',
      run: async () => {
        const resp = await api('POST', '/api/estimates', {
          role: 'HR', body: { title: 'Forbidden', amount: 100 }
        });
        assertForbidden(resp, 'HR create estimate');
      }
    },
    {
      name: 'NEGATIVE: create estimate with empty body → 400',
      run: async () => {
        const resp = await api('POST', '/api/estimates', { role: 'PM', body: {} });
        assert(resp.status === 400, `empty body should return 400, got ${resp.status}`);
      }
    },
    {
      name: 'Delete estimate → verify gone',
      run: async () => {
        if (!testEstimateId) return;
        await api('DELETE', `/api/estimates/${testEstimateId}`, { role: 'ADMIN' });
        const check = await api('GET', `/api/estimates/${testEstimateId}`, { role: 'PM' });
        assert(check.status === 404 || check.status === 400, `deleted estimate should be 404, got ${check.status}`);
        testEstimateId = null;
      }
    }
  ]
};
