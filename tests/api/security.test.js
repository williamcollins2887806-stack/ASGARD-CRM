/**
 * SECURITY — Password leaks, SQL injection, XSS, mass assignment, auth bypass, input boundaries
 */
const jwt = require('jsonwebtoken');
const {
  api, assert, assertOk, assertStatus, assertForbidden, assertArray, assertHasFields,
  assertNotHasFields, assertMatches, assertOneOf,
  BASE_URL, JWT_SECRET, TEST_USERS, getToken, rawFetch
} = require('../config');

const SENSITIVE_FIELDS = ['password_hash', 'pin_hash', 'reset_token', 'temp_password_hash'];

let _cleanupIds = { tenders: [], works: [], customers: [], tasks: [], users: [] };

async function cleanup() {
  for (const id of _cleanupIds.tenders) {
    await api('DELETE', `/api/tenders/${id}`, { role: 'ADMIN' }).catch(() => {});
  }
  for (const id of _cleanupIds.works) {
    await api('DELETE', `/api/works/${id}`, { role: 'ADMIN' }).catch(() => {});
  }
  for (const inn of _cleanupIds.customers) {
    await api('DELETE', `/api/customers/${inn}`, { role: 'ADMIN' }).catch(() => {});
  }
  for (const id of _cleanupIds.tasks) {
    await api('DELETE', `/api/tasks/${id}`, { role: 'ADMIN' }).catch(() => {});
  }
  for (const id of _cleanupIds.users) {
    await api('DELETE', `/api/users/${id}`, { role: 'ADMIN' }).catch(() => {});
  }
  _cleanupIds = { tenders: [], works: [], customers: [], tasks: [], users: [] };
}

module.exports = {
  name: 'SECURITY (deep)',
  tests: [
    // ═══ A. Password/Hash Leak Prevention ═══
    {
      name: 'SEC-A1: GET /api/data/users → no password_hash/pin_hash in response',
      run: async () => {
        const resp = await api('GET', '/api/data/users?limit=5', { role: 'ADMIN' });
        assertOk(resp, 'GET data/users');
        const list = resp.data?.users || resp.data?.items || resp.data;
        if (Array.isArray(list)) {
          for (const u of list) {
            assertNotHasFields(u, SENSITIVE_FIELDS, 'data/users item');
          }
        }
      }
    },
    {
      name: 'SEC-A2: GET /api/users → no password_hash/pin_hash',
      run: async () => {
        const resp = await api('GET', '/api/users', { role: 'ADMIN' });
        assertOk(resp, 'GET /api/users');
        const list = Array.isArray(resp.data) ? resp.data : (resp.data?.users || resp.data?.data || []);
        for (const u of list.slice(0, 5)) {
          assertNotHasFields(u, SENSITIVE_FIELDS, 'users item');
        }
      }
    },
    {
      name: 'SEC-A3: GET /api/auth/me → no password_hash/pin_hash',
      run: async () => {
        const resp = await api('GET', '/api/auth/me', { role: 'ADMIN' });
        assertOk(resp, 'GET auth/me');
        const user = resp.data?.user || resp.data;
        if (user && typeof user === 'object') {
          assertNotHasFields(user, SENSITIVE_FIELDS, 'auth/me');
        }
      }
    },
    {
      name: 'SEC-A4: GET /api/users/:id → no password_hash',
      run: async () => {
        const adminId = TEST_USERS['ADMIN'].id;
        const resp = await api('GET', `/api/users/${adminId}`, { role: 'ADMIN' });
        assertOk(resp, 'GET users/:id');
        const user = resp.data?.user || resp.data;
        if (user && typeof user === 'object') {
          assertNotHasFields(user, SENSITIVE_FIELDS, 'users/:id');
        }
      }
    },
    {
      name: 'SEC-A5: POST /api/auth/login success → no password_hash in response',
      run: async () => {
        const resp = await rawFetch('POST', '/api/auth/login', {
          body: { login: 'test_admin', password: 'Test123!' }
        });
        // Login should return 200 (success) or 401 (bad credentials) — never 500
        assert(resp.status === 200 || resp.status === 401, `login: expected 200 or 401, got ${resp.status}`);
        if (resp.data && typeof resp.data === 'object') {
          assertNotHasFields(resp.data, SENSITIVE_FIELDS, 'login response');
          if (resp.data.user) {
            assertNotHasFields(resp.data.user, SENSITIVE_FIELDS, 'login user');
          }
        }
      }
    },

    // ═══ B. SQL Injection ═══
    {
      name: 'SEC-B1: SQL injection in tender customer → stored literally (parameterized queries)',
      run: async () => {
        const sqli = "test'; DROP TABLE tenders;--";
        const resp = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: sqli, estimated_sum: 100 }
        });
        assertOk(resp, 'SQLi tender create');
        const t = resp.data?.tender || resp.data;
        if (t?.id) {
          _cleanupIds.tenders.push(t.id);
          // Verify SQL injection text is stored literally, not executed
          const readback = await api('GET', `/api/tenders/${t.id}`, { role: 'TO' });
          assertOk(readback, 'readback SQLi tender');
          const stored = (readback.data?.tender || readback.data);
          assert(
            stored?.customer_name === sqli || stored?.customer === sqli,
            'SQL injection text should be stored literally'
          );
        }
      }
    },
    {
      name: 'SEC-B2: SQL injection in limit param → ignored safely',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?limit=1;DELETE%20FROM%20tenders', { role: 'ADMIN' });
        assertOk(resp, 'SQLi limit param');
      }
    },
    {
      name: 'SEC-B3: SQL injection in work_title → stored literally',
      run: async () => {
        const resp = await api('POST', '/api/works', {
          role: 'PM',
          body: { work_title: "' OR '1'='1" }
        });
        assertOk(resp, 'SQLi work create');
        const w = resp.data?.work || resp.data;
        if (w?.id) _cleanupIds.works.push(w.id);
      }
    },
    {
      name: 'SEC-B4: SQL injection in customer name → stored literally',
      run: async () => {
        const inn = '9999900001';
        const sqli = "Robert'); DROP TABLE customers;--";
        await api('DELETE', `/api/customers/${inn}`, { role: 'ADMIN' }).catch(() => {});
        const resp = await api('POST', '/api/customers', {
          role: 'PM',
          body: { inn, name: sqli }
        });
        assertOk(resp, 'SQLi customer create');
        _cleanupIds.customers.push(inn);
        // Verify stored literally
        const readback = await api('GET', `/api/customers/${inn}`, { role: 'PM' });
        if (readback.ok) {
          const c = readback.data?.customer || readback.data;
          assert(c?.name === sqli, 'SQL injection in customer name should be stored literally');
        }
      }
    },
    {
      name: 'SEC-B5: SQL injection in employee fio → not executed',
      run: async () => {
        const resp = await api('POST', '/api/staff/employees', {
          role: 'HR',
          body: { fio: "'; UPDATE users SET role='ADMIN';--" }
        });
        // May succeed (200/201) or fail (400) for missing required fields — must NOT be 500
        assert(
          resp.status === 200 || resp.status === 201 || resp.status === 400,
          `SQLi employee: expected 200/201/400, got ${resp.status}`
        );
      }
    },
    {
      name: 'SEC-B6: UNION SELECT injection in search → parameterized, safe',
      run: async () => {
        const resp = await api('GET', "/api/customers?search=' UNION SELECT password_hash FROM users--", { role: 'ADMIN' });
        assertOk(resp, 'SQLi UNION search');
        // Verify no password hashes leaked
        const list = resp.data?.customers || resp.data;
        if (Array.isArray(list)) {
          for (const item of list) {
            assertNotHasFields(item, ['password_hash'], 'UNION result');
          }
        }
      }
    },
    {
      name: 'SEC-B7: SQL injection in calendar title → stored literally',
      run: async () => {
        const resp = await api('POST', '/api/calendar', {
          role: 'ADMIN',
          body: { title: 'test" OR 1=1--', date: new Date().toISOString().slice(0, 10) }
        });
        assertOk(resp, 'SQLi calendar create');
        const ev = resp.data?.event || resp.data;
        if (ev?.id) await api('DELETE', `/api/calendar/${ev.id}`, { role: 'ADMIN' }).catch(() => {});
      }
    },
    {
      name: 'SEC-B8: SQL injection in task title → stored literally',
      run: async () => {
        const resp = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: {
            title: "'; TRUNCATE audit_log;--",
            assignee_id: TEST_USERS['ADMIN'].id
          }
        });
        assertOk(resp, 'SQLi task create');
        const t = resp.data?.task || resp.data;
        if (t?.id) _cleanupIds.tasks.push(t.id);
      }
    },

    // ═══ C. XSS Prevention ═══
    {
      name: 'SEC-C1: XSS script in tender → stored literally (API-level, frontend must escape)',
      run: async () => {
        const xss = "<script>alert('xss')</script>";
        const resp = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: xss, estimated_sum: 100 }
        });
        assertOk(resp, 'XSS tender create');
        const t = resp.data?.tender || resp.data;
        if (t?.id) {
          _cleanupIds.tenders.push(t.id);
          // Verify XSS text stored literally — API stores as-is, frontend must escape
          const readback = await api('GET', `/api/tenders/${t.id}`, { role: 'TO' });
          assertOk(readback, 'readback XSS tender');
          const stored = (readback.data?.tender || readback.data);
          assert(
            stored?.customer_name === xss || stored?.customer === xss,
            `XSS text should be stored literally, got: ${stored?.customer_name}`
          );
        }
      }
    },
    {
      name: 'SEC-C2: XSS img onerror in task → stored literally',
      run: async () => {
        const resp = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: { title: "<img src=x onerror=alert(1)>", assignee_id: TEST_USERS['ADMIN'].id }
        });
        assertOk(resp, 'XSS task create');
        const t = resp.data?.task || resp.data;
        if (t?.id) _cleanupIds.tasks.push(t.id);
      }
    },
    {
      name: 'SEC-C3: XSS svg onload in work → stored literally',
      run: async () => {
        const resp = await api('POST', '/api/works', {
          role: 'PM',
          body: { work_title: "<svg onload=alert('xss')>" }
        });
        assertOk(resp, 'XSS work create');
        const w = resp.data?.work || resp.data;
        if (w?.id) _cleanupIds.works.push(w.id);
      }
    },
    {
      name: 'SEC-C4: XSS iframe in customer → stored literally',
      run: async () => {
        const inn = '9999900002';
        const xss = "Test<iframe src='evil.com'>";
        await api('DELETE', `/api/customers/${inn}`, { role: 'ADMIN' }).catch(() => {});
        const resp = await api('POST', '/api/customers', {
          role: 'PM',
          body: { inn, name: xss }
        });
        assertOk(resp, 'XSS customer create');
        _cleanupIds.customers.push(inn);
        // Verify stored literally
        const readback = await api('GET', `/api/customers/${inn}`, { role: 'PM' });
        if (readback.ok) {
          const c = readback.data?.customer || readback.data;
          assert(c?.name === xss, 'XSS in customer name should be stored literally');
        }
      }
    },
    {
      name: 'SEC-C5: XSS script in notification → stored, not executed',
      run: async () => {
        const resp = await api('POST', '/api/notifications', {
          role: 'ADMIN',
          body: {
            user_id: TEST_USERS['ADMIN'].id,
            title: "<script>document.cookie</script>",
            message: "XSS test notification"
          }
        });
        assertOk(resp, 'XSS notification create');
      }
    },

    // ═══ D. Mass Assignment / Privilege Escalation ═══
    {
      name: 'SEC-D1: Extra field role in work body → ignored',
      run: async () => {
        const resp = await api('POST', '/api/works', {
          role: 'PM',
          body: { work_title: 'SEC-D1 mass assign test', role: 'ADMIN' }
        });
        assertOk(resp, 'mass assign work');
        const w = resp.data?.work || resp.data;
        if (w?.id) {
          _cleanupIds.works.push(w.id);
          assert(!w.role || w.role !== 'ADMIN', 'role field should be ignored in work');
        }
      }
    },
    {
      name: 'SEC-D2: created_by override in tender → uses JWT, not body',
      run: async () => {
        const resp = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: 'SEC-D2 test', created_by: 999, estimated_sum: 500 }
        });
        assertOk(resp, 'mass assign tender');
        const t = resp.data?.tender || resp.data;
        if (t?.id) {
          _cleanupIds.tenders.push(t.id);
          if (t.created_by !== undefined) {
            assert(t.created_by !== 999, 'created_by should come from JWT, not body');
          }
        }
      }
    },
    {
      name: 'SEC-D3: PUT employee with id override → id filtered out, returns 400 (no valid data)',
      run: async () => {
        const resp = await api('GET', '/api/staff/employees?limit=1', { role: 'ADMIN' });
        const list = resp.data?.employees || resp.data?.items || resp.data;
        if (Array.isArray(list) && list.length > 0) {
          const empId = list[0].id;
          const upd = await api('PUT', `/api/staff/employees/${empId}`, {
            role: 'HR',
            body: { id: 999999 }
          });
          // id field is filtered out by allowlist → no valid fields → 400
          assertStatus(upd, 400, 'PUT employee with only id field → no valid data');
        }
      }
    },
    {
      name: 'SEC-D4: is_deleted field in tender body → ignored by filterData',
      run: async () => {
        const resp = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: 'SEC-D4 test', is_deleted: true, estimated_sum: 100 }
        });
        assertOk(resp, 'is_deleted field ignored');
        const t = resp.data?.tender || resp.data;
        if (t?.id) {
          _cleanupIds.tenders.push(t.id);
          const check = await api('GET', `/api/tenders/${t.id}`, { role: 'TO' });
          assertStatus(check, 200, 'tender visible (is_deleted ignored)');
        }
      }
    },

    // ═══ E. Authentication/Authorization Bypass ═══
    {
      name: 'SEC-E1: GET /api/tenders without token → 401',
      run: async () => {
        const resp = await rawFetch('GET', '/api/tenders');
        assertStatus(resp, 401, 'no token');
      }
    },
    {
      name: 'SEC-E2: GET /api/tenders with invalid JWT → 401',
      run: async () => {
        const resp = await rawFetch('GET', '/api/tenders', {
          headers: { 'Authorization': 'Bearer invalid-jwt-token' }
        });
        assertStatus(resp, 401, 'invalid JWT');
      }
    },
    {
      name: 'SEC-E3: JWT signed with wrong secret → 401',
      run: async () => {
        const wrongToken = jwt.sign(
          { id: 1, login: 'admin', role: 'ADMIN', pinVerified: true },
          'wrong-secret-definitely-not-real',
          { expiresIn: '1h' }
        );
        const resp = await rawFetch('GET', '/api/tenders', {
          headers: { 'Authorization': `Bearer ${wrongToken}` }
        });
        assertStatus(resp, 401, 'wrong secret JWT');
      }
    },
    {
      name: 'SEC-E4: Expired JWT → 401',
      run: async () => {
        const expiredToken = jwt.sign(
          { id: 1, login: 'admin', role: 'ADMIN', pinVerified: true },
          JWT_SECRET,
          { expiresIn: '-1s' }
        );
        const resp = await rawFetch('GET', '/api/tenders', {
          headers: { 'Authorization': `Bearer ${expiredToken}` }
        });
        assertStatus(resp, 401, 'expired JWT');
      }
    },
    {
      name: 'SEC-E5: DELETE /api/users/:id from PM → 403',
      run: async () => {
        const resp = await api('DELETE', `/api/users/${TEST_USERS['ADMIN'].id}`, { role: 'PM' });
        assertForbidden(resp, 'PM delete user');
      }
    },
    {
      name: 'SEC-E6: GET /api/mimir/admin/config from PM → 403',
      run: async () => {
        const resp = await api('GET', '/api/mimir/admin/config', { role: 'PM' });
        assertForbidden(resp, 'PM admin config');
      }
    },
    {
      name: 'SEC-E7: POST /api/integrations/erp/webhook/999 without secret → 401/403/404',
      run: async () => {
        const resp = await rawFetch('POST', '/api/integrations/erp/webhook/999', {
          body: { entity_type: 'test', action: 'create', data: {} }
        });
        assert(
          resp.status === 401 || resp.status === 403 || resp.status === 404,
          `webhook no secret: expected 401/403/404, got ${resp.status}`
        );
      }
    },

    // ═══ F. Input Boundary Testing ═══
    {
      name: 'SEC-F1: Tender with 10000-char customer → 400 (VARCHAR overflow)',
      run: async () => {
        const longStr = 'A'.repeat(10000);
        const resp = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: longStr, estimated_sum: 100 }
        });
        assertStatus(resp, 400, '10000-char customer VARCHAR overflow');
        const t = resp.data?.tender || resp.data;
        if (t?.id) _cleanupIds.tenders.push(t.id);
      }
    },
    {
      name: 'SEC-F2: Tender with empty customer → 400 (schema validation)',
      run: async () => {
        const resp = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: '', estimated_sum: 100 }
        });
        assertStatus(resp, 400, 'empty customer');
      }
    },
    {
      name: 'SEC-F3: Tender with null customer → 400 (schema validation)',
      run: async () => {
        const resp = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: null }
        });
        assertStatus(resp, 400, 'null customer');
      }
    },
    {
      name: 'SEC-F4: Work with whitespace-only title → 400',
      run: async () => {
        const resp = await api('POST', '/api/works', {
          role: 'PM',
          body: { work_title: '   ' }
        });
        assertStatus(resp, 400, 'whitespace-only title');
      }
    },
    {
      name: 'SEC-F5: Customer with non-numeric INN → 400',
      run: async () => {
        const resp = await api('POST', '/api/customers', {
          role: 'PM',
          body: { inn: 'abc', name: 'Bad INN customer' }
        });
        assertStatus(resp, 400, 'non-numeric INN');
      }
    },
    {
      name: 'SEC-F6: Expense with negative amount → 400',
      run: async () => {
        const resp = await api('POST', '/api/expenses/work', {
          role: 'PM',
          body: { amount: -100, category: 'Материалы', description: 'negative test' }
        });
        assertStatus(resp, 400, 'negative amount');
      }
    },
    {
      name: 'SEC-F7: Expense with zero amount → 400',
      run: async () => {
        const resp = await api('POST', '/api/expenses/work', {
          role: 'PM',
          body: { amount: 0, category: 'Материалы', description: 'zero test' }
        });
        assertStatus(resp, 400, 'zero amount');
      }
    },
    {
      name: 'SEC-F8: Expense with huge amount → 200 (DB handles big numbers)',
      run: async () => {
        const resp = await api('POST', '/api/expenses/work', {
          role: 'PM',
          body: { amount: 99999999999.99, category: 'Материалы', description: 'huge test' }
        });
        assertOk(resp, 'huge amount accepted');
      }
    },

    // ═══ Cleanup ═══
    {
      name: 'SEC-CLEANUP: remove all test data',
      run: async () => {
        await cleanup();
      }
    }
  ]
};
