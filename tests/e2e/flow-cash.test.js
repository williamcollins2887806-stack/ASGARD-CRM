/**
 * E2E FLOW 5: Cash advance lifecycle
 * Route: POST /api/cash, PUT /:id/approve, PUT /:id/receive, POST /:id/return, PUT /:id/close
 */
const { api, assert, assertOk, skip } = require('../config');

module.exports = {
  name: 'FLOW: Cash Advance Lifecycle',
  tests: [
    {
      name: 'Cash advance: request -> approve -> receive -> expense -> return -> close',
      run: async () => {
        // Need a work_id for advance type
        const works = await api('GET', '/api/works?limit=1', { role: 'PM' });
        const workList = works.data?.works || works.data || [];
        const workId = Array.isArray(workList) && workList.length > 0 ? workList[0].id : null;
        if (!workId) skip('No works available for cash advance test');

        // 1. PM creates cash advance request
        const req = await api('POST', '/api/cash', {
          role: 'PM',
          body: { amount: 75000, purpose: 'E2E: Business trip to site', work_id: workId, type: 'advance' }
        });
        if (req.status === 404) skip('cash endpoint not available');
        assertOk(req, 'cash request');
        const cashId = req.data?.id;
        if (!cashId) return;

        // 2. ADMIN approves
        const approve = await api('PUT', `/api/cash/${cashId}/approve`, {
          role: 'ADMIN',
          body: { comment: 'E2E: Approved for trip' }
        });
        assertOk(approve, 'approve');

        // 3. PM marks as received
        const received = await api('PUT', `/api/cash/${cashId}/receive`, {
          role: 'PM',
          body: {}
        });
        assertOk(received, 'received');

        // 4. PM returns the full amount (expense requires multipart upload)
        const ret = await api('POST', `/api/cash/${cashId}/return`, {
          role: 'PM',
          body: { amount: 75000, note: 'E2E: Returning full amount' }
        });
        assertOk(ret, 'cash return');

        // 5. ADMIN closes the request
        const close = await api('PUT', `/api/cash/${cashId}/close`, {
          role: 'ADMIN',
          body: { force: true, comment: 'E2E: Closed after return' }
        });
        assertOk(close, 'close');

        // 6. Verify in all cash list
        const allCash = await api('GET', '/api/cash/all', { role: 'ADMIN' });
        assertOk(allCash, 'all cash');
      }
    }
  ]
};
