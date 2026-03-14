/**
 * BLOCK 2: APPROVAL FLOWS — Estimates, Cash, Bonus, Travel, HR
 * Full approval lifecycle tests
 */
'use strict';

const { BASE_URL, api, getToken, assert, assertOk, assertStatus, assertForbidden,
        assertArray, assertHasFields, assertMatch, assertOneOf,
        skip, TEST_USERS } = require('../config');

let tenderId = null;
let estimateId = null;
let cashRequestId = null;
let workId = null;

module.exports = {
  name: 'BLOCK 2 — APPROVAL FLOWS',
  tests: [
    // ═══════════════════════════════════════════════
    // Setup: create tender and work for linking
    // ═══════════════════════════════════════════════
    {
      name: 'Setup: create tender for estimate tests',
      run: async () => {
        const resp = await api('POST', '/api/tenders', {
          role: 'PM',
          body: {
            customer: 'Approval Test Customer',
            tender_type: 'Прямой запрос',
            tender_status: 'Новый'
          }
        });
        assertOk(resp, 'create tender');
        tenderId = resp.data?.tender?.id || resp.data?.id;
        assert(tenderId, 'tender id');
      }
    },
    {
      name: 'Setup: create work for cash tests',
      run: async () => {
        const resp = await api('POST', '/api/works', {
          role: 'PM',
          body: {
            work_title: 'Approval Test Work',
            tender_id: tenderId,
            work_status: 'В работе'
          }
        });
        assertOk(resp, 'create work');
        workId = resp.data?.work?.id || resp.data?.id;
        assert(workId, 'work id');
      }
    },

    // ═══════════════════════════════════════════════
    // ???????????????????????????????????????????????
    // 2.1 Estimates
    // ???????????????????????????????????????????????
    {
      name: '2.1.1 PM creates estimate -> draft',
      run: async () => {
        const resp = await api('POST', '/api/estimates', {
          role: 'PM',
          body: {
            title: '???????? ???????',
            tender_id: tenderId,
            pm_id: TEST_USERS.PM.id,
            amount: 500000,
            cost: 350000,
            margin: 150000,
            approval_status: 'draft',
            description: 'Test estimate for approval flow'
          }
        });
        assertOk(resp, 'create estimate');
        const est = resp.data?.estimate || resp.data;
        estimateId = est.id;
        assert(estimateId, 'estimate id');
        assertMatch(est, { approval_status: 'draft' }, 'status draft');
      }
    },
    {
      name: '2.1.2 PM submits estimate -> director_review',
      run: async () => {
        if (!estimateId) skip('No estimate');
        const resp = await api('POST', `/api/estimates/${estimateId}/approval/submit`, {
          role: 'PM',
          body: { comment: '??????? ??????????? ??????', requires_payment: true }
        });
        assertOk(resp, 'submit estimate');
        const est = resp.data?.estimate || resp.data;
        const approval = resp.data?.approval || {};
        assertMatch(est, { approval_status: 'sent' }, 'legacy status sent');
        assertMatch(approval, { current_stage: 'director_review' }, 'workflow director review');
      }
    },
    {
      name: '2.1.3 DIRECTOR_GEN approves to accounting',
      run: async () => {
        if (!estimateId) skip('No estimate');
        const resp = await api('POST', `/api/estimates/${estimateId}/approval/approve-to-accounting`, {
          role: 'DIRECTOR_GEN',
          body: { comment: '???????? ? ???????????' }
        });
        assertOk(resp, 'approve to accounting');
        const est = resp.data?.estimate || resp.data;
        const approval = resp.data?.approval || {};
        assertMatch(est, { approval_status: 'accounting_review' }, 'legacy status accounting review');
        assertMatch(approval, { current_stage: 'accounting_review' }, 'workflow accounting review');
      }
    },
    {
      name: '2.1.4 BUH accepts and moves to payment step',
      run: async () => {
        if (!estimateId) skip('No estimate');
        const resp = await api('POST', `/api/estimates/${estimateId}/approval/accept`, {
          role: 'BUH',
          body: { comment: '??????? ????????????' }
        });
        assertOk(resp, 'accept accounting');
        const est = resp.data?.estimate || resp.data;
        const approval = resp.data?.approval || {};
        assertMatch(est, { approval_status: 'payment_pending' }, 'payment pending status');
        assertMatch(approval, { current_stage: 'payment_pending' }, 'workflow payment_pending');
      }
    },
    {
      name: '2.1.4a BUH marks paid with payment slip',
      run: async () => {
        if (!estimateId) skip('No estimate');
        const token = await getToken('BUH');
        const form = new FormData();
        form.append('comment', '???????? ?? ?????????? ?????????');
        form.append('payment_slip', new Blob(['payment slip'], { type: 'text/plain' }), 'payment-slip.txt');
        const resp = await fetch(`${BASE_URL}/api/estimates/${estimateId}/approval/mark-paid`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: form
        });
        const data = await resp.json();
        assert(resp.ok, `mark paid: expected 2xx, got ${resp.status} - ${JSON.stringify(data).slice(0, 200)}`);
        const est = data?.estimate || data;
        const approval = data?.approval || {};
        assertMatch(est, { approval_status: 'paid' }, 'legacy paid');
        assertMatch(approval, { current_stage: 'paid' }, 'workflow paid');
      }
    },
    {
      name: '2.1.4b DIRECTOR_GEN approves directly when payment review is not required',
      run: async () => {
        const create = await api('POST', '/api/estimates', {
          role: 'PM',
          body: {
            title: 'Direct final test',
            tender_id: tenderId,
            approval_status: 'draft',
            amount: 110000
          }
        });
        assertOk(create, 'create direct final estimate');
        const id = (create.data?.estimate || create.data).id;

        assertOk(await api('POST', `/api/estimates/${id}/approval/submit`, {
          role: 'PM',
          body: { comment: 'Submit without accounting flag' }
        }), 'submit direct final estimate');

        const resp = await api('POST', `/api/estimates/${id}/approval/approve-to-accounting`, {
          role: 'DIRECTOR_GEN',
          body: { comment: 'Approved without payment review' }
        });
        assertOk(resp, 'director approves directly');
        const est = resp.data?.estimate || resp.data;
        const approval = resp.data?.approval || {};
        assertMatch(est, { approval_status: 'approved' }, 'legacy approved without accounting');
        assertMatch(approval, { current_stage: 'approved_final', requires_payment: false }, 'workflow approved_final without accounting');
      }
    },
    {
      name: '2.1.5 DIRECTOR_GEN requests rework',
      run: async () => {
        const create = await api('POST', '/api/estimates', {
          role: 'PM',
          body: {
            title: 'Rework test',
            tender_id: tenderId,
            approval_status: 'draft',
            amount: 100000
          }
        });
        assertOk(create, 'create rework estimate');
        const id = (create.data?.estimate || create.data).id;

        assertOk(await api('POST', `/api/estimates/${id}/approval/submit`, {
          role: 'PM',
          body: { comment: '???????? ?? ????????????' }
        }), 'submit rework estimate');

        const resp = await api('POST', `/api/estimates/${id}/approval/request-rework`, {
          role: 'DIRECTOR_GEN',
          body: { comment: '????? ???????????' }
        });
        assertOk(resp, 'request rework');
        const est = resp.data?.estimate || resp.data;
        const approval = resp.data?.approval || {};
        assertMatch(est, { approval_status: 'rework' }, 'legacy rework');
        assertMatch(approval, { current_stage: 'pm_rework' }, 'workflow pm_rework');
        module.exports._reworkEstimateId = id;
      }
    },
    {
      name: '2.1.6 PM resubmits after rework',
      run: async () => {
        const id = module.exports._reworkEstimateId;
        if (!id) skip('No rework estimate');
        const resp = await api('POST', `/api/estimates/${id}/approval/resubmit`, {
          role: 'PM',
          body: { comment: '?????????? ? ?????????? ????????' }
        });
        assertOk(resp, 'resubmit estimate');
        const est = resp.data?.estimate || resp.data;
        const approval = resp.data?.approval || {};
        assertMatch(est, { approval_status: 'sent' }, 'legacy sent after resubmit');
        assertMatch(approval, { current_stage: 'director_review' }, 'workflow back to director review');
      }
    },
    {
      name: '2.1.7 DIRECTOR_GEN rejects at director stage',
      run: async () => {
        const create = await api('POST', '/api/estimates', {
          role: 'PM',
          body: {
            title: 'Director reject test',
            tender_id: tenderId,
            approval_status: 'draft',
            amount: 120000
          }
        });
        assertOk(create, 'create director reject estimate');
        const id = (create.data?.estimate || create.data).id;

        assertOk(await api('POST', `/api/estimates/${id}/approval/submit`, {
          role: 'PM',
          body: { comment: 'Submit for director reject', requires_payment: true }
        }), 'submit director reject estimate');

        const resp = await api('POST', `/api/estimates/${id}/approval/reject`, {
          role: 'DIRECTOR_GEN',
          body: { comment: '???????????? ?????????' }
        });
        assertOk(resp, 'director rejects');
        const est = resp.data?.estimate || resp.data;
        const approval = resp.data?.approval || {};
        assertMatch(est, { approval_status: 'rejected' }, 'legacy rejected');
        assertMatch(approval, { current_stage: 'rejected' }, 'workflow rejected');
      }
    },
    {
      name: '2.1.7b BUH cannot reject at accounting stage',
      run: async () => {
        const create = await api('POST', '/api/estimates', {
          role: 'PM',
          body: {
            title: 'Accounting reject forbidden test',
            tender_id: tenderId,
            approval_status: 'draft',
            amount: 121000
          }
        });
        assertOk(create, 'create accounting reject forbidden estimate');
        const id = (create.data?.estimate || create.data).id;

        assertOk(await api('POST', `/api/estimates/${id}/approval/submit`, {
          role: 'PM',
          body: { comment: 'Submit for forbidden reject path', requires_payment: true }
        }), 'submit accounting reject forbidden estimate');
        assertOk(await api('POST', `/api/estimates/${id}/approval/approve-to-accounting`, {
          role: 'DIRECTOR_GEN',
          body: { comment: '???????? ? ???????????' }
        }), 'director approves to accounting');

        const resp = await api('POST', `/api/estimates/${id}/approval/reject`, {
          role: 'BUH',
          body: { comment: '?? ?????? ???? ????????' }
        });
        assert(resp.status === 409 || resp.status === 403, `expected 403/409, got ${resp.status}`);
      }
    },
    {
      name: '2.1.8 Generic data API cannot edit submitted estimate directly',
      run: async () => {
        const create = await api('POST', '/api/estimates', {
          role: 'PM',
          body: {
            title: 'Bypass lock test',
            tender_id: tenderId,
            approval_status: 'draft',
            amount: 130000
          }
        });
        assertOk(create, 'create bypass estimate');
        const id = (create.data?.estimate || create.data).id;

        assertOk(await api('POST', `/api/estimates/${id}/approval/submit`, {
          role: 'PM',
          body: { comment: 'Submit for lock' }
        }), 'submit bypass estimate');

        const resp = await api('PUT', `/api/data/estimates/${id}`, {
          role: 'PM',
          body: { amount: 999999 }
        });
        assertStatus(resp, 409, 'submitted estimate is locked against generic direct edit');
      }
    },
    {
      name: '2.1.9 GET /api/estimates/:id/approval returns workflow trail',
      run: async () => {
        if (!estimateId) skip('No estimate');
        const resp = await api('GET', `/api/estimates/${estimateId}/approval`, { role: 'PM' });
        assertOk(resp, 'get approval trail');
        assert(resp.data?.approval, 'approval payload');
        assertArray(resp.data?.events || [], 'approval events');
      }
    },
    {
      name: '2.1.10 GET /api/estimates filter by status',
      run: async () => {
        const resp = await api('GET', `/api/estimates?status=approved&limit=10`, { role: 'PM' });
        assertOk(resp, 'filter estimates');
        const list = resp.data?.estimates || resp.data;
        assertArray(list, 'estimates list');
      }
    },
    {
      name: '2.1.11 GET /api/estimates filter by tender_id',
      run: async () => {
        if (!tenderId) skip('No tender');
        const resp = await api('GET', `/api/estimates?tender_id=${tenderId}`, { role: 'PM' });
        assertOk(resp, 'filter by tender');
        const list = resp.data?.estimates || resp.data;
        assertArray(list, 'estimates list');
        assert(list.length >= 1, `expected ?1 estimates for tender, got ${list.length}`);
      }
    },
    {
      name: '2.1.12 DELETE estimate ? ADMIN only',
      run: async () => {
        if (!estimateId) skip('No estimate');
        const pmDel = await api('DELETE', `/api/estimates/${estimateId}`, { role: 'PM' });
        assertForbidden(pmDel, 'PM cannot delete');

        const adminDel = await api('DELETE', `/api/estimates/${estimateId}`, { role: 'ADMIN' });
        assertOk(adminDel, 'ADMIN deletes');
      }
    },

    // 2.2 Cash Requests — Full Approval Cycle
    // ═══════════════════════════════════════════════
    {
      name: '2.2.1 PM creates cash request → status requested',
      run: async () => {
        if (!workId) skip('No work');
        const resp = await api('POST', '/api/cash', {
          role: 'PM',
          body: {
            work_id: workId,
            amount: 50000,
            purpose: 'Аванс на материалы для тестовой работы',
            type: 'advance'
          }
        });
        assertOk(resp, 'create cash request');
        const data = resp.data;
        cashRequestId = data.id;
        assert(cashRequestId, 'cash request id');
        assertMatch(data, { status: 'requested' }, 'initial status');
      }
    },
    {
      name: '2.2.2 DIRECTOR approves → status approved',
      run: async () => {
        if (!cashRequestId) skip('No cash request');
        const resp = await api('PUT', `/api/cash/${cashRequestId}/approve`, {
          role: 'DIRECTOR_GEN',
          body: { comment: 'Одобрено' }
        });
        assertOk(resp, 'approve cash');
        assert(resp.data.success === true, 'approve success');
      }
    },
    {
      name: '2.2.3 PM confirms receipt → status received',
      run: async () => {
        if (!cashRequestId) skip('No cash request');
        const resp = await api('PUT', `/api/cash/${cashRequestId}/receive`, {
          role: 'PM',
          body: {}
        });
        assertOk(resp, 'receive cash');
        assert(resp.data.success === true, 'receive success');
      }
    },
    {
      name: '2.2.4 DIRECTOR closes request → status closed',
      run: async () => {
        if (!cashRequestId) skip('No cash request');
        const resp = await api('PUT', `/api/cash/${cashRequestId}/close`, {
          role: 'DIRECTOR_GEN',
          body: { comment: 'Закрыто', force: true }
        });
        assertOk(resp, 'close cash');
        assert(resp.data.success === true, 'close success');
      }
    },
    {
      name: '2.2.5 Create + reject cycle with required comment',
      run: async () => {
        if (!workId) skip('No work');
        const create = await api('POST', '/api/cash', {
          role: 'PM',
          body: { work_id: workId, amount: 10000, purpose: 'Reject test', type: 'advance' }
        });
        assertOk(create, 'create for reject');
        const id = create.data.id;

        // Reject without comment → 400
        const noComment = await api('PUT', `/api/cash/${id}/reject`, {
          role: 'DIRECTOR_GEN',
          body: {}
        });
        assertStatus(noComment, 400, 'reject needs comment');

        // Reject with comment → 200
        const withComment = await api('PUT', `/api/cash/${id}/reject`, {
          role: 'DIRECTOR_GEN',
          body: { comment: 'Недостаточно обоснования' }
        });
        assertOk(withComment, 'reject with comment');
      }
    },
    {
      name: '2.2.6 Question-reply cycle',
      run: async () => {
        if (!workId) skip('No work');
        const create = await api('POST', '/api/cash', {
          role: 'PM',
          body: { work_id: workId, amount: 25000, purpose: 'Question test', type: 'advance' }
        });
        assertOk(create, 'create for question');
        const id = create.data.id;

        // Director asks question
        const q = await api('PUT', `/api/cash/${id}/question`, {
          role: 'DIRECTOR_GEN',
          body: { message: 'Уточните назначение расходов' }
        });
        assertOk(q, 'ask question');

        // PM replies → status back to requested
        const r = await api('POST', `/api/cash/${id}/reply`, {
          role: 'PM',
          body: { message: 'Расходы на сварочные работы' }
        });
        assertOk(r, 'reply to question');
      }
    },
    {
      name: '2.2.7 PM cannot approve own request → 403',
      run: async () => {
        if (!workId) skip('No work');
        const create = await api('POST', '/api/cash', {
          role: 'PM',
          body: { work_id: workId, amount: 5000, purpose: 'Self-approve test', type: 'advance' }
        });
        assertOk(create, 'create');
        const resp = await api('PUT', `/api/cash/${create.data.id}/approve`, {
          role: 'PM',
          body: {}
        });
        // PM may get 403 (forbidden) or 400 (no permission) depending on middleware
        assert(resp.status === 403 || resp.status === 401 || resp.status === 400,
          `expected 4xx denial for PM self-approve, got ${resp.status}`);
      }
    },
    {
      name: '2.2.8 Negative amount → 400',
      run: async () => {
        const resp = await api('POST', '/api/cash', {
          role: 'PM',
          body: { work_id: workId || 1, amount: -5000, purpose: 'Negative test', type: 'advance' }
        });
        assertStatus(resp, 400, 'negative amount');
      }
    },
    {
      name: '2.2.9 Zero amount → 400',
      run: async () => {
        const resp = await api('POST', '/api/cash', {
          role: 'PM',
          body: { work_id: workId || 1, amount: 0, purpose: 'Zero test', type: 'advance' }
        });
        assertStatus(resp, 400, 'zero amount');
      }
    },
    {
      name: '2.2.10 Empty purpose → 400',
      run: async () => {
        const resp = await api('POST', '/api/cash', {
          role: 'PM',
          body: { work_id: workId || 1, amount: 1000, purpose: '', type: 'advance' }
        });
        assertStatus(resp, 400, 'empty purpose');
      }
    },
    {
      name: '2.2.11 GET /api/cash/my → PM sees own requests',
      run: async () => {
        const resp = await api('GET', '/api/cash/my', { role: 'PM' });
        assertOk(resp, 'my cash');
        assertArray(resp.data, 'cash list');
      }
    },
    {
      name: '2.2.12 GET /api/cash/all → DIRECTOR sees all',
      run: async () => {
        const resp = await api('GET', '/api/cash/all', { role: 'DIRECTOR_GEN' });
        assertOk(resp, 'all cash');
        assertArray(resp.data, 'all cash list');
      }
    },
    {
      name: '2.2.13 GET /api/cash/summary → totals by user',
      run: async () => {
        const resp = await api('GET', '/api/cash/summary', { role: 'DIRECTOR_GEN' });
        assertOk(resp, 'cash summary');
        assertArray(resp.data, 'summary list');
      }
    },
    {
      name: '2.2.14 GET /api/cash/my-balance → balance widget',
      run: async () => {
        const resp = await api('GET', '/api/cash/my-balance', { role: 'PM' });
        assertOk(resp, 'my balance');
        assertHasFields(resp.data, ['issued', 'spent', 'returned', 'balance'], 'balance fields');
      }
    },
    {
      name: '2.2.15 Cannot approve already-approved request → 400',
      run: async () => {
        if (!workId) skip('No work');
        const create = await api('POST', '/api/cash', {
          role: 'PM',
          body: { work_id: workId, amount: 3000, purpose: 'Double approve test', type: 'advance' }
        });
        assertOk(create, 'create');
        const id = create.data.id;

        // Approve once
        await api('PUT', `/api/cash/${id}/approve`, { role: 'DIRECTOR_GEN', body: {} });

        // Approve again → 400 (status is now approved, not requested)
        const resp = await api('PUT', `/api/cash/${id}/approve`, { role: 'DIRECTOR_GEN', body: {} });
        assertStatus(resp, 400, 'double approve');
      }
    },
    {
      name: '2.2.16 GET /api/cash/:id — detail with expenses, returns, messages',
      run: async () => {
        if (!cashRequestId) skip('No cash request');
        const resp = await api('GET', `/api/cash/${cashRequestId}`, { role: 'DIRECTOR_GEN' });
        assertOk(resp, 'cash detail');
        assertHasFields(resp.data, ['expenses', 'returns', 'messages', 'balance'], 'detail fields');
      }
    },
    {
      name: '2.2.17 GET /api/cash/999999 — not found → 404',
      run: async () => {
        const resp = await api('GET', '/api/cash/999999', { role: 'DIRECTOR_GEN' });
        assertStatus(resp, 404, 'not found');
      }
    },
    {
      name: '2.2.18 Receive when not approved → 400',
      run: async () => {
        if (!workId) skip('No work');
        const create = await api('POST', '/api/cash', {
          role: 'PM',
          body: { work_id: workId, amount: 7000, purpose: 'Status guard test', type: 'advance' }
        });
        assertOk(create, 'create');
        // Try to receive while still in 'requested' status
        const resp = await api('PUT', `/api/cash/${create.data.id}/receive`, { role: 'PM', body: {} });
        assertStatus(resp, 400, 'receive when not approved');
      }
    }
  ]
};
