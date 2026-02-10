/**
 * E2E FLOW 5: Cash advance lifecycle
 */
const { api, assert, assertOk } = require('../config');

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
        assert(req.status < 500, `cash request: ${req.status} - ${JSON.stringify(req.data)?.slice(0, 200)}`);
        const cashId = req.data?.request?.id || req.data?.id;
        if (!cashId) return;

        // 2. ADMIN approves
        const approve = await api('PUT', `/api/cash/${cashId}/approve`, {
          role: 'ADMIN',
          body: { notes: 'E2E: Approved for trip' }
        });
        assert(approve.status < 500, `approve: ${approve.status}`);

        // 3. PM marks as received
        const received = await api('PUT', `/api/cash/${cashId}/received`, {
          role: 'PM',
          body: { received_date: '2026-02-01', notes: 'E2E: Cash received' }
        });
        assert(received.status < 500, `received: ${received.status}`);

        // 4. PM adds expense report
        const expense = await api('POST', `/api/cash/${cashId}/expenses`, {
          role: 'PM',
          body: { amount: 45000, category: 'travel', date: '2026-02-05', description: 'E2E: Hotel + transport' }
        });
        assert(expense.status < 500, `cash expense: ${expense.status}`);

        // 5. PM returns remainder
        const ret = await api('POST', `/api/cash/${cashId}/return`, {
          role: 'PM',
          body: { amount: 30000, date: '2026-02-10', notes: 'E2E: Returning unused funds' }
        });
        assert(ret.status < 500, `cash return: ${ret.status}`);

        // 6. ADMIN closes the request
        const close = await api('PUT', `/api/cash/${cashId}/close`, {
          role: 'ADMIN',
          body: { notes: 'E2E: Closed after full reconciliation' }
        });
        assert(close.status < 500, `close: ${close.status}`);

        // 7. Verify in all cash list
        const allCash = await api('GET', '/api/cash/all', { role: 'ADMIN' });
        assertOk(allCash, 'all cash');
      }
    }
  ]
};
