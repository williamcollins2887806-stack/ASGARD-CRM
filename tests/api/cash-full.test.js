/**
 * CASH (Касса) — Full lifecycle + role access + negative tests
 *
 * Endpoints tested:
 *   GET  /api/cash/my              — requirePermission('cash', 'read')
 *   GET  /api/cash/all             — requirePermission('cash_admin', 'read')
 *   GET  /api/cash/summary         — requirePermission('cash_admin', 'read')
 *   GET  /api/cash/my-balance      — authenticate
 *   POST /api/cash                 — requirePermission('cash', 'write')
 *   GET  /api/cash/:id             — authenticate
 *   PUT  /api/cash/:id/approve     — requirePermission('cash_admin', 'write')
 *   PUT  /api/cash/:id/reject      — requirePermission('cash_admin', 'write')
 *   PUT  /api/cash/:id/question    — requirePermission('cash_admin', 'write')
 *   POST /api/cash/:id/reply       — requirePermission('cash', 'write')
 *   PUT  /api/cash/:id/receive     — requirePermission('cash', 'write')
 *   POST /api/cash/:id/expense     — requirePermission('cash', 'write')
 *   DELETE /api/cash/:id/expense/:eid — requirePermission('cash', 'write')
 *   POST /api/cash/:id/return      — requirePermission('cash', 'write')
 *   PUT  /api/cash/:id/return/:rid/confirm — requirePermission('cash_admin', 'write')
 *   PUT  /api/cash/:id/close       — requirePermission('cash_admin', 'write')
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, skip } = require('../config');

let testCashId = null;
let testWorkId = null;
let testReturnId = null;

module.exports = {
  name: 'CASH FULL (Касса — полный цикл)',
  tests: [
    // ── Setup: find a work_id for FK ──
    {
      name: 'Setup: find work for FK reference',
      run: async () => {
        const resp = await api('GET', '/api/works?limit=1', { role: 'ADMIN' });
        assertOk(resp, 'get works');
        const works = Array.isArray(resp.data) ? resp.data : (resp.data?.works || resp.data?.data || []);
        if (works.length > 0) testWorkId = works[0].id;
      }
    },

    // ── 1. ADMIN reads all cash requests ──
    {
      name: 'ADMIN reads all cash requests (GET /all)',
      run: async () => {
        const resp = await api('GET', '/api/cash/all', { role: 'ADMIN' });
        assertOk(resp, 'ADMIN cash/all');
        const list = Array.isArray(resp.data) ? resp.data : (resp.data?.requests || resp.data?.items || []);
        assertArray(list, 'cash/all list');
      }
    },

    // ── 2. ADMIN reads summary ──
    {
      name: 'ADMIN reads cash summary (GET /summary)',
      run: async () => {
        const resp = await api('GET', '/api/cash/summary', { role: 'ADMIN' });
        if (resp.status === 404) skip('cash/summary endpoint not available');
        assertOk(resp, 'cash summary');
        assert(resp.data !== null && resp.data !== undefined, 'summary should return data');
      }
    },

    // ── 3. ADMIN reads my-balance ──
    {
      name: 'ADMIN reads my-balance (GET /my-balance)',
      run: async () => {
        const resp = await api('GET', '/api/cash/my-balance', { role: 'ADMIN' });
        if (resp.status === 404) skip('cash/my-balance endpoint not available');
        assertOk(resp, 'my-balance');
        const d = resp.data;
        assert(d && typeof d === 'object', 'my-balance should return object');
        assertHasFields(d, ['balance'], 'my-balance shape');
      }
    },

    // ── 4. ADMIN reads my cash requests ──
    {
      name: 'ADMIN reads own cash requests (GET /my)',
      run: async () => {
        const resp = await api('GET', '/api/cash/my', { role: 'ADMIN' });
        assertOk(resp, 'ADMIN cash/my');
        const list = Array.isArray(resp.data) ? resp.data : (resp.data?.requests || resp.data?.items || []);
        assertArray(list, 'cash/my list');
      }
    },

    // ── 5. ADMIN creates cash request ──
    {
      name: 'ADMIN creates cash request (POST /)',
      run: async () => {
        const resp = await api('POST', '/api/cash', {
          role: 'ADMIN',
          body: {
            amount: 25000,
            purpose: 'E2E autotest: закупка материалов',
            work_id: testWorkId || null,
            type: testWorkId ? 'advance' : 'expense'
          }
        });
        assertOk(resp, 'create cash request');
        const d = resp.data;
        assert(d && d.id, 'create should return id');
        testCashId = d.id;
        assert(
          d.amount !== undefined && d.amount !== null && !isNaN(Number(d.amount)),
          'amount should be numeric, got ' + JSON.stringify(d.amount)
        );
      }
    },

    // ── 6. Read-back by ID ──
    {
      name: 'Read-back cash request by ID (GET /:id)',
      run: async () => {
        if (!testCashId) skip('no testCashId — create failed');
        const resp = await api('GET', `/api/cash/${testCashId}`, { role: 'ADMIN' });
        assertOk(resp, 'read cash by id');
        const d = resp.data;
        assertHasFields(d, ['id', 'status', 'amount', 'purpose'], 'cash detail');
        assert(d.id === testCashId, `expected id=${testCashId}, got ${d.id}`);
        assert(d.status === 'requested', `new request should be "requested", got "${d.status}"`);
      }
    },

    // ── 7. Approve request ──
    {
      name: 'ADMIN approves cash request (PUT /:id/approve)',
      run: async () => {
        if (!testCashId) skip('no testCashId');
        const resp = await api('PUT', `/api/cash/${testCashId}/approve`, {
          role: 'ADMIN',
          body: { comment: 'Approved by autotest' }
        });
        assertOk(resp, 'approve cash request');
      }
    },

    // ── 8. Verify status changed to approved ──
    {
      name: 'Verify status is "approved" after approve',
      run: async () => {
        if (!testCashId) skip('no testCashId');
        const resp = await api('GET', `/api/cash/${testCashId}`, { role: 'ADMIN' });
        assertOk(resp, 'read-back after approve');
        assert(resp.data.status === 'approved', `expected "approved", got "${resp.data.status}"`);
      }
    },

    // ── 9. Mark received ──
    {
      name: 'ADMIN marks cash as received (PUT /:id/receive)',
      run: async () => {
        if (!testCashId) skip('no testCashId');
        const resp = await api('PUT', `/api/cash/${testCashId}/receive`, {
          role: 'ADMIN',
          body: {}
        });
        assertOk(resp, 'mark received');
      }
    },

    // ── 10. Verify status is received ──
    {
      name: 'Verify status is "received" after receive',
      run: async () => {
        if (!testCashId) skip('no testCashId');
        const resp = await api('GET', `/api/cash/${testCashId}`, { role: 'ADMIN' });
        assertOk(resp, 'read-back after receive');
        assert(resp.data.status === 'received', `expected "received", got "${resp.data.status}"`);
      }
    },

    // ── 11. Return cash (partial) ──
    {
      name: 'ADMIN returns cash remainder (POST /:id/return)',
      run: async () => {
        if (!testCashId) skip('no testCashId');
        const resp = await api('POST', `/api/cash/${testCashId}/return`, {
          role: 'ADMIN',
          body: { amount: 5000, note: 'Partial return from autotest' }
        });
        assertOk(resp, 'return cash');
        const d = resp.data;
        assert(d && d.id, 'return should return id');
        testReturnId = d.id;
      }
    },

    // ── 12. Confirm return ──
    {
      name: 'ADMIN confirms return (PUT /:id/return/:returnId/confirm)',
      run: async () => {
        if (!testCashId || !testReturnId) skip('no testCashId or testReturnId');
        const resp = await api('PUT', `/api/cash/${testCashId}/return/${testReturnId}/confirm`, {
          role: 'ADMIN',
          body: {}
        });
        assertOk(resp, 'confirm return');
      }
    },

    // ── 13. Close request ──
    {
      name: 'ADMIN closes cash request (PUT /:id/close)',
      run: async () => {
        if (!testCashId) skip('no testCashId');
        const resp = await api('PUT', `/api/cash/${testCashId}/close`, {
          role: 'ADMIN',
          body: { comment: 'Closed by autotest', force: true }
        });
        assertOk(resp, 'close cash request');
      }
    },

    // ── 14. Verify status is closed ──
    {
      name: 'Verify status is "closed" after close',
      run: async () => {
        if (!testCashId) skip('no testCashId');
        const resp = await api('GET', `/api/cash/${testCashId}`, { role: 'ADMIN' });
        assertOk(resp, 'read-back after close');
        assert(resp.data.status === 'closed', `expected "closed", got "${resp.data.status}"`);
      }
    },

    // ── 15. NEGATIVE: HR cannot create cash request (no cash.write) ──
    {
      name: 'NEGATIVE: HR cannot create cash request → 403',
      run: async () => {
        const resp = await api('POST', '/api/cash', {
          role: 'HR',
          body: { amount: 1000, purpose: 'forbidden', type: 'expense' }
        });
        assertForbidden(resp, 'HR create cash');
      }
    },

    // ── 16. NEGATIVE: WAREHOUSE cannot create cash request (no cash.write) ──
    {
      name: 'NEGATIVE: WAREHOUSE cannot create cash request → 403',
      run: async () => {
        const resp = await api('POST', '/api/cash', {
          role: 'WAREHOUSE',
          body: { amount: 1000, purpose: 'forbidden', type: 'expense' }
        });
        assertForbidden(resp, 'WAREHOUSE create cash');
      }
    },

    // ── 17. NEGATIVE: HR cannot access cash/all (no cash_admin.read) ──
    {
      name: 'NEGATIVE: HR cannot read all cash requests → 403',
      run: async () => {
        const resp = await api('GET', '/api/cash/all', { role: 'HR' });
        assertForbidden(resp, 'HR cash/all');
      }
    },

    // ── 18. NEGATIVE: WAREHOUSE cannot access cash/all (no cash_admin.read) ──
    {
      name: 'NEGATIVE: WAREHOUSE cannot read all cash requests → 403',
      run: async () => {
        const resp = await api('GET', '/api/cash/all', { role: 'WAREHOUSE' });
        assertForbidden(resp, 'WAREHOUSE cash/all');
      }
    },

    // ── 19. NEGATIVE: HR cannot approve cash request (no cash_admin.write) ──
    {
      name: 'NEGATIVE: HR cannot approve cash request → 403',
      run: async () => {
        // Create a fresh request to attempt approval on
        const create = await api('POST', '/api/cash', {
          role: 'ADMIN',
          body: { amount: 500, purpose: 'neg-test approve', type: 'expense' }
        });
        const negId = create.data?.id;
        if (!negId) skip('could not create cash request for negative test');

        const resp = await api('PUT', `/api/cash/${negId}/approve`, {
          role: 'HR',
          body: { comment: 'forbidden' }
        });
        assertForbidden(resp, 'HR approve cash');

        // Cleanup
        await api('PUT', `/api/cash/${negId}/reject`, {
          role: 'ADMIN',
          body: { comment: 'cleanup after neg test' }
        });
      }
    },

    // ── 20. NEGATIVE: WAREHOUSE cannot close cash request (no cash_admin.write) ──
    {
      name: 'NEGATIVE: WAREHOUSE cannot close cash request → 403',
      run: async () => {
        const create = await api('POST', '/api/cash', {
          role: 'ADMIN',
          body: { amount: 500, purpose: 'neg-test close', type: 'expense' }
        });
        const negId = create.data?.id;
        if (!negId) skip('could not create cash request for negative test');

        const resp = await api('PUT', `/api/cash/${negId}/close`, {
          role: 'WAREHOUSE',
          body: { comment: 'forbidden', force: true }
        });
        assertForbidden(resp, 'WAREHOUSE close cash');

        // Cleanup
        await api('PUT', `/api/cash/${negId}/reject`, {
          role: 'ADMIN',
          body: { comment: 'cleanup after neg test' }
        });
      }
    },

    // ── 21. NEGATIVE: create with empty body → 400 ──
    {
      name: 'NEGATIVE: create cash with empty body → 400',
      run: async () => {
        const resp = await api('POST', '/api/cash', {
          role: 'ADMIN',
          body: {}
        });
        assert(resp.status === 400, `empty body should return 400, got ${resp.status}`);
      }
    },

    // ── 22. Question + Reply lifecycle ──
    {
      name: 'ADMIN asks question then replies (question + reply lifecycle)',
      run: async () => {
        // Create a fresh request
        const create = await api('POST', '/api/cash', {
          role: 'ADMIN',
          body: { amount: 3000, purpose: 'question-reply lifecycle test', type: 'expense' }
        });
        assertOk(create, 'create for question test');
        const qId = create.data?.id;
        if (!qId) skip('could not create cash request for question test');

        // Ask question
        const qResp = await api('PUT', `/api/cash/${qId}/question`, {
          role: 'ADMIN',
          body: { message: 'Please clarify the purpose' }
        });
        assertOk(qResp, 'ask question');

        // Verify status is question
        const check = await api('GET', `/api/cash/${qId}`, { role: 'ADMIN' });
        assertOk(check, 'read after question');
        assert(check.data.status === 'question', `expected "question", got "${check.data.status}"`);

        // Reply (ADMIN is also the owner here)
        const replyResp = await api('POST', `/api/cash/${qId}/reply`, {
          role: 'ADMIN',
          body: { message: 'Materials for site #42' }
        });
        assertOk(replyResp, 'reply to question');

        // Verify status returns to requested
        const check2 = await api('GET', `/api/cash/${qId}`, { role: 'ADMIN' });
        assertOk(check2, 'read after reply');
        assert(check2.data.status === 'requested', `expected "requested" after reply, got "${check2.data.status}"`);

        // Cleanup: reject the request
        await api('PUT', `/api/cash/${qId}/reject`, {
          role: 'ADMIN',
          body: { comment: 'cleanup question test' }
        });
      }
    },

    // ── 23. Reject lifecycle ──
    {
      name: 'ADMIN creates and rejects cash request (reject lifecycle)',
      run: async () => {
        const create = await api('POST', '/api/cash', {
          role: 'ADMIN',
          body: { amount: 1000, purpose: 'reject lifecycle test', type: 'expense' }
        });
        assertOk(create, 'create for reject test');
        const rId = create.data?.id;
        if (!rId) skip('could not create cash request for reject test');

        const resp = await api('PUT', `/api/cash/${rId}/reject`, {
          role: 'ADMIN',
          body: { comment: 'Rejected by autotest' }
        });
        assertOk(resp, 'reject cash request');

        // Verify status
        const check = await api('GET', `/api/cash/${rId}`, { role: 'ADMIN' });
        assertOk(check, 'read-back after reject');
        assert(check.data.status === 'rejected', `expected "rejected", got "${check.data.status}"`);
      }
    },

    // ── 24. NEGATIVE: HR cannot read summary (no cash_admin.read) ──
    {
      name: 'NEGATIVE: HR cannot read cash summary → 403',
      run: async () => {
        const resp = await api('GET', '/api/cash/summary', { role: 'HR' });
        if (resp.status === 404) skip('cash/summary endpoint not available');
        assertForbidden(resp, 'HR cash/summary');
      }
    },

    // ── 25. NEGATIVE: WAREHOUSE cannot read summary ──
    {
      name: 'NEGATIVE: WAREHOUSE cannot read cash summary → 403',
      run: async () => {
        const resp = await api('GET', '/api/cash/summary', { role: 'WAREHOUSE' });
        if (resp.status === 404) skip('cash/summary endpoint not available');
        assertForbidden(resp, 'WAREHOUSE cash/summary');
      }
    }
  ]
};
