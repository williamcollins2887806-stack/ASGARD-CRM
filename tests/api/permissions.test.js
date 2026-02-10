/**
 * PERMISSIONS - Module permissions, presets, menu
 */
const { api, assert, assertOk, assertForbidden } = require('../config');

module.exports = {
  name: 'PERMISSIONS (Права доступа)',
  tests: [
    {
      name: 'ADMIN reads modules list',
      run: async () => {
        const resp = await api('GET', '/api/permissions/modules', { role: 'ADMIN' });
        assertOk(resp, 'modules');
      }
    },
    {
      name: 'ADMIN reads presets',
      run: async () => {
        const resp = await api('GET', '/api/permissions/presets', { role: 'ADMIN' });
        assertOk(resp, 'presets');
      }
    },
    {
      name: 'ADMIN reads own permissions (/my)',
      run: async () => {
        const resp = await api('GET', '/api/permissions/my', { role: 'ADMIN' });
        assertOk(resp, 'my perms');
      }
    },
    {
      name: 'PM reads own permissions',
      run: async () => {
        const resp = await api('GET', '/api/permissions/my', { role: 'PM' });
        assertOk(resp, 'PM my perms');
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
    }
  ]
};
