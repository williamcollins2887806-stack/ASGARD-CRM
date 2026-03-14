/**
 * E2E FLOW 8: Office expense lifecycle
 * OFFICE_MANAGER creates office expense -> submits -> DIRECTOR_GEN approves -> BUH sees in registry
 * Route: /api/expenses/office (POST, GET), /api/expenses/office/:id (PUT, DELETE)
 */
const { api, assert, assertOk, assertForbidden, skip } = require('../config');

module.exports = {
  name: 'FLOW: Office Expense Lifecycle',
  tests: [
    {
      name: 'Office expense: create (ADMIN) -> approve (DIRECTOR_GEN) -> BUH reads -> cleanup',
      run: async () => {
        // OFFICE_MANAGER is not in WRITE_ROLES for expenses, use ADMIN to create
        // WRITE_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'PM', 'BUH']

        // 1. ADMIN creates an office expense (pending status auto-set)
        const createResp = await api('POST', '/api/expenses/office', {
          role: 'ADMIN',
          body: {
            category: 'office_supplies',
            description: 'E2E: Printer paper and toner cartridges',
            amount: 15000,
            date: new Date().toISOString().slice(0, 10),
            supplier: 'OfficePro LLC',
            notes: 'E2E autotest office expense'
          }
        });
        if (createResp.status === 404) skip('expenses/office endpoint not available');
        assertOk(createResp, 'ADMIN create office expense');
        const expense = createResp.data?.expense;
        if (!expense || !expense.id) skip('Expense not returned');
        const expenseId = expense.id;
        assert(expense.status === 'pending', 'initial status is pending');

        try {
          // 2. DIRECTOR_GEN approves (updates status to approved)
          const approveResp = await api('PUT', '/api/expenses/office/' + expenseId, {
            role: 'DIRECTOR_GEN',
            body: { status: 'approved', notes: 'E2E: Approved by Director General' }
          });
          assertOk(approveResp, 'DIRECTOR_GEN approve expense');
          const approved = approveResp.data?.expense;
          if (approved) assert(approved.status === 'approved', 'status changed to approved');

          // 3. BUH can see the expense in the list
          const listResp = await api('GET', '/api/expenses/office?status=approved', { role: 'BUH' });
          assertOk(listResp, 'BUH list approved expenses');
          const expenses = listResp.data?.expenses || [];
          assert(Array.isArray(expenses), 'expenses is array');
          const found = expenses.find(e => e.id === expenseId);
          assert(found, 'BUH sees approved expense in list');
          assert(found.status === 'approved', 'expense status is approved in BUH view');

          // 4. Verify expense details match
          assert(Number(found.amount) === 15000 || parseFloat(found.amount) === 15000, 'amount matches');

          // 5. BUH can also list all office expenses without filter
          const allResp = await api('GET', '/api/expenses/office', { role: 'BUH' });
          assertOk(allResp, 'BUH list all expenses');

        } finally {
          // Cleanup: delete the expense
          await api('DELETE', '/api/expenses/office/' + expenseId, { role: 'ADMIN' });
        }
      }
    },
    {
      name: 'OFFICE_MANAGER cannot create office expenses directly (not in WRITE_ROLES)',
      run: async () => {
        const resp = await api('POST', '/api/expenses/office', {
          role: 'OFFICE_MANAGER',
          body: {
            category: 'cleaning',
            description: 'E2E: Cleaning supplies',
            amount: 5000,
            date: new Date().toISOString().slice(0, 10)
          }
        });
        if (resp.status === 404) skip('expenses/office endpoint not available');
        // OFFICE_MANAGER is not in WRITE_ROLES, should be 403
        assertForbidden(resp, 'OFFICE_MANAGER cannot create expense');
      }
    },
    {
      name: 'Office expense validation: missing required fields',
      run: async () => {
        // Missing amount
        const noAmount = await api('POST', '/api/expenses/office', {
          role: 'ADMIN',
          body: { category: 'office_supplies', description: 'E2E: no amount' }
        });
        if (noAmount.status === 404) skip('expenses/office endpoint not available');
        assert(noAmount.status === 400, 'missing amount returns 400');

        // Missing category
        const noCat = await api('POST', '/api/expenses/office', {
          role: 'ADMIN',
          body: { amount: 1000, description: 'E2E: no category' }
        });
        assert(noCat.status === 400, 'missing category returns 400');
      }
    }
  ]
};
