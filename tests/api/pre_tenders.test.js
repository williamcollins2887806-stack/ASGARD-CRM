/**
 * PRE_TENDERS — Deep CRUD + validation
 */
const { api, assert, assertOk, assertHasFields, assertArray, assertFieldType } = require('../config');

let testPreTenderId = null;

module.exports = {
  name: 'PRE-TENDERS (deep)',
  tests: [
    {
      name: 'ADMIN reads pre-tenders — validates shape',
      run: async () => {
        const resp = await api('GET', '/api/pre-tenders', { role: 'ADMIN' });
        assertOk(resp, 'pre-tenders');
        const list = resp.data?.pre_tenders || resp.data?.preTenders || resp.data;
        if (Array.isArray(list) && list.length > 0) assertHasFields(list[0], ['id'], 'pre-tender item');
      }
    },
    {
      name: 'TO reads pre-tenders',
      run: async () => {
        const resp = await api('GET', '/api/pre-tenders', { role: 'TO' });
        assertOk(resp, 'TO pre-tenders');
      }
    },
    {
      name: 'ADMIN creates pre-tender + validates',
      run: async () => {
        const resp = await api('POST', '/api/pre-tenders', {
          role: 'ADMIN',
          body: { customer_name: 'Deep Pre-tender Customer', customer_inn: '7712345678', tender_type: 'Аукцион', estimated_sum: 2000000, status: 'new' }
        });
        assertOk(resp, 'create');
        if (resp.ok) {
          const pt = resp.data?.pre_tender || resp.data;
          testPreTenderId = pt?.id;
          if (testPreTenderId) assertFieldType(pt, 'id', 'number', 'pre-tender.id');
        }
      }
    },
    {
      name: 'Pre-tender stats returns valid shape',
      run: async () => {
        const resp = await api('GET', '/api/pre-tenders/stats', { role: 'ADMIN' });
        assertOk(resp, 'stats');
        if (resp.ok) assert(typeof resp.data === 'object', 'stats is object');
      }
    },
    {
      name: 'NEGATIVE: create with empty body → 400',
      run: async () => {
        const resp = await api('POST', '/api/pre-tenders', { role: 'ADMIN', body: {} });
        assert(resp.status === 400, `expected 4xx, got ${resp.status}`);
      }
    },
    {
      name: 'Cleanup: delete pre-tender',
      run: async () => {
        if (!testPreTenderId) return;
        await api('DELETE', `/api/pre-tenders/${testPreTenderId}`, { role: 'ADMIN' });
      }
    }
  ]
};
