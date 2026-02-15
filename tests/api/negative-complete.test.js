/**
 * NEGATIVE COMPLETE — 401, 404, 400, SQL injection, XSS, edge cases
 */
const { api, assert, assertOk, assertForbidden, rawFetch, skip } = require('../config');

let _cleanupIds = { tasks: [] };

async function cleanup() {
  for (const id of _cleanupIds.tasks) {
    await api('DELETE', `/api/tasks/${id}`, { role: 'ADMIN' }).catch(() => {});
  }
  _cleanupIds = { tasks: [] };
}

module.exports = {
  name: 'NEGATIVE COMPLETE (401, 404, 400, SQL injection)',
  tests: [
    // ═══════════════════════════════════════════════════════════════
    // 401 UNAUTHORIZED (rawFetch — no token)
    // ═══════════════════════════════════════════════════════════════
    {
      name: 'NEG-01: GET /api/users without token → 401',
      run: async () => {
        const resp = await rawFetch('GET', '/api/users');
        assert(resp.status === 401, `expected 401, got ${resp.status}`);
      }
    },
    {
      name: 'NEG-02: GET /api/tenders without token → 401',
      run: async () => {
        const resp = await rawFetch('GET', '/api/tenders');
        assert(resp.status === 401, `expected 401, got ${resp.status}`);
      }
    },
    {
      name: 'NEG-03: POST /api/tasks without token → 401',
      run: async () => {
        const resp = await rawFetch('POST', '/api/tasks', {
          body: { title: 'unauthorized task' }
        });
        assert(resp.status === 401, `expected 401, got ${resp.status}`);
      }
    },
    {
      name: 'NEG-04: GET /api/staff/employees without token → 401',
      run: async () => {
        const resp = await rawFetch('GET', '/api/staff/employees');
        assert(resp.status === 401, `expected 401, got ${resp.status}`);
      }
    },
    {
      name: 'NEG-05: GET /api/settings without token → 401',
      run: async () => {
        const resp = await rawFetch('GET', '/api/settings');
        assert(resp.status === 401, `expected 401, got ${resp.status}`);
      }
    },
    {
      name: 'NEG-06: GET /api/auth/me without token → 401',
      run: async () => {
        const resp = await rawFetch('GET', '/api/auth/me');
        assert(resp.status === 401, `expected 401, got ${resp.status}`);
      }
    },
    {
      name: 'NEG-07: GET /api/auth/me with invalid token → 401',
      run: async () => {
        const resp = await rawFetch('GET', '/api/auth/me', {
          headers: { Authorization: 'Bearer invalidtoken123' }
        });
        assert(resp.status === 401, `expected 401, got ${resp.status}`);
      }
    },
    {
      name: 'NEG-08: GET /api/auth/me with malformed auth header → 401',
      run: async () => {
        const resp = await rawFetch('GET', '/api/auth/me', {
          headers: { Authorization: 'NotBearer token' }
        });
        assert(resp.status === 401, `expected 401, got ${resp.status}`);
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 404 NOT FOUND
    // ═══════════════════════════════════════════════════════════════
    {
      name: 'NEG-09: GET /api/tasks/999999 → 404',
      run: async () => {
        const resp = await api('GET', '/api/tasks/999999', { role: 'ADMIN' });
        assert(resp.status === 404, `expected 404, got ${resp.status}`);
      }
    },
    {
      name: 'NEG-10: GET /api/tenders/999999 → 404',
      run: async () => {
        const resp = await api('GET', '/api/tenders/999999', { role: 'ADMIN' });
        assert(resp.status === 404, `expected 404, got ${resp.status}`);
      }
    },
    {
      name: 'NEG-11: GET /api/users/999999 → 404',
      run: async () => {
        const resp = await api('GET', '/api/users/999999', { role: 'ADMIN' });
        assert(resp.status === 404, `expected 404, got ${resp.status}`);
      }
    },
    {
      name: 'NEG-12: GET /api/works/999999 → 404',
      run: async () => {
        const resp = await api('GET', '/api/works/999999', { role: 'ADMIN' });
        assert(resp.status === 404, `expected 404, got ${resp.status}`);
      }
    },
    {
      name: 'NEG-13: GET /api/nonexistent-endpoint → 404',
      run: async () => {
        const resp = await api('GET', '/api/nonexistent-endpoint', { role: 'ADMIN' });
        assert(resp.status === 404, `expected 404, got ${resp.status}`);
      }
    },
    {
      name: 'NEG-14: GET /api/estimates/999999 → 404',
      run: async () => {
        const resp = await api('GET', '/api/estimates/999999', { role: 'ADMIN' });
        assert(resp.status === 404, `expected 404, got ${resp.status}`);
      }
    },
    {
      name: 'NEG-15: DELETE /api/tasks/999999 → 404',
      run: async () => {
        const resp = await api('DELETE', '/api/tasks/999999', { role: 'ADMIN' });
        assert(resp.status === 404, `expected 404, got ${resp.status}`);
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 400 BAD REQUEST (validation)
    // ═══════════════════════════════════════════════════════════════
    {
      name: 'NEG-16: POST /api/tasks without title → 400',
      run: async () => {
        const resp = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: { description: 'no title provided' }
        });
        assert(resp.status === 400, `expected 400, got ${resp.status}`);
      }
    },
    {
      name: 'NEG-17: POST /api/tenders without required fields → 400',
      run: async () => {
        const resp = await api('POST', '/api/tenders', {
          role: 'ADMIN',
          body: {}
        });
        assert(
          resp.status === 400 || resp.status === 422,
          `expected 400/422, got ${resp.status}`
        );
      }
    },
    {
      name: 'NEG-18: POST /api/users without login → 400',
      run: async () => {
        const resp = await api('POST', '/api/users', {
          role: 'ADMIN',
          body: { name: 'No Login User' }
        });
        assert(
          resp.status === 400 || resp.status === 422,
          `expected 400/422, got ${resp.status}`
        );
      }
    },
    {
      name: 'NEG-19: PUT /api/tasks/abc (non-numeric ID) → 400 or 404',
      run: async () => {
        const resp = await api('PUT', '/api/tasks/abc', {
          role: 'ADMIN',
          body: { title: 'bad id' }
        });
        assert(
          resp.status === 400 || resp.status === 404,
          `expected 400 or 404, got ${resp.status}`
        );
      }
    },
    {
      name: 'NEG-20: POST /api/auth/login without body → 400 or 401',
      run: async () => {
        const resp = await rawFetch('POST', '/api/auth/login', { body: {} });
        assert(
          resp.status === 400 || resp.status === 401,
          `expected 400 or 401, got ${resp.status}`
        );
      }
    },
    {
      name: 'NEG-21: POST /api/auth/login with empty credentials → 401',
      run: async () => {
        const resp = await rawFetch('POST', '/api/auth/login', {
          body: { login: '', password: '' }
        });
        assert(
          resp.status === 400 || resp.status === 401,
          `expected 400 or 401, got ${resp.status}`
        );
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // SQL INJECTION PREVENTION
    // ═══════════════════════════════════════════════════════════════
    {
      name: "NEG-22: GET /api/users?search=' OR '1'='1 → no crash, status < 500",
      run: async () => {
        const resp = await api('GET', "/api/users?search=' OR '1'='1", { role: 'ADMIN' });
        assert(resp.status < 500, `SQL injection should not crash server, got ${resp.status}`);
      }
    },
    {
      name: "NEG-23: GET /api/tenders?search='; DROP TABLE tenders;-- → no crash, status < 500",
      run: async () => {
        const resp = await api('GET', "/api/tenders?search='; DROP TABLE tenders;--", { role: 'ADMIN' });
        assert(resp.status < 500, `SQL injection should not crash server, got ${resp.status}`);
      }
    },
    {
      name: 'NEG-24: POST /api/tasks with SQL injection in title → no crash, status < 500',
      run: async () => {
        const resp = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: {
            title: "'; DELETE FROM tasks WHERE '1'='1",
            assignee_id: 1
          }
        });
        assert(resp.status < 500, `SQL injection in task title should not crash, got ${resp.status}`);
        const t = resp.data?.task || resp.data;
        if (t?.id) _cleanupIds.tasks.push(t.id);
      }
    },
    {
      name: "NEG-25: GET /api/data/tenders?search=' UNION SELECT * FROM users-- → no crash, status < 500",
      run: async () => {
        const resp = await api('GET', "/api/data/tenders?search=' UNION SELECT * FROM users--", { role: 'ADMIN' });
        assert(resp.status < 500, `UNION injection should not crash server, got ${resp.status}`);
      }
    },
    {
      name: "NEG-26: GET /api/users/1' OR '1'='1 → 400 or 404 (or 200 if safely handled)",
      run: async () => {
        const resp = await api('GET', "/api/users/1' OR '1'='1", { role: 'ADMIN' });
        // The endpoint may return 200 if it safely handles the non-numeric ID
        // (e.g., parseInt returns 1, parameterized queries protect against injection)
        assert(
          [200, 400, 404].includes(resp.status),
          `SQL injection in ID should be 200/400/404, got ${resp.status}`
        );
        // If 200, verify it doesn't leak multiple user records
        if (resp.status === 200) {
          const data = resp.data;
          const isArray = Array.isArray(data);
          assert(!isArray || data.length <= 1, 'Should not leak multiple users via SQL injection');
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // XSS PREVENTION
    // ═══════════════════════════════════════════════════════════════
    {
      name: "NEG-27: POST /api/tasks with <script> in title → should not crash, status < 500",
      run: async () => {
        const resp = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: {
            title: "<script>alert('xss')</script>",
            assignee_id: 1
          }
        });
        assert(resp.status < 500, `XSS in task title should not crash, got ${resp.status}`);
        const t = resp.data?.task || resp.data;
        if (t?.id) _cleanupIds.tasks.push(t.id);
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // ADDITIONAL EDGE CASES
    // ═══════════════════════════════════════════════════════════════
    {
      name: 'NEG-28: GET /api/health → should respond (no auth needed or 401)',
      run: async () => {
        const resp = await rawFetch('GET', '/api/health');
        // Health endpoint may or may not require auth; either way, should not crash
        assert(
          resp.status < 500,
          `health endpoint should not crash, got ${resp.status}`
        );
      }
    },
    {
      name: 'NEG-29: POST /api/tasks with very long title (>10000 chars) → handles gracefully, no crash',
      run: async () => {
        const longTitle = 'A'.repeat(10001);
        const resp = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: { title: longTitle, assignee_id: 1 }
        });
        assert(resp.status < 500, `very long title should not crash, got ${resp.status}`);
        const t = resp.data?.task || resp.data;
        if (t?.id) _cleanupIds.tasks.push(t.id);
      }
    },
    {
      name: 'NEG-30: POST /api/auth/login with extra fields → should not crash',
      run: async () => {
        const resp = await rawFetch('POST', '/api/auth/login', {
          body: {
            login: 'test_admin',
            password: 'WrongPass999!',
            extra_field: 'should be ignored',
            admin: true,
            role: 'ADMIN'
          }
        });
        assert(resp.status < 500, `login with extra fields should not crash, got ${resp.status}`);
        assert(
          resp.status === 200 || resp.status === 400 || resp.status === 401,
          `expected 200/400/401, got ${resp.status}`
        );
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // CLEANUP
    // ═══════════════════════════════════════════════════════════════
    {
      name: 'NEG-CLEANUP: remove all test data',
      run: async () => {
        await cleanup();
      }
    }
  ]
};
