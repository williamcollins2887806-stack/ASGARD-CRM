/**
 * MODALS & ACTIONS — Tests for modal-triggered actions (status changes, approvals, etc.)
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, skip } = require('../config');

let testTaskId = null;
let testTenderId = null;
let assigneeId = null;

module.exports = {
  name: 'MODALS & ACTIONS (Модальные действия)',
  tests: [
    // ── Setup ──
    {
      name: 'Setup: get real user for FK',
      run: async () => {
        const users = await api('GET', '/api/users', { role: 'ADMIN' });
        const list = Array.isArray(users.data) ? users.data : (users.data?.users || []);
        assigneeId = list.find(u => u.is_active !== false)?.id || list[0]?.id || 1;
      }
    },
    // ── Task status modal actions ──
    {
      name: 'Create task for modal actions',
      run: async () => {
        const resp = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: { title: 'Modal test task', assignee_id: assigneeId, priority: 'high' }
        });
        assertOk(resp, 'create task');
        testTaskId = resp.data?.task?.id || resp.data?.id;
      }
    },
    {
      name: 'Task accept action (modal)',
      run: async () => {
        if (!testTaskId) return;
        // Verify task is in 'new' status before accepting
        const check = await api('GET', `/api/tasks/${testTaskId}`, { role: 'ADMIN' });
        const taskData = check.data?.task || check.data;
        if (taskData?.status && taskData.status !== 'new') skip(`task status is '${taskData.status}', not 'new'`);

        const resp = await api('PUT', `/api/tasks/${testTaskId}/accept`, {
          role: 'ADMIN', body: {}
        });
        if (resp.status === 404) skip('accept endpoint not found');
        assertOk(resp, 'accept task');
      }
    },
    {
      name: 'Task add comment action (modal)',
      run: async () => {
        if (!testTaskId) return;
        const resp = await api('POST', `/api/tasks/${testTaskId}/comments`, {
          role: 'ADMIN',
          body: { text: 'Modal test comment' }
        });
        if (resp.status === 404) skip('comments endpoint not found');
        assertOk(resp, 'add comment');
      }
    },
    {
      name: 'Task complete action (modal)',
      run: async () => {
        if (!testTaskId) return;
        const resp = await api('PUT', `/api/tasks/${testTaskId}/complete`, {
          role: 'ADMIN',
          body: { comment: 'Completed via modal test' }
        });
        if (resp.status === 404) skip('complete endpoint not found');
        assertOk(resp, 'complete task');
      }
    },
    {
      name: 'Cleanup: delete task',
      run: async () => {
        if (!testTaskId) return;
        await api('DELETE', `/api/tasks/${testTaskId}`, { role: 'ADMIN' });
        testTaskId = null;
      }
    },
    // ── Tender status modal actions ──
    {
      name: 'Create tender for status actions',
      run: async () => {
        const resp = await api('POST', '/api/tenders', {
          role: 'ADMIN',
          body: { number: 'MODAL-T-001', customer_name: 'Modal Test', title: 'Modal tender', type: 'commercial' }
        });
        assertOk(resp, 'create tender');
        testTenderId = resp.data?.tender?.id || resp.data?.id;
      }
    },
    {
      name: 'Tender status change: new → in_progress',
      run: async () => {
        if (!testTenderId) return;
        const resp = await api('PUT', `/api/tenders/${testTenderId}`, {
          role: 'ADMIN',
          body: { tender_status: 'in_progress' }
        });
        assertOk(resp, 'tender status in_progress');
      }
    },
    {
      name: 'Tender status change: in_progress → won',
      run: async () => {
        if (!testTenderId) return;
        const resp = await api('PUT', `/api/tenders/${testTenderId}`, {
          role: 'ADMIN',
          body: { tender_status: 'won' }
        });
        assertOk(resp, 'tender status won');
      }
    },
    {
      name: 'Verify tender status is won',
      run: async () => {
        if (!testTenderId) return;
        const resp = await api('GET', `/api/tenders/${testTenderId}`, { role: 'ADMIN' });
        assertOk(resp, 'get tender');
        const tender = resp.data?.tender || resp.data;
        assert(tender.tender_status === 'won' || tender.status === 'won', `expected won, got ${tender.tender_status || tender.status}`);
      }
    },
    {
      name: 'Cleanup: delete tender',
      run: async () => {
        if (!testTenderId) return;
        await api('DELETE', `/api/tenders/${testTenderId}`, { role: 'ADMIN' });
        testTenderId = null;
      }
    },
    // ── Estimate approval action (via /api/approval) ──
    {
      name: 'Create estimate → approve action',
      run: async () => {
        const resp = await api('POST', '/api/estimates', {
          role: 'ADMIN',
          body: { title: 'Modal estimate test', amount: 100000, approval_status: 'sent' }
        });
        assertOk(resp, 'create estimate');
        const estId = resp.data?.estimate?.id || resp.data?.id;
        if (!estId) return;

        // Approve via universal approval route
        const approve = await api('POST', `/api/approval/estimates/${estId}/approve`, {
          role: 'ADMIN',
          body: { comment: 'Approved via modal test' }
        });
        assertOk(approve, 'approve estimate');

        // Cleanup
        await api('DELETE', `/api/estimates/${estId}`, { role: 'ADMIN' });
      }
    },
    // ── Pre-tender accept/reject actions ──
    {
      name: 'Create pre-tender → reject action',
      run: async () => {
        const resp = await api('POST', '/api/pre-tenders', {
          role: 'ADMIN',
          body: { customer_name: 'Modal PT Test', work_description: 'Test pre-tender modal' }
        });
        assertOk(resp, 'create pre-tender');
        const ptId = resp.data?.request?.id || resp.data?.id;
        if (!ptId) return;

        const reject = await api('POST', `/api/pre-tenders/${ptId}/reject`, {
          role: 'ADMIN',
          body: { reason: 'E2E modal test rejection' }
        });
        if (reject.status !== 404) assertOk(reject, 'reject pre-tender');

        await api('DELETE', `/api/pre-tenders/${ptId}`, { role: 'ADMIN' });
      }
    },
    // ── Invoice payment action ──
    {
      name: 'Create invoice → add payment action',
      run: async () => {
        const resp = await api('POST', '/api/invoices', {
          role: 'ADMIN',
          body: { invoice_number: 'MODAL-INV-001', customer_name: 'Test', amount: 50000, invoice_date: '2026-02-01', due_date: '2026-03-01' }
        });
        assertOk(resp, 'create invoice');
        const invId = resp.data?.invoice?.id || resp.data?.id;
        if (!invId) return;

        const pay = await api('POST', `/api/invoices/${invId}/payments`, {
          role: 'ADMIN',
          body: { amount: 25000, date: '2026-02-15', comment: 'Partial payment' }
        });
        if (pay.status !== 404) assertOk(pay, 'add payment');

        await api('DELETE', `/api/invoices/${invId}`, { role: 'ADMIN' });
      }
    },
    // ── NEGATIVE: forbidden roles can't do modal actions ──
    {
      name: 'NEGATIVE: WAREHOUSE cannot create tender (modal)',
      run: async () => {
        const resp = await api('POST', '/api/tenders', {
          role: 'WAREHOUSE',
          body: { number: 'HACK', title: 'forbidden' }
        });
        assertForbidden(resp, 'WAREHOUSE create tender');
      }
    },
    {
      name: 'NEGATIVE: HR cannot create estimate (modal)',
      run: async () => {
        const resp = await api('POST', '/api/estimates', {
          role: 'HR',
          body: { title: 'forbidden', amount: 1 }
        });
        assertForbidden(resp, 'HR create estimate');
      }
    }
  ]
};
