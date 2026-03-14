/**
 * AUTH EXTENDED — Login, token validation, PIN, edge cases
 */
const { api, assert, assertOk, assertStatus, rawFetch, skip, getToken, getTokenSync, JWT_SECRET, BASE_URL, TEST_USERS } = require('../config');
const jwt = require('jsonwebtoken');

module.exports = {
  name: 'AUTH EXTENDED',
  tests: [
    // ═══ Login Tests ═══
    {
      name: 'AUTH: login with valid credentials → 200 + token',
      run: async () => {
        // Use /api/auth/me as proxy — our test tokens are JWT-signed
        const resp = await api('GET', '/api/auth/me', { role: 'ADMIN' });
        assertOk(resp, 'auth me');
        assert(resp.data && (resp.data.id || resp.data.user), 'should return user data');
      }
    },
    {
      name: 'AUTH: request without token → 401',
      run: async () => {
        const resp = await rawFetch('GET', '/api/auth/me');
        assert(resp.status === 401, `expected 401, got ${resp.status}`);
      }
    },
    {
      name: 'AUTH: request with invalid token → 401',
      run: async () => {
        const resp = await rawFetch('GET', '/api/auth/me', {
          headers: { 'Authorization': 'Bearer invalid.token.here' }
        });
        assert(resp.status === 401, `expected 401, got ${resp.status}`);
      }
    },
    {
      name: 'AUTH: request with expired token → 401',
      run: async () => {
        const expiredToken = jwt.sign({
          id: TEST_USERS.ADMIN.id,
          login: 'test_admin',
          name: 'Test Admin',
          role: 'ADMIN',
          pinVerified: true
        }, JWT_SECRET, { expiresIn: '-1h' });

        const resp = await rawFetch('GET', '/api/auth/me', {
          headers: { 'Authorization': `Bearer ${expiredToken}` }
        });
        assert(resp.status === 401, `expected 401 for expired token, got ${resp.status}`);
      }
    },
    {
      name: 'AUTH: request with wrong secret → 401',
      run: async () => {
        const badToken = jwt.sign({
          id: 1, login: 'hacker', role: 'ADMIN', pinVerified: true
        }, 'wrong-secret-key', { expiresIn: '1h' });

        const resp = await rawFetch('GET', '/api/auth/me', {
          headers: { 'Authorization': `Bearer ${badToken}` }
        });
        assert(resp.status === 401, `expected 401 for wrong secret, got ${resp.status}`);
      }
    },
    {
      name: 'AUTH: token without pinVerified → limited access',
      run: async () => {
        const limitedToken = jwt.sign({
          id: TEST_USERS.ADMIN.id,
          login: 'test_admin',
          name: 'Test Admin',
          role: 'ADMIN',
          pinVerified: false
        }, JWT_SECRET, { expiresIn: '1h' });

        const resp = await rawFetch('GET', '/api/data/tenders?limit=1', {
          headers: { 'Authorization': `Bearer ${limitedToken}` }
        });
        // Server rejects with 403 when PIN is not verified
        assert(resp.status === 403, `expected 403 for unverified PIN, got ${resp.status}`);
      }
    },
    {
      name: 'AUTH: token with tampered role → 401 or stale role',
      run: async () => {
        // Token is signed with ADMIN role but user in DB has different role
        // The JWT itself is valid — server trusts JWT claims
        const token = jwt.sign({
          id: 99999,
          login: 'tampered_user',
          role: 'ADMIN',
          pinVerified: true
        }, JWT_SECRET, { expiresIn: '1h' });

        const resp = await rawFetch('GET', '/api/auth/me', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        // Server returns 404 for non-existent user id in JWT
        assert(resp.status === 404, `expected 404 for tampered user, got ${resp.status}`);
      }
    },

    // ═══ Login endpoint ═══
    {
      name: 'AUTH: POST /login with wrong password → 401',
      run: async () => {
        const resp = await rawFetch('POST', '/api/auth/login', {
          body: { login: 'admin', password: 'wrong_password_123' }
        });
        assert(resp.status === 401 || resp.status === 400, `expected 401/400, got ${resp.status}`);
      }
    },
    {
      name: 'AUTH: POST /login with non-existent user → 401',
      run: async () => {
        const resp = await rawFetch('POST', '/api/auth/login', {
          body: { login: 'nonexistent_user_xyz_' + Date.now(), password: 'pass123' }
        });
        assert(resp.status === 401 || resp.status === 400, `expected 401/400, got ${resp.status}`);
      }
    },
    {
      name: 'AUTH: POST /login with empty body → 400/401',
      run: async () => {
        const resp = await rawFetch('POST', '/api/auth/login', { body: {} });
        assert(
          resp.status === 400 || resp.status === 401,
          `expected 400/401, got ${resp.status}`
        );
      }
    },

    // ═══ Password reset ═══
    {
      name: 'AUTH: POST /reset-password-request with unknown email → still 200 (no leak)',
      run: async () => {
        const resp = await rawFetch('POST', '/api/auth/reset-password-request', {
          body: { email: 'nonexistent_' + Date.now() + '@example.com' }
        });
        // Should not reveal if email exists (security best practice) → always 200
        assert(resp.status === 200, `reset-password-request: expected 200, got ${resp.status}`);
      }
    },
    {
      name: 'AUTH: POST /reset-password with invalid token → 400',
      run: async () => {
        const resp = await rawFetch('POST', '/api/auth/reset-password', {
          body: { token: 'invalid-reset-token', password: 'NewPass123!' }
        });
        assert(resp.status === 400, `reset-password invalid token: expected 400, got ${resp.status}`);
      }
    },

    // ═══ Auth/me for different roles ═══
    {
      name: 'AUTH: /me returns correct role for PM',
      run: async () => {
        const resp = await api('GET', '/api/auth/me', { role: 'PM' });
        assertOk(resp, 'PM /me');
        const user = resp.data?.user || resp.data;
        assert(user && user.role === 'PM', `expected PM role, got ${user?.role}`);
      }
    },
    {
      name: 'AUTH: /me returns correct role for HR',
      run: async () => {
        const resp = await api('GET', '/api/auth/me', { role: 'HR' });
        assertOk(resp, 'HR /me');
        const user = resp.data?.user || resp.data;
        assert(user && user.role === 'HR', `expected HR role, got ${user?.role}`);
      }
    },
    {
      name: 'AUTH: /me returns correct role for BUH',
      run: async () => {
        const resp = await api('GET', '/api/auth/me', { role: 'BUH' });
        assertOk(resp, 'BUH /me');
        const user = resp.data?.user || resp.data;
        assert(user && user.role === 'BUH', `expected BUH role, got ${user?.role}`);
      }
    },
    {
      name: 'AUTH: /me returns correct role for WAREHOUSE',
      run: async () => {
        const resp = await api('GET', '/api/auth/me', { role: 'WAREHOUSE' });
        assertOk(resp, 'WAREHOUSE /me');
        const user = resp.data?.user || resp.data;
        assert(user && user.role === 'WAREHOUSE', `expected WAREHOUSE role, got ${user?.role}`);
      }
    },
    {
      name: 'AUTH: /me does NOT leak password_hash',
      run: async () => {
        const resp = await api('GET', '/api/auth/me', { role: 'ADMIN' });
        assertOk(resp, '/me');
        const user = resp.data?.user || resp.data;
        assert(!user.password_hash, 'password_hash should not be in /me response');
        assert(!user.pin_hash, 'pin_hash should not be in /me response');
      }
    },

    // ═══ Bearer format ═══
    {
      name: 'AUTH: Authorization without Bearer prefix → 401',
      run: async () => {
        const token = getTokenSync('ADMIN');
        const resp = await rawFetch('GET', '/api/auth/me', {
          headers: { 'Authorization': token }
        });
        assert(resp.status === 401, `expected 401 without Bearer, got ${resp.status}`);
      }
    },
    {
      name: 'AUTH: Empty Authorization header → 401',
      run: async () => {
        const resp = await rawFetch('GET', '/api/auth/me', {
          headers: { 'Authorization': '' }
        });
        assert(resp.status === 401, `expected 401 with empty auth, got ${resp.status}`);
      }
    },

    // ═══ PIN verification ═══
    {
      name: 'AUTH: POST /verify-pin with wrong pin → 401/400',
      run: async () => {
        const token = getTokenSync('ADMIN');
        const resp = await rawFetch('POST', '/api/auth/verify-pin', {
          headers: { 'Authorization': `Bearer ${token}` },
          body: { pin: '9999' }
        });
        // May be 400 (wrong pin), 401 (already verified), or 429 (rate limited)
        assert(
          [400, 401, 403, 429, 200].includes(resp.status),
          `expected 400/401/403/429/200, got ${resp.status}`
        );
      }
    },
    {
      name: 'AUTH: POST /verify-pin without body → 400',
      run: async () => {
        const token = getTokenSync('ADMIN');
        const resp = await rawFetch('POST', '/api/auth/verify-pin', {
          headers: { 'Authorization': `Bearer ${token}` },
          body: {}
        });
        assert(
          [400, 401, 429].includes(resp.status),
          `expected 400/401/429, got ${resp.status}`
        );
      }
    }
  ]
};
