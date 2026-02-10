/**
 * PERMISSIONS - Module permissions, presets, menu
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, assertMatch, assertFieldType } = require('../config');

module.exports = {
  name: 'PERMISSIONS (Права доступа)',
  tests: [
    {
      name: 'ADMIN reads modules list',
      run: async () => {
        const resp = await api('GET', '/api/permissions/modules', { role: 'ADMIN' });
        assertOk(resp, 'modules');
        if (resp.data) {
          const modules = Array.isArray(resp.data) ? resp.data : (resp.data.modules || []);
          assertArray(modules, 'modules list');
        }
      }
    },
    {
      name: 'ADMIN reads presets',
      run: async () => {
        const resp = await api('GET', '/api/permissions/presets', { role: 'ADMIN' });
        assertOk(resp, 'presets');
        if (resp.data) {
          const presets = Array.isArray(resp.data) ? resp.data : (resp.data.presets || []);
          assertArray(presets, 'presets list');
        }
      }
    },
    {
      name: 'ADMIN reads own permissions (/my)',
      run: async () => {
        const resp = await api('GET', '/api/permissions/my', { role: 'ADMIN' });
        assertOk(resp, 'my perms');
        if (resp.data) {
          assert(typeof resp.data === 'object', 'my perms should be object');
        }
      }
    },
    {
      name: 'PM reads own permissions',
      run: async () => {
        const resp = await api('GET', '/api/permissions/my', { role: 'PM' });
        assertOk(resp, 'PM my perms');
        if (resp.data) {
          assert(typeof resp.data === 'object', 'PM my perms should be object');
        }
      }
    },
    {
      name: 'ADMIN reads user permissions',
      run: async () => {
        const users = await api('GET', '/api/users', { role: 'ADMIN' });
        const userList = Array.isArray(users.data) ? users.data : (users.data?.users || []);
        const u = userList[0];
        if (!u) return;
        const resp = await api('GET', `/api/permissions/user/${u.id}`, { role: 'ADMIN' });
        assertOk(resp, 'user perms');
        if (resp.data) {
          assert(typeof resp.data === 'object', 'user perms should be object');
        }
      }
    },
    {
      name: 'ADMIN reads menu settings',
      run: async () => {
        const resp = await api('GET', '/api/permissions/menu', { role: 'ADMIN' });
        assertOk(resp, 'menu');
      }
    },
    {
      name: 'PM cannot read other user permissions',
      run: async () => {
        const resp = await api('GET', '/api/permissions/user/1', { role: 'PM' });
        assertForbidden(resp, 'PM read user perms');
      }
    },
    {
      name: 'Negative: PM cannot update other user permissions',
      run: async () => {
        const resp = await api('PUT', '/api/permissions/user/1', {
          role: 'PM',
          body: { modules: { cash: { read: true } } }
        });
        assertForbidden(resp, 'PM update user perms');
      }
    }
  ]
};
