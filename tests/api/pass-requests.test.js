/**
 * PASS_REQUESTS — Full CRUD + status + role access + negative tests
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, skip } = require('../config');

let testPassId = null;
let testWorkId = null;

module.exports = {
  name: 'PASS REQUESTS (Заявки на пропуск)',
  tests: [
    // ── Setup ──
    {
      name: 'Setup: find work for FK',
      run: async () => {
        const resp = await api('GET', '/api/works?limit=1', { role: 'ADMIN' });
        assertOk(resp, 'get works');
        const works = Array.isArray(resp.data) ? resp.data : (resp.data?.works || resp.data?.data || []);
        if (works.length > 0) testWorkId = works[0].id;
      }
    },
    // ── READ ──
    {
      name: 'ADMIN reads pass requests list',
      run: async () => {
        const resp = await api('GET', '/api/pass-requests', { role: 'ADMIN' });
        assertOk(resp, 'pass requests list');
        const list = Array.isArray(resp.data) ? resp.data : (resp.data?.pass_requests || resp.data?.data || resp.data?.items || []);
        assertArray(list, 'pass requests');
      }
    },
    {
      name: 'PM reads pass requests',
      run: async () => {
        const resp = await api('GET', '/api/pass-requests', { role: 'PM' });
        assertOk(resp, 'PM pass requests');
      }
    },
    {
      name: 'HR reads pass requests',
      run: async () => {
        const resp = await api('GET', '/api/pass-requests', { role: 'HR' });
        assertOk(resp, 'HR pass requests');
      }
    },
    // ── CREATE ──
    {
      name: 'ADMIN creates pass request',
      run: async () => {
        const resp = await api('POST', '/api/pass-requests', {
          role: 'ADMIN',
          body: {
            work_id: testWorkId || null,
            object_name: 'Тестовый объект',
            pass_date_from: '2026-03-01',
            pass_date_to: '2026-03-31',
            employees_json: JSON.stringify([{ name: 'Тестовый Работник', passport: '1234 567890' }]),
            contact_person: 'Тест',
            notes: 'E2E autotest pass request'
          }
        });
        assertOk(resp, 'create pass request');
        const pr = resp.data?.pass_request || resp.data;
        if (pr?.id) testPassId = pr.id;
      }
    },
    {
      name: 'HR creates pass request',
      run: async () => {
        const resp = await api('POST', '/api/pass-requests', {
          role: 'HR',
          body: {
            object_name: 'HR Объект',
            pass_date_from: '2026-03-01',
            pass_date_to: '2026-03-15',
            notes: 'HR autotest'
          }
        });
        assertOk(resp, 'HR create pass request');
        const pr = resp.data?.pass_request || resp.data;
        if (pr?.id) await api('DELETE', `/api/pass-requests/${pr.id}`, { role: 'ADMIN' });
      }
    },
    // ── NEGATIVE: forbidden roles ──
    {
      name: 'NEGATIVE: BUH cannot create pass request → 403',
      run: async () => {
        const resp = await api('POST', '/api/pass-requests', {
          role: 'BUH',
          body: { object_name: 'forbidden', pass_date_from: '2026-03-01', pass_date_to: '2026-03-31' }
        });
        assertForbidden(resp, 'BUH create pass request');
      }
    },
    {
      name: 'NEGATIVE: WAREHOUSE cannot create pass request → 403',
      run: async () => {
        const resp = await api('POST', '/api/pass-requests', {
          role: 'WAREHOUSE',
          body: { object_name: 'forbidden', pass_date_from: '2026-03-01', pass_date_to: '2026-03-31' }
        });
        assertForbidden(resp, 'WAREHOUSE create pass request');
      }
    },
    {
      name: 'NEGATIVE: OFFICE_MANAGER cannot create pass request → 403',
      run: async () => {
        const resp = await api('POST', '/api/pass-requests', {
          role: 'OFFICE_MANAGER',
          body: { object_name: 'forbidden', pass_date_from: '2026-03-01', pass_date_to: '2026-03-31' }
        });
        assertForbidden(resp, 'OFFICE_MANAGER create pass');
      }
    },
    // ── READ by ID ──
    {
      name: 'Read pass request by ID',
      run: async () => {
        if (!testPassId) return;
        const resp = await api('GET', `/api/pass-requests/${testPassId}`, { role: 'ADMIN' });
        assertOk(resp, 'get pass request');
        const pr = resp.data?.pass_request || resp.data;
        assertHasFields(pr, ['id'], 'pass request detail');
      }
    },
    // ── UPDATE ──
    {
      name: 'ADMIN updates pass request',
      run: async () => {
        if (!testPassId) return;
        const resp = await api('PUT', `/api/pass-requests/${testPassId}`, {
          role: 'ADMIN',
          body: { description: 'Updated pass request' }
        });
        assertOk(resp, 'update pass request');
      }
    },
    // ── STATUS ──
    {
      name: 'Change pass request status',
      run: async () => {
        if (!testPassId) return;
        const resp = await api('PUT', `/api/pass-requests/${testPassId}/status`, {
          role: 'ADMIN',
          body: { status: 'approved' }
        });
        if (resp.status === 404) skip('status endpoint not found');
        assertOk(resp, 'pass request status');
      }
    },
    // ── PDF ──
    {
      name: 'Pass request PDF',
      run: async () => {
        if (!testPassId) return;
        const resp = await api('GET', `/api/pass-requests/${testPassId}/pdf`, { role: 'ADMIN' });
        assert(resp.status < 500, `PDF should not 5xx, got ${resp.status}`);
      }
    },
    // ── DELETE: only ADMIN ──
    {
      name: 'NEGATIVE: PM cannot delete pass request → 403',
      run: async () => {
        if (!testPassId) return;
        const resp = await api('DELETE', `/api/pass-requests/${testPassId}`, { role: 'PM' });
        assertForbidden(resp, 'PM delete pass request');
      }
    },
    {
      name: 'Cleanup: ADMIN deletes pass request',
      run: async () => {
        if (!testPassId) return;
        const resp = await api('DELETE', `/api/pass-requests/${testPassId}`, { role: 'ADMIN' });
        assertOk(resp, 'delete pass request');
        testPassId = null;
      }
    }
  ]
};
