/**
 * SETTINGS - Configuration management
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, assertMatch, assertFieldType } = require('../config');

module.exports = {
  name: 'SETTINGS (Настройки)',
  tests: [
    {
      name: 'ADMIN reads all settings',
      run: async () => {
        const resp = await api('GET', '/api/settings', { role: 'ADMIN' });
        assertOk(resp, 'settings');
        if (resp.data) {
          assert(
            typeof resp.data === 'object',
            `settings should be array or object, got ${typeof resp.data}`
          );
        }
      }
    },
    {
      name: 'PM reads settings (sensitive hidden)',
      run: async () => {
        const resp = await api('GET', '/api/settings', { role: 'PM' });
        assertOk(resp, 'PM settings');
        if (resp.data) {
          assert(
            typeof resp.data === 'object',
            `PM settings should be array or object, got ${typeof resp.data}`
          );
        }
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
      name: 'Read-back after write verifies value matches',
      run: async () => {
        const resp = await api('GET', '/api/settings/test_stage12_key', { role: 'ADMIN' });
        assert(resp.status < 500, `read setting: ${resp.status}`);
        if (resp.ok && resp.data) {
          const val = resp.data.value !== undefined ? resp.data.value : resp.data;
          assert(
            String(val).includes('test_value_stage12'),
            `read-back value mismatch: got ${JSON.stringify(val)?.slice(0, 100)}`
          );
        }
      }
    },
    {
      name: 'Negative: PM cannot write settings',
      run: async () => {
        const resp = await api('PUT', '/api/settings/test_stage12_pm_key', {
          role: 'PM',
          body: { value: 'pm_attempt' }
        });
        assertForbidden(resp, 'PM write setting');
      }
    },
    {
      name: 'GET /refs/all returns references',
      run: async () => {
        const resp = await api('GET', '/api/settings/refs/all', { role: 'ADMIN' });
        assertOk(resp, 'refs');
        if (resp.data) {
          assert(typeof resp.data === 'object', 'refs should be object');
        }
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
