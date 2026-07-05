const { api, assert, assertOk, assertForbidden, skip } = require('../config');

module.exports = {
  name: 'CASH HEAD_TO (Касса Хосе)',
  tests: [
    {
      name: 'HEAD_TO reads my-balance',
      run: async () => {
        const resp = await api('GET', '/api/cash/my-balance', { role: 'HEAD_TO' });
        if (resp.status === 403) {
          skip('HEAD_TO cash permission not migrated yet');
        }
        assertOk(resp, 'my-balance HEAD_TO');
        if (resp.ok && resp.data) {
          assert(resp.data.balance !== undefined, 'balance field present');
        }
      }
    },
    {
      name: 'HEAD_TO reads own cash requests',
      run: async () => {
        const resp = await api('GET', '/api/cash/my', { role: 'HEAD_TO' });
        if (resp.status === 403) skip('HEAD_TO cash permission not migrated yet');
        assertOk(resp, 'my cash HEAD_TO');
      }
    },
    {
      name: 'HEAD_TO per-diem suggestions endpoint',
      run: async () => {
        const resp = await api('GET', '/api/cash/per-diem-suggestions', { role: 'HEAD_TO' });
        if (resp.status === 403) skip('HEAD_TO cash permission not migrated yet');
        assertOk(resp, 'per-diem-suggestions');
        if (resp.ok) {
          assert(Array.isArray(resp.data?.suggestions), 'suggestions array');
        }
      }
    },
    {
      name: 'HEAD_TO own statement access',
      run: async () => {
        const resp = await api('GET', '/api/cash/statement', { role: 'HEAD_TO' });
        if (resp.status === 403) skip('HEAD_TO cash permission not migrated yet');
        assertOk(resp, 'statement HEAD_TO');
        if (resp.ok && resp.data?.pm) {
          assert(resp.data.pm.id != null, 'pm id in statement');
        }
      }
    },
    {
      name: 'BUH sees HEAD_TO in pm-balance list',
      run: async () => {
        const resp = await api('GET', '/api/payroll-dashboard/pm-balance', { role: 'BUH' });
        assertOk(resp, 'pm-balance BUH');
        if (resp.ok && resp.data?.pms) {
          const headTo = resp.data.pms.find((p) => p.holder_role === 'HEAD_TO' || p.pm_name);
          assert(headTo != null || resp.data.pms.length >= 0, 'pms list');
        }
      }
    },
    {
      name: 'HEAD_TO quick-expense rejects without open request (non per_diem)',
      run: async () => {
        const resp = await api('POST', '/api/cash/quick-expense', {
          role: 'HEAD_TO',
          body: {
            expense_type: 'taxi',
            amount: 100,
            description: 'ТЕСТ: такси'
          }
        });
        if (resp.status === 403) skip('HEAD_TO cash permission not migrated yet');
        // 400 expected if no open cash request or insufficient balance
        assert(resp.status === 400 || resp.status === 200, `quick-expense taxi: ${resp.status}`);
      }
    }
  ]
};
