/**
 * TENDERS — Deep CRUD + validation + negative tests
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, assertFieldType, assertMatch } = require('../config');

let testTenderId = null;

module.exports = {
  name: 'TENDERS CRUD (deep)',
  tests: [
    {
      name: 'TO creates tender + validates response shape',
      run: async () => {
        const resp = await api('POST', '/api/tenders', {
          role: 'TO',
          body: {
            customer: 'ТЕСТ: Заказчик Альфа',
            customer_name: 'ТЕСТ: Заказчик Альфа',
            estimated_sum: 5000000,
            tender_status: 'Новый',
            tender_type: 'Аукцион'
          }
        });
        assert(resp.status < 500, `create tender: ${resp.status} — ${JSON.stringify(resp.data)?.slice(0, 300)}`);
        const tender = resp.data?.tender || resp.data;
        testTenderId = tender?.id;
        assert(testTenderId, 'should return id');
        assertFieldType(tender, 'id', 'number', 'tender.id');
      }
    },
    {
      name: 'Read-back: verify created tender fields match',
      run: async () => {
        if (!testTenderId) throw new Error('No tender created');
        const resp = await api('GET', `/api/tenders/${testTenderId}`, { role: 'TO' });
        assertOk(resp, 'get tender');
        const t = resp.data?.tender || resp.data;
        assertHasFields(t, ['id', 'tender_status', 'created_at'], 'tender detail');
        assertMatch(t, { id: testTenderId }, 'tender id match');
      }
    },
    {
      name: 'List tenders: response is array with expected fields',
      run: async () => {
        const resp = await api('GET', '/api/tenders', { role: 'TO' });
        assertOk(resp, 'list tenders');
        const list = resp.data?.tenders || resp.data;
        assertArray(list, 'tenders');
        assert(list.length > 0, 'should have at least 1 tender (just created)');
        // Validate first item shape
        assertHasFields(list[0], ['id', 'tender_status', 'created_at'], 'tender item');
      }
    },
    {
      name: 'List with limit=2 returns ≤2 items',
      run: async () => {
        const resp = await api('GET', '/api/tenders?limit=2', { role: 'TO' });
        assertOk(resp, 'list tenders limit');
        const list = resp.data?.tenders || resp.data;
        assertArray(list, 'tenders limited');
        assert(list.length <= 2, `expected ≤2 items, got ${list.length}`);
      }
    },
    {
      name: 'Update tender → read-back → verify change persisted',
      run: async () => {
        if (!testTenderId) throw new Error('No tender');
        const resp = await api('PUT', `/api/tenders/${testTenderId}`, {
          role: 'TO',
          body: { tender_status: 'В проработке' }
        });
        assertOk(resp, 'update tender');
        // Read-back
        const check = await api('GET', `/api/tenders/${testTenderId}`, { role: 'TO' });
        const t = check.data?.tender || check.data;
        assertMatch(t, { tender_status: 'В проработке' }, 'status updated');
      }
    },
    {
      name: 'HEAD_TO reads tenders (inherits TO)',
      run: async () => {
        const resp = await api('GET', '/api/tenders', { role: 'HEAD_TO' });
        assertOk(resp, 'HEAD_TO list tenders');
        const list = resp.data?.tenders || resp.data;
        assertArray(list, 'HEAD_TO tenders');
      }
    },
    {
      name: 'DIRECTOR_GEN reads tenders',
      run: async () => {
        const resp = await api('GET', '/api/tenders', { role: 'DIRECTOR_GEN' });
        assertOk(resp, 'DIRECTOR_GEN tenders');
      }
    },
    {
      name: 'Tender stats endpoint returns valid shape',
      run: async () => {
        const resp = await api('GET', '/api/tenders/stats/summary', { role: 'ADMIN' });
        assertOk(resp, 'tender stats');
        assert(resp.data && typeof resp.data === 'object', 'stats should be object');
      }
    },
    {
      name: 'NEGATIVE: create tender with empty body → 400',
      run: async () => {
        const resp = await api('POST', '/api/tenders', {
          role: 'TO', body: {}
        });
        assert(resp.status >= 400 && resp.status < 500, `expected 4xx for empty body, got ${resp.status}`);
      }
    },
    {
      name: 'NEGATIVE: HR cannot create tender (role denied)',
      run: async () => {
        const resp = await api('POST', '/api/tenders', {
          role: 'HR',
          body: { customer: 'Forbidden', estimated_sum: 100 }
        });
        assertForbidden(resp, 'HR create tender');
      }
    },
    {
      name: 'NEGATIVE: GET non-existent tender → 404',
      run: async () => {
        const resp = await api('GET', '/api/tenders/999999', { role: 'TO' });
        assert(resp.status === 404 || resp.status === 400, `expected 404, got ${resp.status}`);
      }
    },
    {
      name: 'Delete tender → verify gone from list',
      run: async () => {
        if (!testTenderId) throw new Error('No tender');
        const delResp = await api('DELETE', `/api/tenders/${testTenderId}`, { role: 'ADMIN' });
        assertOk(delResp, 'delete tender');
        // Verify gone
        const check = await api('GET', `/api/tenders/${testTenderId}`, { role: 'TO' });
        assert(check.status === 404 || check.status === 400, `deleted tender should be 404, got ${check.status}`);
        testTenderId = null;
      }
    },
    {
      name: 'NEGATIVE: WAREHOUSE cannot delete tender',
      run: async () => {
        const resp = await api('DELETE', '/api/tenders/999999', { role: 'WAREHOUSE' });
        assertForbidden(resp, 'WAREHOUSE delete tender');
      }
    }
  ]
};
