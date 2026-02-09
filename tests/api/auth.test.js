const { api, BASE_URL, TEST_USERS, assert } = require('../config');

module.exports = {
  name: 'AUTH',
  tests: [
    {
      name: 'Login with correct password returns need_pin or ok',
      run: async () => {
        const resp = await fetch(`${BASE_URL}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ login: 'test_admin', password: 'Test123!' })
        });
        const data = await resp.json();
        assert(resp.status === 200, `status ${resp.status}: ${JSON.stringify(data).slice(0,200)}`);
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
        assert(resp.status === 401 || resp.status === 400, `expected 401/400, got ${resp.status}`);
      }
    },
    {
      name: 'Login with nonexistent user returns 401',
      run: async () => {
        const resp = await fetch(`${BASE_URL}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ login: 'nobody_exists_xyz', password: 'Test123!' })
        });
        assert(resp.status === 401 || resp.status === 400 || resp.status === 404, `expected 401/400/404, got ${resp.status}`);
      }
    },
    {
      name: 'GET /api/auth/me with valid JWT returns user',
      run: async () => {
        const resp = await api('GET', '/api/auth/me', { role: 'ADMIN' });
        assert(resp.ok, `status ${resp.status}`);
        assert(resp.data.user?.role === 'ADMIN' || resp.data.role === 'ADMIN', 'role mismatch');
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
    }
  ]
};
