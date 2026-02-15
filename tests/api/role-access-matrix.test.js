/**
 * ROLE ACCESS MATRIX (Матрица доступа)
 *
 * Verifies the access matrix for key CREATE/DELETE endpoints.
 * For each endpoint, tests which roles are ALLOWED and which are FORBIDDEN.
 *
 * ADMIN always passes all checks (server-level bypass).
 *
 * Role inheritance:
 *   HEAD_TO  -> TO
 *   HEAD_PM  -> PM
 *   HR_MANAGER -> HR
 *   CHIEF_ENGINEER -> WAREHOUSE
 *
 * For DELETE endpoints, non-existent ID 999999 is used to avoid
 * destroying real data. Forbidden roles receive 403 BEFORE the 404
 * check; allowed roles receive 404 (resource not found).
 */
const { api, assert, assertOk, assertForbidden, skip, ROLES } = require('../config');

// ─── Access Matrix Definition ───
// [method, path, allowedRoles, minimalBody (for POST)]
const MATRIX = [
  // 1. POST /api/tenders
  ['POST', '/api/tenders',
    ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'],
    { customer: 'MATRIX-TEST', tender_status: 'Новый' }
  ],
  // 2. POST /api/works
  ['POST', '/api/works',
    ['ADMIN', 'PM', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'],
    { work_title: 'MATRIX-TEST', work_status: 'В работе' }
  ],
  // 3. POST /api/estimates
  ['POST', '/api/estimates',
    ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN'],
    { title: 'MATRIX-TEST', amount: 10000 }
  ],
  // 4. POST /api/staff/employees
  ['POST', '/api/staff/employees',
    ['ADMIN', 'HR', 'HR_MANAGER', 'DIRECTOR_GEN'],
    { fio: 'MATRIX-TEST Employee', position: 'Тестер' }
  ],
  // 5. DELETE /api/tenders/:id
  ['DELETE', '/api/tenders/999999',
    ['ADMIN', 'DIRECTOR_GEN'],
    null
  ],
  // 6. DELETE /api/works/:id
  ['DELETE', '/api/works/999999',
    ['ADMIN'],
    null
  ],
  // 7. DELETE /api/users/:id
  ['DELETE', '/api/users/999999',
    ['ADMIN'],
    null
  ],
  // 8. POST /api/customers
  ['POST', '/api/customers',
    ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM'],
    { name: 'MATRIX-TEST Customer', inn: '9999988888' }
  ],
];

// ─── Pick representative forbidden roles (2-3 per endpoint) ───
function pickForbidden(allowed, count = 3) {
  const forbidden = ROLES.filter(r => !allowed.includes(r));
  // Pick spread across the list for diversity
  if (forbidden.length <= count) return forbidden;
  const step = Math.floor(forbidden.length / count);
  const picked = [];
  for (let i = 0; i < count; i++) {
    picked.push(forbidden[i * step]);
  }
  return picked;
}

// ─── Pick one allowed role (not ADMIN) ───
function pickAllowed(allowed) {
  const nonAdmin = allowed.filter(r => r !== 'ADMIN');
  // Return first non-admin allowed role
  return nonAdmin[0] || null;
}

// ─── Generate tests ───
const tests = [];

for (const [method, path, allowed, body] of MATRIX) {
  const isDelete = method === 'DELETE';
  const label = `${method} ${path}`;

  // --- Forbidden role tests (2-3 per endpoint) ---
  const forbiddenRoles = pickForbidden(allowed);
  for (const role of forbiddenRoles) {
    tests.push({
      name: `FORBIDDEN: ${role} -> ${label} => 403`,
      run: async () => {
        const resp = await api(method, path, {
          role,
          body: body || undefined
        });
        assertForbidden(resp, `${role} should be FORBIDDEN for ${label}`);
      }
    });
  }

  // --- Allowed role test (1 non-ADMIN role) ---
  const allowedRole = pickAllowed(allowed);
  if (allowedRole) {
    if (isDelete) {
      // DELETE with non-existent ID: allowed role should get 404 (not 403)
      tests.push({
        name: `ALLOWED: ${allowedRole} -> ${label} => not 403 (404 expected)`,
        run: async () => {
          const resp = await api(method, path, { role: allowedRole });
          // Allowed role passes auth check; gets 404 because resource doesn't exist
          assert(
            resp.status !== 403 && resp.status !== 401,
            `${allowedRole} should be ALLOWED for ${label}, got ${resp.status}`
          );
        }
      });
    } else {
      // POST: allowed role should get 2xx
      tests.push({
        name: `ALLOWED: ${allowedRole} -> ${label} => 2xx`,
        run: async () => {
          const resp = await api(method, path, {
            role: allowedRole,
            body
          });
          assertOk(resp, `${allowedRole} should be ALLOWED for ${label}`);
        }
      });
    }
  }
}

// ─── Additional cross-cutting tests ───

// Verify ADMIN universally passes all endpoints
tests.push({
  name: 'ADMIN passes POST /api/tenders (universal access)',
  run: async () => {
    const resp = await api('POST', '/api/tenders', {
      role: 'ADMIN',
      body: { customer: 'ADMIN-MATRIX-CHECK', tender_status: 'Новый' }
    });
    assertOk(resp, 'ADMIN should always pass');
  }
});

tests.push({
  name: 'ADMIN passes DELETE /api/works/999999 (universal access)',
  run: async () => {
    const resp = await api('DELETE', '/api/works/999999', { role: 'ADMIN' });
    // ADMIN passes auth; gets 404 because resource doesn't exist
    assert(
      resp.status !== 403 && resp.status !== 401,
      `ADMIN should always pass, got ${resp.status}`
    );
  }
});

// Verify role inheritance: HEAD_PM inherits PM access
tests.push({
  name: 'INHERITANCE: HEAD_PM inherits PM access to POST /api/works',
  run: async () => {
    const resp = await api('POST', '/api/works', {
      role: 'HEAD_PM',
      body: { work_title: 'HEAD_PM-Inherit-Test', work_status: 'В работе' }
    });
    assertOk(resp, 'HEAD_PM should inherit PM access to works');
  }
});

// Verify role inheritance: HEAD_TO inherits TO access
tests.push({
  name: 'INHERITANCE: HEAD_TO inherits TO access to POST /api/tenders',
  run: async () => {
    const resp = await api('POST', '/api/tenders', {
      role: 'HEAD_TO',
      body: { customer: 'HEAD_TO-Inherit-Test', tender_status: 'Новый' }
    });
    assertOk(resp, 'HEAD_TO should inherit TO access to tenders');
  }
});

// Verify role inheritance: HR_MANAGER inherits HR access
tests.push({
  name: 'INHERITANCE: HR_MANAGER inherits HR access to POST /api/staff/employees',
  run: async () => {
    const resp = await api('POST', '/api/staff/employees', {
      role: 'HR_MANAGER',
      body: { fio: 'HR_MANAGER-Inherit-Test', position: 'Тестер' }
    });
    assertOk(resp, 'HR_MANAGER should inherit HR access to employees');
  }
});

// Verify HEAD_TO does NOT inherit PM-only access (POST /api/works)
tests.push({
  name: 'INHERITANCE: HEAD_TO does NOT have PM access to POST /api/works',
  run: async () => {
    const resp = await api('POST', '/api/works', {
      role: 'HEAD_TO',
      body: { work_title: 'HEAD_TO-Should-Fail', work_status: 'В работе' }
    });
    assertForbidden(resp, 'HEAD_TO should NOT create works (PM-only)');
  }
});

// Verify CHIEF_ENGINEER does NOT have tender access
tests.push({
  name: 'INHERITANCE: CHIEF_ENGINEER inherits WAREHOUSE but NOT tender access',
  run: async () => {
    const resp = await api('POST', '/api/tenders', {
      role: 'CHIEF_ENGINEER',
      body: { customer: 'CE-Should-Fail', tender_status: 'Новый' }
    });
    assertForbidden(resp, 'CHIEF_ENGINEER should NOT create tenders');
  }
});

module.exports = {
  name: 'ROLE ACCESS MATRIX (Матрица доступа)',
  tests
};
