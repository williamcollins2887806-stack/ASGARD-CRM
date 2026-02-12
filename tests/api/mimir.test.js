/**
 * MIMIR - AI assistant endpoints
 */
const {api, assert, assertOk, skip} = require('../config');

module.exports = {
  name: 'MIMIR (AI Ассистент)',
  tests: [
    {
      name: 'ADMIN reads mimir status',
      run: async () => {
        const resp = await api('GET', '/api/mimir/status', { role: 'ADMIN' });
        if (resp.status === 404) skip('mimir/status not available');
        assertOk(resp, 'mimir status');
      }
    },
    {
      name: 'ADMIN reads mimir providers',
      run: async () => {
        const resp = await api('GET', '/api/mimir/providers', { role: 'ADMIN' });
        if (resp.status === 404) skip('mimir/providers not available');
        assertOk(resp, 'mimir providers');
      }
    },
    {
      name: 'PM reads mimir status',
      run: async () => {
        const resp = await api('GET', '/api/mimir/status', { role: 'PM' });
        if (resp.status === 404) skip('mimir/status not available');
        assertOk(resp, 'PM mimir');
      }
    }
  ]
};
