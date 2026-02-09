const { api, assert, assertOk, assertForbidden } = require('../config');

let testTenderId = null;

module.exports = {
  name: 'TENDERS CRUD',
  tests: [
    {
      name: 'TO creates tender',
      run: async () => {
        const resp = await api('POST', '/api/tenders', {
          role: 'TO',
          body: {
            customer: 'ТЕСТ: Заказчик Альфа',
            customer_inn: '0000000001',
            estimated_sum: 5000000,
            tender_status: 'Новый',
            comment_to: 'Автотест'
          }
        });
        assertOk(resp, 'create tender');
        assert(resp.data?.id, 'should return id');
        testTenderId = resp.data.id;
      }
    },
    {
      name: 'TO reads tender list',
      run: async () => {
        const resp = await api('GET', '/api/tenders', { role: 'TO' });
        assertOk(resp, 'list tenders');
        assert(Array.isArray(resp.data), 'should be array');
      }
    },
    {
      name: 'TO reads single tender',
      run: async () => {
        if (!testTenderId) throw new Error('No tender created');
        const resp = await api('GET', `/api/tenders/${testTenderId}`, { role: 'TO' });
        assertOk(resp, 'get tender');
      }
    },
    {
      name: 'TO updates tender status',
      run: async () => {
        if (!testTenderId) throw new Error('No tender created');
        const resp = await api('PUT', `/api/tenders/${testTenderId}`, {
          role: 'TO',
          body: { tender_status: 'В проработке' }
        });
        assertOk(resp, 'update tender');
      }
    },
    {
      name: 'HEAD_TO reads tenders (inherits TO)',
      run: async () => {
        const resp = await api('GET', '/api/tenders', { role: 'HEAD_TO' });
        assertOk(resp, 'HEAD_TO list tenders');
      }
    },
    {
      name: 'DIRECTOR_GEN reads tenders',
      run: async () => {
        const resp = await api('GET', '/api/tenders', { role: 'DIRECTOR_GEN' });
        assertOk(resp, 'DIRECTOR_GEN list tenders');
      }
    },
    {
      name: 'Tender stats endpoint works',
      run: async () => {
        const resp = await api('GET', '/api/tenders/stats/summary', { role: 'ADMIN' });
        assertOk(resp, 'tender stats');
      }
    },
    {
      name: 'ADMIN deletes test tender',
      run: async () => {
        if (!testTenderId) throw new Error('No tender');
        const resp = await api('DELETE', `/api/tenders/${testTenderId}`, { role: 'ADMIN' });
        assertOk(resp, 'delete tender');
        testTenderId = null;
      }
    }
  ]
};
