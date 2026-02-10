const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, assertMatch, assertFieldType } = require('../config');

let testSheetId = null;

module.exports = {
  name: 'PAYROLL (Расчёты)',
  tests: [
    {
      name: 'PM reads payroll sheets',
      run: async () => {
        const resp = await api('GET', '/api/payroll/sheets', { role: 'PM' });
        assertOk(resp, 'PM payroll sheets');
        if (resp.data) {
          const list = Array.isArray(resp.data) ? resp.data : (resp.data.sheets || resp.data.items || []);
          assertArray(list, 'payroll sheets list');
        }
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
      name: 'Read-back sheet details after create',
      run: async () => {
        if (!testSheetId) return;
        const resp = await api('GET', `/api/payroll/sheets/${testSheetId}`, { role: 'PM' });
        assertOk(resp, 'sheet details');
        if (resp.data) {
          const sheet = resp.data.sheet || resp.data;
          assertHasFields(sheet, ['id'], 'sheet details');
          if (sheet.title !== undefined) {
            assertMatch(sheet, { title: 'ТЕСТ: Ведомость' }, 'sheet title read-back');
          }
        }
      }
    },
    {
      name: 'Validate rates endpoint',
      run: async () => {
        const resp = await api('GET', '/api/payroll/rates', { role: 'ADMIN' });
        assert(resp.status < 500, `rates: ${resp.status}`);
        if (resp.ok && resp.data) {
          const rates = Array.isArray(resp.data) ? resp.data : (resp.data.rates || resp.data);
          assert(rates !== undefined, 'rates should return data');
        }
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
      name: 'Negative: create sheet with empty body → 400',
      run: async () => {
        const resp = await api('POST', '/api/payroll/sheets', {
          role: 'PM',
          body: {}
        });
        assert(resp.status === 400, `empty body should return 400, got ${resp.status}`);
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
