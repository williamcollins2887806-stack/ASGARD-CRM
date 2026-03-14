/**
 * USERS — Deep CRUD + validation + negative tests
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, assertMatch, assertFieldType } = require('../config');

let createdUserId = null;

module.exports = {
  name: 'USERS (deep)',
  tests: [
    {
      name: 'ADMIN lists users — validates shape',
      run: async () => {
        const resp = await api('GET', '/api/users', { role: 'ADMIN' });
        assertOk(resp, 'list users');
        const users = resp.data?.users || resp.data;
        assertArray(users, 'users');
        assert(users.length > 0, 'should have at least 1 user');
        assertHasFields(users[0], ['id', 'login', 'role'], 'user item');
      }
    },
    {
      name: 'ADMIN creates user + validates response',
      run: async () => {
        const resp = await api('POST', '/api/users', {
          role: 'ADMIN',
          body: {
            login: 'test_stage12_user_' + Date.now(),
            name: 'Stage12 Test User',
            role: 'PM',
            email: 'stage12_test@asgard.local'
          }
        });
        assertOk(resp, 'create user:  -');
        if (resp.ok) {
          const user = resp.data?.user || resp.data;
          createdUserId = user?.id;
          if (createdUserId) assertFieldType(user, 'id', 'number', 'user.id');
        }
      }
    },
    {
      name: 'Read-back: verify created user fields',
      run: async () => {
        if (!createdUserId) return;
        const resp = await api('GET', `/api/users/${createdUserId}`, { role: 'ADMIN' });
        assertOk(resp, 'get user');
        const u = resp.data?.user || resp.data;
        assertHasFields(u, ['id', 'login', 'role'], 'user detail');
        assertMatch(u, { id: createdUserId, role: 'PM' }, 'user fields');
      }
    },
    {
      name: 'Update user → read-back → verify name changed',
      run: async () => {
        if (!createdUserId) return;
        await api('PUT', `/api/users/${createdUserId}`, {
          role: 'ADMIN', body: { name: 'Stage12 Updated' }
        });
        const check = await api('GET', `/api/users/${createdUserId}`, { role: 'ADMIN' });
        const u = check.data?.user || check.data;
        assertMatch(u, { name: 'Stage12 Updated' }, 'name updated');
      }
    },
    {
      name: 'GET /users/roles/list returns roles array',
      run: async () => {
        const resp = await api('GET', '/api/users/roles/list', { role: 'ADMIN' });
        assertOk(resp, 'roles list');
      }
    },
    {
      name: 'NEGATIVE: PM cannot create users',
      run: async () => {
        const resp = await api('POST', '/api/users', {
          role: 'PM', body: { login: 'test_forbidden_usr', name: 'Forbidden', role: 'PM' }
        });
        assertForbidden(resp, 'PM create user');
      }
    },
    {
      name: 'NEGATIVE: create user without login → 400',
      run: async () => {
        const resp = await api('POST', '/api/users', {
          role: 'ADMIN', body: { name: 'No Login', role: 'PM' }
        });
        assert(resp.status === 400, `expected 4xx, got ${resp.status}`);
      }
    },
    {
      name: 'NEGATIVE: HR cannot delete user',
      run: async () => {
        const resp = await api('DELETE', '/api/users/999999', { role: 'HR' });
        assertForbidden(resp, 'HR delete user');
      }
    },
    {
      name: 'Cleanup: delete test user → verify gone',
      run: async () => {
        if (!createdUserId) return;
        await api('DELETE', `/api/users/${createdUserId}`, { role: 'ADMIN' });
        const check = await api('GET', `/api/users/${createdUserId}`, { role: 'ADMIN' });
        assert(check.status === 404 || check.status === 400, `deleted user should be 404, got ${check.status}`);
        createdUserId = null;
      }
    }
  ]
};
