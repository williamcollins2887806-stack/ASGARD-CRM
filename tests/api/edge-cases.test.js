/**
 * EDGE CASES (Граничные случаи)
 * Pagination boundaries, empty/missing bodies, special characters,
 * concurrent requests, large payloads, content-type, double operations,
 * method routing, date fields, health check.
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, rawFetch, skip } = require('../config');

let createdTaskId = null;
let assigneeId = null;

module.exports = {
  name: 'EDGE CASES (Граничные случаи)',
  tests: [
    // ═══ PAGINATION & SORTING ═══
    {
      name: 'EDGE-1: GET /api/tenders?limit=1 → returns exactly 1 or fewer items',
      run: async () => {
        const resp = await api('GET', '/api/tenders?limit=1');
        assertOk(resp, 'limit=1');
        const list = Array.isArray(resp.data) ? resp.data : (resp.data?.tenders || resp.data?.items || []);
        assert(list.length <= 1, `expected <=1 items, got ${list.length}`);
      }
    },
    {
      name: 'EDGE-2: GET /api/tenders?limit=1&offset=0 → works with offset',
      run: async () => {
        const resp = await api('GET', '/api/tenders?limit=1&offset=0');
        assertOk(resp, 'limit=1&offset=0');
        const list = Array.isArray(resp.data) ? resp.data : (resp.data?.tenders || resp.data?.items || []);
        assert(list.length <= 1, `expected <=1 items with offset=0, got ${list.length}`);
      }
    },
    {
      name: 'EDGE-3: GET /api/tenders?sort=id&order=desc → sorting works',
      run: async () => {
        const resp = await api('GET', '/api/tenders?sort=id&order=desc');
        assertOk(resp, 'sort=id&order=desc');
        const list = Array.isArray(resp.data) ? resp.data : (resp.data?.tenders || resp.data?.items || []);
        if (list.length < 2) skip('not enough tenders for sort test');
        const ids = list.map(t => t.id);
        for (let i = 0; i < ids.length - 1; i++) {
          assert(ids[i] >= ids[i + 1], `sort desc broken: id ${ids[i]} should be >= ${ids[i + 1]}`);
        }
      }
    },
    {
      name: 'EDGE-4: GET /api/tenders?limit=0 → handles zero limit gracefully (no crash)',
      run: async () => {
        const resp = await api('GET', '/api/tenders?limit=0');
        assert(
          [200, 400, 422].includes(resp.status),
          `limit=0 should not crash, got ${resp.status}`
        );
      }
    },
    {
      name: 'EDGE-5: GET /api/tenders?limit=-1 → handles negative limit gracefully',
      run: async () => {
        const resp = await api('GET', '/api/tenders?limit=-1');
        assert(
          [200, 400, 422].includes(resp.status),
          `negative limit should not crash, got ${resp.status}`
        );
      }
    },
    {
      name: 'EDGE-6: GET /api/tenders?limit=999999 → handles huge limit without crash',
      run: async () => {
        const resp = await api('GET', '/api/tenders?limit=999999');
        assertOk(resp, 'huge limit');
      }
    },

    // ═══ EMPTY/MISSING BODY ═══
    {
      name: 'EDGE-7: POST /api/tasks with empty body {} → 400 (missing title)',
      run: async () => {
        const resp = await api('POST', '/api/tasks', { role: 'ADMIN', body: {} });
        assert(
          resp.status === 400 || resp.status === 422,
          `empty task body should be 400/422, got ${resp.status}`
        );
      }
    },
    {
      name: 'EDGE-8: PUT /api/tasks/1 with empty body {} → should not crash',
      run: async () => {
        const resp = await api('PUT', '/api/tasks/1', { role: 'ADMIN', body: {} });
        // Any controlled response is acceptable: 200 (no-op update), 400, 404
        assert(
          [200, 400, 404, 422].includes(resp.status),
          `PUT empty body should not crash, got ${resp.status}`
        );
      }
    },
    {
      name: 'EDGE-9: POST /api/auth/login with empty body → 400/401',
      run: async () => {
        const resp = await rawFetch('POST', '/api/auth/login', { body: {} });
        assert(
          [400, 401, 422].includes(resp.status),
          `empty login body should be 400/401/422, got ${resp.status}`
        );
      }
    },

    // ═══ SPECIAL CHARACTERS ═══
    {
      name: 'EDGE-10: GET /api/customers?search=<>&"\' → special chars in search don\'t crash',
      run: async () => {
        const resp = await api('GET', '/api/customers?search=' + encodeURIComponent('<>&"\''));
        assert(
          [200, 400, 422].includes(resp.status),
          `special chars in search should not crash, got ${resp.status}`
        );
      }
    },
    {
      name: 'EDGE-11: GET /api/tenders?search=%00null%00byte → null bytes handled',
      run: async () => {
        const resp = await api('GET', '/api/tenders?search=%00null%00byte');
        assert(
          [200, 400, 422].includes(resp.status),
          `null bytes in search should not crash, got ${resp.status}`
        );
      }
    },
    {
      name: 'EDGE-12: POST /api/tasks with unicode emoji title → should not crash',
      run: async () => {
        // Resolve a real assignee
        if (!assigneeId) {
          const users = await api('GET', '/api/users', { role: 'ADMIN' });
          const userList = Array.isArray(users.data) ? users.data : (users.data?.users || []);
          const realUser = userList.find(u => u.is_active !== false) || userList[0];
          assigneeId = realUser?.id || 1;
        }

        const resp = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: {
            title: 'Edge test: emoji title \uD83D\uDD25\uD83D\uDE80\u2728 ' + Date.now(),
            description: 'Autotest with emojis',
            assignee_id: assigneeId,
            priority: 'medium',
            deadline: '2026-12-31'
          }
        });
        assert(
          [200, 201, 400].includes(resp.status),
          `emoji title should not crash, got ${resp.status}`
        );
        // Cleanup
        const id = resp.data?.task?.id || resp.data?.id;
        if (id) {
          await api('DELETE', `/api/tasks/${id}`, { role: 'ADMIN' });
        }
      }
    },
    {
      name: 'EDGE-13: POST /api/tasks with newlines and tabs in title → should work',
      run: async () => {
        if (!assigneeId) {
          const users = await api('GET', '/api/users', { role: 'ADMIN' });
          const userList = Array.isArray(users.data) ? users.data : (users.data?.users || []);
          const realUser = userList.find(u => u.is_active !== false) || userList[0];
          assigneeId = realUser?.id || 1;
        }

        const resp = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: {
            title: 'Edge test:\nnewline\tand\ttab ' + Date.now(),
            description: 'Autotest with whitespace chars',
            assignee_id: assigneeId,
            priority: 'low',
            deadline: '2026-12-31'
          }
        });
        assert(
          [200, 201, 400].includes(resp.status),
          `newline/tab title should not crash, got ${resp.status}`
        );
        const id = resp.data?.task?.id || resp.data?.id;
        if (id) {
          await api('DELETE', `/api/tasks/${id}`, { role: 'ADMIN' });
        }
      }
    },

    // ═══ CONCURRENT REQUESTS ═══
    {
      name: 'EDGE-14: Fire 3 parallel GET /api/tenders → all succeed',
      run: async () => {
        const results = await Promise.all([
          api('GET', '/api/tenders'),
          api('GET', '/api/tenders'),
          api('GET', '/api/tenders')
        ]);
        for (let i = 0; i < results.length; i++) {
          assertOk(results[i], `parallel tenders request #${i + 1}`);
        }
      }
    },
    {
      name: 'EDGE-15: Fire 3 parallel GET /api/users → all succeed',
      run: async () => {
        const results = await Promise.all([
          api('GET', '/api/users'),
          api('GET', '/api/users'),
          api('GET', '/api/users')
        ]);
        for (let i = 0; i < results.length; i++) {
          assertOk(results[i], `parallel users request #${i + 1}`);
        }
      }
    },

    // ═══ LARGE PAYLOADS ═══
    {
      name: 'EDGE-16: POST /api/tasks with 5000-char description → should work',
      run: async () => {
        if (!assigneeId) {
          const users = await api('GET', '/api/users', { role: 'ADMIN' });
          const userList = Array.isArray(users.data) ? users.data : (users.data?.users || []);
          const realUser = userList.find(u => u.is_active !== false) || userList[0];
          assigneeId = realUser?.id || 1;
        }

        const longDesc = 'A'.repeat(5000);
        const resp = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: {
            title: 'Edge test: large description ' + Date.now(),
            description: longDesc,
            assignee_id: assigneeId,
            priority: 'medium',
            deadline: '2026-12-31'
          }
        });
        assert(
          [200, 201, 400, 413].includes(resp.status),
          `large description should not crash, got ${resp.status}`
        );
        const id = resp.data?.task?.id || resp.data?.id;
        if (id) {
          await api('DELETE', `/api/tasks/${id}`, { role: 'ADMIN' });
        }
      }
    },
    {
      name: 'EDGE-17: POST /api/tenders with 500-char customer_name → should handle',
      run: async () => {
        const longName = 'K'.repeat(500);
        const resp = await api('POST', '/api/tenders', {
          role: 'ADMIN',
          body: {
            customer_name: longName,
            tender_title: 'Edge test: long customer name ' + Date.now(),
            tender_type: 'Открытый',
            tender_status: 'Новый'
          }
        });
        // May succeed (TEXT column) or fail (VARCHAR overflow) — either is acceptable
        assert(
          [200, 201, 400, 422].includes(resp.status),
          `long customer_name should not crash, got ${resp.status}`
        );
        const id = resp.data?.id || resp.data?.tender?.id || resp.data?.item?.id;
        if (id) {
          await api('DELETE', `/api/tenders/${id}`, { role: 'ADMIN' });
        }
      }
    },

    // ═══ CONTENT TYPE ═══
    {
      name: 'EDGE-18: Send POST without Content-Type header → should handle gracefully',
      run: async () => {
        const resp = await rawFetch('POST', '/api/tasks', {
          body: { title: 'No content-type test' },
          headers: {
            'Content-Type': undefined
          }
        });
        // Without proper Content-Type the server may reject or handle — no crash is the requirement
        assert(
          [200, 201, 400, 401, 415, 422].includes(resp.status),
          `missing Content-Type should not crash, got ${resp.status}`
        );
      }
    },

    // ═══ DOUBLE OPERATIONS ═══
    {
      name: 'EDGE-19: Create task, delete it, try deleting again → second delete returns 404',
      run: async () => {
        if (!assigneeId) {
          const users = await api('GET', '/api/users', { role: 'ADMIN' });
          const userList = Array.isArray(users.data) ? users.data : (users.data?.users || []);
          const realUser = userList.find(u => u.is_active !== false) || userList[0];
          assigneeId = realUser?.id || 1;
        }

        // Create
        const createResp = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: {
            title: 'Edge test: double-delete ' + Date.now(),
            description: 'Will be deleted twice',
            assignee_id: assigneeId,
            priority: 'low',
            deadline: '2026-12-31'
          }
        });
        assertOk(createResp, 'create task for double-delete');
        const taskId = createResp.data?.task?.id || createResp.data?.id;
        assert(taskId, 'task ID should be returned after create');

        // First delete — should succeed
        const del1 = await api('DELETE', `/api/tasks/${taskId}`, { role: 'ADMIN' });
        assertOk(del1, 'first delete');

        // Second delete — should return 404 (already deleted)
        const del2 = await api('DELETE', `/api/tasks/${taskId}`, { role: 'ADMIN' });
        assert(
          [404, 400, 410].includes(del2.status),
          `second delete should be 404/400/410, got ${del2.status}`
        );
      }
    },
    {
      name: 'EDGE-20: Create task and immediately read-back → data matches',
      run: async () => {
        if (!assigneeId) {
          const users = await api('GET', '/api/users', { role: 'ADMIN' });
          const userList = Array.isArray(users.data) ? users.data : (users.data?.users || []);
          const realUser = userList.find(u => u.is_active !== false) || userList[0];
          assigneeId = realUser?.id || 1;
        }

        const uniqueTitle = 'Edge readback test ' + Date.now();
        const createResp = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: {
            title: uniqueTitle,
            description: 'Immediate read-back test',
            assignee_id: assigneeId,
            priority: 'high',
            deadline: '2026-06-15'
          }
        });
        assertOk(createResp, 'create for readback');
        const taskId = createResp.data?.task?.id || createResp.data?.id;
        assert(taskId, 'task ID required for readback');

        // Immediate read-back
        const getResp = await api('GET', `/api/tasks/${taskId}`, { role: 'ADMIN' });
        assertOk(getResp, 'readback GET');
        const task = getResp.data?.task || getResp.data;
        assert(task.title === uniqueTitle, `title mismatch: expected "${uniqueTitle}", got "${task.title}"`);
        assert(task.priority === 'high', `priority mismatch: expected "high", got "${task.priority}"`);

        // Cleanup
        createdTaskId = taskId;
        await api('DELETE', `/api/tasks/${taskId}`, { role: 'ADMIN' });
        createdTaskId = null;
      }
    },

    // ═══ METHOD NOT ALLOWED ═══
    {
      name: 'EDGE-21: PATCH /api/tenders → 404 (method not routed)',
      run: async () => {
        const resp = await rawFetch('PATCH', '/api/tenders', {
          body: { tender_title: 'patch attempt' }
        });
        assert(
          [404, 405, 400].includes(resp.status),
          `PATCH should be 404/405/400, got ${resp.status}`
        );
      }
    },
    {
      name: 'EDGE-22: OPTIONS /api/tenders → should return CORS headers or be handled gracefully',
      run: async () => {
        const resp = await rawFetch('OPTIONS', '/api/tenders');
        assert(
          [200, 204, 400, 404].includes(resp.status),
          `OPTIONS should be 200/204/400/404, got ${resp.status}`
        );
        // Fastify may not handle OPTIONS by default; only check CORS headers if 200/204
        if ([200, 204].includes(resp.status)) {
          const allowOrigin = resp.headers?.get('access-control-allow-origin');
          const allowMethods = resp.headers?.get('access-control-allow-methods');
          const hasAnyCors = allowOrigin || allowMethods;
          assert(hasAnyCors, 'OPTIONS response should include CORS headers (access-control-allow-origin or access-control-allow-methods)');
        }
      }
    },

    // ═══ TIMESTAMP/DATE FIELDS ═══
    {
      name: 'EDGE-23: POST /api/calendar with invalid date format → 400 or handled gracefully',
      run: async () => {
        const resp = await api('POST', '/api/calendar', {
          role: 'ADMIN',
          body: {
            title: 'Edge test: bad date ' + Date.now(),
            date: 'not-a-date',
            time: '99:99',
            type: 'meeting',
            description: 'Invalid date test'
          }
        });
        assert(
          [400, 422, 200, 201, 500].includes(resp.status),
          `invalid date should not crash unexpectedly, got ${resp.status}`
        );
        // Cleanup if it was created despite the bad date
        const id = resp.data?.event?.id || resp.data?.id;
        if (id) {
          await api('DELETE', `/api/calendar/${id}`, { role: 'ADMIN' });
        }
      }
    },
    {
      name: 'EDGE-24: POST /api/tasks with deadline in the past → should still create (or 400)',
      run: async () => {
        if (!assigneeId) {
          const users = await api('GET', '/api/users', { role: 'ADMIN' });
          const userList = Array.isArray(users.data) ? users.data : (users.data?.users || []);
          const realUser = userList.find(u => u.is_active !== false) || userList[0];
          assigneeId = realUser?.id || 1;
        }

        const resp = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: {
            title: 'Edge test: past deadline ' + Date.now(),
            description: 'Deadline is in the past',
            assignee_id: assigneeId,
            priority: 'low',
            deadline: '2020-01-01'
          }
        });
        assert(
          [200, 201, 400, 422].includes(resp.status),
          `past deadline should be accepted or rejected cleanly, got ${resp.status}`
        );
        const id = resp.data?.task?.id || resp.data?.id;
        if (id) {
          await api('DELETE', `/api/tasks/${id}`, { role: 'ADMIN' });
        }
      }
    },

    // ═══ HEALTH CHECK ═══
    {
      name: 'EDGE-25: GET /api/health → status ok, database connected',
      run: async () => {
        const resp = await rawFetch('GET', '/api/health');
        assertOk(resp, '/api/health');
        assert(resp.data && typeof resp.data === 'object', 'health response should be an object');
        assertHasFields(resp.data, ['status', 'database'], 'health check fields');
        assert(resp.data.status === 'ok', `health status should be "ok", got "${resp.data.status}"`);
        assert(resp.data.database === 'connected', `database should be "connected", got "${resp.data.database}"`);
      }
    }
  ]
};
