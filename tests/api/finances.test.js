const { api, assert, assertOk, assertForbidden } = require('../config');

module.exports = {
  name: 'FINANCES (Расходы/Доходы)',
  tests: [
    {
      name: 'PM reads work expenses',
      run: async () => {
        const resp = await api('GET', '/api/expenses/work', { role: 'PM' });
        assertOk(resp, 'work expenses');
      }
    },
    {
      name: 'ADMIN reads work expenses',
      run: async () => {
        const resp = await api('GET', '/api/expenses/work', { role: 'ADMIN' });
        assertOk(resp, 'ADMIN work expenses');
      }
    },
    {
      name: 'BUH reads work expenses',
      run: async () => {
        const resp = await api('GET', '/api/expenses/work', { role: 'BUH' });
        assertOk(resp, 'BUH work expenses');
      }
    },
    {
      name: 'OFFICE_MANAGER reads office expenses',
      run: async () => {
        const resp = await api('GET', '/api/expenses/office', { role: 'OFFICE_MANAGER' });
        assertOk(resp, 'office expenses');
      }
    },
    {
      name: 'ADMIN reads incomes',
      run: async () => {
        const resp = await api('GET', '/api/incomes', { role: 'ADMIN' });
        assertOk(resp, 'incomes');
      }
    },
    {
      name: 'BUH reads incomes',
      run: async () => {
        const resp = await api('GET', '/api/incomes', { role: 'BUH' });
        assertOk(resp, 'BUH incomes');
      }
    },
    {
      name: 'HR cannot create expense',
      run: async () => {
        const resp = await api('POST', '/api/expenses/work', {
          role: 'HR',
          body: { amount: 100, description: 'test' }
        });
        assertForbidden(resp, 'HR create expense');
      }
    }
  ]
};
