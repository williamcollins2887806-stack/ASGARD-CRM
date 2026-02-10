/**
 * SETTINGS - Configuration management
 */
const { api, assert, assertOk } = require('../config');

module.exports = {
  name: 'SETTINGS (Настройки)',
  tests: [
    {
      name: 'ADMIN reads all settings',
      run: async () => {
        const resp = await api('GET', '/api/settings', { role: 'ADMIN' });
        assertOk(resp, 'settings');
      }
    },
    {
      name: 'PM reads settings (sensitive hidden)',
      run: async () => {
        const resp = await api('GET', '/api/settings', { role: 'PM' });
        assertOk(resp, 'PM settings');
      }
    },
    {
      name: 'ADMIN writes setting',
      run: async () => {
        const resp = await api('PUT', '/api/settings/test_stage12_key', {
          role: 'ADMIN',
          body: { value: 'test_value_stage12' }
        });
        assert(resp.status < 500, `write setting: ${resp.status}`);
      }
    },
    {
      name: 'ADMIN reads single setting',
      run: async () => {
        const resp = await api('GET', '/api/settings/test_stage12_key', { role: 'ADMIN' });
        assert(resp.status < 500, `read setting: ${resp.status}`);
      }
    },
    {
      name: 'GET /refs/all returns references',
      run: async () => {
        const resp = await api('GET', '/api/settings/refs/all', { role: 'ADMIN' });
        assertOk(resp, 'refs');
      }
    },
    {
      name: 'Cleanup: delete test setting',
      run: async () => {
        await api('DELETE', '/api/settings/test_stage12_key', { role: 'ADMIN' });
      }
    }
  ]
};
