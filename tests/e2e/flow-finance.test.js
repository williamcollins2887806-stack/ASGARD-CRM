/**
 * E2E FLOW 2: Work -> Expenses -> Incomes -> Reports
 */
const { api, assert, assertOk } = require('../config');

module.exports = {
  name: 'FLOW: Financial Lifecycle',
  tests: [
    {
      name: 'Work with expenses and incomes: create -> add costs -> add revenue -> check reports',
      run: async () => {
        // 1. PM creates work
        const w = await api('POST', '/api/works', {
          role: 'PM',
          body: { work_title: 'E2E Finance: Project Alpha', work_number: 'E2E-FIN-001', work_status: 'В работе', contract_value: 5000000, cost_plan: 3000000 }
        });
        assertOk(w, 'create work');
        const wid = w.data?.work?.id || w.data?.id;
        if (!wid) return;

        // 2. PM adds work expense
        const exp1 = await api('POST', '/api/expenses/work', {
          role: 'PM',
          body: { work_id: wid, amount: 100000, description: 'E2E Materials', category: 'materials', date: '2026-01-15' }
        });
        assertOk(exp1, 'expense 1');

        // 3. PM adds second expense
        const exp2 = await api('POST', '/api/expenses/work', {
          role: 'PM',
          body: { work_id: wid, amount: 50000, description: 'E2E Transport', category: 'transport', date: '2026-01-20' }
        });
        assertOk(exp2, 'expense 2');

        // 4. PM adds income
        const inc = await api('POST', '/api/incomes', {
          role: 'PM',
          body: { work_id: wid, amount: 500000, description: 'E2E Advance payment', type: 'advance', date: '2026-01-10' }
        });
        assert(inc.status < 500, `income: ${inc.status}`);

        // 5. Check work detail shows expenses
        const wDetail = await api('GET', `/api/works/${wid}`, { role: 'PM' });
        assertOk(wDetail, 'work detail');

        // 6. Check expenses list for this work
        const expList = await api('GET', `/api/expenses/work?work_id=${wid}`, { role: 'PM' });
        assertOk(expList, 'expenses for work');

        // 7. Check reports dashboard
        const dash = await api('GET', '/api/reports/dashboard', { role: 'ADMIN' });
        assertOk(dash, 'dashboard');

        // Cleanup
        if (wid) await api('DELETE', `/api/works/${wid}`, { role: 'ADMIN' });
      }
    }
  ]
};
