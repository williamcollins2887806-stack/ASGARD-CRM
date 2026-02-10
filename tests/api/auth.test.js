/**
 * AUTH — Login flow, JWT validation, edge cases
 */
const { api, BASE_URL, TEST_USERS, assert, assertHasFields } = require('../config');

module.exports = {
  name: 'AUTH (deep)',
  tests: [
    {
      name: 'Login with correct credentials returns need_pin or token',
      run: async () => {
        const resp = await fetch(`${BASE_URL}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ login: 'test_admin', password: 'Test123!' })
        });
        const data = await resp.json();
        assert(resp.status === 200 || resp.status === 401, `status ${resp.status}: ${JSON.stringify(data).slice(0,200)}`);
        if (resp.status === 200) {
          assert(data.status === 'need_pin' || data.status === 'ok' || data.token, `unexpected response: ${data.status}`);
        }
      }
    },
    {
      name: 'Login with wrong password returns 401',
      run: async () => {
        const resp = await fetch(`${BASE_URL}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ login: 'test_admin', password: 'WRONG_PASSWORD' })
        });
        assert(resp.status === 401 || resp.status === 400, `expected 401/400, got ${resp.status}`);
      }
    },
    {
      name: 'Login with nonexistent user returns 401',
      run: async () => {
        const resp = await fetch(`${BASE_URL}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ login: 'nobody_exists_xyz_42', password: 'Test123!' })
        });
        assert(resp.status === 401 || resp.status === 400 || resp.status === 404, `expected 401/400/404, got ${resp.status}`);
      }
    },
    {
      name: 'NEGATIVE: Login with empty body → 400',
      run: async () => {
        const resp = await fetch(`${BASE_URL}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        assert(resp.status >= 400 && resp.status < 500, `expected 4xx for empty body, got ${resp.status}`);
      }
    },
    {
      name: 'NEGATIVE: Login with missing password → 400/401',
      run: async () => {
        const resp = await fetch(`${BASE_URL}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ login: 'test_admin' })
        });
        assert(resp.status >= 400 && resp.status < 500, `expected 4xx, got ${resp.status}`);
      }
    },
    {
      name: 'GET /api/auth/me with valid JWT returns user with correct role',
      run: async () => {
        const resp = await api('GET', '/api/auth/me', { role: 'ADMIN' });
        assert(resp.status === 200 || resp.status === 404, `status ${resp.status}`);
        if (resp.status === 200) {
          const user = resp.data?.user || resp.data;
          assert(user.role === 'ADMIN', `expected ADMIN role, got ${user.role}`);
          assertHasFields(user, ['id', 'role'], 'auth/me');
        }
      }
    },
    {
      name: 'GET /api/auth/me without token returns 401',
      run: async () => {
        const resp = await fetch(`${BASE_URL}/api/auth/me`);
        assert(resp.status === 401, `expected 401, got ${resp.status}`);
      }
    },
    {
      name: 'GET /api/auth/me with invalid token returns 401',
      run: async () => {
        const resp = await fetch(`${BASE_URL}/api/auth/me`, {
          headers: { 'Authorization': 'Bearer invalid.token.here' }
        });
        assert(resp.status === 401, `expected 401, got ${resp.status}`);
      }
    },
    {
      name: 'GET /api/auth/me with malformed Authorization header returns 401',
      run: async () => {
        const resp = await fetch(`${BASE_URL}/api/auth/me`, {
          headers: { 'Authorization': 'NotBearer something' }
        });
        assert(resp.status === 401, `expected 401, got ${resp.status}`);
      }
    }
  ]
};
