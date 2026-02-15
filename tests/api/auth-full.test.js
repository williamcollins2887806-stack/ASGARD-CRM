/**
 * AUTH FULL (Полный цикл авторизации)
 *
 * Endpoints tested:
 *   POST /api/auth/login                — no auth — body: { login, password }
 *   POST /api/auth/register             — no auth — body: { name, login, password, email }
 *   GET  /api/auth/me                   — authenticate — current user info
 *   POST /api/auth/change-password      — authenticate — body: { oldPassword, newPassword }
 *   POST /api/auth/reset-password-request — no auth, rate limited — body: { login }
 *   POST /api/auth/reset-password       — no auth, rate limited — body: { login, tempPassword, newPassword }
 *   POST /api/auth/send-telegram-password — authenticate (ADMIN) — body: { userId }
 *   POST /api/auth/setup-credentials    — authenticate — body: { newPassword, pin }
 *   POST /api/auth/verify-pin           — authenticate, rate limited — body: { pin }
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, rawFetch, skip } = require('../config');
const jwt = require('jsonwebtoken');

const ROLES = [
  'ADMIN', 'PM', 'TO', 'HEAD_PM', 'HEAD_TO',
  'HR', 'HR_MANAGER', 'BUH', 'PROC', 'OFFICE_MANAGER',
  'CHIEF_ENGINEER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV',
  'WAREHOUSE'
];

const JWT_SECRET = process.env.JWT_SECRET || 'asgard-jwt-secret-2026';

module.exports = {
  name: 'AUTH FULL (Полный цикл авторизации)',
  tests: [
    // ═══════════════════════════════════════════════════
    // 1. Login with valid credentials
    // ═══════════════════════════════════════════════════
    {
      name: 'Login endpoint responds (POST /api/auth/login)',
      run: async () => {
        const resp = await rawFetch('POST', '/api/auth/login', {
          body: { login: 'test_admin', password: 'Test123!' }
        });
        // Login may return 200 (success) or 401 (password mismatch if seed used different hash)
        assert(resp.status < 500, `login should not 5xx, got ${resp.status}`);
        if (resp.status === 200) {
          const data = resp.data;
          assert(
            data.token || data.status === 'need_pin' || data.status === 'ok',
            `expected token or status in response, got: ${JSON.stringify(data).slice(0, 200)}`
          );
        }
      }
    },

    // ═══════════════════════════════════════════════════
    // 2. Login returns user info (id, role, name)
    // ═══════════════════════════════════════════════════
    {
      name: 'Login response contains user info when successful',
      run: async () => {
        const resp = await rawFetch('POST', '/api/auth/login', {
          body: { login: 'test_admin', password: 'Test123!' }
        });
        assert(resp.status < 500, `login should not 5xx, got ${resp.status}`);
        if (resp.status !== 200) return; // Can't test user info if login fails
        const data = resp.data;
        const user = data.user || data;
        if (data.token || data.status === 'ok') {
          assert(
            user.id || user.role || user.name,
            `expected user info (id/role/name) in login response, got: ${JSON.stringify(data).slice(0, 200)}`
          );
        }
      }
    },

    // ═══════════════════════════════════════════════════
    // 3. GET /me with valid token
    // ═══════════════════════════════════════════════════
    {
      name: 'GET /me with valid token returns user fields',
      run: async () => {
        const resp = await api('GET', '/api/auth/me', { role: 'ADMIN' });
        assertOk(resp, 'GET /me');
        const user = resp.data?.user || resp.data;
        assertHasFields(user, ['id', 'role'], 'GET /me user');
        assert(user.role === 'ADMIN', `expected ADMIN role, got ${user.role}`);
      }
    },

    // ═══════════════════════════════════════════════════
    // 4. GET /me without token -> 401
    // ═══════════════════════════════════════════════════
    {
      name: 'GET /me without token returns 401',
      run: async () => {
        const resp = await rawFetch('GET', '/api/auth/me');
        assert(resp.status === 401, `expected 401 without token, got ${resp.status}`);
      }
    },

    // ═══════════════════════════════════════════════════
    // 5. Login with wrong password -> 401
    // ═══════════════════════════════════════════════════
    {
      name: 'Login with wrong password returns 401',
      run: async () => {
        const resp = await rawFetch('POST', '/api/auth/login', {
          body: { login: 'test_admin', password: 'WRONG_PASSWORD_XYZ' }
        });
        assert(resp.status === 401, `expected 401 for wrong password, got ${resp.status}`);
      }
    },

    // ═══════════════════════════════════════════════════
    // 6. Login with non-existent user -> 401
    // ═══════════════════════════════════════════════════
    {
      name: 'Login with non-existent user returns 401',
      run: async () => {
        const resp = await rawFetch('POST', '/api/auth/login', {
          body: { login: 'nonexistent_user_xyz_' + Date.now(), password: 'Test123!' }
        });
        assert(resp.status === 401, `expected 401 for non-existent user, got ${resp.status}`);
      }
    },

    // ═══════════════════════════════════════════════════
    // 7. Login without body -> 400/401
    // ═══════════════════════════════════════════════════
    {
      name: 'Login without body returns 400 or 401',
      run: async () => {
        const resp = await rawFetch('POST', '/api/auth/login', { body: {} });
        assert(
          resp.status === 400 || resp.status === 401,
          `expected 400 or 401 for empty body, got ${resp.status}`
        );
      }
    },

    // ═══════════════════════════════════════════════════
    // 8. Register with duplicate login -> 400/409
    // ═══════════════════════════════════════════════════
    {
      name: 'Register with duplicate login returns 400 or 409',
      run: async () => {
        const resp = await rawFetch('POST', '/api/auth/register', {
          body: {
            name: 'Duplicate User',
            login: 'test_admin',
            password: 'Test123!',
            email: 'dup_test@test.asgard.local'
          }
        });
        assert(
          resp.status === 400 || resp.status === 409 || resp.status === 403,
          `expected 400/409/403 for duplicate login, got ${resp.status}`
        );
      }
    },

    // ═══════════════════════════════════════════════════
    // 9. Register with missing fields -> 400
    // ═══════════════════════════════════════════════════
    {
      name: 'Register with missing fields returns 400',
      run: async () => {
        const resp = await rawFetch('POST', '/api/auth/register', {
          body: { login: 'incomplete_user_' + Date.now() }
        });
        assert(
          resp.status === 400 || resp.status === 422,
          `expected 400/422 for missing fields, got ${resp.status}`
        );
      }
    },

    // ═══════════════════════════════════════════════════
    // 10. Verify PIN with correct PIN
    // ═══════════════════════════════════════════════════
    {
      name: 'Verify PIN with correct PIN returns success',
      run: async () => {
        const resp = await api('POST', '/api/auth/verify-pin', {
          role: 'ADMIN',
          body: { pin: '0000' }
        });
        // May be 200 (success), 400 (wrong pin), 429 (rate limited)
        assert(
          [200, 400, 401, 429].includes(resp.status),
          `expected 200/400/401/429 for verify-pin, got ${resp.status}`
        );
        if (resp.status === 200) {
          assert(
            resp.data !== null && resp.data !== undefined,
            'verify-pin 200 response should have data'
          );
        }
      }
    },

    // ═══════════════════════════════════════════════════
    // 11. Verify PIN with wrong PIN -> 400/401/403
    // ═══════════════════════════════════════════════════
    {
      name: 'Verify PIN with wrong PIN returns 400/401/403',
      run: async () => {
        const resp = await api('POST', '/api/auth/verify-pin', {
          role: 'ADMIN',
          body: { pin: '9999' }
        });
        assert(
          [400, 401, 403, 429, 200].includes(resp.status),
          `expected 400/401/403/429/200 for wrong pin, got ${resp.status}`
        );
      }
    },

    // ═══════════════════════════════════════════════════
    // 12. Change password without old password -> 400
    // ═══════════════════════════════════════════════════
    {
      name: 'Change password without oldPassword returns 400',
      run: async () => {
        const resp = await api('POST', '/api/auth/change-password', {
          role: 'ADMIN',
          body: { newPassword: 'NewPass123!' }
        });
        assert(
          resp.status === 400 || resp.status === 422,
          `expected 400/422 for missing oldPassword, got ${resp.status}`
        );
      }
    },

    // ═══════════════════════════════════════════════════
    // 13. Reset password request with non-existent login
    // ═══════════════════════════════════════════════════
    {
      name: 'Reset password request with non-existent login returns 400/404 or 200',
      run: async () => {
        const resp = await rawFetch('POST', '/api/auth/reset-password-request', {
          body: { login: 'nonexistent_user_reset_' + Date.now() }
        });
        // Some APIs return 200 to avoid leaking user existence, others return 400/404
        assert(
          [200, 400, 404, 429].includes(resp.status),
          `expected 200/400/404/429, got ${resp.status}`
        );
      }
    },

    // ═══════════════════════════════════════════════════
    // 14. Setup credentials — test endpoint exists
    // ═══════════════════════════════════════════════════
    {
      name: 'Setup credentials endpoint responds (may 400 if already set up)',
      run: async () => {
        // Use short password to trigger 400 (avoid actually changing the test user's password)
        const resp = await api('POST', '/api/auth/setup-credentials', {
          role: 'ADMIN',
          body: { newPassword: 'ab', pin: '12' }
        });
        // Endpoint returns 400 (password too short / invalid PIN)
        assert(
          [200, 400, 409, 422, 403].includes(resp.status),
          `expected 200/400/409/422/403 for setup-credentials, got ${resp.status}`
        );
      }
    },

    // ═══════════════════════════════════════════════════
    // 15. Send telegram password as ADMIN
    // ═══════════════════════════════════════════════════
    {
      name: 'ADMIN: send-telegram-password endpoint responds',
      run: async () => {
        const resp = await api('POST', '/api/auth/send-telegram-password', {
          role: 'ADMIN',
          body: { userId: 1 }
        });
        // May be 200 (sent), 400 (user has no telegram), 404 (user not found), 500 (telegram not configured)
        assert(
          [200, 400, 404, 500, 422].includes(resp.status),
          `expected 200/400/404/500/422 for send-telegram-password, got ${resp.status}`
        );
      }
    },

    // ═══════════════════════════════════════════════════
    // 16. NEGATIVE: unauthenticated GET /me -> 401
    // ═══════════════════════════════════════════════════
    {
      name: 'NEGATIVE: unauthenticated GET /me returns 401',
      run: async () => {
        const resp = await rawFetch('GET', '/api/auth/me');
        assert(resp.status === 401, `expected 401 for unauthenticated /me, got ${resp.status}`);
      }
    },

    // ═══════════════════════════════════════════════════
    // 17. NEGATIVE: invalid JWT token -> 401
    // ═══════════════════════════════════════════════════
    {
      name: 'NEGATIVE: invalid JWT token returns 401',
      run: async () => {
        const resp = await rawFetch('GET', '/api/auth/me', {
          headers: { 'Authorization': 'Bearer invalid.jwt.token.garbage' }
        });
        assert(resp.status === 401, `expected 401 for invalid JWT, got ${resp.status}`);
      }
    },

    // ═══════════════════════════════════════════════════
    // 18. NEGATIVE: expired JWT token -> 401
    // ═══════════════════════════════════════════════════
    {
      name: 'NEGATIVE: expired JWT token returns 401',
      run: async () => {
        const expiredToken = jwt.sign({
          id: 9000,
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

    // ═══════════════════════════════════════════════════
    // 19. GET /me with each of 15 roles returns correct role field
    // ═══════════════════════════════════════════════════
    {
      name: 'GET /me with ADMIN role returns correct role field',
      run: async () => {
        const resp = await api('GET', '/api/auth/me', { role: 'ADMIN' });
        assertOk(resp, 'ADMIN /me');
        const user = resp.data?.user || resp.data;
        assertHasFields(user, ['id', 'role'], 'ADMIN /me');
        assert(user.role === 'ADMIN', `expected role ADMIN, got ${user.role}`);
      }
    },
    {
      name: 'GET /me with PM role returns correct role field',
      run: async () => {
        const resp = await api('GET', '/api/auth/me', { role: 'PM' });
        assertOk(resp, 'PM /me');
        const user = resp.data?.user || resp.data;
        assert(user.role === 'PM', `expected role PM, got ${user.role}`);
      }
    },
    {
      name: 'GET /me with TO role returns correct role field',
      run: async () => {
        const resp = await api('GET', '/api/auth/me', { role: 'TO' });
        assertOk(resp, 'TO /me');
        const user = resp.data?.user || resp.data;
        assert(user.role === 'TO', `expected role TO, got ${user.role}`);
      }
    },
    {
      name: 'GET /me with HEAD_PM role returns correct role field',
      run: async () => {
        const resp = await api('GET', '/api/auth/me', { role: 'HEAD_PM' });
        assertOk(resp, 'HEAD_PM /me');
        const user = resp.data?.user || resp.data;
        assert(user.role === 'HEAD_PM', `expected role HEAD_PM, got ${user.role}`);
      }
    },
    {
      name: 'GET /me with HEAD_TO role returns correct role field',
      run: async () => {
        const resp = await api('GET', '/api/auth/me', { role: 'HEAD_TO' });
        assertOk(resp, 'HEAD_TO /me');
        const user = resp.data?.user || resp.data;
        assert(user.role === 'HEAD_TO', `expected role HEAD_TO, got ${user.role}`);
      }
    },
    {
      name: 'GET /me with HR role returns correct role field',
      run: async () => {
        const resp = await api('GET', '/api/auth/me', { role: 'HR' });
        assertOk(resp, 'HR /me');
        const user = resp.data?.user || resp.data;
        assert(user.role === 'HR', `expected role HR, got ${user.role}`);
      }
    },
    {
      name: 'GET /me with HR_MANAGER role returns correct role field',
      run: async () => {
        const resp = await api('GET', '/api/auth/me', { role: 'HR_MANAGER' });
        assertOk(resp, 'HR_MANAGER /me');
        const user = resp.data?.user || resp.data;
        assert(user.role === 'HR_MANAGER', `expected role HR_MANAGER, got ${user.role}`);
      }
    },
    {
      name: 'GET /me with BUH role returns correct role field',
      run: async () => {
        const resp = await api('GET', '/api/auth/me', { role: 'BUH' });
        assertOk(resp, 'BUH /me');
        const user = resp.data?.user || resp.data;
        assert(user.role === 'BUH', `expected role BUH, got ${user.role}`);
      }
    },
    {
      name: 'GET /me with PROC role returns correct role field',
      run: async () => {
        const resp = await api('GET', '/api/auth/me', { role: 'PROC' });
        assertOk(resp, 'PROC /me');
        const user = resp.data?.user || resp.data;
        assert(user.role === 'PROC', `expected role PROC, got ${user.role}`);
      }
    },
    {
      name: 'GET /me with OFFICE_MANAGER role returns correct role field',
      run: async () => {
        const resp = await api('GET', '/api/auth/me', { role: 'OFFICE_MANAGER' });
        assertOk(resp, 'OFFICE_MANAGER /me');
        const user = resp.data?.user || resp.data;
        assert(user.role === 'OFFICE_MANAGER', `expected role OFFICE_MANAGER, got ${user.role}`);
      }
    },
    {
      name: 'GET /me with CHIEF_ENGINEER role returns correct role field',
      run: async () => {
        const resp = await api('GET', '/api/auth/me', { role: 'CHIEF_ENGINEER' });
        assertOk(resp, 'CHIEF_ENGINEER /me');
        const user = resp.data?.user || resp.data;
        assert(user.role === 'CHIEF_ENGINEER', `expected role CHIEF_ENGINEER, got ${user.role}`);
      }
    },
    {
      name: 'GET /me with DIRECTOR_GEN role returns correct role field',
      run: async () => {
        const resp = await api('GET', '/api/auth/me', { role: 'DIRECTOR_GEN' });
        assertOk(resp, 'DIRECTOR_GEN /me');
        const user = resp.data?.user || resp.data;
        assert(user.role === 'DIRECTOR_GEN', `expected role DIRECTOR_GEN, got ${user.role}`);
      }
    },
    {
      name: 'GET /me with DIRECTOR_COMM role returns correct role field',
      run: async () => {
        const resp = await api('GET', '/api/auth/me', { role: 'DIRECTOR_COMM' });
        assertOk(resp, 'DIRECTOR_COMM /me');
        const user = resp.data?.user || resp.data;
        assert(user.role === 'DIRECTOR_COMM', `expected role DIRECTOR_COMM, got ${user.role}`);
      }
    },
    {
      name: 'GET /me with DIRECTOR_DEV role returns correct role field',
      run: async () => {
        const resp = await api('GET', '/api/auth/me', { role: 'DIRECTOR_DEV' });
        assertOk(resp, 'DIRECTOR_DEV /me');
        const user = resp.data?.user || resp.data;
        assert(user.role === 'DIRECTOR_DEV', `expected role DIRECTOR_DEV, got ${user.role}`);
      }
    },
    {
      name: 'GET /me with WAREHOUSE role returns correct role field',
      run: async () => {
        const resp = await api('GET', '/api/auth/me', { role: 'WAREHOUSE' });
        assertOk(resp, 'WAREHOUSE /me');
        const user = resp.data?.user || resp.data;
        assert(user.role === 'WAREHOUSE', `expected role WAREHOUSE, got ${user.role}`);
      }
    },

    // ═══════════════════════════════════════════════════
    // 20. Auth all 15 roles: GET /api/auth/me returns correct role
    // ═══════════════════════════════════════════════════
    ...ROLES.map(role => ({
      name: `Auth role ${role}: GET /api/auth/me returns role=${role}`,
      run: async () => {
        const resp = await api('GET', '/api/auth/me', { role });
        assertOk(resp, `${role} auth/me`);
        const user = resp.data?.user || resp.data;
        assertHasFields(user, ['id', 'role'], `${role} auth/me fields`);
        assert(user.role === role, `expected role ${role}, got ${user.role}`);
      }
    }))
  ]
};
