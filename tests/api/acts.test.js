/**
 * ACTS - Acts of completed works
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, assertMatch, assertFieldType } = require('../config');

module.exports = {
  name: 'ACTS (Акты)',
  tests: [
    {
      name: 'ADMIN reads acts list',
      run: async () => {
        const resp = await api('GET', '/api/acts', { role: 'ADMIN' });
        assertOk(resp, 'acts list');
        if (resp.data) {
          const list = Array.isArray(resp.data) ? resp.data : (resp.data.acts || resp.data.items || []);
          assertArray(list, 'acts list');
          if (list.length > 0) {
            assertHasFields(list[0], ['id'], 'act item');
            assertFieldType(list[0], 'id', 'number', 'act item id');
          }
        }
      }
    },
    {
      name: 'PM reads acts',
      run: async () => {
        const resp = await api('GET', '/api/acts', { role: 'PM' });
        assertOk(resp, 'PM acts');
      }
    },
    {
      name: 'BUH reads acts',
      run: async () => {
        const resp = await api('GET', '/api/acts', { role: 'BUH' });
        assertOk(resp, 'BUH acts');
      }
    },
    {
      name: 'ADMIN reads act stats',
      run: async () => {
        const resp = await api('GET', '/api/acts/stats/summary', { role: 'ADMIN' });
        assertOk(resp, 'act stats');
        if (resp.ok && resp.data) {
          assert(typeof resp.data === 'object', 'stats should be object');
        }
      }
    },
    {
      name: 'Negative: HR cannot create act',
      run: async () => {
        const resp = await api('POST', '/api/acts', {
          role: 'HR',
          body: { act_number: 'TEST-ACT', amount: 100000 }
        });
        assertForbidden(resp, 'HR create act');
      }
    },
    {
      name: 'Negative: GET non-existent act returns 404',
      run: async () => {
        const resp = await api('GET', '/api/acts/999999', { role: 'ADMIN' });
        assert(
          resp.status === 404 || resp.status === 400,
          `expected 404/400 for non-existent act, got ${resp.status}`
        );
      }
    }
  ]
};
