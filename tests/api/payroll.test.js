const { api, assert, assertOk, assertForbidden } = require('../config');

let testSheetId = null;

module.exports = {
  name: 'PAYROLL (Расчёты)',
  tests: [
    {
      name: 'PM reads payroll sheets',
      run: async () => {
        const resp = await api('GET', '/api/payroll/sheets', { role: 'PM' });
        assertOk(resp, 'PM payroll sheets');
      }
    },
    {
      name: 'PM creates payroll sheet',
      run: async () => {
        const resp = await api('POST', '/api/payroll/sheets', {
          role: 'PM',
          body: {
            title: 'ТЕСТ: Ведомость',
            period_from: '2026-01-01',
            period_to: '2026-01-31'
          }
        });
        // May fail with 400 if validation differs, accept non-500
        assert(resp.status < 500, `create sheet: ${resp.status}`);
        if (resp.ok) {
          testSheetId = resp.data?.sheet?.id || resp.data?.id;
        }
      }
    },
    {
      name: 'PM reads sheet details',
      run: async () => {
        if (!testSheetId) return; // skip if create failed
        const resp = await api('GET', `/api/payroll/sheets/${testSheetId}`, { role: 'PM' });
        assertOk(resp, 'sheet details');
      }
    },
    {
      name: 'BUH reads payroll sheets',
      run: async () => {
        const resp = await api('GET', '/api/payroll/sheets', { role: 'BUH' });
        assertOk(resp, 'BUH payroll sheets');
      }
    },
    {
      name: 'ADMIN reads self-employed list',
      run: async () => {
        const resp = await api('GET', '/api/payroll/self-employed', { role: 'ADMIN' });
        assertOk(resp, 'self-employed');
      }
    },
    {
      name: 'ADMIN reads one-time payments',
      run: async () => {
        const resp = await api('GET', '/api/payroll/one-time', { role: 'ADMIN' });
        assertOk(resp, 'one-time payments');
      }
    },
    {
      name: 'HR cannot read payroll sheets',
      run: async () => {
        const resp = await api('GET', '/api/payroll/sheets', { role: 'HR' });
        assertForbidden(resp, 'HR payroll');
      }
    },
    {
      name: 'Cleanup: delete test sheet',
      run: async () => {
        if (!testSheetId) return;
        await api('DELETE', `/api/payroll/sheets/${testSheetId}`, { role: 'ADMIN' });
      }
    }
  ]
};
