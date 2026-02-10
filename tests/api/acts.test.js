/**
 * ACTS - Acts of completed works
 */
const { api, assert, assertOk } = require('../config');

module.exports = {
  name: 'ACTS (Акты)',
  tests: [
    {
      name: 'ADMIN reads acts list',
      run: async () => {
        const resp = await api('GET', '/api/acts', { role: 'ADMIN' });
        assertOk(resp, 'acts list');
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
        assert(resp.status < 500, `act stats: ${resp.status}`);
      }
    }
  ]
};
