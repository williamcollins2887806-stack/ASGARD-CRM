/**
 * GEO - Geocoding endpoints
 */
const { api, assert, assertOk } = require('../config');

module.exports = {
  name: 'GEO (Геокодирование)',
  tests: [
    {
      name: 'ADMIN reads geo status',
      run: async () => {
        const resp = await api('GET', '/api/geo/status', { role: 'ADMIN' });
        assert(resp.status < 500, `geo status: ${resp.status}`);
      }
    },
    {
      name: 'PM reads geo data',
      run: async () => {
        const resp = await api('GET', '/api/geo/sites', { role: 'PM' });
        assert(resp.status < 500, `geo sites: ${resp.status}`);
      }
    }
  ]
};
