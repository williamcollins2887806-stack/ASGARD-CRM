/**
 * PERMIT_APPLICATIONS - Permit application workflow
 */
const { api, assert, assertOk } = require('../config');

module.exports = {
  name: 'PERMIT APPLICATIONS (Заявки на допуски)',
  tests: [
    {
      name: 'ADMIN reads permit applications',
      run: async () => {
        const resp = await api('GET', '/api/permit-applications', { role: 'ADMIN' });
        assert(resp.status < 500, `permit apps: ${resp.status} - ${JSON.stringify(resp.data)?.slice(0, 200)}`);
      }
    },
    {
      name: 'HR reads permit applications',
      run: async () => {
        const resp = await api('GET', '/api/permit-applications', { role: 'HR' });
        assert(resp.status < 500, `HR permit apps: ${resp.status}`);
      }
    },
    {
      name: 'ADMIN reads permit application stats',
      run: async () => {
        const resp = await api('GET', '/api/permit-applications/stats', { role: 'ADMIN' });
        assert(resp.status < 500, `permit app stats: ${resp.status}`);
      }
    }
  ]
};
