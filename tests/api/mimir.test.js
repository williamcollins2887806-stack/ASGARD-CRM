/**
 * MIMIR - AI assistant endpoints
 */
const { api, assert } = require('../config');

module.exports = {
  name: 'MIMIR (AI Ассистент)',
  tests: [
    {
      name: 'ADMIN reads mimir status',
      run: async () => {
        const resp = await api('GET', '/api/mimir/status', { role: 'ADMIN' });
        assert(resp.status < 500, `mimir status: ${resp.status}`);
      }
    },
    {
      name: 'ADMIN reads mimir providers',
      run: async () => {
        const resp = await api('GET', '/api/mimir/providers', { role: 'ADMIN' });
        assert(resp.status < 500, `mimir providers: ${resp.status}`);
      }
    },
    {
      name: 'PM reads mimir status',
      run: async () => {
        const resp = await api('GET', '/api/mimir/status', { role: 'PM' });
        assert(resp.status < 500, `PM mimir: ${resp.status}`);
      }
    }
  ]
};
