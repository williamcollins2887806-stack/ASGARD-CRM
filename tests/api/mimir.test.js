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
        const resp = await api('GET', '/api/mimir/health', { role: 'ADMIN' });
        if (resp.status === 404) skip('mimir/health not available');
        assertOk(resp, 'mimir status');
      }
    },
    {
      name: 'ADMIN reads mimir providers',
      run: async () => {
        const resp = await api('GET', '/api/mimir/admin/config', { role: 'ADMIN' });
        if (resp.status === 404) skip('mimir/admin/config not available');
        assertOk(resp, 'mimir providers');
      }
    },
    {
      name: 'PM reads mimir status',
      run: async () => {
        const resp = await api('GET', '/api/mimir/health', { role: 'PM' });
        if (resp.status === 404) skip('mimir/health not available');
        assertOk(resp, 'PM mimir');
      }
    }
  ]
};
