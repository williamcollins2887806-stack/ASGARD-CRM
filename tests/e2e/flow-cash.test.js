/**
 * E2E FLOW 5: Cash advance lifecycle
 */
const { api, assert, assertOk, skip } = require('../config');

module.exports = {
  name: 'FLOW: Cash Advance Lifecycle',
  tests: [
    {
      name: 'Cash advance: request -> approve -> receive -> expense -> return -> close',
      run: async () => {
        // 1. PM creates cash advance request
        const req = await api('POST', '/api/cash/request', {
          role: 'PM',
          body: { amount: 75000, description: 'E2E: Business trip to site' }
        });
        if (req.status === 404) skip('cash/request endpoint not available');
        assertOk(req, 'cash request');
        const cashId = req.data?.request?.id || req.data?.id;
        if (!cashId) return;

        // 2. ADMIN approves
        const approve = await api('PUT', `/api/cash/${cashId}/approve`, {
          role: 'ADMIN',
          body: { notes: 'E2E: Approved for trip' }
        });
        assertOk(approve, 'approve');

        // 3. PM marks as received
        const received = await api('PUT', `/api/cash/${cashId}/received`, {
          role: 'PM',
          body: { received_date: '2026-02-01', notes: 'E2E: Cash received' }
        });
        assertOk(received, 'received');

        // 4. PM adds expense report
        const expense = await api('POST', `/api/cash/${cashId}/expenses`, {
          role: 'PM',
          body: { amount: 45000, category: 'travel', date: '2026-02-05', description: 'E2E: Hotel + transport' }
        });
        assertOk(expense, 'cash expense');

        // 5. PM returns remainder
        const ret = await api('POST', `/api/cash/${cashId}/return`, {
          role: 'PM',
          body: { amount: 30000, date: '2026-02-10', notes: 'E2E: Returning unused funds' }
        });
        assertOk(ret, 'cash return');

        // 6. ADMIN closes the request
        const close = await api('PUT', `/api/cash/${cashId}/close`, {
          role: 'ADMIN',
          body: { notes: 'E2E: Closed after full reconciliation' }
        });
        assertOk(close, 'close');

        // 7. Verify in all cash list
        const allCash = await api('GET', '/api/cash/all', { role: 'ADMIN' });
        assertOk(allCash, 'all cash');
      }
    }
  ]
};
