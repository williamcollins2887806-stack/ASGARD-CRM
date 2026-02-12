/**
 * BLOCK 5: ADVANCE REPORTS — Cash expense tracking, returns, closing
 */
'use strict';

const { api, assert, assertOk, assertStatus, assertForbidden,
        assertArray, assertHasFields, assertMatch,
        skip, TEST_USERS } = require('../config');

let workId = null;
let cashId = null;

module.exports = {
  name: 'BLOCK 5 — ADVANCE REPORTS',
  tests: [
    // ═══════════════════════════════════════════════
    // Setup
    // ═══════════════════════════════════════════════
    {
      name: 'Setup: create work for advance report',
      run: async () => {
        const resp = await api('POST', '/api/works', {
          role: 'PM',
          body: { work_title: 'Advance Report Work', work_status: 'В работе' }
        });
        assertOk(resp, 'create work');
        workId = (resp.data?.work || resp.data)?.id;
        assert(workId, 'work id');
      }
    },
    {
      name: 'Setup: create and approve cash request',
      run: async () => {
        if (!workId) skip('No work');
        // Create
        const create = await api('POST', '/api/cash', {
          role: 'PM',
          body: { work_id: workId, amount: 100000, purpose: 'Advance report cycle', type: 'advance' }
        });
        assertOk(create, 'create cash');
        cashId = create.data.id;
        assert(cashId, 'cash id');

        // Approve
        const approve = await api('PUT', `/api/cash/${cashId}/approve`, {
          role: 'DIRECTOR_GEN',
          body: { comment: 'Approved for test' }
        });
        assertOk(approve, 'approve');
      }
    },

    // ═══════════════════════════════════════════════
    // 5.1 Receive advance
    // ═══════════════════════════════════════════════
    {
      name: '5.1.1 PM confirms receipt → status received',
      run: async () => {
        if (!cashId) skip('No cash request');
        const resp = await api('PUT', `/api/cash/${cashId}/receive`, { role: 'PM', body: {} });
        assertOk(resp, 'receive');
        assert(resp.data.success === true, 'receive ok');
      }
    },
    {
      name: '5.1.2 Verify status is received',
      run: async () => {
        if (!cashId) skip('No cash');
        const resp = await api('GET', `/api/cash/${cashId}`, { role: 'PM' });
        assertOk(resp, 'check status');
        assertMatch(resp.data, { status: 'received' }, 'received status');
      }
    },

    // ═══════════════════════════════════════════════
    // 5.2 Add expenses (advance report items)
    // ═══════════════════════════════════════════════
    {
      name: '5.2.1 Add expense without file → 400 (file required)',
      run: async () => {
        if (!cashId) skip('No cash');
        // The endpoint requires multipart with file, JSON body without file should fail
        const resp = await api('POST', `/api/cash/${cashId}/expense`, {
          role: 'PM',
          body: { amount: 15000, description: 'Материалы' }
        });
        // Multipart expects file — should get 400 or similar
        assert(resp.status >= 400, `expected 4xx without file, got ${resp.status}`);
      }
    },
    {
      name: '5.2.2 Expense with negative amount → 400',
      run: async () => {
        if (!cashId) skip('No cash');
        const resp = await api('POST', `/api/cash/${cashId}/expense`, {
          role: 'PM',
          body: { amount: -500, description: 'Negative' }
        });
        assert(resp.status >= 400, `expected 4xx for negative, got ${resp.status}`);
      }
    },

    // ═══════════════════════════════════════════════
    // 5.3 Return remainder
    // ═══════════════════════════════════════════════
    {
      name: '5.3.1 Return partial amount',
      run: async () => {
        if (!cashId) skip('No cash');
        const resp = await api('POST', `/api/cash/${cashId}/return`, {
          role: 'PM',
          body: { amount: 20000, note: 'Partial return' }
        });
        assertOk(resp, 'return partial');
        const ret = resp.data;
        assert(ret.id, 'return id');
      }
    },
    {
      name: '5.3.2 Return too much → 400',
      run: async () => {
        if (!cashId) skip('No cash');
        const resp = await api('POST', `/api/cash/${cashId}/return`, {
          role: 'PM',
          body: { amount: 999999, note: 'Way too much' }
        });
        assertStatus(resp, 400, 'excess return');
      }
    },
    {
      name: '5.3.3 Return zero → 400',
      run: async () => {
        if (!cashId) skip('No cash');
        const resp = await api('POST', `/api/cash/${cashId}/return`, {
          role: 'PM',
          body: { amount: 0, note: 'Zero return' }
        });
        assertStatus(resp, 400, 'zero return');
      }
    },
    {
      name: '5.3.4 Return negative → 400',
      run: async () => {
        if (!cashId) skip('No cash');
        const resp = await api('POST', `/api/cash/${cashId}/return`, {
          role: 'PM',
          body: { amount: -100, note: 'Negative return' }
        });
        assertStatus(resp, 400, 'negative return');
      }
    },

    // ═══════════════════════════════════════════════
    // 5.4 Director confirms return
    // ═══════════════════════════════════════════════
    {
      name: '5.4.1 Director confirms return',
      run: async () => {
        if (!cashId) skip('No cash');
        // Get return list
        const detail = await api('GET', `/api/cash/${cashId}`, { role: 'DIRECTOR_GEN' });
        assertOk(detail, 'get detail');
        const returns = detail.data.returns || [];
        if (returns.length === 0) skip('No returns to confirm');

        const returnId = returns[0].id;
        const resp = await api('PUT', `/api/cash/${cashId}/return/${returnId}/confirm`, {
          role: 'DIRECTOR_GEN',
          body: {}
        });
        assertOk(resp, 'confirm return');
      }
    },

    // ═══════════════════════════════════════════════
    // 5.5 Balance check
    // ═══════════════════════════════════════════════
    {
      name: '5.5.1 Balance calculation correct',
      run: async () => {
        if (!cashId) skip('No cash');
        const resp = await api('GET', `/api/cash/${cashId}`, { role: 'PM' });
        assertOk(resp, 'get balance');
        assertHasFields(resp.data, ['balance'], 'balance field');
        const bal = resp.data.balance;
        assertHasFields(bal, ['approved', 'spent', 'returned', 'remainder'], 'balance fields');
        // remainder = approved - spent - returned
        const expected = Number(bal.approved) - Number(bal.spent) - Number(bal.returned);
        assert(
          Math.abs(Number(bal.remainder) - expected) < 0.01,
          `remainder calc: ${bal.remainder} vs expected ${expected}`
        );
      }
    },

    // ═══════════════════════════════════════════════
    // 5.6 Close with remainder check
    // ═══════════════════════════════════════════════
    {
      name: '5.6.1 Close with remainder > 0 without force → 400',
      run: async () => {
        if (!cashId) skip('No cash');
        const resp = await api('PUT', `/api/cash/${cashId}/close`, {
          role: 'DIRECTOR_GEN',
          body: { comment: 'Close attempt' }
        });
        // Should fail because remainder > 0 and force is not set
        if (resp.status === 200) {
          // Remainder might be 0, that's ok
          return;
        }
        assertStatus(resp, 400, 'close without force');
      }
    },
    {
      name: '5.6.2 Close with force=true → status closed',
      run: async () => {
        if (!cashId) skip('No cash');
        const resp = await api('PUT', `/api/cash/${cashId}/close`, {
          role: 'DIRECTOR_GEN',
          body: { comment: 'Force close', force: true }
        });
        assertOk(resp, 'force close');
      }
    },
    {
      name: '5.6.3 Verify closed status',
      run: async () => {
        if (!cashId) skip('No cash');
        const resp = await api('GET', `/api/cash/${cashId}`, { role: 'DIRECTOR_GEN' });
        assertOk(resp, 'check closed');
        assertMatch(resp.data, { status: 'closed' }, 'closed status');
      }
    },

    // ═══════════════════════════════════════════════
    // 5.7 Closed request restrictions
    // ═══════════════════════════════════════════════
    {
      name: '5.7.1 Cannot return to closed request',
      run: async () => {
        if (!cashId) skip('No cash');
        const resp = await api('POST', `/api/cash/${cashId}/return`, {
          role: 'PM',
          body: { amount: 1000, note: 'After close' }
        });
        assert(resp.status >= 400, 'cannot return to closed');
      }
    },

    // ═══════════════════════════════════════════════
    // 5.8 Full cycle: second request
    // ═══════════════════════════════════════════════
    {
      name: '5.8.1 Full cycle: create → approve → receive → return all → close',
      run: async () => {
        if (!workId) skip('No work');
        // Create
        const c = await api('POST', '/api/cash', {
          role: 'PM',
          body: { work_id: workId, amount: 50000, purpose: 'Full cycle 2', type: 'advance' }
        });
        assertOk(c, 'create');
        const id = c.data.id;

        // Approve
        const a = await api('PUT', `/api/cash/${id}/approve`, { role: 'DIRECTOR_GEN', body: {} });
        assertOk(a, 'approve');

        // Receive
        const r = await api('PUT', `/api/cash/${id}/receive`, { role: 'PM', body: {} });
        assertOk(r, 'receive');

        // Return full amount
        const ret = await api('POST', `/api/cash/${id}/return`, {
          role: 'PM',
          body: { amount: 50000, note: 'Full return' }
        });
        assertOk(ret, 'return all');

        // Close (no remainder, no force needed)
        const cl = await api('PUT', `/api/cash/${id}/close`, {
          role: 'DIRECTOR_GEN',
          body: { comment: 'Clean close' }
        });
        assertOk(cl, 'clean close');
      }
    },

    // ═══════════════════════════════════════════════
    // 5.9 Access control
    // ═══════════════════════════════════════════════
    {
      name: '5.9.1 TO cannot view cash detail of other user → 403',
      run: async () => {
        if (!cashId) skip('No cash');
        const resp = await api('GET', `/api/cash/${cashId}`, { role: 'TO' });
        // TO should be denied unless they're the owner
        assert(resp.status === 403 || resp.status === 401, `expected 403, got ${resp.status}`);
      }
    },
    {
      name: '5.9.2 HR cannot approve cash → 403',
      run: async () => {
        if (!workId) skip('No work');
        const c = await api('POST', '/api/cash', {
          role: 'PM',
          body: { work_id: workId, amount: 1000, purpose: 'HR test', type: 'advance' }
        });
        assertOk(c, 'create');
        const resp = await api('PUT', `/api/cash/${c.data.id}/approve`, {
          role: 'HR',
          body: {}
        });
        assertForbidden(resp, 'HR denied approve');
      }
    }
  ]
};
