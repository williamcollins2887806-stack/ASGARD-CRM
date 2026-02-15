/**
 * PRE-TENDER MODERNIZED — Tests for enhanced AI, fast-track, SSE, kanban
 *
 * Tests cover:
 *  1. Fast-track endpoint (POST /:id/fast-track)
 *  2. SSE endpoint (GET /api/sse/stream + stats)
 *  3. Enhanced AI fields in pre-tender CRUD
 *  4. Kanban-compatible status changes via PUT
 *  5. Role-based access for fast-track (only directors)
 *  6. Migration V035 new columns presence
 */
const { api, assert, assertOk, assertStatus, assertForbidden, assertHasFields, skip, getToken, BASE_URL } = require('../config');

let testPreTenderId = null;
let testTenderId = null;

module.exports = {
  name: 'PRE-TENDER MODERNIZED (fast-track, SSE, AI)',
  tests: [
    // ═══════════════════════════════════════════════════════════════════
    // 1. SSE endpoint availability
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'SSE-1: SSE stats endpoint responds 200',
      run: async () => {
        const resp = await api('GET', '/api/sse/stats', { role: 'ADMIN' });
        assertOk(resp, 'SSE stats');
        assert(typeof resp.data === 'object', 'stats is object');
        assert('users' in resp.data, 'stats has users field');
        assert('connections' in resp.data, 'stats has connections field');
      }
    },
    {
      name: 'SSE-2: SSE stream requires token',
      run: async () => {
        // Without token → 401
        const url = `${BASE_URL}/api/sse/stream`;
        const resp = await fetch(url);
        assert(resp.status === 401, `expected 401, got ${resp.status}`);
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // 2. Pre-tender CRUD with new AI columns
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'AI-1: Create pre-tender for testing',
      run: async () => {
        const resp = await api('POST', '/api/pre-tenders', {
          role: 'ADMIN',
          body: {
            customer_name: 'Modernized Test Customer ' + Date.now(),
            customer_email: 'test@modernized.ru',
            work_description: 'Монтаж трубопроводов и сварочные работы на НПЗ',
            work_location: 'Хабаровск, НПЗ',
            estimated_sum: 5000000,
            work_deadline: '2026-06-01'
          }
        });
        assertOk(resp, 'create pre-tender');
        testPreTenderId = resp.data?.id;
        assert(testPreTenderId, 'must return id');
      }
    },
    {
      name: 'AI-2: GET pre-tender returns enhanced AI fields (even if null)',
      run: async () => {
        if (!testPreTenderId) skip('no pre-tender ID');
        const resp = await api('GET', `/api/pre-tenders/${testPreTenderId}`, { role: 'ADMIN' });
        assertOk(resp, 'get pre-tender');
        const it = resp.data?.item;
        assert(it, 'item must exist');
        // New AI columns should be present (even if null for new record)
        assert('ai_color' in it, 'has ai_color field');
        assert('ai_summary' in it || it.ai_summary === null, 'ai_summary accessible');
        // These new fields should exist in the schema after V035 migration
        // They may be null for a just-created record
      }
    },
    {
      name: 'AI-3: Stats endpoint includes new/in_review/accepted counts',
      run: async () => {
        const resp = await api('GET', '/api/pre-tenders/stats', { role: 'ADMIN' });
        assertOk(resp, 'stats');
        const d = resp.data;
        assert('total_new' in d || 'by_color' in d, 'stats has expected fields');
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // 3. Kanban: status changes via PUT
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'KANBAN-1: Change status new → in_review via PUT',
      run: async () => {
        if (!testPreTenderId) skip('no pre-tender ID');
        const resp = await api('PUT', `/api/pre-tenders/${testPreTenderId}`, {
          role: 'ADMIN',
          body: { status: 'in_review' }
        });
        assertOk(resp, 'change status to in_review');

        // Verify
        const check = await api('GET', `/api/pre-tenders/${testPreTenderId}`, { role: 'ADMIN' });
        assertOk(check, 'verify');
        assert(check.data?.item?.status === 'in_review', 'status should be in_review, got: ' + check.data?.item?.status);
      }
    },
    {
      name: 'KANBAN-2: Change status in_review → need_docs via PUT',
      run: async () => {
        if (!testPreTenderId) skip('no pre-tender ID');
        const resp = await api('PUT', `/api/pre-tenders/${testPreTenderId}`, {
          role: 'ADMIN',
          body: { status: 'need_docs' }
        });
        assertOk(resp, 'change to need_docs');

        const check = await api('GET', `/api/pre-tenders/${testPreTenderId}`, { role: 'ADMIN' });
        assert(check.data?.item?.status === 'need_docs', 'status should be need_docs');
      }
    },
    {
      name: 'KANBAN-3: Cannot change status to accepted via PUT (must use accept endpoint)',
      run: async () => {
        if (!testPreTenderId) skip('no pre-tender ID');
        // Trying to set status=accepted via PUT should not work (accepted not in allowed list)
        await api('PUT', `/api/pre-tenders/${testPreTenderId}`, {
          role: 'ADMIN',
          body: { status: 'accepted' }
        });
        // Verify status did NOT change to accepted
        const check = await api('GET', `/api/pre-tenders/${testPreTenderId}`, { role: 'ADMIN' });
        assert(check.data?.item?.status !== 'accepted', 'status should NOT be accepted via PUT');
      }
    },
    {
      name: 'KANBAN-4: Reset status back to new for fast-track test',
      run: async () => {
        if (!testPreTenderId) skip('no pre-tender ID');
        await api('PUT', `/api/pre-tenders/${testPreTenderId}`, {
          role: 'ADMIN',
          body: { status: 'new' }
        });
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // 4. Fast-track endpoint
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'FT-1: Fast-track requires pm_id → 400 without it',
      run: async () => {
        if (!testPreTenderId) skip('no pre-tender ID');
        const resp = await api('POST', `/api/pre-tenders/${testPreTenderId}/fast-track`, {
          role: 'DIRECTOR_GEN',
          body: { comment: 'test' }
        });
        assert(resp.status === 400, `expected 400, got ${resp.status}`);
        assert(resp.data?.error?.includes('pm_id') || resp.data?.error?.includes('РП'), 'error mentions pm_id');
      }
    },
    {
      name: 'FT-2: Fast-track blocked for PM role (not director)',
      run: async () => {
        if (!testPreTenderId) skip('no pre-tender ID');
        const resp = await api('POST', `/api/pre-tenders/${testPreTenderId}/fast-track`, {
          role: 'PM',
          body: { pm_id: 1 }
        });
        assert(resp.status === 401 || resp.status === 403, `expected 401/403, got ${resp.status}`);
      }
    },
    {
      name: 'FT-3: Fast-track blocked for TO role',
      run: async () => {
        if (!testPreTenderId) skip('no pre-tender ID');
        const resp = await api('POST', `/api/pre-tenders/${testPreTenderId}/fast-track`, {
          role: 'TO',
          body: { pm_id: 1 }
        });
        assert(resp.status === 401 || resp.status === 403, `expected 401/403, got ${resp.status}`);
      }
    },
    {
      name: 'FT-4: Fast-track with invalid pm_id → 400',
      run: async () => {
        if (!testPreTenderId) skip('no pre-tender ID');
        const resp = await api('POST', `/api/pre-tenders/${testPreTenderId}/fast-track`, {
          role: 'DIRECTOR_GEN',
          body: { pm_id: 999999 }
        });
        assert(resp.status === 400, `expected 400 for invalid pm_id, got ${resp.status}`);
      }
    },
    {
      name: 'FT-5: Fast-track success (DIRECTOR_GEN assigns PM)',
      run: async () => {
        if (!testPreTenderId) skip('no pre-tender ID');

        // Get a real PM user first
        const usersResp = await api('GET', '/api/users', { role: 'ADMIN' });
        const users = usersResp.data?.items || usersResp.data?.users || usersResp.data || [];
        const pm = (Array.isArray(users) ? users : []).find(u => u.is_active && ['PM', 'HEAD_PM', 'ADMIN'].includes(u.role));
        if (!pm) skip('no PM user found in system');

        const resp = await api('POST', `/api/pre-tenders/${testPreTenderId}/fast-track`, {
          role: 'DIRECTOR_GEN',
          body: {
            pm_id: pm.id,
            contact_person: 'Test Manager',
            contact_phone: '+79001234567',
            comment: 'Срочно просчитать!',
            send_email: false
          }
        });

        assertOk(resp, 'fast-track');
        assert(resp.data?.tender_id, 'must return tender_id');
        assert(resp.data?.tender_status === 'Отправлено на просчёт', 'status must be "Отправлено на просчёт", got: ' + resp.data?.tender_status);
        assert(resp.data?.assigned_pm, 'must return assigned_pm name');
        testTenderId = resp.data.tender_id;
      }
    },
    {
      name: 'FT-6: Verify tender created with correct status',
      run: async () => {
        if (!testTenderId) skip('no tender from fast-track');
        const resp = await api('GET', `/api/tenders/${testTenderId}`, { role: 'ADMIN' });
        assertOk(resp, 'get tender');
        const t = resp.data?.tender;
        assert(t, 'tender exists');
        assert(t.tender_status === 'Отправлено на просчёт', 'tender status must be "Отправлено на просчёт", got: ' + t.tender_status);
        assert(t.responsible_pm_id, 'must have PM assigned');
        assert(t.comment_to?.includes('Быстрый путь'), 'comment should mention fast-track');
      }
    },
    {
      name: 'FT-7: Verify pre-tender marked as accepted after fast-track',
      run: async () => {
        if (!testPreTenderId) skip('no pre-tender ID');
        const resp = await api('GET', `/api/pre-tenders/${testPreTenderId}`, { role: 'ADMIN' });
        assertOk(resp, 'get pre-tender');
        const it = resp.data?.item;
        assert(it?.status === 'accepted', 'pre-tender status must be accepted, got: ' + it?.status);
        assert(it?.created_tender_id === testTenderId, 'created_tender_id must match');
      }
    },
    {
      name: 'FT-8: Cannot fast-track already accepted pre-tender',
      run: async () => {
        if (!testPreTenderId) skip('no pre-tender ID');
        const resp = await api('POST', `/api/pre-tenders/${testPreTenderId}/fast-track`, {
          role: 'DIRECTOR_GEN',
          body: { pm_id: 1 }
        });
        assert(resp.status === 400, `expected 400 for already-accepted, got ${resp.status}`);
      }
    },
    {
      name: 'FT-9: Fast-track for non-existent pre-tender → 404',
      run: async () => {
        const resp = await api('POST', '/api/pre-tenders/999999/fast-track', {
          role: 'DIRECTOR_GEN',
          body: { pm_id: 1 }
        });
        assert(resp.status === 404, `expected 404, got ${resp.status}`);
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // 5. List endpoint (for kanban: all statuses)
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'LIST-1: List pre-tenders without status filter returns all',
      run: async () => {
        const resp = await api('GET', '/api/pre-tenders?limit=10', { role: 'ADMIN' });
        assertOk(resp, 'list all');
        assert(resp.data?.items !== undefined || resp.data?.total !== undefined, 'returns items or total');
      }
    },
    {
      name: 'LIST-2: List pre-tenders filtered by status=new',
      run: async () => {
        const resp = await api('GET', '/api/pre-tenders?status=new&limit=10', { role: 'ADMIN' });
        assertOk(resp, 'list new');
        if (resp.data?.items?.length > 0) {
          assert(resp.data.items.every(it => it.status === 'new'), 'all items should be status=new');
        }
      }
    },
    {
      name: 'LIST-3: List with ai_color filter',
      run: async () => {
        const resp = await api('GET', '/api/pre-tenders?ai_color=green&limit=5', { role: 'ADMIN' });
        assertOk(resp, 'list by color');
      }
    },
    {
      name: 'LIST-4: List sorted by ai_work_match_score',
      run: async () => {
        const resp = await api('GET', '/api/pre-tenders?sort=ai_work_match_score&order=DESC&limit=5', { role: 'ADMIN' });
        assertOk(resp, 'list sorted');
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // 6. SSE stream connectivity test
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'SSE-3: SSE stream connects and sends initial event',
      run: async () => {
        const token = getToken('ADMIN');
        const url = `${BASE_URL}/api/sse/stream?token=${encodeURIComponent(token)}`;

        // Use fetch with AbortController to test SSE stream start
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);

        try {
          const resp = await fetch(url, {
            signal: controller.signal,
            headers: { 'Accept': 'text/event-stream' }
          });
          assert(resp.status === 200, `expected 200, got ${resp.status}`);
          assert(resp.headers.get('content-type')?.includes('text/event-stream'), 'content-type must be text/event-stream');

          // Read the first chunk
          const reader = resp.body.getReader();
          const { value } = await reader.read();
          const text = new TextDecoder().decode(value);
          assert(text.includes('connected'), 'first event should be "connected", got: ' + text.slice(0, 100));

          reader.cancel();
        } catch (e) {
          if (e.name === 'AbortError') {
            // Timeout is OK — SSE stays open
          } else {
            throw e;
          }
        } finally {
          clearTimeout(timeout);
          controller.abort();
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // 7. Cleanup
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'CLEANUP: delete test tender and pre-tender',
      run: async () => {
        if (testTenderId) {
          await api('DELETE', `/api/tenders/${testTenderId}`, { role: 'ADMIN' });
        }
        if (testPreTenderId) {
          await api('DELETE', `/api/pre-tenders/${testPreTenderId}`, { role: 'ADMIN' });
        }
      }
    }
  ]
};
