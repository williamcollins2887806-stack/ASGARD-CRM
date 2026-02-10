/**
 * INTEGRATIONS - Bank/1C/Platform imports
 */
const { api, assert, assertOk, assertForbidden } = require('../config');

module.exports = {
  name: 'INTEGRATIONS (Интеграции)',
  tests: [
    {
      name: 'ADMIN reads bank batches',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/batches', { role: 'ADMIN' });
        assertOk(resp, 'bank batches');
      }
    },
    {
      name: 'BUH reads bank batches',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/batches', { role: 'BUH' });
        assertOk(resp, 'BUH bank batches');
      }
    },
    {
      name: 'DIRECTOR_GEN reads bank batches',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/batches', { role: 'DIRECTOR_GEN' });
        assertOk(resp, 'DIR bank batches');
      }
    },
    {
      name: 'PM can also access bank batches (authenticate only)',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/batches', { role: 'PM' });
        assertOk(resp, 'PM bank batches');
      }
    },
    {
      name: 'ADMIN reads ERP sync',
      run: async () => {
        const resp = await api('GET', '/api/integrations/erp/sync', { role: 'ADMIN' });
        assert(resp.status < 500, `erp sync: ${resp.status}`);
      }
    }
  ]
};
