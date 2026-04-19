/**
 * E2E FLOW: Estimate Lifecycle — Full Approval Flow
 * ═══════════════════════════════════════════════════
 *
 * Tests the complete lifecycle:
 *   PM creates estimate (draft) -> PM updates -> PM creates v2 (sent)
 *   -> DIRECTOR rejects -> PM creates v3 (sent) -> DIRECTOR rework
 *   -> PM resubmits -> DIRECTOR approves
 *
 * Plus negative tests: PM cannot approve, approve already approved = 409,
 * rework without comment = 400, WAREHOUSE cannot GET.
 */
const { api, assert, assertOk, assertStatus, assertForbidden, assertMatch, assertHasFields } = require('../config');

let tenderId = null;
let estimateV1Id = null;
let estimateV2Id = null;
let estimateV3Id = null;

module.exports = {
  name: 'FLOW: Estimate Lifecycle (full approval)',
  tests: [
    // ── SETUP: Create a tender for estimates ──
    {
      name: 'Setup: TO creates tender for estimate lifecycle',
      run: async () => {
        const resp = await api('POST', '/api/tenders', {
          role: 'TO',
          body: {
            customer: 'E2E Estimate Lifecycle: Test Customer',
            estimated_sum: 12000000,
            tender_status: 'Новый',
            tender_type: 'Прямой запрос'
          }
        });
        assertOk(resp, 'create tender');
        tenderId = resp.data?.tender?.id || resp.data?.id;
        assert(tenderId, 'tender id must be set');
      }
    },

    // ── STEP 1: PM creates estimate (draft, version 1) ──
    {
      name: 'Step 1: PM creates estimate -> version_no=1, status=draft',
      run: async () => {
        assert(tenderId, 'tender required');
        const resp = await api('POST', '/api/estimates', {
          role: 'PM',
          body: {
            tender_id: tenderId,
            title: 'E2E: HVAC estimate v1',
            price_tkp: 1220000,
            cost_plan: 800000,
            approval_status: 'draft'
          }
        });
        assertOk(resp, 'create estimate v1');
        const est = resp.data?.estimate || resp.data;
        estimateV1Id = est?.id;
        assert(estimateV1Id, 'estimate id must be set');
        assertMatch(est, { version_no: 1 }, 'version_no should be 1');
        assertMatch(est, { approval_status: 'draft' }, 'status should be draft');
      }
    },

    // ── STEP 2: PM updates estimate (ordinary fields) ──
    {
      name: 'Step 2: PM updates estimate -> cost/price updated, status unchanged',
      run: async () => {
        assert(estimateV1Id, 'estimate v1 required');
        const resp = await api('PUT', `/api/estimates/${estimateV1Id}`, {
          role: 'PM',
          body: {
            cost_plan: 850000,
            price_tkp: 1300000
          }
        });
        assertOk(resp, 'update estimate');

        // Read back
        const check = await api('GET', `/api/estimates/${estimateV1Id}`, { role: 'PM' });
        assertOk(check, 'get updated estimate');
        const e = check.data?.estimate || check.data;
        assert(Number(e.cost_plan) === 850000, `cost_plan should be 850000, got ${e.cost_plan}`);
        assert(Number(e.price_tkp) === 1300000, `price_tkp should be 1300000, got ${e.price_tkp}`);
        assertMatch(e, { approval_status: 'draft' }, 'status should still be draft');
      }
    },

    // ── STEP 3: PM creates second estimate with status='sent' ──
    {
      name: 'Step 3: PM creates v2 with sent -> version_no=2, sent_for_approval_at set',
      run: async () => {
        assert(tenderId, 'tender required');
        const resp = await api('POST', '/api/estimates', {
          role: 'PM',
          body: {
            tender_id: tenderId,
            title: 'E2E: HVAC estimate v2',
            price_tkp: 1500000,
            cost_plan: 900000,
            approval_status: 'sent',
            cover_letter: 'Please review this estimate'
          }
        });
        assertOk(resp, 'create estimate v2 sent');
        const est = resp.data?.estimate || resp.data;
        estimateV2Id = est?.id;
        assert(estimateV2Id, 'estimate v2 id must be set');
        assertMatch(est, { version_no: 2 }, 'version_no should be 2');
        assertMatch(est, { approval_status: 'sent' }, 'status should be sent');
        assert(est.sent_for_approval_at, 'sent_for_approval_at should be set');
      }
    },

    // ── STEP 4: DIRECTOR_GEN rejects v2 ──
    {
      name: 'Step 4: DIRECTOR_GEN rejects -> status=rejected, audit_log',
      run: async () => {
        assert(estimateV2Id, 'estimate v2 required');
        const resp = await api('POST', `/api/approval/estimates/${estimateV2Id}/reject`, {
          role: 'DIRECTOR_GEN',
          body: { comment: 'Price too high, recalculate' }
        });
        assertOk(resp, 'director reject');

        // Check status
        const check = await api('GET', `/api/estimates/${estimateV2Id}`, { role: 'DIRECTOR_GEN' });
        assertOk(check, 'get rejected estimate');
        const e = check.data?.estimate || check.data;
        assertMatch(e, { approval_status: 'rejected' }, 'status should be rejected');
      }
    },

    // ── STEP 5: PM creates v3 and sends ──
    {
      name: 'Step 5: PM creates v3 sent -> version_no=3',
      run: async () => {
        assert(tenderId, 'tender required');
        const resp = await api('POST', '/api/estimates', {
          role: 'PM',
          body: {
            tender_id: tenderId,
            title: 'E2E: HVAC estimate v3',
            price_tkp: 1400000,
            cost_plan: 850000,
            approval_status: 'sent',
            cover_letter: 'Revised estimate after rejection'
          }
        });
        assertOk(resp, 'create estimate v3');
        const est = resp.data?.estimate || resp.data;
        estimateV3Id = est?.id;
        assert(estimateV3Id, 'estimate v3 id must be set');
        assertMatch(est, { version_no: 3 }, 'version_no should be 3');
        assertMatch(est, { approval_status: 'sent' }, 'status should be sent');
      }
    },

    // ── STEP 6: DIRECTOR sends v3 to rework ──
    {
      name: 'Step 6: DIRECTOR rework with comment -> status=rework',
      run: async () => {
        assert(estimateV3Id, 'estimate v3 required');
        const resp = await api('POST', `/api/approval/estimates/${estimateV3Id}/rework`, {
          role: 'DIRECTOR_GEN',
          body: { comment: 'Please reduce labor costs' }
        });
        assertOk(resp, 'director rework');

        const check = await api('GET', `/api/estimates/${estimateV3Id}`, { role: 'DIRECTOR_GEN' });
        assertOk(check, 'get rework estimate');
        const e = check.data?.estimate || check.data;
        assertMatch(e, { approval_status: 'rework' }, 'status should be rework');
      }
    },

    // ── STEP 7: PM resubmits v3 ──
    {
      name: 'Step 7: PM resubmit -> status=sent',
      run: async () => {
        assert(estimateV3Id, 'estimate v3 required');
        const resp = await api('POST', `/api/approval/estimates/${estimateV3Id}/resubmit`, {
          role: 'PM',
          body: {}
        });
        assertOk(resp, 'PM resubmit');

        const check = await api('GET', `/api/estimates/${estimateV3Id}`, { role: 'PM' });
        assertOk(check, 'get resubmitted estimate');
        const e = check.data?.estimate || check.data;
        assertMatch(e, { approval_status: 'sent' }, 'status should be sent after resubmit');
      }
    },

    // ── STEP 8: DIRECTOR approves v3 ──
    {
      name: 'Step 8: DIRECTOR approves -> status=approved, is_approved=true',
      run: async () => {
        assert(estimateV3Id, 'estimate v3 required');
        const resp = await api('POST', `/api/approval/estimates/${estimateV3Id}/approve`, {
          role: 'DIRECTOR_GEN',
          body: { comment: 'Approved, proceed' }
        });
        assertOk(resp, 'director approve');

        const check = await api('GET', `/api/estimates/${estimateV3Id}`, { role: 'DIRECTOR_GEN' });
        assertOk(check, 'get approved estimate');
        const e = check.data?.estimate || check.data;
        assertMatch(e, { approval_status: 'approved' }, 'status should be approved');
        assert(e.is_approved === true || e.is_approved === 't' || e.is_approved === 1,
          `is_approved should be truthy, got ${e.is_approved}`);
      }
    },

    // ════════════════════════════════════════════════════════════
    // NEGATIVE TESTS
    // ════════════════════════════════════════════════════════════

    {
      name: 'Negative: PM cannot approve -> 403',
      run: async () => {
        // Create a fresh estimate in sent status
        const create = await api('POST', '/api/estimates', {
          role: 'PM',
          body: {
            tender_id: tenderId,
            title: 'E2E: negative test',
            price_tkp: 500000,
            cost_plan: 300000,
            approval_status: 'sent',
            cover_letter: 'test'
          }
        });
        assertOk(create, 'create for negative');
        const negId = create.data?.estimate?.id || create.data?.id;
        assert(negId, 'negative test estimate id');

        const resp = await api('POST', `/api/approval/estimates/${negId}/approve`, {
          role: 'PM',
          body: {}
        });
        assertForbidden(resp, 'PM approve should be 403');

        // Cleanup
        await api('DELETE', `/api/estimates/${negId}`, { role: 'ADMIN' });
      }
    },

    {
      name: 'Negative: approve already approved -> 409',
      run: async () => {
        assert(estimateV3Id, 'v3 was approved in step 8');
        const resp = await api('POST', `/api/approval/estimates/${estimateV3Id}/approve`, {
          role: 'DIRECTOR_GEN',
          body: {}
        });
        assertStatus(resp, 409, 'approve already approved should be 409');
      }
    },

    {
      name: 'Negative: rework without comment -> 400',
      run: async () => {
        // Create a sent estimate
        const create = await api('POST', '/api/estimates', {
          role: 'PM',
          body: {
            tender_id: tenderId,
            title: 'E2E: rework no comment test',
            price_tkp: 600000,
            cost_plan: 400000,
            approval_status: 'sent',
            cover_letter: 'test'
          }
        });
        assertOk(create, 'create for rework negative');
        const negId = create.data?.estimate?.id || create.data?.id;
        assert(negId, 'negative rework estimate id');

        const resp = await api('POST', `/api/approval/estimates/${negId}/rework`, {
          role: 'DIRECTOR_GEN',
          body: {}
        });
        assertStatus(resp, 400, 'rework without comment should be 400');

        // Cleanup
        await api('DELETE', `/api/estimates/${negId}`, { role: 'ADMIN' });
      }
    },

    {
      name: 'Negative: WAREHOUSE GET estimates -> empty or 403',
      run: async () => {
        const resp = await api('GET', '/api/estimates', { role: 'WAREHOUSE' });
        // Could be 200 with empty array, or 403
        if (resp.status === 200) {
          const list = resp.data?.estimates || resp.data;
          if (Array.isArray(list)) {
            assert(list.length === 0, `WAREHOUSE should see 0 estimates, got ${list.length}`);
          }
        } else {
          assertForbidden(resp, 'WAREHOUSE GET estimates');
        }
      }
    },

    {
      name: 'Negative: WAREHOUSE GET single estimate -> 403',
      run: async () => {
        assert(estimateV3Id, 'v3 required');
        const resp = await api('GET', `/api/estimates/${estimateV3Id}`, { role: 'WAREHOUSE' });
        assertForbidden(resp, 'WAREHOUSE GET single estimate');
      }
    },

    // ── CLEANUP ──
    {
      name: 'Cleanup: delete test estimates and tender',
      run: async () => {
        if (estimateV3Id) await api('DELETE', `/api/estimates/${estimateV3Id}`, { role: 'ADMIN' });
        if (estimateV2Id) await api('DELETE', `/api/estimates/${estimateV2Id}`, { role: 'ADMIN' });
        if (estimateV1Id) await api('DELETE', `/api/estimates/${estimateV1Id}`, { role: 'ADMIN' });
        if (tenderId) await api('DELETE', `/api/tenders/${tenderId}`, { role: 'ADMIN' });
      }
    }
  ]
};
