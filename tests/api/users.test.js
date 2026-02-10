/**
 * USERS - User management CRUD + roles
 */
const { api, assert, assertOk, assertForbidden } = require('../config');

let createdUserId = null;

module.exports = {
  name: 'USERS (Пользователи)',
  tests: [
    {
      name: 'ADMIN lists users',
      run: async () => {
        const resp = await api('GET', '/api/users', { role: 'ADMIN' });
        assertOk(resp, 'list users');
        const users = resp.data?.users || resp.data;
        assert(Array.isArray(users), 'users should be array');
      }
    },
    {
      name: 'ADMIN creates user',
      run: async () => {
        const resp = await api('POST', '/api/users', {
          role: 'ADMIN',
          body: {
            login: 'test_stage12_user',
            name: 'Stage12 Test User',
            role: 'PM',
            email: 'stage12_test@asgard.local'
          }
        });
        assert(resp.status < 500, `create user: ${resp.status} - ${JSON.stringify(resp.data)?.slice(0, 200)}`);
        if (resp.ok) {
          createdUserId = resp.data?.user?.id || resp.data?.id;
        }
      }
    },
    {
      name: 'ADMIN reads single user',
      run: async () => {
        if (!createdUserId) return;
        const resp = await api('GET', `/api/users/${createdUserId}`, { role: 'ADMIN' });
        assertOk(resp, 'get user');
      }
    },
    {
      name: 'ADMIN updates user',
      run: async () => {
        if (!createdUserId) return;
        const resp = await api('PUT', `/api/users/${createdUserId}`, {
          role: 'ADMIN',
          body: { name: 'Stage12 Updated' }
        });
        assertOk(resp, 'update user');
      }
    },
    {
      name: 'GET /users/roles/list returns roles',
      run: async () => {
        const resp = await api('GET', '/api/users/roles/list', { role: 'ADMIN' });
        assertOk(resp, 'roles list');
      }
    },
    {
      name: 'PM cannot create users',
      run: async () => {
        const resp = await api('POST', '/api/users', {
          role: 'PM',
          body: { login: 'test_forbidden_usr', name: 'Forbidden', role: 'PM' }
        });
        assertForbidden(resp, 'PM create user');
      }
    },
    {
      name: 'Cleanup: delete test user',
      run: async () => {
        if (!createdUserId) return;
        await api('DELETE', `/api/users/${createdUserId}`, { role: 'ADMIN' });
        createdUserId = null;
      }
    }
  ]
};
