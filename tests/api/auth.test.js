/**
 * AUTH — Login flow, JWT validation, edge cases
 */
const { api, BASE_URL, TEST_USERS, assert, assertHasFields } = require('../config');

module.exports = {
  name: 'AUTH (deep)',
  tests: [
    // C1: Split into two separate strict tests
    {
      name: 'Login with correct credentials returns 200 with need_pin or token',
      run: async () => {
        const resp = await fetch(`${BASE_URL}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ login: 'test_admin', password: 'Test123!' })
        });
        const data = await resp.json();
        assert(resp.status === 200, `correct credentials: expected 200, got ${resp.status}: ${JSON.stringify(data).slice(0,200)}`);
        assert(data.status === 'need_pin' || data.status === 'ok' || data.token, `unexpected response: ${data.status}`);
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
        assert(resp.status === 401, `wrong password: expected 401, got ${resp.status}`);
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
        assert(resp.status === 401, `nonexistent user: expected 401, got ${resp.status}`);
      }
    },
    {
      // D1: Empty body login → strict 400
      name: 'NEGATIVE: Login with empty body → 400',
      run: async () => {
        const resp = await fetch(`${BASE_URL}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        assert(resp.status === 400, `empty body: expected 400, got ${resp.status}`);
      }
    },
    {
      // D2: Missing password → strict 400
      name: 'NEGATIVE: Login with missing password → 400',
      run: async () => {
        const resp = await fetch(`${BASE_URL}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ login: 'test_admin' })
        });
        assert(resp.status === 400, `missing password: expected 400, got ${resp.status}`);
      }
    },
    {
      // C2: /me with valid token → strict 200
      name: 'GET /api/auth/me with valid JWT returns 200 with user and correct role',
      run: async () => {
        const resp = await api('GET', '/api/auth/me', { role: 'ADMIN' });
        assert(resp.status === 200, `auth/me: expected 200, got ${resp.status}`);
        const user = resp.data?.user || resp.data;
        assert(user.role === 'ADMIN', `expected ADMIN role, got ${user.role}`);
        assertHasFields(user, ['id', 'role'], 'auth/me');
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
