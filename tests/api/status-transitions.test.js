/**
 * BLOCK 7: STATUS TRANSITIONS — All valid & invalid state changes
 * Tenders, Cash Requests, Tasks, Invoices, Equipment
 */
'use strict';

const { api, assert, assertOk, assertStatus, assertForbidden,
        assertArray, assertHasFields, assertMatch, assertOneOf,
        skip, TEST_USERS } = require('../config');

let workId = null;

module.exports = {
  name: 'BLOCK 7 — STATUS TRANSITIONS',
  tests: [
    // ═══════════════════════════════════════════════
    // Setup
    // ═══════════════════════════════════════════════
    {
      name: 'Setup: create work for tests',
      run: async () => {
        const resp = await api('POST', '/api/works', {
          role: 'PM',
          body: { work_title: 'Status Transition Work', work_status: 'В работе' }
        });
        assertOk(resp, 'create work');
        workId = (resp.data?.work || resp.data)?.id;
        assert(workId, 'work id');
      }
    },

    // ═══════════════════════════════════════════════
    // 7.1 Tender status transitions
    // ═══════════════════════════════════════════════
    {
      name: '7.1.1 Tender: Новый → В работе',
      run: async () => {
        const create = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: 'Status-Test-1', tender_status: 'Новый' }
        });
        assertOk(create, 'create');
        const id = (create.data?.tender || create.data).id;

        const resp = await api('PUT', `/api/tenders/${id}`, {
          role: 'TO',
          body: { tender_status: 'В работе' }
        });
        assertOk(resp, 'new → in_work');
        const t = resp.data?.tender || resp.data;
        assertMatch(t, { tender_status: 'В работе' }, 'in work');
      }
    },
    {
      name: '7.1.2 Tender: В работе → Выиграли',
      run: async () => {
        const create = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: 'Status-Test-2', tender_status: 'В работе' }
        });
        assertOk(create, 'create');
        const id = (create.data?.tender || create.data).id;

        const resp = await api('PUT', `/api/tenders/${id}`, {
          role: 'TO',
          body: { tender_status: 'Выиграли' }
        });
        assertOk(resp, 'work → won');
      }
    },
    {
      name: '7.1.3 Tender: В работе → Проиграли',
      run: async () => {
        const create = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: 'Status-Test-3', tender_status: 'В работе' }
        });
        assertOk(create, 'create');
        const id = (create.data?.tender || create.data).id;

        const resp = await api('PUT', `/api/tenders/${id}`, {
          role: 'TO',
          body: { tender_status: 'Проиграли' }
        });
        assertOk(resp, 'work → lost');
      }
    },
    {
      name: '7.1.4 Tender: Выиграли → Контракт',
      run: async () => {
        const create = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: 'Status-Test-4', tender_status: 'Выиграли' }
        });
        assertOk(create, 'create');
        const id = (create.data?.tender || create.data).id;

        const resp = await api('PUT', `/api/tenders/${id}`, {
          role: 'TO',
          body: { tender_status: 'Контракт' }
        });
        assertOk(resp, 'won → contract');
      }
    },
    {
      name: '7.1.5 Tender: all status values list',
      run: async () => {
        const statuses = ['Новый', 'В работе', 'Оценка', 'Торги', 'Выиграли', 'Проиграли', 'Контракт', 'Отказ', 'Архив'];
        for (const s of statuses) {
          const resp = await api('POST', '/api/tenders', {
            role: 'TO',
            body: { customer: `ST-${s}`, tender_status: s }
          });
          assertOk(resp, `status ${s}`);
        }
      }
    },

    // ═══════════════════════════════════════════════
    // 7.2 Cash Request status transitions
    // ═══════════════════════════════════════════════
    {
      name: '7.2.1 Cash: requested → approved → received → closed',
      run: async () => {
        if (!workId) skip('No work');
        const c = await api('POST', '/api/cash', {
          role: 'PM',
          body: { work_id: workId, amount: 30000, purpose: 'Status test full', type: 'advance' }
        });
        assertOk(c, 'create');
        const id = c.data.id;

        // Approve
        const a = await api('PUT', `/api/cash/${id}/approve`, { role: 'DIRECTOR_GEN', body: {} });
        assertOk(a, 'approve');

        // Receive
        const r = await api('PUT', `/api/cash/${id}/receive`, { role: 'PM', body: {} });
        assertOk(r, 'receive');

        // Close
        const cl = await api('PUT', `/api/cash/${id}/close`, { role: 'DIRECTOR_GEN', body: { force: true } });
        assertOk(cl, 'close');
      }
    },
    {
      name: '7.2.2 Cash: requested → rejected',
      run: async () => {
        if (!workId) skip('No work');
        const c = await api('POST', '/api/cash', {
          role: 'PM',
          body: { work_id: workId, amount: 5000, purpose: 'Reject transition', type: 'advance' }
        });
        assertOk(c, 'create');
        const resp = await api('PUT', `/api/cash/${c.data.id}/reject`, {
          role: 'DIRECTOR_GEN',
          body: { comment: 'Denied' }
        });
        assertOk(resp, 'reject');
      }
    },
    {
      name: '7.2.3 Cash: cannot approve when not requested',
      run: async () => {
        if (!workId) skip('No work');
        const c = await api('POST', '/api/cash', {
          role: 'PM',
          body: { work_id: workId, amount: 5000, purpose: 'Guard test', type: 'advance' }
        });
        assertOk(c, 'create');
        const id = c.data.id;

        // Approve
        await api('PUT', `/api/cash/${id}/approve`, { role: 'DIRECTOR_GEN', body: {} });

        // Try approve again → 400
        const resp = await api('PUT', `/api/cash/${id}/approve`, { role: 'DIRECTOR_GEN', body: {} });
        assertStatus(resp, 400, 'double approve');
      }
    },
    {
      name: '7.2.4 Cash: cannot receive when status is not approved',
      run: async () => {
        if (!workId) skip('No work');
        const c = await api('POST', '/api/cash', {
          role: 'PM',
          body: { work_id: workId, amount: 5000, purpose: 'Receive guard', type: 'advance' }
        });
        assertOk(c, 'create');
        // Try receive while still requested
        const resp = await api('PUT', `/api/cash/${c.data.id}/receive`, { role: 'PM', body: {} });
        assertStatus(resp, 400, 'receive from requested');
      }
    },
    {
      name: '7.2.5 Cash: cannot close from requested status',
      run: async () => {
        if (!workId) skip('No work');
        const c = await api('POST', '/api/cash', {
          role: 'PM',
          body: { work_id: workId, amount: 5000, purpose: 'Close guard', type: 'advance' }
        });
        assertOk(c, 'create');
        const resp = await api('PUT', `/api/cash/${c.data.id}/close`, {
          role: 'DIRECTOR_GEN',
          body: { force: true }
        });
        assertStatus(resp, 400, 'close from requested');
      }
    },
    {
      name: '7.2.6 Cash: question → reply → back to requested',
      run: async () => {
        if (!workId) skip('No work');
        const c = await api('POST', '/api/cash', {
          role: 'PM',
          body: { work_id: workId, amount: 5000, purpose: 'Q&A cycle', type: 'advance' }
        });
        assertOk(c, 'create');
        const id = c.data.id;

        // Ask question
        await api('PUT', `/api/cash/${id}/question`, {
          role: 'DIRECTOR_GEN',
          body: { message: 'Уточните' }
        });

        // Reply
        await api('POST', `/api/cash/${id}/reply`, {
          role: 'PM',
          body: { message: 'Уточнение' }
        });

        // Verify back to requested
        const detail = await api('GET', `/api/cash/${id}`, { role: 'PM' });
        assertOk(detail, 'check status');
        assertMatch(detail.data, { status: 'requested' }, 'back to requested');
      }
    },

    // ═══════════════════════════════════════════════
    // 7.3 Task status transitions
    // ═══════════════════════════════════════════════
    {
      name: '7.3.1 Task: new → accepted → in_progress → done',
      run: async () => {
        const c = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: { assignee_id: TEST_USERS.PM.id, title: 'Status full cycle' }
        });
        assertOk(c, 'create');
        const id = (c.data?.task || c.data).id;

        // Accept
        const a = await api('PUT', `/api/tasks/${id}/accept`, { role: 'PM', body: {} });
        assertOk(a, 'accept');

        // Start
        const s = await api('PUT', `/api/tasks/${id}/start`, { role: 'PM', body: {} });
        assertOk(s, 'start');

        // Complete
        const d = await api('PUT', `/api/tasks/${id}/complete`, { role: 'PM', body: {} });
        assertOk(d, 'complete');

        // Verify done
        const check = await api('GET', `/api/tasks/${id}`, { role: 'ADMIN' });
        assertMatch(check.data?.task || check.data, { status: 'done' }, 'done');
      }
    },
    {
      name: '7.3.2 Task: new → in_progress (skip accept)',
      run: async () => {
        const c = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: { assignee_id: TEST_USERS.PM.id, title: 'Skip accept' }
        });
        assertOk(c, 'create');
        const id = (c.data?.task || c.data).id;

        const resp = await api('PUT', `/api/tasks/${id}/start`, { role: 'PM', body: {} });
        assertOk(resp, 'start from new');
      }
    },
    {
      name: '7.3.3 Task: new → done (fast complete)',
      run: async () => {
        const c = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: { assignee_id: TEST_USERS.PM.id, title: 'Fast complete' }
        });
        assertOk(c, 'create');
        const id = (c.data?.task || c.data).id;

        const resp = await api('PUT', `/api/tasks/${id}/complete`, { role: 'PM', body: {} });
        assertOk(resp, 'complete from new');
      }
    },
    {
      name: '7.3.4 Task: cannot accept already-accepted',
      run: async () => {
        const c = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: { assignee_id: TEST_USERS.PM.id, title: 'Double accept' }
        });
        assertOk(c, 'create');
        const id = (c.data?.task || c.data).id;

        await api('PUT', `/api/tasks/${id}/accept`, { role: 'PM', body: {} });

        // Accept again → should fail (status is accepted, not new)
        const resp = await api('PUT', `/api/tasks/${id}/accept`, { role: 'PM', body: {} });
        assertStatus(resp, 400, 'double accept');
      }
    },
    {
      name: '7.3.5 Task: kanban move new → done auto-completes',
      run: async () => {
        const c = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: { assignee_id: TEST_USERS.PM.id, title: 'Kanban auto-complete' }
        });
        assertOk(c, 'create');
        const id = (c.data?.task || c.data).id;

        const resp = await api('PUT', `/api/tasks/${id}/move`, {
          role: 'PM',
          body: { column: 'done' }
        });
        assertOk(resp, 'move to done');
      }
    },

    // ═══════════════════════════════════════════════
    // 7.4 Work status transitions
    // ═══════════════════════════════════════════════
    {
      name: '7.4.1 Work: Подготовка → В работе',
      run: async () => {
        const c = await api('POST', '/api/works', {
          role: 'PM',
          body: { work_title: 'Work Status 1', work_status: 'Подготовка' }
        });
        assertOk(c, 'create');
        const id = (c.data?.work || c.data).id;

        const resp = await api('PUT', `/api/works/${id}`, {
          role: 'PM',
          body: { work_status: 'В работе' }
        });
        assertOk(resp, 'prep → work');
      }
    },
    {
      name: '7.4.2 Work: В работе → Работы сдали',
      run: async () => {
        const c = await api('POST', '/api/works', {
          role: 'PM',
          body: { work_title: 'Work Status 2', work_status: 'В работе' }
        });
        assertOk(c, 'create');
        const id = (c.data?.work || c.data).id;

        const resp = await api('PUT', `/api/works/${id}`, {
          role: 'PM',
          body: { work_status: 'Работы сдали' }
        });
        assertOk(resp, 'work → done');
      }
    },
    {
      name: '7.4.3 Work: Работы сдали → Закрыт',
      run: async () => {
        const c = await api('POST', '/api/works', {
          role: 'PM',
          body: { work_title: 'Work Status 3', work_status: 'Работы сдали' }
        });
        assertOk(c, 'create');
        const id = (c.data?.work || c.data).id;

        const resp = await api('PUT', `/api/works/${id}`, {
          role: 'PM',
          body: { work_status: 'Закрыт' }
        });
        assertOk(resp, 'done → closed');
      }
    },
    {
      name: '7.4.4 Work: all valid statuses',
      run: async () => {
        const statuses = ['Подготовка', 'Мобилизация', 'В работе', 'Работы сдали', 'Закрыт'];
        for (const s of statuses) {
          const resp = await api('POST', '/api/works', {
            role: 'PM',
            body: { work_title: `Status-${s}`, work_status: s }
          });
          assertOk(resp, `create with status ${s}`);
        }
      }
    },

    // ═══════════════════════════════════════════════
    // 7.5 Invoice status transitions via payment
    // ═══════════════════════════════════════════════
    {
      name: '7.5.1 Invoice: draft → partial → paid via payments',
      run: async () => {
        const c = await api('POST', '/api/invoices', {
          role: 'PM',
          body: {
            invoice_number: `ST-INV-${Date.now()}`,
            invoice_date: '2026-02-10',
            amount: 100000,
            total_amount: 100000,
            status: 'draft'
          }
        });
        assertOk(c, 'create invoice');
        const id = (c.data?.invoice || c.data)?.id;
        assert(id, 'invoice id');

        // Partial payment
        const p1 = await api('POST', `/api/invoices/${id}/payments`, {
          role: 'PM',
          body: { amount: 50000 }
        });
        assertOk(p1, 'partial payment');
        assertMatch(p1.data, { new_status: 'partial' }, 'partial');

        // Full payment
        const p2 = await api('POST', `/api/invoices/${id}/payments`, {
          role: 'PM',
          body: { amount: 50000 }
        });
        assertOk(p2, 'full payment');
        assertMatch(p2.data, { new_status: 'paid' }, 'paid');
      }
    },

    // ═══════════════════════════════════════════════
    // 7.6 Estimate approval_status transitions (via /api/approval)
    // ═══════════════════════════════════════════════
    {
      name: '7.6.1 Estimate: draft → sent → approved',
      run: async () => {
        // Create with sent status (auto-submits for approval)
        const c = await api('POST', '/api/estimates', {
          role: 'PM',
          body: { title: 'Est Status 1', approval_status: 'sent', amount: 100000 }
        });
        assertOk(c, 'create sent');
        const id = (c.data?.estimate || c.data).id;

        const a = await api('POST', `/api/approval/estimates/${id}/approve`, {
          role: 'DIRECTOR_GEN',
          body: { comment: 'OK' }
        });
        assertOk(a, 'sent → approved');
      }
    },
    {
      name: '7.6.2 Estimate: sent → rework → resubmit → rejected',
      run: async () => {
        const c = await api('POST', '/api/estimates', {
          role: 'PM',
          body: { title: 'Est Status 2', approval_status: 'sent', amount: 200000 }
        });
        assertOk(c, 'create sent');
        const id = (c.data?.estimate || c.data).id;

        // Director sends to rework
        const rw = await api('POST', `/api/approval/estimates/${id}/rework`, {
          role: 'DIRECTOR_GEN',
          body: { comment: 'Too expensive' }
        });
        assertOk(rw, 'sent → rework');

        // PM resubmits
        const resub = await api('POST', `/api/approval/estimates/${id}/resubmit`, {
          role: 'PM',
          body: {}
        });
        assertOk(resub, 'rework → sent (resubmit)');

        // Director rejects
        const rej = await api('POST', `/api/approval/estimates/${id}/reject`, {
          role: 'DIRECTOR_GEN',
          body: { comment: 'Still too expensive' }
        });
        assertOk(rej, 'sent → rejected');
      }
    }
  ]
};
