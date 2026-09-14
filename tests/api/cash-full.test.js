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
const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, skip, rawFetch } = require('../config');
const crypto = require('crypto');

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
            type: testWorkId ? 'advance' : 'office'
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

    // ── 8b. Issue money (касса) ──
    {
      name: 'ADMIN issues cash (PUT /:id/issue)',
      run: async () => {
        if (!testCashId) skip('no testCashId');
        const resp = await api('PUT', `/api/cash/${testCashId}/issue`, {
          role: 'ADMIN',
          body: {}
        });
        assertOk(resp, 'issue cash');
      }
    },

    {
      name: 'Verify status is "money_issued" after issue',
      run: async () => {
        if (!testCashId) skip('no testCashId');
        const resp = await api('GET', `/api/cash/${testCashId}`, { role: 'ADMIN' });
        assertOk(resp, 'read-back after issue');
        assert(resp.data.status === 'money_issued', `expected "money_issued", got "${resp.data.status}"`);
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

    // ── 15. HR can create own cash request (V336) ──
    {
      name: 'HR can create own cash request (POST office)',
      run: async () => {
        const resp = await api('POST', '/api/cash', {
          role: 'HR',
          body: { amount: 1000, purpose: 'hr own cash request autotest', type: 'office' }
        });
        assertOk(resp, 'HR create cash');
      }
    },

    // ── 16. WAREHOUSE can create own cash request (V336) ──
    {
      name: 'WAREHOUSE can create own cash request (POST office)',
      run: async () => {
        const resp = await api('POST', '/api/cash', {
          role: 'WAREHOUSE',
          body: { amount: 1000, purpose: 'warehouse own cash request autotest', type: 'office' }
        });
        assertOk(resp, 'WAREHOUSE create cash');
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
          body: { amount: 500, purpose: 'neg-test approve', type: 'office' }
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
          body: { amount: 500, purpose: 'neg-test close', type: 'office' }
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
          body: { amount: 3000, purpose: 'question-reply lifecycle test', type: 'office' }
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
          body: { amount: 1000, purpose: 'reject lifecycle test', type: 'office' }
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
    },

    {
      name: 'Office roles can create cash request (POST office)',
      run: async () => {
        const roles = ['OFFICE_MANAGER', 'WAREHOUSE', 'TO', 'HR', 'HR_MANAGER', 'PROC', 'CHIEF_ENGINEER', 'HEAD_PM', 'HEAD_TO', 'BUH', 'PM', 'DIRECTOR_COMM', 'DIRECTOR_GEN', 'DIRECTOR_DEV'];
        for (const role of roles) {
          const resp = await api('POST', '/api/cash', {
            role,
            body: {
              amount: 700,
              purpose: `autotest cash access ${role} office`,
              type: 'office',
              category: 'other',
              category_other_desc: 'autotest'
            }
          });
          assert(
            resp.status >= 200 && resp.status < 300,
            `${role} POST /api/cash got ${resp.status}: ${JSON.stringify(resp.data)}`
          );
          assert(resp.data && resp.data.id, `${role} should return id`);
          assert(resp.data.status === 'requested', `${role} status requested, got ${resp.data.status}`);
        }
      }
    },

    {
      name: 'BUH creates cash request on behalf of OFFICE_MANAGER',
      run: async () => {
        const me = await api('GET', '/api/auth/me', { role: 'OFFICE_MANAGER' });
        assertOk(me, 'office me');
        const uid = me.data?.id || me.data?.user?.id;
        assert(uid, 'office manager id');

        const create = await api('POST', '/api/cash', {
          role: 'BUH',
          body: {
            for_user_id: uid,
            amount: 3200,
            purpose: 'Срочная выдача офис-менеджеру на хознужды',
            type: 'office',
            category: 'other',
            category_other_desc: 'срочно'
          }
        });
        assertOk(create, 'buh on-behalf create');
        assert(Number(create.data.user_id) === Number(uid), `owner should be office manager, got ${create.data.user_id}`);
        assert(Number(create.data.initiated_by) !== Number(uid), 'initiator should be buh, not owner');

        const mine = await api('GET', '/api/cash/my', { role: 'OFFICE_MANAGER' });
        assertOk(mine, 'office my list');
        const list = Array.isArray(mine.data) ? mine.data : [];
        assert(list.some((r) => r.id === create.data.id), 'request must appear in owner history');

        const approve = await api('PUT', `/api/cash/${create.data.id}/approve`, {
          role: 'ADMIN',
          body: { comment: 'on-behalf autotest' }
        });
        assertOk(approve, 'approve on-behalf');

        const issue = await api('PUT', `/api/cash/${create.data.id}/issue`, {
          role: 'BUH',
          body: {}
        });
        assertOk(issue, 'issue on-behalf to office manager');

        const receive = await api('PUT', `/api/cash/${create.data.id}/receive`, {
          role: 'OFFICE_MANAGER',
          body: {}
        });
        assertOk(receive, 'office manager receive');

        const after = await api('GET', `/api/cash/${create.data.id}`, { role: 'OFFICE_MANAGER' });
        assertOk(after, 'owner read after receive');
        assert(after.data.status === 'received', `expected received, got ${after.data.status}`);
        assert(Number(after.data.user_id) === Number(uid), 'money stays on office manager');

        const pmForbid = await api('POST', '/api/cash', {
          role: 'PM',
          body: {
            for_user_id: uid,
            amount: 100,
            purpose: 'pm cannot create for others xx',
            type: 'office'
          }
        });
        assert(pmForbid.status === 403, `PM on-behalf should 403, got ${pmForbid.status}`);
      }
    },

    {
      name: 'GET /cash-mail does not mutate; POST approve changes status',
      run: async () => {
        const create = await api('POST', '/api/cash', {
          role: 'OFFICE_MANAGER',
          body: {
            amount: 1100,
            purpose: 'autotest cash-mail landing page',
            type: 'office',
            category: 'other',
            category_other_desc: 'mail'
          }
        });
        assertOk(create, 'create for mail token');
        const id = create.data.id;

        const bad = await rawFetch('GET', '/cash-mail/not-a-valid-token');
        assert(bad.status >= 400, `invalid token should fail, got ${bad.status}`);

        const before = await api('GET', `/api/cash/${id}`, { role: 'ADMIN' });
        assertOk(before, 'read before GET token');
        assert(before.data.status === 'requested', 'still requested before GET');

        let db;
        try {
          require('dotenv').config();
          db = require('../../src/services/db');
        } catch (e) {
          skip('no db module for token insert: ' + e.message);
        }
        const raw = crypto.randomBytes(32).toString('hex');
        const hash = crypto.createHash('sha256').update(raw).digest('hex');
        try {
          await db.query(
            `INSERT INTO cash_email_tokens (request_id, token_hash, expires_at)
             VALUES ($1, $2, NOW() + interval '48 hours')`,
            [id, hash]
          );
        } catch (e) {
          skip('cash_email_tokens missing — apply V336: ' + e.message);
        }

        const page = await rawFetch('GET', '/cash-mail/' + raw);
        assert(page.status === 200, `landing GET ${page.status}`);
        const html = typeof page.data === 'string' ? page.data : page.text;
        assert(/Согласовать/.test(html), 'landing should contain Согласовать');

        const still = await api('GET', `/api/cash/${id}`, { role: 'ADMIN' });
        assert(still.data.status === 'requested', `GET must not approve, got ${still.data.status}`);

        const post = await rawFetch('POST', '/cash-mail/' + raw, {
          body: { action: 'approve' },
          headers: { Accept: 'application/json' }
        });
        assert(post.status >= 200 && post.status < 300, `POST approve ${post.status} ${JSON.stringify(post.data)}`);

        const after = await api('GET', `/api/cash/${id}`, { role: 'ADMIN' });
        assertOk(after, 'read after mail approve');
        assert(after.data.status === 'approved', `expected approved, got ${after.data.status}`);
      }
    }
  ]
};
