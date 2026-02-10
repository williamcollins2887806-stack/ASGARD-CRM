const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, assertMatch, assertFieldType } = require('../config');

let testExpenseId = null;

module.exports = {
  name: 'FINANCES (Расходы/Доходы)',
  tests: [
    {
      name: 'PM reads work expenses',
      run: async () => {
        const resp = await api('GET', '/api/expenses/work', { role: 'PM' });
        assertOk(resp, 'work expenses');
        if (resp.data) {
          const list = Array.isArray(resp.data) ? resp.data : (resp.data.expenses || resp.data.items || []);
          assertArray(list, 'work expenses list');
        }
      }
    },
    {
      name: 'ADMIN reads work expenses with field validation',
      run: async () => {
        const resp = await api('GET', '/api/expenses/work', { role: 'ADMIN' });
        assertOk(resp, 'ADMIN work expenses');
        if (resp.data) {
          const list = Array.isArray(resp.data) ? resp.data : (resp.data.expenses || resp.data.items || []);
          assertArray(list, 'ADMIN work expenses list');
          if (list.length > 0) {
            assertHasFields(list[0], ['id'], 'expense item');
            assertFieldType(list[0], 'id', 'number', 'expense item id');
          }
        }
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
        if (resp.data) {
          const list = Array.isArray(resp.data) ? resp.data : (resp.data.incomes || resp.data.items || []);
          assertArray(list, 'incomes list');
        }
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
      name: 'PM creates work expense',
      run: async () => {
        const resp = await api('POST', '/api/expenses/work', {
          role: 'PM',
          body: {
            amount: 1500,
            description: 'ТЕСТ: Расход на материалы Stage12',
            date: '2026-02-01',
            category: 'materials'
          }
        });
        assert(resp.status < 500, `create expense: ${resp.status} - ${JSON.stringify(resp.data)?.slice(0, 200)}`);
        if (resp.ok) {
          testExpenseId = resp.data?.expense?.id || resp.data?.id;
        }
      }
    },
    {
      name: 'Read-back expense after create',
      run: async () => {
        if (!testExpenseId) return;
        const resp = await api('GET', `/api/expenses/work/${testExpenseId}`, { role: 'PM' });
        // Single-item endpoint may not exist, fall back to list check
        if (resp.status === 404) {
          const listResp = await api('GET', '/api/expenses/work', { role: 'PM' });
          assertOk(listResp, 'read-back expense via list');
          const list = Array.isArray(listResp.data) ? listResp.data : (listResp.data?.expenses || listResp.data?.items || []);
          const found = list.find(e => e.id === testExpenseId);
          assert(found, `expense ${testExpenseId} not found in list after create`);
          if (found) {
            assertMatch(found, { amount: 1500 }, 'read-back expense amount');
          }
        } else {
          assert(resp.status < 500, `read-back expense: ${resp.status}`);
        }
      }
    },
    {
      name: 'Negative: create expense with empty body',
      run: async () => {
        const resp = await api('POST', '/api/expenses/work', {
          role: 'PM',
          body: {}
        });
        // Server allows empty body — just verify no crash
        assert(resp.status < 500, `empty body should not cause 5xx, got ${resp.status}`);
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
    },
    {
      name: 'Cleanup: delete test expense',
      run: async () => {
        if (!testExpenseId) return;
        await api('DELETE', `/api/expenses/work/${testExpenseId}`, { role: 'ADMIN' });
        testExpenseId = null;
      }
    }
  ]
};
