/**
 * ESTIMATE STATUS TRANSITIONS — Matrix Coverage
 * ═══════════════════════════════════════════════════
 *
 * Tests all valid and invalid transitions of estimate approval_status:
 *   draft    -> sent (ok) | approved/rejected (fail)
 *   sent     -> approved/rework/question/rejected (ok)
 *   rework   -> sent (ok) | approved (fail)
 *   question -> sent (ok) | approved (fail)
 *   rejected -> all (fail)
 *   approved -> all (fail)
 *
 * Each test creates a fresh estimate, manually sets it to the required
 * starting status via the server, then attempts the transition.
 */
const { api, assert, assertOk, assertStatus, assertForbidden } = require('../config');

let tenderId = null;

/**
 * Helper: create estimate in draft status, then transition it to `targetStatus`
 * through valid intermediate steps, so we can test transitions FROM that status.
 */
async function createEstimateInStatus(status) {
  // Create draft
  const create = await api('POST', '/api/estimates', {
    role: 'PM',
    body: {
      tender_id: tenderId,
      title: `Transition test: start=${status}`,
      price_tkp: 1000000,
      cost_plan: 600000,
      approval_status: status === 'draft' ? 'draft' : 'sent',
      cover_letter: 'Transition test'
    }
  });
  assertOk(create, `create estimate for status=${status}`);
  const est = create.data?.estimate || create.data;
  const id = est?.id;
  assert(id, `estimate id for status=${status}`);

  if (status === 'draft') return id;
  if (status === 'sent') return id;

  // If we need rework/question/rejected/approved, transition from sent
  if (status === 'rework') {
    const r = await api('POST', `/api/approval/estimates/${id}/rework`, {
      role: 'DIRECTOR_GEN',
      body: { comment: 'needs rework' }
    });
    assertOk(r, 'transition to rework');
    return id;
  }
  if (status === 'question') {
    const r = await api('POST', `/api/approval/estimates/${id}/question`, {
      role: 'DIRECTOR_GEN',
      body: { comment: 'question about scope' }
    });
    assertOk(r, 'transition to question');
    return id;
  }
  if (status === 'rejected') {
    const r = await api('POST', `/api/approval/estimates/${id}/reject`, {
      role: 'DIRECTOR_GEN',
      body: { comment: 'rejected for testing' }
    });
    assertOk(r, 'transition to rejected');
    return id;
  }
  if (status === 'approved') {
    const r = await api('POST', `/api/approval/estimates/${id}/approve`, {
      role: 'DIRECTOR_GEN',
      body: { comment: 'approved for testing' }
    });
    assertOk(r, 'transition to approved');
    return id;
  }

  return id;
}

/**
 * Attempt a transition action and return the response.
 */
async function attemptTransition(estId, action, comment) {
  return api('POST', `/api/approval/estimates/${estId}/${action}`, {
    role: action === 'resubmit' ? 'PM' : 'DIRECTOR_GEN',
    body: comment ? { comment } : {}
  });
}

module.exports = {
  name: 'ESTIMATE STATUS TRANSITIONS (matrix)',
  tests: [
    // ── SETUP ──
    {
      name: 'Setup: create tender for transition tests',
      run: async () => {
        const resp = await api('POST', '/api/tenders', {
          role: 'TO',
          body: {
            customer: 'Transition Matrix Test Customer',
            estimated_sum: 5000000,
            tender_status: 'Новый',
            tender_type: 'Прямой запрос'
          }
        });
        assertOk(resp, 'create tender');
        tenderId = resp.data?.tender?.id || resp.data?.id;
        assert(tenderId, 'tender id');
      }
    },

    // ════════════════════════════════════════════════════════════
    // FROM: draft
    // ════════════════════════════════════════════════════════════

    {
      name: 'draft -> sent: VALID (PM resubmits/creates sent version)',
      run: async () => {
        // draft -> sent happens when PM creates a new estimate with sent status
        // or via resubmit. For draft, the natural path is to create a new
        // estimate version with sent. We test via the transition mechanism.
        // Since draft is the initial create status, the transition to 'sent'
        // is done by creating a new estimate with approval_status='sent'.
        const resp = await api('POST', '/api/estimates', {
          role: 'PM',
          body: {
            tender_id: tenderId,
            title: 'draft->sent test',
            price_tkp: 700000,
            cost_plan: 400000,
            approval_status: 'sent',
            cover_letter: 'test'
          }
        });
        assertOk(resp, 'draft->sent');
        const est = resp.data?.estimate || resp.data;
        assert(est.approval_status === 'sent', `expected sent, got ${est.approval_status}`);
        // Cleanup
        await api('DELETE', `/api/estimates/${est.id}`, { role: 'ADMIN' });
      }
    },

    {
      name: 'draft -> approved: INVALID (director cannot approve draft)',
      run: async () => {
        const id = await createEstimateInStatus('draft');
        const resp = await attemptTransition(id, 'approve');
        assertStatus(resp, 409, 'draft -> approved should be 409');
        await api('DELETE', `/api/estimates/${id}`, { role: 'ADMIN' });
      }
    },

    {
      name: 'draft -> rejected: INVALID',
      run: async () => {
        const id = await createEstimateInStatus('draft');
        const resp = await attemptTransition(id, 'reject', 'test reject');
        assertStatus(resp, 409, 'draft -> rejected should be 409');
        await api('DELETE', `/api/estimates/${id}`, { role: 'ADMIN' });
      }
    },

    // ════════════════════════════════════════════════════════════
    // FROM: sent
    // ════════════════════════════════════════════════════════════

    {
      name: 'sent -> approved: VALID',
      run: async () => {
        const id = await createEstimateInStatus('sent');
        const resp = await attemptTransition(id, 'approve', 'approved');
        assertOk(resp, 'sent -> approved');
        await api('DELETE', `/api/estimates/${id}`, { role: 'ADMIN' });
      }
    },

    {
      name: 'sent -> rework: VALID',
      run: async () => {
        const id = await createEstimateInStatus('sent');
        const resp = await attemptTransition(id, 'rework', 'needs changes');
        assertOk(resp, 'sent -> rework');
        await api('DELETE', `/api/estimates/${id}`, { role: 'ADMIN' });
      }
    },

    {
      name: 'sent -> question: VALID',
      run: async () => {
        const id = await createEstimateInStatus('sent');
        const resp = await attemptTransition(id, 'question', 'what about scope?');
        assertOk(resp, 'sent -> question');
        await api('DELETE', `/api/estimates/${id}`, { role: 'ADMIN' });
      }
    },

    {
      name: 'sent -> rejected: VALID',
      run: async () => {
        const id = await createEstimateInStatus('sent');
        const resp = await attemptTransition(id, 'reject', 'rejected');
        assertOk(resp, 'sent -> rejected');
        await api('DELETE', `/api/estimates/${id}`, { role: 'ADMIN' });
      }
    },

    // ════════════════════════════════════════════════════════════
    // FROM: rework
    // ════════════════════════════════════════════════════════════

    {
      name: 'rework -> sent: VALID (PM resubmits)',
      run: async () => {
        const id = await createEstimateInStatus('rework');
        const resp = await attemptTransition(id, 'resubmit');
        assertOk(resp, 'rework -> sent via resubmit');
        // Verify status changed to sent
        const check = await api('GET', `/api/estimates/${id}`, { role: 'PM' });
        const e = check.data?.estimate || check.data;
        assert(e.approval_status === 'sent', `expected sent, got ${e.approval_status}`);
        await api('DELETE', `/api/estimates/${id}`, { role: 'ADMIN' });
      }
    },

    {
      name: 'rework -> approved: INVALID',
      run: async () => {
        const id = await createEstimateInStatus('rework');
        const resp = await attemptTransition(id, 'approve');
        assertStatus(resp, 409, 'rework -> approved should be 409');
        await api('DELETE', `/api/estimates/${id}`, { role: 'ADMIN' });
      }
    },

    // ════════════════════════════════════════════════════════════
    // FROM: question
    // ════════════════════════════════════════════════════════════

    {
      name: 'question -> sent: VALID (PM resubmits)',
      run: async () => {
        const id = await createEstimateInStatus('question');
        const resp = await attemptTransition(id, 'resubmit');
        assertOk(resp, 'question -> sent via resubmit');
        const check = await api('GET', `/api/estimates/${id}`, { role: 'PM' });
        const e = check.data?.estimate || check.data;
        assert(e.approval_status === 'sent', `expected sent, got ${e.approval_status}`);
        await api('DELETE', `/api/estimates/${id}`, { role: 'ADMIN' });
      }
    },

    {
      name: 'question -> approved: INVALID',
      run: async () => {
        const id = await createEstimateInStatus('question');
        const resp = await attemptTransition(id, 'approve');
        assertStatus(resp, 409, 'question -> approved should be 409');
        await api('DELETE', `/api/estimates/${id}`, { role: 'ADMIN' });
      }
    },

    // ════════════════════════════════════════════════════════════
    // FROM: rejected (terminal)
    // ════════════════════════════════════════════════════════════

    {
      name: 'rejected -> approve: INVALID (terminal)',
      run: async () => {
        const id = await createEstimateInStatus('rejected');
        const resp = await attemptTransition(id, 'approve');
        assertStatus(resp, 409, 'rejected -> approved should be 409');
        await api('DELETE', `/api/estimates/${id}`, { role: 'ADMIN' });
      }
    },

    {
      name: 'rejected -> rework: INVALID (terminal)',
      run: async () => {
        const id = await createEstimateInStatus('rejected');
        const resp = await attemptTransition(id, 'rework', 'try rework rejected');
        assertStatus(resp, 409, 'rejected -> rework should be 409');
        await api('DELETE', `/api/estimates/${id}`, { role: 'ADMIN' });
      }
    },

    {
      name: 'rejected -> resubmit: INVALID (terminal)',
      run: async () => {
        const id = await createEstimateInStatus('rejected');
        const resp = await attemptTransition(id, 'resubmit');
        // Resubmit checks for rework/question status, rejected should fail
        assert(resp.status >= 400, `rejected -> resubmit should fail, got ${resp.status}`);
        await api('DELETE', `/api/estimates/${id}`, { role: 'ADMIN' });
      }
    },

    // ════════════════════════════════════════════════════════════
    // FROM: approved (terminal)
    // ════════════════════════════════════════════════════════════

    {
      name: 'approved -> approve: INVALID (terminal)',
      run: async () => {
        const id = await createEstimateInStatus('approved');
        const resp = await attemptTransition(id, 'approve');
        assertStatus(resp, 409, 'approved -> approved should be 409');
        await api('DELETE', `/api/estimates/${id}`, { role: 'ADMIN' });
      }
    },

    {
      name: 'approved -> rework: INVALID (terminal)',
      run: async () => {
        const id = await createEstimateInStatus('approved');
        const resp = await attemptTransition(id, 'rework', 'try rework approved');
        assertStatus(resp, 409, 'approved -> rework should be 409');
        await api('DELETE', `/api/estimates/${id}`, { role: 'ADMIN' });
      }
    },

    {
      name: 'approved -> reject: INVALID (terminal)',
      run: async () => {
        const id = await createEstimateInStatus('approved');
        const resp = await attemptTransition(id, 'reject', 'try reject approved');
        assertStatus(resp, 409, 'approved -> reject should be 409');
        await api('DELETE', `/api/estimates/${id}`, { role: 'ADMIN' });
      }
    },

    // ── CLEANUP ──
    {
      name: 'Cleanup: delete transition test tender',
      run: async () => {
        if (tenderId) await api('DELETE', `/api/tenders/${tenderId}`, { role: 'ADMIN' });
      }
    }
  ]
};
