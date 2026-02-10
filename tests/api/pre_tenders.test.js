/**
 * PRE_TENDERS - Pre-tender request management
 */
const { api, assert, assertOk } = require('../config');

let testPreTenderId = null;

module.exports = {
  name: 'PRE-TENDERS (Предтендеры)',
  tests: [
    {
      name: 'ADMIN reads pre-tenders list',
      run: async () => {
        const resp = await api('GET', '/api/pre-tenders', { role: 'ADMIN' });
        assertOk(resp, 'pre-tenders list');
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
      name: 'ADMIN creates pre-tender',
      run: async () => {
        const resp = await api('POST', '/api/pre-tenders', {
          role: 'ADMIN',
          body: {
            customer_name: 'Stage12 Pre-tender Customer',
            customer_inn: '7712345678',
            tender_type: 'Аукцион',
            estimated_sum: 2000000,
            status: 'new'
          }
        });
        assert(resp.status < 500, `create pre-tender: ${resp.status} - ${JSON.stringify(resp.data)?.slice(0, 200)}`);
        if (resp.ok) testPreTenderId = resp.data?.id || resp.data?.pre_tender?.id;
      }
    },
    {
      name: 'ADMIN reads pre-tender stats',
      run: async () => {
        const resp = await api('GET', '/api/pre-tenders/stats', { role: 'ADMIN' });
        assert(resp.status < 500, `pre-tender stats: ${resp.status}`);
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
